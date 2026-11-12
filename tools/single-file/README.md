# Single-file build (no server)

Builds ONE self-contained HTML of the app (`RESONANCE_STORE_ไฟล์เดียว.html`): styles, the 5 libraries, app.js, sync.js,
the training PDF, the 3D log-in screen from `login.html`, and a snapshot of the store data + user list are all inside.
It opens by double-click (file://), works offline, and keeps its data in that browser's localStorage.

- Log-in is the same rule as the server (User = GID, Password = GID, roles admin / user / viewer, 5 wrong = 15 min lock),
  done in the browser by `local_auth.js`. It keeps casual users out and records who did what; **it is not real security**
  (the file can be read). The real, shared system is the server version in `app/`.
- Admins manage users from the user menu (add, edit, deactivate, unlock, delete, import Excel/CSV, export CSV, log-in log).

## Build
1. Export the current data and users from PostgreSQL (these files hold real data: never commit them):
   ```
   psql -h localhost -U rs_app -d resonance_store -At -o data.json  -c "select json_build_object('at', now(), 'keys', json_object_agg(key, value)) from rs_kv"
   psql -h localhost -U rs_app -d resonance_store -At -o users.json -c "select json_agg(json_build_object('gid',gid,'name',full_name,'role',role,'crew',coalesce(crew,''),'dept',coalesce(department,''),'active',active) order by gid) from app_users"
   ```
2. `node build_single.js <app folder> data.json RESONANCE_STORE_ไฟล์เดียว.html users.json`
   (the training PDF must be in the app folder; it is not in the repository)

## Test (Edge + playwright-core, e.g. `NODE_PATH` of the resonance-webtest skill)
- `node test_single.js RESONANCE_STORE_ไฟล์เดียว.html` - opens offline, data seeded, libraries, PDF links
- `node test_login.js RESONANCE_STORE_ไฟล์เดียว.html` - 19 checks: log-in, user admin, viewer block, lock-out (needs users.json next to it)
