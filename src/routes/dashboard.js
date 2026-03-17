const router = require('express').Router();
const prisma = require('../lib/prisma');
const dayjs = require('dayjs');

// GET /api/dashboard
router.get('/', async (req, res, next) => {
    try {
        const today = dayjs().format('YYYY-MM-DD');

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
                where: { tenantId: req.tenantId, date: new Date(today), status: { in: ['auto_approved', 'approved'] } },
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
