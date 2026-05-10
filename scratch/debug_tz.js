const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const dayjs = require('dayjs');

async function check() {
    console.log('Current system time:', new Date().toString());
    console.log('Current system ISO:', new Date().toISOString());
    console.log('Dayjs now:', dayjs().format('YYYY-MM-DD HH:mm:ss'));
    
    const lastPunches = await prisma.deviceLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5
    });
    
    console.log('\nLast 5 Device Logs:');
    lastPunches.forEach(log => {
        console.log(`ID: ${log.id}, UserId: ${log.userId}, PunchTime: ${log.punchTime.toISOString()}, Raw: ${log.rawData}, CreatedAt: ${log.createdAt.toISOString()}`);
    });

    const lastTimesheets = await prisma.timesheet.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { employee: { include: { contact: true } } }
    });

    console.log('\nLast 5 Timesheets:');
    lastTimesheets.forEach(ts => {
        console.log(`ID: ${ts.id}, Emp: ${ts.employee.contact.firstName}, Date: ${ts.date.toISOString()}, InAt: ${ts.inAt?.toISOString()}, OutAt: ${ts.outAt?.toISOString()}, CreatedAt: ${ts.createdAt.toISOString()}`);
    });
}

check().catch(console.error).finally(() => prisma.$disconnect());
