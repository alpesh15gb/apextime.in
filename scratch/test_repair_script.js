/* Validate scripts/repair-attendance-data.js (dry-run then --apply) using a
 * preloaded in-memory prisma mock (scratch/mock_prisma.js). */
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

const store = () => new Map(JSON.parse(fs.readFileSync(DUMP, 'utf8')).entries);
const reset = () => { try { fs.unlinkSync(DUMP); } catch {} };

const run = (args) => execFileSync(process.execPath, ['scripts/repair-attendance-data.js', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: `--require ${MOCK}`, MOCK_DUMP: DUMP },
});

// Seed fresh state (parent loads the mock once to create the seed file).
reset();
require(MOCK);
const seeded = store();

// ── 1. Dry run: must NOT modify the store ──
const snap = (s) => [...s.entries()].map(([id, t]) => ({ id, outAt: t.outAt || null }));
const before = snap(seeded);
const dryOut = run(['--tenant', '1']);
const after = snap(store());
ok('dry-run leaves data untouched', JSON.stringify(before) === JSON.stringify(after));
ok('dry-run prints plan', dryOut.includes('Changes planned:'), 'no plan section');
ok('dry-run prints report', dryOut.includes('Reported (not auto-fixed'), 'no report section');
ok('dry-run plans a merge', dryOut.includes('[merge_keep]'), 'no merge planned');
ok('dry-run plans a recompute', dryOut.includes('[recompute]'), 'no recompute planned');
ok('dry-run plans a mispunch split', dryOut.includes('[split_keep]'), 'no split planned');
ok('dry-run plans a new sheet from split', dryOut.includes('[split_create]'), 'no split_create planned');

// ── 2. Apply ──
const applyOut = run(['--tenant', '1', '--apply']);
ok('apply succeeds', applyOut.includes('✅'), applyOut.slice(-300));
ok('backup written', applyOut.includes('Backup written'));

const st = store();
const get = (id) => st.get(id);
ok('ts1 outAt recomputed to 18:00 IST', get(1).outAt === '2026-08-05T12:30:00.000Z', String(get(1).outAt));
ok('ts1 inAt kept 09:00 IST', get(1).inAt === '2026-08-05T03:30:00.000Z');
ok('ts2 deleted (merged into ts1)', !get(2));
ok('ts1 punches merged (2+1 deduped → 2)', get(1).punches.length === 2, JSON.stringify(get(1).punches));
ok('ts3 date fixed to 10th', get(3).date === '2026-08-10T00:00:00.000Z', String(get(3).date));
ok('ts4 untouched (outBeforeIn, no punches)', get(4).outAt < get(4).inAt);
ok('ts5 untouched (open 48h)', get(5).outAt === null);
// ts#6 was a 15h18m mispunch glue → after apply: original becomes open sheet
// (18:16 IST only), and a NEW sheet holds the 09:34 IST punch.
ok('ts6 split: original kept as open IN', get(6).outAt === null && get(6).inAt === '2026-08-05T12:46:00.000Z', JSON.stringify(get(6)));
const newSheet = [...st.values()].find(t => t.meta && t.meta.repair_split_from === 6);
ok('ts6 split: new sheet created for next-day punch', !!newSheet, 'no new sheet');
ok('ts6 split: new sheet inAt 09:34 IST', newSheet && newSheet.inAt === '2026-08-06T04:04:00.000Z');

// ── RE-GLUE REGRESSION (emp 6): two consecutive glued sheets. The merge pass
// must use POST-split punches as its base and only absorb the split-created
// 09:34 punch into ts#8 when the result is plausible (09:34→20:07 = 10h33m),
// NOT merge pre-split punches (which would glue 09:34→09:36 next day = 24h).
ok('ts7 kept as open IN 18:16 (missed OUT)', get(7).outAt === null && get(7).inAt === '2026-08-01T12:46:00.000Z', JSON.stringify(get(7)));
ok('ts7 split-created 09:34 was ABSORBED into ts8 (no orphan row)', ![...st.values()].some(t => t.meta && t.meta.repair_split_from === 7), JSON.stringify([...st.values()].filter(t => t.meta && t.meta.repair_split_from === 7).map(t => t.id)));
ok('ts8 absorbed 09:34 → in 09:34 (04:04Z)', get(8).inAt === '2026-08-02T04:04:00.000Z', String(get(8).inAt));
ok('ts8 out 20:07 (14:37Z) — NO 24h glue', get(8).outAt === '2026-08-02T14:37:00.000Z', String(get(8).outAt));
ok('ts8 punches 09:34+20:07 (no 09:36 next-day punch)', JSON.stringify(get(8).punches).includes('2026-08-02T04:04:00.000Z') && JSON.stringify(get(8).punches).includes('2026-08-02T14:37:00.000Z') && !JSON.stringify(get(8).punches).includes('2026-08-03T04:06:00.000Z'), JSON.stringify(get(8).punches));
ok('ts8 split created a 09:36 sheet for 03-08', [...st.values()].some(t => t.meta && t.meta.repair_split_from === 8 && t.inAt === '2026-08-03T04:06:00.000Z'));

// Cleanup dump so future runs reseed.
reset();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
