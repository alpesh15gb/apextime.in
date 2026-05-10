const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

console.log('System Timezone:', Intl.DateTimeFormat().resolvedOptions().timeZone);
console.log('System Time:', new Date().toString());
console.log('ISO Time:', new Date().toISOString());

const testDate = new Date('2026-05-10T00:00:00.000Z');
console.log('Test Date (00:00 UTC):', testDate.toISOString());
console.log('dayjs(testDate).format():', dayjs(testDate).format('YYYY-MM-DD HH:mm:ss'));
console.log('dayjs.utc(testDate).format():', dayjs.utc(testDate).format('YYYY-MM-DD HH:mm:ss'));

const punchStr = '2026-05-10 00:10:00';
const punchTime = dayjs(punchStr, 'YYYY-MM-DD HH:mm:ss').toDate();
console.log('Parsed Punch:', punchTime.toISOString());
console.log('Format as Date:', dayjs(punchTime).format('YYYY-MM-DD'));
