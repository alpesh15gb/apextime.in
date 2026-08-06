/**
 * Shared "rebuild employee days" core.
 *
 * Rebuild ONE employee's timesheets from their RAW device logs (the ground
 * truth) by replaying every punch through the production punch processor
 * (src/lib/punchProcessor.js).
 *
 * WHY THIS EXISTS: the heuristic repair (repair-attendance-data.js) splits an
 * implausible span at its LARGEST internal gap. When a glued sheet actually
 * contains punches from TWO real shifts, that heuristic can pick the wrong
 * boundary. The raw device logs never lie — replaying them through the
 * mispunch-guarded processor re-derives the correct in/out pairing
 * automatically. This is the exact logic that was previously inlined in
 * scripts/rebuild-employee-days.js; it is now shared by the single-employee
 * CLI and scripts/rebuild-all-employees.js so both behave identically.
 *
 * SAFETY:
 *  - The caller decides whether to WRITE (apply=false → dry run, nothing touched).
 *  - Every sheet that would be deleted is returned in `backupRows` so the
 *    caller can persist it to backups/ before any change is written.
 *  - Only device-sourced sheets are replaced; mobile/manual sheets are kept.
 *  - Rebuilt sheets are tagged meta.rebuild_created so scripts/restore-repair.js
 *    can undo the operation exactly.
 *
 * @param {object} opts
 *   employee   – prisma Employee row (must include tenantId, employeeCode, id)
 *   sinceArg   – 'YYYY-MM-DD' or null (null → earliest device log = full history)
 *   apply      – boolean; when false nothing is written
 *   log        – optional fn(text) for progress lines
 * @returns {Promise<object>} summary { employee, since, replaySince, logs,
 *   sheets, manual, backupRows, created, attached, dup, createdIds, result }
 */
const fs = require('fs');
const path = require('path');
const prisma = require('./prisma');
const time = require('./time');
const { processDevicePunch } = require('./punchProcessor');

// Mirror the punch processor's open-sheet lookback. The processor may attach a
// replayed punch to an OPEN sheet whose inAt is up to this far before the punch
// time, so the delete/replay window must start LOOKBACK before --since —
// otherwise a pre-window open sheet would be mutated WITHOUT being in the
// backup, making the undo incomplete.
const LOOKBACK_OPEN_HOURS = 48;

async function rebuildEmployeeDays({ employee, sinceArg = null, apply = false, log = () => {} }) {
    const out = { log };

    // Window start: explicit --since, else the employee's earliest device log.
    let since;
    if (sinceArg) {
        since = time.utcDate(sinceArg);
    } else {
        const earliest = await prisma.deviceLog.findFirst({
            where: { tenantId: employee.tenantId, userId: employee.employeeCode },
            orderBy: { punchTime: 'asc' },
        });
        since = earliest ? earliest.punchTime : new Date(0);
    }
    // The EFFECTIVE window starts LOOKBACK before `since` so any open sheet the
    // processor could reach from a replayed punch is inside the backed-up range.
    const replaySince = new Date(since.getTime() - LOOKBACK_OPEN_HOURS * 3600000);

    // Raw device logs = ground truth.
    const logs = await prisma.deviceLog.findMany({
        where: { tenantId: employee.tenantId, userId: employee.employeeCode, punchTime: { gte: replaySince } },
        orderBy: { punchTime: 'asc' },
    });

    // Device-sourced sheets in window (these get deleted and re-derived).
    const sheets = await prisma.timesheet.findMany({
        where: { tenantId: employee.tenantId, employeeId: employee.id, source: 'device', inAt: { gte: replaySince } },
        orderBy: { inAt: 'asc' },
    });

    // Non-device sheets in window are preserved (processor may still merge into them).
    const manual = await prisma.timesheet.findMany({
        where: { tenantId: employee.tenantId, employeeId: employee.id, source: { not: 'device' }, inAt: { gte: replaySince } },
        orderBy: { inAt: 'asc' },
    });

    const summary = {
        employeeId: employee.id,
        employeeCode: employee.employeeCode,
        tenantId: employee.tenantId,
        since,
        replaySince,
        logs,
        sheets,
        manual,
        logCount: logs.length,
        sheetCount: sheets.length,
        manualCount: manual.length,
        backupRows: sheets.map(s => ({ ...s, punches: s.punches || [] })),
        created: 0,
        attached: 0,
        dup: 0,
        createdIds: [],
        result: [],
    };

    if (!apply) {
        return summary;
    }

    // 1. Delete device-sourced sheets in window
    for (const s of sheets) {
        await prisma.timesheet.delete({ where: { id: s.id } });
    }

    // 2. Replay raw logs in chronological order through the punch processor
    for (const logEntry of logs) {
        const device = await prisma.device.findUnique({ where: { id: logEntry.deviceId } });
        if (!device) {
            log(`  [skip] log#${logEntry.id} device ${logEntry.deviceId} missing`);
            continue;
        }
        let inOutMode = '0';
        if (logEntry.rawData) {
            const parts = String(logEntry.rawData).split(/[\t ]+/).filter(Boolean);
            if (parts.length >= 5) inOutMode = parts[4];
        }
        const res = await processDevicePunch({
            device,
            employee,
            punchTime: logEntry.punchTime,
            inOutMode,
            verifyMode: '0',
            sn: device.serialNumber,
        });
        const stamp = `${time.dayStrIST(logEntry.punchTime)} ${time.timeStrIST(logEntry.punchTime)}`;
        if (res.created) { summary.created++; summary.createdIds.push(res.timesheetId); log(`  [create] ${stamp} → ts#${res.timesheetId} (${res.action})`); }
        else if (res.action === 'duplicate') { summary.dup++; }
        else { summary.attached++; log(`  [attach] ${stamp} → ts#${res.timesheetId} (${res.action})`); }
    }

    // 3. Tag rebuilt sheets so restore-repair.js can undo exactly
    for (const id of summary.createdIds) {
        const t = await prisma.timesheet.findUnique({ where: { id } });
        if (t) {
            const meta = (t.meta && typeof t.meta === 'object') ? t.meta : {};
            await prisma.timesheet.update({ where: { id }, data: { meta: { ...meta, rebuild_created: true } } });
        }
    }

    // 4. Result state
    summary.result = await prisma.timesheet.findMany({
        where: { tenantId: employee.tenantId, employeeId: employee.id, inAt: { gte: replaySince } },
        orderBy: { inAt: 'asc' },
    });

    return summary;
}

/**
 * Persist a backup file for the given backup rows (call BEFORE writing).
 * Returns the backup file path.
 */
function writeBackup(kind, rows, employeeRefs) {
    const dir = path.join(__dirname, '..', 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `timesheets-rebuild-${kind}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({
        meta: { kind: 'rebuild', run: kind, employees: employeeRefs, ts: new Date().toISOString() },
        rows,
    }, null, 2));
    return file;
}

module.exports = { rebuildEmployeeDays, writeBackup, LOOKBACK_OPEN_HOURS };
