const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function reprocess() {
    console.log('🔄 Resetting "processed" flag for logs since May 10th...');
    
    const result = await prisma.deviceLog.updateMany({
        where: {
            punchTime: {
                gte: new Date('2026-05-10T00:00:00Z')
            },
            processed: true
        },
        data: {
            processed: false
        }
    });

    console.log(`✅ Success! Reset ${result.count} logs.`);
    console.log('Now, the next time the biometric device connects or sends data, the server will re-process these logs with the new robust logic.');
}

reprocess()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
