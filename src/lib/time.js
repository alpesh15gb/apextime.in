/**
 * Centralized time handling for ApexTime.
 *
 * THE TIME MODEL (researched best practice for attendance apps):
 *  - Biometric devices send wall-clock time in IST (Asia/Kolkata).
 *  - All absolute instants (in_at, out_at, punch times, created_at) are stored
 *    in PostgreSQL as UTC (timestamptz). dayjs.tz(x, TZ) converts at the edges.
 *  - Date-only columns (timesheet.date, holidays.date, leave dates, @db.Date)
 *    hold the IST calendar day as a UTC-midnight instant (e.g. 2026-08-05T00:00:00Z
 *    == "2026-08-05" in IST). This makes string comparisons and Prisma
 *    @db.Date filters unambiguous.
 *  - Server timezone must NEVER matter: always go through these helpers.
 */
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const TZ = 'Asia/Kolkata';

/** Current instant, as a dayjs object in IST. Always use this for "now". */
const now = () => dayjs.tz(Date.now(), TZ);

/** Today's IST calendar date as 'YYYY-MM-DD'. */
const todayStr = () => now().format('YYYY-MM-DD');

/**
 * Convert a 'YYYY-MM-DD' (IST calendar day) to a Date holding that day at UTC
 * midnight — the canonical representation for @db.Date columns in this app.
 * e.g. utcDate('2026-08-05') -> 2026-08-05T00:00:00.000Z
 */
const utcDate = (dateStr) => dayjs.utc(dateStr).startOf('day').toDate();

/**
 * dayjs wrapper for @db.Date columns (already UTC-midnight instants).
 * Formatting in UTC yields the correct calendar day regardless of server TZ.
 */
const dayUTC = (date) => dayjs.utc(date);

/** dayjs wrapper for absolute instants, presented in IST. */
const tz = (date) => dayjs.tz(date, TZ);

/** IST day string 'YYYY-MM-DD' for an absolute instant. */
const dayStrIST = (date) => dayjs.tz(date, TZ).format('YYYY-MM-DD');

/** IST 'HH:mm' for an absolute instant. */
const timeStrIST = (date) => dayjs.tz(date, TZ).format('HH:mm');

/**
 * Parse a device-supplied datetime string (IST wall clock) into a UTC instant.
 * Handles the common ESSL formats: 'YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD HH:mm',
 * 'YYYY/MM/DD HH:mm:ss', 'YYYY-MM-DDTHH:mm:ss'. Returns null on failure.
 */
const parseDeviceDateTime = (str) => {
    if (!str) return null;
    const s = String(str).trim();
    if (!s) return null;
    const formats = [
        'YYYY-MM-DD HH:mm:ss',
        'YYYY-MM-DD HH:mm',
        'YYYY/MM/DD HH:mm:ss',
        'YYYY/MM/DD HH:mm',
        'YYYY-MM-DDTHH:mm:ss',
        'YYYY-MM-DDTHH:mm:ss.SSS',
    ];
    for (const f of formats) {
        // dayjs.tz() THROWS (RangeError) when a format doesn't match instead
        // of returning an invalid date — validate the parse first.
        if (!dayjs.utc(s, f).isValid()) continue;
        try {
            const d = dayjs.tz(s, f, TZ);
            if (d.isValid()) return d.toDate();
        } catch {
            // fall through to the next format
        }
    }
    // Last resort: let JS parse (usually ISO).
    try {
        const fallback = new Date(s);
        return isNaN(fallback.getTime()) ? null : fallback;
    } catch {
        return null;
    }
};

/**
 * Normalize a punch entry from the `punches` JSON array to its time as a Date.
 * Handles both { time: 'ISO' } and legacy { time: { value: '...' } } shapes.
 */
const punchTimeOf = (p) => {
    if (!p) return null;
    const raw = (p.time && typeof p.time === 'object' && 'value' in p.time) ? p.time.value : p.time;
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
};

/** True when two punches are within `toleranceMs` of each other (dedupe). */
const samePunch = (a, b, toleranceMs = 60000) => {
    if (!a || !b) return false;
    return Math.abs(a.getTime() - b.getTime()) <= toleranceMs;
};

module.exports = {
    TZ,
    now,
    todayStr,
    utcDate,
    dayUTC,
    tz,
    dayStrIST,
    timeStrIST,
    parseDeviceDateTime,
    punchTimeOf,
    samePunch,
};
