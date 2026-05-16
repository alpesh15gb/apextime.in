const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function checkSuccess() {
    console.log('Checking for any timesheets with outAt NOT null...');
    const timesheets = await prisma.timesheet.findMany({
        where: {
            outAt: { not: null }
        },
        take: 10,
        orderBy: { date: 'desc' },
        include: {
            employee: { include: { contact: true } }
        }
    });

    console.log('ID | Emp Code | Name | Date | In | Out | Source');
    console.log('---|----------|------|------|----|-----|-------');
    for (const ts of timesheets) {
        console.log(`${ts.id} | ${ts.employee.employeeCode} | ${ts.employee.contact.firstName} | ${ts.date.toISOString().split('T')[0]} | ${ts.inAt.toISOString()} | ${ts.outAt.toISOString()} | ${ts.source}`);
    }
}

checkSuccess()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
