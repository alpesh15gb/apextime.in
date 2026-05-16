const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function inspectTimesheet() {
    const id = parseInt(process.argv[2]);
    if (!id) {
        console.log('Please provide a timesheet ID.');
        return;
    }

    console.log(`Inspecting Timesheet ID: ${id}`);
    const ts = await prisma.timesheet.findUnique({
        where: { id },
        include: {
            employee: { include: { contact: true } }
        }
    });

    if (!ts) {
        console.log('Timesheet not found.');
        return;
    }

    console.log('Data:');
    console.log('- Employee:', ts.employee.employeeCode, ts.employee.contact.firstName);
    console.log('- Date:', ts.date.toISOString());
    console.log('- InAt:', ts.inAt ? ts.inAt.toISOString() : 'null');
    console.log('- OutAt:', ts.outAt ? ts.outAt.toISOString() : 'null');
    console.log('- Source:', ts.source);
    console.log('- Status:', ts.status);
    console.log('- Punches:', JSON.stringify(ts.punches, null, 2));
    console.log('- Meta:', JSON.stringify(ts.meta, null, 2));
}

inspectTimesheet()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
