const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../lib/prisma');
const { requireRole } = require('../middleware/auth');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Kolkata';

// Multer config for selfie uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '../../uploads/punches'));
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `punch_${uuidv4()}${ext}`);
    },
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only image files allowed'));
    },
});

// GET /api/attendance/timesheets - List timesheets with filters
router.get('/timesheets', async (req, res, next) => {
    try {
        const { employeeId, date, startDate, endDate, status, source, page = 1, limit = 50 } = req.query;
        const where = { tenantId: req.tenantId };

        if (employeeId) where.employeeId = parseInt(employeeId);
        if (status) where.status = status;
        if (source) where.source = source;
        if (date) where.date = new Date(date);
        if (startDate && endDate) {
            where.date = { gte: new Date(startDate), lte: new Date(endDate) };
        }

        const [timesheets, total] = await Promise.all([
            prisma.timesheet.findMany({
                where,
                include: {
                    employee: { include: { contact: true, department: true } },
                    reviewer: { select: { username: true } },
                },
                orderBy: [{ date: 'desc' }, { inAt: 'desc' }],
                skip: (parseInt(page) - 1) * parseInt(limit),
                take: parseInt(limit),
            }),
            prisma.timesheet.count({ where }),
        ]);

        res.json({
            data: timesheets.map(t => ({
                id: t.id,
                uuid: t.uuid,
                employeeId: t.employeeId,
                employeeCode: t.employee.employeeCode,
                employeeName: `${t.employee.contact.firstName} ${t.employee.contact.lastName || ''}`.trim(),
                department: t.employee.department?.name,
                photo: t.employee.contact.photo,
                date: t.date,
                inAt: t.inAt,
                outAt: t.outAt,
                source: t.source,
                status: t.status,
                reviewedBy: t.reviewer?.username,
                reviewedAt: t.reviewedAt,
                remarks: t.remarks,
                meta: t.meta,
            })),
            pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) },
        });
    } catch (error) { next(error); }
});

// GET /api/attendance/pending - Pending mobile punch approvals
router.get('/pending', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const timesheets = await prisma.timesheet.findMany({
            where: { tenantId: req.tenantId, status: 'pending' },
            include: {
                employee: { include: { contact: true, department: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        res.json(timesheets.map(t => ({
            id: t.id,
            uuid: t.uuid,
            employeeCode: t.employee.employeeCode,
            employeeName: `${t.employee.contact.firstName} ${t.employee.contact.lastName || ''}`.trim(),
            department: t.employee.department?.name,
            date: t.date,
            inAt: t.inAt,
            outAt: t.outAt,
            source: t.source,
            photoUrl: t.meta?.in?.photo_url || t.meta?.photo_url,
            latitude: t.meta?.in?.latitude || t.meta?.latitude,
            longitude: t.meta?.in?.longitude || t.meta?.longitude,
            outPhotoUrl: t.meta?.out?.photo_url,
            outLatitude: t.meta?.out?.latitude,
            outLongitude: t.meta?.out?.longitude,
            createdAt: t.createdAt,
        })));
    } catch (error) { next(error); }
});

// POST /api/attendance/punch - Mobile punch (with selfie + GPS)
router.post('/punch', upload.single('photo'), async (req, res, next) => {
    try {
        const { latitude, longitude } = req.body;

        if (!req.user.employee) {
            return res.status(400).json({ error: 'No employee profile linked to this user' });
        }

        const employee = req.user.employee;
        const now = dayjs().tz(TZ);
        const todayStr = now.format('YYYY-MM-DD');
        const photoUrl = req.file ? `/uploads/punches/${req.file.filename}` : null;

        // Find existing open timesheet for today
        const existingTimesheet = await prisma.timesheet.findFirst({
            where: {
                employeeId: employee.id,
                date: dayjs.utc(todayStr).startOf('day').toDate(),
                outAt: null,
                source: 'mobile',
            },
            orderBy: { inAt: 'desc' },
        });

        let timesheet;

        if (existingTimesheet) {
            // Clock OUT
            const inAt = dayjs(existingTimesheet.inAt);
            if (now.diff(inAt, 'minute') < 2) {
                return res.status(400).json({ error: 'Minimum 2 minutes between clock in and out' });
            }

            timesheet = await prisma.timesheet.update({
                where: { id: existingTimesheet.id },
                data: {
                    outAt: now.toDate(),
                    meta: {
                        ...existingTimesheet.meta,
                        out: { photo_url: photoUrl, latitude: parseFloat(latitude), longitude: parseFloat(longitude), ip: req.ip },
                    },
                },
            });
        } else {
            // Clock IN
            timesheet = await prisma.timesheet.create({
                data: {
                    tenantId: req.tenantId,
                    employeeId: employee.id,
                    date: dayjs.utc(todayStr).startOf('day').toDate(),
                    inAt: now.toDate(),
                    source: 'mobile',
                    status: 'pending', // Needs admin approval
                    meta: {
                        in: { photo_url: photoUrl, latitude: parseFloat(latitude), longitude: parseFloat(longitude), ip: req.ip },
                    },
                },
            });
        }

        res.json({
            message: existingTimesheet ? 'Clocked out successfully' : 'Clocked in successfully - pending approval',
            type: existingTimesheet ? 'clock_out' : 'clock_in',
            timesheet: {
                id: timesheet.id,
                date: timesheet.date,
                inAt: timesheet.inAt,
                outAt: timesheet.outAt,
                status: timesheet.status,
            },
        });
    } catch (error) { next(error); }
});

// POST /api/attendance/:uuid/approve
router.post('/:uuid/approve', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const timesheet = await prisma.timesheet.findUnique({ where: { uuid: req.params.uuid } });
        if (!timesheet || timesheet.tenantId !== req.tenantId) {
            return res.status(404).json({ error: 'Timesheet not found' });
        }

        const updated = await prisma.timesheet.update({
            where: { id: timesheet.id },
            data: {
                status: 'approved',
                reviewedBy: req.userId,
                reviewedAt: new Date(),
                remarks: req.body.remarks,
            },
        });

        res.json({ message: 'Attendance approved', timesheet: updated });
    } catch (error) { next(error); }
});

// POST /api/attendance/:uuid/reject
router.post('/:uuid/reject', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const timesheet = await prisma.timesheet.findUnique({ where: { uuid: req.params.uuid } });
        if (!timesheet || timesheet.tenantId !== req.tenantId) {
            return res.status(404).json({ error: 'Timesheet not found' });
        }

        const updated = await prisma.timesheet.update({
            where: { id: timesheet.id },
            data: {
                status: 'rejected',
                reviewedBy: req.userId,
                reviewedAt: new Date(),
                remarks: req.body.remarks || 'Rejected by admin',
                meta: { ...timesheet.meta, rejection_reason: req.body.reason },
            },
        });

        res.json({ message: 'Attendance rejected', timesheet: updated });
    } catch (error) { next(error); }
});

// GET /api/attendance/report - Daily attendance report
router.get('/report', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const date = req.query.date || dayjs().tz(TZ).format('YYYY-MM-DD');

        const employees = await prisma.employee.findMany({
            where: { tenantId: req.tenantId, status: 'active' },
            include: { contact: true, department: true },
            orderBy: { employeeCode: 'asc' },
        });

        const timesheets = await prisma.timesheet.findMany({
            where: {
                tenantId: req.tenantId,
                date: dayjs.utc(date).startOf('day').toDate(),
                status: { in: ['auto_approved', 'approved'] },
            },
        });

        const timesheetMap = {};
        timesheets.forEach(t => {
            if (!timesheetMap[t.employeeId]) timesheetMap[t.employeeId] = [];
            timesheetMap[t.employeeId].push(t);
        });

        const report = employees.map(emp => {
            const empTimesheets = timesheetMap[emp.id] || [];
            const firstIn = empTimesheets.length ? empTimesheets.reduce((min, t) => !min || t.inAt < min ? t.inAt : min, null) : null;
            const lastOut = empTimesheets.length ? empTimesheets.reduce((max, t) => !max || (t.outAt && t.outAt > max) ? t.outAt : max, null) : null;

            return {
                employeeCode: emp.employeeCode,
                name: `${emp.contact.firstName} ${emp.contact.lastName || ''}`.trim(),
                department: emp.department?.name,
                status: empTimesheets.length > 0 ? 'present' : 'absent',
                firstIn, lastOut,
                punches: empTimesheets.length,
                sources: [...new Set(empTimesheets.map(t => t.source))],
            };
        });

        res.json({
            date,
            summary: {
                total: employees.length,
                present: report.filter(r => r.status === 'present').length,
                absent: report.filter(r => r.status === 'absent').length,
            },
            data: report,
        });
    } catch (error) { next(error); }
});

// POST /api/attendance/manual - Manual entry by admin
router.post('/manual', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const { employeeId, date, inAt, outAt, remarks } = req.body;

        const employee = await prisma.employee.findFirst({
            where: { id: parseInt(employeeId), tenantId: req.tenantId },
        });
        if (!employee) return res.status(404).json({ error: 'Employee not found' });

        const timesheet = await prisma.timesheet.create({
            data: {
                tenantId: req.tenantId,
                employeeId: employee.id,
                date: dayjs.utc(date).startOf('day').toDate(),
                inAt: inAt ? dayjs.tz(inAt, TZ).toDate() : null,
                outAt: outAt ? dayjs.tz(outAt, TZ).toDate() : null,
                source: 'manual',
                status: 'auto_approved',
                reviewedBy: req.userId,
                reviewedAt: new Date(),
                remarks,
            },
        });

        res.status(201).json(timesheet);
    } catch (error) { next(error); }
});

module.exports = router;
