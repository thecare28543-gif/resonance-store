# Changelog

Newest first. One line per release: date · who · what · why.

## 2026-11-01 · Sirinya Mungjuntuek · training tab + hidden server
- New **อบรม** tab: hands-on checklist (5 skills, ticked by the trainer) + quiz (10 of 14 questions, pass 8/10), record per person and per crew, CSV export, printable sign-off sheet. Stored in `resTrainV1` (shared, backed up).
- Training manual PDF shown inside the อบรม tab (`app/training-manual.pdf`; open full screen or download). `server.js` now serves `.pdf` as `application/pdf`.
- `sw.js` cache bumped to v3 (manual cached for offline).
- `deploy/install-autostart`: the server now runs with no window under `run-server.vbs`, which restarts it within ~10 s if it stops (before, closing the console window stopped the server).

## 2026-11-01 · Sirinya Mungjuntuek · hand-over package
- First hand-over to the Dev team: app files, developer documentation, hand-over checklist.
- State of the app:
  - In daily use in the HSA Resonance lab: 3D store, smart slot, pick list, Hold block, roving audit, Kaizen dashboard.
  - Server sync and backups (`server.js`, `sync.js`) have been tested and are waiting for the Dev team to deploy them on a company server with https.
  - QR scanning is implemented but not in use; it is waiting for a clean-room approved scanner.
