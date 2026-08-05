/**
 * Restore timesheets to their pre-repair state using a repair backup file.
 *
 * The repair script (scripts/repair-attendance-data.js) writes every row it is
 * about to touch to backups/timesheets-repair-<ts>.json BEFORE applying. This
 * script reverses a repair --apply run exactly:
 *   - rewrites every backed-up row back to its recorded inAt/outAt/date/punches
 *   - deletes the NEW rows the repair created via the mispunch split
 *     (identified by meta.repair_split_from)
 *
 * USAGE:
 *   node scripts/restore-repair.js <backup-file>            # dry run
 *   node scripts/restore-repair.js <backup-file> --apply    # execute
 */
require('dotenv').config();
const fs = require('fs');
const prisma = require('../src/lib/prisma');

const APPLY = process.argv.includes('--apply');
const file = process.argv[2];
if (!file) {
    console.error('Usage: node scripts/restore-repair.js <backup-file> [--apply]');
    process.exit(1);
}

const RESTORE_FIELDS = ['inAt', 'outAt', 'date', 'punches'];

async function main() {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`REPAIR RESTORE — ${APPLY ? 'APPLY MODE (writes DB)' : 'DRY RUN (no writes)'}`);
    console.log(`${'='.repeat(70)}`);

    let data;
    try {
        data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        console.error(`Cannot read backup file ${file}: ${e.message}`);
        process.exit(1);
    }
    const rows = Array.isArray(data.rows) ? data.rows : [];
    console.log(`Loaded ${rows.length} backed-up rows from ${file}`);

    // Backed-up rows hold the FULL pre-repair row objects (they were captured
    // with findMany), so restoring is a simple field write-back.
    const restorePlan = rows.filter(r => r && r.id);
    console.log(`Will restore ${restorePlan.length} rows.`);

    // The repair may also have CREATED rows (mispunch splits). They carry
    // meta.repair_split_from — find and remove them so the pre-repair state is
    // fully recovered. Only touch employees present in the backup.
    const empIds = [...new Set(restorePlan.map(r => r.employeeId).filter(Boolean))];
    const created = empIds.length
        ? await prisma.timesheet.findMany({ where: { employeeId: { in: empIds } } })
        : [];
    const createdIds = created.filter(t => t.meta && t.meta.repair_split_from).map(t => t.id);
    console.log(`Will delete ${createdIds.length} split-created rows.`);
    if (createdIds.length > restorePlan.length) {
        console.log('  NOTE: more split-created rows than backed-up rows were found for these employees —');
        console.log('  this backup may predate a LATER repair run. Review before restoring.');
    }

    if (!APPLY) {
        console.log('\nDry run complete — nothing written. Re-run with --apply to execute.');
        return;
    }

    let restored = 0;
    let recreated = 0;
    for (const r of restorePlan) {
        const dataUpdate = {};
        for (const f of RESTORE_FIELDS) {
            if (f in r) dataUpdate[f] = r[f];
        }
        try {
            await prisma.timesheet.update({ where: { id: r.id }, data: dataUpdate });
            restored++;
        } catch (e) {
            // The apply may have DELETED this row (a merged duplicate).
            // Re-create it exactly as it was before the repair.
            await prisma.timesheet.create({
                data: {
                    id: r.id,
                    tenantId: r.tenantId,
                    employeeId: r.employeeId,
                    date: r.date,
                    inAt: r.inAt,
                    outAt: r.outAt,
                    punches: r.punches,
                    source: r.source || 'device',
                    status: r.status || 'pending',
                    meta: r.meta || undefined,
                },
            });
            recreated++;
        }
    }
    for (const id of createdIds) {
        await prisma.timesheet.delete({ where: { id } });
    }
    console.log(`\n✅ Restored ${restored} rows, recreated ${recreated} deleted rows, removed ${createdIds.length} split-created rows.`);

    console.log('Re-run scripts/repair-attendance-data.js afterwards if needed (dry run first).');
}

main().catch((e) => { console.error('ERROR:', e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
