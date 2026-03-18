const prisma = require('../lib/prisma');

/**
 * Multi-tenant middleware
 * Resolves tenant from subdomain or X-Tenant-Slug header
 * Sets req.tenant and req.tenantId
 */
async function tenantMiddleware(req, res, next) {
    try {
        let slug = null;
        const host = req.hostname || req.headers.host?.split(':')[0];
        console.log(`[TenantMiddleware] Host: ${host}, URL: ${req.url}`);

        // 1. Check X-Tenant-Slug header (for API testing)
        if (req.headers['x-tenant-slug']) {
            slug = req.headers['x-tenant-slug'];
        }

        // 2. Extract from subdomain (school1.apextime.in)
        if (!slug) {
            const host = req.hostname || req.headers.host?.split(':')[0];
            if (host) {
                const parts = host.split('.');
                // subdomain.apextime.in = 3 parts
                // subdomain.localhost = 2 parts (dev)
                // Check if host is IP address
                const isIp = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(host);
                if (!isIp && parts.length >= 2) {
                    const sub = parts[0];
                    if (sub !== 'www' && sub !== 'api' && sub !== 'admin' && sub !== 'apextime') {
                        slug = sub;
                    }
                }
            }
        }

        // 3. Check query param (fallback for dev)
        if (!slug && req.query.tenant) {
            slug = req.query.tenant;
        }

        if (!slug) {
            // No tenant context - allow auth routes to handle it
            req.tenantId = null;
            req.tenant = null;
            return next();
        }

        const tenant = await prisma.tenant.findUnique({
            where: { slug },
        });

        if (!tenant) {
            return res.status(404).json({
                error: 'Tenant not found',
                message: `No organization found for "${slug}"`,
            });
        }

        if (tenant.status !== 'active') {
            return res.status(403).json({
                error: 'Tenant suspended',
                message: 'This organization account is currently suspended.',
            });
        }

        // 4. Check Subscription Expiry
        if (tenant.subscriptionExpiry && new Date() > new Date(tenant.subscriptionExpiry)) {
            return res.status(403).json({
                error: 'Subscription expired',
                message: 'Your organization subscription has expired. Please contact the administrator for renewal.',
                isExpired: true
            });
        }

        req.tenant = tenant;
        req.tenantId = tenant.id;
        next();
    } catch (error) {
        console.error('Tenant middleware error:', error);
        res.status(500).json({ error: 'Failed to resolve tenant' });
    }
}

module.exports = { tenantMiddleware };
