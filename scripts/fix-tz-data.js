const prisma = require('../src/lib/prisma');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Kolkata';

async function runFix() {
    console.log('--- STARTING TIMEZONE DATA FIX (Terminal) ---');
    
    // Target date: May 9th (where the misplaced records are)
    const targetDate = dayjs.tz('2026-05-09', TZ).startOf('day').toDate();
    
    try {
        const timesheets = await prisma.timesheet.findMany({
            where: {
                date: targetDate
            }
        });

        console.log(`Checking ${timesheets.length} records on May 9th...`);
        let movedCount = 0;

        for (const ts of timesheets) {
            const inAt = ts.inAt ? dayjs.tz(ts.inAt, TZ) : null;
            // If the actual punch happened on May 10th, move it
            if (inAt && inAt.format('YYYY-MM-DD') === '2026-05-10') {
                console.log(`Moving TS ${ts.id} (Employee ID: ${ts.employeeId}) -> May 10th`);
                await prisma.timesheet.update({
                    where: { id: ts.id },
                    data: { date: dayjs.tz('2026-05-10', TZ).startOf('day').toDate() }
                });
                movedCount++;
            }
        }

        console.log(`\nSUCCESS: Moved ${movedCount} records.`);
    } catch (error) {
        console.error('FAILED:', error);
    } finally {
        await prisma.$disconnect();
        process.exit(0);
    }
}

runFix();
