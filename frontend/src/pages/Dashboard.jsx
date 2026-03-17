import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { Users, Clock, CheckCircle2, CalendarOff, HardDrive, AlertCircle, XCircle } from 'lucide-react';

export default function Dashboard() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get('/dashboard').then(res => { setStats(res.data); setLoading(false); }).catch(() => setLoading(false));
    }, []);

    if (loading) return <div className="empty-state"><p>Loading dashboard...</p></div>;
    if (!stats) return <div className="empty-state"><AlertCircle /><h3>Failed to load</h3></div>;

    const s = stats.stats;

    return (
        <div>
            <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '24px' }}>Dashboard</h2>

            <div className="stats-grid">
                <Link to="/employees" className="stat-card">
                    <div className="stat-icon blue"><Users size={24} /></div>
                    <div className="stat-info"><h3>{s.totalEmployees}</h3><p>Total Employees</p></div>
                </Link>
                <Link to="/attendance" className="stat-card">
                    <div className="stat-icon green"><Clock size={24} /></div>
                    <div className="stat-info"><h3>{s.todayPresent}</h3><p>Present Today</p></div>
                </Link>
                <Link to="/reports" className="stat-card">
                    <div className="stat-icon red"><XCircle size={24} /></div>
                    <div className="stat-info"><h3>{s.todayAbsent}</h3><p>Absent Today</p></div>
                </Link>
                <Link to="/approvals" className="stat-card">
                    <div className="stat-icon yellow"><CheckCircle2 size={24} /></div>
                    <div className="stat-info"><h3>{s.pendingApprovals}</h3><p>Pending Approvals</p></div>
                </Link>
                <Link to="/leave-requests" className="stat-card">
                    <div className="stat-icon indigo"><CalendarOff size={24} /></div>
                    <div className="stat-info"><h3>{s.pendingLeaves}</h3><p>Pending Leaves</p></div>
                </Link>
                <Link to="/devices" className="stat-card">
                    <div className="stat-icon green"><HardDrive size={24} /></div>
                    <div className="stat-info"><h3>{s.activeDevices}</h3><p>Active Devices</p></div>
                </Link>
            </div>

            {stats.recentAnnouncements?.length > 0 && (
                <div className="card" style={{ marginTop: '8px' }}>
                    <div className="card-header"><span className="card-title">Recent Announcements</span></div>
                    <div className="card-body">
                        {stats.recentAnnouncements.map(a => (
                            <div key={a.id} style={{ marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid var(--border-light)' }}>
                                <h4 style={{ fontSize: '14px', fontWeight: 600 }}>{a.title}</h4>
                                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>{a.body?.substring(0, 150)}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
