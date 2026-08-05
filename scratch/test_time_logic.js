/* Unit tests for the pure time/punch logic (no DB needed). */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:x@localhost:5432/x';
const time = require('../src/lib/time');
const { normalizePunchList, deriveTimes } = require('../src/lib/punchProcessor');

let pass = 0, fail = 0;
const eq = (label, actual, expected) => {
    const ok = actual === expected;
    if (ok) pass++; else { fail++; console.log(`FAIL ${label}: expected ${expected}, got ${actual}`); }
};

// --- parseDeviceDateTime (IST wall clock → UTC instant) ---
const t = (str) => time.parseDeviceDateTime(str);
eq('parse std', time.dayStrIST(t('2026-08-05 09:00:00')), '2026-08-05');
eq('parse std time', time.timeStrIST(t('2026-08-05 09:00:00')), '09:00');
eq('parse no secs', time.timeStrIST(t('2026-08-05 09:00')), '09:00');
eq('parse slashes', time.timeStrIST(t('2026/08/05 09:00:00')), '09:00');
eq('parse ISO-T', time.timeStrIST(t('2026-08-05T09:00:00')), '09:00');
eq('parse ISO T ms', time.timeStrIST(t('2026-08-05T09:00:00.000')), '09:00');
eq('parse invalid', String(t('not a date')), 'null');
eq('parse empty', String(t('')), 'null');

// Midnight boundary: 00:10 IST on the 10th must be the 10th, not the 9th.
eq('midnight day', time.dayStrIST(t('2026-05-10 00:10:00')), '2026-05-10');
// Late night: 23:50 on the 10th must be the 10th.
eq('late night day', time.dayStrIST(t('2026-05-10 23:50:00')), '2026-05-10');

// --- utcDate / dayUTC round trip ---
const d = time.utcDate('2026-08-05');
eq('utcDate ISO', d.toISOString(), '2026-08-05T00:00:00.000Z');
eq('dayUTC formats', time.dayUTC(d).format('YYYY-MM-DD'), '2026-08-05');

// --- punchTimeOf: handles Date, ISO string, and legacy {value} ---
eq('punchTimeOf ISO', time.punchTimeOf({ time: '2026-08-05T03:30:00.000Z' }).toISOString(), '2026-08-05T03:30:00.000Z');
eq('punchTimeOf value', time.punchTimeOf({ time: { value: '2026-08-05T03:30:00.000Z' } }).toISOString(), '2026-08-05T03:30:00.000Z');
eq('punchTimeOf Date', time.punchTimeOf({ time: new Date('2026-08-05T03:30:00.000Z') }).toISOString(), '2026-08-05T03:30:00.000Z');
eq('punchTimeOf null', String(time.punchTimeOf(null)), 'null');
eq('punchTimeOf bad', String(time.punchTimeOf({ time: 'garbage' })), 'null');

// --- normalizePunchList: sort + dedupe within 60s ---
const mk = (iso) => ({ time: iso });
const list = normalizePunchList([mk('2026-08-05T03:30:00.000Z'), mk('2026-08-05T03:30:30.000Z'), mk('2026-08-05T09:00:00.000Z'), mk('2026-08-05T03:29:40.000Z')]);
eq('dedupe count', list.times.length, 2);
eq('dedupe first', list.times[0].toISOString(), '2026-08-05T03:29:40.000Z');
eq('dedupe last', list.times[1].toISOString(), '2026-08-05T09:00:00.000Z');

// --- deriveTimes ---
const two = normalizePunchList([mk('2026-08-05T03:30:00.000Z'), mk('2026-08-05T12:30:00.000Z')]);
const d2 = deriveTimes(two.entries, two.times);
eq('derive inAt IST', time.timeStrIST(d2.inAt), '09:00');
eq('derive outAt IST', time.timeStrIST(d2.outAt), '18:00');
eq('derive date', time.dayUTC(d2.date).format('YYYY-MM-DD'), '2026-08-05');

// Single punch → outAt null (open sheet semantics preserved).
const one = normalizePunchList([mk('2026-08-05T03:30:00.000Z')]);
const d1 = deriveTimes(one.entries, one.times);
eq('single punch outAt null', String(d1.outAt), 'null');
eq('single punch inAt set', String(d1.inAt), String(one.times[0]));

// Overnight: in 22:00 day1 → out 06:00 day2 (dates differ but stay on in-day).
const night = normalizePunchList([mk('2026-08-05T16:30:00.000Z'), mk('2026-08-06T00:30:00.000Z')]);
const dn = deriveTimes(night.entries, night.times);
eq('overnight date = in day', time.dayUTC(dn.date).format('YYYY-MM-DD'), '2026-08-05');
eq('overnight out IST', time.timeStrIST(dn.outAt), '06:00');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
