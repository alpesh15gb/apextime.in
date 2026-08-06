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
 * The logic lives in src/lib/rebuildEmployeeDays.js (shared with
 * scripts/rebuild-all-employees.js) so every rebuild behaves identically.
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
const path = require('path');
const prisma = require('../src/lib/prisma');
const time = require('../src/lib/time');
const { rebuildEmployeeDays, writeBackup, LOOKBACK_OPEN_HOURS } = require('../src/lib/rebuildEmployeeDays');

const APPLY = process.argv.includes('--apply');
const code = process.argv[2];
const sinceIdx = process.argv.indexOf('--since');
const sinceArg = sinceIdx >= 0 ? process.argv[sinceIdx + 1] : null;

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

    const s = await rebuildEmployeeDays({
        employee,
        sinceArg,
        apply: false,
        log: console.log,
    });
    const since = s.since;
    const replaySince = s.replaySince;

    console.log(`Window: ${time.dayStrIST(replaySince)} → now (48h lookback before ${time.dayStrIST(since)})`);
    if (!sinceArg) console.log('  (no --since given → rebuilding the whole available history)');

    console.log(`\nRaw device logs in window: ${s.logCount}`);
    for (const l of s.logs) {
        console.log(`  log#${l.id} ${time.dayStrIST(l.punchTime)} ${time.timeStrIST(l.punchTime)} mode=${String(l.rawData || '').split(/[\t ]+/).filter(Boolean)[4] || '?'}`);
    }

    console.log(`\nDevice-sourced sheets in window (will be replaced): ${s.sheetCount}`);
    for (const sheet of s.sheets) {
        const p = (sheet.punches || []).map(x => time.tz(new Date(x.time)).format('MM-DD HH:mm')).join(', ');
        console.log(`  ts#${sheet.id} date=${time.dayUTC(sheet.date).format('YYYY-MM-DD')} in=${sheet.inAt ? time.timeStrIST(sheet.inAt) : '-'} out=${sheet.outAt ? time.dayStrIST(sheet.outAt) + ' ' + time.timeStrIST(sheet.outAt) : '-'} punches=[${p}]`);
    }

    if (s.manualCount) {
        console.log(`\n⚠ Mobile/manual sheets in window (KEPT, not rebuilt): ${s.manualCount}`);
        for (const sheet of s.manual) console.log(`  ts#${sheet.id} src=${sheet.source} date=${time.dayUTC(sheet.date).format('YYYY-MM-DD')}`);
    }

    if (!APPLY) {
        console.log('\nDry run — nothing written. Re-run with --apply to rebuild.');
        console.log('A backup of every replaced sheet is written to backups/ before any change.');
        return;
    }

    // 1. Backup (single-employee backup, restore-repair.js compatible)
    const backupFile = writeBackup(`emp-${code}`, s.backupRows, [code]);
    console.log(`\nBackup written: ${backupFile} (${s.backupRows.length} rows)`);

    // 2-4. Rebuild
    const applied = await rebuildEmployeeDays({ employee, sinceArg, apply: true, log: console.log });

    console.log(`\n✅ Rebuilt: ${applied.created} created, ${applied.attached} attached, ${applied.dup} duplicates skipped.`);
    console.log(`Resulting sheets (${applied.result.length}):`);
    for (const sheet of applied.result) {
        console.log(`  ts#${sheet.id} src=${sheet.source} date=${time.dayUTC(sheet.date).format('YYYY-MM-DD')} in=${sheet.inAt ? time.timeStrIST(sheet.inAt) : '-'} out=${sheet.outAt ? time.dayStrIST(sheet.outAt) + ' ' + time.timeStrIST(sheet.outAt) : '-'}`);
    }
    console.log(`\nTo undo: node scripts/restore-repair.js ${backupFile} --apply`);
}

main().catch((e) => { console.error('ERROR:', e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
