/**
 * Attendance data repair — cleans up timesheets corrupted by the old iClock
 * punch-processing logic (outAt clobbering, spurious "clocked-in" sheets from
 * OUT punches, date-column/timezone shifts, same-day duplicates).
 *
 * SAFETY:
 *  - DRY-RUN by default: prints everything it WOULD change, writes nothing.
 *  - `--apply` performs the writes, but FIRST dumps every affected row (and
 *    every row to be deleted) to backups/timesheets-repair-<ts>.json.
 *
 * WHAT IT FIXES (matching the new app semantics in src/lib/punchProcessor.js):
 *  - Recomputes inAt / outAt / date from the `punches` array (first / last
 *    unique punch; outAt stays null when only one punch exists).
 *  - Fixes the `date` column to the IST calendar day of the first punch.
 *  - Merges duplicate timesheets for the same employee+date (only when no
 *    'rejected' record is involved).
 *  - Leaves genuinely ambiguous data untouched and merely REPORTS it:
 *      * outAt < inAt with no punch history
 *      * sheets still open (no OUT) for more than 48h
 *      * punches that landed more than 2 days from the stored date
 *
 * USAGE:
 *   DATABASE_URL=... node scripts/repair-attendance-data.js              # dry run
 *   DATABASE_URL=... node scripts/repair-attendance-data.js --apply      # write
 *   DATABASE_URL=... node scripts/repair-attendance-data.js --tenant 1 --limit 500
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const prisma = require('../src/lib/prisma');
const time = require('../src/lib/time');

const APPLY = process.argv.includes('--apply');
const TENANT = process.argv.includes('--tenant')
    ? parseInt(process.argv[process.argv.indexOf('--tenant') + 1], 10) : null;
const LIMIT = process.argv.includes('--limit')
    ? parseInt(process.argv[process.argv.indexOf('--limit') + 1], 10) : 0;

const DEDUPE_MS = 60000; // punches within 60s are the same punch

const normalizePunches = (raw) => {
    let list = raw;
    if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = []; } }
    if (!Array.isArray(list)) list = [];

    const parsed = list.map(p => {
        if (!p) return null;
        const t = time.punchTimeOf(p) || null;
        if (!t) return null;
        return { entry: p, date: t };
    }).filter(Boolean);

    parsed.sort((a, b) => a.date.getTime() - b.date.getTime());

    const out = [];
    for (const x of parsed) {
        const last = out[out.length - 1];
        if (last && Math.abs(last.date.getTime() - x.date.getTime()) <= DEDUPE_MS) continue;
        out.push({ entry: { ...x.entry, time: x.date.toISOString() }, date: x.date });
    }
    return out;
};

const derive = (normalized) => {
    if (!normalized.length) return { inAt: null, outAt: null, date: null };
    const first = normalized[0].date;
    const last = normalized[normalized.length - 1].date;
    return {
        inAt: first,
        outAt: normalized.length > 1 ? last : null,
        date: time.utcDate(time.dayStrIST(first)),
    };
};

const STATUS_PRIORITY = { approved: 0, auto_approved: 1, pending: 2, rejected: 3 };

async function main() {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`ATTENDANCE DATA REPAIR — ${APPLY ? 'APPLY MODE (writes DB)' : 'DRY RUN (no writes)'}`);
    console.log(`${'='.repeat(70)}`);

    if (APPLY) {
        const backupDir = path.join(__dirname, '../backups');
        fs.mkdirSync(backupDir, { recursive: true });
    }

    const where = { ...(TENANT ? { tenantId: TENANT } : {}) };
    const all = await prisma.timesheet.findMany({ where, orderBy: { id: 'asc' } });
    if (LIMIT > 0) all.length = Math.min(all.length, LIMIT);
    console.log(`Loaded ${all.length} timesheets${TENANT ? ` (tenant ${TENANT})` : ''}.`);

    const toBackup = [];      // rows to persist before modifying/deleting
    const plan = [];          // { id, kind, before, after }
    const reported = [];      // { id, kind, detail }

    // ── PASS 1: normalize punches + recompute inAt/outAt/date ──────────
    for (const t of all) {
        const normalized = normalizePunches(t.punches);
        const derived = derive(normalized);
        const dateStr = time.dayUTC(t.date).format('YYYY-MM-DD');

        if (normalized.length) {
            const inDay = time.dayStrIST(derived.inAt);
            const outDay = derived.outAt ? time.dayStrIST(derived.outAt) : null;

            // Punch landed > 2 days from stored date → looks wrong, only report.
            if (Math.abs(time.dayUTC(t.date).diff(time.dayUTC(inDay), 'day')) > 2) {
                reported.push({ id: t.id, kind: 'punch_day_far_from_date', detail: `date=${dateStr} inDay=${inDay}` });
            }

            const before = { inAt: t.inAt, outAt: t.outAt, date: t.date, punches: t.punches };
            const after = { inAt: derived.inAt, outAt: derived.outAt, date: derived.date, punches: normalized.map(x => x.entry) };

            const changed =
                !before.inAt || Math.abs(before.inAt.getTime() - after.inAt.getTime()) > DEDUPE_MS ||
                (before.outAt ? !after.outAt : !!after.outAt) ||
                (before.outAt && after.outAt && Math.abs(before.outAt.getTime() - after.outAt.getTime()) > DEDUPE_MS) ||
                dateStr !== time.dayUTC(derived.date).format('YYYY-MM-DD') ||
                JSON.stringify(before.punches) !== JSON.stringify(after.punches);

            if (changed) {
                plan.push({ id: t.id, kind: 'recompute', employeeId: t.employeeId, before, after });
                toBackup.push(t);
            }
        } else if (t.inAt) {
            // No punch history (mobile/manual/legacy) — just check the date column.
            const inDay = time.dayStrIST(t.inAt);
            if (inDay !== dateStr) {
                plan.push({
                    id: t.id, kind: 'fix_date', employeeId: t.employeeId,
                    before: { date: t.date, inAt: t.inAt, outAt: t.outAt, punches: t.punches },
                    after: { date: time.utcDate(inDay), inAt: t.inAt, outAt: t.outAt, punches: t.punches },
                });
                toBackup.push(t);
            }

            if (t.outAt && t.outAt <= t.inAt) {
                reported.push({ id: t.id, kind: 'out_before_in_no_punches', detail: `in=${t.inAt.toISOString()} out=${t.outAt.toISOString()}` });
            }
        }

        // Open sheets older than 48h → report only (may be a real missed OUT).
        if (!t.outAt && t.inAt) {
            const openHours = time.now().diff(time.tz(t.inAt), 'hour');
            if (openHours > 48) {
                reported.push({ id: t.id, kind: 'open_48h', detail: `in=${t.inAt.toISOString()} open=${Math.round(openHours)}h` });
            }
        }
    }

    // ── PASS 2: merge same employee+date duplicate groups ─────────────
    // Run AFTER pass 1; group by the PLANNED (post-recompute) date so
    // records whose date moves onto the same day get merged too.
    const plannedDate = new Map();
    for (const p of plan) {
        if (p.kind === 'recompute' || p.kind === 'fix_date') plannedDate.set(p.id, time.dayUTC(p.after.date).format('YYYY-MM-DD'));
    }

    const groups = {};
    const mergedIds = new Set();
    for (const t of all) {
        const d = plannedDate.get(t.id) || time.dayUTC(t.date).format('YYYY-MM-DD');
        const key = `${t.employeeId}|${d}`;
        (groups[key] = groups[key] || []).push(t);
    }

    for (const [key, rows] of Object.entries(groups)) {
        if (rows.length < 2) continue;
        if (rows.some(r => r.status === 'rejected')) {
            reported.push({ id: rows[0].id, kind: 'dup_with_rejected', detail: `${key} (${rows.length} rows)` });
            continue;
        }

        rows.sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] || (b.punches?.length || 0) - (a.punches?.length || 0) || a.createdAt - b.createdAt);
        const primary = rows[0];
        const dupes = rows.slice(1);

        // Merge RAW punch entries first, then normalize once (normalizePunches
        // is not idempotent — it wraps entries in {entry, date}).
        const rawAll = [
            ...(Array.isArray(primary.punches) ? primary.punches : []),
            ...dupes.flatMap(d => Array.isArray(d.punches) ? d.punches : []),
        ];
        const merged = normalizePunches(rawAll);
        const derived = derive(merged);

        const before = {
            id: primary.id,
            inAt: primary.inAt, outAt: primary.outAt, date: primary.date,
            punches: primary.punches, meta: primary.meta, status: primary.status,
        };
        const after = {
            id: primary.id,
            inAt: derived.inAt || primary.inAt,
            outAt: derived.outAt !== undefined ? derived.outAt : primary.outAt,
            date: derived.date || primary.date,
            punches: merged.length ? merged.map(x => x.entry) : primary.punches,
            status: primary.status,
        };

        plan.push({ id: primary.id, kind: 'merge_keep', employeeId: primary.employeeId, before, after, mergedFrom: dupes.map(d => d.id) });
        toBackup.push(primary, ...dupes);
        dupes.forEach(d => mergedIds.add(d.id));
    }

    // ── REPORT ──────────────────────────────────────────────────────────
    console.log(`\nChanges planned: ${plan.length}`);
    for (const p of plan) {
        const short = (d) => d ? time.tz(d).format('DD-MM HH:mm') : '-';
        const ds = (d) => d ? time.dayUTC(d).format('YYYY-MM-DD') : '-';
        if (p.kind === 'merge_keep') {
            console.log(`  [${p.kind}] ts#${p.id} (emp ${p.employeeId}) ← merge ${(p.mergedFrom || []).join(',')} | date ${ds(p.before.date)}→${ds(p.after.date)} in ${short(p.before.inAt)}→${short(p.after.inAt)} out ${short(p.before.outAt)}→${short(p.after.outAt)}`);
        } else {
            console.log(`  [${p.kind}] ts#${p.id} (emp ${p.employeeId}) | date ${ds(p.before.date)}→${ds(p.after.date)} in ${short(p.before.inAt)}→${short(p.after.inAt)} out ${short(p.before.outAt)}→${short(p.after.outAt)}`);
        }
    }

    console.log(`\nReported (not auto-fixed, review manually): ${reported.length}`);
    const byKind = {};
    for (const r of reported) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    for (const [k, v] of Object.entries(byKind)) console.log(`  ${k}: ${v}`);
    for (const r of reported.slice(0, 30)) console.log(`    ts#${r.id} ${r.kind} — ${r.detail}`);

    // ── APPLY ───────────────────────────────────────────────────────────
    if (!APPLY) {
        console.log('\nDry run complete — nothing written. Re-run with --apply to execute.');
        return;
    }

    // Backup everything we're about to touch (or delete).
    const backupFile = path.join(__dirname, `../backups/timesheets-repair-${Date.now()}.json`);
    const uniqueBackup = [...new Map(toBackup.map(r => [r.id, r])).values()];
    fs.writeFileSync(backupFile, JSON.stringify({ appliedAt: new Date().toISOString(), rows: uniqueBackup }, null, 2));
    console.log(`\nBackup written: ${backupFile} (${uniqueBackup.length} rows)`);

    let updated = 0;
    for (const p of plan) {
        if (p.kind === 'merge_keep') {
            await prisma.timesheet.update({
                where: { id: p.id },
                data: {
                    inAt: p.after.inAt,
                    outAt: p.after.outAt,
                    date: p.after.date,
                    punches: p.after.punches,
                },
            });
            for (const did of p.mergedFrom || []) {
                await prisma.timesheet.delete({ where: { id: did } });
            }
            updated++;
        } else if (p.kind === 'recompute' || p.kind === 'fix_date') {
            await prisma.timesheet.update({
                where: { id: p.id },
                data: {
                    inAt: p.after.inAt,
                    outAt: p.after.outAt,
                    date: p.after.date,
                    punches: p.after.punches,
                },
            });
            updated++;
        }
    }

    console.log(`\n✅ Applied ${updated} changes (${uniqueBackup.length} rows backed up).`);
}

main().catch((e) => { console.error('ERROR:', e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
