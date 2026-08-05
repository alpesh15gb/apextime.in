const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../lib/prisma');
const dayjs = require('dayjs');
const time = require('../lib/time');

const fs = require('fs');

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../../uploads/punches');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer for selfie
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `punch_${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// GET /api/portal/dashboard
router.get('/dashboard', async (req, res, next) => {
    try {
        if (!req.user.employee) {
            return res.status(400).json({ error: 'No employee profile' });
        }

        const employee = req.user.employee;
        const today = time.utcDate(time.todayStr());

        // Today's timesheet
        const todayTimesheet = await prisma.timesheet.findFirst({
            where: { employeeId: employee.id, date: today },
            orderBy: { inAt: 'desc' },
        });

        // Pending leaves
        const pendingLeaves = await prisma.leaveRequest.count({
            where: { employeeId: employee.id, status: 'pending' },
        });

        // Leave balance
        const leaveBalance = await prisma.leaveAllocation.findMany({
            where: { employeeId: employee.id },
            include: { leaveType: true },
        });

        // Recent announcements
        const announcements = await prisma.announcement.findMany({
            where: {
                tenantId: req.tenantId,
                status: 'published',
                OR: [
                    { audienceType: 'all' },
                    { audienceType: 'employees' },
                ],
            },
            orderBy: { publishedAt: 'desc' },
            take: 5,
        });

        // This month stats (IST month boundaries)
        const monthStart = time.utcDate(time.now().startOf('month').format('YYYY-MM-DD'));
        const monthEnd = time.utcDate(time.now().endOf('month').format('YYYY-MM-DD'));
        const monthTimesheets = await prisma.timesheet.count({
            where: {
                employeeId: employee.id,
                date: { gte: monthStart, lte: monthEnd },
                status: { in: ['auto_approved', 'approved'] },
            },
        });

        res.json({
            employee: {
                name: `${employee.contact.firstName} ${employee.contact.lastName || ''}`.trim(),
                code: employee.employeeCode,
                department: employee.department?.name,
                designation: employee.designation?.name,
                photo: employee.contact.photo,
            },
            today: todayTimesheet ? {
                inAt: todayTimesheet.inAt,
                outAt: todayTimesheet.outAt,
                status: todayTimesheet.status,
                isClockedIn: todayTimesheet.inAt && !todayTimesheet.outAt,
            } : { isClockedIn: false },
            stats: {
                daysPresent: monthTimesheets,
                pendingLeaves,
                leaveBalance: leaveBalance.map(l => ({
                    type: l.leaveType.name,
                    balance: l.balance,
                    color: l.leaveType.color,
                })),
            },
            announcements: announcements.map(a => ({
                id: a.id,
                title: a.title,
                body: a.body,
                priority: a.priority,
                publishedAt: a.publishedAt,
            })),
        });
    } catch (error) { next(error); }
});

// POST /api/portal/punch - Mobile punch with selfie + GPS
router.post('/punch', upload.single('photo'), async (req, res, next) => {
    try {
        if (!req.user.employee) {
            return res.status(400).json({ error: 'No employee profile' });
        }

        const employee = req.user.employee;
        const { latitude, longitude } = req.body;
        const now = time.now(); // IST-aware — never server-timezone dependent
        const today = time.utcDate(now.format('YYYY-MM-DD'));
        const photoUrl = req.file ? `/uploads/punches/${req.file.filename}` : null;

        if (!photoUrl) {
            return res.status(400).json({ error: 'Selfie is mandatory for attendance punch' });
        }
        if (!latitude || !longitude || parseFloat(latitude) === 0) {
            return res.status(400).json({ error: 'GPS location is mandatory. Please enable location services.' });
        }

        // Check for open timesheet
        const openTimesheet = await prisma.timesheet.findFirst({
            where: { employeeId: employee.id, date: today, outAt: null, source: 'mobile' },
            orderBy: { inAt: 'desc' },
        });

        let timesheet;
        let type;

        if (openTimesheet) {
            // Clock OUT
            if (dayjs(openTimesheet.inAt).diff(now, 'minute') > -2) {
                return res.status(400).json({ error: 'Wait at least 2 minutes before clocking out' });
            }

            timesheet = await prisma.timesheet.update({
                where: { id: openTimesheet.id },
                data: {
                    outAt: now.toDate(),
                    meta: {
                        ...openTimesheet.meta,
                        out: { photo_url: photoUrl, latitude: parseFloat(latitude || 0), longitude: parseFloat(longitude || 0), ip: req.ip },
                    },
                },
            });
            type = 'clock_out';
        } else {
            // Clock IN
            timesheet = await prisma.timesheet.create({
                data: {
                    tenantId: req.tenantId,
                    employeeId: employee.id,
                    date: today,
                    inAt: now.toDate(),
                    source: 'mobile',
                    status: 'pending',
                    meta: {
                        in: { photo_url: photoUrl, latitude: parseFloat(latitude || 0), longitude: parseFloat(longitude || 0), ip: req.ip },
                    },
                },
            });
            type = 'clock_in';
        }

        res.json({
            message: type === 'clock_in' ? 'Clocked in - pending approval' : 'Clocked out successfully',
            type,
            timesheet: { id: timesheet.id, date: timesheet.date, inAt: timesheet.inAt, outAt: timesheet.outAt, status: timesheet.status },
        });
    } catch (error) { next(error); }
});

// GET /api/portal/my-attendance
router.get('/my-attendance', async (req, res, next) => {
    try {
        if (!req.user.employeeId) return res.json([]);

        const { month, year } = req.query;
        const m = parseInt(month || time.now().month() + 1);
        const y = parseInt(year || time.now().year());
        const startDate = time.utcDate(`${y}-${String(m).padStart(2, '0')}-01`);
        const endDate = time.utcDate(time.dayUTC(`${y}-${String(m).padStart(2, '0')}-01`).endOf('month').format('YYYY-MM-DD'));

        const timesheets = await prisma.timesheet.findMany({
            where: {
                employeeId: req.user.employeeId,
                date: { gte: startDate, lte: endDate },
            },
            orderBy: [{ date: 'asc' }, { inAt: 'asc' }],
        });

        res.json(timesheets.map(t => ({
            date: t.date,
            inAt: t.inAt,
            outAt: t.outAt,
            source: t.source,
            status: t.status,
        })));
    } catch (error) { next(error); }
});

// GET /api/portal/announcements
router.get('/announcements', async (req, res, next) => {
    try {
        const announcements = await prisma.announcement.findMany({
            where: {
                tenantId: req.tenantId,
                status: 'published',
                OR: [{ audienceType: 'all' }, { audienceType: 'employees' }],
            },
            orderBy: { publishedAt: 'desc' },
            take: 20,
        });
        res.json(announcements);
    } catch (error) { next(error); }
});

module.exports = router;
