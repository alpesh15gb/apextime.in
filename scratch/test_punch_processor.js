/* Integration tests for processDevicePunch using an in-memory prisma mock. */
process.env.DATABASE_URL = 'postgresql://x:x@localhost:5432/x';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
    if (cond) pass++; else { fail++; console.log(`FAIL ${label} ${extra}`); }
};

// ── In-memory timesheet store ──
const store = new Map(); // id -> timesheet
let nextId = 1;

const punchAt = (iso) => ({ time: iso, device_sn: 'TEST', type: 'auto' });

const mockPrisma = {
    timesheet: {
        findFirst: async ({ where }) => {
            const rows = [...store.values()].filter(t => {
                if (where.tenantId && t.tenantId !== where.tenantId) return false;
                if (where.employeeId && t.employeeId !== where.employeeId) return false;
                if (where.date && t.date.getTime() !== where.date.getTime()) return false;
                if (where.outAt !== undefined) {
                    const a = t.outAt, b = where.outAt;
                    if (b === null && a !== null) return false;
                }
                if (where.inAt) {
                    if (where.inAt.gte && t.inAt < where.inAt.gte) return false;
                    if (where.inAt.lte && t.inAt > where.inAt.lte) return false;
                }
                return true;
            });
            if (!rows.length) return null;
            rows.sort((a, b) => {
                const orders = where.orderBy || [];
                for (const o of orders) {
                    const [k, dir] = Object.entries(o)[0];
                    if (dir === 'asc') { if (a[k] < b[k]) return -1; if (a[k] > b[k]) return 1; }
                    else { if (a[k] > b[k]) return -1; if (a[k] < b[k]) return 1; }
                }
                return 0;
            });
            return rows[0];
        },
        update: async ({ where, data }) => {
            const t = store.get(where.id);
            Object.assign(t, data);
            return t;
        },
        create: async ({ data }) => {
            const t = { id: nextId++, ...data };
            store.set(t.id, t);
            return t;
        },
    },
};

// Swap the real prisma module with the mock.
const prismaModule = require.resolve('../src/lib/prisma');
require.cache[prismaModule] = { id: prismaModule, filename: prismaModule, loaded: true, exports: mockPrisma };

const { processDevicePunch } = require('../src/lib/punchProcessor');
const time = require('../src/lib/time');

const device = { tenantId: 1, serialNumber: 'TEST-SN' };
const employee = { id: 100 };
const punch = (istStr) => time.parseDeviceDateTime(istStr);

// Helper: newest timesheet overall; all sheets for a given employee
const latest = () => [...store.values()].sort((a, b) => b.id - a.id)[0];
const allForEmp = (empId) => [...store.values()].filter(t => t.employeeId === empId).sort((a, b) => a.id - b.id);

// ── Scenario 1: normal 9-6 day ──
(async () => {
    console.log('— Scenario 1: normal 9-6 day');
    let r = await processDevicePunch({ device, employee, punchTime: punch('2026-08-05 09:00:00'), inOutMode: '5' });
    ok('S1 IN creates sheet', r.created, JSON.stringify(r));
    r = await processDevicePunch({ device, employee, punchTime: punch('2026-08-05 18:00:00'), inOutMode: '1' });
    ok('S1 OUT attaches', !r.created, JSON.stringify(r));
    const t1 = latest();
    ok('S1 inAt', time.timeStrIST(t1.inAt) === '09:00');
    ok('S1 outAt', time.timeStrIST(t1.outAt) === '18:00');
    ok('S1 punches count', t1.punches.length === 2, JSON.stringify(t1.punches));

    // ── Scenario 2: re-upload of same punches (retry) → idempotent ──
    console.log('— Scenario 2: batch re-send');
    r = await processDevicePunch({ device, employee, punchTime: punch('2026-08-05 09:00:00'), inOutMode: '5' });
    ok('S2 dup IN ignored', r.action === 'duplicate', r.action);
    r = await processDevicePunch({ device, employee, punchTime: punch('2026-08-05 18:00:00'), inOutMode: '1' });
    ok('S2 dup OUT ignored', r.action === 'duplicate', r.action);
    ok('S2 outAt NOT clobbered', time.timeStrIST(latest().outAt) === '18:00');

    // ── Scenario 3: OUT punch arrives before IN in batch (out-of-order) ──
    console.log('— Scenario 3: out-of-order batch (new employee)');
    const emp2 = { id: 101 };
    r = await processDevicePunch({ device, employee: emp2, punchTime: punch('2026-08-06 18:00:00'), inOutMode: '1' });
    ok('S3 out first creates sheet (recorded)', r.created, r.action);
    r = await processDevicePunch({ device, employee: emp2, punchTime: punch('2026-08-06 09:00:00'), inOutMode: '5' });
    const t3 = allForEmp(101)[0];
    ok('S3 in attaches to same sheet', r.action === 'attached_same_day', r.action);
    ok('S3 inAt earliest', time.timeStrIST(t3.inAt) === '09:00');
    ok('S3 outAt latest', time.timeStrIST(t3.outAt) === '18:00');

    // ── Scenario 4: overnight shift in 22:00 → out 06:00 next day ──
    console.log('— Scenario 4: overnight shift');
    const emp3 = { id: 102 };
    await processDevicePunch({ device, employee: emp3, punchTime: punch('2026-08-05 22:00:00'), inOutMode: '5' });
    r = await processDevicePunch({ device, employee: emp3, punchTime: punch('2026-08-06 06:00:00'), inOutMode: '0' });
    const t4 = allForEmp(102)[0];
    ok('S4 out attaches to overnight sheet', r.action === 'attached_open_sheet', r.action);
    ok('S4 single sheet', allForEmp(102).length === 1);
    ok('S4 outAt 06:00', time.timeStrIST(t4.outAt) === '06:00');
    ok('S4 date is in-day', time.dayUTC(t4.date).format('YYYY-MM-DD') === '2026-08-05');

    // ── Scenario 5: forgot OUT yesterday, next-day IN (mode 0, 24h gap) ──
    console.log('— Scenario 5: missed OUT, next-day IN');
    const emp4 = { id: 103 };
    await processDevicePunch({ device, employee: emp4, punchTime: punch('2026-08-05 09:00:00'), inOutMode: '0' });
    r = await processDevicePunch({ device, employee: emp4, punchTime: punch('2026-08-06 09:00:00'), inOutMode: '0' });
    const t5 = allForEmp(103);
    ok('S5 new sheet created for day2', t5.length === 2, `${t5.length} sheets`);
    ok('S5 day2 sheet has no outAt yet', time.timeStrIST(t5[1].inAt) === '09:00' && t5[1].outAt === null);
    ok('S5 day1 sheet untouched/open', t5[0].outAt === null);

    // ── Scenario 6: multiple punches same day (lunch) → in/out derived ──
    console.log('— Scenario 6: lunch punches');
    const emp5 = { id: 105 };
    await processDevicePunch({ device, employee: emp5, punchTime: punch('2026-08-07 09:00:00'), inOutMode: '5' });
    await processDevicePunch({ device, employee: emp5, punchTime: punch('2026-08-07 13:00:00'), inOutMode: '1' });
    await processDevicePunch({ device, employee: emp5, punchTime: punch('2026-08-07 14:00:00'), inOutMode: '5' });
    await processDevicePunch({ device, employee: emp5, punchTime: punch('2026-08-07 18:00:00'), inOutMode: '1' });
    const t6 = allForEmp(105)[0];
    ok('S6 inAt 09:00', time.timeStrIST(t6.inAt) === '09:00');
    ok('S6 outAt 18:00', time.timeStrIST(t6.outAt) === '18:00');
    ok('S6 4 punches', t6.punches.length === 4);

    // ── Scenario 7: near-duplicate punch within 60s deduped ──
    console.log('— Scenario 7: 30s-apart punches dedupe');
    const emp6 = { id: 106 };
    await processDevicePunch({ device, employee: emp6, punchTime: punch('2026-08-07 09:00:00'), inOutMode: '5' });
    r = await processDevicePunch({ device, employee: emp6, punchTime: punch('2026-08-07 09:00:30'), inOutMode: '5' });
    ok('S7 30s-apart ignored', r.action === 'duplicate', r.action);
    const t7 = allForEmp(106)[0];
    ok('S7 single punch recorded', t7.punches.length === 1);

    // ── Scenario 8: same-day re-upload of a DIFFERENT partial set can't clobber ──
    console.log('— Scenario 8: partial re-upload after full day recorded');
    const emp7 = { id: 107 };
    await processDevicePunch({ device, employee: emp7, punchTime: punch('2026-08-08 09:00:00'), inOutMode: '5' });
    await processDevicePunch({ device, employee: emp7, punchTime: punch('2026-08-08 18:00:00'), inOutMode: '1' });
    // Device re-sends ONLY the IN punch (e.g. retry of an earlier failed push):
    r = await processDevicePunch({ device, employee: emp7, punchTime: punch('2026-08-08 09:00:00'), inOutMode: '5' });
    ok('S8 re-sent IN is duplicate', r.action === 'duplicate', r.action);
    const t8 = allForEmp(107)[0];
    ok('S8 outAt stays 18:00', time.timeStrIST(t8.outAt) === '18:00');

    // ── Scenario 9: overnight shift, then a NEW evening shift next day ──
    console.log('— Scenario 9: overnight + new evening shift (legacy-path gate)');
    const emp8 = { id: 108 };
    await processDevicePunch({ device, employee: emp8, punchTime: punch('2026-08-05 22:00:00'), inOutMode: '0' });
    await processDevicePunch({ device, employee: emp8, punchTime: punch('2026-08-06 06:00:00'), inOutMode: '0' });
    r = await processDevicePunch({ device, employee: emp8, punchTime: punch('2026-08-06 18:00:00'), inOutMode: '0' });
    const t9 = allForEmp(108);
    ok('S9 evening punch starts a NEW sheet', t9.length === 2, `${t9.length} sheets (${r.action})`);
    ok('S9 new sheet inAt 18:00 d2', time.timeStrIST(t9[1].inAt) === '18:00' && time.dayStrIST(t9[1].inAt) === '2026-08-06');
    ok('S9 overnight sheet untouched', t9[0].punches.length === 2 && time.timeStrIST(t9[0].outAt) === '06:00');

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
