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
    const [form, setForm] = useState({ name: '', records: defaultRecords(), isFlexible: false, minHours: 0, lunchDuration: 1, lunchThreshold: 4,
        halfDayMins: 240, absentDayMins: 60, halfDayLateMins: 30, halfDayEarlyMins: 30, earlyGraceMins: 0,
        otFormula: 'total_duration_minus_shift', maxOtHours: 0, markAbsentForLate: false, continuousLateDays: 3, absentDayType: 'full_day',
        break1Enabled: false, break1Start: '13:00', break1End: '13:30', break2Enabled: false, break2Start: '17:00', break2End: '17:30' });

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
            setForm({ name: '', records: defaultRecords(), isFlexible: false, minHours: 0, lunchDuration: 1, lunchThreshold: 4,
                halfDayMins: 240, absentDayMins: 60, halfDayLateMins: 30, halfDayEarlyMins: 30, earlyGraceMins: 0,
                otFormula: 'total_duration_minus_shift', maxOtHours: 0, markAbsentForLate: false, continuousLateDays: 3, absentDayType: 'full_day',
                break1Enabled: false, break1Start: '13:00', break1End: '13:30', break2Enabled: false, break2Start: '17:00', break2End: '17:30' });
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
        setForm({ 
            name: shift.name, 
            records, 
            isFlexible: !!shift.isFlexible, 
            minHours: shift.minHours || 0,
            lunchDuration: shift.lunchDuration || 0,
            lunchThreshold: shift.lunchThreshold || 0,
            halfDayMins: shift.halfDayMins || 240,
            absentDayMins: shift.absentDayMins || 60,
            halfDayLateMins: shift.halfDayLateMins || 30,
            halfDayEarlyMins: shift.halfDayEarlyMins || 30,
            earlyGraceMins: shift.earlyGraceMins || 0,
            otFormula: shift.otFormula || 'total_duration_minus_shift',
            maxOtHours: shift.maxOtHours || 0,
            markAbsentForLate: !!shift.markAbsentForLate,
            continuousLateDays: shift.continuousLateDays || 3,
            absentDayType: shift.absentDayType || 'full_day',
            break1Enabled: !!shift.break1Enabled,
            break1Start: shift.break1Start || '13:00',
            break1End: shift.break1End || '13:30',
            break2Enabled: !!shift.break2Enabled,
            break2Start: shift.break2Start || '17:00',
            break2End: shift.break2End || '17:30',
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
                <button className="btn btn-primary" onClick={() => { setEditItem(null); setForm({ name: '', records: defaultRecords(), isFlexible: false, minHours: 0, lunchDuration: 1, lunchThreshold: 4, halfDayMins: 240, absentDayMins: 60, halfDayLateMins: 30, halfDayEarlyMins: 30, earlyGraceMins: 0, otFormula: 'total_duration_minus_shift', maxOtHours: 0, markAbsentForLate: false, continuousLateDays: 3, absentDayType: 'full_day', break1Enabled: false, break1Start: '13:00', break1End: '13:30', break2Enabled: false, break2Start: '17:00', break2End: '17:30' }); setShowModal(true); }}>
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
                                {/* ── Attendance Rules ── */}
                                <label className="form-label" style={{ marginBottom: 8, marginTop: 8, fontWeight: 600 }}>Attendance Rules</label>
                                <div style={{ display: 'flex', gap: '20px', marginBottom: 12, flexWrap: 'wrap' }}>
                                    <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
                                        <label className="form-label">Half-Day Threshold (min)</label>
                                        <input type="number" className="form-input" value={form.halfDayMins} onChange={e => setForm({ ...form, halfDayMins: parseInt(e.target.value) || 240 })} />
                                        <small style={{ fontSize: '10px', color: 'gray' }}>Below this = half day</small>
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
                                        <label className="form-label">Absent Threshold (min)</label>
                                        <input type="number" className="form-input" value={form.absentDayMins} onChange={e => setForm({ ...form, absentDayMins: parseInt(e.target.value) || 60 })} />
                                        <small style={{ fontSize: '10px', color: 'gray' }}>Below this = absent</small>
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
                                        <label className="form-label">Late → Half-Day (min)</label>
                                        <input type="number" className="form-input" value={form.halfDayLateMins} onChange={e => setForm({ ...form, halfDayLateMins: parseInt(e.target.value) || 30 })} />
                                        <small style={{ fontSize: '10px', color: 'gray' }}>Late beyond this = half day</small>
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
                                        <label className="form-label">Early → Half-Day (min)</label>
                                        <input type="number" className="form-input" value={form.halfDayEarlyMins} onChange={e => setForm({ ...form, halfDayEarlyMins: parseInt(e.target.value) || 30 })} />
                                        <small style={{ fontSize: '10px', color: 'gray' }}>Early beyond this = half day</small>
                                    </div>
                                </div>

                                {/* ── OT Rules ── */}
                                <label className="form-label" style={{ marginBottom: 8, fontWeight: 600 }}>Overtime Rules</label>
                                <div style={{ display: 'flex', gap: '20px', marginBottom: 12, flexWrap: 'wrap' }}>
                                    <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
                                        <label className="form-label">OT Formula</label>
                                        <select className="form-input" value={form.otFormula} onChange={e => setForm({ ...form, otFormula: e.target.value })}>
                                            <option value="total_duration_minus_shift">Total Duration - Shift Hours</option>
                                            <option value="duration_minus_shift">Worked Duration - Shift Hours</option>
                                            <option value="not_applicable">OT Not Applicable</option>
                                        </select>
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
                                        <label className="form-label">Max OT (hrs)</label>
                                        <input type="number" step="0.5" className="form-input" value={form.maxOtHours} onChange={e => setForm({ ...form, maxOtHours: parseFloat(e.target.value) || 0 })} />
                                        <small style={{ fontSize: '10px', color: 'gray' }}>0 = no cap</small>
                                    </div>
                                </div>

                                {/* ── Continuous Late Rules ── */}
                                <div style={{ display: 'flex', gap: '20px', marginBottom: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                    <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <input type="checkbox" checked={form.markAbsentForLate} onChange={e => setForm({ ...form, markAbsentForLate: e.target.checked })} id="markAbsentForLate" />
                                        <label htmlFor="markAbsentForLate" style={{ fontSize: 13, cursor: 'pointer' }}>Mark absent after continuous lates</label>
                                    </div>
                                    {form.markAbsentForLate && (<>
                                        <div className="form-group" style={{ minWidth: 120 }}>
                                            <label className="form-label">After (days)</label>
                                            <input type="number" className="form-input" value={form.continuousLateDays} onChange={e => setForm({ ...form, continuousLateDays: parseInt(e.target.value) || 3 })} />
                                        </div>
                                        <div className="form-group" style={{ minWidth: 120 }}>
                                            <label className="form-label">Type</label>
                                            <select className="form-input" value={form.absentDayType} onChange={e => setForm({ ...form, absentDayType: e.target.value })}>
                                                <option value="full_day">Full Day Absent</option>
                                                <option value="half_day">Half Day Absent</option>
                                            </select>
                                        </div>
                                    </>)}
                                </div>

                                {/* ── Break Configuration ── */}
                                <label className="form-label" style={{ marginBottom: 8, fontWeight: 600 }}>Break Configuration</label>
                                <div style={{ display: 'flex', gap: '20px', marginBottom: 12, flexWrap: 'wrap' }}>
                                    <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <input type="checkbox" checked={form.break1Enabled} onChange={e => setForm({ ...form, break1Enabled: e.target.checked })} id="break1" />
                                        <label htmlFor="break1" style={{ fontSize: 13, cursor: 'pointer' }}>Break 1</label>
                                    </div>
                                    {form.break1Enabled && (<>
                                        <div className="form-group"><input type="time" className="form-input" value={form.break1Start} onChange={e => setForm({ ...form, break1Start: e.target.value })} /></div>
                                        <span style={{ alignSelf: 'center' }}>to</span>
                                        <div className="form-group"><input type="time" className="form-input" value={form.break1End} onChange={e => setForm({ ...form, break1End: e.target.value })} /></div>
                                    </>)}
                                    <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <input type="checkbox" checked={form.break2Enabled} onChange={e => setForm({ ...form, break2Enabled: e.target.checked })} id="break2" />
                                        <label htmlFor="break2" style={{ fontSize: 13, cursor: 'pointer' }}>Break 2</label>
                                    </div>
                                    {form.break2Enabled && (<>
                                        <div className="form-group"><input type="time" className="form-input" value={form.break2Start} onChange={e => setForm({ ...form, break2Start: e.target.value })} /></div>
                                        <span style={{ alignSelf: 'center' }}>to</span>
                                        <div className="form-group"><input type="time" className="form-input" value={form.break2End} onChange={e => setForm({ ...form, break2End: e.target.value })} /></div>
                                    </>)}
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
