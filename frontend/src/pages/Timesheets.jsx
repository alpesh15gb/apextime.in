import { useState, useEffect } from 'react';
import api from '../lib/api';
import dayjs from 'dayjs';
import { fmtIST } from '../lib/time';
import { Clock, Search } from 'lucide-react';

export default function Timesheets() {
    const [timesheets, setTimesheets] = useState([]);
    const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
    const [loading, setLoading] = useState(true);

    const loadData = () => {
        setLoading(true);
        api.get('/attendance/timesheets', { params: { date, limit: 200 } })
            .then(r => { setTimesheets(r.data.data || []); setLoading(false); })
            .catch(() => setLoading(false));
    };

    useEffect(() => { loadData(); }, [date]);

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ fontSize: '22px', fontWeight: 700 }}>Attendance Timesheets</h2>
                <input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: '180px' }} />
            </div>

            <div className="card">
                <table className="data-table">
                    <thead><tr>
                        <th>Employee</th><th>Code</th><th>Department</th><th>In</th><th>Out</th><th>Source</th><th>Status</th>
                    </tr></thead>
                    <tbody>
                        {timesheets.map(t => (
                            <tr key={t.uuid}>
                                <td>{t.employeeName}</td>
                                <td><strong>{t.employeeCode}</strong></td>
                                <td>{t.department || '-'}</td>
                                <td>{fmtIST(t.inAt)}</td>
                                <td>{t.outAt ? fmtIST(t.outAt) : <span style={{ color: 'var(--warning)' }}>Active</span>}</td>
                                <td><span className={`badge badge-${t.source === 'device' ? 'info' : t.source === 'mobile' ? 'purple' : 'warning'}`}>{t.source}</span></td>
                                <td><span className={`badge badge-${t.status === 'approved' || t.status === 'auto_approved' ? 'success' : t.status === 'pending' ? 'warning' : 'danger'}`}>{t.status}</span></td>
                            </tr>
                        ))}
                        {timesheets.length === 0 && !loading && <tr><td colSpan="7" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No records for {date}</td></tr>}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
