/**
 * DIRECT FIX: Set outAt = null for all timesheet records where inAt = outAt
 * This means the employee only punched once (clocked in but hasn't left yet).
 * Covers: last month start till today.
 */
const prisma = require('../src/lib/prisma');
const dayjs = require('dayjs');

async function fixSameInOut() {
    const since = dayjs().subtract(60, 'day').startOf('day').toDate();
    console.log(`[FIX] Scanning timesheets from ${dayjs(since).format('YYYY-MM-DD')} till today...`);

    // Raw query to find and fix in one shot
    // We use prisma's updateMany with a raw where clause approach
    const result = await prisma.$executeRaw`
        UPDATE timesheets
        SET out_at = NULL,
            lunch_out_at = NULL,
            lunch_in_at = NULL
        WHERE in_at IS NOT NULL
          AND out_at IS NOT NULL
          AND in_at = out_at
          AND date >= ${since}::date
    `;

    console.log(`[FIX] Done. Updated ${result} records where IN = OUT.`);
    process.exit(0);
}

fixSameInOut().catch(err => {
    console.error('[FIX ERROR]', err);
    process.exit(1);
});
