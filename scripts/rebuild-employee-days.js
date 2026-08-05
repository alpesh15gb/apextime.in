/**
 * Rebuild ONE employee's timesheets from their RAW device logs (the ground
 * truth) by replaying every punch through the production punch processor
 * (src/lib/punchProcessor.js).
 *
 * WHY THIS EXISTS: the heuristic repair (repair-attendance-data.js) splits an
 * implausible span at its LARGEST internal gap. When a glued sheet actually
 * contains punches from TWO real shifts, that heuristic can pick the wrong
 * boundary. Employee 1303's 31-07 sheet [17:31 31-07, 02:40 01-08, 09:02 01-08]
 * was split into "17:31 → open" + a bogus "02:40 → 09:02" sheet, when the truth
 * is 17:31→02:40 (9h09m night shift) and 09:02→18:16 (next day). The raw device
 * logs never lie — replaying them through the mispunch-guarded processor
 * re-derives the correct in/out pairing automatically.
 *
 * SAFETY:
 *  - DRY RUN by default — re-run with --apply to write.
 *  - Backs up every sheet it will delete to backups/ before touching the DB.
 *  - Only device-sourced sheets are replaced; mobile/manual sheets are kept.
 *  - Rebuilt sheets are tagged meta.rebuild_created so scripts/restore-repair.js
 *    can undo the operation exactly.
 *
 * USAGE:
 *   node scripts/rebuild-employee-days.js <employeeCode> [--since YYYY-MM-DD]      # dry run
 *   node scripts/rebuild-employee-days.js <employeeCode> [--since YYYY-MM-DD] --apply
 *
 * Without --since, the window starts at the employee's earliest device log
 * (i.e. the whole history is rebuilt). Example for the 1303 complaint window:
 *   node scripts/rebuild-employee-days.js 1303 --since 2026-07-25 --apply
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const prisma = require('../src/lib/prisma');
const time = require('../src/lib/time');
const { processDevicePunch } = require('../src/lib/punchProcessor');

const APPLY = process.argv.includes('--apply');
const code = process.argv[2];
const sinceIdx = process.argv.indexOf('--since');
const sinceArg = sinceIdx >= 0 ? process.argv[sinceIdx + 1] : null;

const BACKUP_DIR = path.join(__dirname, '..', 'backups');

// Mirror the punch processor's open-sheet lookback. The processor may attach a
// replayed punch to an OPEN sheet whose inAt is up to this far before the punch
// time, so the delete/replay window must start LOOKBACK before --since —
// otherwise a pre-window open sheet would be mutated WITHOUT being in the
// backup, making the undo incomplete.
const LOOKBACK_OPEN_HOURS = 48;

async function main() {
    if (!code) {
        console.error('Usage: node scripts/rebuild-employee-days.js <employeeCode> [--since YYYY-MM-DD] [--apply]');
        process.exit(1);
    }

    const employee = await prisma.employee.findFirst({ where: { employeeCode: code } });
    if (!employee) {
        console.error(`No employee with code ${code}`);
        process.exit(1);
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`REBUILD EMPLOYEE DAYS — ${APPLY ? 'APPLY MODE (writes DB)' : 'DRY RUN (no writes)'}`);
    console.log(`Employee: ${code} (id=${employee.id}, tenant=${employee.tenantId})`);
    console.log('='.repeat(70));

    // Window start: explicit --since, else the employee's earliest device log.
    let since;
    if (sinceArg) {
        since = time.utcDate(sinceArg);
    } else {
        const earliest = await prisma.deviceLog.findFirst({
            where: { tenantId: employee.tenantId, userId: code },
            orderBy: { punchTime: 'asc' },
        });
        since = earliest ? earliest.punchTime : new Date(0);
    }
    // The EFFECTIVE window starts LOOKBACK before `since` so any open sheet the
    // processor could reach from a replayed punch is inside the backed-up range.
    const replaySince = new Date(since.getTime() - LOOKBACK_OPEN_HOURS * 3600000);
    console.log(`Window: ${time.dayStrIST(replaySince)} → now (48h lookback before ${time.dayStrIST(since)})`);
    if (!sinceArg) console.log('  (no --since given → rebuilding the whole available history)');

    // Raw device logs = ground truth.
    const logs = await prisma.deviceLog.findMany({
        where: { tenantId: employee.tenantId, userId: code, punchTime: { gte: replaySince } },
        orderBy: { punchTime: 'asc' },
    });
    console.log(`\nRaw device logs in window: ${logs.length}`);
    for (const l of logs) {
        console.log(`  log#${l.id} ${time.dayStrIST(l.punchTime)} ${time.timeStrIST(l.punchTime)} mode=${String(l.rawData || '').split(/[\t ]+/).filter(Boolean)[4] || '?'}`);
    }

    // Device-sourced sheets in window (these get deleted and re-derived).
    const sheets = await prisma.timesheet.findMany({
        where: { tenantId: employee.tenantId, employeeId: employee.id, source: 'device', inAt: { gte: replaySince } },
        orderBy: { inAt: 'asc' },
    });
    console.log(`\nDevice-sourced sheets in window (will be replaced): ${sheets.length}`);
    for (const s of sheets) {
        const p = (s.punches || []).map(x => time.tz(new Date(x.time)).format('MM-DD HH:mm')).join(', ');
        console.log(`  ts#${s.id} date=${time.dayUTC(s.date).format('YYYY-MM-DD')} in=${s.inAt ? time.timeStrIST(s.inAt) : '-'} out=${s.outAt ? time.dayStrIST(s.outAt) + ' ' + time.timeStrIST(s.outAt) : '-'} punches=[${p}]`);
    }

    // Non-device sheets in window are preserved (processor may still merge into them).
    const manual = await prisma.timesheet.findMany({
        where: { tenantId: employee.tenantId, employeeId: employee.id, source: { not: 'device' }, inAt: { gte: replaySince } },
        orderBy: { inAt: 'asc' },
    });
    if (manual.length) {
        console.log(`\n⚠ Mobile/manual sheets in window (KEPT, not rebuilt): ${manual.length}`);
        for (const s of manual) console.log(`  ts#${s.id} src=${s.source} date=${time.dayUTC(s.date).format('YYYY-MM-DD')}`);
    }

    if (!APPLY) {
        console.log('\nDry run — nothing written. Re-run with --apply to rebuild.');
        console.log('A backup of every replaced sheet is written to backups/ before any change.');
        return;
    }

    // 1. Backup
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const backupFile = path.join(BACKUP_DIR, `timesheets-rebuild-${code}-${Date.now()}.json`);
    fs.writeFileSync(backupFile, JSON.stringify({
        meta: { kind: 'rebuild', employeeCode: code, employeeId: employee.id, tenantId: employee.tenantId, since: since.toISOString() },
        rows: sheets.map(s => ({ ...s, punches: s.punches || [] })),
    }, null, 2));
    console.log(`\nBackup written: ${backupFile} (${sheets.length} rows)`);

    // 2. Delete device-sourced sheets in window
    for (const s of sheets) {
        await prisma.timesheet.delete({ where: { id: s.id } });
    }
    console.log(`Deleted ${sheets.length} device-sourced sheets.`);

    // 3. Replay raw logs in chronological order through the punch processor
    let created = 0, attached = 0, dup = 0;
    const createdIds = [];
    for (const log of logs) {
        const device = await prisma.device.findUnique({ where: { id: log.deviceId } });
        if (!device) {
            console.log(`  [skip] log#${log.id} device ${log.deviceId} missing`);
            continue;
        }
        let inOutMode = '0';
        if (log.rawData) {
            const parts = String(log.rawData).split(/[\t ]+/).filter(Boolean);
            if (parts.length >= 5) inOutMode = parts[4];
        }
        const res = await processDevicePunch({
            device,
            employee,
            punchTime: log.punchTime,
            inOutMode,
            verifyMode: '0',
            sn: device.serialNumber,
        });
        const stamp = `${time.dayStrIST(log.punchTime)} ${time.timeStrIST(log.punchTime)}`;
        if (res.created) { created++; createdIds.push(res.timesheetId); console.log(`  [create] ${stamp} → ts#${res.timesheetId} (${res.action})`); }
        else if (res.action === 'duplicate') { dup++; }
        else { attached++; console.log(`  [attach] ${stamp} → ts#${res.timesheetId} (${res.action})`); }
    }

    // 4. Tag rebuilt sheets so restore-repair.js can undo exactly
    for (const id of createdIds) {
        const t = await prisma.timesheet.findUnique({ where: { id } });
        if (t) {
            const meta = (t.meta && typeof t.meta === 'object') ? t.meta : {};
            await prisma.timesheet.update({ where: { id }, data: { meta: { ...meta, rebuild_created: true } } });
        }
    }

    // 5. Show the result
    const result = await prisma.timesheet.findMany({
        where: { tenantId: employee.tenantId, employeeId: employee.id, inAt: { gte: replaySince } },
        orderBy: { inAt: 'asc' },
    });
    console.log(`\n✅ Rebuilt: ${created} created, ${attached} attached, ${dup} duplicates skipped.`);
    console.log(`Resulting sheets (${result.length}):`);
    for (const s of result) {
        console.log(`  ts#${s.id} src=${s.source} date=${time.dayUTC(s.date).format('YYYY-MM-DD')} in=${s.inAt ? time.timeStrIST(s.inAt) : '-'} out=${s.outAt ? time.dayStrIST(s.outAt) + ' ' + time.timeStrIST(s.outAt) : '-'}`);
    }
    console.log(`\nTo undo: node scripts/restore-repair.js ${backupFile} --apply`);
}

main().catch((e) => { console.error('ERROR:', e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
