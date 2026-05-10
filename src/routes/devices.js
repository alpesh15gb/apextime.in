const router = require('express').Router();
const prisma = require('../lib/prisma');
const { requireRole } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// GET /api/devices
router.get('/', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const devices = await prisma.device.findMany({
            where: { tenantId: req.tenantId },
            include: { _count: { select: { logs: true } } },
            orderBy: { name: 'asc' },
        });
        res.json(devices);
    } catch (error) { next(error); }
});

// POST /api/devices
router.post('/', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const { name, serialNumber, ipAddress, type, config } = req.body;
        const device = await prisma.device.create({
            data: {
                tenantId: req.tenantId,
                name,
                serialNumber,
                ipAddress,
                type: type || 'biometric',
                token: uuidv4(), // Auto-generate token
                config: config || {},
            },
        });
        res.status(201).json(device);
    } catch (error) { next(error); }
});

// PUT /api/devices/:uuid
router.put('/:uuid', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const { name, serialNumber, ipAddress, type, status, config } = req.body;
        const device = await prisma.device.update({
            where: { uuid: req.params.uuid },
            data: { name, serialNumber, ipAddress, type, status, config },
        });
        res.json(device);
    } catch (error) { next(error); }
});

// POST /api/devices/:uuid/regenerate-token
router.post('/:uuid/regenerate-token', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const device = await prisma.device.update({
            where: { uuid: req.params.uuid },
            data: { token: uuidv4() },
        });
        res.json({ token: device.token });
    } catch (error) { next(error); }
});

// GET /api/devices/:uuid/logs
router.get('/:uuid/logs', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const device = await prisma.device.findUnique({ where: { uuid: req.params.uuid } });
        if (!device || device.tenantId !== req.tenantId) {
            return res.status(404).json({ error: 'Device not found' });
        }

        const { page = 1, limit = 100 } = req.query;
        const [logs, total] = await Promise.all([
            prisma.deviceLog.findMany({
                where: { deviceId: device.id },
                orderBy: { createdAt: 'desc' },
                skip: (parseInt(page) - 1) * parseInt(limit),
                take: parseInt(limit),
            }),
            prisma.deviceLog.count({ where: { deviceId: device.id } }),
        ]);

        res.json({ data: logs, pagination: { total, page: parseInt(page), limit: parseInt(limit) } });
    } catch (error) { next(error); }
});

// POST /api/devices/:uuid/sync
router.post('/:uuid/sync', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const device = await prisma.device.findUnique({ where: { uuid: req.params.uuid } });
        if (!device || device.tenantId !== req.tenantId) {
            return res.status(404).json({ error: 'Device not found' });
        }

        // Queue command to fetch all logs
        await prisma.deviceCommand.create({
            data: {
                deviceId: device.id,
                command: "DATA QUERY ATTLOG StartTime=2000-01-01 00:00:00\tEndTime=2099-12-31 23:59:59",
                status: 'pending',
            },
        });

        res.json({ message: 'Sync command queued' });
    } catch (error) { next(error); }
});

// POST /api/devices/:uuid/reboot
router.post('/:uuid/reboot', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const device = await prisma.device.findUnique({ where: { uuid: req.params.uuid } });
        if (!device || device.tenantId !== req.tenantId) return res.status(404).json({ error: 'Device not found' });

        await prisma.deviceCommand.create({
            data: { deviceId: device.id, command: 'REBOOT', status: 'pending' },
        });
        res.json({ message: 'Reboot command queued' });
    } catch (error) { next(error); }
});

// POST /api/devices/:uuid/clear-admin
router.post('/:uuid/clear-admin', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const device = await prisma.device.findUnique({ where: { uuid: req.params.uuid } });
        if (!device || device.tenantId !== req.tenantId) return res.status(404).json({ error: 'Device not found' });

        await prisma.deviceCommand.create({
            data: { deviceId: device.id, command: 'CLEAR ADMIN', status: 'pending' },
        });
        res.json({ message: 'Clear admin command queued' });
    } catch (error) { next(error); }
});

// POST /api/devices/:uuid/set-time
router.post('/:uuid/set-time', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const device = await prisma.device.findUnique({ where: { uuid: req.params.uuid } });
        if (!device || device.tenantId !== req.tenantId) return res.status(404).json({ error: 'Device not found' });

        const now = require('dayjs')().format('YYYY-MM-DD HH:mm:ss');
        await prisma.deviceCommand.create({
            data: { deviceId: device.id, command: `SET TIME ${now}`, status: 'pending' },
        });
        res.json({ message: 'Time sync command queued' });
    } catch (error) { next(error); }
});

// POST /api/devices/sync-user-all/:employeeUuid
router.post('/sync-user-all/:employeeUuid', requireRole('admin', 'super_admin'), async (req, res, next) => {
    try {
        const employee = await prisma.employee.findUnique({
            where: { uuid: req.params.employeeUuid },
            include: { contact: true }
        });
        if (!employee || employee.tenantId !== req.tenantId) return res.status(404).json({ error: 'Employee not found' });

        const devices = await prisma.device.findMany({
            where: { tenantId: req.tenantId, status: 'active' }
        });

        const name = (employee.contact.firstName + ' ' + (employee.contact.lastName || '')).trim();
        const command = `DATA UPDATE USERINFO PIN=${employee.employeeCode}\tName=${name}\tPri=0\tPass=\tGrp=1\tTag=0`;

        const commandPromises = devices.map(d =>
            prisma.deviceCommand.create({
                data: { deviceId: d.id, command, status: 'pending' },
            })
        );

        await Promise.all(commandPromises);
        res.json({ message: `User sync command queued for ${devices.length} devices` });
    } catch (error) { next(error); }
});

// DELETE /api/devices/:uuid
    try {
        const device = await prisma.device.findUnique({ where: { uuid: req.params.uuid } });
        if (!device || device.tenantId !== req.tenantId) {
            return res.status(404).json({ error: 'Device not found' });
        }
        await prisma.device.delete({ where: { id: device.id } });
        res.json({ message: 'Device deleted' });
    } catch (error) { next(error); }
});

module.exports = router;
