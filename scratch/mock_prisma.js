/**
 * Preload-able in-memory Prisma mock (for testing scripts in child processes).
 * Load with: NODE_OPTIONS="--require <abs path to this file>"
 * State persists to scratch/.mock-store.json between runs.
 */
const fs = require('fs');
const path = require('path');

const DUMP = path.join(__dirname, '.mock-store.json');
const iso = (s) => new Date(s);

function seedStore() {
    const store = new Map();
    let nextId = 1;
    const add = (t) => { const id = nextId++; store.set(id, { id, ...t }); return store.get(id); };

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

    // Shift assignment: employee 5 works a 10h shift on Wednesdays (18:00→04:00).
    const shifts = [{
        id: 1, employeeId: 5, startDate: iso('2026-08-01T00:00:00.000Z'), endDate: iso('2026-08-31T00:00:00.000Z'),
        workShift: { id: 1, records: [{ day: 'wednesday', startTime: '18:00', endTime: '04:00', isOff: false }], minHours: 10, maxOtHours: 2 },
    }];

    return { entries: [...store.entries()], nextId, shifts: { rows: shifts } };
}

// Load persisted state or seed fresh.
let state;
if (fs.existsSync(DUMP)) {
    state = JSON.parse(fs.readFileSync(DUMP, 'utf8'));
} else {
    state = seedStore();
}

const DATE_FIELDS = ['date', 'inAt', 'outAt', 'createdAt'];
const hydrate = (t) => {
    if (!t) return t;
    const out = { ...t };
    for (const f of DATE_FIELDS) if (typeof out[f] === 'string') out[f] = new Date(out[f]);
    return out;
};
// Shifts need startDate/endDate hydrated too (they live outside `store`).
const hydrateShifts = (rows) => (rows || []).map(s => ({
    ...s,
    startDate: typeof s.startDate === 'string' ? new Date(s.startDate) : s.startDate,
    endDate: typeof s.endDate === 'string' ? new Date(s.endDate) : s.endDate,
}));

// Store keeps Dates; the dump file stores ISO strings (hydrate on load).
const store = new Map(state.entries.map(([id, t]) => [id, hydrate(t)]));

// Persist immediately (so parents can read the seeded state) and on exit.
const persist = () => fs.writeFileSync(DUMP, JSON.stringify({
    entries: [...store.entries()].map(([id, t]) => [id, { ...t }]),
    nextId: state.nextId,
    shifts: state.shifts || { rows: [] },
}));
persist();

const mockPrisma = {
    employeeWorkShift: {
        findMany: async () => hydrateShifts(state.shifts ? state.shifts.rows : []),
    },
    employee: {
        findFirst: async ({ where }) => {
            if (where && where.employeeCode === '1303') return { id: 999, employeeCode: '1303' };
            return null;
        },
    },
    timesheet: {
        findMany: async ({ where }) => {
            const rows = [...store.values()].filter(t => !where || !where.tenantId || t.tenantId === where.tenantId);
            return rows.map(hydrate).sort((a, b) => a.id - b.id);
        },
        findFirst: async () => null, // repair script doesn't use findFirst
        update: async ({ where, data }) => { Object.assign(store.get(where.id), data); return store.get(where.id); },
        create: async ({ data }) => { const id = state.nextId++; store.set(id, { id, ...data }); return store.get(id); },
        delete: async ({ where }) => { store.delete(where.id); },
    },
    $disconnect: async () => {},
};

// Patch the real prisma module so any `require('../src/lib/prisma')` gets the mock.
const prismaModule = require.resolve('../src/lib/prisma');
require.cache[prismaModule] = { id: prismaModule, filename: prismaModule, loaded: true, exports: mockPrisma };

process.on('exit', persist);
