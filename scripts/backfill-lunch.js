const prisma = require('../src/lib/prisma');
const dayjs = require('dayjs');
const path = require('path');

async function backfill() {
    console.log('--- STARTING LUNCH BACKFILL ---');
    
    // Find all timesheets
    const timesheets = await prisma.timesheet.findMany({
        where: {
            source: 'device'
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

            if (logs.length > 0) {
                const uniquePunches = [];
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

                const updateData = {
                    punches: uniquePunches,
                    inAt: uniquePunches[0].time,
                    outAt: uniquePunches[uniquePunches.length - 1].time
                };

                // Lunch identification removed per user request
                updateData.lunchOutAt = null;
                updateData.lunchInAt = null;

            await prisma.timesheet.update({
                where: { id: ts.id },
                data: updateData
            });
            
            updatedCount++;
            if (updatedCount % 50 === 0) console.log(`Updated ${updatedCount} records...`);
        }
    }

    console.log(`\nCOMPLETED: Updated ${updatedCount} records.`);
    process.exit(0);
}

backfill().catch(err => {
    console.error(err);
    process.exit(1);
});
