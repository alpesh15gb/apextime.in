/* Inspect attendance data for time-related anomalies.
 * Usage: node scratch/inspect_time_data.js [--limit N]
 * Uses the app's Prisma client (src/lib/prisma.js) — requires DATABASE_URL.
 */
require('dotenv').config();
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const prisma = require('../src/lib/prisma');

const TZ = 'Asia/Kolkata';

const parsePunchTime = (p) => {
    if (!p) return null;
    const raw = p.time?.value || p.time;
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
};

(async () => {
    try {
        const limit = parseInt(process.argv[2] === '--limit' ? process.argv[3] : '0', 10) || 0;

        const [tsCount, logCount, empCount, devCount] = await Promise.all([
            prisma.timesheet.count(),
            prisma.deviceLog.count(),
            prisma.employee.count(),
            prisma.device.count(),
        ]);
        console.log('=== COUNTS ===');
        console.log(`timesheets=${tsCount} deviceLogs=${logCount} employees=${empCount} devices=${devCount}`);

        // Timezone sanity
        console.log('\n=== ENV ===');
        console.log('node TZ:', process.env.TZ || '(unset)');
        console.log('system TZ:', Intl.DateTimeFormat().resolvedOptions().timeZone);
        console.log('now IST:', dayjs.tz(Date.now(), TZ).format('YYYY-MM-DD HH:mm:ss'));

        console.log('\n=== SAMPLE TIMESHEETS (latest 8) ===');
        const sample = await prisma.timesheet.findMany({ orderBy: { id: 'desc' }, take: 8 });
        for (const t of sample) {
            let punches = t.punches;
            if (typeof punches === 'string') { try { punches = JSON.parse(punches); } catch { punches = []; } }
            const punchStrs = (Array.isArray(punches) ? punches : []).map(p => {
                const d = parsePunchTime(p);
                return d ? dayjs.tz(d, TZ).format('MM-DD HH:mm') : '(bad:' + JSON.stringify(p) + ')';
            });
            const inIST = t.inAt ? dayjs.tz(t.inAt, TZ).format('MM-DD HH:mm') : '-';
            const outIST = t.outAt ? dayjs.tz(t.outAt, TZ).format('MM-DD HH:mm') : '-';
            const dateStr = dayjs.utc(t.date).format('YYYY-MM-DD');
            console.log(`#${t.id} emp=${t.employeeId} date=${dateStr} in=${inIST} out=${outIST} st=${t.status} src=${t.source} punches=[${punchStrs.join(', ')}]`);
        }

        console.log('\n=== ANOMALY SCAN ===');
        const all = await prisma.timesheet.findMany({ orderBy: { id: 'asc' } });

        const anomalies = {
            outBeforeIn: [],        // outAt <= inAt
            dateNotInDay: [],       // date column != IST date of inAt
            inOutMismatchPunches: [], // punches exist but inAt/outAt != min/max of punches
            openOlderThan48h: [],   // outAt null && inAt older than 48h
            dupSameDay: {},         // employee+date with >1 timesheet
            punchTimeInvalid: [],   // punches with unparseable time
        };

        const dayKey = new Map(); // emp|date -> count
        for (const t of all) {
            let punches = t.punches;
            if (typeof punches === 'string') { try { punches = JSON.parse(punches); } catch { punches = []; } }
            punches = Array.isArray(punches) ? punches : [];

            const dateStr = dayjs.utc(t.date).format('YYYY-MM-DD');
            const k = `${t.employeeId}|${dateStr}`;
            dayKey.set(k, (dayKey.get(k) || 0) + 1);

            if (t.inAt && t.outAt && t.outAt <= t.inAt) anomalies.outBeforeIn.push({ id: t.id, emp: t.employeeId, date: dateStr, in: t.inAt.toISOString(), out: t.outAt.toISOString() });

            const inIST = t.inAt ? dayjs.tz(t.inAt, TZ).format('YYYY-MM-DD') : null;
            if (inIST && inIST !== dateStr) anomalies.dateNotInDay.push({ id: t.id, emp: t.employeeId, date: dateStr, inDayIST: inIST, in: t.inAt.toISOString() });

            const punchTimes = punches.map(parsePunchTime).filter(Boolean).sort((a, b) => a - b);
            if (punchTimes.length) {
                const min = punchTimes[0], max = punchTimes[punchTimes.length - 1];
                if (!t.inAt || Math.abs(t.inAt.getTime() - min.getTime()) > 120000) anomalies.inOutMismatchPunches.push({ id: t.id, emp: t.employeeId, date: dateStr, inAt: t.inAt?.toISOString(), punchMin: min.toISOString(), outAt: t.outAt?.toISOString(), punchMax: max.toISOString() });
                else if (!t.outAt || Math.abs(t.outAt.getTime() - max.getTime()) > 120000) anomalies.inOutMismatchPunches.push({ id: t.id, emp: t.employeeId, date: dateStr, inAt: t.inAt?.toISOString(), punchMin: min.toISOString(), outAt: t.outAt?.toISOString(), punchMax: max.toISOString() });
            }
            if (punches.length && punchTimes.length !== punches.length) anomalies.punchTimeInvalid.push({ id: t.id, emp: t.employeeId, date: dateStr, punches });

            if (!t.outAt && t.inAt) {
                const ageH = dayjs.tz(Date.now(), TZ).diff(dayjs.tz(t.inAt, TZ), 'hour');
                if (ageH > 48) anomalies.openOlderThan48h.push({ id: t.id, emp: t.employeeId, date: dateStr, in: t.inAt.toISOString(), openForHours: Math.round(ageH) });
            }
        }

        const dups = {};
        for (const [k, v] of dayKey) if (v > 1) dups[k] = v;

        console.log(`outBeforeIn: ${anomalies.outBeforeIn.length}`);
        anomalies.outBeforeIn.slice(0, 10).forEach(a => console.log('  ', JSON.stringify(a)));
        console.log(`dateNotInDay: ${anomalies.dateNotInDay.length}`);
        anomalies.dateNotInDay.slice(0, 10).forEach(a => console.log('  ', JSON.stringify(a)));
        console.log(`inOutMismatchPunches: ${anomalies.inOutMismatchPunches.length}`);
        anomalies.inOutMismatchPunches.slice(0, 10).forEach(a => console.log('  ', JSON.stringify(a)));
        console.log(`punchTimeInvalid: ${anomalies.punchTimeInvalid.length}`);
        anomalies.punchTimeInvalid.slice(0, 5).forEach(a => console.log('  ', JSON.stringify(a)));
        console.log(`openOlderThan48h: ${anomalies.openOlderThan48h.length}`);
        anomalies.openOlderThan48h.slice(0, 10).forEach(a => console.log('  ', JSON.stringify(a)));
        console.log(`dupSameDay groups: ${Object.keys(dups).length} (rows involved: ${Object.values(dups).reduce((a, b) => a + b, 0)})`);
        Object.entries(dups).slice(0, 10).forEach(([k, v]) => console.log('  ', k, '=>', v, 'rows'));

        // Device logs
        console.log('\n=== DEVICE LOGS ===');
        const unprocessed = await prisma.deviceLog.count({ where: { processed: false } });
        console.log(`unprocessed deviceLogs: ${unprocessed}`);
        const recentLogs = await prisma.deviceLog.findMany({ orderBy: { id: 'desc' }, take: 5 });
        for (const l of recentLogs) {
            console.log(`log#${l.id} dev=${l.deviceId} user=${l.userId} punch=${l.punchTime ? dayjs.tz(l.punchTime, TZ).format('YYYY-MM-DD HH:mm:ss') : '-'} processed=${l.processed} raw=${(l.rawData || '').slice(0, 60)}`);
        }

        // Timesheets by source
        console.log('\n=== SOURCE DISTRIBUTION ===');
        const bySource = await prisma.timesheet.groupBy({ by: ['source'], _count: true });
        bySource.forEach(s => console.log(`  ${s.source}: ${s._count}`));
        const byStatus = await prisma.timesheet.groupBy({ by: ['status'], _count: true });
        byStatus.forEach(s => console.log(`  status ${s.status}: ${s._count}`));

    } catch (e) {
        console.error('ERROR:', e.message);
        process.exitCode = 1;
    } finally {
        await prisma.$disconnect();
    }
})();
