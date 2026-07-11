# Milestone v1.1 Roadmap

## Phase 02: Local to WhatsApp Upload
**Goal:** Implement two-way sync — local file additions upload to WhatsApp, local deletions revoke WA messages, WA deletions delete local files, offline changes reconcile on startup
**Requirements:** TWO-WAY-SYNC
**Status:** Completed
**Success Criteria:**
- Files placed in the local folder are uploaded to WhatsApp with filename as caption
- Deleting a local file revokes the corresponding WhatsApp message
- Revoking a WhatsApp message deletes the corresponding local file
- Offline changes (additions, deletions, revocations) are reconciled on startup
- Upload rate limiting prevents WhatsApp bans
- Large files (>64MB) are skipped gracefully
