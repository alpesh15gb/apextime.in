const router = require('express').Router();
const prisma = require('../lib/prisma');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Kolkata';

// Helper to format duration (ms -> HH:mm)
const formatDuration = (ms) => {
    if (!ms || ms < 0) return '00:00';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

// Map dayjs day() (0=Sun, 1=Mon...) to shift record day names
const DAY_MAP = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Parse "HH:mm" to minutes since midnight
const timeToMinutes = (t) => {
    if (!t) return null;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
};

// Find the active shift for an employee on a specific date
const getEmployeeShiftForDate = (empId, dateObj, shiftAssignments) => {
    const assignments = shiftAssignments[empId];
    if (!assignments || assignments.length === 0) return null;

    const dateMs = dateObj.valueOf();
    // Find an assignment where startDate <= date <= endDate
    for (const assign of assignments) {
        if (dateMs >= assign.startMs && dateMs <= assign.endMs) {
            const dayName = DAY_MAP[dateObj.day()];
            const dayRecord = (assign.shift.records || []).find(r => r.day === dayName);
            return {
                shiftName: assign.shift.name,
                dayRecord: dayRecord || null,
                isFlexible: assign.shift.isFlexible,
                minHours: assign.shift.minHours,
                lunchDuration: assign.shift.lunchDuration,
                lunchThreshold: assign.shift.lunchThreshold,
            };
        }
    }
    return null;
};

// Generic Helper for Attendance Grid Data
const getAttendanceGridData = async (tenantId, startDate, endDate, departmentId) => {
    const start = dayjs.tz(startDate, TZ).startOf('day');
    const end = dayjs.tz(endDate, TZ).endOf('day');
    const diffDays = end.diff(start, 'day') + 1;

    // 1. Fetch Employees
    const where = { tenantId, status: 'active' };
    if (departmentId) where.departmentId = parseInt(departmentId);

    const employees = await prisma.employee.findMany({
        where,
        include: {
            contact: true,
            department: true,
            designation: true,
        },
        orderBy: { employeeCode: 'asc' }
    });

    const empIds = employees.map(e => e.id);

    // 2. Fetch Timesheets
    const timesheets = await prisma.timesheet.findMany({
        where: {
            tenantId,
            date: { 
                gte: dayjs.utc(startDate).startOf('day').toDate(), 
                lte: dayjs.utc(endDate).endOf('day').toDate() 
            },
            employeeId: { in: empIds }
        }
    });

    // 3. Fetch Shift Assignments
    const rawAssignments = await prisma.employeeWorkShift.findMany({
        where: {
            employeeId: { in: empIds },
            startDate: { lte: end.toDate() },
            endDate: { gte: start.toDate() },
        },
        include: {
            workShift: true
        }
    });

    const shiftAssignments = {};
    for (const a of rawAssignments) {
        if (!shiftAssignments[a.employeeId]) shiftAssignments[a.employeeId] = [];
        shiftAssignments[a.employeeId].push({
            startMs: dayjs(a.startDate).startOf('day').valueOf(),
            endMs: dayjs(a.endDate).endOf('day').valueOf(),
            shift: a.workShift,
        });
    }

    // 4. Build Grid Data
    const reportData = employees.map(emp => {
        const rowData = {
            id: emp.id,
            name: `${emp.contact.firstName} ${emp.contact.lastName || ''}`.trim(),
            code: emp.employeeCode,
            designation: emp.designation?.name || '-',
            department: emp.department?.name || '-',
            days: {},
            stats: {
                present: 0, absent: 0, wo: 0, leave: 0,
                totalWorkMs: 0, totalOtMs: 0, totalLateMs: 0,
            }
        };

        for (let i = 0; i < diffDays; i++) {
            const currentDay = start.add(i, 'day');
            const d = currentDay.valueOf(); // Using timestamp as key for cross-month ranges
            const dayKey = currentDay.format('YYYY-MM-DD');
            const dayOfWeek = currentDay.day();

            let status = 'A';
            let shiftName = 'GEN';
            let inTime = '', outTime = '', inTimeLunch = '', outTimeLunch = '', late = '00:00', early = '00:00', ot = '00:00';
            let workMs = 0, lateMs = 0, otMs = 0, lunchMs = 0;

            let dayRec = null;
            const empShift = getEmployeeShiftForDate(emp.id, currentDay, shiftAssignments);
            
            // Find timesheet for this day robustly using UTC date part comparison
            const record = timesheets.find(t => t.employeeId === emp.id && dayjs.utc(t.date).format('YYYY-MM-DD') === dayKey);

            if (empShift) {
                shiftName = empShift.shiftName;
                dayRec = empShift.dayRecord;
                if (dayRec && dayRec.isOff) {
                    status = 'WO';
                    shiftName = 'OFF';
                }

                if (record) {
                    if (record.inAt) { inTime = dayjs.tz(record.inAt, TZ).format('HH:mm'); status = 'P'; }
                    if (record.outAt) { 
                        outTime = dayjs.tz(record.outAt, TZ).format('HH:mm'); 
                        let grossWorkMs = dayjs(record.outAt).diff(dayjs(record.inAt));
                        
                        // Lunch Logic Removed per user request
                        lunchMs = 0;
                        workMs = grossWorkMs;
                    }

                    if (empShift.isFlexible) {
                        // Flexible Shift Logic (Bakery)
                        const minWorkMs = (empShift.minHours || 0) * 3600000;
                        lateMs = 0; // No late in flexible shift
                        if (record.inAt && record.outAt && minWorkMs > 0) {
                            if (workMs < minWorkMs) {
                                early = formatDuration(minWorkMs - workMs);
                            } else if (workMs > minWorkMs) {
                                otMs = workMs - minWorkMs;
                                ot = formatDuration(otMs);
                            }
                        }
                    } else if (dayRec && !dayRec.isOff) {
                        // Fixed Shift Logic (Now also using duration-based OT as requested)
                        const minWorkMs = (empShift.minHours || 9) * 3600000;
                        
                        // Still calculate Late for fixed shifts
                        const shiftStartMins = timeToMinutes(dayRec.startTime);
                        const graceMins = dayRec.graceMins || 0;
                        if (record.inAt && shiftStartMins !== null) {
                            const punchIn = dayjs.tz(record.inAt, TZ);
                            const punchInMins = punchIn.hour() * 60 + punchIn.minute();
                            const allowedStart = shiftStartMins + graceMins;
                            if (punchInMins > allowedStart) {
                                lateMs = (punchInMins - shiftStartMins) * 60000;
                                late = formatDuration(lateMs);
                            }
                        }

                        if (workMs < minWorkMs) {
                            early = formatDuration(minWorkMs - workMs);
                        } else if (workMs > minWorkMs) {
                            otMs = workMs - minWorkMs;
                            ot = formatDuration(otMs);
                        }
                    }

                    if (dayRec && dayRec.isOff && record.inAt && !empShift.isFlexible) {
                        status = 'P';
                        if (workMs > 0) { otMs = workMs; ot = formatDuration(otMs); }
                    }
                }
            } else {
                if (dayOfWeek === 0) { status = 'WO'; shiftName = 'OFF'; }
                if (record) {
                    if (record.inAt) { inTime = dayjs(record.inAt).format('HH:mm'); status = 'P'; }
                    if (record.outAt) { 
                        outTime = dayjs(record.outAt).format('HH:mm'); 
                        workMs = dayjs(record.outAt).diff(dayjs(record.inAt)); 
                    }
                    
                    // OPTION C: Default to 9-hour flexible logic for unassigned employees
                    const minWorkMs = 9 * 3600000;
                    if (workMs > 0) {
                        // Apply default lunch logic for unassigned
                        // Apply default lunch logic for unassigned (Removed)
                        lunchMs = 0;

                        if (workMs < minWorkMs) {
                            early = formatDuration(minWorkMs - workMs);
                        } else if (workMs > minWorkMs) {
                            otMs = workMs - minWorkMs;
                            ot = formatDuration(otMs);
                        }
                    }
                }
            }

            if (status === 'P') rowData.stats.present++;
            else if (status === 'A') rowData.stats.absent++;
            else if (status === 'WO') rowData.stats.wo++;

            rowData.stats.totalWorkMs += workMs;
            rowData.stats.totalOtMs += otMs;
            rowData.stats.totalLateMs += lateMs;

            rowData.days[dayKey] = {
                date: dayKey,
                dayLabel: currentDay.date(),
                in: inTime, out: outTime, 
                shift: shiftName,
                shiftStart: dayRec?.startTime || '',
                shiftEnd: dayRec?.endTime || '',
                status, late, early, ot, 
                workHrs: formatDuration(workMs),
                lunch: formatDuration(lunchMs),
                shiftLunchDuration: empShift?.lunchDuration || 1.0,
                lunchOut: outTimeLunch,
                lunchIn: inTimeLunch
            };
        }

        rowData.stats.totalWorkHrs = formatDuration(rowData.stats.totalWorkMs);
        rowData.stats.totalOtHrs = formatDuration(rowData.stats.totalOtMs);
        rowData.stats.totalLateHrs = formatDuration(rowData.stats.totalLateMs);
        return rowData;
    });

    return {
        meta: {
            startDate: start.format('YYYY-MM-DD'),
            endDate: end.format('YYYY-MM-DD'),
            daysCount: diffDays,
            monthName: start.format('MMMM'),
            year: start.year()
        },
        data: reportData
    };
};

// GET /api/reports/grid (Daily, Weekly, or Custom)
router.get('/grid', async (req, res, next) => {
    try {
        const { startDate, endDate, departmentId } = req.query;
        if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });
        const result = await getAttendanceGridData(req.tenantId, startDate, endDate, departmentId);
        res.json(result);
    } catch (error) { next(error); }
});

// GET /api/reports/monthly
router.get('/monthly', async (req, res, next) => {
    try {
        const { month, year, departmentId } = req.query;
        const m = month ? parseInt(month) : dayjs().month() + 1;
        const y = year ? parseInt(year) : dayjs().year();

        const startOfMonth = dayjs.tz(`${y}-${m}-01`, TZ).startOf('month').format('YYYY-MM-DD');
        const endOfMonth = dayjs.tz(`${y}-${m}-01`, TZ).endOf('month').format('YYYY-MM-DD');

        const result = await getAttendanceGridData(req.tenantId, startOfMonth, endOfMonth, departmentId);
        res.json(result);
    } catch (error) { next(error); }
});

// GET /api/reports/approvals
router.get('/approvals', async (req, res, next) => {
    try {
        const { startDate, endDate, status, departmentId } = req.query;

        const start = startDate ? new Date(startDate) : dayjs().startOf('month').toDate();
        const end = endDate ? new Date(endDate) : dayjs().endOf('month').toDate();

        const where = {
            tenantId: req.tenantId,
            date: { gte: start, lte: end },
            status: status ? status : { in: ['approved', 'rejected', 'pending'] }
        };

        if (departmentId) where.employee = { departmentId: parseInt(departmentId) };

        const records = await prisma.timesheet.findMany({
            where,
            include: {
                employee: {
                    include: {
                        contact: true,
                        department: true
                    }
                },
                reviewer: {
                    select: { username: true, role: true }
                }
            },
            orderBy: { date: 'desc' }
        });

        const formatted = records.map(r => {
            const lat = r.meta?.in?.latitude || r.meta?.latitude;
            const lng = r.meta?.in?.longitude || r.meta?.longitude;

            return {
                id: r.id,
                date: dayjs.utc(r.date).format('YYYY-MM-DD'),
                employeeName: `${r.employee.contact.firstName} ${r.employee.contact.lastName || ''}`.trim(),
                employeeCode: r.employee.employeeCode,
                department: r.employee.department?.name || '-',
                inTime: r.inAt ? dayjs.tz(r.inAt, TZ).format('HH:mm') : '-',
                outTime: r.outAt ? dayjs.tz(r.outAt, TZ).format('HH:mm') : '-',
                status: r.status,
                reviewedBy: r.reviewer?.username || (r.status === 'auto_approved' ? 'System' : '-'),
                reviewedAt: r.reviewedAt ? dayjs(r.reviewedAt).format('YYYY-MM-DD HH:mm') : '-',
                remarks: r.remarks || '-',
                photoUrl: r.meta?.in?.photo_url || r.meta?.photo_url || null,
                location: lat ? `${lat}, ${lng}` : '-'
            };
        });

        res.json(formatted);

    } catch (error) { next(error); }
});

// TEMPORARY: Fix timezone data issue (10th showing on 9th)
router.get('/fix-tz-data', async (req, res, next) => {
    try {
        console.log('[Fix] Starting timezone data fix...');
        // Find all timesheets on May 9th for the current tenant
        const timesheets = await prisma.timesheet.findMany({
            where: {
                tenantId: req.tenantId,
                date: dayjs.tz('2026-05-09', TZ).startOf('day').toDate()
            }
        });

        let movedCount = 0;
        for (const ts of timesheets) {
            // Check if the punch-in or any punch is actually on May 10th in IST
            const inAt = ts.inAt ? dayjs.tz(ts.inAt, TZ) : null;
            if (inAt && inAt.format('YYYY-MM-DD') === '2026-05-10') {
                console.log(`[Fix] Moving timesheet ${ts.id} for employee ${ts.employeeId} to May 10th`);
                await prisma.timesheet.update({
                    where: { id: ts.id },
                    data: { date: dayjs.tz('2026-05-10', TZ).startOf('day').toDate() }
                });
                movedCount++;
            }
        }

        res.json({ success: true, moved: movedCount, checked: timesheets.length });
    } catch (error) {
        console.error('[Fix] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
