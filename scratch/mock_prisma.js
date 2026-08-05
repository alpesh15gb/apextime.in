/**
 * Preload-able in-memory Prisma mock (for testing scripts in child processes).
 * Load with: NODE_OPTIONS="--require <abs path to this file>"
 * State persists to scratch/.mock-store.json between runs.
 *
 * Supports: tenant-scoped repair tests (tenant 1, emps 1-6) AND the
 * rebuild-employee-days.js scenario (tenant 2, emp 43 = code "1303") including
 * deviceLog/device lookups and the punch processor's timesheet.findFirst calls.
 */
const fs = require('fs');
const path = require('path');

const DUMP = path.join(__dirname, '.mock-store.json');
const iso = (s) => new Date(s);

function seedStore() {
    const store = new Map();
    let nextId = 1;
    const add = (t) => { const id = nextId++; store.set(id, { id, ...t }); return store.get(id); };

    // ── Tenant 1 / repair-test scenario (employees 1-6) ──────────────────
    // ts#1: outAt clobbered to IN time (09:00 IST) although punches show 18:00 IST out
    add({ tenantId: 1, employeeId: 1, date: iso('2026-08-05T00:00:00.000Z'), inAt: iso('2026-08-05T03:30:00.000Z'), outAt: iso('2026-08-05T03:30:00.000Z'), punches: [{ time: '2026-08-05T03:30:00.000Z' }, { time: '2026-08-05T12:30:00.000Z' }], status: 'auto_approved', source: 'device', createdAt: iso('2026-08-05T04:00:00Z') });
    // ts#2: duplicate same-day (employee 1, same date) → should merge into ts#1
    add({ tenantId: 1, employeeId: 1, date: iso('2026-08-05T00:00:00.000Z'), inAt: iso('2026-08-05T12:30:00.000Z'), outAt: null, punches: [{ time: '2026-08-05T12:30:00.000Z' }], status: 'pending', source: 'mobile', createdAt: iso('2026-08-05T05:00:00Z') });
    // ts#3: date column 9th but inAt is 10th 00:00 IST → date should move to 10th
    add({ tenantId: 1, employeeId: 2, date: iso('2026-08-09T00:00:00.000Z'), inAt: iso('2026-08-09T18:30:00.000Z'), outAt: iso('2026-08-10T03:30:00.000Z'), punches: [{ time: '2026-08-09T18:30:00.000Z' }, { time: '2026-08-10T03:30:00.000Z' }], status: 'auto_approved', source: 'device', createdAt: iso('2026-08-10T04:00:00Z') });
    // ts#4: outBeforeIn without punches → report only
    add({ tenantId: 1, employeeId: 3, date: iso('2026-08-05T00:00:00.000Z'), inAt: iso('2026-08-05T12:30:00.000Z'), outAt: iso('2026-08-05T03:30:00.000Z'), punches: [], status: 'approved', source: 'manual', createdAt: iso('2026-08-06T04:00:00Z') });
    // ts#5: open > 48h → report only
    add({ tenantId: 1, employeeId: 4, date: iso('2026-07-20T00:00:00.000Z'), inAt: iso('2026-07-20T03:30:00.000Z'), outAt: null, punches: [], status: 'auto_approved', source: 'device', createdAt: iso('2026-07-20T04:00:00Z') });
    // ts#6: MISPUNCH — missed-OUT sheet glued to next-day punch: 18:16 IST day1
    // + 09:34 IST day2 = 15h18m span for a 10h shift → must split into 2 sheets.
    add({ tenantId: 1, employeeId: 5, date: iso('2026-08-05T00:00:00.000Z'), inAt: iso('2026-08-05T12:46:00.000Z'), outAt: iso('2026-08-06T04:04:00.000Z'), punches: [{ time: '2026-08-05T12:46:00.000Z' }, { time: '2026-08-06T04:04:00.000Z' }], status: 'auto_approved', source: 'device', createdAt: iso('2026-08-06T05:00:00Z') });

    // ts#7 + ts#8: THE RE-GLUE REGRESSION — emp 6 has TWO consecutive glued
    // sheets (18:16→09:34 next day, then 20:07→09:36 next day). After the split
    // pass, the 09:34 punch created from ts#7 lands on 02-08 (same date as
    // ts#8). The merge pass must absorb it into ts#8 ONLY IF the result stays
    // plausible (09:34→20:07 = 10h33m) — NOT merge the original pre-split
    // punches (which would give 09:34→09:36 next day = 24h02m glue).
    add({ tenantId: 1, employeeId: 6, date: iso('2026-08-01T00:00:00.000Z'), inAt: iso('2026-08-01T12:46:00.000Z'), outAt: iso('2026-08-02T04:04:00.000Z'), punches: [{ time: '2026-08-01T12:46:00.000Z' }, { time: '2026-08-02T04:04:00.000Z' }], status: 'auto_approved', source: 'device', createdAt: iso('2026-08-02T05:00:00Z') });
    add({ tenantId: 1, employeeId: 6, date: iso('2026-08-02T00:00:00.000Z'), inAt: iso('2026-08-02T14:37:00.000Z'), outAt: iso('2026-08-03T04:06:00.000Z'), punches: [{ time: '2026-08-02T14:37:00.000Z' }, { time: '2026-08-03T04:06:00.000Z' }], status: 'auto_approved', source: 'device', createdAt: iso('2026-08-03T05:00:00Z') });

    // ── Tenant 2 / REBUILD scenario: employee 1303 (id 43) ────────────────
    // Post-repair (wrong) state the rebuild must fix. Night shift 31-07 was
    // split at the largest gap into "17:31 → open" + a bogus "02:40→09:02"
    // sheet, and 03-08's 09:36/22:52 punches became two open sheets.
    const E = 43, T = 2;
    add({ tenantId: T, employeeId: E, date: iso('2026-07-28T00:00:00.000Z'), inAt: iso('2026-07-28T04:08:48.000Z'), outAt: iso('2026-07-28T14:15:38.000Z'), punches: [{ time: '2026-07-28T04:08:48.000Z' }, { time: '2026-07-28T14:15:38.000Z' }], status: 'auto_approved', source: 'device' });
    add({ tenantId: T, employeeId: E, date: iso('2026-07-30T00:00:00.000Z'), inAt: iso('2026-07-30T09:08:18.000Z'), outAt: iso('2026-07-30T14:00:19.000Z'), punches: [{ time: '2026-07-30T09:08:18.000Z' }, { time: '2026-07-30T14:00:19.000Z' }], status: 'auto_approved', source: 'device' });
    add({ tenantId: T, employeeId: E, date: iso('2026-07-31T00:00:00.000Z'), inAt: iso('2026-07-31T12:01:56.000Z'), outAt: null, punches: [{ time: '2026-07-31T12:01:56.000Z' }], status: 'auto_approved', source: 'device' }); // wrong: should close at 02:40 IST next day
    add({ tenantId: T, employeeId: E, date: iso('2026-08-01T00:00:00.000Z'), inAt: iso('2026-07-31T21:10:43.000Z'), outAt: iso('2026-08-01T03:32:36.000Z'), punches: [{ time: '2026-07-31T21:10:43.000Z' }, { time: '2026-08-01T03:32:36.000Z' }], status: 'auto_approved', source: 'device' }); // bogus 02:40→09:02 IST sheet
    add({ tenantId: T, employeeId: E, date: iso('2026-08-01T00:00:00.000Z'), inAt: iso('2026-08-01T12:46:47.000Z'), outAt: null, punches: [{ time: '2026-08-01T12:46:47.000Z' }], status: 'auto_approved', source: 'device' }); // wrong: 18:16 IST should close 09:02→18:16
    add({ tenantId: T, employeeId: E, date: iso('2026-08-02T00:00:00.000Z'), inAt: iso('2026-08-02T04:04:38.000Z'), outAt: iso('2026-08-02T14:37:12.000Z'), punches: [{ time: '2026-08-02T04:04:38.000Z' }, { time: '2026-08-02T14:37:12.000Z' }], status: 'auto_approved', source: 'device' });
    add({ tenantId: T, employeeId: E, date: iso('2026-08-03T00:00:00.000Z'), inAt: iso('2026-08-03T04:06:35.000Z'), outAt: null, punches: [{ time: '2026-08-03T04:06:35.000Z' }], status: 'auto_approved', source: 'device' }); // wrong: 09:36 IST should close at 22:52 IST
    add({ tenantId: T, employeeId: E, date: iso('2026-08-03T00:00:00.000Z'), inAt: iso('2026-08-03T17:22:38.000Z'), outAt: null, punches: [{ time: '2026-08-03T17:22:38.000Z' }], status: 'auto_approved', source: 'device' }); // 22:52 IST open
    add({ tenantId: T, employeeId: E, date: iso('2026-08-05T00:00:00.000Z'), inAt: iso('2026-08-05T04:03:34.000Z'), outAt: null, punches: [{ time: '2026-08-05T04:03:34.000Z' }], status: 'auto_approved', source: 'device' });

    // Out-of-window repair-split row (dated 07-01, BEFORE the rebuild window
    // 07-23+). It carries meta.repair_split_from from the earlier repair. A
    // rebuild-restore must NOT delete it (only rebuild_created rows are removed
    // for rebuild backups) — this is the restore-filter regression guard.
    add({ tenantId: T, employeeId: E, date: iso('2026-07-01T00:00:00.000Z'), inAt: iso('2026-07-01T06:00:00.000Z'), outAt: null, punches: [{ time: '2026-07-01T06:00:00.000Z' }], status: 'auto_approved', source: 'device', meta: { repair_split_from: 12500 } });

    // Raw device logs for 1303 (punchTime in UTC; IST = UTC+5:30). These are
    // the GROUND TRUTH the rebuild replays through the punch processor.
    const logs = [
        { id: 35011, tenantId: T, userId: '1303', deviceId: 1, punchTime: iso('2026-07-28T04:08:48.000Z'), rawData: '1303       2026-07-28 09:38:48     0       1', processed: true },
        { id: 35088, tenantId: T, userId: '1303', deviceId: 1, punchTime: iso('2026-07-28T14:15:38.000Z'), rawData: '1303       2026-07-28 19:45:38     1       1', processed: true },
        { id: 35089, tenantId: T, userId: '1303', deviceId: 1, punchTime: iso('2026-07-28T14:15:45.000Z'), rawData: '1303       2026-07-28 19:45:45     1       1', processed: true },
        { id: 35310, tenantId: T, userId: '1303', deviceId: 1, punchTime: iso('2026-07-30T09:08:18.000Z'), rawData: '1303     2026-07-30 14:38:18     0       1', processed: true },
        { id: 35347, tenantId: T, userId: '1303', deviceId: 1, punchTime: iso('2026-07-30T14:00:19.000Z'), rawData: '1303       2026-07-30 19:30:19     1       1', processed: true },
        { id: 35464, tenantId: T, userId: '1303', deviceId: 1, punchTime: iso('2026-07-31T12:01:56.000Z'), rawData: '1303       2026-07-31 17:31:56     0       1', processed: true },
        { id: 35524, tenantId: T, userId: '1303', deviceId: 1, punchTime: iso('2026-07-31T21:10:43.000Z'), rawData: '1303       2026-08-01 02:40:43     0       1', processed: true },
        { id: 35525, tenantId: T, userId: '1303', deviceId: 1, punchTime: iso('2026-07-31T21:10:52.000Z'), rawData: '1303       2026-08-01 02:40:52     1       1', processed: true },
        { id: 35526, tenantId: T, userId: '1303', deviceId: 1, punchTime: iso('2026-07-31T21:10:58.000Z'), rawData: '1303       2026-08-01 02:40:58     1       1', processed: true },
        { id: 35558, tenantId: T, userId: '1303', deviceId: 1, punchTime: iso('2026-08-01T03:32:36.000Z'), rawData: '1303       2026-08-01 09:02:36     0       1', processed: true },
        { id: 35559, tenantId: T, userId: '1303', deviceId: 1, punchTime: iso('2026-08-01T03:32:44.000Z'), rawData: '1303       2026-08-01 09:02:44     0       1', processed: true },
        { id: 35622, tenantId: T, userId: '1303', deviceId: 1, punchTime: iso('2026-08-01T12:46:47.000Z'), rawData: '1303       2026-08-01 18:16:47     0       1', processed: true },
        { id: 35623, tenantId: T, userId: '1303', deviceId: 1, punchTime: iso('2026-08-01T12:46:54.000Z'), rawData: '1303       2026-08-01 18:16:54     1       1', processed: true },
        { id: 35624, tenantId: T, userId: '1303', deviceId: 1, punchTime: iso('2026-08-01T12:46:59.000Z'), rawData: '1303       2026-08-01 18:16:59     1       1', processed: true },
        { id: 35702, tenantId: T, userId: '1303', deviceId: 1, punchTime: iso('2026-08-02T04:04:38.000Z'), rawData: '1303       2026-08-02 09:34:38     0       1', processed: true },
        { id: 35775, tenantId: T, userId: '1303', deviceId: 1, punchTime: iso('2026-08-02T14:37:12.000Z'), rawData: '1303       2026-08-02 20:07:12     1       1', processed: true },
        { id: 35776, tenantId: T, userId: '1303', deviceId: 1, punchTime: iso('2026-08-02T14:37:17.000Z'), rawData: '1303       2026-08-02 20:07:17     1       1', processed: true },
        { id: 35832, tenantId: T, userId: '1303', deviceId: 1, punchTime: iso('2026-08-03T04:06:35.000Z'), rawData: '1303       2026-08-03 09:36:35     0       1', processed: true },
        { id: 35942, tenantId: T, userId: '1303', deviceId: 1, punchTime: iso('2026-08-03T17:22:38.000Z'), rawData: '1303       2026-08-03 22:52:38     1       1', processed: true },
        { id: 36101, tenantId: T, userId: '1303', deviceId: 1, punchTime: iso('2026-08-05T04:03:34.000Z'), rawData: '1303       2026-08-05 09:33:34     0       1', processed: true },
    ];
    const devices = [
        { id: 1, tenantId: T, serialNumber: 'NYU7255300532' },
    ];

    // Shift assignments: employee 5/6 work a 10h shift on Wednesdays (18:00→04:00);
    // employee 43 (1303) has the "10 Hours" flexible shift 09:00-18:00 Mon-Sat.
    const shifts = [{
        id: 1, employeeId: 5, startDate: iso('2026-08-01T00:00:00.000Z'), endDate: iso('2026-08-31T00:00:00.000Z'),
        workShift: { id: 1, records: [{ day: 'wednesday', startTime: '18:00', endTime: '04:00', isOff: false }], minHours: 10, maxOtHours: 2 },
    }, {
        id: 2, employeeId: 6, startDate: iso('2026-08-01T00:00:00.000Z'), endDate: iso('2026-08-31T00:00:00.000Z'),
        workShift: { id: 2, records: [{ day: 'wednesday', startTime: '18:00', endTime: '04:00', isOff: false }], minHours: 10, maxOtHours: 2 },
    }, {
        id: 3, employeeId: E, startDate: iso('2026-01-01T00:00:00.000Z'), endDate: iso('2030-12-31T00:00:00.000Z'),
        workShift: { id: 3, isFlexible: true, minHours: 10, maxOtHours: 0, records: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(day => ({ day, startTime: '09:00', endTime: '18:00', isOff: false })) },
    }];

    return { entries: [...store.entries()], nextId, shifts: { rows: shifts }, logs, devices };
}

// Load persisted state or seed fresh.
let state;
if (fs.existsSync(DUMP)) {
    state = JSON.parse(fs.readFileSync(DUMP, 'utf8'));
} else {
    state = seedStore();
}

const DATE_FIELDS = ['date', 'inAt', 'outAt', 'createdAt', 'punchTime'];
const hydrate = (t) => {
    if (!t) return t;
    const out = { ...t };
    for (const f of DATE_FIELDS) if (typeof out[f] === 'string') out[f] = new Date(out[f]);
    return out;
};
const hydrateShifts = (rows) => (rows || []).map(s => ({
    ...s,
    startDate: typeof s.startDate === 'string' ? new Date(s.startDate) : s.startDate,
    endDate: typeof s.endDate === 'string' ? new Date(s.endDate) : s.endDate,
}));

const store = new Map(state.entries.map(([id, t]) => [id, hydrate(t)]));

const persist = () => fs.writeFileSync(DUMP, JSON.stringify({
    entries: [...store.entries()].map(([id, t]) => [id, { ...t }]),
    nextId: state.nextId,
    shifts: state.shifts || { rows: [] },
    logs: state.logs || [],
    devices: state.devices || [],
}));
persist();

// ── helpers ──────────────────────────────────────────────────────────────
const inRange = (val, w) => {
    if (w === undefined || w === null) return true;
    if (w.gte !== undefined && (!val || val < w.gte)) return false;
    if (w.lte !== undefined && (!val || val > w.lte)) return false;
    return true;
};

/** Simple orderBy comparator (supports {key:'asc'|'desc'} and [{key:{sort,nulls}}]) */
const byOrder = (a, b, orderBy) => {
    if (!orderBy) return 0;
    const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
    for (const spec of specs) {
        const key = Object.keys(spec)[0];
        const cfg = spec[key];
        let dir = 1;
        if (typeof cfg === 'object') { if (cfg.sort === 'desc') dir = -1; }
        else if (cfg === 'desc') dir = -1;
        const av = a[key] ? new Date(a[key]).getTime() : null;
        const bv = b[key] ? new Date(b[key]).getTime() : null;
        if (av === null && bv === null) continue;
        if (av === null) return typeof cfg === 'object' && cfg.nulls === 'first' ? -1 : 1;
        if (bv === null) return typeof cfg === 'object' && cfg.nulls === 'first' ? 1 : -1;
        if (av < bv) return -dir;
        if (av > bv) return dir;
    }
    return 0;
};

const mockPrisma = {
    employeeWorkShift: {
        findMany: async () => hydrateShifts(state.shifts ? state.shifts.rows : []),
        findFirst: async ({ where }) => {
            const rows = hydrateShifts(state.shifts ? state.shifts.rows : []);
            return rows.find(s =>
                s.employeeId === where.employeeId &&
                (!where.startDate || !where.startDate.lte || s.startDate <= where.startDate.lte) &&
                (!where.endDate || !where.endDate.gte || s.endDate >= where.endDate.gte)
            ) || null;
        },
    },
    employee: {
        findFirst: async ({ where }) => {
            if (where && where.employeeCode === '1303') return { id: 43, employeeCode: '1303', tenantId: 2 };
            if (where && where.employeeCode) return { id: 999, employeeCode: where.employeeCode };
            return null;
        },
    },
    deviceLog: {
        findMany: async ({ where }) => {
            const rows = (state.logs || []).filter(l =>
                (!where || where.tenantId === undefined || l.tenantId === where.tenantId) &&
                (!where || where.userId === undefined || l.userId === where.userId) &&
                (!where || !where.punchTime || inRange(new Date(l.punchTime), { gte: where.punchTime.gte, lte: where.punchTime.lte }))
            );
            return rows.map(hydrate).sort((a, b) => a.punchTime - b.punchTime);
        },
        findFirst: async ({ where, orderBy }) => {
            const rows = (state.logs || []).filter(l =>
                (!where || where.tenantId === undefined || l.tenantId === where.tenantId) &&
                (!where || where.userId === undefined || l.userId === where.userId)
            ).map(hydrate).sort((a, b) => byOrder(a, b, orderBy));
            return rows[0] || null;
        },
        update: async ({ where, data }) => {
            const l = (state.logs || []).find(x => x.id === where.id);
            if (l) Object.assign(l, data);
            return l;
        },
    },
    device: {
        findUnique: async ({ where }) => (state.devices || []).find(d => d.id === where.id) || null,
    },
    timesheet: {
        findMany: async ({ where }) => {
            const rows = [...store.values()].filter(t => {
                if (!where) return true;
                if (where.tenantId !== undefined && t.tenantId !== where.tenantId) return false;
                if (where.employeeId !== undefined) {
                    if (typeof where.employeeId === 'object' && where.employeeId.in !== undefined) { if (!where.employeeId.in.includes(t.employeeId)) return false; }
                    else if (t.employeeId !== where.employeeId) return false;
                }
                if (where.id !== undefined) {
                    if (Array.isArray(where.id)) { if (!where.id.includes(t.id)) return false; }
                    else if (t.id !== where.id) return false;
                }
                if (where.source !== undefined) {
                    if (typeof where.source === 'object' && where.source.not !== undefined) { if (t.source === where.source.not) return false; }
                    else if (t.source !== where.source) return false;
                }
                if (where.date && !inRange(t.date, where.date)) return false;
                if (where.inAt && !inRange(t.inAt, where.inAt)) return false;
                return true;
            });
            return rows.map(hydrate).sort((a, b) => a.id - b.id);
        },
        findUnique: async ({ where }) => hydrate(store.get(where.id)) || null,
        findFirst: async ({ where, orderBy }) => {
            let rows = [...store.values()].filter(t => {
                if (!where) return true;
                if (where.tenantId !== undefined && t.tenantId !== where.tenantId) return false;
                if (where.employeeId !== undefined) {
                    if (typeof where.employeeId === 'object' && where.employeeId.in !== undefined) { if (!where.employeeId.in.includes(t.employeeId)) return false; }
                    else if (t.employeeId !== where.employeeId) return false;
                }
                if (where.date !== undefined) {
                    if (typeof where.date === 'object' && (where.date.gte !== undefined || where.date.lte !== undefined)) {
                        if (!inRange(t.date, where.date)) return false;
                    } else if (t.date && new Date(t.date).getTime() !== new Date(where.date).getTime()) return false;
                }
                if (where.outAt !== undefined) {
                    if (where.outAt === null) { if (t.outAt !== null && t.outAt !== undefined) return false; }
                    else if (!t.outAt || new Date(t.outAt).getTime() !== new Date(where.outAt).getTime()) return false;
                }
                if (where.inAt && !inRange(t.inAt, where.inAt)) return false;
                return true;
            });
            rows = rows.map(hydrate).sort((a, b) => byOrder(a, b, orderBy));
            return rows[0] || null;
        },
        update: async ({ where, data }) => { Object.assign(store.get(where.id), data); return store.get(where.id); },
        create: async ({ data }) => { const id = (data && data.id) || state.nextId++; store.set(id, { id, ...data }); return store.get(id); },
        delete: async ({ where }) => { store.delete(where.id); },
    },
    $disconnect: async () => {},
};

// Patch the real prisma module so any `require('../src/lib/prisma')` gets the mock.
const prismaModule = require.resolve('../src/lib/prisma');
require.cache[prismaModule] = { id: prismaModule, filename: prismaModule, loaded: true, exports: mockPrisma };

process.on('exit', persist);
