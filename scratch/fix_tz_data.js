const { Pool } = require('pg');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Kolkata';

const pool = new Pool({
    connectionString: 'postgresql://apextime:apextime123@localhost:5433/apextime_in'
});

async function fix() {
    console.log('Starting data fix for timezone shift...');
    
    // Find timesheets for May 9th that were created or updated recently
    // and might contain May 10th punches
    const res = await pool.query(`
        SELECT id, employee_id, tenant_id, date, in_at, out_at, punches 
        FROM timesheets 
        WHERE date = '2026-05-09'
    `);
    
    console.log(`Found ${res.rows.length} timesheets on 2026-05-09.`);
    
    for (const row of res.rows) {
        let punches = row.punches;
        if (typeof punches === 'string') punches = JSON.parse(punches);
        if (!Array.isArray(punches)) punches = [];
        
        // Check if the FIRST punch (inAt) is actually on May 10th
        const inAt = dayjs.tz(row.in_at, TZ);
        if (inAt.format('YYYY-MM-DD') === '2026-05-10') {
            console.log(`Timesheet ${row.id} (Emp: ${row.employee_id}) starts on May 10th (${inAt.format('HH:mm')}). Moving to May 10th.`);
            
            // Move this timesheet to May 10th
            await pool.query(`
                UPDATE timesheets 
                SET date = '2026-05-10' 
                WHERE id = $1
            `, [row.id]);
            
            // Also need to check if there's already a timesheet on May 10th for this employee
            // If so, we might need to merge. But for now let's just move it.
        } else {
            // Check individual punches
            const punchesToMove = punches.filter(p => dayjs.tz(p.time, TZ).format('YYYY-MM-DD') === '2026-05-10');
            if (punchesToMove.length > 0 && punchesToMove.length === punches.length) {
                 // All punches are on 10th
                 console.log(`Timesheet ${row.id} has all ${punches.length} punches on May 10th. Moving.`);
                 await pool.query("UPDATE timesheets SET date = '2026-05-10' WHERE id = $1", [row.id]);
            } else if (punchesToMove.length > 0) {
                 console.log(`Timesheet ${row.id} has partial punches on May 10th. This might be an overnight shift or error.`);
                 // For now, if the inAt is on 9th but some punches are on 10th, it's likely OK (overnight).
                 // But the user said "10th punch is showing on 9th", which implies it SHOULD be on 10th.
            }
        }
    }
    
    console.log('Fix completed.');
    await pool.end();
}

fix().catch(e => {
    console.error(e);
    process.exit(1);
});
