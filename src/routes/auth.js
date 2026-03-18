const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { JWT_SECRET } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
    try {
        const { username, password, slug } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        const whereClause = { username };

        // Resolve tenant from slug if provided
        let tenantId = req.tenantId;
        if (slug) {
            const tenant = await prisma.tenant.findUnique({ where: { slug } });
            if (!tenant) {
                return res.status(404).json({ error: 'Organization ID not found' });
            }
            if (tenant.status !== 'active') {
                return res.status(403).json({ error: 'Organization is inactive' });
            }
            tenantId = tenant.id;
        }

        if (tenantId) {
            whereClause.tenantId = tenantId;
        }

        const user = await prisma.user.findFirst({
            where: whereClause,
            include: {
                tenant: true,
                employee: {
                    include: {
                        contact: true,
                        department: true,
                        designation: true,
                    },
                },
            },
        });

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (user.status !== 'active') {
            return res.status(403).json({ error: 'Account is inactive' });
        }

        const isValidPassword = await bcrypt.compare(password, user.passwordHash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        await prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
        });

        const token = jwt.sign(
            { userId: user.id, tenantId: user.tenantId, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                uuid: user.uuid,
                username: user.username,
                role: user.role,
                tenantId: user.tenantId,
                tenant: {
                    id: user.tenant.id,
                    name: user.tenant.name,
                    slug: user.tenant.slug,
                    subscriptionExpiry: user.tenant.subscriptionExpiry,
                },
                employee: user.employee ? {
                    id: user.employee.id,
                    uuid: user.employee.uuid,
                    employeeCode: user.employee.employeeCode,
                    name: `${user.employee.contact.firstName} ${user.employee.contact.lastName || ''}`.trim(),
                    photo: user.employee.contact.photo,
                    department: user.employee.department?.name,
                    designation: user.employee.designation?.name,
                } : null,
            },
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/auth/me
router.get('/me', async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token' });
        }

        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            include: {
                tenant: true,
                employee: {
                    include: {
                        contact: true,
                        department: true,
                        designation: true,
                    },
                },
            },
        });

        if (!user || user.status !== 'active') {
            return res.status(401).json({ error: 'Invalid user' });
        }

        res.json({
            user: {
                id: user.id,
                uuid: user.uuid,
                username: user.username,
                role: user.role,
                tenantId: user.tenantId,
                tenant: {
                    id: user.tenant.id,
                    name: user.tenant.name,
                    slug: user.tenant.slug,
                    logo: user.tenant.logo,
                    subscriptionExpiry: user.tenant.subscriptionExpiry,
                },
                employee: user.employee ? {
                    id: user.employee.id,
                    uuid: user.employee.uuid,
                    employeeCode: user.employee.employeeCode,
                    name: `${user.employee.contact.firstName} ${user.employee.contact.lastName || ''}`.trim(),
                    photo: user.employee.contact.photo,
                    department: user.employee.department?.name,
                    designation: user.employee.designation?.name,
                } : null,
            },
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/auth/change-password
router.post('/change-password', async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token' });
        }

        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        const { currentPassword, newPassword } = req.body;

        const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!isValid) return res.status(400).json({ error: 'Current password is incorrect' });

        const passwordHash = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id: user.id },
            data: { passwordHash },
        });

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
