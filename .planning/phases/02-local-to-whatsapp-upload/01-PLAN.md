---
wave: 1
depends_on: []
files_modified:
  - watcher.js
autonomous: true
---

# Phase 02: Local to WhatsApp Upload Plan

<threat_model>
ASVS Level: 1
Block on: high
Threats:
- Information Disclosure: Log only filenames in `skipped-files.log`, never full paths or file contents.
- Denial of Service: Rate-limit uploads (3s delay) to prevent WhatsApp ban. Chokidar errors must be caught to prevent app crash.
</threat_model>

## Wave 1: Echo Prevention & Naming Convention

### Task 1.1 — Add loop prevention and .tmp download pattern in message_create

<task>
<read_first>
- watcher.js (lines 1-271 — full file, understand current message_create handler at line 208 and history sync at line 144)
- src/SyncManifest.js (full file — understand set/has/delete API)
- index.js (line 16 — MessageMedia export)
</read_first>
<action>
1. In `watcher.js` at the top of the `client.on('message_create', async (msg) => {` handler (line 208), add `if (msg.id.fromMe) return;` as the very first statement inside the callback, before the existing `console.log` on line 209.

2. Add `const { MessageMedia } = require('./index');` to the import block at the top of `watcher.js` (after line 1).

3. Update the filename variable in BOTH the history sync block (around line 180) and the live `message_create` handler (around line 254):
   - Replace `const filename = \`${timestamp}_${uniqueId}_${safeSenderName}${extension}\`;` with logic that uses the new format: `[uniqueId]_[baseFilename]`.
   - `uniqueId` is already computed as `msg.id.id.slice(-5)`.
   - `baseFilename` is already computed (the media.filename fallback to `download.ext`).
   - Construct: `const filename = \`${uniqueId}_${baseFilename}\`;` — but only append the extension if `baseFilename` does not already contain it.
   - Remove the now-unused variables: `timestamp`, `contact`, `senderName`, `safeSenderName` and the `formatTimestamp` function call. Remove the `formatTimestamp` function definition (lines 22-29) and `getExtension` helper if no longer needed.

4. In BOTH download locations (history sync and live message_create), change the file writing to use the `.tmp` echo-prevention pattern:
   - Write to `filePath + '.tmp'` instead of `filePath`.
   - Call `manifest.set(filename, msg.id._serialized)` AFTER writing the .tmp file.
   - Call `fs.renameSync(filePath + '.tmp', filePath)` AFTER updating the manifest.
   This ensures chokidar's `add` event fires only after the manifest already contains the filename, preventing re-upload.
</action>
<acceptance_criteria>
- Source assertion: `if (msg.id.fromMe) return;` appears as the first statement inside the `message_create` callback, before any console.log.
- Source assertion: `const { MessageMedia } = require('./index');` or equivalent import exists at the top of `watcher.js`.
- Source assertion: Filename format in both download blocks follows `${uniqueId}_${baseFilename}` pattern — no timestamp, no senderName.
- Source assertion: Both download blocks contain `fs.writeFileSync(filePath + '.tmp', ...)` followed by `manifest.set(...)` followed by `fs.renameSync(filePath + '.tmp', filePath)`.
- Source assertion: `formatTimestamp` function is removed or unused. `contact`/`senderName`/`safeSenderName` variables are removed from both download blocks.
</acceptance_criteria>
</task>

## Wave 2: Startup Scan — Offline Additions & Deletions

### Task 2.1 — Implement startup scan for offline changes

<task>
<read_first>
- watcher.js (the `client.on('ready')` handler starting at line 112 — understand the history sync block and groupFolder variable at line 134)
- src/SyncManifest.js (full file — specifically `entries()` at line 90, `has()` at line 68, `getByFilename()` at line 72, `delete()` at line 85)
</read_first>
<action>
1. In `watcher.js`, inside `client.on('ready')`, AFTER the existing history sync block ends (after the `console.log('✅ Sync complete...')` around line 197), add a new "Startup Scan" block.

2. **Detect offline file deletions** (files tracked in manifest but missing locally):
   - Call `manifest.entries()` to get all `[filename, messageId]` pairs.
   - For each pair, check `fs.existsSync(path.join(groupFolder, filename))`.
   - If the file does NOT exist locally:
     a. Call `const msg = await client.getMessageById(messageId)`.
     b. If `msg` exists, call `await msg.delete(true)` to revoke the WhatsApp message.
     c. Call `manifest.delete(filename)` to remove from state.
     d. Log: `console.log('🗑️ Revoked orphan message for deleted file:', filename)`.
   - Wrap each iteration in try/catch to prevent one failure from blocking the rest.

3. **Detect offline file additions** (local files not tracked in manifest):
   - Call `fs.readdirSync(groupFolder)`.
   - For each file, skip if: filename is `sync-manifest.json`, filename is `skipped-files.log`, filename ends with `.tmp`, or `manifest.has(filename)` is true.
   - For remaining files (untracked), add their full path to a `startupUploadQueue` array. These will be processed by the upload queue (implemented in Wave 3).
   - Log: `console.log('📤 Queued untracked local file for upload:', filename)`.
   - Store the `startupUploadQueue` array in a variable accessible to the Wave 3 code (declare it at the `ready` handler scope level).
</action>
<acceptance_criteria>
- Source assertion: `manifest.entries()` is called and iterated to check for files missing from local disk.
- Source assertion: When a tracked file is missing locally, `client.getMessageById(messageId)` is called, followed by `msg.delete(true)` if msg exists, followed by `manifest.delete(filename)`.
- Source assertion: `fs.readdirSync(groupFolder)` is called. Files not in the manifest (and not `sync-manifest.json`, `skipped-files.log`, or `.tmp`) are collected into `startupUploadQueue`.
- Source assertion: Each iteration in the offline-deletion loop is wrapped in try/catch.
- Behavior assertion: If a tracked file is deleted locally while bot is offline and the corresponding message still exists, on restart the message is revoked and manifest entry removed.
- Behavior assertion: If a new file is added locally while bot is offline, on restart it is queued for upload.
</acceptance_criteria>
</task>

## Wave 3: Chokidar File Watching & Upload Queue

### Task 3.1 — Implement upload queue with rate limiting and error logging

<task>
<read_first>
- watcher.js (full file — current state after Wave 1 and 2 edits)
- src/SyncManifest.js (full file — `has()`, `set()` methods)
- src/structures/MessageMedia.js (line 48 — `static fromFilePath(filePath)` signature)
- .planning/phases/02-local-to-whatsapp-upload/02-RESEARCH.md (sections 3 and 4 — upload mechanics and queue design)
</read_first>
<action>
0. **Guard against duplicate initialization (Review Fix — HIGH):** At module scope (near the top of `watcher.js`, below `let groupFolder = null;`), declare `let isWatcherInitialized = false;`. At the very start of the Phase 2 block inside `client.on('ready')` (before the startup scan), add:
   ```js
   if (isWatcherInitialized) return;
   isWatcherInitialized = true;
   ```
   This prevents the watcher, upload queue, and chokidar from being created multiple times if the WhatsApp client disconnects and the `ready` event fires again.

1. Inside `client.on('ready')`, after the startup scan block (and after the guard above), declare:
   - `const MAX_FILE_SIZE_BYTES = 64 * 1024 * 1024;` (64 MB limit)
   - `const uploadQueue = [...startupUploadQueue];` (seeded with any files discovered during startup scan)
   - `let isProcessingQueue = false;`

2. Define `async function processUploadQueue(groupFolder)` within the `ready` handler scope:
   - Set `isProcessingQueue = true`.
   - Use a `while (uploadQueue.length > 0)` loop.
   - `const filePath = uploadQueue.shift();`
   - `const filename = path.basename(filePath);`
   - Check `if (manifest.has(filename))` — if true, `continue` (skip already-tracked files).
   - Check `if (!fs.existsSync(filePath))` — if true, `continue` (file may have been deleted between queue and processing).
   - **File size guard (Review Fix — MEDIUM):** Call `const stat = fs.statSync(filePath);`. If `stat.size > MAX_FILE_SIZE_BYTES`, log `${new Date().toISOString()} | SIZE_SKIP | ${filename} | ${stat.size} bytes exceeds ${MAX_FILE_SIZE_BYTES} limit\n` to `path.join(groupFolder, 'skipped-files.log')` using `fs.appendFileSync`, then `continue`.
   - Wrap the upload in try/catch:
     a. `const media = MessageMedia.fromFilePath(filePath);`
     b. `const sentMsg = await client.sendMessage(TARGET_GROUP_ID, media, { caption: filename });`
     c. `manifest.set(filename, sentMsg.id._serialized);`
     d. `console.log('✅ Uploaded:', filename);`
     e. Add a rate-limit delay: `await new Promise(r => setTimeout(r, 3000));`
   - In catch block: append `${new Date().toISOString()} | SKIP | ${filename} | ${err.message}\n` to `path.join(groupFolder, 'skipped-files.log')` using `fs.appendFileSync`.
   - After the while loop, set `isProcessingQueue = false`.

3. Define a helper function `function enqueueUpload(filePath)`:
   - `const filename = path.basename(filePath);`
   - If filename is `sync-manifest.json`, `skipped-files.log`, or ends with `.tmp`, return immediately.
   - If `manifest.has(filename)`, return immediately.
   - Push `filePath` to `uploadQueue`.
   - If `!isProcessingQueue`, call `processUploadQueue(groupFolder).catch(err => console.error('❌ Upload queue error:', err));`.

4. Initialize chokidar watcher using dynamic import (chokidar v5 is ESM-only):
   - `const chokidar = await import('chokidar');`
   - `const fsWatcher = chokidar.watch(groupFolder, { ignoreInitial: true, ignored: /(^|[\/\\])\.tmp$|sync-manifest\.json|skipped-files\.log/ });`
   - Note: `ignoreInitial: true` is correct here because the startup scan (Wave 2) already handles pre-existing untracked files. The watcher only needs to catch live additions/deletions going forward.
   - `fsWatcher.on('add', (filePath) => { enqueueUpload(filePath); });`
</action>
<acceptance_criteria>
- Source assertion: `let isWatcherInitialized = false;` is declared at module scope in `watcher.js`.
- Source assertion: The Phase 2 block inside `client.on('ready')` begins with `if (isWatcherInitialized) return; isWatcherInitialized = true;`.
- Source assertion: `const MAX_FILE_SIZE_BYTES = 64 * 1024 * 1024;` is declared.
- Source assertion: `fs.statSync(filePath).size` is checked against `MAX_FILE_SIZE_BYTES` before `MessageMedia.fromFilePath`. Files exceeding the limit are logged to `skipped-files.log` with `SIZE_SKIP` tag and skipped.
- Source assertion: `uploadQueue` is initialized seeded with `startupUploadQueue` contents via spread.
- Source assertion: `processUploadQueue` contains a `while (uploadQueue.length > 0)` loop.
- Source assertion: `manifest.has(filename)` check exists before `MessageMedia.fromFilePath`.
- Source assertion: `client.sendMessage(TARGET_GROUP_ID, media, { caption: filename })` is called inside the loop.
- Source assertion: `manifest.set(filename, sentMsg.id._serialized)` is called after successful send.
- Source assertion: `await new Promise(r => setTimeout(r, 3000))` delay exists inside the loop after each upload.
- Source assertion: catch block uses `fs.appendFileSync` to write to `skipped-files.log`.
- Source assertion: `await import('chokidar')` is used (dynamic ESM import).
- Source assertion: `chokidar.watch(groupFolder, { ignoreInitial: true, ... })` — NOT `ignoreInitial: false`.
- Source assertion: `enqueueUpload` skips files named `sync-manifest.json`, `skipped-files.log`, or ending with `.tmp`.
- Behavior assertion: Running `node watcher.js` with GROUP_ID set and a new file dropped in the group folder results in that file being sent as a WhatsApp message.
- Behavior assertion: If the WhatsApp client disconnects and reconnects (firing `ready` again), no duplicate watchers or queue processors are created.
- Behavior assertion: Files larger than 64MB are logged to `skipped-files.log` and not uploaded.
</acceptance_criteria>
</task>

### Task 3.2 — Implement live local deletion handler (unlink event)

<task>
<read_first>
- watcher.js (current state — understand the chokidar `fsWatcher` variable from Task 3.1)
- src/SyncManifest.js (`has()` at line 68, `getByFilename()` at line 72, `delete()` at line 85)
</read_first>
<action>
1. After the `fsWatcher.on('add', ...)` listener, add an `unlink` listener:
   `fsWatcher.on('unlink', async (filePath) => { ... });`

2. Inside the handler:
   - `const filename = path.basename(filePath);`
   - If filename is `sync-manifest.json`, `skipped-files.log`, or ends with `.tmp`, return immediately.
   - Check `if (!manifest.has(filename))` — if true, return (untracked file, nothing to do).
   - `const messageId = manifest.getByFilename(filename);`
   - Wrap in try/catch:
     a. `const msg = await client.getMessageById(messageId);`
     b. If `msg` is truthy, call `await msg.delete(true);`
     c. Log: `console.log('🗑️ Revoked WhatsApp message for deleted file:', filename);`
   - In finally block (or after try/catch): `manifest.delete(filename);`
</action>
<acceptance_criteria>
- Source assertion: `fsWatcher.on('unlink', async (filePath) => {` exists in `watcher.js`.
- Source assertion: `manifest.getByFilename(filename)` is used to retrieve the messageId (not manual iteration).
- Source assertion: `msg.delete(true)` is called when the message exists.
- Source assertion: `manifest.delete(filename)` is always called after the revocation attempt.
- Behavior assertion: Deleting a tracked file from the group folder causes the corresponding WhatsApp message to be revoked.
</acceptance_criteria>
</task>

## Wave 4: Incoming WhatsApp Deletions (Revocations)

### Task 4.1 — Handle message_revoke_everyone event

<task>
<read_first>
- watcher.js (current state — understand existing event listeners)
- src/SyncManifest.js (`getByMessageId()` at line 76 — returns filename or undefined)
- src/Client.js (lines 774-796 — understand `message_revoke_everyone` event: emits `(message, revoked_msg)` where `message` is the revoked message in its current state)
</read_first>
<action>
1. Add new event listeners in `watcher.js` (outside the `ready` handler, near the `message_create` listener):

   `client.on('message_revoke_everyone', async (msg, revokedMsg) => { ... });`
   `client.on('message_revoke_me', async (msg, revokedMsg) => { ... });`

   (Both listeners can share the same callback logic).

2. Inside the handler:
   - Guard: `if (msg.from !== TARGET_GROUP_ID && msg.to !== TARGET_GROUP_ID) return;`
   - Determine the messageId to look up. Use `msg.id._serialized`. If `revokedMsg` exists and `revokedMsg.id._serialized` differs, also try that.
   - `const filename = manifest.getByMessageId(msg.id._serialized);` — use the concrete API, NOT manual iteration.
   - If `filename` is `undefined` and `revokedMsg`, try: `manifest.getByMessageId(revokedMsg.id._serialized)`.
   - If `filename` is still `undefined`, return (message not tracked).
   - Determine the full file path: `const filePath = path.join(groupFolder, filename);` — `groupFolder` must be accessible (declare at module scope or use the same derivation `path.join(DOWNLOADS_DIR, TARGET_GROUP_ID.split('@')[0])`).
   - Wrap in try/catch: `fs.unlinkSync(filePath);`
   - Call `manifest.delete(filename);`
   - Log: `console.log('🗑️ Deleted local file for revoked message:', filename);`

3. To make `groupFolder` accessible to this handler, hoist the `groupFolder` variable declaration to module scope (below `DOWNLOADS_DIR`). Initialize it as `let groupFolder = null;` and assign its value inside the `ready` handler where it's currently computed.
</action>
<acceptance_criteria>
- Source assertion: `client.on('message_revoke_everyone', async (msg, revokedMsg) => {` and `client.on('message_revoke_me', async (msg, revokedMsg) => {` exist in `watcher.js`.
- Source assertion: `manifest.getByMessageId(msg.id._serialized)` is called — NOT manual Object.entries iteration.
- Source assertion: `fs.unlinkSync(filePath)` is called when a tracked message is revoked.
- Source assertion: `manifest.delete(filename)` is called after file deletion.
- Source assertion: `groupFolder` is declared at module scope as `let groupFolder = null;`.
- Behavior assertion: Revoking a tracked message in the WhatsApp group causes the corresponding local file to be deleted.
</acceptance_criteria>
</task>

## Edge Coverage & Must Haves

```yaml
must_haves:
  truths:
    - Files placed in the local watched folder are uploaded to WhatsApp with their filename as the caption
    - The bot waits ~3 seconds between consecutive file uploads
    - Downloaded files use the format '[uniqueId]_[originalFilename]'
    - Downloaded files are saved with .tmp extension first, manifest is updated, then renamed to final name — preventing chokidar echo uploads
    - The startup scan detects files deleted locally while offline and revokes their WhatsApp messages via manifest.entries() cross-reference
    - The startup scan detects files added locally while offline and queues them for upload
    - Deleting a file from the local folder triggers msg.delete(true) revocation for the corresponding WhatsApp message
    - Revoking a tracked message in the WhatsApp group deletes the corresponding local file via manifest.getByMessageId()
    - Upload failures are logged to skipped-files.log with timestamp and error message
    - The watcher and upload queue are initialized only once, guarded by isWatcherInitialized flag (prevents duplicate watchers on reconnect)
    - Files exceeding 64MB are skipped and logged to skipped-files.log with SIZE_SKIP tag before any read into memory
  prohibitions:
    - The bot must NOT re-download files that it just uploaded (msg.id.fromMe guard)
    - Chokidar must NOT trigger upload for .tmp files
    - The startup scan must NOT use ignoreInitial:false — it uses readdirSync for offline additions and manifest.entries() for offline deletions
    - The ready event must NOT create duplicate chokidar watchers or queue processors on reconnection — isWatcherInitialized guard prevents this
    - Files larger than MAX_FILE_SIZE_BYTES (64MB) must NOT be passed to MessageMedia.fromFilePath — they are skipped before any I/O
```

## Prior-Attempt Issue Resolution

| Issue | Resolution |
|---|---|
| **BLOCKER — Offline file additions** | Task 2.1 uses `fs.readdirSync(groupFolder)` to find local files not in the manifest. These are collected into `startupUploadQueue` and seeded into the upload queue in Task 3.1. |
| **BLOCKER — Offline file deletions** | Task 2.1 iterates `manifest.entries()` and checks `fs.existsSync()` for each tracked file. Missing files trigger `client.getMessageById()` → `msg.delete(true)` → `manifest.delete()`. |
| **WARNING — Concrete SyncManifest API** | Task 3.2 uses `manifest.getByFilename(filename)`. Task 4.1 uses `manifest.getByMessageId(msg.id._serialized)`. No vague iteration instructions. |
| **WARNING — Upload loop race condition (Echoes)** | Task 1.1 implements the `.tmp` write pattern: `writeFileSync(path + '.tmp')` → `manifest.set()` → `renameSync()`. Task 3.1 configures chokidar to ignore `.tmp` files and `enqueueUpload` skips `.tmp` files. |
| **HIGH — Duplicate Watcher Initialization (Review)** | Task 3.1 step 0 adds `let isWatcherInitialized = false;` at module scope, checked at start of the Phase 2 block inside `ready`. Prevents duplicate chokidar watchers and queue processors on WhatsApp reconnect. |
| **MEDIUM — Blocking I/O on Large Files (Review)** | Task 3.1 step 2 adds `fs.statSync` size check against `MAX_FILE_SIZE_BYTES` (64MB) before calling `MessageMedia.fromFilePath`. Oversized files are logged to `skipped-files.log` with `SIZE_SKIP` tag and skipped. |

## Artifacts this phase produces

### New symbols in `watcher.js`
- `MessageMedia` — import from `./index`
- `groupFolder` — hoisted to module scope as `let groupFolder = null;`
- `isWatcherInitialized` — boolean guard at module scope, prevents duplicate initialization on reconnect
- `MAX_FILE_SIZE_BYTES` — constant (`64 * 1024 * 1024`), max file size for upload
- `startupUploadQueue` — array of file paths collected during startup scan
- `uploadQueue` — array of file paths pending upload
- `isProcessingQueue` — boolean flag for queue processing state
- `processUploadQueue(groupFolder)` — async function that processes the upload queue with rate limiting
- `enqueueUpload(filePath)` — function that validates and adds files to the upload queue
- `fsWatcher` — chokidar watcher instance watching `groupFolder`
- `fsWatcher.on('add', ...)` — chokidar add event handler
- `fsWatcher.on('unlink', ...)` — chokidar unlink event handler
- `client.on('message_revoke_everyone', ...)` — revocation event handler

### New files
- `skipped-files.log` — created at runtime in the group folder when upload errors occur

### Modified naming convention
- Downloaded files: `[uniqueId]_[originalFilename]` (replaces old `[timestamp]_[uniqueId]_[safeSenderName][extension]`)

### Removed symbols from `watcher.js`
- `formatTimestamp(timestamp)` — function removed (no longer used in naming)
- `getExtension(media)` — function removed if no longer used
- `contact`, `senderName`, `safeSenderName` — variables removed from both download blocks
