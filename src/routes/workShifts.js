const router = require('express').Router();
const prisma = require('../lib/prisma');
const { requireRole } = require('../middleware/auth');
const time = require('../lib/time');

// GET /api/work-shifts
router.get('/', async (req, res, next) => {
    try {
        const shifts = await prisma.workShift.findMany({
            where: { tenantId: req.tenantId },
            orderBy: { name: 'asc' },
            include: {
                _count: { select: { employeeWorkShifts: true } }
            }
        });
        res.json(shifts);
    } catch (error) { next(error); }
});

// POST /api/work-shifts
router.post('/', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const { name, records, isFlexible, minHours, lunchDuration, lunchThreshold,
            halfDayMins, absentDayMins, halfDayLateMins, halfDayEarlyMins, earlyGraceMins,
            otFormula, maxOtHours, markAbsentForLate, continuousLateDays, absentDayType,
            break1Enabled, break1Start, break1End, break2Enabled, break2Start, break2End } = req.body;
        const shift = await prisma.workShift.create({
            data: { 
                tenantId: req.tenantId, 
                name, 
                records: records || [],
                isFlexible: !!isFlexible,
                minHours: parseFloat(minHours) || 0,
                lunchDuration: parseFloat(lunchDuration) || 0,
                lunchThreshold: parseFloat(lunchThreshold) || 0,
                halfDayMins: parseInt(halfDayMins) || 240,
                absentDayMins: parseInt(absentDayMins) || 60,
                halfDayLateMins: parseInt(halfDayLateMins) || 30,
                halfDayEarlyMins: parseInt(halfDayEarlyMins) || 30,
                earlyGraceMins: parseInt(earlyGraceMins) || 0,
                otFormula: otFormula || 'total_duration_minus_shift',
                maxOtHours: parseFloat(maxOtHours) || 0,
                markAbsentForLate: !!markAbsentForLate,
                continuousLateDays: parseInt(continuousLateDays) || 3,
                absentDayType: absentDayType || 'full_day',
                break1Enabled: !!break1Enabled,
                break1Start: break1Start || '13:00',
                break1End: break1End || '13:30',
                break2Enabled: !!break2Enabled,
                break2Start: break2Start || '17:00',
                break2End: break2End || '17:30',
            },
        });
        res.status(201).json(shift);
    } catch (error) { next(error); }
});

// PUT /api/work-shifts/:uuid
router.put('/:uuid', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const { name, records, status, isFlexible, minHours, lunchDuration, lunchThreshold,
            halfDayMins, absentDayMins, halfDayLateMins, halfDayEarlyMins, earlyGraceMins,
            otFormula, maxOtHours, markAbsentForLate, continuousLateDays, absentDayType,
            break1Enabled, break1Start, break1End, break2Enabled, break2Start, break2End } = req.body;
        const data = { name, records, status };
        if (isFlexible !== undefined) data.isFlexible = !!isFlexible;
        if (minHours !== undefined) data.minHours = parseFloat(minHours);
        if (lunchDuration !== undefined) data.lunchDuration = parseFloat(lunchDuration);
        if (lunchThreshold !== undefined) data.lunchThreshold = parseFloat(lunchThreshold);
        if (halfDayMins !== undefined) data.halfDayMins = parseInt(halfDayMins);
        if (absentDayMins !== undefined) data.absentDayMins = parseInt(absentDayMins);
        if (halfDayLateMins !== undefined) data.halfDayLateMins = parseInt(halfDayLateMins);
        if (halfDayEarlyMins !== undefined) data.halfDayEarlyMins = parseInt(halfDayEarlyMins);
        if (earlyGraceMins !== undefined) data.earlyGraceMins = parseInt(earlyGraceMins);
        if (otFormula !== undefined) data.otFormula = otFormula;
        if (maxOtHours !== undefined) data.maxOtHours = parseFloat(maxOtHours);
        if (markAbsentForLate !== undefined) data.markAbsentForLate = !!markAbsentForLate;
        if (continuousLateDays !== undefined) data.continuousLateDays = parseInt(continuousLateDays);
        if (absentDayType !== undefined) data.absentDayType = absentDayType;
        if (break1Enabled !== undefined) data.break1Enabled = !!break1Enabled;
        if (break1Start !== undefined) data.break1Start = break1Start;
        if (break1End !== undefined) data.break1End = break1End;
        if (break2Enabled !== undefined) data.break2Enabled = !!break2Enabled;
        if (break2Start !== undefined) data.break2Start = break2Start;
        if (break2End !== undefined) data.break2End = break2End;
        const shift = await prisma.workShift.update({
            where: { uuid: req.params.uuid },
            data,
        });
        res.json(shift);
    } catch (error) { next(error); }
});

// GET /api/work-shifts/:uuid/assignments - List employees assigned to this shift
router.get('/:uuid/assignments', async (req, res, next) => {
    try {
        const shift = await prisma.workShift.findUnique({ where: { uuid: req.params.uuid } });
        if (!shift || shift.tenantId !== req.tenantId) {
            return res.status(404).json({ error: 'Work shift not found' });
        }

        const assignments = await prisma.employeeWorkShift.findMany({
            where: { workShiftId: shift.id },
            include: {
                employee: {
                    include: { contact: true }
                }
            },
            orderBy: { startDate: 'desc' }
        });

        const formatted = assignments.map(a => ({
            id: a.id,
            employeeId: a.employeeId,
            employeeName: `${a.employee.contact.firstName} ${a.employee.contact.lastName || ''}`.trim(),
            employeeCode: a.employee.employeeCode,
            startDate: a.startDate.toISOString(),
            endDate: a.endDate.toISOString(),
        }));

        res.json(formatted);
    } catch (error) { next(error); }
});

// POST /api/work-shifts/:uuid/assign - Assign employees to shift
router.post('/:uuid/assign', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const shift = await prisma.workShift.findUnique({ where: { uuid: req.params.uuid } });
        if (!shift || shift.tenantId !== req.tenantId) {
            return res.status(404).json({ error: 'Work shift not found' });
        }

        const { employeeIds, startDate, endDate } = req.body;

        const assignments = await Promise.all(
            employeeIds.map(empId =>
                prisma.employeeWorkShift.create({
                    data: {
                        employeeId: parseInt(empId),
                        workShiftId: shift.id,
                        // @db.Date columns: IST calendar day at UTC midnight.
                        startDate: time.utcDate(startDate),
                        endDate: time.utcDate(endDate),
                    },
                })
            )
        );

        res.json({ message: `Assigned ${assignments.length} employees`, assignments });
    } catch (error) { next(error); }
});

// DELETE /api/work-shifts/assignments/:id - Remove a specific assignment
router.delete('/assignments/:id', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        await prisma.employeeWorkShift.delete({ where: { id: parseInt(req.params.id) } });
        res.json({ message: 'Assignment removed' });
    } catch (error) { next(error); }
});

// DELETE /api/work-shifts/:uuid
router.delete('/:uuid', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        await prisma.workShift.delete({ where: { uuid: req.params.uuid } });
        res.json({ message: 'Work shift deleted' });
    } catch (error) { next(error); }
});

module.exports = router;
