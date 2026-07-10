# Roadmap: Two-Way Sync

## Phase 1: Sync Infrastructure

- [ ] Install `chokidar` for filesystem watching.
- [ ] Implement `SyncManifest` class to handle reading/writing the sync state JSON.
- [ ] Integrate `SyncManifest` into the existing download flow in `watcher.js`.

## Phase 2: Local to WhatsApp Upload

- [ ] Implement folder watcher for the target group directory.
- [ ] Implement upload logic: check manifest -> upload -> update manifest.
- [ ] Handle upload errors and retries.

## Phase 3: Verification & Polish

- [ ] End-to-end testing of the bidirectional loop.
- [ ] Test restart persistence.
- [ ] Refactor `watcher.js` for better organization (split sync logic into a separate module if needed).
