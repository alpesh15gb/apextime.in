const { Client } = require('pg');
const dayjs = require('dayjs');

async function check() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL
    });
    await client.connect();

    console.log('--- Checking database dates ---');
    const res = await client.query('SELECT id, employee_id, date, in_at, out_at FROM timesheets ORDER BY id DESC LIMIT 20');
    
    res.rows.forEach(row => {
        console.log(`ID: ${row.id}, Emp: ${row.employee_id}, Date: ${row.date.toISOString()}, In: ${row.in_at}, Out: ${row.out_at}`);
    });

    await client.end();
}

check().catch(e => {
    console.error(e);
    process.exit(1);
});
