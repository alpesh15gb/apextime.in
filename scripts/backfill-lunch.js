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
            const punches = [];
            let lastPunchTime = null;

            for (const log of logs) {
                const punchTime = log.punchTime;
                
                // Filter duplicates (2-min gap)
                if (!lastPunchTime || dayjs(punchTime).diff(dayjs(lastPunchTime)) >= 120000) {
                    punches.push({
                        time: punchTime,
                        device_sn: 'HISTORY',
                        type: 'auto'
                    });
                    lastPunchTime = punchTime;
                }
            }

            const updateData = {
                punches,
                inAt: punches[0].time,
                outAt: punches[punches.length - 1].time
            };

            // Smart lunch identification
            if (punches.length >= 2) {
                updateData.lunchOutAt = punches[1].time;
            }
            if (punches.length >= 3) {
                updateData.lunchInAt = punches[2].time;
            }

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
