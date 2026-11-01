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

## Server data (`data/resonance-data.json`)

```json
{ "version": 1234, "updatedAt": "2026-11-01T12:00:00.000Z",
  "keys": { "resStoreV7": { "v": "<the JSON string>", "ver": 1230 }, ... } }
```

Backups in `data/backups/` (and `backupDir`) have the same shape and are named `resonance-YYYYMMDD-HHMM-<reason>.json`. The reason is one of `auto`, `shift`, `first`, `manual`, `shutdown`, `before-restore` or `conflict`.

## Personal data in the code

`HSA_TEAM_EMAILS` (`app.js` CONFIG) is **empty in the repository**. On the deployed copy, put the lab's Teams chat link and/or team e-mails there, or the team alert only copies the message. Owner e-mails for overdue work are guessed as `firstname.lastname@seagate.com` and can be corrected in the app. Keep the repository internal.
