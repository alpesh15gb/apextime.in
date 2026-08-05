const router = require('express').Router();
const prisma = require('../lib/prisma');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const time = require('../lib/time');

const TZ = time.TZ;

// Default minimum work hours for employees without a shift assignment
// (rotational / irregular staff). No late/early penalties are applied to
// unassigned days — only hours vs this minimum are compared.
const DEFAULT_MIN_HOURS = 8;

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

// Check if a shift day record is an overnight shift (endTime < startTime, e.g., 22:00-06:00)
const isOvernightShift = (dayRecord) => {
    if (!dayRecord || dayRecord.isOff || !dayRecord.startTime || !dayRecord.endTime) return false;
    if (dayRecord.isOvernight) return true; // Explicit flag from UI
    const start = timeToMinutes(dayRecord.startTime);
    const end = timeToMinutes(dayRecord.endTime);
    return start !== null && end !== null && end < start;
};

// Find the active shift for an employee on a specific date
const getEmployeeShiftForDate = (empId, dateObj, shiftAssignments) => {
    const assignments = shiftAssignments[empId];
    if (!assignments || assignments.length === 0) return null;

    const dayStr = dateObj.format('YYYY-MM-DD');
    for (const assign of assignments) {
        if (dayStr >= assign.startStr && dayStr <= assign.endStr) {
            const dayName = DAY_MAP[dateObj.day()];
            const dayRecord = (assign.shift.records || []).find(r => r.day === dayName);
            return {
                shiftName: assign.shift.name,
                dayRecord: dayRecord || null,
                isFlexible: assign.shift.isFlexible,
                minHours: assign.shift.minHours,
                lunchDuration: assign.shift.lunchDuration,
                lunchThreshold: assign.shift.lunchThreshold,
                halfDayMins: assign.shift.halfDayMins,
                absentDayMins: assign.shift.absentDayMins,
                halfDayLateMins: assign.shift.halfDayLateMins,
                halfDayEarlyMins: assign.shift.halfDayEarlyMins,
                earlyGraceMins: assign.shift.earlyGraceMins,
                otFormula: assign.shift.otFormula,
                maxOtHours: assign.shift.maxOtHours,
                markAbsentForLate: assign.shift.markAbsentForLate,
                continuousLateDays: assign.shift.continuousLateDays,
                absentDayType: assign.shift.absentDayType,
                break1Enabled: assign.shift.break1Enabled,
                break1Start: assign.shift.break1Start,
                break1End: assign.shift.break1End,
                break2Enabled: assign.shift.break2Enabled,
                break2Start: assign.shift.break2Start,
                break2End: assign.shift.break2End,
                punchBeginDuration: assign.shift.punchBeginDuration,
                punchEndDuration: assign.shift.punchEndDuration,
                considerEarlyPunch: assign.shift.considerEarlyPunch,
                considerLatePunch: assign.shift.considerLatePunch,
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

    // 2. Fetch Timesheets — extend 1 day before grid start to catch overnight continuations
    const extendedStart = start.subtract(1, 'day');
    const timesheets = await prisma.timesheet.findMany({
        where: {
            tenantId,
            date: { 
                gte: dayjs.utc(extendedStart.toDate()).startOf('day').toDate(), 
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
            // Compare by calendar-date STRING: currentDay is an IST-midnight
            // instant while @db.Date columns are UTC-midnight — instant
            // comparisons would be off by 5.5h at the boundaries.
            startStr: time.dayUTC(a.startDate).format('YYYY-MM-DD'),
            endStr: time.dayUTC(a.endDate).format('YYYY-MM-DD'),
            shift: a.workShift,
        });
    }

    // 3a. Fetch Holidays for the period
    const allHolidays = await prisma.holiday.findMany({
        where: {
            tenantId,
            date: { 
                gte: dayjs.utc(extendedStart.toDate()).startOf('day').toDate(), 
                lte: dayjs.utc(end.toDate()).endOf('day').toDate() 
            },
        }
    });
    const holidaySet = new Set(allHolidays.map(h => time.dayUTC(h.date).format('YYYY-MM-DD')));

    // 3b. Fetch Approved Leaves for the date range
    const leaveRequests = await prisma.leaveRequest.findMany({
        where: {
            tenantId,
            employeeId: { in: empIds },
            status: 'approved',
            endDate: { gte: dayjs.utc(start.toDate()).startOf('day').toDate() },
            startDate: { lte: dayjs.utc(end.toDate()).endOf('day').toDate() },
        },
        include: { leaveType: true }
    });

    // Build leave map: employeeId -> [{ startStr, endStr, leaveType, days }]
    const leaveMap = {};
    for (const lr of leaveRequests) {
        if (!leaveMap[lr.employeeId]) leaveMap[lr.employeeId] = [];
        leaveMap[lr.employeeId].push({
            startStr: time.dayUTC(lr.startDate).format('YYYY-MM-DD'),
            endStr: time.dayUTC(lr.endDate).format('YYYY-MM-DD'),
            leaveType: lr.leaveType,
            days: lr.days,
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
                present: 0, absent: 0, wo: 0, leave: 0, hld: 0,
                totalWorkMs: 0, totalOtMs: 0, totalLateMs: 0,
            }
        };

        for (let i = 0; i < diffDays; i++) {
            const currentDay = start.add(i, 'day');
            const dayKey = currentDay.format('YYYY-MM-DD');
            const dayOfWeek = currentDay.day();

            let status = 'A';
            let shiftName = 'GEN';
            let inTime = '', outTime = '', inTimeLunch = '', outTimeLunch = '', late = '00:00', early = '00:00', ot = '00:00';
            let workMs = 0, lateMs = 0, earlyMs = 0, otMs = 0, lunchMs = 0, lossOfHoursMs = 0, missedOut = false;
            // ── ESSL-parity fields ──
            let inDurationMs = 0, outDurationMs = 0, shiftDurationMs = 0;
            let holiday = false, weeklyOff = false, isOnLeave = false, leaveTypeStr = '', leaveDuration = 0;
            let dayStatus = 'A', presentNum = 0, absentNum = 0, statusCode = 0;
            let inDevice = '', outDevice = '', lastPunch = '', direction = '';
            let weeklyOffPresent = 0, holidayPresent = 0, punchCount = 0;

            let dayRec = null;
            const empShift = getEmployeeShiftForDate(emp.id, currentDay, shiftAssignments);
            
            // ── Find timesheet(s) for this day ──
            // Primary: timesheets where date === dayKey (shift started this day)
            const primaryRecords = timesheets.filter(t => 
                t.employeeId === emp.id && dayjs.utc(t.date).format('YYYY-MM-DD') === dayKey
            );
            
            // Overnight continuation: timesheet from PREVIOUS day where outAt falls on current day
            const prevDayKey = currentDay.subtract(1, 'day').format('YYYY-MM-DD');
            const continuationRecords = timesheets.filter(t => {
                if (t.employeeId !== emp.id) return false;
                if (dayjs.utc(t.date).format('YYYY-MM-DD') !== prevDayKey) return false;
                if (!t.outAt) return false;
                const outDay = dayjs.tz(t.outAt, TZ).format('YYYY-MM-DD');
                return outDay === dayKey;
            });

            // Is this day ONLY a continuation (no timesheet started today)?
            const overnightContinuation = (continuationRecords.length > 0 && primaryRecords.length === 0)
                ? continuationRecords[0] : null;

            // Merge primary records for the same day (pick earliest IN and latest OUT)
            let record = null;
            if (primaryRecords.length > 1) {
                record = {
                    inAt: primaryRecords.reduce((min, r) => !min || (r.inAt && r.inAt < min) ? r.inAt : min, null),
                    outAt: primaryRecords.reduce((max, r) => !max || (r.outAt && r.outAt > max) ? r.outAt : max, null),
                    punches: primaryRecords.reduce((acc, r) => [...acc, ...(r.punches || [])], []),
                    status: primaryRecords.some(r => r.status === 'approved') ? 'approved' : primaryRecords[0].status
                };
            } else if (primaryRecords.length === 1) {
                record = primaryRecords[0];
            }

            if (empShift) {
                shiftName = empShift.shiftName;
                dayRec = empShift.dayRecord;
                const dayIsOvernight = isOvernightShift(dayRec);
                
                if (dayRec && dayRec.isOff) {
                    status = 'WO';
                    shiftName = 'OFF';
                }

                // ── Overnight continuation: OUT from yesterday's shift shows today ──
                if (overnightContinuation && dayRec && !dayRec.isOff) {
                    status = 'P';
                    inTime = '00:00';
                    const contOut = dayjs.tz(overnightContinuation.outAt, TZ);
                    outTime = contOut.format('HH:mm');
                    
                    // Work hours for continuation day: from midnight to OUT
                    const midnight = currentDay.startOf('day');
                    workMs = contOut.diff(midnight);
                    
                    // No late on continuation day — late is on the IN day
                    late = '00:00';
                    lateMs = 0;
                    
                    // No early/OT on continuation day — calculated on total shift hours on IN day
                    early = '00:00';
                    ot = '00:00';
                }
                // ── Normal record or overnight IN day ──
                else if (record) {
                    if (record.inAt) { inTime = dayjs.tz(record.inAt, TZ).format('HH:mm'); status = 'P'; }
                    if (record.outAt) { 
                        const outDt = dayjs.tz(record.outAt, TZ);
                        const inDt = dayjs.tz(record.inAt, TZ);
                        const outDay = outDt.format('YYYY-MM-DD');
                        
                        if (dayIsOvernight && outDay > dayKey) {
                            // Overnight shift: OUT is on the next day
                            // This day's portion: from IN to midnight (next day start)
                            outTime = '00:00';
                            const nextDayMidnight = currentDay.add(1, 'day').startOf('day');
                            workMs = nextDayMidnight.diff(inDt);
                        } else {
                            // Normal: OUT is on the same day
                            outTime = outDt.format('HH:mm');
                            workMs = outDt.diff(inDt);
                        }
                        
                        lunchMs = 0;
                    } else if (record.inAt && !record.outAt) {
                        // Only IN, no OUT yet — missed out punch
                        status = 'P';
                        missedOut = true;
                    }

                    if (empShift.isFlexible) {
                        const minWorkMs = (empShift.minHours || 0) * 3600000;
                        lateMs = 0;
                        if (record.inAt && record.outAt && minWorkMs > 0) {
                            const totalWorkMs = dayjs(record.outAt).diff(dayjs(record.inAt));
                            if (totalWorkMs < minWorkMs) {
                                early = formatDuration(minWorkMs - totalWorkMs);
                            } else if (totalWorkMs > minWorkMs) {
                                otMs = totalWorkMs - minWorkMs;
                                ot = formatDuration(otMs);
                            }
                        }
                    } else if (dayRec && !dayRec.isOff) {
                        const minWorkMs = (empShift.minHours || 9) * 3600000;
                        
                        // Late — only on the IN day
                        const shiftStartMins = timeToMinutes(dayRec.startTime);
                        const shiftEndMins = timeToMinutes(dayRec.endTime); // was referenced but never defined → ReferenceError
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

                        // Early — time from last punch to shift end (ESSL logic: shiftEnd - lastPunch)
                        if (record.outAt && shiftEndMins !== null) {
                            const punchOut = dayjs.tz(record.outAt, TZ);
                            const punchOutMins = punchOut.hour() * 60 + punchOut.minute();
                            // For overnight: if OUT is on next day, shift end is shifted
                            let actualShiftEndMins = shiftEndMins;
                            if (dayIsOvernight && outDay && outDay > dayKey) {
                                actualShiftEndMins = shiftEndMins + 24 * 60;
                            }
                            if (punchOutMins < actualShiftEndMins) {
                                earlyMs = (actualShiftEndMins - punchOutMins) * 60000;
                                early = formatDuration(earlyMs);
                            }
                        }
                    }
                        // ── ESSL-equivalent: Loss of Hours, Half-Day, Absent, OT cap ──
                        if (dayRec && !dayRec.isOff && status === 'P') {
                            // Compute shift duration from day record
                            const shiftStartMins2 = timeToMinutes(dayRec.startTime);
                            const shiftEndMins2 = timeToMinutes(dayRec.endTime);
                            if (shiftStartMins2 !== null && shiftEndMins2 !== null) {
                                let shiftDurationMins = shiftEndMins2 - shiftStartMins2;
                                if (shiftDurationMins < 0) shiftDurationMins += 24 * 60; // overnight
                                const shiftDurationMs2 = shiftDurationMins * 60000;

                                // Break deduction
                                let breakDeductionMs = 0;
                                if (empShift.break1Enabled && record && record.outAt) {
                                    const b1End = timeToMinutes(empShift.break1End || '13:30');
                                    if (b1End !== null && workMs > 0) {
                                        const b1Start2 = timeToMinutes(empShift.break1Start || '13:00');
                                        if (b1Start2 !== null) breakDeductionMs += (b1End - b1Start2) * 60000;
                                    }
                                }
                                if (empShift.break2Enabled && record && record.outAt) {
                                    const b2End = timeToMinutes(empShift.break2End || '17:30');
                                    if (b2End !== null && workMs > 0) {
                                        const b2Start2 = timeToMinutes(empShift.break2Start || '17:00');
                                        if (b2Start2 !== null) breakDeductionMs += (b2End - b2Start2) * 60000;
                                    }
                                }

                                // Loss of hours = shift duration - actual work (when leaving early)
                                const effectiveWorkMs = workMs + breakDeductionMs;
                                if (effectiveWorkMs < shiftDurationMs2) {
                                    lossOfHoursMs = shiftDurationMs2 - effectiveWorkMs;
                                }

                                // OT calculation with FULL ESSL formulas
                                const otFormula = empShift.otFormula || 'total_duration_minus_shift';
                                const considerEarly = empShift.considerEarlyPunch !== false;
                                const considerLate = empShift.considerLatePunch !== false;
                                
                                // Calculate punches outside shift window
                                let durationBeforeShiftMs = 0;
                                let durationAfterShiftMs = 0;
                                let actualShiftEndMins = shiftEndMins2 / 60000;
                                if (dayIsOvernight) actualShiftEndMins += 24 * 60;
                                
                                if (record.inAt) {
                                    const punchIn = dayjs.tz(record.inAt, TZ);
                                    const punchInMins = punchIn.hour() * 60 + punchIn.minute();
                                    if (punchInMins < shiftStartMins2 / 60000) {
                                        durationBeforeShiftMs = (shiftStartMins2 / 60000 - punchInMins) * 60000;
                                    }
                                }
                                if (record.outAt) {
                                    const punchOut = dayjs.tz(record.outAt, TZ);
                                    const punchOutMins = punchOut.hour() * 60 + punchOut.minute();
                                    if (punchOutMins > actualShiftEndMins) {
                                        durationAfterShiftMs = (punchOutMins - actualShiftEndMins) * 60000;
                                    }
                                }
                                
                                // Apply OT formulas
                                if (otFormula === 'not_applicable') {
                                    otMs = 0;
                                } else if (otFormula === 'out_punch_minus_shift_end') {
                                    // Out Punch - Shift End Time
                                    otMs = durationAfterShiftMs;
                                } else if (otFormula === 'duration_minus_shift') {
                                    // Total Duration - Shift Hours (ESSL default)
                                    const totalWorkMs = dayjs(record.outAt).diff(dayjs(record.inAt));
                                    otMs = totalWorkMs - shiftDurationMs2;
                                    if (!considerEarly) otMs -= durationBeforeShiftMs;
                                    if (!considerLate) otMs -= durationAfterShiftMs;
                                } else if (otFormula === 'early_plus_late') {
                                    // Early Coming + Late Going
                                    if (considerEarly) otMs = durationBeforeShiftMs;
                                    if (considerLate) otMs += durationAfterShiftMs;
                                } else {
                                    // Default fallback
                                    otMs = Math.max(0, effectiveWorkMs - shiftDurationMs2);
                                }
                                otMs = Math.max(0, otMs);
                                ot = formatDuration(otMs);

                                // Early going grace
                                if (lateMs > 0 && empShift.earlyGraceMins > 0) {
                                    const earlyGraceMs = empShift.earlyGraceMins * 60000;
                                    if (earlyMs > 0) {
                                        // Apply early grace (reduce early by grace period)
                                        // Note: earlyMs is not yet computed at this point for non-flexible
                                        // It's computed below via shift end comparison
                                    }
                                }
                            }

                            // Half-day by duration
                            const halfDayMs = (empShift.halfDayMins || 240) * 60000;
                            const absentDayMs = (empShift.absentDayMins || 60) * 60000;
                            if (workMs > 0 && workMs < halfDayMs) {
                                status = 'PH';
                            }
                            // Half-day by late
                            const halfDayLateMs = (empShift.halfDayLateMins || 30) * 60000;
                            if (status === 'P' && lateMs > halfDayLateMs) {
                                status = 'PH';
                            }
                            // Half-day by early going
                            const halfDayEarlyMs = (empShift.halfDayEarlyMins || 30) * 60000;
                            if (status === 'P' && earlyMs > halfDayEarlyMs) {
                                status = 'PH';
                            }
                            // Absent by duration (below absent threshold even though some work done)
                            if (workMs > 0 && workMs < absentDayMs) {
                                status = 'A';
                            }
                        }

                    if (dayRec && dayRec.isOff && record.inAt && !empShift.isFlexible) {
                        status = 'P';
                        if (workMs > 0) { otMs = workMs; ot = formatDuration(otMs); }
                    }
                }
            } else {
                // No shift assigned — rotational / irregular staff:
                // flexible handling (per product decision): no late/early
                // penalties, just hours worked vs the default minimum.
                if (dayOfWeek === 0) { status = 'WO'; shiftName = 'OFF'; }
                
                // Overnight continuation even without shift
                if (overnightContinuation) {
                    status = 'P';
                    inTime = '00:00';
                    const contOut = dayjs.tz(overnightContinuation.outAt, TZ);
                    outTime = contOut.format('HH:mm');
                    const midnight = currentDay.startOf('day');
                    workMs = contOut.diff(midnight);
                } else if (record) {
                    if (record.inAt) { inTime = time.timeStrIST(record.inAt); status = 'P'; }
                    if (record.outAt) { 
                        outTime = time.timeStrIST(record.outAt);
                        workMs = dayjs(record.outAt).diff(dayjs(record.inAt)); 
                    }
                    
                    const minWorkMs = DEFAULT_MIN_HOURS * 3600000;
                    if (workMs > 0) {
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
            // ── ESSL-parity: Compute all missing fields ──
            
            // Check if this day is a holiday
            if (holidaySet.has(dayKey)) {
                holiday = true;
            }
            
            // Check if employee is on leave
            const empLeaves = leaveMap[emp.id] || [];
            for (const lv of empLeaves) {
                if (lv.startStr <= dayKey && lv.endStr >= dayKey) {
                    isOnLeave = true;
                    leaveTypeStr = lv.leaveType.name || '';
                    leaveDuration = lv.days || 1.0;
                    break;
                }
            }
            
            // Mark WO flag if shift says isOff
            if (dayRec && dayRec.isOff) {
                weeklyOff = true;
            }
            
            // Compute shift duration & InDuration/OutDuration
            if (empShift && dayRec && !dayRec.isOff) {
                const empStartMins = timeToMinutes(dayRec.startTime);
                const empEndMins = timeToMinutes(dayRec.endTime);
                if (empStartMins !== null && empEndMins !== null) {
                    let shiftDurMins = empEndMins - empStartMins;
                    if (shiftDurMins < 0) shiftDurMins += 24 * 60; // overnight
                    shiftDurationMs = shiftDurMins * 60000;
                    
                    // InDuration = time from shift start to actual IN
                    if (inTime && empStartMins !== null) {
                        const inMins = timeToMinutes(inTime);
                        if (inMins !== null && inMins > empStartMins) {
                            inDurationMs = (inMins - empStartMins) * 60000;
                        }
                    }
                    
                    // OutDuration = time from actual OUT to shift end
                    if (outTime && empEndMins !== null) {
                        const outMins = timeToMinutes(outTime);
                        if (outMins !== null && outMins < empEndMins) {
                            outDurationMs = (empEndMins - outMins) * 60000;
                        }
                    }
                }
            }
            
            // Compute weeklyOffPresent (worked on WO day)
            if (weeklyOff && record && (record.inAt || record.outAt)) {
                weeklyOffPresent = 1;
            }
            
            // Compute holidayPresent (worked on holiday)
            if (holiday && record && (record.inAt || record.outAt)) {
                holidayPresent = 1;
            }
            
            // Compute punchCount, lastPunch, direction, and inDevice/outDevice from punches array
            const punchesArr = (record && record.punches) ? (record.punches || []) : [];
            punchCount = punchesArr.length;
            if (punchesArr.length > 0) {
                // Sort punches by time
                const sortedPunches = punchesArr.sort((a, b) => dayjs(a.time).valueOf() - dayjs(b.time).valueOf());
                // First punch = IN device, last punch = OUT device (in ESSL terms)
                if (sortedPunches[0] && sortedPunches[0].type && sortedPunches[0].type.toLowerCase().includes('in')) {
                    inDevice = sortedPunches[0].device_sn || '';
                }
                if (sortedPunches[sortedPunches.length - 1]) {
                    const lastP = sortedPunches[sortedPunches.length - 1];
                    lastPunch = dayjs.tz(lastP.time, TZ).format('HH:mm');
                    direction = lastP.type && lastP.type.toLowerCase().includes('in') ? 'in' : 'out';
                    if (lastP.type && lastP.type.toLowerCase().includes('out')) {
                        outDevice = lastP.device_sn || '';
                    }
                }
            }
            if (!direction && missedOut) {
                direction = 'in';
            }
            
            // Compute Present/Absent/DayStatus/StatusCode
            if (status === 'P') {
                dayStatus = 'P';
                presentNum = 1.0;
                absentNum = 0;
                statusCode = 1;
            } else if (status === 'PH') {
                dayStatus = 'PH';
                presentNum = 0.5;
                absentNum = 0;
                statusCode = 2;
            } else if (status === 'A') {
                dayStatus = 'A';
                presentNum = 0;
                absentNum = 1.0;
                statusCode = 0;
            } else if (status === 'WO') {
                dayStatus = 'WO';
                presentNum = 0;
                absentNum = 0;
                statusCode = 3;
            }
            
            // Override for leave/holiday (ESSL: leave/holiday take precedence)
            if (isOnLeave) {
                if (workMs > 0) {
                    dayStatus = 'W'; // worked while on leave
                    presentNum = 1.0;
                } else {
                    dayStatus = 'L';
                    presentNum = 0;
                }
                statusCode = 5;
                absentNum = 0;
            } else if (holiday) {
                if (workMs > 0) {
                    dayStatus = 'H-P'; // worked on holiday
                } else {
                    dayStatus = 'H';
                }
                statusCode = 4;
                presentNum = 0;
                absentNum = 0;
            }
            // WO already counted
            
            // If worked on WO with status WO, change to P
            if (weeklyOffPresent && status === 'WO') {
                status = 'P';
                dayStatus = 'WO-P';
                presentNum = 1.0;
            }


            // Stats: ESSL-parity
            if (dayStatus === 'P' || dayStatus === 'PH' || dayStatus === 'WO-P' || dayStatus === 'H-P') rowData.stats.present += presentNum;
            else if (dayStatus === 'A') rowData.stats.absent++;
            else if (dayStatus === 'WO') rowData.stats.wo++;
            else if (dayStatus === 'L') rowData.stats.leave++;
            else if (dayStatus === 'H' || dayStatus.startsWith('H')) rowData.stats.hld++; // worked or not on holiday
            rowData.stats.totalOtMs += otMs;
            rowData.stats.totalWorkMs += workMs; // was missing → Work Hours Summary always 00:00
            rowData.stats.totalLossOfHoursMs = (rowData.stats.totalLossOfHoursMs || 0) + lossOfHoursMs;
            rowData.stats.totalLateMs += lateMs;

            rowData.days[dayKey] = {
                date: dayKey,
                dayLabel: currentDay.date(),
                
                // Core fields (existing)
                in: inTime, out: outTime,
                workHrs: formatDuration(workMs), // per-day work hours (frontend reads day.workHrs)
                shift: shiftName,
                shiftStart: dayRec?.startTime || '',
                shiftEnd: dayRec?.endTime || '',
                isOvernight: isOvernightShift(dayRec),
                status, late, early, ot, lossOfHours: formatDuration(lossOfHoursMs), missedOut,
                lunch: formatDuration(lunchMs),
                shiftLunchDuration: empShift?.lunchDuration || 1.0,
                lunchOut: outTimeLunch,
                lunchIn: inTimeLunch,
                
                // ESSL-parity fields
                InDuration: formatDuration(inDurationMs),
                OutDuration: formatDuration(outDurationMs),
                ShiftDuration: formatDuration(shiftDurationMs),
                Holiday: holiday ? 1 : 0,
                WeeklyOff: weeklyOff ? 1 : 0,
                IsOnLeave: isOnLeave,
                LeaveType: leaveTypeStr,
                LeaveDuration: leaveDuration,
                DayStatus: dayStatus,
                Present: presentNum,
                Absent: absentNum,
                StatusCode: statusCode,
                InDevice: inDevice,
                OutDevice: outDevice,
                LastPunch: lastPunch,
                Direction: direction,
                WeeklyOffPresent: weeklyOffPresent,
                HolidayPresent: holidayPresent,
                PunchCount: punchCount,
                shiftPolicy: empShift ? {
                    isFlexible: empShift.isFlexible,
                    markAbsentForLate: empShift.markAbsentForLate,
                    continuousLateDays: empShift.continuousLateDays,
                    absentDayType: empShift.absentDayType
                } : null
            };
        }
        // ── ESSL-equivalent: Continuous Late → Absent ──
        let consecutiveLates = 0;
        const sortedDays = Object.keys(rowData.days).sort();
        for (const dk of sortedDays) {
            const d = rowData.days[dk];
            const policy = d.shiftPolicy;

            if (!policy || policy.isFlexible || !policy.markAbsentForLate) {
                if (d.status !== 'WO' && d.status !== 'L') consecutiveLates = 0;
                delete d.shiftPolicy;
                continue;
            }

            const continuousLateDays2 = policy.continuousLateDays || 3;
            const absentDayType2 = policy.absentDayType || 'full_day';
            if (d.status === 'P' && d.late && d.late !== '00:00') {
                consecutiveLates++;
                if (continuousLateDays2 > 0 && consecutiveLates >= continuousLateDays2) {
                    d.status = absentDayType2 === 'half_day' ? 'PH' : 'A';
                    d.DayStatus = d.status;
                    if (d.status === 'A') {
                        rowData.stats.present -= 1;
                        rowData.stats.absent += 1;
                        d.Present = 0;
                        d.Absent = 1;
                        d.StatusCode = 0;
                    } else {
                        if (d.Present === 1) rowData.stats.present -= 0.5;
                        d.Present = 0.5;
                        d.Absent = 0;
                        d.StatusCode = 2;
                    }
                }
            } else if (d.status !== 'WO' && d.status !== 'L') {
                consecutiveLates = 0;
            }
            delete d.shiftPolicy;
        }

        rowData.stats.totalWorkHrs = formatDuration(rowData.stats.totalWorkMs);
        rowData.stats.totalOtHrs = formatDuration(rowData.stats.totalOtMs);
        rowData.stats.totalLateHrs = formatDuration(rowData.stats.totalLateMs);
        rowData.stats.totalLossOfHoursHrs = formatDuration(rowData.stats.totalLossOfHoursMs || 0);
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
        const m = month ? parseInt(month) : time.now().month() + 1;
        const y = year ? parseInt(year) : time.now().year();

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

        const start = startDate ? time.utcDate(startDate) : time.utcDate(time.now().startOf('month').format('YYYY-MM-DD'));
        const end = endDate ? time.utcDate(endDate) : time.utcDate(time.now().endOf('month').format('YYYY-MM-DD'));

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
                reviewedAt: r.reviewedAt ? time.tz(r.reviewedAt).format('YYYY-MM-DD HH:mm') : '-',
                remarks: r.remarks || '-',
                photoUrl: r.meta?.in?.photo_url || r.meta?.photo_url || null,
                location: lat ? `${lat}, ${lng}` : '-'
            };
        });

        res.json(formatted);

    } catch (error) { next(error); }
});

module.exports = router;
