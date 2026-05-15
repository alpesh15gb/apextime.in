const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function checkData() {
    console.log('Checking timesheets with null outAt but potentially multiple punches...');
    const timesheets = await prisma.timesheet.findMany({
        where: {
            outAt: null
        },
        take: 50,
        orderBy: { date: 'desc' },
        include: {
            employee: { include: { contact: true } }
        }
    });

    console.log('ID | Employee | Date | In | Punches Count | Source');
    console.log('---|----------|------|----|---------------|-------');
    for (const ts of timesheets) {
        let punches = ts.punches;
        if (typeof punches === 'string') try { punches = JSON.parse(punches); } catch(e) { punches = []; }
        const punchCount = Array.isArray(punches) ? punches.length : 0;
        
        console.log(`${ts.id} | ${ts.employee.contact.firstName} | ${ts.date.toISOString().split('T')[0]} | ${ts.inAt ? ts.inAt.toISOString() : '-'} | ${punchCount} | ${ts.source}`);
        if (punchCount > 1) {
            console.log('   Punches:', JSON.stringify(punches));
        }
    }
}

checkData()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
