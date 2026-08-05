/**
 * ESSL ADMS / iClock Protocol Handler
 * Handles communication with ESSL biometric devices
 */
const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

const time = require('../lib/time');
const { processDevicePunch } = require('../lib/punchProcessor');

const TZ = 'Asia/Kolkata';

// Parse raw text body for ADMS updates (sometimes sent as text/plain or octet-stream)
router.use(express.text({ type: '*/*', limit: '10mb' }));

/**
 * Shared per-punch pipeline:
 *  - create/find the DeviceLog entry,
 *  - resolve the employee (auto-creating from device user if missing),
 *  - delegate to the punch processor to attach/create the timesheet,
 *  - mark the log processed.
 */
async function handlePunch({ device, userId, punchTime, verifyMode, inOutMode, rawLine }) {
    if (!userId || !punchTime) return false;

    // Create (or find) the raw device log
    let currentLog = await prisma.deviceLog.findFirst({
        where: { deviceId: device.id, userId, punchTime },
    });

    if (!currentLog) {
        currentLog = await prisma.deviceLog.create({
            data: {
                tenantId: device.tenantId,
                deviceId: device.id,
                rawData: rawLine,
                userId,
                punchTime,
                processed: false,
            },
        });
    } else if (currentLog.processed) {
        // Already processed, skip (idempotent)
        return false;
    }

    // Resolve employee
    let employee = await prisma.employee.findFirst({
        where: { tenantId: device.tenantId, employeeCode: userId },
    });

    if (!employee) {
        try {
            const newContact = await prisma.contact.create({
                data: { tenantId: device.tenantId, firstName: 'Device User', lastName: userId },
            });
            employee = await prisma.employee.create({
                data: {
                    tenantId: device.tenantId,
                    contactId: newContact.id,
                    employeeCode: userId,
                    joiningDate: new Date(),
                    type: 'full_time',
                    status: 'active',
                },
            });
            const bcrypt = require('bcryptjs');
            const passwordHash = await bcrypt.hash(userId, 10);
            await prisma.user.create({
                data: { tenantId: device.tenantId, username: userId, passwordHash, role: 'employee', employeeId: employee.id },
            });
            console.log(`[iClock] Auto-created employee & user ${userId} from device ${device.serialNumber}`);
        } catch (err) {
            console.error(`[iClock] Failed to auto-create employee ${userId}:`, err);
        }
    }

    if (!employee) return false;

    const result = await processDevicePunch({
        device,
        employee,
        punchTime,
        inOutMode,
        verifyMode,
        sn: device.serialNumber,
    });
    console.log(`[iClock] ${device.serialNumber} emp=${userId} ${time.dayStrIST(punchTime)} ${time.timeStrIST(punchTime)} → ${result.action} (ts#${result.timesheetId || '-'})`);

    // Mark log as processed
    await prisma.deviceLog.updateMany({
        where: { deviceId: device.id, userId, punchTime, processed: false },
        data: { processed: true },
    });

    return true;
}

// GET /iclock/cdata — Device registration & config pull
router.get(['/cdata', '/cdata.aspx'], async (req, res, next) => {
    try {
        const { SN, options } = req.query;

        if (!SN) {
            return res.status(400).send('ERROR: No serial number');
        }

        // Find device by serial number
        const device = await prisma.device.findFirst({
            where: { serialNumber: SN },
        });

        if (!device) {
            console.log(`[iClock] Unknown device: ${SN}`);
            return res.send('OK');
        }

        // Update last seen
        await prisma.device.update({
            where: { id: device.id },
            data: { lastSeenAt: new Date(), status: 'active' },
        });

        if (options === 'all') {
            // Device is requesting its full config
            const config = [
                'GET OPTION FROM: ' + SN,
                'Registry=1',
                'Stamp=1',
                'OpStamp=1',
                'PhotoStamp=1',
                'ErrorDelay=60',
                'Delay=30',
                'TransTimes=00:00;14:05',
                'TransInterval=1',
                'TransFlag=TransData AttLog\tOpLog\tAttPhoto\tEnrollUser\tEnrollFP\tFPImag',
                'ServerVer=2.4.1',
                'ATTLOGStamp=0',
                'OPERLOGStamp=0',
            ].join('\r\n') + '\r\n';
            return res.send(config);
        }

        res.send('OK\r\n');
    } catch (error) {
        console.error('[iClock] GET error:', error);
        res.status(500).send('ERROR\r\n');
    }
});

// POST /iclock/cdata — Receive attendance/operation logs
router.post(['/cdata', '/cdata.aspx'], async (req, res, next) => {
    try {
        const { SN, table } = req.query;

        if (!SN) {
            return res.status(400).send('ERROR: No SN');
        }

        const device = await prisma.device.findFirst({
            where: { serialNumber: SN },
        });

        if (!device) {
            console.log(`[iClock] POST from unknown device: ${SN}`);
            return res.send('OK: 0');
        }

        // Update last seen
        await prisma.device.update({
            where: { id: device.id },
            data: { lastSeenAt: new Date(), status: 'active' },
        });

        // Robust body capture: Some ADMS devices don't send Content-Type, so express.text might fail.
        let rawBody = (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) || '';

        if (!rawBody || rawBody === '{}' || rawBody.length === 0) {
            // Try to read the raw stream manually if body is empty
            const buffers = [];
            for await (const chunk of req) {
                buffers.push(chunk);
            }
            if (buffers.length > 0) {
                rawBody = Buffer.concat(buffers).toString();
            }
        }

        if (!rawBody || rawBody.length === 0) {
            // Heartbeat POST or really empty
            return res.send('OK: 0\r\n');
        }

        if (table === 'OPERLOG') {
            // Operation log — ignore for now
            return res.send('OK: 0\r\n');
        }

        // Parse attendance log lines
        // Format: userId\tdateTime\tverifyMode\tinOutMode\tworkCode
        const lines = rawBody.split('\n').filter(l => l.trim());
        let processed = 0;

        for (const line of lines) {
            try {
                // Support both tab-separated and space-separated data
                let parts = line.split('\t');
                if (parts.length < 2) {
                    parts = line.split(/\s+/).filter(p => p.trim());
                }

                if (parts.length < 2) {
                    console.log(`[iClock] Skipping malformed line: ${line}`);
                    continue;
                }

                const userId = parts[0].trim();
                const dateTimeStr = parts[1] + (parts[1].length < 11 && parts[2] ? ' ' + parts[2] : '');
                const verifyMode = parts[3]?.trim() || '0';
                const inOutMode = parts[4]?.trim() || '0';

                if (!userId || !dateTimeStr) continue;

                // Parse as local time (Asia/Kolkata) because devices are in India
                const punchTime = time.parseDeviceDateTime(dateTimeStr);
                if (!punchTime) {
                    console.log(`[iClock] Skipping unparseable date: ${dateTimeStr}`);
                    continue;
                }

                if (await handlePunch({ device, userId, punchTime, verifyMode, inOutMode, rawLine: line })) {
                    processed++;
                }
            } catch (lineError) {
                console.error(`[iClock] Error processing line: ${line}`, lineError.message);
            }
        }

        console.log(`[iClock] Device ${SN}: processed ${processed}/${lines.length} records`);
        return res.send(`OK: ${processed}\r\n`);
    } catch (error) {
        console.error('[iClock] POST error:', error);
        res.status(500).send('ERROR');
    }
});

// POST /iclock/DeviceLogsPost — AI device JSON attendance logs (AiFace Orcus)
router.post(['/DeviceLogsPost', '/DeviceLogsPost.aspx'], async (req, res, next) => {
    try {
        // AI devices send JSON: { TableName: 'ATTLOG', Rec: [ { ENROLLNO, ATT_TIME, VerifyCode, SN, ... } ] }
        const data = Array.isArray(req.body) ? req.body : (req.body.Rec || req.body);

        if (!data || !Array.isArray(data) || data.length === 0) {
            return res.json({ Code: 200, Message: 'OK' });
        }

        let processedCount = 0;
        for (const record of data) {
            try {
                const userId = record.ENROLLNO || record.EmployeeId || '';
                const dateTimeStr = record.ATT_TIME || record.PunchTime || '';
                const deviceSn = record.SN || record.DeviceSerial || '';
                const verifyMode = record.VerifyCode || record.VerifyMode || '0';
                const inOutMode = record.InOutMode || record.State || '0';

                if (!userId || !dateTimeStr) continue;

                // Find device by serial or use query SN
                const sn = req.query.SN || deviceSn;
                const device = await prisma.device.findFirst({
                    where: { serialNumber: sn },
                });

                if (!device) {
                    console.log(`[AI Device] Unknown device: ${sn}`);
                    continue;
                }

                // Parse punch time (IST wall clock)
                const punchTime = time.parseDeviceDateTime(dateTimeStr);
                if (!punchTime) {
                    console.log(`[AI Device] Unparseable time: ${dateTimeStr}`);
                    continue;
                }

                await prisma.deviceLog.create({
                    data: {
                        tenantId: device.tenantId,
                        deviceId: device.id,
                        rawData: JSON.stringify(record),
                        userId,
                        punchTime,
                        processed: false,
                    },
                });

                if (await handlePunch({ device, userId, punchTime, verifyMode, inOutMode, rawLine: JSON.stringify(record) })) {
                    processedCount++;
                }
            } catch (err) {
                console.error('[AI Device] Record error:', err);
            }
        }

        console.log(`[AI Device] Processed ${processedCount} records`);
        res.json({ Code: 200, Message: `Processed ${processedCount} records` });
    } catch (error) {
        console.error('[AI Device] Error:', error);
        res.status(500).json({ Code: 500, Message: error.message });
    }
});

// GET /iclock/getrequest — Device polls for pending commands
router.get(['/getrequest', '/getrequest.aspx'], async (req, res, next) => {
    try {
        const { SN } = req.query;
        if (!SN) return res.send('OK');

        // Update last seen heartbeat
        const device = await prisma.device.findFirst({ where: { serialNumber: SN } });
        if (device) {
            await prisma.device.update({
                where: { id: device.id },
                data: { lastSeenAt: new Date(), status: 'active' },
            });
        }

        // Check for pending commands
        if (device) {
            const cmd = await prisma.deviceCommand.findFirst({
                where: { deviceId: device.id, status: 'pending' },
                orderBy: { createdAt: 'asc' },
            });

            if (cmd) {
                // Send command: C:ID:COMMAND
                const payload = `C:${cmd.id}:${cmd.command}\r\n`;
                await prisma.deviceCommand.update({
                    where: { id: cmd.id },
                    data: { status: 'sent' },
                });
                console.log(`[iClock] Sending command to ${SN}: ${payload.trim()}`);
                return res.send(payload);
            }
        }

        res.send('OK\r\n');
    } catch (error) {
        console.error('[iClock] GET request error:', error);
        res.send('OK\r\n');
    }
});

// POST /iclock/devicecmd — Device command response
router.post(['/devicecmd', '/devicecmd.aspx'], async (req, res, next) => {
    try {
        // ID=123&Return=0
        let bodyObj = req.body || {};
        if (typeof req.body === 'string') {
            try {
                bodyObj = require('querystring').parse(req.body);
            } catch (e) {
                // Not URL encoded, try to look at query as fallback
            }
        }

        let ID = bodyObj.ID || req.query.ID;
        let Return = bodyObj.Return !== undefined ? bodyObj.Return : req.query.Return;

        if (ID) {
            const cmdId = parseInt(ID);
            // Update command status
            await prisma.deviceCommand.updateMany({
                where: { id: cmdId },
                data: {
                    status: Return == 0 ? 'executed' : 'failed',
                    response: JSON.stringify(bodyObj),
                    updatedAt: new Date(),
                },
            });
            console.log(`[iClock] Command ${cmdId} response: ${Return}`);
        }
        res.send('OK\r\n');
    } catch (error) {
        console.error('[iClock] devicecmd error:', error);
        res.send('OK\r\n');
    }
});

module.exports = router;
