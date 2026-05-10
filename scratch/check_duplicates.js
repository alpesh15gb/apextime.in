const prisma = require('../src/lib/prisma');
const dayjs = require('dayjs');

async function check() {
    const today = dayjs().format('YYYY-MM-DD');
    console.log(`Checking timesheets for date: ${today}`);
    
    const timesheets = await prisma.timesheet.findMany({
        where: {
            date: new Date(today)
        },
        include: {
            employee: {
                include: {
                    contact: true
                }
            }
        }
    });

    console.log(`Found ${timesheets.length} timesheets for today.`);
    
    const empMap = {};
    timesheets.forEach(ts => {
        const empId = ts.employeeId;
        if (!empMap[empId]) empMap[empId] = [];
        empMap[empId].push(ts);
    });

    for (const empId in empMap) {
        if (empMap[empId].length > 1) {
            const emp = empMap[empId][0].employee;
            console.log(`Employee ${emp.contact.firstName} ${emp.contact.lastName} (${emp.employeeCode}) has ${empMap[empId].length} timesheets today!`);
            empMap[empId].forEach(ts => {
                console.log(`  - TS ID: ${ts.id}, inAt: ${ts.inAt}, outAt: ${ts.outAt}`);
            });
        }
    }

    // Also check for May 6th (yesterday)
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    console.log(`\nChecking timesheets for date: ${yesterday}`);
    const tsYesterday = await prisma.timesheet.findMany({
        where: {
            date: new Date(yesterday)
        }
    });
    console.log(`Found ${tsYesterday.length} timesheets for yesterday.`);

    process.exit(0);
}

check().catch(e => {
    console.error(e);
    process.exit(1);
});
