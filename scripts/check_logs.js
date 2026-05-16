const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function checkDeviceLogs() {
    const userId = process.argv[2];
    if (!userId) {
        console.log('Please provide a userId (employee code). Example: node scripts/check_logs.js EMP001');
        return;
    }

    console.log(`Checking raw device logs for user: ${userId}`);
    const logs = await prisma.deviceLog.findMany({
        where: {
            userId: userId
        },
        orderBy: { punchTime: 'desc' },
        take: 50
    });

    console.log('ID | Punch Time | Processed | Device ID');
    console.log('---|------------|-----------|----------');
    for (const log of logs) {
        console.log(`${log.id} | ${log.punchTime.toISOString()} | ${log.processed} | ${log.deviceId}`);
    }
}

checkDeviceLogs()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
