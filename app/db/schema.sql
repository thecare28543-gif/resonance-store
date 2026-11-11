/* =====================================================================
   RESONANCE STORE · PostgreSQL schema (PostgreSQL 13+; tested on 18)
   Run once in pgAdmin 4: Tools → Query Tool on the database "resonance_store" → open this file → Execute (F5).
   Safe to run again: every object is created only if it is missing.

   How the data is kept
   - rs_kv is the master copy. The web app syncs whole data sets ("keys") through it, exactly like the old JSON file,
     so the 3-way merge in sync.js and offline work stay the same. rs_meta.version goes up by 1 on every save.
   - store_rows, jobs, holds, hold_log, dispose_decisions, zones and training_attempts are readable copies that the
     function rs_refresh() rebuilds from rs_kv inside the same transaction as each save. Use them for reports,
     Power BI or pgAdmin queries. Do NOT edit them by hand: the next save overwrites them. Change data in the web app.
   - app_users, user_sessions, login_log and user_admin_log hold the login system.
   - rs_backups holds the automatic backups (every hour with changes, every shift change, manual, before restore).
   ===================================================================== */

/* ---------------- login ---------------- */
CREATE TABLE IF NOT EXISTS app_users (
  gid                   varchar(20)  PRIMARY KEY CHECK (gid ~ '^[A-Z0-9._-]{2,20}$'),   -- employee GID, stored upper-case
  full_name             varchar(120) NOT NULL,
  role                  varchar(10)  NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'viewer')),
  crew                  varchar(10),                                   -- shift crew A / B / C (optional)
  department            varchar(80),
  active                boolean      NOT NULL DEFAULT true,            -- false = cannot log in (keep the row for history)
  password_hash         text,                                          -- scrypt$N$r$p$salt$hash, never the password itself
  must_change_password  boolean      NOT NULL DEFAULT true,            -- true after an admin sets / resets the password
  failed_logins         integer      NOT NULL DEFAULT 0,
  locked_until          timestamptz,                                   -- 5 wrong passwords = locked 15 minutes
  last_login_at         timestamptz,
  created_at            timestamptz  NOT NULL DEFAULT now(),
  created_by            varchar(20),
  updated_at            timestamptz  NOT NULL DEFAULT now(),
  updated_by            varchar(20)
);
COMMENT ON TABLE app_users IS 'Who may open the Resonance Store web. role: admin = everything + manage users, user = normal store work, viewer = read only.';

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash    char(64)     PRIMARY KEY,                              -- sha256 of the cookie value
  gid           varchar(20)  NOT NULL REFERENCES app_users(gid) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  expires_at    timestamptz  NOT NULL,                                 -- 12 h after log-in (one shift)
  last_seen_at  timestamptz  NOT NULL DEFAULT now(),
  ip            varchar(64),
  user_agent    varchar(300)
);
CREATE INDEX IF NOT EXISTS user_sessions_gid ON user_sessions (gid);

CREATE TABLE IF NOT EXISTS login_log (
  id          bigserial    PRIMARY KEY,
  at          timestamptz  NOT NULL DEFAULT now(),
  gid         varchar(20),
  ok          boolean      NOT NULL,
  reason      varchar(60),                                             -- ok / wrong password / locked / inactive / unknown gid / logout
  ip          varchar(64),
  user_agent  varchar(300)
);
CREATE INDEX IF NOT EXISTS login_log_at ON login_log (at DESC);

CREATE TABLE IF NOT EXISTS user_admin_log (
  id          bigserial    PRIMARY KEY,
  at          timestamptz  NOT NULL DEFAULT now(),
  admin_gid   varchar(20),
  target_gid  varchar(20),
  action      varchar(30)  NOT NULL,                                   -- add / edit / reset-password / import / setup
  detail      jsonb
);

/* ---------------- shared app data (master copy) ---------------- */
CREATE TABLE IF NOT EXISTS rs_meta (
  id          smallint     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version     bigint       NOT NULL DEFAULT 0,
  updated_at  timestamptz
);
INSERT INTO rs_meta (id, version) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS rs_kv (
  key         varchar(40)  PRIMARY KEY,                                -- resStoreV7, jobDetailV7, resHoldV1 …
  value       text,                                                    -- JSON text as the web app writes it; NULL = deleted
  ver         bigint       NOT NULL,                                   -- rs_meta.version of the save that wrote it
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  updated_by  varchar(20)                                              -- GID of the user whose PC saved it
);
CREATE INDEX IF NOT EXISTS rs_kv_ver ON rs_kv (ver);

CREATE TABLE IF NOT EXISTS rs_backups (
  id          bigserial    PRIMARY KEY,
  name        varchar(80)  NOT NULL UNIQUE,                            -- resonance-20261111-1800-shift.json
  reason      varchar(20)  NOT NULL,                                   -- auto / shift / manual / first / before-restore / conflict / shutdown
  created_at  timestamptz  NOT NULL DEFAULT now(),
  created_by  varchar(20),
  size_bytes  integer      NOT NULL,
  data        jsonb        NOT NULL                                    -- { version, keys: { key: value } }
);
CREATE INDEX IF NOT EXISTS rs_backups_created ON rs_backups (created_at DESC);

/* ---------------- readable copies (rebuilt by rs_refresh, read only) ---------------- */
CREATE TABLE IF NOT EXISTS store_rows (
  row_id          varchar(40)  PRIMARY KEY,                            -- _id in the app
  rack            varchar(5),                                          -- A / B
  side            varchar(5),                                          -- L (aisle side) / R (wall side)
  floor           varchar(5),                                          -- 1 = bottom shelf
  cell            varchar(5),                                          -- IN / OUT
  store_location  varchar(40),
  item            varchar(120),
  product         varchar(80),
  test_type       varchar(20),                                         -- WKL / EVL / QUL / FA / WKL_FA / N/A  (TYPE in the app)
  tray            varchar(10),                                         -- IM / FOF
  job_no          varchar(60),
  quantity        integer,                                             -- QUANITY in the app (spelling kept there on purpose)
  tester          varchar(10),                                         -- T1 / T2 / T3 = Tester 01 / 02 / 03
  last_editor     varchar(120),
  remark          text,
  synced_at       timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_rows_job ON store_rows (job_no);
CREATE INDEX IF NOT EXISTS store_rows_pos ON store_rows (rack, side, floor, cell);

CREATE TABLE IF NOT EXISTS jobs (
  job_no          varchar(60)  PRIMARY KEY,
  requester       varchar(120),
  product         varchar(80),
  description     text,
  test_status     varchar(60),
  received_date   varchar(30),                                         -- as in Report.csv, e.g. 04-Oct-26
  detail          jsonb        NOT NULL,                               -- every column of the Job Detail row
  synced_at       timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holds (
  job_no     varchar(60)  PRIMARY KEY,
  held_by    varchar(120),
  reason     text,
  held_at    timestamptz,
  synced_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hold_log (
  id         bigserial    PRIMARY KEY,
  at         timestamptz,
  action     varchar(20),                                              -- hold / release / block
  job_no     varchar(60),
  editor     varchar(120),
  by_name    varchar(120),                                             -- who put on hold / approver of the release
  reason     text,
  detail     jsonb
);
CREATE INDEX IF NOT EXISTS hold_log_job ON hold_log (job_no);

CREATE TABLE IF NOT EXISTS dispose_decisions (
  job_no     varchar(60)  PRIMARY KEY,
  status     varchar(40),                                              -- Pending / Return to Owner / Scrap / Other
  detail     text,
  synced_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zones (
  pos_key    varchar(20)  PRIMARY KEY,                                 -- A|L|2|IN
  rack       varchar(5), side varchar(5), floor varchar(5), cell varchar(5),
  products   text[],                                                   -- {'*'} = any product
  types      text[],
  is_hold    boolean      NOT NULL DEFAULT false,
  note       text
);

CREATE TABLE IF NOT EXISTS training_attempts (
  attempt_id  varchar(40)  PRIMARY KEY,
  at          timestamptz,
  name        varchar(120),
  emp_id      varchar(40),
  crew        varchar(10),
  trainer     varchar(120),
  score       integer,
  total       integer,
  passed      boolean,
  detail      jsonb
);

/* ---------------- rebuild one readable table from rs_kv ---------------- */
CREATE OR REPLACE FUNCTION rs_refresh(p_key text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v jsonb;
BEGIN
  SELECT CASE WHEN value IS NULL OR value = '' THEN NULL ELSE value::jsonb END INTO v FROM rs_kv WHERE key = p_key;

  IF p_key = 'resStoreV7' THEN
    DELETE FROM store_rows;
    IF jsonb_typeof(v) = 'array' THEN
      INSERT INTO store_rows (row_id, rack, side, floor, cell, store_location, item, product, test_type, tray, job_no, quantity, tester, last_editor, remark)
      SELECT DISTINCT ON (r->>'_id') r->>'_id', r->>'RACK', r->>'SIDE', r->>'FLOOR', r->>'CELL', r->>'STORE_LOCATION', r->>'ITEM', r->>'PRODUCT', r->>'TYPE',
             r->>'TRAY', r->>'JOB_NO', CASE WHEN (r->>'QUANITY') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN round((r->>'QUANITY')::numeric)::int END,
             r->>'TESTER', r->>'Last_Editor', r->>'REMARK'
      FROM jsonb_array_elements(v) r WHERE jsonb_typeof(r) = 'object' AND coalesce(r->>'_id', '') <> '';
    END IF;

  ELSIF p_key = 'jobDetailV7' THEN
    DELETE FROM jobs;
    IF jsonb_typeof(v) = 'object' THEN
      INSERT INTO jobs (job_no, requester, product, description, test_status, received_date, detail)
      SELECT e.key, e.value->>'Requester Name', e.value->>'Product', e.value->>'Description', e.value->>'Test Status', e.value->>'Received Date', e.value
      FROM jsonb_each(v) e WHERE jsonb_typeof(e.value) = 'object';
    END IF;

  ELSIF p_key = 'resHoldV1' THEN
    DELETE FROM holds;
    IF jsonb_typeof(v) = 'object' THEN
      INSERT INTO holds (job_no, held_by, reason, held_at)
      SELECT e.key, e.value->>'by', e.value->>'reason',
             CASE WHEN (e.value->>'at') ~ '^\d{4}-\d{2}-\d{2}' THEN (e.value->>'at')::timestamptz END
      FROM jsonb_each(v) e WHERE jsonb_typeof(e.value) = 'object';
    END IF;

  ELSIF p_key = 'resHoldLogV1' THEN
    DELETE FROM hold_log;
    IF jsonb_typeof(v) = 'array' THEN
      INSERT INTO hold_log (at, action, job_no, editor, by_name, reason, detail)
      SELECT CASE WHEN (r->>'t') ~ '^[0-9]+$' THEN to_timestamp((r->>'t')::bigint / 1000.0) END,
             r->>'a', r->>'job', r->>'ed', r->>'by', r->>'reason', r
      FROM jsonb_array_elements(v) r WHERE jsonb_typeof(r) = 'object';
    END IF;

  ELSIF p_key = 'disposeDataV7' THEN
    DELETE FROM dispose_decisions;
    IF jsonb_typeof(v) = 'object' THEN
      INSERT INTO dispose_decisions (job_no, status, detail)
      SELECT e.key, e.value->>'status', e.value->>'detail' FROM jsonb_each(v) e WHERE jsonb_typeof(e.value) = 'object';
    END IF;

  ELSIF p_key = 'resZoneV1' THEN
    DELETE FROM zones;
    IF jsonb_typeof(v) = 'object' THEN
      INSERT INTO zones (pos_key, rack, side, floor, cell, products, types, is_hold, note)
      SELECT e.key, split_part(e.key, '|', 1), split_part(e.key, '|', 2), split_part(e.key, '|', 3), split_part(e.key, '|', 4),
             CASE WHEN jsonb_typeof(e.value->'prod') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(e.value->'prod')) END,
             CASE WHEN jsonb_typeof(e.value->'type') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(e.value->'type')) END,
             coalesce((e.value->>'hold')::boolean, false), e.value->>'note'
      FROM jsonb_each(v) e WHERE jsonb_typeof(e.value) = 'object';
    END IF;

  ELSIF p_key = 'resTrainV1' THEN
    DELETE FROM training_attempts;
    IF jsonb_typeof(v->'attempts') = 'array' THEN
      INSERT INTO training_attempts (attempt_id, at, name, emp_id, crew, trainer, score, total, passed, detail)
      SELECT DISTINCT ON (r->>'id') r->>'id', CASE WHEN (r->>'at') ~ '^[0-9]+$' THEN to_timestamp((r->>'at')::bigint / 1000.0) END,
             r->>'name', r->>'empId', r->>'crew', r->>'trainer',
             CASE WHEN (r->>'score') ~ '^[0-9]+$' THEN (r->>'score')::int END, CASE WHEN (r->>'total') ~ '^[0-9]+$' THEN (r->>'total')::int END,
             (r->>'passed')::boolean, r
      FROM jsonb_array_elements(v->'attempts') r WHERE jsonb_typeof(r) = 'object' AND coalesce(r->>'id', '') <> '';
    END IF;
  END IF;
EXCEPTION WHEN others THEN
  /* a readable copy must never block a save: the master copy in rs_kv is already written */
  RAISE WARNING 'rs_refresh(%) skipped: %', p_key, SQLERRM;
END $$;

/* ---------------- handy views for reports ---------------- */
CREATE OR REPLACE VIEW v_position_load AS
SELECT rack, side, floor, cell, count(*) AS rows, sum(quantity) AS pieces,
       CASE WHEN sum(quantity) >= 80 THEN 'OVER LIMIT' WHEN sum(quantity) >= 64 THEN 'WARNING' ELSE 'NORMAL' END AS status
FROM store_rows GROUP BY rack, side, floor, cell ORDER BY rack, side, floor, cell;

CREATE OR REPLACE VIEW v_jobs_in_store AS
SELECT s.job_no, min(j.requester) AS requester, min(coalesce(j.product, s.product)) AS product, min(j.test_status) AS test_status,
       sum(s.quantity) AS pieces, string_agg(DISTINCT s.store_location, ', ') AS locations,
       bool_or(h.job_no IS NOT NULL) AS on_hold, min(d.status) AS dispose_status
FROM store_rows s
LEFT JOIN jobs j ON j.job_no = s.job_no
LEFT JOIN holds h ON h.job_no = s.job_no
LEFT JOIN dispose_decisions d ON d.job_no = s.job_no
WHERE coalesce(s.job_no, '') <> '' GROUP BY s.job_no ORDER BY s.job_no;

CREATE OR REPLACE VIEW v_users AS
SELECT gid, full_name, role, crew, department, active, last_login_at, created_at, created_by,
       (locked_until IS NOT NULL AND locked_until > now()) AS locked
FROM app_users ORDER BY active DESC, role, full_name;
