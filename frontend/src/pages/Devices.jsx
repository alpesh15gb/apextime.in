import { useState, useEffect } from 'react';
import api from '../lib/api';
import dayjs from 'dayjs';
import { Plus, HardDrive, RefreshCw, Wifi, WifiOff, Download, Trash2 } from 'lucide-react';

export default function Devices() {
    const [devices, setDevices] = useState([]);
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState({ name: '', serialNumber: '', ipAddress: '', type: 'biometric', protocol: 'attlog' });

    const loadData = () => api.get('/devices').then(r => setDevices(r.data));
    useEffect(() => { loadData(); }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        try { await api.post('/devices', { ...form, protocol: form.protocol || 'attlog' }); setShowModal(false); setForm({ name: '', serialNumber: '', ipAddress: '', type: 'biometric', protocol: 'attlog' }); loadData(); }
        catch (err) { alert(err.response?.data?.message || 'Failed'); }
    };

    const regenerateToken = async (uuid) => {
        try {
            const res = await api.post(`/devices/${uuid}/regenerate-token`);
            alert(`New token: ${res.data.token}`);
        } catch (err) { alert('Failed'); }
    };

    const syncDevice = async (uuid) => {
        if (!confirm('This will command the device to upload ALL previous attendance logs. This may take a few minutes. Continue?')) return;
        try {
            await api.post(`/devices/${uuid}/sync`);
            alert('Success: Command queued! The device will start uploading data within 30-60 seconds (next heartbeat).');
        } catch (err) { alert(err.response?.data?.message || 'Failed to queue command'); }
    };

    const rebootDevice = async (uuid) => {
        if (!confirm('Reboot this device?')) return;
        try { await api.post(`/devices/${uuid}/reboot`); alert('Reboot command queued'); } catch (err) { alert('Failed'); }
    };

    const setTime = async (uuid) => {
        try { await api.post(`/devices/${uuid}/set-time`); alert('Time sync command queued'); } catch (err) { alert('Failed'); }
    };

    const clearAdmin = async (uuid) => {
        if (!confirm('Clear all administrator privileges on this device?')) return;
        try { await api.post(`/devices/${uuid}/clear-admin`); alert('Clear admin command queued'); } catch (err) { alert('Failed'); }
    };

    const deleteDevice = async (uuid) => {
        if (!confirm('Are you sure you want to delete this device? Associated logs may be kept but the device connection will be lost.')) return;
        try {
            await api.delete(`/devices/${uuid}`);
            loadData();
        } catch (err) { alert('Failed to delete device'); }
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ fontSize: '22px', fontWeight: 700 }}>Devices</h2>
                <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Add Device</button>
            </div>

            <div className="card">
                <table className="data-table">
                    <thead><tr><th>Name</th><th>Serial</th><th>IP</th><th>Protocol</th><th>Status</th><th>Last Seen</th><th>Logs</th><th>Actions</th></tr></thead>
                    <tbody>
                        {devices.map(d => (
                            <tr key={d.uuid}>
                                <td><div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><HardDrive size={16} style={{ color: 'var(--primary)' }} /><strong>{d.name}</strong></div></td>
                                <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{d.serialNumber || '-'}</td>
                                <td>{d.ipAddress || '-'}</td>
                                <td><span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 10, background: d.protocol === 'json' ? 'var(--primary-bg, #e0e7ff)' : 'var(--bg-secondary, #f3f4f6)', color: d.protocol === 'json' ? 'var(--primary, #4f46e5)' : 'var(--text-muted)' }}>{d.protocol === 'json' ? '🤖 AI (JSON)' : '📟 Non-AI (ATTLOG)'}</span></td>
                                <td>{d.status === 'active' ? <span className="badge badge-success"><Wifi size={10} /> Active</span> : <span className="badge badge-danger"><WifiOff size={10} /> Offline</span>}</td>
                                <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{d.lastSeenAt ? dayjs(d.lastSeenAt).format('DD MMM hh:mm A') : 'Never'}</td>
                                <td>{d._count?.logs || 0}</td>
                                <td style={{ display: 'flex', gap: '4px' }}>
                                    <button className="btn btn-ghost btn-sm" onClick={() => syncDevice(d.uuid)} title="Pull Past Logs"><Download size={14} /> Sync</button>
                                    <button className="btn btn-ghost btn-sm" onClick={() => setTime(d.uuid)} title="Sync Time"><RefreshCw size={14} /></button>
                                    <button className="btn btn-ghost btn-sm" onClick={() => rebootDevice(d.uuid)} title="Reboot"><RefreshCw size={14} style={{ color: 'var(--warning)' }} /></button>
                                    <button className="btn btn-ghost btn-sm" onClick={() => clearAdmin(d.uuid)} title="Clear Admin" style={{ color: 'var(--primary)' }}>A</button>
                                    <button className="btn btn-ghost btn-sm" onClick={() => deleteDevice(d.uuid)} title="Delete Device" style={{ color: 'var(--danger)' }}><Trash2 size={14} /></button>
                                </td>
                            </tr>
                        ))}
                        {devices.length === 0 && <tr><td colSpan="7" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No devices registered</td></tr>}
                    </tbody>
                </table>
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Add Device</h3>
                            <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>✕</button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="modal-body">
                                <div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
                                <div className="form-row">
                                    <div className="form-group"><label className="form-label">Serial Number</label><input className="form-input" value={form.serialNumber} onChange={e => setForm({ ...form, serialNumber: e.target.value })} placeholder="From ESSL device sticker" /></div>
                                    <div className="form-group"><label className="form-label">IP Address</label><input className="form-input" value={form.ipAddress} onChange={e => setForm({ ...form, ipAddress: e.target.value })} placeholder="e.g. 192.168.1.100" /></div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Device Protocol *</label>
                                    <select className="form-input" value={form.protocol} onChange={e => setForm({ ...form, protocol: e.target.value })}>
                                        <option value="attlog">Non-AI Device (X990, uFace, etc.) - Tab-separated ATTLOG</option>
                                        <option value="json">AI Device (AiFace Orcus) - JSON format</option>
                                    </select>
                                    <small style={{ fontSize: '10px', color: 'gray' }}>
                                        Non-AI devices use tab-separated format. AI devices (AiFace Orcus) use JSON format to /iclock/DeviceLogsPost
                                    </small>
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Register Device</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
