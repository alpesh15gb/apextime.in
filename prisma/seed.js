/**
 * Seed script — creates initial super admin + demo tenant
 */
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const connectionString = `${process.env.DATABASE_URL}`;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('🌱 Seeding ApexTime Business database...');

    // 1. Create a default tenant
    const tenant = await prisma.tenant.upsert({
        where: { slug: 'demo' },
        update: {},
        create: {
            name: 'ApexTime Demo Business',
            slug: 'demo',
            status: 'active',
            subscriptionExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
            config: {
                timezone: 'Asia/Kolkata',
                currency: 'INR'
            }
        },
    });
    console.log(`  ✅ Tenant: ${tenant.name} (${tenant.slug})`);

    // 2. Create super admin user (no tenant)
    const superAdminHash = await bcrypt.hash('super123', 10);
    const superAdmin = await prisma.user.upsert({
        where: { tenantId_username: { tenantId: tenant.id, username: 'superadmin' } },
        update: {},
        create: {
            tenantId: tenant.id,
            username: 'superadmin',
            passwordHash: superAdminHash,
            role: 'super_admin',
        },
    });
    console.log(`  ✅ Super Admin: ${superAdmin.username}`);

    // 3. Create admin user for demo tenant
    const adminHash = await bcrypt.hash('admin123', 10);
    const admin = await prisma.user.upsert({
        where: { tenantId_username: { tenantId: tenant.id, username: 'admin' } },
        update: {},
        create: {
            tenantId: tenant.id,
            username: 'admin',
            passwordHash: adminHash,
            role: 'admin',
        },
    });
    console.log(`  ✅ Admin: ${admin.username}`);

    // 4. Seed attendance types
    const attendanceTypes = [
        { name: 'Present', code: 'P', category: 'present', color: '#22c55e' },
        { name: 'Absent', code: 'A', category: 'absent', color: '#ef4444' },
        { name: 'Half Day', code: 'HD', category: 'half_day', color: '#f59e0b' },
        { name: 'Late', code: 'L', category: 'late', color: '#f97316' },
        { name: 'On Leave', code: 'OL', category: 'on_leave', color: '#8b5cf6' },
    ];

    for (const at of attendanceTypes) {
        await prisma.attendanceType.upsert({
            where: { tenantId_code: { tenantId: tenant.id, code: at.code } },
            update: {},
            create: { tenantId: tenant.id, ...at },
        });
    }
    console.log('  ✅ Attendance types seeded');

    // 5. Seed leave types
    const leaveTypes = [
        { name: 'Casual Leave', code: 'CL', maxDays: 12, isPaid: true, color: '#3b82f6' },
        { name: 'Sick Leave', code: 'SL', maxDays: 12, isPaid: true, color: '#ef4444' },
        { name: 'Earned Leave', code: 'EL', maxDays: 15, isPaid: true, color: '#22c55e' },
        { name: 'Loss of Pay', code: 'LOP', maxDays: null, isPaid: false, color: '#6b7280' },
    ];

    for (const lt of leaveTypes) {
        await prisma.leaveType.upsert({
            where: { tenantId_code: { tenantId: tenant.id, code: lt.code } },
            update: {},
            create: { tenantId: tenant.id, ...lt },
        });
    }
    console.log('  ✅ Leave types seeded');

    // 6. Create demo department + designation
    const dept = await prisma.department.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name: 'Operations' } },
        update: {},
        create: { tenantId: tenant.id, name: 'Operations' },
    });

    const desig = await prisma.designation.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name: 'Manager' } },
        update: {},
        create: { tenantId: tenant.id, name: 'Manager', departmentId: dept.id },
    });

    // 7. Create demo employee
    let contact = await prisma.contact.findFirst({
        where: { tenantId: tenant.id, firstName: 'John' },
    });

    if (!contact) {
        contact = await prisma.contact.create({
            data: {
                tenantId: tenant.id,
                firstName: 'John',
                lastName: 'Doe',
                email: 'john.doe@apextime.in',
                phone: '9999999999',
                gender: 'male',
            },
        });
    }

    const employee = await prisma.employee.upsert({
        where: { tenantId_employeeCode: { tenantId: tenant.id, employeeCode: 'EMP001' } },
        update: {},
        create: {
            tenantId: tenant.id,
            contactId: contact.id,
            employeeCode: 'EMP001',
            departmentId: dept.id,
            designationId: desig.id,
            joiningDate: new Date('2024-01-01'),
        },
    });

    // Create user for employee
    const empHash = await bcrypt.hash('EMP001', 10);
    await prisma.user.upsert({
        where: { tenantId_username: { tenantId: tenant.id, username: 'EMP001' } },
        update: {},
        create: {
            tenantId: tenant.id,
            username: 'EMP001',
            passwordHash: empHash,
            role: 'employee',
            employeeId: employee.id,
        },
    });
    console.log('  ✅ Demo employee: EMP001 (password: EMP001)');

    // 8. Create holiday year
    await prisma.holidayYear.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name: '2025-2026' } },
        update: {},
        create: {
            tenantId: tenant.id,
            name: '2025-2026',
            shortName: '25-26',
            startDate: new Date('2025-04-01'),
            endDate: new Date('2026-03-31'),
            isActive: true,
        },
    });
    console.log('  ✅ Holiday Year: 2025-2026');

    // 9. Create work shift
    const defaultRecords = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(day => ({
        day, startTime: '09:00', endTime: '18:00', isOvernight: false, isOff: false,
    }));
    defaultRecords.push({ day: 'sunday', startTime: '09:00', endTime: '18:00', isOvernight: false, isOff: true });

    await prisma.workShift.upsert({
        where: { uuid: '00000000-0000-0000-0000-000000000001' },
        update: {},
        create: {
            uuid: '00000000-0000-0000-0000-000000000001',
            tenantId: tenant.id,
            name: 'Standard Shift',
            records: defaultRecords,
        },
    });
    console.log('  ✅ Work shift: Standard Shift (Mon-Sat 9am-6pm)');

    console.log('\n🎉 ApexTime Business Seed complete!\n');
    console.log('Login credentials:');
    console.log('  Super Admin: superadmin / super123');
    console.log('  Admin:       admin / admin123');
    console.log('  Employee:    EMP001 / EMP001');
    console.log(`\nTenant slug: demo (use demo.apextime.in or ?tenant=demo)`);
}

main()
    .catch((e) => {
        console.error('Seed error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
