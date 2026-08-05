const router = require('express').Router();
const prisma = require('../lib/prisma');
const { requireRole } = require('../middleware/auth');
const time = require('../lib/time');

// ── Leave Types ────────────────────────────
router.get('/types', async (req, res, next) => {
    try {
        const types = await prisma.leaveType.findMany({
            where: { tenantId: req.tenantId },
            orderBy: { position: 'asc' },
        });
        res.json(types);
    } catch (error) { next(error); }
});

router.post('/types', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const { name, code, maxDays, isPaid, color } = req.body;
        const type = await prisma.leaveType.create({
            data: { tenantId: req.tenantId, name, code, maxDays, isPaid, color },
        });
        res.status(201).json(type);
    } catch (error) { next(error); }
});

router.put('/types/:uuid', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const { name, code, maxDays, isPaid, color, status } = req.body;
        const type = await prisma.leaveType.update({
            where: { uuid: req.params.uuid },
            data: { name, code, maxDays, isPaid, color, status },
        });
        res.json(type);
    } catch (error) { next(error); }
});

// ── Leave Allocations ──────────────────────
router.get('/allocations', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const { employeeId, sessionId } = req.query;
        const where = { tenantId: req.tenantId };
        if (employeeId) where.employeeId = parseInt(employeeId);
        if (sessionId) where.holidayYearId = parseInt(sessionId);

        const allocations = await prisma.leaveAllocation.findMany({
            where,
            include: {
                employee: { include: { contact: true } },
                leaveType: true,
                holidayYear: true,
            },
        });
        res.json(allocations);
    } catch (error) { next(error); }
});

router.post('/allocate', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const { employeeId, leaveTypeId, holidayYearId, allocated } = req.body;
        const allocation = await prisma.leaveAllocation.upsert({
            where: {
                employeeId_leaveTypeId_holidayYearId: {
                    employeeId: parseInt(employeeId),
                    leaveTypeId: parseInt(leaveTypeId),
                    holidayYearId: parseInt(holidayYearId),
                },
            },
            create: {
                tenantId: req.tenantId,
                employeeId: parseInt(employeeId),
                leaveTypeId: parseInt(leaveTypeId),
                holidayYearId: parseInt(holidayYearId),
                allocated: parseFloat(allocated),
                balance: parseFloat(allocated),
            },
            update: {
                allocated: parseFloat(allocated),
                balance: { increment: parseFloat(allocated) - parseFloat(req.body.previousAllocated || allocated) },
            },
        });
        res.json(allocation);
    } catch (error) { next(error); }
});

// ── Leave Requests ─────────────────────────
router.get('/requests', async (req, res, next) => {
    try {
        const { status, employeeId, page = 1, limit = 50 } = req.query;
        const where = { tenantId: req.tenantId };

        // Non-admins can only see their own
        if (!['admin', 'super_admin'].includes(req.user.role)) {
            if (req.user.employeeId) where.employeeId = req.user.employeeId;
            else return res.json({ data: [], pagination: { total: 0 } });
        } else {
            if (employeeId) where.employeeId = parseInt(employeeId);
        }
        if (status) where.status = status;

        const [requests, total] = await Promise.all([
            prisma.leaveRequest.findMany({
                where,
                include: {
                    employee: { include: { contact: true, department: true } },
                    leaveType: true,
                    reviewer: { select: { username: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip: (parseInt(page) - 1) * parseInt(limit),
                take: parseInt(limit),
            }),
            prisma.leaveRequest.count({ where }),
        ]);

        res.json({
            data: requests.map(r => ({
                id: r.id,
                uuid: r.uuid,
                employeeCode: r.employee.employeeCode,
                employeeName: `${r.employee.contact.firstName} ${r.employee.contact.lastName || ''}`.trim(),
                department: r.employee.department?.name,
                leaveType: r.leaveType.name,
                leaveTypeCode: r.leaveType.code,
                startDate: r.startDate,
                endDate: r.endDate,
                days: r.days,
                reason: r.reason,
                status: r.status,
                reviewedBy: r.reviewer?.username,
                reviewedAt: r.reviewedAt,
                reviewRemarks: r.reviewRemarks,
                createdAt: r.createdAt,
            })),
            pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) },
        });
    } catch (error) { next(error); }
});

// POST /api/leave/apply
router.post('/apply', async (req, res, next) => {
    try {
        const { leaveTypeId, startDate, endDate, reason } = req.body;

        if (!req.user.employeeId) {
            return res.status(400).json({ error: 'No employee profile linked' });
        }

        // @db.Date columns: store the calendar day at UTC midnight (IST calendar day).
        const start = time.utcDate(startDate);
        const end = time.utcDate(endDate);
        const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

        // Check balance
        const allocation = await prisma.leaveAllocation.findFirst({
            where: {
                employeeId: req.user.employeeId,
                leaveTypeId: parseInt(leaveTypeId),
            },
        });

        if (allocation && allocation.balance < days) {
            return res.status(400).json({ error: `Insufficient leave balance. Available: ${allocation.balance} days` });
        }

        const request = await prisma.leaveRequest.create({
            data: {
                tenantId: req.tenantId,
                employeeId: req.user.employeeId,
                leaveTypeId: parseInt(leaveTypeId),
                startDate: start,
                endDate: end,
                days,
                reason,
                status: 'pending',
            },
            include: { leaveType: true },
        });

        res.status(201).json({ message: 'Leave request submitted', request });
    } catch (error) { next(error); }
});

// POST /api/leave/:uuid/approve
router.post('/:uuid/approve', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const request = await prisma.leaveRequest.findUnique({ where: { uuid: req.params.uuid } });
        if (!request || request.tenantId !== req.tenantId) {
            return res.status(404).json({ error: 'Leave request not found' });
        }

        const updated = await prisma.$transaction(async (tx) => {
            const result = await tx.leaveRequest.update({
                where: { id: request.id },
                data: {
                    status: 'approved',
                    reviewedBy: req.userId,
                    reviewedAt: new Date(),
                    reviewRemarks: req.body.remarks,
                },
            });

            // Deduct from balance
            await tx.leaveAllocation.updateMany({
                where: { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId },
                data: { used: { increment: request.days }, balance: { decrement: request.days } },
            });

            return result;
        });

        res.json({ message: 'Leave approved', request: updated });
    } catch (error) { next(error); }
});

// POST /api/leave/:uuid/reject
router.post('/:uuid/reject', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const request = await prisma.leaveRequest.findUnique({ where: { uuid: req.params.uuid } });
        if (!request || request.tenantId !== req.tenantId) {
            return res.status(404).json({ error: 'Leave request not found' });
        }

        const updated = await prisma.leaveRequest.update({
            where: { id: request.id },
            data: {
                status: 'rejected',
                reviewedBy: req.userId,
                reviewedAt: new Date(),
                reviewRemarks: req.body.remarks || 'Rejected',
            },
        });

        res.json({ message: 'Leave rejected', request: updated });
    } catch (error) { next(error); }
});

// GET /api/leave/my-balance
router.get('/my-balance', async (req, res, next) => {
    try {
        if (!req.user.employeeId) return res.json([]);

        const allocations = await prisma.leaveAllocation.findMany({
            where: { employeeId: req.user.employeeId },
            include: { leaveType: true },
        });

        res.json(allocations.map(a => ({
            leaveType: a.leaveType.name,
            code: a.leaveType.code,
            color: a.leaveType.color,
            allocated: a.allocated,
            used: a.used,
            balance: a.balance,
        })));
    } catch (error) { next(error); }
});

module.exports = router;
