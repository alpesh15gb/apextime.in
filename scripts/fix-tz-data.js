const prisma = require('../src/lib/prisma');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Kolkata';

async function runGlobalFix() {
    console.log('--- STARTING GLOBAL TIMEZONE DATA REPAIR (v2) ---');
    console.log('Rule: Date column must match inAt date in IST.');
    
    try {
        const timesheets = await prisma.timesheet.findMany({
            where: {
                inAt: { not: null }
            },
            include: {
                employee: { include: { contact: true } }
            }
        });

        console.log(`Scanning ${timesheets.length} records...`);
        let repairedCount = 0;

        for (const ts of timesheets) {
            const actualPunchDateStr = dayjs.tz(ts.inAt, TZ).format('YYYY-MM-DD');
            const recordedDateStr = dayjs.utc(ts.date).format('YYYY-MM-DD');

            if (actualPunchDateStr !== recordedDateStr) {
                console.log(`[FIX] TS ${ts.id} (${ts.employee.contact.firstName})`);
                console.log(`      Recorded: ${recordedDateStr}, Actual: ${actualPunchDateStr}`);
                
                // Use UTC to ensure the DATE column stores the exact string
                const correctDbDate = dayjs.utc(actualPunchDateStr).toDate();
                
                await prisma.timesheet.update({
                    where: { id: ts.id },
                    data: { date: correctDbDate }
                });
                repairedCount++;
            }
        }

        console.log(`\nSUCCESS: Repaired ${repairedCount} records.`);
    } catch (error) {
        console.error('ERROR:', error);
    } finally {
        await prisma.$disconnect();
        process.exit(0);
    }
}

runGlobalFix();
