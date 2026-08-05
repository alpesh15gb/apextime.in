const router = require('express').Router();
const prisma = require('../lib/prisma');
const { requireRole } = require('../middleware/auth');
const time = require('../lib/time');

// ─── COMP-OFF CRUD ────────────────────────────

// GET /api/compoff?month=&year=&employeeId=
router.get('/', async (req, res, next) => {
    try {
        const { month, year, employeeId } = req.query;
        const where = { tenantId: req.tenantId };
        if (month) where.month = parseInt(month);
        if (year) where.year = parseInt(year);
        if (employeeId) where.employeeId = parseInt(employeeId);

        const entries = await prisma.compOff.findMany({
            where,
            include: {
                employee: { include: { contact: true, department: true, designation: true } },
                approver: { select: { username: true } },
            },
            orderBy: [{ employeeId: 'asc' }, { date: 'asc' }],
        });

        res.json(entries.map(e => ({
            id: e.id,
            uuid: e.uuid,
            employeeId: e.employeeId,
            employeeName: `${e.employee.contact.firstName} ${e.employee.contact.lastName || ''}`.trim(),
            employeeCode: e.employee.employeeCode,
            date: time.dayUTC(e.date).format('DD/MM/YYYY'),
            dateRaw: e.date,
            hours: e.hours,
            days: e.days,
            reason: e.reason,
            status: e.status,
            approvedBy: e.approver?.username || null,
            month: e.month,
            year: e.year,
        })));
    } catch (error) { next(error); }
});

// POST /api/compoff
router.post('/', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const { employeeId, date, hours, reason, month, year } = req.body;
        const days = parseFloat((hours / 8).toFixed(4));

        const entry = await prisma.compOff.create({
            data: {
                tenantId: req.tenantId,
                employeeId: parseInt(employeeId),
                date: time.utcDate(date),
                hours: parseFloat(hours),
                days,
                reason,
                month: parseInt(month),
                year: parseInt(year),
            },
        });
        res.status(201).json(entry);
    } catch (error) { next(error); }
});

// POST /api/compoff/:uuid/approve
router.post('/:uuid/approve', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const entry = await prisma.compOff.update({
            where: { uuid: req.params.uuid },
            data: { status: 'approved', approvedBy: req.userId },
        });
        res.json(entry);
    } catch (error) { next(error); }
});

// POST /api/compoff/:uuid/reject
router.post('/:uuid/reject', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const entry = await prisma.compOff.update({
            where: { uuid: req.params.uuid },
            data: { status: 'rejected' },
        });
        res.json(entry);
    } catch (error) { next(error); }
});

// DELETE /api/compoff/:uuid
router.delete('/:uuid', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        await prisma.compOff.delete({ where: { uuid: req.params.uuid } });
        res.json({ message: 'Deleted' });
    } catch (error) { next(error); }
});

// ─── PERMISSION ENTRIES CRUD ─────────────────────

// GET /api/compoff/permissions?month=&year=
router.get('/permissions', async (req, res, next) => {
    try {
        const { month, year, employeeId } = req.query;
        const where = { tenantId: req.tenantId };
        if (month) where.month = parseInt(month);
        if (year) where.year = parseInt(year);
        if (employeeId) where.employeeId = parseInt(employeeId);

        const entries = await prisma.permissionEntry.findMany({
            where,
            include: { employee: { include: { contact: true } } },
            orderBy: [{ employeeId: 'asc' }, { date: 'asc' }],
        });

        res.json(entries.map(e => ({
            id: e.id,
            uuid: e.uuid,
            employeeId: e.employeeId,
            employeeName: `${e.employee.contact.firstName} ${e.employee.contact.lastName || ''}`.trim(),
            date: time.dayUTC(e.date).format('DD/MM/YYYY'),
            dateRaw: e.date,
            type: e.type,
            hours: e.hours,
            days: e.days,
            remarks: e.remarks,
            month: e.month,
            year: e.year,
        })));
    } catch (error) { next(error); }
});

// POST /api/compoff/permissions
router.post('/permissions', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const { employeeId, date, type, hours, remarks, month, year } = req.body;
        const days = parseFloat((hours / 8).toFixed(4));

        const entry = await prisma.permissionEntry.create({
            data: {
                tenantId: req.tenantId,
                employeeId: parseInt(employeeId),
                date: time.utcDate(date),
                type,
                hours: parseFloat(hours),
                days,
                remarks,
                month: parseInt(month),
                year: parseInt(year),
            },
        });
        res.status(201).json(entry);
    } catch (error) { next(error); }
});

// DELETE /api/compoff/permissions/:uuid
router.delete('/permissions/:uuid', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        await prisma.permissionEntry.delete({ where: { uuid: req.params.uuid } });
        res.json({ message: 'Deleted' });
    } catch (error) { next(error); }
});

// ─── SHIFT & LATE HELPERS ──────────────────────────
const DAY_MAP = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const timeToMinutes = (t) => {
    if (!t) return null;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
};

const getEmployeeShiftForDate = (empId, dateObj, shiftAssignments) => {
    const assignments = shiftAssignments[empId];
    if (!assignments || assignments.length === 0) return null;
    const dateMs = dateObj.valueOf();
    for (const assign of assignments) {
        if (dateMs >= assign.startMs && dateMs <= assign.endMs) {
            const dayName = DAY_MAP[dateObj.day()];
            const dayRecord = (assign.shift.records || []).find(r => r.day === dayName);
            return {
                shiftName: assign.shift.name,
                dayRecord: dayRecord || null,
            };
        }
    }
    return null;
};

// ═══════════════════════════════════════════════════

/**
 * Hours-to-days overflow: when totalHours >= 8, convert overflow to days.
 * Excel: Days = INT(totalHrs/8), Hours = totalHrs - INT(totalHrs/8)*8
 */
function overflowHoursToDays(prevDays, prevHours, currentDays, currentHours) {
    const totalHours = (prevHours || 0) + (currentHours || 0);
    const overflowDays = totalHours >= 8 ? Math.floor(totalHours / 8) : 0;
    const remainingHours = totalHours >= 8 ? totalHours - overflowDays * 8 : totalHours;
    const totalDays = (prevDays || 0) + (currentDays || 0) + overflowDays;
    return { days: totalDays, hours: remainingHours };
}

/**
 * Comp-Off Converted into Days/Hours
 * Excel: L14 = I38 + IF(J38>=8, INT(J38/8), 0)    ← total days + overflow from hours
 *        M14 = IF(J38>=8, J38 - INT(J38/8)*8, J38) ← remaining hours after overflow
 * (I38 = SUM of compoff Days column, J38 = SUM of compoff Hours column)
 */
function convertCompOffDaysHours(totalCompOffDays, totalCompOffHours) {
    const overflowDays = totalCompOffHours >= 8 ? Math.floor(totalCompOffHours / 8) : 0;
    const remainingHours = totalCompOffHours >= 8 ? totalCompOffHours - overflowDays * 8 : totalCompOffHours;
    return { days: totalCompOffDays + overflowDays, hours: remainingHours };
}

/**
 * Late C/Early G/Gen Perm → Converted into Days/Hours
 * Excel: X14 = IF(W38>=8, INT(W38/8), 0)
 *        Y14 = IF(X14>0, W38 - X14*8, W38)
 */
function convertPermDaysHours(totalPermHours) {
    const days = totalPermHours >= 8 ? Math.floor(totalPermHours / 8) : 0;
    const hours = days > 0 ? totalPermHours - days * 8 : totalPermHours;
    return { days, hours };
}

/**
 * SL Availed validation
 * Excel: AB14=IF(COUNT(AA14:AA37) > AP14, "ERROR - Cannot avail more than SL balance", COUNT(AA14:AA37))
 */
function validateSlAvailed(slCount, slBalance) {
    if (slCount > slBalance) return { error: true, count: slCount, message: 'Cannot avail more than SL balance' };
    return { error: false, count: slCount };
}

/**
 * Late Check-In → Days conversion: 3 lates = 1 day
 * Excel: L17 = INT(Details!S14/3)
 */
function lateCheckInToDays(lateCount) {
    return Math.floor(lateCount / 3);
}

/**
 * EL/Vacation Credited — auto-credit on the employee's leave-start month
 * Excel: AD15=IF($E$3="January",DATE($F$3,1,1),""), AE15=IF($E$3="January",15,"")
 * Each employee has their own leave-start month; EL is credited in Jan and June (or their specific month)
 */
function getElCredited(leaveStartMonth, currentMonth, currentYear, category) {
    // EL is credited in January and June only (company standard).
    // leaveStartMonth does NOT affect EL credit — it only affects CL/SL reset.
    const creditMonths = [1, 6]; // January and June
    if (!creditMonths.includes(currentMonth)) return 0;
    // Adhoc employees do not receive EL credit
    if (category === 'adhoc') return 0;
    if (category === 'confirmed' || category === 'time_scale') return 15;
    if (category === 'contract') return 15;
    if (category === 'part_time') return 8;
    return 15;
}

/**
 * Fresh CL/SL allocation on an employee's leave-start month.
 * Excel: T=IF($E$3="[leaveStartMonth]", 12/8, prevBalance)
 *   Confirmed/Time-Scale → 12 CL, 15 SL
 *   Contract            →  8 CL,  8 SL
 *   Adhoc               → no reset (carry forward only)
 * Returns null for categories that do not get a fresh reset.
 */
function getFreshLeaveAllocation(category) {
    if (category === 'confirmed' || category === 'time_scale') return { cl: 12, sl: 15 };
    if (category === 'contract') return { cl: 8, sl: 8 };
    return null; // Adhoc and others: no fresh reset
}

/**
 * SUMMARY CALCULATION — The core Excel formula replicated
 *
 * Variables (matching Excel columns):
 *   K = CL Availed (days)
 *   L = Late Check-In → days (INT(lateCount/3))
 *   Q = SL Availed (days)
 *   T = Available CL (prev or fresh if leave-start month)
 *   U = Available SL
 *   V = Available EL (prev + credited this month)
 *   X = Available Comp-Off Days (prev + current, with hour overflow)
 *   Y = Available Comp-Off Hours (remaining after overflow)
 *   AA = Available Late C/Early G/Gen Perm Days (prev + current, with hour overflow)
 *   AB = Available Late C/Early G/Gen Perm Hours (remaining)
 *
 * ADJUSTED section — how comp-off/leaves are consumed:
 *   AD = Comp-Off Days adjusted (used to cover CL+Late+Perm+SL deficits)
 *   AE = Comp-Off Hours adjusted
 *   AG = CL adjusted (consumed from available CL)
 *   AH = Late Check-In days adjusted (consumed from available CL)
 *   AI = Late C/Early G/Gen Perm adjusted
 *   AJ = Total adjusted (AG+AH+AI)
 *   AL = SL adjusted
 *   AN = CL leftover from EL
 *   AO = Late Check-In leftover from EL
 *   AP = Late C/Early G/Gen Perm leftover from EL
 *   AQ = EL utilised
 *   AR = Total EL adjusted
 *
 * BALANCE c/f:
 *   AT = Comp-Off Days remaining (X - AD)
 *   AU = Comp-Off Hours remaining (Y - AE)
 *   AW = CL balance (T - AJ)
 *   AX = SL balance (U - AL)
 *   AY = EL balance (V - AR)
 *   AZ = Late/Early hours remaining
 *
 * LOP:
 *   BC = IF(AW<0, |AW|, 0) + IF(AL>0, AL/2, 0) + IF(AY<0, |AY|, 0)
 *   BB = IF(BC>0, "LOP", "FULL")
 */
function calculateSummary({
    clAvailed,         // K - CL days availed this month
    lateCheckInCount,  // raw count of late check-ins
    slAvailed,         // Q - SL days availed this month
    elUtilised,        // AQ - EL days utilised this month
    elCredited,        // R - EL credited this month
    compOffDaysCurrent,   // current month comp-off days (from Details L column conversion)
    compOffHoursCurrent,  // current month comp-off hours (from Details M column conversion)
    permDaysCurrent,   // current month perm days (from Details X column conversion)
    permHoursCurrent,  // current month perm hours (from Details Y column conversion)
    prevCl,            // T prev or fresh CL balance
    prevSl,            // U prev or fresh SL balance
    prevElBalance,     // previous EL balance
    prevCompOffDays,   // AL prev comp-off days
    prevCompOffHours,  // AM prev comp-off hours
    prevPermDays,      // AS prev perm days
    prevPermHours,     // AT prev perm hours
}) {
    // L = Late check-in days (3 lates = 1 day)
    const L = lateCheckInToDays(lateCheckInCount);

    const K = clAvailed;
    const Q = slAvailed;

    // T, U = Available CL, SL
    const T = prevCl;
    const U = prevSl;

    // V = Available EL = prev EL + credited this month
    const V = prevElBalance + (elCredited || 0);

    // X, Y = Available Comp-Off (prev + current with 8hr overflow)
    const compOff = overflowHoursToDays(prevCompOffDays, prevCompOffHours, compOffDaysCurrent, compOffHoursCurrent);
    const X = compOff.days;
    const Y = compOff.hours;

    // AA, AB = Available Late C/Early G/Gen Perm (prev + current with 8hr overflow)
    const perm = overflowHoursToDays(prevPermDays, prevPermHours, permDaysCurrent, permHoursCurrent);
    const AA = perm.days;
    const AB = perm.hours;

    // ─── ADJUSTMENT CALCULATION (Clean Waterfall Model) ───
    // Mathematically identical to the Excel nested IF formulas, but 10x more readable.

    // Deficits to cover
    let remCL = K;        // CL
    let remLate = L;      // Late Check-ins
    let remPerm = AA;     // Permissions
    let remSL = Q;        // Sick Leave

    // --- Phase 1: Comp-Off (X) ---
    // Covers CL -> Late -> Perm -> SL in that order
    let compOffAvail = X;
    const ad_cl = Math.min(compOffAvail, remCL); compOffAvail -= ad_cl; remCL -= ad_cl;
    const ad_late = Math.min(compOffAvail, remLate); compOffAvail -= ad_late; remLate -= ad_late;
    const ad_perm = Math.min(compOffAvail, remPerm); compOffAvail -= ad_perm; remPerm -= ad_perm;
    const ad_sl = Math.min(compOffAvail, remSL); compOffAvail -= ad_sl; remSL -= ad_sl;

    const AD = ad_cl + ad_late + ad_perm + ad_sl; // Total Comp-Off days used
    const AE = Math.min(Y, AB);                   // Comp-Off hours adjusted (capped at perm hours)
    const AL = remSL;                             // Remaining SL not covered by CompOff (gets 0.5 LOP per day per Excel logic)

    // --- Phase 2: CL Balance (T) and EL Balance (V) ---
    // Covers remaining CL -> Late -> Perm in that order
    let clAvail = T;
    let elAvail = V > 0 ? V : 0;

    let ag_cl = 0, ah_late = 0, ai_perm = 0; // Covered by CL balance
    let an_cl = 0, ao_late = 0, ap_perm = 0; // Covered by EL balance

    if (V > 0) {
        // EL exists -> CL balance absorbs up to its limit, overflow goes to EL.
        ag_cl = Math.min(clAvail, remCL); clAvail -= ag_cl; remCL -= ag_cl;
        ah_late = Math.min(clAvail, remLate); clAvail -= ah_late; remLate -= ah_late;
        ai_perm = Math.min(clAvail, remPerm); clAvail -= ai_perm; remPerm -= ai_perm;

        // Remainder covered by EL
        an_cl = remCL; elAvail -= an_cl; remCL = 0;
        ao_late = remLate; elAvail -= ao_late; remLate = 0;
        ap_perm = remPerm; elAvail -= ap_perm; remPerm = 0;
    } else {
        // No EL -> CL balance absorbs ALL deficits (can go negative -> turns into LOP)
        ag_cl = remCL; clAvail -= ag_cl; remCL = 0;
        ah_late = remLate; clAvail -= ah_late; remLate = 0;
        ai_perm = remPerm; clAvail -= ai_perm; remPerm = 0;
    }

    const AG = ag_cl, AH = ah_late, AI = ai_perm;
    const AJ = AG + AH + AI; // Total CL adjustments

    const AN = an_cl, AO = ao_late, AP = ap_perm;
    const AQ = elUtilised;
    const AR = AN + AO + AP + AQ; // Total EL adjustments

    // ─── BALANCE CARRY-FORWARD ───
    const AT = X - AD;                          // Comp-Off Days remaining
    const AU = Y - AE;                          // Comp-Off Hours remaining
    const AW = T - AJ;                          // CL balance
    const AX = U - AL;                          // SL balance
    const AY = V - AR;                          // EL balance
    const AZ = Y < AB ? AB - Y : 0;             // Late/Early hours remaining

    // ─── LOP ───
    // BC = IF(AW<0, |AW|, 0) + IF(AL>0, AL/2, 0) + IF(AY<0, |AY|, 0)
    const lopDays = (AW < 0 ? Math.abs(AW) : 0) + (AL > 0 ? AL / 2 : 0) + (AY < 0 ? Math.abs(AY) : 0);
    const status = lopDays > 0 ? 'LOP' : 'FULL';

    return {
        // Current month
        current: {
            compOffDays: compOffDaysCurrent,
            compOffHours: compOffHoursCurrent,
            clAvailed: K,
            lateCheckIns: lateCheckInCount,
            lateCheckInDays: L,
            permDays: permDaysCurrent,
            permHours: permHoursCurrent,
            slAvailed: Q,
            elCredited: elCredited || 0,
            elUtilised: AQ,
        },

        // Available/Accumulated (including current month comp-off + perm)
        available: {
            compOffDays: X,
            compOffHours: Y,
            cl: T,
            sl: U,
            el: V,
            permDays: AA,
            permHours: AB,
        },

        // Adjusted (how balances are consumed)
        adjusted: {
            compOffDays: AD,
            compOffHours: AE,
            clAdjusted: AG,
            lateAdjusted: AH,
            permAdjusted: AI,
            totalClAdjusted: AJ,
            slAdjusted: AL,
            elCl: AN,
            elLate: AO,
            elPerm: AP,
            elUtilised: AQ,
            totalElAdjusted: AR,
        },

        // Balance carry-forward
        balance: {
            compOffDays: AT,
            compOffHours: AU,
            cl: AW,
            sl: AX,
            el: AY,
            permHours: AZ,
        },

        lopDays,
        status,
    };
}


// ─── DETAILS (per-employee monthly breakdown) ───

// GET /api/compoff/details?month=&year=&departmentId=
router.get('/details', async (req, res, next) => {
    try {
        const m = parseInt(req.query.month) || (time.now().month() + 1);
        const y = parseInt(req.query.year) || time.now().year();
        const deptId = req.query.departmentId ? parseInt(req.query.departmentId) : null;

        // Use UTC midnight so Prisma sends the correct date string to Postgres (@db.Date)
        // Without this, dayjs startOf('month') in IST produces Feb 28T18:30Z for March,
        // causing Feb 28 timesheet rows to bleed into the next month's query.
        const daysInMonth = time.dayUTC(`${y}-${String(m).padStart(2, '0')}-01`).daysInMonth();
        const startOfMonth = new Date(Date.UTC(y, m - 1, 1));
        const endOfMonth = new Date(Date.UTC(y, m - 1, daysInMonth, 23, 59, 59, 999));

        const empWhere = { tenantId: req.tenantId, status: 'active' };
        if (deptId) empWhere.departmentId = deptId;

        const employees = await prisma.employee.findMany({
            where: empWhere,
            include: { contact: true, department: true, designation: true },
            orderBy: { employeeCode: 'asc' },
        });

        const empIds = employees.map(e => e.id);

        const [compOffs, permissions, leaveRequests, timesheets, rawAssignments, prevBalances] = await Promise.all([
            prisma.compOff.findMany({ where: { tenantId: req.tenantId, month: m, year: y }, orderBy: { date: 'asc' } }),
            prisma.permissionEntry.findMany({ where: { tenantId: req.tenantId, month: m, year: y }, orderBy: { date: 'asc' } }),
            prisma.leaveRequest.findMany({
                where: {
                    tenantId: req.tenantId, status: 'approved',
                    startDate: { lte: endOfMonth }, endDate: { gte: startOfMonth },
                    employeeId: { in: empIds },
                },
                include: { leaveType: true },
            }),
            prisma.timesheet.findMany({
                where: { tenantId: req.tenantId, date: { gte: startOfMonth, lte: endOfMonth }, employeeId: { in: empIds } },
            }),
            prisma.employeeWorkShift.findMany({
                where: { employeeId: { in: empIds }, startDate: { lte: endOfMonth }, endDate: { gte: startOfMonth } },
                include: { workShift: true },
            }),
            (() => {
                const prevMonth = m === 1 ? 12 : m - 1;
                const prevYear = m === 1 ? y - 1 : y;
                return prisma.monthlyBalance.findMany({ where: { tenantId: req.tenantId, month: prevMonth, year: prevYear } });
            })(),
        ]);

        const shiftAssignments = {};
        for (const a of rawAssignments) {
            if (!shiftAssignments[a.employeeId]) shiftAssignments[a.employeeId] = [];
            shiftAssignments[a.employeeId].push({
                startMs: time.dayUTC(a.startDate).valueOf(),
                endMs: time.dayUTC(a.endDate).endOf('day').valueOf(),
                shift: a.workShift,
            });
        }

        // Index by employee
        const idx = (arr) => {
            const map = {};
            arr.forEach(item => { (map[item.employeeId] = map[item.employeeId] || []).push(item); });
            return map;
        };

        const compOffIdx = idx(compOffs);
        const permIdx = idx(permissions);
        const leaveIdx = idx(leaveRequests);
        const tsIdx = idx(timesheets);
        const prevBalIdx = {};
        prevBalances.forEach(b => { prevBalIdx[b.employeeId] = b; });

        const details = employees.map((emp, i) => {
            const ec = compOffIdx[emp.id] || [];
            const ep = permIdx[emp.id] || [];
            const el = leaveIdx[emp.id] || [];
            const et = tsIdx[emp.id] || [];
            const prevBal = prevBalIdx[emp.id] || {};

            // Comp-off: only approved entries count toward the balance
            const approvedEc = ec.filter(c => c.status === 'approved');
            const compOffTotalDays = approvedEc.reduce((s, c) => s + (c.days || 0), 0);
            const compOffTotalHours = approvedEc.reduce((s, c) => s + (c.hours || 0), 0);
            const compOffConverted = convertCompOffDaysHours(compOffTotalDays, compOffTotalHours);

            // CL / SL / EL from leave requests
            const clLeaves = el.filter(l => l.leaveType?.code === 'CL' || l.leaveType?.name?.toLowerCase().includes('casual'));
            const slLeaves = el.filter(l => l.leaveType?.code === 'SL' || l.leaveType?.name?.toLowerCase().includes('sick'));
            const elLeaves = el.filter(l => l.leaveType?.code === 'EL' || l.leaveType?.name?.toLowerCase().includes('earned') || l.leaveType?.name?.toLowerCase().includes('vacation'));

            const clAvailed = clLeaves.reduce((s, l) => s + (l.days || 0), 0);
            const slAvailed = slLeaves.reduce((s, l) => s + (l.days || 0), 0);
            const elUtilised = elLeaves.reduce((s, l) => s + (l.days || 0), 0);

            // SL validation
            const slValidation = validateSlAvailed(slAvailed, prevBal.slBalance || 0);

            // Late check-ins
            const lateCheckIns = et.filter(t => {
                if (!t.inAt) return false;
                const empShift = getEmployeeShiftForDate(emp.id, time.dayUTC(t.date), shiftAssignments);
                if (empShift && empShift.dayRecord && !empShift.dayRecord.isOff) {
                    const shiftStartMins = timeToMinutes(empShift.dayRecord.startTime);
                    const graceMins = empShift.dayRecord.graceMins || 0;
                    if (shiftStartMins !== null) {
                        const punchInMins = time.tz(t.inAt).hour() * 60 + time.tz(t.inAt).minute();
                        const allowedStart = shiftStartMins + graceMins;
                        return punchInMins > allowedStart;
                    }
                }
                // Fallback to strict 9:15 AM
                const h = time.tz(t.inAt).hour();
                const min = time.tz(t.inAt).minute();
                return h > 9 || (h === 9 && min > 15);
            });

            // Permission totals
            const permTotalHours = ep.reduce((s, p) => s + (p.hours || 0), 0);
            const permConverted = convertPermDaysHours(permTotalHours);

            // EL credited
            const elCredited = getElCredited(emp.leaveStartMonth, m, y, emp.category);

            // Days present: Excel = EOMONTH days - LOP days (BC column)
            // For now, count timesheets with inAt as days present
            const daysPresent = et.filter(t => t.inAt).length;

            return {
                id: emp.id,
                slNo: i + 1,
                name: `${emp.contact.firstName} ${emp.contact.lastName || ''}`.trim(),
                code: emp.employeeCode,
                designation: emp.designation?.name || '-',
                department: emp.department?.name || '-',
                category: emp.category || 'confirmed',
                leaveStartMonth: emp.leaveStartMonth,
                daysPresent,

                compOff: {
                    entries: ec.map(c => ({
                        date: time.dayUTC(c.date).format('DD/MM/YYYY'),
                        days: c.days,
                        hours: c.hours,
                        reason: c.reason,
                        status: c.status,
                        uuid: c.uuid,
                    })),
                    totalDays: compOffTotalDays,
                    totalHours: compOffTotalHours,
                    convertedDays: compOffConverted.days,
                    convertedHours: compOffConverted.hours,
                },

                clAvailed: {
                    entries: clLeaves.map(l => ({
                        startDate: time.dayUTC(l.startDate).format('DD/MM/YYYY'),
                        endDate: time.dayUTC(l.endDate).format('DD/MM/YYYY'),
                        days: l.days,
                    })),
                    totalDays: clAvailed,
                },

                lateCheckIn: {
                    count: lateCheckIns.length,
                    days: lateCheckInToDays(lateCheckIns.length), // 3 lates = 1 day
                    dates: lateCheckIns.map(t => time.dayUTC(t.date).format('DD/MM/YYYY')),
                },

                permissions: {
                    entries: ep.map(p => ({
                        date: time.dayUTC(p.date).format('DD/MM/YYYY'),
                        type: p.type,
                        hours: p.hours,
                        days: p.days,
                        remarks: p.remarks,
                        uuid: p.uuid,
                    })),
                    totalHours: permTotalHours,
                    convertedDays: permConverted.days,
                    convertedHours: permConverted.hours,
                },

                slAvailed: {
                    entries: slLeaves.map(l => ({
                        startDate: time.dayUTC(l.startDate).format('DD/MM/YYYY'),
                        endDate: time.dayUTC(l.endDate).format('DD/MM/YYYY'),
                        days: l.days,
                    })),
                    totalDays: slAvailed,
                    validation: slValidation,
                },

                elVacation: {
                    credited: elCredited,
                    utilised: elUtilised,
                    entries: elLeaves.map(l => ({
                        startDate: time.dayUTC(l.startDate).format('DD/MM/YYYY'),
                        endDate: time.dayUTC(l.endDate).format('DD/MM/YYYY'),
                        days: l.days,
                    })),
                },

                previousBalance: {
                    compOffDays: prevBal.compOffDays || 0,
                    compOffHours: prevBal.compOffHours || 0,
                    cl: prevBal.clBalance || 0,
                    sl: prevBal.slBalance || 0,
                    el: prevBal.elBalance || 0,
                    lateEarlyDays: prevBal.lateEarlyDays || 0,
                    lateEarlyHours: prevBal.lateEarlyHours || 0,
                },
            };
        });

        res.json({ month: m, year: y, daysInMonth, data: details });
    } catch (error) { next(error); }
});

// ─── SUMMARY ─────────────────────────────────────

// GET /api/compoff/summary?month=&year=&departmentId=
router.get('/summary', async (req, res, next) => {
    try {
        const m = parseInt(req.query.month) || (time.now().month() + 1);
        const y = parseInt(req.query.year) || time.now().year();
        const deptId = req.query.departmentId ? parseInt(req.query.departmentId) : null;

        const daysInMonthN = time.dayUTC(`${y}-${String(m).padStart(2, '0')}-01`).daysInMonth();
        const startOfMonth = new Date(Date.UTC(y, m - 1, 1));
        const endOfMonth = new Date(Date.UTC(y, m - 1, daysInMonthN, 23, 59, 59, 999));

        const empWhere = { tenantId: req.tenantId, status: 'active' };
        if (deptId) empWhere.departmentId = deptId;

        const employees = await prisma.employee.findMany({
            where: empWhere,
            include: { contact: true, department: true, designation: true },
            orderBy: { employeeCode: 'asc' },
        });

        const empIds = employees.map(e => e.id);

        const [compOffs, permissions, leaveRequests, timesheets, rawAssignments, prevBalances, currentBalances] = await Promise.all([
            prisma.compOff.findMany({ where: { tenantId: req.tenantId, month: m, year: y } }),
            prisma.permissionEntry.findMany({ where: { tenantId: req.tenantId, month: m, year: y } }),
            prisma.leaveRequest.findMany({
                where: {
                    tenantId: req.tenantId, status: 'approved',
                    startDate: { lte: endOfMonth }, endDate: { gte: startOfMonth },
                    employeeId: { in: empIds },
                },
                include: { leaveType: true },
            }),
            prisma.timesheet.findMany({
                where: { tenantId: req.tenantId, date: { gte: startOfMonth, lte: endOfMonth }, employeeId: { in: empIds } },
            }),
            prisma.employeeWorkShift.findMany({
                where: { employeeId: { in: empIds }, startDate: { lte: endOfMonth }, endDate: { gte: startOfMonth } },
                include: { workShift: true },
            }),
            (() => {
                const prevMonth = m === 1 ? 12 : m - 1;
                const prevYear = m === 1 ? y - 1 : y;
                return prisma.monthlyBalance.findMany({ where: { tenantId: req.tenantId, month: prevMonth, year: prevYear } });
            })(),
            prisma.monthlyBalance.findMany({ where: { tenantId: req.tenantId, month: m, year: y } }),
        ]);

        const shiftAssignments = {};
        for (const a of rawAssignments) {
            if (!shiftAssignments[a.employeeId]) shiftAssignments[a.employeeId] = [];
            shiftAssignments[a.employeeId].push({
                startMs: time.dayUTC(a.startDate).valueOf(),
                endMs: time.dayUTC(a.endDate).endOf('day').valueOf(),
                shift: a.workShift,
            });
        }

        const idx = (arr) => {
            const map = {};
            arr.forEach(item => { (map[item.employeeId] = map[item.employeeId] || []).push(item); });
            return map;
        };

        const compOffIdx = idx(compOffs);
        const permIdx = idx(permissions);
        const leaveIdx = idx(leaveRequests);
        const tsIdx = idx(timesheets);
        const prevBalIdx = {};
        prevBalances.forEach(b => { prevBalIdx[b.employeeId] = b; });
        const curBalIdx = {};
        currentBalances.forEach(b => { curBalIdx[b.employeeId] = b; });

        const summary = employees.map((emp, i) => {
            const ec = compOffIdx[emp.id] || [];
            const ep = permIdx[emp.id] || [];
            const el = leaveIdx[emp.id] || [];
            const et = tsIdx[emp.id] || [];
            const prevBal = prevBalIdx[emp.id] || {};
            const curBal = curBalIdx[emp.id] || {};

            const daysPresent = et.filter(t => t.inAt).length;

            // Comp-off this month: only approved entries count toward the balance
            const approvedEc = ec.filter(c => c.status === 'approved');
            const compOffTotalDays = approvedEc.reduce((s, c) => s + (c.days || 0), 0);
            const compOffTotalHours = approvedEc.reduce((s, c) => s + (c.hours || 0), 0);
            const compOffConverted = convertCompOffDaysHours(compOffTotalDays, compOffTotalHours);

            // Leaves
            const clLeaves = el.filter(l => l.leaveType?.code === 'CL' || l.leaveType?.name?.toLowerCase().includes('casual'));
            const slLeaves = el.filter(l => l.leaveType?.code === 'SL' || l.leaveType?.name?.toLowerCase().includes('sick'));
            const elLeaves = el.filter(l => l.leaveType?.code === 'EL' || l.leaveType?.name?.toLowerCase().includes('earned') || l.leaveType?.name?.toLowerCase().includes('vacation'));

            const clAvailed = clLeaves.reduce((s, l) => s + (l.days || 0), 0);
            const slAvailed = slLeaves.reduce((s, l) => s + (l.days || 0), 0);
            const elUtilised = elLeaves.reduce((s, l) => s + (l.days || 0), 0);

            // Late check-ins
            const lateCheckInCount = et.filter(t => {
                if (!t.inAt) return false;
                const empShift = getEmployeeShiftForDate(emp.id, time.dayUTC(t.date), shiftAssignments);
                if (empShift && empShift.dayRecord && !empShift.dayRecord.isOff) {
                    const shiftStartMins = timeToMinutes(empShift.dayRecord.startTime);
                    const graceMins = empShift.dayRecord.graceMins || 0;
                    if (shiftStartMins !== null) {
                        const punchInMins = time.tz(t.inAt).hour() * 60 + time.tz(t.inAt).minute();
                        const allowedStart = shiftStartMins + graceMins;
                        return punchInMins > allowedStart;
                    }
                }
                const h = time.tz(t.inAt).hour();
                const min = time.tz(t.inAt).minute();
                return h > 9 || (h === 9 && min > 15);
            }).length;

            // Permissions
            const permTotalHours = ep.reduce((s, p) => s + (p.hours || 0), 0);
            const permConverted = convertPermDaysHours(permTotalHours);

            // EL credited
            const elCredited = getElCredited(emp.leaveStartMonth, m, y, emp.category);

            // CL/SL: fresh allocation only on the employee's own leave-start month.
            // Adhoc employees (null allocation) carry forward without reset.
            const allocation = getFreshLeaveAllocation(emp.category);
            const isLeaveStartMonth = allocation && emp.leaveStartMonth && m === emp.leaveStartMonth;
            const prevCl = isLeaveStartMonth ? allocation.cl : (prevBal.clBalance || 0);
            const prevSl = isLeaveStartMonth ? allocation.sl : (prevBal.slBalance || 0);

            // Run the full summary calculation
            const calc = calculateSummary({
                clAvailed,
                lateCheckInCount,
                slAvailed,
                elUtilised,
                elCredited,
                compOffDaysCurrent: compOffConverted.days,
                compOffHoursCurrent: compOffConverted.hours,
                permDaysCurrent: permConverted.days,
                permHoursCurrent: permConverted.hours,
                prevCl,
                prevSl,
                prevElBalance: prevBal.elBalance || 0,
                prevCompOffDays: prevBal.compOffDays || 0,
                prevCompOffHours: prevBal.compOffHours || 0,
                prevPermDays: prevBal.lateEarlyDays || 0,
                prevPermHours: prevBal.lateEarlyHours || 0,
            });

            return {
                id: emp.id,
                slNo: i + 1,
                name: `${emp.contact.firstName} ${emp.contact.lastName || ''}`.trim(),
                code: emp.employeeCode,
                designation: emp.designation?.name || '-',
                category: emp.category || 'confirmed',
                leaveStartMonth: emp.leaveStartMonth,
                daysPresent,
                ...calc,
                isClosed: curBal.isClosed || false,
            };
        });

        res.json({ month: m, year: y, data: summary });
    } catch (error) { next(error); }
});

// ─── CLOSE MONTH ─────────────────────────────────

// POST /api/compoff/close-month
router.post('/close-month', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const { month, year } = req.body;
        const m = parseInt(month);
        const y = parseInt(year);

        // Get the summary for this month (reuse calculation)
        const summaryRes = { query: { month: m, year: y }, tenantId: req.tenantId };

        const daysInMonthClose = time.dayUTC(`${y}-${String(m).padStart(2, '0')}-01`).daysInMonth();
        const startOfMonth = new Date(Date.UTC(y, m - 1, 1));
        const endOfMonth = new Date(Date.UTC(y, m - 1, daysInMonthClose, 23, 59, 59, 999));

        const employees = await prisma.employee.findMany({
            where: { tenantId: req.tenantId, status: 'active' },
        });

        const empIds = employees.map(e => e.id);

        const [compOffs, permissions, leaveRequests, prevBalances, timesheets, rawAssignments] = await Promise.all([
            prisma.compOff.findMany({ where: { tenantId: req.tenantId, month: m, year: y } }),
            prisma.permissionEntry.findMany({ where: { tenantId: req.tenantId, month: m, year: y } }),
            prisma.leaveRequest.findMany({
                where: {
                    tenantId: req.tenantId, status: 'approved',
                    startDate: { lte: endOfMonth }, endDate: { gte: startOfMonth },
                    employeeId: { in: empIds },
                },
                include: { leaveType: true },
            }),
            (() => {
                const prevMonth = m === 1 ? 12 : m - 1;
                const prevYear = m === 1 ? y - 1 : y;
                return prisma.monthlyBalance.findMany({ where: { tenantId: req.tenantId, month: prevMonth, year: prevYear } });
            })(),
            prisma.timesheet.findMany({
                where: { tenantId: req.tenantId, date: { gte: startOfMonth, lte: endOfMonth }, employeeId: { in: empIds } },
            }),
            prisma.employeeWorkShift.findMany({
                where: { employeeId: { in: empIds }, startDate: { lte: endOfMonth }, endDate: { gte: startOfMonth } },
                include: { workShift: true },
            }),
        ]);

        const shiftAssignments = {};
        for (const a of rawAssignments) {
            if (!shiftAssignments[a.employeeId]) shiftAssignments[a.employeeId] = [];
            shiftAssignments[a.employeeId].push({
                startMs: time.dayUTC(a.startDate).valueOf(),
                endMs: time.dayUTC(a.endDate).endOf('day').valueOf(),
                shift: a.workShift,
            });
        }

        const tsIdx = {};
        timesheets.forEach(t => { (tsIdx[t.employeeId] = tsIdx[t.employeeId] || []).push(t); });

        const prevBalIdx = {};
        prevBalances.forEach(b => { prevBalIdx[b.employeeId] = b; });

        // Calculate and store balance for each employee
        const results = await Promise.all(employees.map(async emp => {
            const ec = compOffs.filter(c => c.employeeId === emp.id);
            const ep = permissions.filter(p => p.employeeId === emp.id);
            const el = leaveRequests.filter(l => l.employeeId === emp.id);
            const et = tsIdx[emp.id] || [];
            const prevBal = prevBalIdx[emp.id] || {};

            const approvedEc = ec.filter(c => c.status === 'approved');
            const compOffTotalDays = approvedEc.reduce((s, c) => s + (c.days || 0), 0);
            const compOffTotalHours = approvedEc.reduce((s, c) => s + (c.hours || 0), 0);
            const compOffConverted = convertCompOffDaysHours(compOffTotalDays, compOffTotalHours);

            const clLeaves = el.filter(l => l.leaveType?.code === 'CL' || l.leaveType?.name?.toLowerCase().includes('casual'));
            const slLeaves = el.filter(l => l.leaveType?.code === 'SL' || l.leaveType?.name?.toLowerCase().includes('sick'));
            const elLeaves = el.filter(l => l.leaveType?.code === 'EL' || l.leaveType?.name?.toLowerCase().includes('earned') || l.leaveType?.name?.toLowerCase().includes('vacation'));

            const permTotalHours = ep.reduce((s, p) => s + (p.hours || 0), 0);
            const permConverted = convertPermDaysHours(permTotalHours);

            const elCredited = getElCredited(emp.leaveStartMonth, m, y, emp.category);

            // Late check-ins: same detection logic as /summary route
            const lateCheckInCount = et.filter(t => {
                if (!t.inAt) return false;
                const empShift = getEmployeeShiftForDate(emp.id, time.dayUTC(t.date), shiftAssignments);
                if (empShift && empShift.dayRecord && !empShift.dayRecord.isOff) {
                    const shiftStartMins = timeToMinutes(empShift.dayRecord.startTime);
                    const graceMins = empShift.dayRecord.graceMins || 0;
                    if (shiftStartMins !== null) {
                        const punchInMins = time.tz(t.inAt).hour() * 60 + time.tz(t.inAt).minute();
                        return punchInMins > shiftStartMins + graceMins;
                    }
                }
                const h = time.tz(t.inAt).hour();
                const min = time.tz(t.inAt).minute();
                return h > 9 || (h === 9 && min > 15);
            }).length;

            const allocation = getFreshLeaveAllocation(emp.category);
            const isLeaveStartMonth = allocation && emp.leaveStartMonth && m === emp.leaveStartMonth;
            const prevCl = isLeaveStartMonth ? allocation.cl : (prevBal.clBalance || 0);
            const prevSl = isLeaveStartMonth ? allocation.sl : (prevBal.slBalance || 0);

            const calc = calculateSummary({
                clAvailed: clLeaves.reduce((s, l) => s + (l.days || 0), 0),
                lateCheckInCount,
                slAvailed: slLeaves.reduce((s, l) => s + (l.days || 0), 0),
                elUtilised: elLeaves.reduce((s, l) => s + (l.days || 0), 0),
                elCredited,
                compOffDaysCurrent: compOffConverted.days,
                compOffHoursCurrent: compOffConverted.hours,
                permDaysCurrent: permConverted.days,
                permHoursCurrent: permConverted.hours,
                prevCl,
                prevSl,
                prevElBalance: prevBal.elBalance || 0,
                prevCompOffDays: prevBal.compOffDays || 0,
                prevCompOffHours: prevBal.compOffHours || 0,
                prevPermDays: prevBal.lateEarlyDays || 0,
                prevPermHours: prevBal.lateEarlyHours || 0,
            });

            // Negative balances → 0 for next month carry-forward (per Notes rule)
            return prisma.monthlyBalance.upsert({
                where: { employeeId_month_year: { employeeId: emp.id, month: m, year: y } },
                update: {
                    compOffDays: Math.max(0, calc.balance.compOffDays),
                    compOffHours: Math.max(0, calc.balance.compOffHours),
                    clBalance: Math.max(0, calc.balance.cl),
                    slBalance: Math.max(0, calc.balance.sl),
                    elBalance: Math.max(0, calc.balance.el),
                    lateEarlyDays: 0,
                    lateEarlyHours: Math.max(0, calc.balance.permHours),
                    lopDays: calc.lopDays,
                    isClosed: true,
                },
                create: {
                    tenantId: req.tenantId,
                    employeeId: emp.id,
                    month: m,
                    year: y,
                    compOffDays: Math.max(0, calc.balance.compOffDays),
                    compOffHours: Math.max(0, calc.balance.compOffHours),
                    clBalance: Math.max(0, calc.balance.cl),
                    slBalance: Math.max(0, calc.balance.sl),
                    elBalance: Math.max(0, calc.balance.el),
                    lateEarlyDays: 0,
                    lateEarlyHours: Math.max(0, calc.balance.permHours),
                    lopDays: calc.lopDays,
                    isClosed: true,
                },
            });
        }));

        res.json({ message: `Month ${m}/${y} closed for ${results.length} employees`, count: results.length });
    } catch (error) { next(error); }
});

// ─── SETUP HELPERS ───────────────────────────────

// POST /api/compoff/seed-leave-types — ensure CL, SL, EL leave types exist
router.post('/seed-leave-types', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const types = [
            { code: 'CL', name: 'Casual Leave', maxDays: 12, color: '#3b82f6' },
            { code: 'SL', name: 'Sick Leave', maxDays: 12, color: '#f59e0b' },
            { code: 'EL', name: 'Earned Leave', maxDays: 30, color: '#22c55e' },
        ];
        const results = [];
        for (const t of types) {
            const existing = await prisma.leaveType.findUnique({
                where: { tenantId_code: { tenantId: req.tenantId, code: t.code } },
            });
            if (!existing) {
                const created = await prisma.leaveType.create({
                    data: { tenantId: req.tenantId, ...t },
                });
                results.push({ ...t, action: 'created', id: created.id });
            } else {
                results.push({ ...t, action: 'already exists', id: existing.id });
            }
        }
        res.json({ message: 'Leave types seeded', results });
    } catch (error) { next(error); }
});

// POST /api/compoff/set-initial-balance — set starting balances for employees
router.post('/set-initial-balance', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const { employeeId, month, year, clBalance, slBalance, elBalance, compOffDays, compOffHours } = req.body;

        if (!employeeId || !month || !year) {
            return res.status(400).json({ error: 'employeeId, month, and year are required' });
        }

        const m = parseInt(month);
        const y = parseInt(year);

        const balance = await prisma.monthlyBalance.upsert({
            where: {
                employeeId_month_year: {
                    employeeId: parseInt(employeeId),
                    month: m,
                    year: y,
                },
            },
            update: {
                clBalance: parseFloat(clBalance || 0),
                slBalance: parseFloat(slBalance || 0),
                elBalance: parseFloat(elBalance || 0),
                compOffDays: parseFloat(compOffDays || 0),
                compOffHours: parseFloat(compOffHours || 0),
                isClosed: true,
            },
            create: {
                tenantId: req.tenantId,
                employeeId: parseInt(employeeId),
                month: m,
                year: y,
                clBalance: parseFloat(clBalance || 0),
                slBalance: parseFloat(slBalance || 0),
                elBalance: parseFloat(elBalance || 0),
                compOffDays: parseFloat(compOffDays || 0),
                compOffHours: parseFloat(compOffHours || 0),
                isClosed: true,
            },
        });

        res.json({ message: `Initial balance set for employee ${employeeId} at ${m}/${y}`, balance });
    } catch (error) { next(error); }
});

// POST /api/compoff/bulk-set-initial-balance — set starting CL/SL for ALL employees at once
router.post('/bulk-set-initial-balance', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const { month, year, clBalance, slBalance, elBalance } = req.body;

        if (!month || !year) {
            return res.status(400).json({ error: 'month and year are required' });
        }

        const m = parseInt(month);
        const y = parseInt(year);

        const employees = await prisma.employee.findMany({
            where: { tenantId: req.tenantId, status: 'active' },
            select: { id: true },
        });

        let created = 0;
        let updated = 0;
        for (const emp of employees) {
            const existing = await prisma.monthlyBalance.findUnique({
                where: { employeeId_month_year: { employeeId: emp.id, month: m, year: y } },
            });

            if (existing) {
                await prisma.monthlyBalance.update({
                    where: { id: existing.id },
                    data: {
                        clBalance: parseFloat(clBalance || 0),
                        slBalance: parseFloat(slBalance || 0),
                        elBalance: parseFloat(elBalance || 0),
                        isClosed: true,
                    },
                });
                updated++;
            } else {
                await prisma.monthlyBalance.create({
                    data: {
                        tenantId: req.tenantId,
                        employeeId: emp.id,
                        month: m,
                        year: y,
                        clBalance: parseFloat(clBalance || 0),
                        slBalance: parseFloat(slBalance || 0),
                        elBalance: parseFloat(elBalance || 0),
                        isClosed: true,
                    },
                });
                created++;
            }
        }

        res.json({ message: `Bulk initial balance set for ${m}/${y}: ${created} created, ${updated} updated`, created, updated });
    } catch (error) { next(error); }
});

module.exports = router;
