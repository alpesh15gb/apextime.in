const prisma = require('../src/lib/prisma');
const dayjs = require('dayjs');
const path = require('path');

async function backfill() {
    console.log('--- STARTING LUNCH BACKFILL ---');
    
    const lastMonthStart = dayjs().subtract(1, 'month').startOf('month').toDate();
    console.log(`Filtering records from: ${dayjs(lastMonthStart).format('YYYY-MM-DD')}`);

    // Find all timesheets
    const timesheets = await prisma.timesheet.findMany({
        where: {
            source: 'device',
            date: { gte: lastMonthStart }
        },
        include: {
            employee: true
        }
    });

    console.log(`Processing ${timesheets.length} timesheets...`);

    let updatedCount = 0;

    for (const ts of timesheets) {
        const dateStr = dayjs(ts.date).format('YYYY-MM-DD');
        const nextDateStr = dayjs(ts.date).add(1, 'day').format('YYYY-MM-DD');

        // Find all logs for this employee on this day
        const logs = await prisma.deviceLog.findMany({
            where: {
                tenantId: ts.tenantId,
                userId: ts.employee.employeeCode,
                punchTime: {
                    gte: dayjs(dateStr).startOf('day').toDate(),
                    lt: dayjs(dateStr).endOf('day').toDate()
                }
            },
            orderBy: {
                punchTime: 'asc'
            }
        });

            let uniquePunches = [];
            if (logs.length > 0) {
                const seenTimes = new Set();
                for (const log of logs) {
                    const timeStr = dayjs(log.punchTime).format('YYYY-MM-DD HH:mm');
                    if (!seenTimes.has(timeStr)) {
                        uniquePunches.push({
                            time: log.punchTime,
                            device_sn: 'HISTORY',
                            type: 'auto'
                        });
                        seenTimes.add(timeStr);
                    }
                }
            } else {
                // No logs found, use existing punches as fallback
                const pRaw = ts.punches || [];
                uniquePunches = typeof pRaw === 'string' ? JSON.parse(pRaw) : pRaw;
            }

            const updateData = {
                punches: uniquePunches,
                lunchOutAt: null,
                lunchInAt: null
            };

            if (uniquePunches.length > 0) {
                updateData.inAt = uniquePunches[0].time;
                // ONLY set outAt if there is more than 1 unique punch
                updateData.outAt = uniquePunches.length > 1 ? uniquePunches[uniquePunches.length - 1].time : null;
            } else {
                // No punches at all? Keep existing inAt but clear outAt
                updateData.outAt = null;
            }

            await prisma.timesheet.update({
                where: { id: ts.id },
                data: updateData
            });
            
            updatedCount++;
            if (updatedCount % 50 === 0 && updatedCount > 0) console.log(`Updated ${updatedCount} records...`);
        }

    console.log(`\nCOMPLETED: Updated ${updatedCount} records.`);
    process.exit(0);
}

backfill().catch(err => {
    console.error(err);
    process.exit(1);
});
