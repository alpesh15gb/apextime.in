/**
 * Idempotent punch-to-timesheet processor.
 *
 * Shared by the iClock endpoints (src/routes/iclock.js), the AI-device JSON
 * endpoint and the backlog reprocessing script (scripts/process_pending_logs.js)
 * so there is exactly one source of truth for how a raw punch becomes a
 * timesheet.
 *
 * WHY THIS DESIGN (fixes "employees who punch out come back as IN" + more):
 *  - The `punches` JSON array is the source of truth. inAt/outAt are always
 *    DERIVED from it (first / last unique punch). Re-uploads, out-of-order
 *    batches and interrupted transfers therefore cannot clobber times.
 *  - Punches are deduplicated by time (within 60s) instead of the old
 *    "2-minute window vs the last punch" check which corrupted data on retries.
 *  - An OUT punch can never spawn a spurious new "clocked-in" timesheet when a
 *    plausible existing sheet exists (same IST day, open sheet, or recent IN).
 *  - All matching is done on IST calendar days via src/lib/time.js, so the
 *    server timezone does not matter.
 *
 * Punch → timesheet matching order:
 *   1. A punch at the same time (±60s) already exists somewhere → ignore (idempotent).
 *   2. An existing timesheet for this employee whose date == the punch's IST day → attach.
 *   3. An OPEN timesheet (only an IN recorded, outAt null) within the last 48h:
 *        - same IST day as the new punch, or gap < 15h → attach (overnight / long shift),
 *        - device explicitly says OUT → attach (close the sheet),
 *        - device explicitly says IN or gap >= 15h → start a NEW day's sheet
 *          (the old one is a missed OUT, left open for the admin to see).
 *   4. Any timesheet with inAt within the last 22h → attach (legacy close-out).
 *   5. Otherwise create a new timesheet.
 */
const prisma = require('./prisma');
const time = require('./time');

const LOOKBACK_OPEN_HOURS = 48;   // how far back an open sheet can still be closed
const NEW_DAY_GAP_HOURS = 15;     // gap beyond which a punch starts a new day
const LOOKBACK_RECENT_HOURS = 22; // legacy close-out window for same-day punches

// ESSL inOutMode: 1 = check-out, 5 = check-in, 0 = check-in/out (unknown)
const isOutMode = (m) => String(m || '').trim() === '1';
const isInMode = (m) => String(m || '').trim() === '5';

const normalizePunches = (raw) => {
    if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch { raw = []; }
    }
    return Array.isArray(raw) ? raw : [];
};

/** Sort + dedupe punch entries (by time, ±60s). Returns { punches, times }. */
const normalizePunchList = (entries) => {
    const list = normalizePunches(entries).map(p => ({
        time: time.punchTimeOf(p) || null,
        entry: p,
    })).filter(x => x.time);

    list.sort((a, b) => a.time.getTime() - b.time.getTime());

    const out = [];
    for (const x of list) {
        const last = out[out.length - 1];
        if (last && time.samePunch(last.time, x.time, 60000)) {
            // Keep the earlier entry (prefer its device/type metadata).
            continue;
        }
        out.push(x);
    }
    return { entries: out.map(x => x.entry), times: out.map(x => x.time) };
};

/**
 * Derive { inAt, outAt, date } from a normalized (sorted, deduped) punch list.
 * outAt is null when only one punch exists (sheet still "open"), matching the
 * app's open-timesheet semantics used for overnight continuation.
 */
const deriveTimes = (entries, times) => {
    if (!times.length) return { inAt: null, outAt: null, date: null };
    const first = times[0];
    const last = times[times.length - 1];
    return {
        inAt: first,
        outAt: times.length > 1 ? last : null,
        date: time.utcDate(time.dayStrIST(first)),
    };
};

/**
 * Process one punch from a biometric device.
 * @returns {{ created: boolean, timesheetId: number, action: string }}
 */
const processDevicePunch = async ({ device, employee, punchTime, inOutMode, verifyMode, sn }) => {
    if (!punchTime || isNaN(punchTime.getTime())) {
        return { created: false, timesheetId: null, action: 'invalid_time' };
    }

    const punchISTDay = time.dayStrIST(punchTime);
    const punchUtcDate = time.utcDate(punchISTDay);

    // ── 1. Find a timesheet to attach to ────────────────────────────────
    // Same IST-day sheets (covers same-day punch sequences + re-uploads).
    let target = await prisma.timesheet.findFirst({
        where: { tenantId: device.tenantId, employeeId: employee.id, date: punchUtcDate },
        // Explicit nulls-first: Postgres would otherwise sort closed (outAt set)
        // sheets before open ones, defeating the "prefer open sheet" intent.
        orderBy: [{ outAt: { sort: 'asc', nulls: 'first' } }, { inAt: 'desc' }],
    });

    let reason = 'same_day';
    let isNewDayDecision = false;

    if (!target) {
        // ── 2. Open sheet (outAt null) within lookback ─────────────────
        const open = await prisma.timesheet.findFirst({
            where: {
                tenantId: device.tenantId,
                employeeId: employee.id,
                outAt: null,
                inAt: { gte: new Date(punchTime.getTime() - LOOKBACK_OPEN_HOURS * 3600000), lte: punchTime },
            },
            orderBy: { inAt: 'desc' },
        });

        if (open) {
            const openDay = time.dayStrIST(open.inAt);
            const gapHours = (punchTime.getTime() - open.inAt.getTime()) / 3600000;

            if (openDay === punchISTDay || gapHours < NEW_DAY_GAP_HOURS || isOutMode(inOutMode)) {
                target = open;
                reason = 'open_sheet';
            } else if (isInMode(inOutMode)) {
                // Explicit IN with an old open sheet → new day (missed OUT on old sheet).
                isNewDayDecision = true;
                reason = 'new_day_explicit_in';
            } else {
                // Unknown mode, big gap → very likely the next day's IN.
                isNewDayDecision = true;
                reason = 'new_day_unknown_mode';
            }
        }
    }

    if (!target && !isNewDayDecision) {
        // ── 3. Legacy close-out: any recent sheet with inAt within 22h ─
        // Gated so a next-day punch can't be glued onto a closed sheet from
        // yesterday (e.g. overnight shift followed by a new evening shift).
        const recent = await prisma.timesheet.findFirst({
            where: {
                tenantId: device.tenantId,
                employeeId: employee.id,
                inAt: {
                    gte: new Date(punchTime.getTime() - LOOKBACK_RECENT_HOURS * 3600000),
                    lte: punchTime,
                },
            },
            orderBy: { inAt: 'desc' },
        });
        if (recent) {
            const recentDay = time.dayStrIST(recent.inAt);
            const gapHours = (punchTime.getTime() - recent.inAt.getTime()) / 3600000;
            if (recentDay === punchISTDay || isOutMode(inOutMode) || gapHours < NEW_DAY_GAP_HOURS) {
                target = recent;
                reason = 'recent_sheet';
            }
        }
    }

    // ── 4. Attach or create ────────────────────────────────────────────
    if (target) {
        // Idempotency: ignore if this exact time already exists on the sheet.
        const existing = normalizePunchList(target.punches);
        if (existing.times.some(t => time.samePunch(t, punchTime, 60000))) {
            return { created: false, timesheetId: target.id, action: 'duplicate' };
        }

        const newPunch = { time: punchTime.toISOString(), device_sn: sn || null, type: isOutMode(inOutMode) ? 'out' : (isInMode(inOutMode) ? 'in' : 'auto') };
        const merged = normalizePunchList([...existing.entries, newPunch]);
        const derived = deriveTimes(merged.entries, merged.times);

        const updated = await prisma.timesheet.update({
            where: { id: target.id },
            data: {
                punches: merged.entries,
                inAt: derived.inAt,
                outAt: derived.outAt,
                date: derived.date || target.date,
                // Status is intentionally untouched — never silently change an
                // admin's pending/rejected decision during punch ingestion.
            },
        });
        return { created: false, timesheetId: updated.id, action: `attached_${reason}` };
    }

    // Create a new sheet. An OUT punch with no plausible sheet is still recorded
    // (recording is safer than dropping), but as a fresh IN so no data is lost.
    const punch = { time: punchTime.toISOString(), device_sn: sn || null, type: isOutMode(inOutMode) ? 'out' : (isInMode(inOutMode) ? 'in' : 'auto') };
    const created = await prisma.timesheet.create({
        data: {
            tenantId: device.tenantId,
            employeeId: employee.id,
            date: punchUtcDate,
            inAt: punchTime,
            outAt: null,
            punches: [punch],
            source: 'device',
            status: 'auto_approved',
            meta: { device_sn: sn, verify_mode: verifyMode || '0', in_out_mode: inOutMode || '0' },
        },
    });
    return { created: true, timesheetId: created.id, action: 'created' };
};

module.exports = { processDevicePunch, normalizePunchList, deriveTimes };
