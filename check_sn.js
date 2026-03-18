const prisma = require('./src/lib/prisma');

async function check() {
  const sn = '6426145100735';
  console.log(`Checking Serial Number: ${sn}`);
  
  try {
    const device = await prisma.device.findFirst({
      where: { serialNumber: sn },
      include: { tenant: true }
    });

    if (device) {
      console.log('✅ Device Found:');
      console.log(`- Name: ${device.name}`);
      console.log(`- Tenant: ${device.tenant.name} (ID: ${device.tenantId})`);
      console.log(`- Status: ${device.status}`);
      console.log(`- Last Seen: ${device.lastSeenAt}`);
    } else {
      console.log('❌ Device NOT found in database.');
      const all = await prisma.device.findMany({ select: { serialNumber: true } });
      console.log('Available Serial Numbers in DB:', all.map(d => d.serialNumber));
    }
  } catch (err) {
    console.error('Prisma Error:', err.message);
  }
}

check().catch(console.error).finally(() => prisma.$disconnect());
