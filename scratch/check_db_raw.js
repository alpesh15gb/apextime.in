const { Pool } = require('pg');
const pool = new Pool({
    connectionString: 'postgresql://apextime:apextime123@localhost:5433/apextime_in'
});

async function check() {
    console.log('Querying database...');
    const logs = await pool.query('SELECT id, user_id, punch_time, raw_data, created_at FROM device_logs ORDER BY created_at DESC LIMIT 5');
    console.log('\nLast 5 Device Logs:');
    console.table(logs.rows);

    const ts = await pool.query(`
        SELECT t.id, e.employee_code, c.first_name, t.date, t.in_at, t.out_at, t.created_at 
        FROM timesheets t 
        JOIN employees e ON t.employee_id = e.id 
        JOIN contacts c ON e.contact_id = c.id 
        ORDER BY t.created_at DESC LIMIT 5
    `);
    console.log('\nLast 5 Timesheets:');
    console.table(ts.rows);
    
    await pool.end();
}

check().catch(console.error);
