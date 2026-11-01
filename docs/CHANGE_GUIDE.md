# Change guide

## Common changes

| I want to… | Change this | Where |
|---|---|---|
| Change the 80-piece limit or the warning level | `LIMIT`, `WARN_AT`, `NEAR_FULL_RATIO` | `app.js` CONFIG |
| Add a rack side / floor / cell | `RACK_SIDES`, `FLOORS`, `CELLS` (CONFIG) **and** the 3D room `GEO` + `zoneXZ()` + `walkPath()` (3D STORE) **and** `DEFAULT_ZONES` | `app.js` |
| Change which product/type goes where | Usually nothing: users do it in the app (**Zone Setup**), which saves to `resZoneV1`. Change `DEFAULT_ZONES` only for the factory default. | `app.js` ZONES |
| Add a tester bench | `TESTERS` (CONFIG) and `GEO.BX` (bench x positions, 3D STORE) | `app.js` |
| Change the shift rotation | `SHIFT_PATTERN`, `SHIFT_BASE_DAY`, `SHIFT_BASE_IDX` (12-day cycle, anchor date) | `app.js` CONFIG |
| Change the team Teams link | `HSA_TEAM_EMAILS` | `app.js` CONFIG |
| Add / rename an import column | `STORE_COLS` / `EXTRA_COLS` / `JOB_COLS`. Keep old names readable so old files still import. | `app.js` CONFIG, IMPORT / EXPORT |
| Change disposal choices | `DISPOSE_OPTIONS` | `app.js` CONFIG |
| Add data that every PC must share | Add the `localStorage` key to `SHARED` | `sync.js` |
| Add a new file to the app | Add it to `FILES` and bump `CACHE` | `sw.js` |
| Server port / data folder / backup folder / retention | `server-config.json` (or env `PORT`, `RS_DATA_DIR`) | `app/` |
| Colours, fonts | CSS variables at the top of `styles.css` (light) and the dark block | `styles.css` |

## Release steps

1. Change the code in a branch.
2. Test locally: `node server.js`, open **two** browsers, and run the checklist below.
3. In `sw.js`, bump `CACHE` (for example `resonance-store-v1` → `-v2`), or the lab PCs keep serving the old files from cache.
4. Add a line to `CHANGELOG.md`: date, who, what, why.
5. Deploy: copy `app/` to the server, **except** `data/` and `server-config.json`, which belong to the server. Restart `node server.js` only if `server.js` changed.
6. Tell the lab. One reload (Ctrl+F5) on each PC picks up the new version.

**Before any release, take a manual backup** (status chip → Backup & Restore → 🛡 Backup ตอนนี้).

## Manual test checklist (there are no automated tests)

- [ ] Page opens with no errors in the console (F12).
- [ ] Import the store `.xlsx` and `Report.csv`. KPIs, 2D map and 3D show the data.
- [ ] Add work: smart slot suggests a position in the right zone; saving to a wrong zone or over 80 pieces is refused.
- [ ] Search a Job No. → the 3D view flies to its position.
- [ ] Put a job on Hold (name + reason). Try Scrap / pick / delete it → all refused and logged. Release needs an approver.
- [ ] Pick List: route shows, held jobs cannot be ticked, "remove from store" updates the data.
- [ ] Undo / redo the last change.
- [ ] Export → re-import the exported file → same data.
- [ ] Two browsers: a change in one appears in the other within ~5 s.
- [ ] Stop the server: the chip shows offline, edits still work. Start it again → queued edits are sent.
- [ ] Backup & Restore: backup now, restore it, data comes back.
- [ ] Dark mode, phone width, kiosk mode still look right.
