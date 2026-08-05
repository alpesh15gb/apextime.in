import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import dayjs from 'dayjs';
import { fmtIST, fmtDateUTC } from '../lib/time';
import { Clock, LogOut, CalendarOff, Megaphone, Camera, MapPin, Send } from 'lucide-react';

export default function EmployeePortal() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [dashboard, setDashboard] = useState(null);
    const [currentTime, setCurrentTime] = useState(dayjs());
    const [punching, setPunching] = useState(false);
    const [showLeaveForm, setShowLeaveForm] = useState(false);
    const [leaveTypes, setLeaveTypes] = useState([]);
    const [leaveForm, setLeaveForm] = useState({ leaveTypeId: '', startDate: '', endDate: '', reason: '' });
    const [tab, setTab] = useState('home');
    const [myAttendance, setMyAttendance] = useState([]);
    const [myLeaves, setMyLeaves] = useState([]);
    const fileInputRef = useRef(null);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(dayjs()), 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        loadDashboard();
        api.get('/leave/types').then(r => setLeaveTypes(r.data)).catch(() => { });
    }, []);

    const loadDashboard = () => {
        api.get('/portal/dashboard').then(r => setDashboard(r.data)).catch(() => { });
    };

    const loadMyAttendance = () => {
        api.get('/portal/my-attendance').then(r => setMyAttendance(r.data)).catch(() => { });
    };

    const loadMyLeaves = () => {
        api.get('/leave/requests').then(r => setMyLeaves(r.data.data || [])).catch(() => { });
    };

    useEffect(() => {
        if (tab === 'attendance') loadMyAttendance();
        if (tab === 'leaves') loadMyLeaves();
    }, [tab]);

    const handlePunch = async () => {
        setPunching(true);
        try {
            let latitude = 0, longitude = 0;
            try {
                const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000, enableHighAccuracy: true }));
                latitude = pos.coords.latitude;
                longitude = pos.coords.longitude;
            } catch (e) {
                console.error('GPS error:', e);
                let msg = 'Failed to get location.';
                if (e.code === 1) msg = 'Location permission denied. Please enable location access in your browser settings.';
                else if (e.code === 2) msg = 'Location unavailable. Ensure GPS is on.';
                else if (e.code === 3) msg = 'Location request timed out.';
                alert(msg);
                setPunching(false);
                return;
            }

            // Create form data
            const formData = new FormData();
            formData.append('latitude', latitude);
            formData.append('longitude', longitude);

            // Try to capture photo from file input
            if (!fileInputRef.current?.files?.[0]) {
                alert('Selfie is mandatory! Please take a selfie first.');
                setPunching(false);
                return;
            }

            formData.append('photo', fileInputRef.current.files[0]);

            const res = await api.post('/portal/punch', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
            alert(res.data.message);

            // Clear preview
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
                document.getElementById('selfie-preview').style.display = 'none';
            }
            loadDashboard();
        } catch (err) {
            console.error(err);
            alert(`Error: ${err.message}\n${JSON.stringify(err.response?.data || {})}`);
        } finally {
            setPunching(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleLeaveSubmit = async (e) => {
        e.preventDefault();
        try {
            await api.post('/leave/apply', leaveForm);
            alert('Leave request submitted');
            setShowLeaveForm(false);
            setLeaveForm({ leaveTypeId: '', startDate: '', endDate: '', reason: '' });
            loadDashboard();
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to submit');
        }
    };

    const handleLogout = () => { logout(); navigate('/login'); };
    const isClockedIn = dashboard?.today?.isClockedIn;

    return (
        <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
            {/* Header */}
            <div style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div className="sidebar-brand-icon" style={{ width: 32, height: 32, fontSize: 14 }}>AT</div>
                    <div>
                        <h1 style={{ fontSize: '15px', fontWeight: 700 }}>{dashboard?.employee?.name || user?.username}</h1>
                        <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{dashboard?.employee?.department || ''}</p>
                    </div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={handleLogout}><LogOut size={16} /></button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', padding: '0 20px' }}>
                {[
                    { key: 'home', icon: <Clock size={14} />, label: 'Home' },
                    { key: 'attendance', icon: <CalendarOff size={14} />, label: 'Attendance' },
                    { key: 'leaves', icon: <CalendarOff size={14} />, label: 'Leaves' },
                    { key: 'news', icon: <Megaphone size={14} />, label: 'News' },
                ].map(t => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '6px', padding: '12px 16px', border: 'none',
                            background: 'none', color: tab === t.key ? 'var(--primary-light)' : 'var(--text-muted)',
                            borderBottom: tab === t.key ? '2px solid var(--primary)' : '2px solid transparent',
                            cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: '12px',
                        }}
                    >{t.icon} {t.label}</button>
                ))}
            </div>

            <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
                {/* HOME TAB */}
                {tab === 'home' && (
                    <>
                        {/* Clock & Punch Button */}
                        <div className="punch-container">
                            <div className="punch-time">{currentTime.format('hh:mm:ss')}</div>
                            <div className="punch-status">{currentTime.format('dddd, DD MMMM YYYY')}</div>

                            <div style={{ margin: '24px 0 16px', textAlign: 'center' }}>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    capture="user"
                                    style={{ display: 'none' }}
                                    id="selfie-input"
                                    onChange={(e) => {
                                        if (e.target.files && e.target.files[0]) {
                                            // Force re-render or show preview
                                            const reader = new FileReader();
                                            reader.onload = (ev) => {
                                                document.getElementById('selfie-preview').src = ev.target.result;
                                                document.getElementById('selfie-preview').style.display = 'block';
                                            };
                                            reader.readAsDataURL(e.target.files[0]);
                                        }
                                    }}
                                />
                                <label
                                    htmlFor="selfie-input"
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 20px',
                                        background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                                        color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                                    }}
                                >
                                    <Camera size={16} /> {fileInputRef.current?.files?.[0] ? 'Retake Selfie' : 'Take Selfie'}
                                </label>
                                <img id="selfie-preview" src="" alt="Selfie Preview" style={{ display: 'none', width: '100px', height: '100px', objectFit: 'cover', borderRadius: '50%', margin: '10px auto', border: '2px solid var(--primary)' }} />
                            </div>

                            <button
                                className={`punch-button ${isClockedIn ? 'active' : ''}`}
                                onClick={handlePunch}
                                disabled={punching}
                            >
                                <Clock size={28} />
                                <span>{punching ? '...' : isClockedIn ? 'CLOCK OUT' : 'CLOCK IN'}</span>
                            </button>

                            {dashboard?.today?.inAt && (
                                <div style={{ marginTop: '16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                    In: {fmtIST(dashboard.today.inAt)}
                                    {dashboard.today.outAt && ` • Out: ${fmtIST(dashboard.today.outAt)}`}
                                    <br />
                                    <span className={`badge badge-${dashboard.today.status === 'approved' || dashboard.today.status === 'auto_approved' ? 'success' : 'warning'}`} style={{ marginTop: '4px' }}>
                                        {dashboard.today.status}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Stats */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '20px' }}>
                            <div className="stat-card" style={{ padding: '16px' }}>
                                <div className="stat-icon green" style={{ width: 36, height: 36 }}><Clock size={18} /></div>
                                <div className="stat-info"><h3 style={{ fontSize: '20px' }}>{dashboard?.stats?.daysPresent || 0}</h3><p>Days Present</p></div>
                            </div>
                            <div className="stat-card" style={{ padding: '16px' }} onClick={() => setShowLeaveForm(true)}>
                                <div className="stat-icon purple" style={{ width: 36, height: 36 }}><CalendarOff size={18} /></div>
                                <div className="stat-info"><h3 style={{ fontSize: '20px' }}>{dashboard?.stats?.pendingLeaves || 0}</h3><p>Pending Leaves</p></div>
                            </div>
                        </div>

                        {/* Leave Balance */}
                        {dashboard?.stats?.leaveBalance?.length > 0 && (
                            <div className="card" style={{ marginTop: '16px' }}>
                                <div className="card-header"><span className="card-title">Leave Balance</span>
                                    <button className="btn btn-primary btn-sm" onClick={() => setShowLeaveForm(true)}>Apply Leave</button>
                                </div>
                                <div className="card-body">
                                    {dashboard.stats.leaveBalance.map((l, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-light)' }}>
                                            <span style={{ fontSize: '13px' }}>{l.type}</span>
                                            <strong style={{ color: l.balance > 0 ? 'var(--success)' : 'var(--danger)' }}>{l.balance} days</strong>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* ATTENDANCE TAB */}
                {tab === 'attendance' && (
                    <div>
                        <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>My Attendance</h3>
                        {myAttendance.map((a, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-light)' }}>
                                <div>
                                    <div style={{ fontSize: '13px', fontWeight: 600 }}>{fmtDateUTC(a.date)}</div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                        {fmtIST(a.inAt)} – {a.outAt ? fmtIST(a.outAt) : 'Active'}
                                    </div>
                                </div>
                                <span className={`badge badge-${a.status === 'approved' || a.status === 'auto_approved' ? 'success' : a.status === 'rejected' ? 'danger' : 'warning'}`}>{a.status}</span>
                            </div>
                        ))}
                        {myAttendance.length === 0 && <div className="empty-state"><p>No attendance records this month</p></div>}
                    </div>
                )}

                {/* LEAVES TAB */}
                {tab === 'leaves' && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h3 style={{ fontSize: '16px', fontWeight: 700 }}>My Leaves</h3>
                            <button className="btn btn-primary btn-sm" onClick={() => setShowLeaveForm(true)}>Apply Leave</button>
                        </div>
                        {myLeaves.map((l, i) => (
                            <div key={i} className="approval-card">
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <div>
                                        <div style={{ fontSize: '14px', fontWeight: 600 }}>{l.leaveType}</div>
                                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                            {fmtDateUTC(l.startDate, 'DD MMM')} - {fmtDateUTC(l.endDate, 'DD MMM YYYY')} ({l.days} days)
                                        </div>
                                        {l.reason && <div style={{ fontSize: '12px', marginTop: '4px', color: 'var(--text-secondary)' }}>{l.reason}</div>}
                                    </div>
                                    <span className={`badge badge-${l.status === 'approved' ? 'success' : l.status === 'rejected' ? 'danger' : 'warning'}`}>{l.status}</span>
                                </div>
                            </div>
                        ))}
                        {myLeaves.length === 0 && <div className="empty-state"><p>No leave requests</p></div>}
                    </div>
                )}

                {/* NEWS TAB */}
                {tab === 'news' && (
                    <div>
                        <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>Announcements</h3>
                        {dashboard?.announcements?.map(a => (
                            <div key={a.id} className="card" style={{ marginBottom: '12px' }}>
                                <div className="card-body">
                                    <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>{a.title}</h4>
                                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{a.body}</p>
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', display: 'block' }}>
                                        {dayjs(a.publishedAt).format('DD MMM YYYY')}
                                    </span>
                                </div>
                            </div>
                        ))}
                        {(!dashboard?.announcements || dashboard.announcements.length === 0) && <div className="empty-state"><p>No announcements</p></div>}
                    </div>
                )}
            </div>

            {/* Leave Application Modal */}
            {showLeaveForm && (
                <div className="modal-overlay" onClick={() => setShowLeaveForm(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
                        <div className="modal-header">
                            <h3 className="modal-title">Apply for Leave</h3>
                            <button className="btn btn-ghost btn-sm" onClick={() => setShowLeaveForm(false)}>✕</button>
                        </div>
                        <form onSubmit={handleLeaveSubmit}>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label className="form-label">Leave Type *</label>
                                    <select className="form-select" value={leaveForm.leaveTypeId} onChange={e => setLeaveForm({ ...leaveForm, leaveTypeId: e.target.value })} required>
                                        <option value="">Select type</option>
                                        {leaveTypes.map(t => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
                                    </select>
                                </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">From Date *</label>
                                        <input className="form-input" type="date" value={leaveForm.startDate} onChange={e => setLeaveForm({ ...leaveForm, startDate: e.target.value })} required />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">To Date *</label>
                                        <input className="form-input" type="date" value={leaveForm.endDate} onChange={e => setLeaveForm({ ...leaveForm, endDate: e.target.value })} required />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Reason</label>
                                    <textarea className="form-textarea" rows={3} value={leaveForm.reason} onChange={e => setLeaveForm({ ...leaveForm, reason: e.target.value })} placeholder="Enter reason for leave..." />
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-ghost" onClick={() => setShowLeaveForm(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary"><Send size={14} /> Submit</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
