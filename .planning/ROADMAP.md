# Roadmap: whatsapp-sync

## Phase 1: watcher.js Simplification

Rewrite `watcher.js` to implement the new unidirectional sync pipelines, dropping complex sync folder features and replacing them with simple "send me" -> `in` and `out` -> "receive me" transfers. Update `watcher.js` tests as well.

**Covered Requirements:**
- SYNC-01
- SYNC-02
- SYNC-03
- SYNC-04
- SYNC-05
- SYNC-06
- SYNC-07

## Phase 2: Standalone NPM Package Migration

Migrate the project structure to a standalone NPM project by cleaning up library source files and configuring dependencies.

**Covered Requirements:**
- PKG-01
- PKG-02
- PKG-03
- PKG-04
