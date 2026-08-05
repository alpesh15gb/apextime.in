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
 *  - MISPUNCH GUARD: a punch is only accepted as the OUT of an open/recent
 *    sheet when the resulting TOTAL shift length is plausible for the
 *    employee's assigned shift (duration + OT allowance + grace). A punch that
 *    would make a 10-hour shift last 15h (e.g. a missed-OUT sheet glued to the
 *    NEXT day's punch) is treated as a NEW day instead, and the old sheet is
 *    flagged as a probable missed OUT. This is the "smart mispunch detection".
 *  - All matching is done on IST calendar days via src/lib/time.js, so the
 *    server timezone does not matter.
 *
 * Punch → timesheet matching order:
 *   1. A punch at the same time (±60s) already exists somewhere → ignore (idempotent).
 *   2. An existing timesheet for this employee whose date == the punch's IST day → attach.
 *   3. An OPEN timesheet (only an IN recorded, outAt null) within the last 48h:
 *        - same IST day, or gap < 15h, or device explicitly says OUT
 *          → attach ONLY IF the total span stays within the shift's plausible max,
 *        - otherwise → start a NEW day's sheet and flag the old one as missed OUT.
 *   4. Any timesheet with inAt within the last 22h → attach only if span plausible.
 *   5. Otherwise create a new timesheet.
 */
const prisma = require('./prisma');
const time = require('./time');

const LOOKBACK_OPEN_HOURS = 48;   // how far back an open sheet can still be closed
const NEW_DAY_GAP_HOURS = 15;     // gap beyond which a punch starts a new day
const LOOKBACK_RECENT_HOURS = 22; // legacy close-out window for same-day punches

// ── Mispunch guard constants ───────────────────────────────────────────────
const DEFAULT_MAX_SPAN_MS = 14 * 3600000;   // fallback cap when no shift assigned (14h+ single span is implausible)
const OT_ALLOWANCE_MS = 2 * 3600000;        // assumed OT allowance when shift.maxOtHours is 0 (uncapped)
const SPAN_GRACE_MS = 1 * 3600000;          // punch-window grace added to the cap

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// ESSL inOutMode: 1 = check-out, 5 = check-in, 0 = check-in/out (unknown).
// NOTE: many devices send 0 or 1 indiscriminately, so the mode is only ever a
// weak hint — it can never override the shift-plausibility guard.
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

const timeToMins = (t) => {
    if (!t) return null;
    const [h, m] = String(t).split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
};

/**
 * Pure: max plausible total span (ms) for a WorkShift on a given IST day.
 * shiftDuration + OT allowance + grace; falls back to a sane default.
 * Exported so the repair script reuses the exact same logic.
 */
function maxSpanMsFromShift(ws, istDay) {
    if (!ws) return DEFAULT_MAX_SPAN_MS;
    const dayName = DAY_NAMES[time.dayUTC(time.utcDate(istDay)).day()];
    const rec = (Array.isArray(ws.records) ? ws.records : []).find(r => r && r.day === dayName);
    let durMs = null;
    if (rec && !rec.isOff && rec.startTime && rec.endTime) {
        const s = timeToMins(rec.startTime);
        const e = timeToMins(rec.endTime);
        if (s !== null && e !== null) {
            let dur = e - s;
            if (dur < 0) dur += 24 * 60; // overnight shift
            durMs = dur * 60000;
        }
    }
    const dur = durMs || (ws.minHours > 0 ? ws.minHours * 3600000 : 9 * 3600000);
    const ot = ws.maxOtHours > 0 ? ws.maxOtHours * 3600000 : OT_ALLOWANCE_MS;
    return dur + ot + SPAN_GRACE_MS;
}

/** Load the employee's active WorkShift assignment covering `istDay` (null when none). */
async function loadShiftForDay(employeeId, tenantId, istDay) {
    try {
        const day = time.utcDate(istDay);
        const assign = await prisma.employeeWorkShift.findFirst({
            where: { employeeId, startDate: { lte: day }, endDate: { gte: day } },
            include: { workShift: true },
        });
        return (assign && assign.workShift) ? assign.workShift : null;
    } catch (e) {
        return null;
    }
}

/** Flag a sheet we are deliberately leaving open as a probable missed OUT. */
async function flagMissedOut(sheet) {
    try {
        const meta = (sheet.meta && typeof sheet.meta === 'object') ? sheet.meta : {};
        if (!meta.missedOut) {
            await prisma.timesheet.update({
                where: { id: sheet.id },
                data: { meta: { ...meta, missedOut: true, missedOutAt: new Date().toISOString() } },
            });
        }
    } catch (e) { /* non-fatal */ }
}

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
            // The plausibility cap is computed from the OPEN SHEET's own day
            // (the shift being closed), never the punch day — overnight shifts
            // cross a day boundary, and the punch-day weekday may carry a
            // different (shorter/off) record that would falsely reject a
            // legitimate overnight close.
            const wsOpen = await loadShiftForDay(employee.id, device.tenantId, openDay);
            const openMaxSpanMs = maxSpanMsFromShift(wsOpen, openDay);
            const gapHours = (punchTime.getTime() - open.inAt.getTime()) / 3600000;
            const wouldBeSpanMs = punchTime.getTime() - open.inAt.getTime();
            const sameDay = openDay === punchISTDay;
            const spanPlausible = wouldBeSpanMs > 0 && wouldBeSpanMs <= openMaxSpanMs;

            if (sameDay || (spanPlausible && (gapHours < NEW_DAY_GAP_HOURS || isOutMode(inOutMode)))) {
                target = open;
                reason = 'open_sheet';
            } else {
                // Either a big gap (next day) or the resulting shift would be
                // implausibly long → this punch starts a NEW day, and the old
                // sheet is a probable missed OUT (left open, flagged for review).
                isNewDayDecision = true;
                reason = spanPlausible
                    ? (isInMode(inOutMode) ? 'new_day_explicit_in' : 'new_day_unknown_mode')
                    : 'new_day_implausible_span';
                await flagMissedOut(open);
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
            // Same IN-day-based cap as the open-sheet branch (see above).
            const wsRecent = await loadShiftForDay(employee.id, device.tenantId, recentDay);
            const recentMaxSpanMs = maxSpanMsFromShift(wsRecent, recentDay);
            const gapHours = (punchTime.getTime() - recent.inAt.getTime()) / 3600000;
            const wouldBeSpanMs = punchTime.getTime() - recent.inAt.getTime();
            const spanPlausible = wouldBeSpanMs > 0 && wouldBeSpanMs <= recentMaxSpanMs;

            if (spanPlausible && (recentDay === punchISTDay || isOutMode(inOutMode) || gapHours < NEW_DAY_GAP_HOURS)) {
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

    // Create a new sheet. A lone punch is recorded as an IN (open sheet); if
    // the device explicitly says check-out and nothing plausible existed, the
    // sheet is marked as an orphan OUT punch so admins can spot it.
    const isOut = isOutMode(inOutMode);
    const punch = { time: punchTime.toISOString(), device_sn: sn || null, type: isOut ? 'out' : (isInMode(inOutMode) ? 'in' : 'auto') };
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
            meta: { device_sn: sn, verify_mode: verifyMode || '0', in_out_mode: inOutMode || '0', ...(isOut ? { orphanOut: true } : {}) },
        },
    });
    return { created: true, timesheetId: created.id, action: isNewDayDecision ? reason : 'created' };
};

module.exports = { processDevicePunch, normalizePunchList, deriveTimes, maxSpanMsFromShift, loadShiftForDay };
