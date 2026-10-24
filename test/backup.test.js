// test/backup.test.js — snapshots, restore check and the off-site copy script (pre-launch PR 5).
// Temporary data folders only. The off-site script runs with fake `age` and `rclone` (small bash
// scripts that record what they were asked to do): nothing is encrypted for real or leaves this computer.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'vornetic-test-'));
process.env.DATA_DIR = DATA;                 // db.js opens its database here when required
const { backup, pruneBackups, backupStatus, db } = require('../db');
const { check } = require('../scripts/restore-check');
const BACKUPS = path.join(DATA, 'backups');
test.after(() => { try { db.close(); } catch {} fs.rmSync(DATA, { recursive: true, force: true }); });

const slash = p => p.replace(/\\/g, '/');
const BASH = process.platform === 'win32' && fs.existsSync('C:/Program Files/Git/bin/bash.exe') ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const hasBash = spawnSync(BASH, ['-c', 'true']).status === 0;

// ---------- Snapshots ----------
test('snapshot: one per hour, written under a temporary name and renamed, usable', () => {
  const now = new Date();
  const file = backup(now);
  assert.match(path.basename(file), /^store-\d{4}-\d{2}-\d{2}T\d{2}\.db$/);
  assert.strictEqual(path.basename(file), `store-${now.toISOString().slice(0, 13)}.db`);
  assert.ok(!fs.readdirSync(BACKUPS).some(f => f.endsWith('.tmp')), 'no temporary file left');
  const r = check(file);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.counts.products > 0, 'it holds the shop');
  const before = fs.readdirSync(BACKUPS).length;
  backup(now);
  assert.strictEqual(fs.readdirSync(BACKUPS).length, before, 'same hour: not made twice');
});

test('snapshot: data written after the last one is in the next one (one an hour, not one a day)', () => {
  const t1 = new Date(Date.now() - 5 * 3600e3), t2 = new Date(Date.now() - 4 * 3600e3);   // two hours with no snapshot yet
  const a = backup(t1);
  db.prepare("INSERT INTO settings (key, value) VALUES ('backup_test_marker', 'later') ON CONFLICT(key) DO UPDATE SET value = 'later'").run();
  const b = backup(t2);
  const has = f => { const d = new DatabaseSync(f, { readOnly: true }); try { return !!d.prepare("SELECT 1 FROM settings WHERE key = 'backup_test_marker'").get(); } finally { d.close(); } };
  assert.notStrictEqual(a, b);
  assert.strictEqual(has(b), true, 'the newer snapshot has it');
});

test('retention: all of the last 48 hours, then the newest of each day for 30 days; old daily files too', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vornetic-test-'));
  try {
    const now = new Date('2026-10-24T12:30:00Z');
    const hourName = t => `store-${new Date(t).toISOString().slice(0, 13)}.db`;
    for (let h = 0; h < 96; h++) fs.writeFileSync(path.join(dir, hourName(now - h * 3600e3)), '');          // 4 days, hourly
    for (let d = 5; d < 45; d++) fs.writeFileSync(path.join(dir, `store-${new Date(now - d * 86400e3).toISOString().slice(0, 10)}.db`), '');  // old daily files
    fs.writeFileSync(path.join(dir, 'store-2026-10-01T00.db.tmp'), '');                                       // left by a stopped snapshot
    fs.utimesSync(path.join(dir, 'store-2026-10-01T00.db.tmp'), new Date(now - 7200e3), new Date(now - 7200e3));
    fs.writeFileSync(path.join(dir, 'offsite-last-ok'), '');                                                  // not a snapshot: untouched
    pruneBackups(dir, now);
    const left = fs.readdirSync(dir).filter(f => f.startsWith('store-')).sort();
    const hourly = left.filter(f => /T\d{2}\.db$/.test(f));
    const ages = hourly.map(f => (now - Date.parse(f.slice(6, 19) + ':00:00Z')) / 3600e3);
    assert.ok(ages.filter(a => a < 48).length === 48, 'every snapshot of the last 48 hours');
    const days = new Set(left.map(f => f.slice(6, 16)));
    const oldest = [...days].sort()[0];
    assert.ok((now - Date.parse(oldest + 'T00:00:00Z')) / 86400e3 < 30, 'nothing older than 30 days');
    for (const day of days) {
      const ofDay = left.filter(f => f.slice(6, 16) === day);
      const dayAge = (now - Date.parse(day + 'T23:59:59Z')) / 3600e3;
      if (dayAge > 48) assert.strictEqual(ofDay.length, 1, `one for ${day}`);
    }
    assert.ok(left.includes(`store-${new Date(now - 29 * 86400e3).toISOString().slice(0, 10)}.db`), 'an old daily file within 30 days is kept');
    assert.ok(!fs.existsSync(path.join(dir, 'store-2026-10-01T00.db.tmp')), 'stale temporary file removed');
    assert.ok(fs.existsSync(path.join(dir, 'offsite-last-ok')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('status for the admin: newest snapshot time; off-site copy never / recent / older than 48 hours', () => {
  backup();
  const st = backupStatus();
  assert.ok(st.snapshot_at && Date.now() - Date.parse(st.snapshot_at) < 60e3);
  assert.deepStrictEqual([st.offsite_at, st.offsite_stale], [null, true], 'never copied off the server');
  // a full backup an hour ago writes both markers
  fs.writeFileSync(path.join(BACKUPS, 'offsite-last-ok'), new Date(Date.now() - 3600e3).toISOString() + '\n');
  fs.writeFileSync(path.join(BACKUPS, 'offsite-full-last-ok'), new Date(Date.now() - 3600e3).toISOString() + '\n');
  assert.strictEqual(backupStatus().offsite_stale, false);
  fs.writeFileSync(path.join(BACKUPS, 'offsite-last-ok'), new Date(Date.now() - 49 * 3600e3).toISOString());
  fs.writeFileSync(path.join(BACKUPS, 'offsite-full-last-ok'), new Date(Date.now() - 49 * 3600e3).toISOString());
  assert.strictEqual(backupStatus().offsite_stale, true);
  fs.writeFileSync(path.join(BACKUPS, 'offsite-last-ok'), 'garbage');
  assert.deepStrictEqual([backupStatus().offsite_at, backupStatus().offsite_stale], [null, true]);
  fs.rmSync(path.join(BACKUPS, 'offsite-last-ok'));
  fs.rmSync(path.join(BACKUPS, 'offsite-full-last-ok'));
});

// ---------- restore-check ----------
test('restore-check: a good snapshot passes; garbage, a damaged file or missing tables fail (exit codes)', () => {
  const good = backup();
  const run = f => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'restore-check.js'), ...(f ? [f] : [])], { encoding: 'utf8' });
  const ok = run(good);
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^OK: .*\n  products \d+ · orders \d+/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vornetic-test-'));
  try {
    const garbage = path.join(dir, 'garbage.db'); fs.writeFileSync(garbage, 'not a database at all, just text');
    const damaged = path.join(dir, 'damaged.db');
    const bytes = fs.readFileSync(good); bytes.fill(0x41, 4096, 12288); fs.writeFileSync(damaged, bytes);   // overwrite pages 2–3
    const partial = path.join(dir, 'partial.db');
    const d = new DatabaseSync(partial); d.exec('CREATE TABLE products (id INTEGER)'); d.close();
    for (const f of [garbage, damaged, partial, path.join(dir, 'missing.db')]) {
      const r = run(f);
      assert.strictEqual(r.status, 1, `${path.basename(f)}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /NOT USABLE/);
    }
    assert.match(run(partial).stderr, /missing tables: settings/);
    assert.strictEqual(run().status, 2, 'no file given');
    assert.deepStrictEqual(fs.readFileSync(garbage, 'utf8'), 'not a database at all, just text', 'the file is never changed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- backup-offsite.sh with fake age / rclone ----------
function offsite({ args = [], env = {}, setup, relativeDataDir = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vornetic-test-'));
  const remote = path.join(dir, 'remote'), log = path.join(dir, 'rclone.log');
  const age = path.join(dir, 'fake-age'), rclone = path.join(dir, 'fake-rclone');
  fs.writeFileSync(age, `#!/usr/bin/env bash
# fake age: "-r KEY -o OUT"; writes a marker line, then the input unchanged (NOT real encryption)
r=""; o=""
while [ $# -gt 0 ]; do case "$1" in -r) r="$2"; shift 2;; -o) o="$2"; shift 2;; *) shift;; esac; done
if [ -n "\${FAKE_AGE_FAIL:-}" ]; then echo "fake age failure" >&2; exit 1; fi
{ printf 'FAKE-AGE %s\\n' "$r"; cat; } > "$o"
`, { mode: 0o755 });
  fs.writeFileSync(rclone, `#!/usr/bin/env bash
echo "$*" >> "$FAKE_RCLONE_LOG"
case "$1" in
  copy) if [ -n "\${FAKE_RCLONE_FAIL:-}" ]; then exit 1; fi; mkdir -p "$FAKE_REMOTE_DIR"; cp "$2" "$FAKE_REMOTE_DIR/";;
esac
`, { mode: 0o755 });
  const data = path.join(dir, 'data');
  fs.mkdirSync(path.join(data, 'backups'), { recursive: true });
  fs.mkdirSync(path.join(data, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(data, 'uploads', 'photo-1.jpg'), 'fake photo bytes');
  fs.copyFileSync(backup(), path.join(data, 'backups', `store-${new Date().toISOString().slice(0, 13)}.db`));
  fs.writeFileSync(path.join(data, 'backups', 'store-2026-01-01.db'), 'older daily file');   // older: never picked
  if (setup) setup(data);
  const conf = path.join(dir, 'backup.env');
  fs.writeFileSync(conf, 'AGE_RECIPIENT=age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs0w4kz\nRCLONE_REMOTE=fake:vornetic-backups\nBACKUP_KEEP_DAYS=30\n');
  const r = spawnSync(BASH, [slash(path.join(ROOT, 'scripts', 'backup-offsite.sh')), ...args], {
    encoding: 'utf8',
    cwd: dir,                                       // relativeDataDir: DATA_DIR=data, as an .env may say
    env: { ...process.env, BACKUP_CONF: slash(conf), DATA_DIR: relativeDataDir ? 'data' : slash(data), AGE_BIN: slash(age), RCLONE_BIN: slash(rclone),
      NODE_BIN: slash(process.execPath), FAKE_RCLONE_LOG: slash(log), FAKE_REMOTE_DIR: slash(remote), ...env },
  });
  const uploaded = fs.existsSync(remote) ? fs.readdirSync(remote) : [];
  const contents = name => {                        // list the archive inside a fake-encrypted upload
    const raw = fs.readFileSync(path.join(remote, name));
    const nl = raw.indexOf(10);
    const tgz = path.join(dir, 'payload.tgz'); fs.writeFileSync(tgz, raw.subarray(nl + 1));
    return { header: raw.subarray(0, nl).toString(), files: spawnSync(BASH, ['-c', `tar --force-local -tzf "${slash(tgz)}"`], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean) };
  };
  const result = { ...r, dir, data, uploaded, contents, log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '',
    ok: fs.existsSync(path.join(data, 'backups', 'offsite-last-ok')), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
  return result;
}

test('off-site: newest snapshot + photos, encrypted with the public key, uploaded, old copies pruned, success recorded', { skip: !hasBash && 'bash not available' }, () => {
  const r = offsite();
  try {
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /Off-site backup OK: vornetic-full-\d{8}T\d{6}Z\.tar\.gz\.age/);
    assert.strictEqual(r.uploaded.length, 1);
    const c = r.contents(r.uploaded[0]);
    assert.match(c.header, /^FAKE-AGE age1/, 'encrypted to the public key');
    assert.ok(c.files.some(f => /^store-\d{4}-\d{2}-\d{2}T\d{2}\.db$/.test(f)), c.files.join());
    assert.ok(!c.files.includes('store-2026-01-01.db'), 'only the newest snapshot');
    assert.ok(c.files.some(f => /uploads\/photo-1\.jpg$/.test(f)), 'photos included');
    assert.match(r.log, /^copy .*vornetic-full-.*\.tar\.gz\.age fake:vornetic-backups$/m);
    assert.match(r.log, /^delete --min-age 30d --include vornetic-\*\.tar\.gz\.age fake:vornetic-backups$/m, 'only its own old files');
    assert.ok(r.ok, 'offsite-last-ok written');
  } finally { r.cleanup(); }
});

test('off-site --db-only: only the database snapshot', { skip: !hasBash && 'bash not available' }, () => {
  const r = offsite({ args: ['--db-only'] });
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.uploaded[0], /^vornetic-db-/);
    const files = r.contents(r.uploaded[0]).files;
    assert.ok(!files.some(f => f.includes('uploads')), files.join());
    assert.strictEqual(files.length, 1);
  } finally { r.cleanup(); }
});

test('off-site never uploads unencrypted or bad backups: missing/wrong key, encryption or upload failure, damaged or old snapshot', { skip: !hasBash && 'bash not available' }, () => {
  const cases = {
    'no public key': { env: { BACKUP_CONF: '/nonexistent', AGE_RECIPIENT: '', RCLONE_REMOTE: 'fake:x' } },
    'a private key instead': { env: { BACKUP_CONF: '/nonexistent', AGE_RECIPIENT: 'AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQ', RCLONE_REMOTE: 'fake:x' } },
    'no remote': { env: { BACKUP_CONF: '/nonexistent', AGE_RECIPIENT: 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs0w4kz', RCLONE_REMOTE: '' } },
    'encryption fails': { env: { FAKE_AGE_FAIL: '1' } },
    'upload fails': { env: { FAKE_RCLONE_FAIL: '1' } },
    'damaged snapshot': { setup: d => { const f = fs.readdirSync(path.join(d, 'backups')).filter(n => /T\d{2}\.db$/.test(n))[0]; fs.writeFileSync(path.join(d, 'backups', f), 'broken'); } },
    'snapshot 4 hours old (shop not running)': { setup: d => { for (const f of fs.readdirSync(path.join(d, 'backups'))) { const t = new Date(Date.now() - 4 * 3600e3); fs.utimesSync(path.join(d, 'backups', f), t, t); } } },
    'no snapshot at all': { setup: d => { for (const f of fs.readdirSync(path.join(d, 'backups'))) fs.rmSync(path.join(d, 'backups', f)); } },
    'unknown option': { args: ['--everything'] },
  };
  for (const [name, opts] of Object.entries(cases)) {
    const r = offsite(opts);
    try {
      assert.notStrictEqual(r.status, 0, `${name}: should fail\n${r.stdout}${r.stderr}`);
      assert.ok(!r.ok, `${name}: success must not be recorded`);
      if (name !== 'upload fails') assert.deepStrictEqual(r.uploaded, [], `${name}: nothing uploaded`);
      if (name !== 'unknown option') assert.match(r.stderr, /OFF-SITE BACKUP FAILED/, name);
    } finally { r.cleanup(); }
  }
});

test('admin panel data: /api/admin/me reports the snapshot made at start; no warning outside production', async () => {
  const { startServer } = require('./helpers');
  const srv = await startServer();
  try {
    const b = (await srv.admin('GET', '/api/admin/me')).body.backup;
    assert.ok(b.snapshot_at && Date.now() - Date.parse(b.snapshot_at) < 120e3, JSON.stringify(b));
    assert.deepStrictEqual([b.offsite_at, b.offsite_stale, b.warn], [null, true, false], 'stale, but the warning is for production only');
    assert.ok(fs.readdirSync(path.join(srv.dataDir, 'backups')).some(f => /^store-\d{4}-\d{2}-\d{2}T\d{2}\.db$/.test(f)));
  } finally { await srv.stop(); }
});

// ---------- Codex findings on 73840d3 ----------
test('off-site: a relative DATA_DIR (e.g. "data") works for the full backup too', { skip: !hasBash && 'bash not available' }, () => {
  const r = offsite({ relativeDataDir: true });
  try {
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    const files = r.contents(r.uploaded[0]).files;
    assert.ok(files.some(f => /^store-.*T\d{2}\.db$/.test(f)) && files.some(f => /uploads\/photo-1\.jpg$/.test(f)), files.join());
  } finally { r.cleanup(); }
});

test('off-site: hourly database-only successes do not hide a failing nightly full backup', { skip: !hasBash && 'bash not available' }, () => {
  const marker = (r, f) => fs.existsSync(path.join(r.data, 'backups', f));
  const db = offsite({ args: ['--db-only'] });
  try {
    assert.strictEqual(db.status, 0, db.stderr);
    assert.ok(marker(db, 'offsite-last-ok'), 'database copy recorded');
    assert.ok(!marker(db, 'offsite-full-last-ok'), 'but not as a full backup');
  } finally { db.cleanup(); }
  const full = offsite();
  try {
    assert.strictEqual(full.status, 0, full.stderr);
    assert.ok(marker(full, 'offsite-last-ok') && marker(full, 'offsite-full-last-ok'), 'a full backup records both');
  } finally { full.cleanup(); }
  const failed = offsite({ env: { FAKE_RCLONE_FAIL: '1' } });
  try { assert.ok(!marker(failed, 'offsite-full-last-ok'), 'a failed full backup records nothing'); } finally { failed.cleanup(); }
});

test('status: the warning follows the last FULL off-site backup (database + photos), not just any upload', () => {
  const write = (f, t) => fs.writeFileSync(path.join(BACKUPS, f), new Date(t).toISOString());
  const rm = f => fs.rmSync(path.join(BACKUPS, f), { force: true });
  try {
    write('offsite-last-ok', Date.now() - 600e3);                     // database copied 10 minutes ago…
    let st = backupStatus();
    assert.deepStrictEqual([st.offsite_full_at, st.offsite_stale], [null, true], '…but never a full backup: warn');
    write('offsite-full-last-ok', Date.now() - 60 * 3600e3);          // last full one 60 hours ago
    st = backupStatus();
    assert.ok(st.offsite_full_at);
    assert.strictEqual(st.offsite_stale, true, 'nightly full backup failing for 2 days: warn');
    write('offsite-full-last-ok', Date.now() - 20 * 3600e3);
    assert.strictEqual(backupStatus().offsite_stale, false, 'recent full backup and recent database copy: fine');
    write('offsite-last-ok', Date.now() - 50 * 3600e3);
    assert.strictEqual(backupStatus().offsite_stale, true, 'no copy at all for 50 hours: warn');
  } finally { rm('offsite-last-ok'); rm('offsite-full-last-ok'); }
});
