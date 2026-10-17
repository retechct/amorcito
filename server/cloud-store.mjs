import { neon } from '@neondatabase/serverless';

// Only this schema belongs to the application. No build ever resets its contents.
export const migrations = [
  'CREATE SCHEMA IF NOT EXISTS nosotros',
  `CREATE TABLE IF NOT EXISTS nosotros.archive (id integer PRIMARY KEY CHECK(id=1), revision integer NOT NULL, payload jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nosotros.settings (key text PRIMARY KEY, value jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nosotros.sessions (hash text PRIMARY KEY, role text NOT NULL, csrf text NOT NULL, expires bigint NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nosotros.limits (key text PRIMARY KEY, count integer NOT NULL DEFAULT 0, started bigint NOT NULL, blocked bigint NOT NULL DEFAULT 0, strikes integer NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS nosotros.assets (path text PRIMARY KEY, public_id text UNIQUE NOT NULL, resource_type text NOT NULL, format text NOT NULL, bytes bigint NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nosotros.uploads (id text PRIMARY KEY, session_hash text NOT NULL, resource_type text NOT NULL, expires bigint NOT NULL, path text)`,
  // The global row is locked first, so independent Vercel instances share one
  // atomic attempt counter. No read/modify/write race and no in-memory limits.
  `CREATE OR REPLACE FUNCTION nosotros.attempt(scope text, ip text, now_ms bigint, ip_max integer DEFAULT 5, global_max integer DEFAULT 30)
   RETURNS jsonb LANGUAGE plpgsql AS $$
   DECLARE k text; r nosotros.limits%ROWTYPE; wait_ms bigint; maximum integer; delay_ms bigint;
   BEGIN
     INSERT INTO nosotros.limits(key,started) VALUES(scope||':global',now_ms) ON CONFLICT DO NOTHING;
     PERFORM 1 FROM nosotros.limits WHERE key=scope||':global' FOR UPDATE;
     INSERT INTO nosotros.limits(key,started) VALUES(scope||':ip:'||ip,now_ms) ON CONFLICT DO NOTHING;
     PERFORM 1 FROM nosotros.limits WHERE key=scope||':ip:'||ip FOR UPDATE;
     SELECT greatest(0,max(blocked)-now_ms) INTO wait_ms FROM nosotros.limits WHERE key IN (scope||':global',scope||':ip:'||ip);
     IF wait_ms>0 THEN RETURN jsonb_build_object('allowed',false,'retryAfter',ceil(wait_ms/1000.0)); END IF;
     FOREACH k IN ARRAY ARRAY[scope||':global',scope||':ip:'||ip] LOOP
       SELECT * INTO r FROM nosotros.limits WHERE key=k;
       IF now_ms-r.started>86400000 THEN r.strikes:=0; END IF;
       IF now_ms-r.started>=900000 OR (r.blocked>0 AND now_ms>=r.blocked) THEN
         r.count:=0; r.started:=now_ms; r.blocked:=0;
       END IF;
       r.count:=r.count+1;
       maximum:=CASE WHEN k=scope||':global' THEN global_max ELSE ip_max END;
       IF r.count>=maximum THEN
         r.strikes:=r.strikes+1;
         delay_ms:=CASE WHEN k=scope||':global' THEN 900000 ELSE least(3600000,30000*power(4,least(r.strikes-1,4)))::bigint END;
         r.blocked:=now_ms+delay_ms;
       END IF;
       UPDATE nosotros.limits SET count=r.count,started=r.started,blocked=r.blocked,strikes=r.strikes WHERE key=k;
     END LOOP;
     SELECT greatest(0,max(blocked)-now_ms) INTO wait_ms FROM nosotros.limits WHERE key IN (scope||':global',scope||':ip:'||ip);
     RETURN jsonb_build_object('allowed',true,'retryAfter',ceil(wait_ms/1000.0));
   END $$`,
];

export function connectStore(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL no está configurada.');
  const sql = neon(url);
  return { query: (text, params = []) => sql.query(text, params),
    transaction: statements => sql.transaction(statements.map(([text, params = []]) => sql.query(text, params))) };
}

export async function migrate(store) {
  for (const statement of migrations) await store.query(statement);
}

export async function cooldown(store, scope, ip, now = Date.now()) {
  const [row] = await store.query('SELECT greatest(0,ceil((max(blocked)-$3)/1000.0)) AS wait FROM nosotros.limits WHERE key IN ($1,$2)', [scope+':global',scope+':ip:'+ip,now]);
  return Number(row.wait || 0);
}

export async function attempt(store, scope, ip, now = Date.now(), ipMax = 5, globalMax = 30) {
  const [row] = await store.query('SELECT nosotros.attempt($1,$2,$3,$4,$5) AS result',[scope,ip,now,ipMax,globalMax]);
  return row.result;
}

export async function getArchive(store) {
  const [row] = await store.query('SELECT revision,payload FROM nosotros.archive WHERE id=1');
  if (!row) return null;
  return {...row.payload, startDate:'2026-02-14T00:00:00-05:00', revision:row.revision};
}

export async function putAsset(store, asset) {
  await store.query(`INSERT INTO nosotros.assets(path,public_id,resource_type,format,bytes) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(path) DO NOTHING`, [asset.path,asset.public_id,asset.resource_type,asset.format,asset.bytes]);
}
