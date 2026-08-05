const router = require('express').Router();
const prisma = require('../lib/prisma');
const time = require('../lib/time');

// GET /api/dashboard
router.get('/', async (req, res, next) => {
    try {
        // IST-aware "today" — must never depend on the server timezone.
        const today = time.utcDate(time.todayStr());

        const [
            totalEmployees,
            todayTimesheets,
            pendingApprovals,
            pendingLeaves,
            recentAnnouncements,
            activeDevices,
        ] = await Promise.all([
            prisma.employee.count({ where: { tenantId: req.tenantId, status: 'active' } }),
            prisma.timesheet.count({
                where: { tenantId: req.tenantId, date: today, status: { in: ['auto_approved', 'approved'] } },
            }),
            prisma.timesheet.count({ where: { tenantId: req.tenantId, status: 'pending' } }),
            prisma.leaveRequest.count({ where: { tenantId: req.tenantId, status: 'pending' } }),
            prisma.announcement.findMany({
                where: { tenantId: req.tenantId, status: 'published' },
                orderBy: { publishedAt: 'desc' },
                take: 5,
            }),
            prisma.device.count({ where: { tenantId: req.tenantId, status: 'active' } }),
        ]);

        res.json({
            stats: {
                totalEmployees,
                todayPresent: todayTimesheets,
                todayAbsent: totalEmployees - todayTimesheets,
                pendingApprovals,
                pendingLeaves,
                activeDevices,
            },
            recentAnnouncements,
        });
    } catch (error) { next(error); }
});

module.exports = router;
