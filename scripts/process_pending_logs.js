/**
 * Manually reprocess all pending (unprocessed) device logs.
 *
 * Uses the SAME punch processor as the live iClock endpoints
 * (src/lib/punchProcessor.js) so backlog recovery produces identical results.
 *
 * Usage: DATABASE_URL=... node scripts/process_pending_logs.js [--since YYYY-MM-DD]
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const time = require('../src/lib/time');
const { processDevicePunch } = require('../src/lib/punchProcessor');

async function processLogs() {
    const since = process.argv.includes('--since') ? process.argv[process.argv.indexOf('--since') + 1] : null;

    console.log('🚀 Reprocessing pending device logs...');

    const logs = await prisma.deviceLog.findMany({
        where: {
            processed: false,
            ...(since ? { punchTime: { gte: time.utcDate(since) } } : {}),
        },
        orderBy: { punchTime: 'asc' }, // chronological order for correct in/out pairing
    });

    console.log(`Found ${logs.length} logs to process.`);

    let processed = 0;
    for (const log of logs) {
        try {
            const { userId, punchTime, deviceId, tenantId, rawData } = log;

            const device = await prisma.device.findUnique({ where: { id: deviceId } });
            if (!device) {
                await prisma.deviceLog.update({ where: { id: log.id }, data: { processed: true, error: 'device missing' } });
                continue;
            }

            const employee = await prisma.employee.findFirst({
                where: { tenantId, employeeCode: userId },
            });

            if (!employee) {
                console.log(`[Skip] No employee found for code ${userId}`);
                await prisma.deviceLog.update({ where: { id: log.id }, data: { processed: true, error: 'no employee' } });
                continue;
            }

            // Recover inOutMode from the raw log line if present.
            let inOutMode = '0';
            if (rawData) {
                const parts = String(rawData).split(/[\t ]+/).filter(Boolean);
                if (parts.length >= 5) inOutMode = parts[4];
            }

            const result = await processDevicePunch({
                device,
                employee,
                punchTime,
                inOutMode,
                verifyMode: '0',
                sn: device.serialNumber,
            });
            console.log(`[OK] log#${log.id} ${userId} ${time.dayStrIST(punchTime)} ${time.timeStrIST(punchTime)} → ${result.action} (ts#${result.timesheetId || '-'})`);
            processed++;

            await prisma.deviceLog.update({ where: { id: log.id }, data: { processed: true } });
        } catch (err) {
            console.error(`Error processing log ${log.id}:`, err.message);
            await prisma.deviceLog.update({ where: { id: log.id }, data: { error: err.message.slice(0, 500) } });
        }
    }

    console.log(`✅ Processed ${processed}/${logs.length} pending logs.`);
}

processLogs()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
