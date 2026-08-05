/**
 * Attendance data repair — cleans up timesheets corrupted by the old iClock
 * punch-processing logic (outAt clobbering, spurious "clocked-in" sheets from
 * OUT punches, date-column/timezone shifts, same-day duplicates, and
 * MISPUNCHED sheets where a missed-OUT sheet got glued to the next day's punch).
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
 *  - SPLITS implausible spans (mispunch guard): when a device sheet's punches
 *    span more than the shift's plausible maximum (shift duration + OT
 *    allowance + grace), the punches are split at the largest gaps into
 *    separate sheets — the first segment keeps the original row, later
 *    segments become new open sheets. This un-glues e.g. a 15h18m "shift"
 *    that was really a missed OUT + the next day's punch.
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
const { maxSpanMsFromShift } = require('../src/lib/punchProcessor');

const APPLY = process.argv.includes('--apply');
const TENANT = process.argv.includes('--tenant')
    ? parseInt(process.argv[process.argv.indexOf('--tenant') + 1], 10) : null;
const LIMIT = process.argv.includes('--limit')
    ? parseInt(process.argv[process.argv.indexOf('--limit') + 1], 10) : 0;
const EMPLOYEE_CODE = process.argv.includes('--employee')
    ? process.argv[process.argv.indexOf('--employee') + 1] : null;

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

/**
 * Split a sorted normalized punch list into segments where every segment spans
 * at most maxSpanMs. Splits at the LARGEST gaps first (most likely the day
 * boundary between a missed-OUT sheet and the next day's punch).
 */
const splitBySpan = (normalized, maxSpanMs) => {
    if (normalized.length < 2) return [normalized];
    const total = normalized[normalized.length - 1].date.getTime() - normalized[0].date.getTime();
    if (total <= maxSpanMs) return [normalized];

    // Find the largest gap between consecutive punches, then recurse on BOTH
    // halves so no segment can exceed the max span (3+ punch case).
    let splitIdx = 0;
    let largestGap = 0;
    for (let i = 0; i < normalized.length - 1; i++) {
        const gap = normalized[i + 1].date.getTime() - normalized[i].date.getTime();
        if (gap > largestGap) { largestGap = gap; splitIdx = i; }
    }
    const first = normalized.slice(0, splitIdx + 1);
    const rest = normalized.slice(splitIdx + 1);
    return [...splitBySpan(first, maxSpanMs), ...splitBySpan(rest, maxSpanMs)];
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
    if (EMPLOYEE_CODE) {
        const emp = await prisma.employee.findFirst({ where: { employeeCode: EMPLOYEE_CODE } });
        if (!emp) {
            console.error(`No employee with code ${EMPLOYEE_CODE}`);
            process.exit(1);
        }
        where.employeeId = emp.id;
        console.log(`Scoped to employee ${EMPLOYEE_CODE} (id=${emp.id}).`);
    }
    const all = await prisma.timesheet.findMany({ where, orderBy: { id: 'asc' } });
    if (LIMIT > 0) all.length = Math.min(all.length, LIMIT);
    console.log(`Loaded ${all.length} timesheets${TENANT ? ` (tenant ${TENANT})` : ''}.`);

    // Load shift assignments once so the mispunch guard can compute the
    // plausible max span per employee/day. (Empty where = all tenants.)
    const assignments = await prisma.employeeWorkShift.findMany({
        where: { ...(TENANT ? { tenantId: TENANT } : {}) },
        include: { workShift: true },
    });
    const shiftsByEmp = {};
    for (const a of assignments) {
        (shiftsByEmp[a.employeeId] = shiftsByEmp[a.employeeId] || []).push(a);
    }
    const maxSpanFor = (empId, istDay) => {
        const list = shiftsByEmp[empId] || [];
        const day = time.utcDate(istDay);
        const cov = list.find(a => a.startDate <= day && a.endDate >= day);
        return maxSpanMsFromShift(cov ? cov.workShift : null, istDay);
    };

    const toBackup = [];      // rows to persist before modifying/deleting
    const plan = [];          // { id, kind, before, after }
    const reported = [];      // { id, kind, detail }
    const createdRows = [];   // rows to CREATE (from splitting) — applied after

    // ── PASS 1: split implausible spans + normalize punches + recompute ──
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

            // ── MISPUNCH SPLIT: only device-sourced, non-reviewed sheets ──
            // If the punches span more than the shift's plausible max, this is
            // almost certainly a missed-OUT sheet glued to the next day's
            // punch. Split into separate open sheets (admin reviews later).
            const spanMs = normalized[normalized.length - 1].date.getTime() - normalized[0].date.getTime();
            const maxSpanMs = maxSpanFor(t.employeeId, inDay);
            const splittable = t.source === 'device' && (t.status === 'auto_approved' || t.status === 'pending');

            if (splittable && spanMs > maxSpanMs) {
                const segments = splitBySpan(normalized, maxSpanMs);
                if (segments.length > 1) {
                    const firstSeg = derive(segments[0]);
                    const before = { inAt: t.inAt, outAt: t.outAt, date: t.date, punches: t.punches };
                    const after = {
                        inAt: firstSeg.inAt, outAt: firstSeg.outAt, date: firstSeg.date,
                        punches: segments[0].map(x => x.entry),
                    };
                    plan.push({ id: t.id, kind: 'split_keep', employeeId: t.employeeId, before, after });
                    toBackup.push(t);

                    for (let s = 1; s < segments.length; s++) {
                        const segDerived = derive(segments[s]);
                        createdRows.push({
                            tenantId: t.tenantId,
                            employeeId: t.employeeId,
                            date: segDerived.date,
                            inAt: segDerived.inAt,
                            outAt: segDerived.outAt,
                            punches: segments[s].map(x => x.entry),
                            source: t.source,
                            status: t.status,
                            meta: { repair_split_from: t.id, note: 'split from implausible span' },
                        });
                    }
                    continue; // row fully handled by the split
                }
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
    //
    // CRITICAL FIX: the merge base is the POST-pass-1 state (the split /
    // recompute result), NEVER the original pre-split punches — merging the
    // originals silently re-glued the exact mispunch the split just separated
    // (e.g. 01-08 became a 30h54m span instead of the split's honest open
    // sheet). Split-created rows are only folded into an existing day's sheet
    // when the merged result stays within the employee's plausible max span;
    // otherwise they become their own sheets.
    const plannedDate = new Map();
    const plannedPunches = new Map(); // id -> post-pass-1 punches
    for (const p of plan) {
        if (p.kind === 'recompute' || p.kind === 'fix_date' || p.kind === 'split_keep') {
            plannedDate.set(p.id, time.dayUTC(p.after.date).format('YYYY-MM-DD'));
            plannedPunches.set(p.id, Array.isArray(p.after.punches) ? p.after.punches : []);
        }
    }

    // Attach each created row to the group key it would land on.
    const createdByKey = {};
    for (let ci = 0; ci < createdRows.length; ci++) {
        const c = createdRows[ci];
        const key = `${c.employeeId}|${time.dayUTC(c.date).format('YYYY-MM-DD')}`;
        (createdByKey[key] = createdByKey[key] || []).push({ ci, row: c });
    }

    const groups = {};
    const absorbCreated = new Set(); // indices of createdRows folded into a merge
    const superseded = new Set();    // ids whose pass-1 entry is replaced by a merge_keep
    for (const t of all) {
        const d = plannedDate.get(t.id) || time.dayUTC(t.date).format('YYYY-MM-DD');
        const key = `${t.employeeId}|${d}`;
        (groups[key] = groups[key] || []).push(t);
    }

    const mergePlan = [];
    for (const [key, rows] of Object.entries(groups)) {
        if (rows.length < 2 && (createdByKey[key] || []).length === 0) continue;
        if (rows.some(r => r.status === 'rejected')) {
            reported.push({ id: rows[0].id, kind: 'dup_with_rejected', detail: `${key} (${rows.length} rows)` });
            continue;
        }

        rows.sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] || (b.punches?.length || 0) - (a.punches?.length || 0) || a.createdAt - b.createdAt);
        const primary = rows[0];
        const dupes = rows.slice(1);

        // Split-created rows that were carved OUT of this very sheet
        // (repair_split_from === primary.id) must NOT be re-absorbed — that
        // would undo the mispunch split when both segments land on the same
        // IST day (e.g. [08:00] and [22:00]). They stay separate sheets.
        let extras = (createdByKey[key] || []).filter(x => x.row.meta?.repair_split_from !== primary.id);
        if (dupes.length === 0 && extras.length === 0) continue;

        // Merge base = POST-pass-1 punches (never the pre-split originals).
        const basePunches = plannedPunches.has(primary.id)
            ? plannedPunches.get(primary.id)
            : (Array.isArray(primary.punches) ? primary.punches : []);
        const dupePunches = dupes.flatMap(d => plannedPunches.has(d.id)
            ? plannedPunches.get(d.id)
            : (Array.isArray(d.punches) ? d.punches : []));

        let merged = normalizePunches([
            ...basePunches,
            ...dupePunches,
            ...extras.flatMap(x => Array.isArray(x.row.punches) ? x.row.punches : []),
        ]);
        let mergedDerived = derive(merged);

        // Reject split-created extras that would make the merged span
        // implausible (the re-glue bug: a morning punch stretching a sheet to
        // 24-30h). They then stay as their own new sheets.
        if (extras.length && mergedDerived.inAt && mergedDerived.outAt) {
            const spanMs = mergedDerived.outAt.getTime() - mergedDerived.inAt.getTime();
            const maxMs = maxSpanFor(primary.employeeId, time.dayStrIST(mergedDerived.inAt));
            if (spanMs > maxMs) {
                extras = [];
                merged = normalizePunches([...basePunches, ...dupePunches]);
                mergedDerived = derive(merged);
            }
        }
        if (dupes.length === 0 && extras.length === 0) continue;

        const before = {
            id: primary.id,
            inAt: primary.inAt, outAt: primary.outAt, date: primary.date,
            punches: primary.punches, meta: primary.meta, status: primary.status,
        };
        const after = {
            id: primary.id,
            inAt: mergedDerived.inAt || primary.inAt,
            outAt: mergedDerived.outAt !== undefined ? mergedDerived.outAt : primary.outAt,
            // Empty-punch groups (manual/mobile rows) have mergedDerived.date null
            // — fall back to the PASS-1 planned date so a fix_date/recompute date
            // correction isn't lost when its entry is superseded by this merge.
            date: mergedDerived.date || plannedDate.get(primary.id) || primary.date,
            punches: merged.length ? merged.map(x => x.entry) : (basePunches.length ? basePunches : primary.punches),
            status: primary.status,
        };

        // NOTE: absorbed split-created rows are folded into the primary's
        // punches but MUST NOT be listed in mergedFrom (they were never created
        // in the DB, so there is nothing to delete — and a string id would
        // crash the apply loop's prisma.timesheet.delete).
        if (rows.length > 1) {
            mergePlan.push({ id: primary.id, kind: 'merge_keep', employeeId: primary.employeeId, before, after, mergedFrom: dupes.map(d => d.id) });
            toBackup.push(primary, ...dupes);
            dupes.forEach(d => superseded.add(d.id));
        } else {
            mergePlan.push({ id: primary.id, kind: 'merge_keep', employeeId: primary.employeeId, before, after, mergedFrom: [] });
            toBackup.push(primary);
        }
        superseded.add(primary.id);
        extras.forEach(x => absorbCreated.add(x.ci));
    }
    // A merge_keep supersedes any pass-1 entry for the same row (its state is
    // folded in) — drop the pass-1 entries to avoid double-writing the row.
    for (const mp of mergePlan) plan.push(mp);
    for (let i = plan.length - 1; i >= 0; i--) {
        if (superseded.has(plan[i].id) && plan[i].kind !== 'merge_keep') plan.splice(i, 1);
    }
    // Keep only split-created rows that weren't absorbed into an existing day.
    const finalCreated = createdRows.filter((_, ci) => !absorbCreated.has(ci));
    createdRows.length = 0;
    createdRows.push(...finalCreated);

    // ── REPORT ──────────────────────────────────────────────────────────
    console.log(`\nChanges planned: ${plan.length} (+ ${createdRows.length} new sheets from splits)`);
    for (const p of plan) {
        const short = (d) => d ? time.tz(d).format('DD-MM HH:mm') : '-';
        const ds = (d) => d ? time.dayUTC(d).format('YYYY-MM-DD') : '-';
        if (p.kind === 'merge_keep') {
            console.log(`  [${p.kind}] ts#${p.id} (emp ${p.employeeId}) ← merge ${(p.mergedFrom || []).join(',')} | date ${ds(p.before.date)}→${ds(p.after.date)} in ${short(p.before.inAt)}→${short(p.after.inAt)} out ${short(p.before.outAt)}→${short(p.after.outAt)}`);
        } else if (p.kind === 'split_keep') {
            console.log(`  [${p.kind}] ts#${p.id} (emp ${p.employeeId}) MISPUNCH-SPLIT | date ${ds(p.before.date)}→${ds(p.after.date)} in ${short(p.before.inAt)}→${short(p.after.inAt)} out ${short(p.before.outAt)}→${short(p.after.outAt)}`);
        } else {
            console.log(`  [${p.kind}] ts#${p.id} (emp ${p.employeeId}) | date ${ds(p.before.date)}→${ds(p.after.date)} in ${short(p.before.inAt)}→${short(p.after.inAt)} out ${short(p.before.outAt)}→${short(p.after.outAt)}`);
        }
    }
    for (const c of createdRows) {
        const short = (d) => d ? time.tz(d).format('DD-MM HH:mm') : '-';
        const ds = (d) => d ? time.dayUTC(d).format('YYYY-MM-DD') : '-';
        console.log(`  [split_create] NEW ts (emp ${c.employeeId}) | date ${ds(c.date)} in ${short(c.inAt)} out ${short(c.outAt)}`);
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
        } else if (p.kind === 'split_keep') {
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

    for (const c of createdRows) {
        await prisma.timesheet.create({ data: c });
        updated++;
    }

    console.log(`\n✅ Applied ${updated} changes (${uniqueBackup.length} rows backed up).`);
}

main().catch((e) => { console.error('ERROR:', e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
