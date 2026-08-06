/**
 * Rebuild EVERY employee's timesheets from their RAW device logs (the ground
 * truth) by replaying each employee's punches through the production punch
 * processor (src/lib/punchProcessor.js).
 *
 * This is the batch version of scripts/rebuild-employee-days.js — both share
 * the exact same core (src/lib/rebuildEmployeeDays.js). Use it after a month
 * of data shows glued/mispunched sheets (work hours > 24h, wrong in/out
 * pairing) so the Work Hours Summary report comes out right again.
 *
 * SAFETY:
 *  - DRY RUN by default — re-run with --apply to write.
 *  - Writes ONE backup file (backups/) containing every sheet that will be
 *    replaced, BEFORE any change. scripts/restore-repair.js <file> --apply
 *    undoes the whole run.
 *  - Only device-sourced sheets are replaced; mobile/manual sheets are kept.
 *  - Rebuilt sheets are tagged meta.rebuild_created so the restore is exact.
 *
 * USAGE:
 *   node scripts/rebuild-all-employees.js                          # dry run, all history
 *   node scripts/rebuild-all-employees.js --since 2026-07-01       # dry run from a date
 *   node scripts/rebuild-all-employees.js --tenant 1               # only one tenant
 *   node scripts/rebuild-all-employees.js --employee 1303          # one employee
 *   node scripts/rebuild-all-employees.js --since 2026-07-01 --apply   # write
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const time = require('../src/lib/time');
const { rebuildEmployeeDays, writeBackup, LOOKBACK_OPEN_HOURS } = require('../src/lib/rebuildEmployeeDays');

const APPLY = process.argv.includes('--apply');
const QUIET = process.argv.includes('--quiet');

const sinceIdx = process.argv.indexOf('--since');
const sinceArg = sinceIdx >= 0 ? process.argv[sinceIdx + 1] : null;

const tenantIdx = process.argv.indexOf('--tenant');
const tenantId = tenantIdx >= 0 ? parseInt(process.argv[tenantIdx + 1], 10) : null;

const empIdx = process.argv.indexOf('--employee');
const onlyCode = empIdx >= 0 ? process.argv[empIdx + 1] : null;

const log = QUIET ? () => {} : (msg) => console.log(msg);

async function main() {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`REBUILD ALL EMPLOYEE DAYS — ${APPLY ? 'APPLY MODE (writes DB)' : 'DRY RUN (no writes)'}`);
    console.log(`${'='.repeat(70)}`);
    if (sinceArg) console.log(`Since: ${sinceArg} (each employee rebuilt from max(earliest log, ${sinceArg}) − 48h lookback)`);
    else console.log('Since: each employee\'s earliest device log (full history)');
    if (tenantId) console.log(`Tenant: ${tenantId}`);
    if (onlyCode) console.log(`Employee: ${onlyCode}`);

    const where = { ...(tenantId ? { tenantId } : {}), ...(onlyCode ? { employeeCode: onlyCode } : {}) };
    const employees = await prisma.employee.findMany({ where, orderBy: { employeeCode: 'asc' } });
    console.log(`Employees to process: ${employees.length}\n`);

    // ── Dry-run pass: report what WOULD change AND collect the full backup ──
    // The backup rows (every sheet that would be replaced) are captured here so
    // that in apply mode the backup file exists on disk BEFORE any write — an
    // interrupted run can always be rolled back exactly.
    const backupRows = [];
    const empRefs = [];
    let wouldReplace = 0;
    let affectedEmps = 0;
    let zeroLogs = 0;
    for (const emp of employees) {
        const s = await rebuildEmployeeDays({ employee: emp, sinceArg, apply: false, log });
        backupRows.push(...s.backupRows);
        empRefs.push(emp.employeeCode);
        if (s.sheetCount > 0) {
            wouldReplace += s.sheetCount;
            affectedEmps++;
        }
        if (s.logCount === 0) zeroLogs++;
        console.log(`  ${emp.employeeCode}  logs=${s.logCount}  deviceSheets=${s.sheetCount}  manual=${s.manualCount}  window=${time.dayStrIST(s.replaySince)}→now`);
    }

    console.log(`\nDry-run summary: ${affectedEmps}/${employees.length} employees have device sheets that would be rebuilt (${wouldReplace} sheets total).`);
    if (zeroLogs > 0) console.log(`  NOTE: ${zeroLogs} employees have NO raw device logs — nothing can be rebuilt for them (manual data only).`);

    if (!APPLY) {
        console.log('\nNothing written. Re-run with --apply to rebuild.');
        console.log('A single backup of every replaced sheet is written to backups/ before any change.');
        return;
    }

    // ── Apply pass ──
    // 1. Persist the full backup BEFORE touching the database.
    const backupFile = writeBackup(empRefs.length === 1 ? `emp-${empRefs[0]}` : `all-${Date.now()}`, backupRows, empRefs);
    console.log(`\nBackup written FIRST: ${backupFile} (${backupRows.length} rows)`);

    // 2. Rebuild every employee.
    let totalCreated = 0, totalAttached = 0, totalDup = 0;
    for (const emp of employees) {
        const s = await rebuildEmployeeDays({ employee: emp, sinceArg, apply: true, log });
        totalCreated += s.created;
        totalAttached += s.attached;
        totalDup += s.dup;
        console.log(`  ✅ ${emp.employeeCode}: ${s.created} created, ${s.attached} attached, ${s.dup} dup (${s.sheetCount} sheets replaced)`);
    }

    console.log(`\n✅ Done. ${totalCreated} created, ${totalAttached} attached, ${totalDup} duplicates skipped, ${backupRows.length} sheets backed up.`);
    console.log(`To undo: node scripts/restore-repair.js ${backupFile} --apply`);
}

main().catch((e) => { console.error('ERROR:', e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
