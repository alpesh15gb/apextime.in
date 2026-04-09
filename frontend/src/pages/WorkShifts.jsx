import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Plus, Edit, Trash2, Users, X } from 'lucide-react';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };

const defaultRecords = () => DAYS.map(day => ({
    day,
    startTime: day === 'sunday' ? '' : '09:00',
    endTime: day === 'sunday' ? '' : '18:00',
    isOvernight: false,
    isOff: day === 'sunday',
    graceMins: 0,
}));

export default function WorkShifts() {
    const [shifts, setShifts] = useState([]);
    const [showModal, setShowModal] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [form, setForm] = useState({ name: '', records: defaultRecords(), isFlexible: false, minHours: 0, lunchDuration: 1, lunchThreshold: 4 });

    // Assignment state
    const [showAssignModal, setShowAssignModal] = useState(false);
    const [assignShift, setAssignShift] = useState(null);
    const [employees, setEmployees] = useState([]);
    const [assignForm, setAssignForm] = useState({ employeeIds: [], startDate: '', endDate: '' });
    const [assignments, setAssignments] = useState([]);

    const loadData = () => api.get('/work-shifts').then(r => setShifts(r.data));
    useEffect(() => { loadData(); }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            if (editItem) await api.put(`/work-shifts/${editItem.uuid}`, form);
            else await api.post('/work-shifts', form);
            setShowModal(false);
            setEditItem(null);
            setForm({ name: '', records: defaultRecords(), isFlexible: false, minHours: 0, lunchDuration: 1, lunchThreshold: 4 });
            loadData();
        } catch (err) { alert(err.response?.data?.message || 'Failed'); }
    };

    const handleDelete = async (uuid) => {
        if (!confirm('Delete this shift?')) return;
        await api.delete(`/work-shifts/${uuid}`);
        loadData();
    };

    const openEdit = (shift) => {
        setEditItem(shift);
        // Ensure all 7 days exist in records
        const existing = shift.records || [];
        const records = DAYS.map(day => {
            const found = existing.find(r => r.day === day);
            return found || { day, startTime: '09:00', endTime: '18:00', isOvernight: false, isOff: false, graceMins: 0 };
        });
        setForm({ 
            name: shift.name, 
            records, 
            isFlexible: !!shift.isFlexible, 
            minHours: shift.minHours || 0,
            lunchDuration: shift.lunchDuration || 0,
            lunchThreshold: shift.lunchThreshold || 0
        });
        setShowModal(true);
    };

    const openAssign = async (shift) => {
        setAssignShift(shift);
        setAssignForm({ employeeIds: [], startDate: '', endDate: '' });
        try {
            const [empRes, assignRes] = await Promise.all([
                api.get('/employees?limit=500'),
                api.get(`/work-shifts/${shift.uuid}/assignments`)
            ]);
            setEmployees(empRes.data.data || empRes.data || []);
            setAssignments(assignRes.data || []);
        } catch { setEmployees([]); setAssignments([]); }
        setShowAssignModal(true);
    };

    const handleAssign = async (e) => {
        e.preventDefault();
        if (assignForm.employeeIds.length === 0) return alert('Select at least one employee');
        try {
            await api.post(`/work-shifts/${assignShift.uuid}/assign`, assignForm);
            // Refresh assignments
            const assignRes = await api.get(`/work-shifts/${assignShift.uuid}/assignments`);
            setAssignments(assignRes.data || []);
            setAssignForm({ employeeIds: [], startDate: '', endDate: '' });
        } catch (err) { alert(err.response?.data?.message || 'Failed to assign'); }
    };

    const removeAssignment = async (id) => {
        if (!confirm('Remove this assignment?')) return;
        try {
            await api.delete(`/work-shifts/assignments/${id}`);
            setAssignments(prev => prev.filter(a => a.id !== id));
        } catch (err) { alert('Failed to remove'); }
    };

    const updateRecord = (dayIndex, field, value) => {
        setForm(prev => {
            const records = [...prev.records];
            records[dayIndex] = { ...records[dayIndex], [field]: value };
            // If isOff toggled on, clear times
            if (field === 'isOff' && value) {
                records[dayIndex].startTime = '';
                records[dayIndex].endTime = '';
            }
            return { ...prev, records };
        });
    };

    const toggleEmployee = (empId) => {
        setAssignForm(prev => ({
            ...prev,
            employeeIds: prev.employeeIds.includes(empId)
                ? prev.employeeIds.filter(id => id !== empId)
                : [...prev.employeeIds, empId]
        }));
    };

    const selectAllEmployees = () => {
        setAssignForm(prev => ({
            ...prev,
            employeeIds: prev.employeeIds.length === employees.length
                ? []
                : employees.map(e => e.id)
        }));
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ fontSize: '22px', fontWeight: 700 }}>Work Shifts</h2>
                <button className="btn btn-primary" onClick={() => { setEditItem(null); setForm({ name: '', records: defaultRecords(), isFlexible: false, minHours: 0, lunchDuration: 1, lunchThreshold: 4 }); setShowModal(true); }}>
                    <Plus size={16} /> Add Shift
                </button>
            </div>

            <div className="card">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Shift Name</th>
                            <th>Schedule Summary</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {shifts.map(s => {
                            const recs = s.records || [];
                            const workDays = recs.filter(r => !r.isOff).length;
                            const offDays = recs.filter(r => r.isOff).length;
                            const firstWork = recs.find(r => !r.isOff);
                            const timeSummary = firstWork ? `${firstWork.startTime} - ${firstWork.endTime}` : 'All Off';

                            return (
                                <tr key={s.uuid}>
                                    <td><strong>{s.name}</strong></td>
                                    <td>
                                        <span style={{ fontSize: 12 }}>
                                            {s.isFlexible ? (
                                                <strong>Flexible ({s.minHours} hrs min)</strong>
                                            ) : (
                                                <>{workDays} work days, {offDays} off | {timeSummary}</>
                                            )}
                                            {firstWork?.graceMins > 0 && ` (Grace: ${firstWork.graceMins}min)`}
                                        </span>
                                    </td>
                                    <td>
                                        <span style={{
                                            padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                                            background: s.status === 'active' ? 'var(--success-bg, #e6f9ed)' : 'var(--danger-bg, #fde8e8)',
                                            color: s.status === 'active' ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)'
                                        }}>
                                            {s.status}
                                        </span>
                                    </td>
                                    <td style={{ display: 'flex', gap: '6px' }}>
                                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(s)} title="Edit"><Edit size={14} /></button>
                                        <button className="btn btn-ghost btn-sm" onClick={() => openAssign(s)} title="Assign Employees"><Users size={14} /></button>
                                        <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(s.uuid)} title="Delete"><Trash2 size={14} /></button>
                                    </td>
                                </tr>
                            );
                        })}
                        {shifts.length === 0 && (
                            <tr><td colSpan="4" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                                No shifts defined. Create your first work shift.
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Create/Edit Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 700 }}>
                        <div className="modal-header">
                            <h3 className="modal-title">{editItem ? 'Edit' : 'Create'} Work Shift</h3>
                            <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>✕</button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="modal-body">
                                <div style={{ display: 'flex', gap: '20px', marginBottom: 16 }}>
                                    <div className="form-group" style={{ flex: 2 }}>
                                        <label className="form-label">Shift Name *</label>
                                        <input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="e.g. General, Morning, Night" />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, display: 'flex', alignItems: 'flex-end', paddingBottom: '10px' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 500 }}>
                                            <input type="checkbox" checked={form.isFlexible} onChange={e => setForm({ ...form, isFlexible: e.target.checked })} />
                                            Flexible Shift
                                        </label>
                                    </div>
                                    {form.isFlexible && (
                                        <div className="form-group" style={{ flex: 1 }}>
                                            <label className="form-label">Min Hours</label>
                                            <input type="number" step="0.5" className="form-input" value={form.minHours} onChange={e => setForm({ ...form, minHours: e.target.value })} placeholder="10" />
                                        </div>
                                    )}
                                </div>

                                <div style={{ display: 'flex', gap: '20px', marginBottom: 16 }}>
                                    <div className="form-group" style={{ flex: 1 }}>
                                        <label className="form-label">Lunch Duration (Hrs)</label>
                                        <input type="number" step="0.1" className="form-input" value={form.lunchDuration} onChange={e => setForm({ ...form, lunchDuration: e.target.value })} placeholder="1.0" />
                                    </div>
                                    <div className="form-group" style={{ flex: 1 }}>
                                        <label className="form-label">Lunch Threshold (Hrs)</label>
                                        <input type="number" step="0.5" className="form-input" value={form.lunchThreshold} onChange={e => setForm({ ...form, lunchThreshold: e.target.value })} placeholder="4.0" />
                                        <small style={{ fontSize: '10px', color: 'gray' }}>Subtract lunch only if worked > this</small>
                                    </div>
                                    <div style={{ flex: 1 }}></div>
                                </div>

                                <label className="form-label" style={{ marginBottom: 8 }}>Day-wise Schedule</label>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                    <thead>
                                        <tr style={{ background: 'var(--bg-secondary, #f5f5f5)' }}>
                                            <th style={{ padding: '8px', textAlign: 'left' }}>Day</th>
                                            <th style={{ padding: '8px' }}>Start</th>
                                            <th style={{ padding: '8px' }}>End</th>
                                            <th style={{ padding: '8px' }}>Grace (min)</th>
                                            <th style={{ padding: '8px' }}>Overnight</th>
                                            <th style={{ padding: '8px' }}>Off</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {form.records.map((rec, idx) => (
                                            <tr key={rec.day} style={{ borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                                                <td style={{ padding: '6px 8px', fontWeight: 500 }}>{DAY_LABELS[rec.day]}</td>
                                                <td style={{ padding: '4px 6px' }}>
                                                    <input type="time" className="form-input" style={{ padding: '4px 6px', fontSize: 12 }}
                                                        value={rec.startTime} onChange={e => updateRecord(idx, 'startTime', e.target.value)}
                                                        disabled={rec.isOff} />
                                                </td>
                                                <td style={{ padding: '4px 6px' }}>
                                                    <input type="time" className="form-input" style={{ padding: '4px 6px', fontSize: 12 }}
                                                        value={rec.endTime} onChange={e => updateRecord(idx, 'endTime', e.target.value)}
                                                        disabled={rec.isOff} />
                                                </td>
                                                <td style={{ padding: '4px 6px' }}>
                                                    <input type="number" className="form-input" style={{ padding: '4px 6px', fontSize: 12, width: 60, textAlign: 'center' }}
                                                        value={rec.graceMins || 0} onChange={e => updateRecord(idx, 'graceMins', parseInt(e.target.value) || 0)}
                                                        disabled={rec.isOff} min={0} max={120} />
                                                </td>
                                                <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                                                    <input type="checkbox" checked={rec.isOvernight}
                                                        onChange={e => updateRecord(idx, 'isOvernight', e.target.checked)}
                                                        disabled={rec.isOff} />
                                                </td>
                                                <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                                                    <input type="checkbox" checked={rec.isOff}
                                                        onChange={e => updateRecord(idx, 'isOff', e.target.checked)} />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">{editItem ? 'Update' : 'Create'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Assign Employees Modal */}
            {showAssignModal && assignShift && (
                <div className="modal-overlay" onClick={() => setShowAssignModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 650, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
                        <div className="modal-header">
                            <h3 className="modal-title">Assign Employees — {assignShift.name}</h3>
                            <button className="btn btn-ghost btn-sm" onClick={() => setShowAssignModal(false)}>✕</button>
                        </div>

                        <div className="modal-body" style={{ overflow: 'auto', flex: 1 }}>
                            {/* Current Assignments */}
                            {assignments.length > 0 && (
                                <div style={{ marginBottom: 20 }}>
                                    <label className="form-label" style={{ marginBottom: 8 }}>Current Assignments</label>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                        <thead>
                                            <tr style={{ background: 'var(--bg-secondary, #f5f5f5)' }}>
                                                <th style={{ padding: 6, textAlign: 'left' }}>Employee</th>
                                                <th style={{ padding: 6 }}>From</th>
                                                <th style={{ padding: 6 }}>To</th>
                                                <th style={{ padding: 6 }}></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {assignments.map(a => (
                                                <tr key={a.id} style={{ borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                                                    <td style={{ padding: 6 }}>{a.employeeName || `Employee #${a.employeeId}`}</td>
                                                    <td style={{ padding: 6, textAlign: 'center' }}>{a.startDate?.split('T')[0]}</td>
                                                    <td style={{ padding: 6, textAlign: 'center' }}>{a.endDate?.split('T')[0]}</td>
                                                    <td style={{ padding: 6, textAlign: 'center' }}>
                                                        <button className="btn btn-ghost btn-sm" onClick={() => removeAssignment(a.id)} title="Remove">
                                                            <X size={14} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {/* New Assignment Form */}
                            <form onSubmit={handleAssign}>
                                <label className="form-label" style={{ marginBottom: 8 }}>New Assignment</label>
                                <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                                    <div style={{ flex: 1 }}>
                                        <label className="form-label" style={{ fontSize: 11 }}>Start Date *</label>
                                        <input type="date" className="form-input" value={assignForm.startDate}
                                            onChange={e => setAssignForm({ ...assignForm, startDate: e.target.value })} required />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label className="form-label" style={{ fontSize: 11 }}>End Date *</label>
                                        <input type="date" className="form-input" value={assignForm.endDate}
                                            onChange={e => setAssignForm({ ...assignForm, endDate: e.target.value })} required />
                                    </div>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                    <label className="form-label" style={{ margin: 0 }}>
                                        Select Employees ({assignForm.employeeIds.length} selected)
                                    </label>
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={selectAllEmployees}>
                                        {assignForm.employeeIds.length === employees.length ? 'Deselect All' : 'Select All'}
                                    </button>
                                </div>

                                <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, padding: 4 }}>
                                    {employees.map(emp => (
                                        <label key={emp.id} style={{
                                            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                                            cursor: 'pointer', borderRadius: 4,
                                            background: assignForm.employeeIds.includes(emp.id) ? 'var(--primary-bg, #ede9fe)' : 'transparent'
                                        }}>
                                            <input type="checkbox" checked={assignForm.employeeIds.includes(emp.id)}
                                                onChange={() => toggleEmployee(emp.id)} />
                                            <span style={{ fontWeight: 500, fontSize: 13 }}>{emp.name || `${emp.firstName} ${emp.lastName || ''}`}</span>
                                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({emp.employeeCode || emp.code})</span>
                                        </label>
                                    ))}
                                    {employees.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>No employees found</div>}
                                </div>

                                <div style={{ marginTop: 16, textAlign: 'right' }}>
                                    <button type="submit" className="btn btn-primary" disabled={assignForm.employeeIds.length === 0 || !assignForm.startDate || !assignForm.endDate}>
                                        Assign {assignForm.employeeIds.length} Employee{assignForm.employeeIds.length !== 1 ? 's' : ''}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
