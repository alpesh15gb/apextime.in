/**
 * Diagnostic: dump raw punches + timesheets + shift config for ONE employee
 * so we can see exactly how punches were paired (e.g. a missed OUT glued to
 * the next day's punch).
 *
 * Usage (inside backend container):
 *   node scratch/inspect_employee.js <employeeCode> [startDate YYYY-MM-DD] [endDate YYYY-MM-DD]
 *   e.g. node scratch/inspect_employee.js 1303 2026-07-28 2026-08-07
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const time = require('../src/lib/time');

async function main() {
    const code = process.argv[2];
    if (!code) {
        console.error('Usage: node scratch/inspect_employee.js <employeeCode> [startDate] [endDate]');
        process.exit(1);
    }
    const start = process.argv[3] || '2026-07-28';
    const end = process.argv[4] || '2026-08-07';

    const employee = await prisma.employee.findFirst({
        where: { employeeCode: code },
        include: { contact: true, department: true },
    });
    if (!employee) {
        console.error(`No employee with code ${code}`);
        process.exit(1);
    }
    console.log('=== EMPLOYEE ===');
    console.log(`id=${employee.id} code=${employee.employeeCode} name=${employee.contact.firstName} ${employee.contact.lastName || ''} dept=${employee.department?.name || '-'}`);

    // Shift assignment(s)
    const assignments = await prisma.employeeWorkShift.findMany({
        where: {
            employeeId: employee.id,
            startDate: { lte: time.utcDate(end) },
            endDate: { gte: time.utcDate(start) },
        },
        include: { workShift: true },
    });
    console.log('\n=== SHIFT ASSIGNMENTS ===');
    if (!assignments.length) console.log('  (none in range)');
    for (const a of assignments) {
        const rec = Array.isArray(a.workShift.records) ? a.workShift.records : [];
        console.log(`  shift#${a.workShift.id} "${a.workShift.name}" flexible=${a.workShift.isFlexible} minHours=${a.workShift.minHours} otFormula=${a.workShift.otFormula} maxOtHours=${a.workShift.maxOtHours} ${time.dayUTC(a.startDate).format('YYYY-MM-DD')} → ${time.dayUTC(a.endDate).format('YYYY-MM-DD')}`);
        for (const r of rec) {
            console.log(`    ${r.day}: ${r.startTime || '-'} - ${r.endTime || '-'} isOff=${!!r.isOff} isOvernight=${!!r.isOvernight} grace=${r.graceMins ?? 0}`);
        }
    }

    // Raw device logs (chronological)
    const logs = await prisma.deviceLog.findMany({
        where: {
            tenantId: employee.tenantId,
            userId: code,
            punchTime: {
                gte: time.utcDate(start),
                lte: new Date(time.utcDate(end).getTime() + 86400000),
            },
        },
        orderBy: { punchTime: 'asc' },
    });
    console.log(`\n=== RAW DEVICE LOGS (${logs.length}) ===`);
    let modeDist = {};
    for (const l of logs) {
        const parts = String(l.rawData || '').split(/[\t ]+/).filter(Boolean);
        const mode = parts.length >= 5 ? parts[4] : (parts.length >= 4 ? parts[3] : '?');
        modeDist[mode] = (modeDist[mode] || 0) + 1;
        const ist = time.tz(l.punchTime).format('YYYY-MM-DD HH:mm:ss');
        const hour = time.tz(l.punchTime).hour();
        const dayPart = hour < 12 ? 'MORNING' : (hour < 17 ? 'AFTERNOON' : 'EVENING');
        console.log(`  log#${l.id} ${ist} [${dayPart}] mode=${mode} processed=${l.processed} raw="${String(l.rawData).trim()}"`);
    }
    console.log(`  mode distribution: ${JSON.stringify(modeDist)}`);

    // Timesheets
    const sheets = await prisma.timesheet.findMany({
        where: {
            tenantId: employee.tenantId,
            employeeId: employee.id,
            date: { gte: time.utcDate(start), lte: time.utcDate(end) },
        },
        orderBy: { date: 'asc', id: 'asc' },
    });
    console.log(`\n=== TIMESHEETS (${sheets.length}) ===`);
    for (const s of sheets) {
        const pArr = Array.isArray(s.punches) ? s.punches : [];
        const punches = pArr.map(p => {
            const t = time.tz(new Date(p.time)).format('DD HH:mm');
            return `${t}${p.type ? ':' + p.type : ''}`;
        }).join(', ');
        console.log(`  ts#${s.id} date=${time.dayUTC(s.date).format('YYYY-MM-DD')} in=${s.inAt ? time.tz(s.inAt).format('YYYY-MM-DD HH:mm') : '-'} out=${s.outAt ? time.tz(s.outAt).format('YYYY-MM-DD HH:mm') : '-'} status=${s.status} src=${s.source} punches=[${punches}]`);
    }

    console.log('\n=== CORRELATION: device-mode vs time-of-day ===');
    // If mode X punches are mostly EVENING → that mode means "check-in"
    // If mostly MORNING → that mode means "check-out"
    const modeTimes = {};
    for (const l of logs) {
        const parts = String(l.rawData || '').split(/[\t ]+/).filter(Boolean);
        const mode = parts.length >= 5 ? parts[4] : (parts.length >= 4 ? parts[3] : '?');
        const h = time.tz(l.punchTime).hour();
        if (!modeTimes[mode]) modeTimes[mode] = { morning: 0, afternoon: 0, evening: 0 };
        if (h < 12) modeTimes[mode].morning++;
        else if (h < 17) modeTimes[mode].afternoon++;
        else modeTimes[mode].evening++;
    }
    console.log(JSON.stringify(modeTimes, null, 2));

    await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
