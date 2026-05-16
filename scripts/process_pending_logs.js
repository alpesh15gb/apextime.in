const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TZ = 'Asia/Kolkata';

async function processLogs() {
    console.log('🚀 Manually processing all pending device logs...');
    
    const logs = await prisma.deviceLog.findMany({
        where: { processed: false },
        orderBy: { punchTime: 'asc' } // Process in chronological order
    });

    console.log(`Found ${logs.length} logs to process.`);

    for (const log of logs) {
        try {
            const { userId, punchTime, deviceId, tenantId, rawData } = log;
            
            // Find employee
            const employee = await prisma.employee.findFirst({
                where: { tenantId, employeeCode: userId },
            });

            if (!employee) {
                console.log(`[Skip] No employee found for code ${userId}`);
                await prisma.deviceLog.update({ where: { id: log.id }, data: { processed: true } });
                continue;
            }

            const nowIST = dayjs.tz(punchTime, TZ);
            const dateStr = nowIST.format('YYYY-MM-DD');

            // Find timesheet
            let lookbackHours = 22;
            let timesheet = await prisma.timesheet.findFirst({
                where: {
                    tenantId,
                    employeeId: employee.id,
                    inAt: {
                        gte: dayjs(punchTime).subtract(lookbackHours, 'hour').toDate(),
                        lte: punchTime
                    }
                },
                orderBy: { inAt: 'desc' }
            });

            if (timesheet) {
                // Update
                let existingPunches = timesheet.punches || [];
                if (typeof existingPunches === 'string') try { existingPunches = JSON.parse(existingPunches); } catch (e) {}
                if (!Array.isArray(existingPunches)) existingPunches = [];

                const lastPunch = existingPunches[existingPunches.length - 1];
                const lastPunchRawTime = lastPunch ? (lastPunch.time?.value || lastPunch.time) : timesheet.inAt;
                const lastPunchTime = dayjs(lastPunchRawTime);
                const diffFromLastMs = dayjs(punchTime).diff(lastPunchTime);
                
                const isDuplicate = !isNaN(diffFromLastMs) && diffFromLastMs < 120000 && diffFromLastMs >= 0;

                if (!isDuplicate) {
                    const newPunch = { time: punchTime, device_sn: 'REPROCESS', type: 'auto' };
                    const updatedPunches = [...existingPunches, newPunch];
                    
                    await prisma.timesheet.update({
                        where: { id: timesheet.id },
                        data: { 
                            punches: updatedPunches,
                            outAt: punchTime 
                        },
                    });
                }
            } else {
                // Create
                const firstPunch = { time: punchTime, device_sn: 'REPROCESS', type: 'in' };
                const dbDate = dayjs.utc(dateStr).toDate();
                
                await prisma.timesheet.create({
                    data: {
                        tenantId,
                        employeeId: employee.id,
                        date: dbDate,
                        inAt: punchTime,
                        outAt: null, 
                        punches: [firstPunch],
                        source: 'device',
                        status: 'auto_approved'
                    },
                });
            }

            // Mark as processed
            await prisma.deviceLog.update({
                where: { id: log.id },
                data: { processed: true }
            });

        } catch (err) {
            console.error(`Error processing log ${log.id}:`, err);
        }
    }

    console.log('✅ All pending logs have been processed!');
}

processLogs()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
