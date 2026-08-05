import { useState, useEffect } from 'react';
import api from '../lib/api';
import { fmtIST, fmtDateUTC, fmtDateTimeIST } from '../lib/time';
import { CheckCircle2, XCircle, MapPin, Camera } from 'lucide-react';

const LocationAddress = ({ lat, lng }) => {
    const [addr, setAddr] = useState('Locating...');
    useEffect(() => {
        if (!lat || !lng) return;
        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`)
            .then(res => res.json())
            .then(d => {
                const parts = (d.display_name || '').split(',');
                setAddr(parts.slice(0, 2).join(', '));
            })
            .catch(() => setAddr('Unknown Location'));
    }, [lat, lng]);
    return <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', marginTop: 4 }}><MapPin size={10} style={{ marginRight: 4 }} /> {addr}</div>;
};

const PhotoWithLocation = ({ photoUrl, lat, lng, time, label }) => {
    const [addr, setAddr] = useState('Locating...');
    const [fullAddr, setFullAddr] = useState('');

    useEffect(() => {
        if (!lat || !lng) return;
        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`)
            .then(res => res.json())
            .then(d => {
                const parts = (d.display_name || '').split(',');
                setAddr(parts.slice(0, 2).join(', '));
                setFullAddr(d.display_name);
            })
            .catch(() => {
                setAddr('Unknown Location');
                setFullAddr('Address not available');
            });
    }, [lat, lng]);

    if (!photoUrl) return <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>No Photo</span>;

    const staticMapUrl = `https://static-maps.yandex.ru/1.x/?l=map&ll=${lng},${lat}&z=14&size=100,100&pt=${lng},${lat},pm2rdm`;
    const finalPhotoUrl = photoUrl.startsWith('/') ? `/api${photoUrl}` : photoUrl;

    return (
        <div style={{ position: 'relative', width: '220px', height: '220px', overflow: 'hidden', borderRadius: '8px', border: '1px solid var(--border)', background: '#000' }}>
            <a href={finalPhotoUrl} target="_blank" rel="noopener noreferrer">
                <img src={finalPhotoUrl} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.9 }} />
            </a>
            
            <div style={{ 
                position: 'absolute', 
                bottom: 0, 
                left: 0, 
                right: 0, 
                background: 'rgba(0,0,0,0.7)', 
                color: 'white', 
                padding: '6px', 
                display: 'flex', 
                gap: '8px',
                fontSize: '8px',
                fontFamily: 'monospace',
                pointerEvents: 'none'
            }}>
                <div style={{ width: '50px', height: '50px', flexShrink: 0, border: '1px solid rgba(255,255,255,0.3)' }}>
                    <img src={staticMapUrl} alt="Map" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1px', lineHeight: 1.1, overflow: 'hidden' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '9px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{addr}</div>
                    <div style={{ opacity: 0.9, height: '10px', overflow: 'hidden' }}>{fullAddr.split(',').slice(1, 4).join(', ')}</div>
                    <div style={{ marginTop: '2px' }}>Lat {Number(lat).toFixed(6)}°</div>
                    <div>Long {Number(lng).toFixed(6)}°</div>
                    <div style={{ marginTop: '1px', fontWeight: 'bold' }}>{fmtDateTimeIST(time, 'DD/MM/YY hh:mm A')} IST</div>
                </div>
            </div>
        </div>
    );
};

export default function Approvals() {
    const [pending, setPending] = useState([]);
    const [loading, setLoading] = useState(true);

    const loadData = () => {
        api.get('/attendance/pending').then(r => { setPending(r.data); setLoading(false); }).catch(() => setLoading(false));
    };
    useEffect(() => { loadData(); }, []);

    const handleApprove = async (uuid) => {
        try { await api.post(`/attendance/${uuid}/approve`); loadData(); } catch (err) { alert('Failed'); }
    };

    const handleReject = async (uuid) => {
        const reason = prompt('Rejection reason:');
        if (reason === null) return;
        try { await api.post(`/attendance/${uuid}/reject`, { remarks: reason }); loadData(); } catch (err) { alert('Failed'); }
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ fontSize: '22px', fontWeight: 700 }}>Pending Approvals</h2>
                <span className="badge badge-warning">{pending.length} pending</span>
            </div>

            {pending.length === 0 && !loading && (
                <div className="empty-state"><CheckCircle2 /><h3>All clear!</h3><p>No pending attendance approvals</p></div>
            )}

            {pending.map(t => (
                <div className="approval-card" key={t.uuid}>
                    <div className="approval-header">
                        <div className="approval-avatar">{t.employeeName?.[0]}</div>
                        <div className="approval-info">
                            <h4>{t.employeeName}</h4>
                            <p>{t.employeeCode} • {t.department}</p>
                        </div>
                        <span className="badge badge-purple" style={{ marginLeft: 'auto' }}>{t.source}</span>
                    </div>

                    <div className="approval-details">
                        <div className="approval-detail">
                            <strong>Date:</strong> {fmtDateUTC(t.date)}
                        </div>
                        <div className="approval-detail">
                            <strong>Clock In:</strong> {fmtIST(t.inAt)}
                        </div>
                        <div className="approval-detail">
                            <strong>Clock Out:</strong> {t.outAt ? fmtIST(t.outAt) : 'Active'}
                        </div>
                        <div className="approval-detail">
                            <strong>Submitted:</strong> {fmtIST(t.createdAt)}
                        </div>
                    </div>

                    {/* Evidence Section */}
                    {t.source === 'mobile' && (
                        <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-light)' }}>
                            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                {/* IN Evidence */}
                                <div>
                                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px' }}>PUNCH IN SELFIE</div>
                                    <PhotoWithLocation photoUrl={t.photoUrl} lat={t.latitude} lng={t.longitude} time={t.inAt || t.createdAt} label="In Selfie" />
                                </div>

                                {/* OUT Evidence */}
                                {t.outAt && (
                                    <div>
                                        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px' }}>PUNCH OUT SELFIE</div>
                                        <PhotoWithLocation photoUrl={t.outPhotoUrl} lat={t.outLatitude} lng={t.outLongitude} time={t.outAt} label="Out Selfie" />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="approval-actions">
                        <button className="btn btn-success btn-sm" onClick={() => handleApprove(t.uuid)}>
                            <CheckCircle2 size={14} /> Approve
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleReject(t.uuid)}>
                            <XCircle size={14} /> Reject
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}
