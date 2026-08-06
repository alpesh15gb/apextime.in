// Quick sanity check of the report-hardening primitives (no DB needed).
// Verifies maxSpanMsFromShift caps match the report's shift patterns and that
// the 10h-shift example from the report (24:12 glued) is caught while the
// legitimate overnight (17:31→02:40 = 9:09) is NOT.
const { maxSpanMsFromShift } = require('../src/lib/punchProcessor');

// 10-hour shift, Mon..Sat 10:00-20:00, OT cap 0 (uncapped → 2h assumed)
const ws10 = {
    records: [
        { day: 'monday', startTime: '10:00', endTime: '20:00' },
        { day: 'tuesday', startTime: '10:00', endTime: '20:00' },
        { day: 'wednesday', startTime: '10:00', endTime: '20:00' },
        { day: 'thursday', startTime: '10:00', endTime: '20:00' },
        { day: 'friday', startTime: '10:00', endTime: '20:00' },
        { day: 'saturday', startTime: '10:00', endTime: '20:00' },
        { day: 'sunday', startTime: null, endTime: null, isOff: true },
    ],
    minHours: 9,
    maxOtHours: 0,
};
// 2026-07-23 is a Thursday
const capThursday = maxSpanMsFromShift(ws10, '2026-07-23');
const h = (ms) => Math.round(ms / 3600000 * 100) / 100;
console.log('maxSpan (10h shift, Thu):', h(capThursday), 'hours');
console.log('  expected ~13 (10h + 2h OT + 1h grace)');

// Report example: 1312 UMAMAHESWARI 23/07 IN 10:57 → OUT 11:09 next day = 24:12
const gluedSpan = 24 * 3600000 + 12 * 60000;
console.log('\nglued 24:12 span > cap → should be dropped:', gluedSpan > capThursday);

// Report example: 1303 31/07 IN 17:31 → OUT 02:40 next day = 9:09 (legit overnight)
const legitSpan = 9 * 3600000 + 9 * 60000;
console.log('legit 9:09 overnight span > cap → should stay:', legitSpan > capThursday, '(false = keep)');

// No-shift default cap
console.log('\nno-shift default cap:', h(maxSpanMsFromShift(null, '2026-07-23')), 'hours (expect 14)');
