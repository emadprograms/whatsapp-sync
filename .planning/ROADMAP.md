# Roadmap: whatsapp-sync

## Phase 1: Rip out whatsapp-web.js and install Baileys
Remove the `whatsapp-web.js` package and all its specific types/imports from the codebase. Install `@whiskeysockets/baileys` and its required dependencies.

**Covered Requirements:**
- MIGR-01

## Phase 2: Rewrite watcher.js connection and authentication logic
Implement the Baileys socket connection, state management, and QR code generation for terminal authentication using `makeWASocket` and `useMultiFileAuthState`.

**Covered Requirements:**
- MIGR-02

## Phase 3: Implement Baileys inbound sync (send me -> IN_DIR)
Rewrite the `message_create` (or `messages.upsert` in Baileys) listener. It must detect media messages sent to/from the `GROUP_ID`, extract the decrypted media stream using `downloadMediaMessage`, and save it to the IN_DIR without triggering anti-spam locks.

**Covered Requirements:**
- MIGR-03

## Phase 4: Implement Baileys outbound sync (OUT_DIR -> receive me)
Rewrite the chokidar listener to upload files from OUT_DIR to the `RECEIVE_GROUP_ID` using `sendMessage` with the correct mimetype extraction and media buffering, then immediately delete the local file.

**Covered Requirements:**
- MIGR-04

## Phase 5: Update E2E Playwright tests for Baileys
Modify the Playwright tests to work with the new Baileys setup. Note that since Baileys doesn't use Puppeteer, the tests may need to interact with the socket directly or rely solely on filesystem assertions.

**Covered Requirements:**
- MIGR-05
