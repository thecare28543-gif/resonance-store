# Data

## Files the lab imports (Data Entry → Import)

### Store file (`RESONANCE_STORE_<date>_Team <crew>.xlsx` or `.csv`)
The lab's Excel workbook has 3 sheets: a layout map, a pivot, and the data sheet ("เพิ่มแถว กรอกข้อมูล"). The importer scans **every sheet** for the row that holds the column headers, so sheet order and title rows don't matter. Rows that only carry a location (placeholder rows) are skipped.

Columns (`STORE_COLS` in `app.js`; the spelling `QUANITY` is the company's and is kept on purpose):

| Column | Example | Notes |
|---|---|---|
| RACK | `A` | A or B |
| SIDE | `L` | L or R |
| FLOOR | `2` | 1 (bottom) to 3 |
| CELL | `IN` | IN or OUT |
| STORE_LOCATION | `A - L _ 2 - IN` | Human label; rebuilt from the 4 columns above if missing |
| ITEM | | Optional; the lab sheet has no ITEM column |
| PRODUCT | `DORADO` | |
| TYPE | `EVL` | Test type: WKL / EVL / QUL / FA / WKL_FA / N/A |
| JOB_NO | `RES_TK27_0355` | `N/A`, `-`, `NONE` = no job (museum / reference samples) |
| QUANITY | `8` | Pieces |
| Last_Editor | | Filled from the editor name in the top bar |
| REMARK | | |

Export adds 2 columns after these (`EXTRA_COLS`): `TESTER` (T1–T3, the bench the work came from) and `TRAY` (IM = 8 pieces / FOF = 32 pieces per tray, for the 3D view).

### Job report (`Report.csv`)
Exported from the lab's job system, ~2,000 rows. Matched to store rows by `Job No.` (normalised: upper case, spaces removed, `-` → `_`).
Columns used (`JOB_COLS`): Job No., Test Status, Work Week, Job Type, Group Name, Product, Requester Name, Description, Test Qty, Special Remark, Received Date, Completed Date, URL Package.
`Received Date` is in the form `04-Oct-26`. It drives "days in store" and the ageing colours.

## What the app stores (`localStorage`, one JSON string per key)

**Shared across PCs** (listed in `SHARED` in `sync.js`, stored on the server):

| Key | Content |
|---|---|
| `resStoreV7` | Array of store rows (columns above + `_id`, `TESTER`, `TRAY`) |
| `jobDetailV7` | Job report rows keyed by normalised Job No. |
| `disposeDataV7` | Decision per job: Pending / Return to Owner / Scrap / Other + detail |
| `lastUpdatedV7` | Time of the last import |
| `resLogV1`, `resLogSnapV1`, `resLogStartV1` | History log + snapshots for Time Machine, audit, forecast (kept 180 days, capped ~3 MB) |
| `resHoldV1` | Jobs on hold: `{ by, reason, at }` |
| `resHoldLogV1` | Every hold / release / blocked attempt |
| `resHoldAuditV1` | Roving audit results per shift |
| `resKaizenV1` | Kaizen dashboard: search timings, prevented mistakes |
| `resCycleV1` | Cycle count results |
| `resOwnerEmailV1` | Owner e-mail overrides |
| `resZoneV1` | Zone rules per position (defaults: `DEFAULT_ZONES`) |
| `resTrainV1` | Training record: every quiz attempt `{ at, name, empId, crew, trainer, score, total, passed, practical[], wrong[] }` |

**Per PC only:** UI state such as the current tab, theme, editor name, first-run tour seen, 3D ambience, notification settings, last tester/type picked, poka-yoke toggle (`resTabV1`, `resThemeV1`, `resEditorV1`, `resTourV1`, `resAmbV1`, `resNotifyV1`, `resNotifiedV1`, `resLastTesterV1`, `resLastTypeV1`, `resPokaV1`, `lastNotifiedKeyV7`). Sync bookkeeping: `rsSyncBase`, `rsSyncPending`.

**Renaming a key loses that data on every PC.** That is why the `V7` suffix was never changed. If the format must change, read the old key and migrate it in code.

## Server data (PostgreSQL, since 2026.11.11)

- `rs_kv(key, value, ver, updated_at, updated_by)` holds exactly the localStorage strings above (master copy); `rs_meta.version` is the global counter. `updated_by` is the GID of the person whose PC saved it.
- Readable copies rebuilt on every save (for reports — never edit): `store_rows` (from `resStoreV7`), `jobs` (`jobDetailV7`, every column in `detail`), `holds` (`resHoldV1`), `hold_log` (`resHoldLogV1`), `dispose_decisions` (`disposeDataV7`), `zones` (`resZoneV1`), `training_attempts` (`resTrainV1`).
- Views: `v_position_load` (pieces per position + status), `v_jobs_in_store` (job, owner, locations, on hold), `v_users`.
- Accounts: `app_users` (GID, name, role, crew, department, active, password hash), `user_sessions`, `login_log`, `user_admin_log`.

Backups (table `rs_backups`, and files in `backupDir` if set) keep the old file shape, so any backup can be restored from a file:
```json
{ "version": 1234, "updatedAt": "2026-11-01T12:00:00.000Z",
  "keys": { "resStoreV7": { "v": "<the JSON string>", "ver": 1230 }, ... } }
```
They are named `resonance-YYYYMMDD-HHMMSS-<reason>.json`; the reason is one of `auto`, `shift`, `first`, `manual`, `shutdown`, `before-restore` or `conflict`.

## Personal data in the code

`app.js` (CONFIG, `HSA_TEAM_EMAILS`) holds a link to the lab's Teams chat and a commented-out list of team e-mail addresses. Owner e-mails for overdue work are guessed as `firstname.lastname@seagate.com` and can be corrected in the app. Keep the repository internal.

The database holds staff names and GIDs (`app_users`) and log-in history with IP addresses (`login_log`): treat database dumps and backups as internal / confidential.
