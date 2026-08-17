# whatsapp-sync (Simplified watcher.js)

## Current Milestone: v4.0 Next Version
(Preparing for next iteration)

## What This Is

A simplified file synchronization integration that monitors specific WhatsApp groups and local folders. It downloads incoming files from the "send me" group to a local `in` folder and uploads outgoing files from a local `out` folder to the "receive me" group, cleaning up the source after each transfer. Uses `@whiskeysockets/baileys` instead of `whatsapp-web.js` for enhanced stability and rate-limit handling.

## Core Value

Reliable, unidirectional file transfers between WhatsApp and the local filesystem without complex bidirectional sync logic or race conditions.

## Requirements

### Validated

- [x] watcher.js listens for messages in the "send me" WhatsApp group.
- [x] Incoming files in "send me" are downloaded to `Documents/syncstaging/in`.
- [x] Downloaded files are subsequently deleted from the WhatsApp group.
- [x] watcher.js monitors the `Documents/syncstaging/out` local folder.
- [x] Files placed in the `out` folder are uploaded to the "receive me" WhatsApp group.
- [x] Uploaded files are subsequently deleted from the local `out` folder.
- [x] Existing `watcher.js` test coverage is updated to reflect this simplified logic.
- [x] REQ-PKG-01: The project directory only contains `whatsapp-sync` specific code.
- [x] REQ-PKG-02: `package.json` includes dependencies properly.
- [x] REQ-PKG-03: `watcher.js` imports libraries normally instead of local file paths.
- [x] MIGR-01: Removed whatsapp-web.js and installed Baileys — v3.0
- [x] MIGR-02: Rewrote watcher.js connection and authentication for Baileys — v3.0
- [x] MIGR-03: Implemented Baileys inbound sync — v3.0
- [x] MIGR-04: Implemented Baileys outbound sync — v3.0
- [x] MIGR-05: Updated E2E Playwright tests for Baileys — v3.0

### Active

(None yet — planning next milestone)

### Out of Scope

- Bidirectional file synchronization — Complexity not needed, replaced with distinct in/out flows.
- Race condition handling — Sync folder concepts removed.

## Context

The project moved away from a complex bidirectional sync folder approach and replaced whatsapp-web.js with Baileys in v3.0 to provide a much more stable core. Features like rate-limiting, E2E tests, and graceful shutdown are now present.

## Constraints

- **Scope**: Code modifications — Restricted entirely to `watcher.js` and associated test files.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Unidirectional pipelines | Avoids race conditions and complex state management inherent in bidirectional sync. | ✓ Good |
| Distinct in/out WhatsApp groups | Simplifies routing and prevents looping. | ✓ Good |
| Migrate to Baileys | whatsapp-web.js was unstable and no longer maintained. Baileys provides a lighter WebSocket implementation. | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

---
*Last updated: 2026-08-17 after v3.0 milestone completion*
