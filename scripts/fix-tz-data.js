const prisma = require('../src/lib/prisma');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Kolkata';

async function repairAndMerge() {
    console.log('--- STARTING GLOBAL REPAIR & MERGE (v3) ---');
    
    try {
        // 1. Repair Dates (ensure date column matches inAt)
        const allRecords = await prisma.timesheet.findMany({
            where: { inAt: { not: null } },
            include: { employee: { include: { contact: true } } }
        });

        console.log(`Checking ${allRecords.length} records for date alignment...`);
        for (const ts of allRecords) {
            const actualDateStr = dayjs.tz(ts.inAt, TZ).format('YYYY-MM-DD');
            const recordedDateStr = dayjs.utc(ts.date).format('YYYY-MM-DD');

            if (actualDateStr !== recordedDateStr) {
                await prisma.timesheet.update({
                    where: { id: ts.id },
                    data: { date: dayjs.utc(actualDateStr).toDate() }
                });
            }
        }

        // 2. Merge Duplicates (Employees with multiple records on the same day)
        console.log('Checking for duplicates to merge...');
        const duplicates = await prisma.$queryRaw`
            SELECT employee_id, date, COUNT(*) 
            FROM timesheets 
            GROUP BY employee_id, date 
            HAVING COUNT(*) > 1
        `;

        console.log(`Found ${duplicates.length} sets of duplicates.`);

        for (const dup of duplicates) {
            const records = await prisma.timesheet.findMany({
                where: {
                    employeeId: dup.employee_id,
                    date: dup.date
                },
                orderBy: { inAt: 'asc' }
            });

            const primary = records[0];
            const others = records.slice(1);

            let mergedPunches = Array.isArray(primary.punches) ? primary.punches : JSON.parse(primary.punches || '[]');
            let latestOut = primary.outAt;
            let earliestIn = primary.inAt;

            for (const other of others) {
                const otherPunches = Array.isArray(other.punches) ? other.punches : JSON.parse(other.punches || '[]');
                mergedPunches = [...mergedPunches, ...otherPunches];
                
                if (other.inAt && (!earliestIn || other.inAt < earliestIn)) earliestIn = other.inAt;
                if (other.outAt && (!latestOut || other.outAt > latestOut)) latestOut = other.outAt;
                
                // Delete the duplicate
                await prisma.timesheet.delete({ where: { id: other.id } });
            }

            // Sort punches by time
            mergedPunches.sort((a, b) => new Date(a.time) - new Date(b.time));

            // Update primary record
            await prisma.timesheet.update({
                where: { id: primary.id },
                data: {
                    inAt: earliestIn,
                    outAt: latestOut,
                    punches: mergedPunches
                }
            });
            console.log(`Merged ${records.length} records for Emp ID ${dup.employee_id} on ${dayjs.utc(dup.date).format('YYYY-MM-DD')}`);
        }

        console.log('\nSUCCESS: Data alignment and merging complete.');
    } catch (error) {
        console.error('ERROR:', error);
    } finally {
        await prisma.$disconnect();
        process.exit(0);
    }
}

repairAndMerge();
