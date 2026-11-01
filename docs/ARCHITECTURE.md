# Architecture

## The pieces

```
 Lab PC (Edge)                                   Server (Node.js 18+)
 ┌───────────────────────────────────────┐       ┌──────────────────────────────┐
 │ RESONANCE_STORE.html                  │       │ server.js                    │
 │  ├ sync.js   (loads first)            │ HTTP  │  ├ serves the app files      │
 │  │   pulls shared data → localStorage │◄─────►│  ├ /api/data  (one shared    │
 │  │   pushes every change, polls 5 s   │       │  │   copy of all data)       │
 │  ├ app.js    (the whole UI)           │       │  └ backups: hourly + shift   │
 │  │   reads / writes localStorage      │       │      change → data/backups   │
 │  └ sw.js     (offline cache)          │       │      + optional OneDrive dir │
 └───────────────────────────────────────┘       └──────────────────────────────┘
```

- **`app.js`** is the application: tabs, KPIs, 2D rack map, 3D store (three.js), import/export, hold, pick list, reports, Kaizen dashboard. It only knows `localStorage`. It has no idea a server exists.
- **`sync.js`** sits between `app.js` and the server. It wraps `localStorage.setItem`: every write to a **shared key** is queued and sent with `PUT api/data`. Every 5 s it polls `GET api/data?since=<version>` and writes other PCs' changes into `localStorage`. It then fires a `storage` event, which `app.js` already handles by reloading its state.
- **`sw.js`** is a service worker that caches the app files, so the page still opens when the server is down. It only works on `https` or `localhost`.
- **`server.js`** keeps `data/resonance-data.json` with a global version counter and takes the backups. The full API contract is in `DEPLOY.md`.

## Modes (shown in the status chip in the top bar)

| Mode | When | Behaviour |
|---|---|---|
| `local` | Page opened as a file (`file://`) | This PC only, like the original dashboard. |
| `online` | Server reachable | All PCs see the same data within ~5 s. |
| `offline` | Server stopped answering | Keeps working on this PC, queues changes (`rsSyncPending`), sends them when the server is back. |

**Conflicts:** two PCs change the same key from the same base version. The second `PUT` gets `409`, its copy is saved on the server as a `…-conflict.json` backup, and the PC takes the server's version. Nothing is silently lost.

## Data lives in `localStorage` keys

Each key holds a JSON string. The keys listed in `SHARED` at the top of `sync.js` are synced across PCs. All other keys stay on each PC. Details are in `DATA.md`.

**If you add a new key that must be the same on every PC, add it to `SHARED` in `sync.js`.** Otherwise it silently stays per-PC.

## The physical store the code models

- **Racks and positions:** 2 racks (A, B), each with 2 sides (L, R) × 3 floors × 2 cells (IN, OUT), giving **24 positions**. Each position holds at most **80 pieces** (`LIMIT`).
- **Sides and access:** the two racks face each other across one aisle. A-R and B-L are reached from the aisle. A-L is reached from behind rack A, and B-R from beyond rack B. On every shelf, OUT is the half towards T1 and IN is the half towards the back of the room. The comments at `zoneXZ` and `walkPath` in the 3D section are the reference.
- **Testers:** 3 test benches, T1–T3. Operators carry trays from a bench to the racks. The 3D room geometry (`GEO`, in the 3D section) is in metres and also drives the walking-distance logic in "smart slot" and the pick list.
- **Zones:** each position can be bound to a Product and a Type. One position is the HOLD zone. Defaults are in `DEFAULT_ZONES`, and users can change them in the app (Zone Setup). Their changes are stored in `resZoneV1`.
- **Hold:** a held job cannot be scrapped, picked out or deleted. Hold needs a name and a reason; release needs an approver and a reason. Every hold, release and blocked attempt is logged (`resHoldLogV1`) and shown in the Audit Log.

## Things that look like features but are not in use yet

QR labels and scanning (`QR LABELS`, `SCAN`, `POKA-YOKE` sections) are implemented. They are **not used in the lab yet**: the lab is still choosing a scanner that meets clean-room rules. Keep the code; it is the planned next phase.

## No login

There is no authentication. The editor name typed in the top bar goes into `Last_Editor` and the logs. The app is meant for the intranet only. Add SSO or IP restrictions at the reverse proxy if required (see `DEPLOY.md`).
