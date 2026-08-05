/* Validate scripts/rebuild-employee-days.js using the in-memory prisma mock.
 *
 * Scenario (real employee 1303, tenant 2): the heuristic repair split the
 * 31-07 night shift (17:31 → 02:40 next day) at its largest gap into
 * "17:31 → open" + a bogus "02:40 → 09:02" sheet, and left 03-08's
 * 09:36/22:52 punches as two open sheets. The rebuild replays the RAW device
 * logs through the punch processor, which must recover the true pairing:
 *   07-31: 17:31 → 02:40 (9h09m night shift)
 *   08-01: 09:02 → 18:16
 *   08-02: 09:34 → 20:07
 *   08-03: 09:36 → 22:52
 *   08-05: 09:33 → open
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MOCK = path.join(__dirname, 'mock_prisma.js');
const DUMP = path.join(__dirname, '.mock-store.json');

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
    if (cond) pass++; else { fail++; console.log(`FAIL ${label} ${extra}`); }
};

const state = () => JSON.parse(fs.readFileSync(DUMP, 'utf8'));
const emp43Sheets = () => state().entries.filter(([, t]) => t.employeeId === 43 && t.tenantId === 2).map(([, t]) => t);
const byDate = (date) => emp43Sheets().find(t => t.date === date + 'T00:00:00.000Z');

const reset = () => { try { fs.unlinkSync(DUMP); } catch {} };
const run = (script, args) => execFileSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: `--require ${MOCK}`, MOCK_DUMP: DUMP },
});

reset();
require(MOCK);

// ── 1. DRY RUN: prints the plan, touches nothing ──
const before = emp43Sheets().length;
const dryOut = run('scripts/rebuild-employee-days.js', ['1303', '--since', '2026-07-25']);
ok('dry-run prints raw log count', dryOut.includes('Raw device logs in window: 20'), dryOut.slice(-600));
ok('dry-run prints sheets to replace', dryOut.includes('Device-sourced sheets in window (will be replaced): 9'));
ok('dry-run prints dry-run notice', dryOut.includes('Dry run'));
ok('dry-run leaves data untouched', emp43Sheets().length === before);

// ── 2. APPLY: rebuilds from raw logs ──
const applyOut = run('scripts/rebuild-employee-days.js', ['1303', '--since', '2026-07-25', '--apply']);
ok('apply succeeds', applyOut.includes('✅ Rebuilt'), applyOut.slice(-800));
ok('backup written', applyOut.includes('Backup written'));
const backupMatch = applyOut.match(/backups[\\/][^\s]+\.json/);
ok('backup path printed', !!backupMatch, applyOut.slice(-400));

// 9 wrong sheets replaced by 7 correct ones; the out-of-window 07-01
// repair-split row (meta.repair_split_from) must be left untouched.
ok('all wrong sheets replaced', emp43Sheets().length === 8, `got ${emp43Sheets().length}: ${emp43Sheets().map(t => t.date).join(', ')}`);
ok('out-of-window repair-split row survives rebuild', emp43Sheets().some(t => t.date === '2026-07-01T00:00:00.000Z' && t.meta && t.meta.repair_split_from === 12500), JSON.stringify(emp43Sheets().filter(t => t.date === '2026-07-01T00:00:00.000Z')));

// ── 3. VERIFY the exact pairing ──
const d28 = byDate('2026-07-28');
ok('07-28 in 09:38 IST', d28 && d28.inAt === '2026-07-28T04:08:48.000Z', d28 && d28.inAt);
ok('07-28 out 19:45 IST', d28 && d28.outAt === '2026-07-28T14:15:38.000Z', d28 && d28.outAt);

const d31 = byDate('2026-07-31');
ok('07-31 in 17:31 IST', d31 && d31.inAt === '2026-07-31T12:01:56.000Z', d31 && d31.inAt);
ok('07-31 out = 02:40 IST NEXT DAY (night shift closed)', d31 && d31.outAt === '2026-07-31T21:10:43.000Z', d31 && d31.outAt);

const d1 = byDate('2026-08-01');
ok('08-01 in 09:02 IST', d1 && d1.inAt === '2026-08-01T03:32:36.000Z', d1 && d1.inAt);
ok('08-01 out 18:16 IST', d1 && d1.outAt === '2026-08-01T12:46:47.000Z', d1 && d1.outAt);

const d2 = byDate('2026-08-02');
ok('08-02 in 09:34 IST', d2 && d2.inAt === '2026-08-02T04:04:38.000Z', d2 && d2.inAt);
ok('08-02 out 20:07 IST', d2 && d2.outAt === '2026-08-02T14:37:12.000Z', d2 && d2.outAt);

const d3 = byDate('2026-08-03');
ok('08-03 in 09:36 IST', d3 && d3.inAt === '2026-08-03T04:06:35.000Z', d3 && d3.inAt);
ok('08-03 out 22:52 IST (paired, not two open sheets)', d3 && d3.outAt === '2026-08-03T17:22:38.000Z', d3 && d3.outAt);

const d5 = byDate('2026-08-05');
ok('08-05 open (today)', d5 && d5.inAt === '2026-08-05T04:03:34.000Z' && d5.outAt === null, d5 && d5.inAt);

ok('all rebuilt sheets tagged rebuild_created', emp43Sheets().filter(t => t.date !== '2026-07-01T00:00:00.000Z').every(t => t.meta && t.meta.rebuild_created));

// ── 4. RESTORE: undo must bring back the 9 pre-rebuild sheets exactly ──
const backupPath = path.join(ROOT, backupMatch[0].replace(/\\/g, '/'));
const restoreOut = run('scripts/restore-repair.js', [backupPath, '--apply']);
ok('restore succeeds', restoreOut.includes('✅'), restoreOut.slice(-400));
ok('restore brings back 9 rows + keeps out-of-window row', emp43Sheets().length === 10, `got ${emp43Sheets().length}`);
ok('restore removes rebuild_created rows', emp43Sheets().every(t => !(t.meta && t.meta.rebuild_created)));
ok('restore KEEPS out-of-window repair_split_from row (not a rebuild backup casualty)', emp43Sheets().some(t => t.date === '2026-07-01T00:00:00.000Z' && t.meta && t.meta.repair_split_from === 12500));
const old31 = byDate('2026-07-31');
ok('restore brings back the original 31-07 open sheet', old31 && old31.outAt === null && old31.inAt === '2026-07-31T12:01:56.000Z', old31 && old31.outAt);

// Cleanup dump + test backups so future runs reseed.
try { fs.rmSync(path.join(ROOT, 'backups'), { recursive: true, force: true }); } catch {}
reset();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
