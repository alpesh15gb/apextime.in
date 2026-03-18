const router = require('express').Router();
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { requireRole } = require('../middleware/auth');

// GET /api/tenants - Super admin only
router.get('/', requireRole('super_admin'), async (req, res, next) => {
    try {
        const tenants = await prisma.tenant.findMany({
            include: {
                _count: { select: { users: true, employees: true } },
            },
            orderBy: { name: 'asc' },
        });
        res.json(tenants);
    } catch (error) { next(error); }
});

// POST /api/tenants - Create new tenant with admin user
router.post('/', requireRole('super_admin'), async (req, res, next) => {
    try {
        const { name, slug, domain, adminUsername, adminPassword, subscriptionDays } = req.body;

        if (!name || !slug) {
            return res.status(400).json({ error: 'Name and slug are required' });
        }

        const subscriptionExpiry = subscriptionDays ? new Date(Date.now() + parseInt(subscriptionDays) * 24 * 60 * 60 * 1000) : null;

        const result = await prisma.$transaction(async (tx) => {
            const tenant = await tx.tenant.create({
                data: { 
                    name, 
                    slug: slug.toLowerCase(), 
                    domain,
                    subscriptionExpiry
                },
            });

            // Create admin user
            const passwordHash = await bcrypt.hash(adminPassword || 'admin123', 10);
            await tx.user.create({
                data: {
                    tenantId: tenant.id,
                    username: adminUsername || 'admin',
                    passwordHash,
                    role: 'admin',
                },
            });

            // Seed default attendance types
            await tx.attendanceType.createMany({
                data: [
                    { tenantId: tenant.id, name: 'Present', code: 'P', category: 'present', color: '#22c55e' },
                    { tenantId: tenant.id, name: 'Absent', code: 'A', category: 'absent', color: '#ef4444' },
                    { tenantId: tenant.id, name: 'Half Day', code: 'HD', category: 'half_day', color: '#f59e0b' },
                    { tenantId: tenant.id, name: 'Late', code: 'L', category: 'late', color: '#f97316' },
                    { tenantId: tenant.id, name: 'On Leave', code: 'OL', category: 'on_leave', color: '#8b5cf6' },
                ],
            });

            // Seed default leave types
            await tx.leaveType.createMany({
                data: [
                    { tenantId: tenant.id, name: 'Casual Leave', code: 'CL', maxDays: 12, isPaid: true, color: '#3b82f6' },
                    { tenantId: tenant.id, name: 'Sick Leave', code: 'SL', maxDays: 12, isPaid: true, color: '#ef4444' },
                    { tenantId: tenant.id, name: 'Earned Leave', code: 'EL', maxDays: 15, isPaid: true, color: '#22c55e' },
                    { tenantId: tenant.id, name: 'Loss of Pay', code: 'LOP', maxDays: null, isPaid: false, color: '#6b7280' },
                ],
            });

            return tenant;
        });

        res.status(201).json({ message: 'Tenant created', tenant: result });
    } catch (error) { next(error); }
});

// PUT /api/tenants/:uuid
router.put('/:uuid', requireRole('super_admin'), async (req, res, next) => {
    try {
        const { name, domain, status, config, logo, subscriptionDays, addDays } = req.body;
        
        let updateData = { name, domain, status, config, logo };
        
        if (subscriptionDays !== undefined) {
             // Reset: X days from today
             updateData.subscriptionExpiry = new Date(Date.now() + parseInt(subscriptionDays) * 24 * 60 * 60 * 1000);
        } else if (addDays !== undefined) {
            // Extend: Add X days to current balance
            const currentTenant = await prisma.tenant.findUnique({ where: { uuid: req.params.uuid } });
            const currentExpiry = currentTenant.subscriptionExpiry && new Date(currentTenant.subscriptionExpiry) > new Date() 
                ? new Date(currentTenant.subscriptionExpiry) 
                : new Date();
            
            updateData.subscriptionExpiry = new Date(currentExpiry.getTime() + parseInt(addDays) * 24 * 60 * 60 * 1000);
        }

        const tenant = await prisma.tenant.update({
            where: { uuid: req.params.uuid },
            data: updateData,
        });
        res.json(tenant);
    } catch (error) { next(error); }
});

// GET /api/tenants/:uuid/users - List users for a tenant
router.get('/:uuid/users', requireRole('super_admin'), async (req, res, next) => {
    try {
        const tenant = await prisma.tenant.findUnique({ where: { uuid: req.params.uuid } });
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        const users = await prisma.user.findMany({
            where: { tenantId: tenant.id },
            select: { id: true, username: true, role: true, status: true, lastLoginAt: true },
        });
        res.json(users);
    } catch (error) { next(error); }
});

// POST /api/tenants/:uuid/reset-password - Reset password for a user in tenant
router.post('/:uuid/reset-password', requireRole('super_admin'), async (req, res, next) => {
    try {
        const { username, newPassword } = req.body;
        const tenant = await prisma.tenant.findUnique({ where: { uuid: req.params.uuid } });

        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        const user = await prisma.user.findFirst({
            where: { tenantId: tenant.id, username },
        });

        if (!user) return res.status(404).json({ error: 'User not found in this organization' });

        const passwordHash = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id: user.id },
            data: { passwordHash },
        });

        res.json({ message: `Password for ${username} reset successfully` });
    } catch (error) { next(error); }
});

module.exports = router;
