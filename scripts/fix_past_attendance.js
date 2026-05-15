/**
 * Script to fix past attendance data by merging duplicate records for the same day.
 * This handles cases where multiple 'In' records were created instead of linking an 'Out' time.
 */
const { PrismaClient } = require('@prisma/client');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const prisma = new PrismaClient();
const TZ = 'Asia/Kolkata';

async function fixPastData() {
    console.log('🔍 Starting to scan for duplicate attendance records...');

    // 1. Fetch all timesheets grouped by employee and date to find duplicates
    // We'll iterate through all timesheets and find those with the same (employeeId, date)
    const timesheets = await prisma.timesheet.findMany({
        orderBy: [
            { employeeId: 'asc' },
            { date: 'asc' },
            { inAt: 'asc' }
        ],
        include: {
            employee: { include: { contact: true } }
        }
    });

    console.log(`📊 Total records found: ${timesheets.length}`);

    const duplicates = [];
    let currentGroup = [];

    for (let i = 0; i < timesheets.length; i++) {
        const ts = timesheets[i];
        const nextTs = timesheets[i + 1];

        currentGroup.push(ts);

        const isLastInGroup = !nextTs || 
            nextTs.employeeId !== ts.employeeId || 
            dayjs(nextTs.date).format('YYYY-MM-DD') !== dayjs(ts.date).format('YYYY-MM-DD');

        if (isLastInGroup) {
            if (currentGroup.length > 1) {
                duplicates.push([...currentGroup]);
            }
            currentGroup = [];
        }
    }

    console.log(`⚠️ Found ${duplicates.length} instances of duplicate records for the same day.`);

    let fixedCount = 0;

    for (const group of duplicates) {
        // Sort by inAt to find the "primary" record (earliest start)
        group.sort((a, b) => {
            if (!a.inAt) return 1;
            if (!b.inAt) return -1;
            return a.inAt.getTime() - b.inAt.getTime();
        });

        const primary = group[0];
        const others = group.slice(1);

        // Calculate merged data
        const earliestIn = primary.inAt;
        const latestOut = group.reduce((max, r) => {
            if (!r.outAt) return max;
            if (!max) return r.outAt;
            return r.outAt > max ? r.outAt : max;
        }, null);

        // If the latest "In" in the group is actually an "Out" punch (happened much later)
        // but outAt is null, we should use that In time as the outAt.
        let finalOut = latestOut;
        if (!finalOut) {
            const lastRecord = group[group.length - 1];
            if (lastRecord.id !== primary.id && lastRecord.inAt) {
                // If the last record started at least 2 hours after the first record, 
                // treat its start as the 'Out' time of the primary record.
                const diffHrs = (lastRecord.inAt.getTime() - primary.inAt.getTime()) / 3600000;
                if (diffHrs > 1) {
                    finalOut = lastRecord.inAt;
                }
            }
        }

        // Merge punches
        let mergedPunches = [];
        group.forEach(r => {
            let p = r.punches;
            if (typeof p === 'string') try { p = JSON.parse(p); } catch(e) { p = []; }
            if (Array.isArray(p)) mergedPunches = [...mergedPunches, ...p];
        });

        // Unique punches by time
        const seen = new Set();
        mergedPunches = mergedPunches.filter(p => {
            const t = new Date(p.time).getTime();
            if (seen.has(t)) return false;
            seen.add(t);
            return true;
        }).sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

        console.log(`🛠️  Merging ${group.length} records for ${primary.employee.contact.firstName} on ${dayjs(primary.date).format('YYYY-MM-DD')}`);
        console.log(`   -> New In: ${earliestIn ? dayjs(earliestIn).tz(TZ).format('HH:mm') : '-'}, New Out: ${finalOut ? dayjs(finalOut).tz(TZ).format('HH:mm') : '-'}`);

        // Update primary
        await prisma.timesheet.update({
            where: { id: primary.id },
            data: {
                inAt: earliestIn,
                outAt: finalOut,
                punches: mergedPunches,
                remarks: (primary.remarks || '') + (others.map(o => o.remarks).filter(Boolean).length ? ' [Merged Records]' : '')
            }
        });

        // Delete others
        const idsToDelete = others.map(o => o.id);
        await prisma.timesheet.deleteMany({
            where: { id: { in: idsToDelete } }
        });

        fixedCount += others.length;
    }

    console.log(`\n✅ Finished! Merged ${fixedCount} redundant records.`);
}

fixPastData()
    .catch(err => {
        console.error('❌ Error fixing data:', err);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
