process.env.DATABASE_URL = 'postgresql://apextime:apextime123@localhost:5433/apextime_in';
const prisma = require('../src/lib/prisma');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Kolkata';

async function fix() {
    console.log('Starting data fix for timezone shift (Asia/Kolkata)...');
    
    // Target date: May 9th (where the wrong records are)
    const targetDate = dayjs.tz('2026-05-09', TZ).startOf('day').toDate();
    const records = await prisma.timesheet.findMany({
        where: {
            date: targetDate
        }
    });
    
    console.log(`Found ${records.length} records on 2026-05-09.`);
    let moved = 0;
    
    for (const ts of records) {
        const inAt = ts.inAt ? dayjs.tz(ts.inAt, TZ) : null;
        // If it starts on the 10th (today), it's definitely misplaced
        if (inAt && inAt.format('YYYY-MM-DD') === '2026-05-10') {
            console.log(`Moving TS ${ts.id} (Emp: ${ts.employeeId}) to May 10th.`);
            await prisma.timesheet.update({
                where: { id: ts.id },
                data: { date: dayjs.tz('2026-05-10', TZ).startOf('day').toDate() }
            });
            moved++;
        }
    }
    
    console.log(`Finished. Moved ${moved} records.`);
    await prisma.$disconnect();
}

fix().catch(console.error);
