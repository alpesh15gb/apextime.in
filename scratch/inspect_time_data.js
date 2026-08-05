/* Inspect attendance data for time-related anomalies (new-semantics aware).
 * Usage: node scratch/inspect_time_data.js [--limit N]
 * Uses the app's Prisma client (src/lib/prisma.js) — requires DATABASE_URL.
 *
 * New punch semantics: a timesheet with exactly ONE punch has outAt = null
 * (open / incomplete day). A sheet with 2+ punches has outAt = latest punch.
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
        console.log('now IST:', dayjs.tz(Date.now(), TZ).format('YYYY-MM-DD HH:mm:ss'));

        console.log('\n=== SAMPLE TIMESHEETS (latest 8) ===');
        const sample = await prisma.timesheet.findMany({ orderBy: { id: 'desc' }, take: 8 });
        for (const t of sample) {
            let punches = t.punches;
            if (typeof punches === 'string') { try { punches = JSON.parse(punches); } catch { punches = []; } }
            const punchStrs = (Array.isArray(punches) ? punches : []).map(p => {
                const d = parsePunchTime(p);
                return d ? dayjs.tz(d, TZ).format('MM-DD HH:mm') : '(bad)';
            });
            console.log(`#${t.id} emp=${t.employeeId} date=${dayjs.utc(t.date).format('YYYY-MM-DD')} in=${t.inAt ? dayjs.tz(t.inAt, TZ).format('MM-DD HH:mm') : '-'} out=${t.outAt ? dayjs.tz(t.outAt, TZ).format('MM-DD HH:mm') : '-'} st=${t.status} src=${t.source} punches=[${punchStrs.join(', ')}]`);
        }

        // Employee code map for readable output
        const empRows = await prisma.employee.findMany({ select: { id: true, employeeCode: true } });
        const empCode = new Map(empRows.map(e => [e.id, e.employeeCode]));

        console.log('\n=== ANOMALY SCAN (new semantics) ===');
        const all = await prisma.timesheet.findMany({ orderBy: { id: 'asc' } });
        if (limit > 0) all.length = Math.min(all.length, limit);

        const outBeforeIn = [];
        const dateNotInDay = [];
        const realMismatch = [];   // REAL problems under new semantics
        const staleSingleOpen = []; // 1 punch, outAt still set (old clobber leftover)
        const multiPunchOpen = [];  // 2+ punches but outAt null (should be set)
        const openOlder48h = [];    // open sheets >48h, grouped by date
        const openGroup = {};
        const dupSameDay = {};

        for (const t of all) {
            const dateStr = dayjs.utc(t.date).format('YYYY-MM-DD');
            const k = `${t.employeeId}|${dateStr}`;
            dupSameDay[k] = (dupSameDay[k] || 0) + 1;

            let punches = t.punches;
            if (typeof punches === 'string') { try { punches = JSON.parse(punches); } catch { punches = []; } }
            punches = Array.isArray(punches) ? punches : [];
            const punchTimes = punches.map(parsePunchTime).filter(Boolean).sort((a, b) => a - b);

            const code = empCode.get(t.employeeId) || t.employeeId;

            if (t.inAt && t.outAt && t.outAt <= t.inAt) {
                outBeforeIn.push({ id: t.id, code, date: dateStr, in: t.inAt.toISOString(), out: t.outAt.toISOString() });
            }

            const inIST = t.inAt ? dayjs.tz(t.inAt, TZ).format('YYYY-MM-DD') : null;
            if (inIST && inIST !== dateStr) {
                dateNotInDay.push({ id: t.id, code, date: dateStr, inDayIST: inIST });
            }

            if (punchTimes.length === 1) {
                // New semantics: outAt must be null; inAt must equal the punch.
                if (t.outAt && Math.abs(t.outAt.getTime() - punchTimes[0].getTime()) > 120000) {
                    realMismatch.push({ id: t.id, code, date: dateStr, kind: 'single_punch_outAt_wrong', inAt: t.inAt?.toISOString(), outAt: t.outAt?.toISOString(), punch: punchTimes[0].toISOString() });
                } else if (t.outAt) {
                    staleSingleOpen.push({ id: t.id, code, date: dateStr, inAt: t.inAt?.toISOString(), outAt: t.outAt?.toISOString(), punch: punchTimes[0].toISOString() });
                }
                if (t.inAt && Math.abs(t.inAt.getTime() - punchTimes[0].getTime()) > 120000) {
                    realMismatch.push({ id: t.id, code, date: dateStr, kind: 'single_punch_inAt_wrong', inAt: t.inAt?.toISOString(), punch: punchTimes[0].toISOString() });
                }
            } else if (punchTimes.length > 1) {
                const min = punchTimes[0], max = punchTimes[punchTimes.length - 1];
                if (!t.inAt || Math.abs(t.inAt.getTime() - min.getTime()) > 120000 || !t.outAt || Math.abs(t.outAt.getTime() - max.getTime()) > 120000) {
                    realMismatch.push({ id: t.id, code, date: dateStr, kind: 'in_at_or_out_at_mismatch', inAt: t.inAt?.toISOString(), outAt: t.outAt?.toISOString(), punchMin: min.toISOString(), punchMax: max.toISOString(), punches: punches.length });
                }
            }

            if (!t.outAt && t.inAt) {
                const ageH = dayjs.tz(Date.now(), TZ).diff(dayjs.tz(t.inAt, TZ), 'hour');
                if (ageH > 48) {
                    openGroup[dateStr] = (openGroup[dateStr] || 0) + 1;
                    openOlder48h.push({ id: t.id, code, date: dateStr, in: t.inAt.toISOString(), punches: punches.length, openForHours: Math.round(ageH) });
                }
                if (punchTimes.length > 1) {
                    multiPunchOpen.push({ id: t.id, code, date: dateStr, punches: punchTimes.length });
                }
            }
        }

        const dups = Object.entries(dupSameDay).filter(([, v]) => v > 1);

        console.log(`outBeforeIn: ${outBeforeIn.length}`);
        console.log(`dateNotInDay: ${dateNotInDay.length}`);
        console.log(`REAL mismatches (need attention): ${realMismatch.length}`);
        realMismatch.slice(0, 25).forEach(a => console.log('  ', JSON.stringify(a)));
        console.log(`stale single-punch with outAt set (cosmetic, closeable): ${staleSingleOpen.length}`);
        console.log(`multi-punch but outAt null (shouldn't exist): ${multiPunchOpen.length}`);
        multiPunchOpen.slice(0, 10).forEach(a => console.log('  ', JSON.stringify(a)));
        console.log(`open >48h total: ${openOlder48h.length} — by date:`);
        Object.entries(openGroup).sort().forEach(([d, c]) => console.log(`    ${d}: ${c}`));
        console.log(`dupSameDay groups: ${dups.length}`);
        dups.slice(0, 10).forEach(([k, v]) => console.log('  ', k, '=>', v, 'rows'));

        console.log('\n=== DEVICE LOGS ===');
        console.log(`unprocessed deviceLogs: ${await prisma.deviceLog.count({ where: { processed: false } })}`);
        const recentLogs = await prisma.deviceLog.findMany({ orderBy: { id: 'desc' }, take: 5 });
        for (const l of recentLogs) {
            console.log(`log#${l.id} dev=${l.deviceId} user=${l.userId} punch=${l.punchTime ? dayjs.tz(l.punchTime, TZ).format('YYYY-MM-DD HH:mm:ss') : '-'} processed=${l.processed} raw=${(l.rawData || '').slice(0, 60)}`);
        }

        console.log('\n=== SOURCE / STATUS ===');
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
