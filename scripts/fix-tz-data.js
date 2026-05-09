const prisma = require('../src/lib/prisma');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Kolkata';

async function runGlobalFix() {
    console.log('--- STARTING GLOBAL TIMEZONE DATA REPAIR ---');
    console.log('Target Timezone: Asia/Kolkata (IST)');
    
    try {
        // Fetch all timesheets from the last 30 days (or more if needed)
        // We focus on recent ones but can remove the date filter to scan everything
        const timesheets = await prisma.timesheet.findMany({
            where: {
                inAt: { not: null }
            },
            include: {
                employee: true
            }
        });

        console.log(`Scanning ${timesheets.length} total records...`);
        let movedCount = 0;

        for (const ts of timesheets) {
            const actualPunchDate = dayjs.tz(ts.inAt, TZ).format('YYYY-MM-DD');
            const recordedDate = dayjs.tz(ts.date, TZ).format('YYYY-MM-DD');

            // If they don't match, the record is on the wrong day
            if (actualPunchDate !== recordedDate) {
                console.log(`[FIX] TS ${ts.id} (Emp: ${ts.employee.employeeCode})`);
                console.log(`      Recorded: ${recordedDate}, Actual: ${actualPunchDate} (at ${dayjs.tz(ts.inAt, TZ).format('HH:mm')})`);
                
                const correctDate = dayjs.tz(actualPunchDate, TZ).startOf('day').toDate();
                
                await prisma.timesheet.update({
                    where: { id: ts.id },
                    data: { date: correctDate }
                });
                movedCount++;
            }
        }

        console.log(`\nSUCCESS: Repaired ${movedCount} historical records.`);
    } catch (error) {
        console.error('ERROR during repair:', error);
    } finally {
        await prisma.$disconnect();
        process.exit(0);
    }
}

runGlobalFix();
