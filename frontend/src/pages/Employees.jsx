import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Plus, Edit, Trash2, Search, Key, UserPlus } from 'lucide-react';

export default function Employees() {
    const [employees, setEmployees] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [designations, setDesignations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [form, setForm] = useState({ employeeCode: '', firstName: '', lastName: '', email: '', phone: '', gender: 'male', departmentId: '', designationId: '', joiningDate: '', password: '', category: 'confirmed', leaveStartMonth: '' });

    const loadData = () => {
        Promise.all([
            api.get('/employees', { params: { search, limit: 100 } }),
            api.get('/departments'),
            api.get('/designations'),
        ]).then(([empRes, deptRes, desigRes]) => {
            setEmployees(empRes.data.data || []);
            setDepartments(deptRes.data || []);
            setDesignations(desigRes.data || []);
            setLoading(false);
        }).catch(() => setLoading(false));
    };

    useEffect(() => { loadData(); }, [search]);

    const syncUser = async (uuid) => {
        try {
            await api.post(`/devices/sync-user-all/${uuid}`);
            alert('Success: User sync command queued for all active devices.');
        } catch (err) { alert('Failed to queue sync command'); }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            // Clean payload
            const payload = { ...form };
            if (payload.departmentId === '') payload.departmentId = null;
            if (payload.designationId === '') payload.designationId = null;

            if (editItem) {
                await api.put(`/employees/${editItem.uuid}`, payload);
            } else {
                await api.post('/employees', { ...payload, createUser: true, password: form.password || form.employeeCode });
            }
            setShowModal(false);
            setEditItem(null);
            setForm({ employeeCode: '', firstName: '', lastName: '', email: '', phone: '', gender: 'male', departmentId: '', designationId: '', joiningDate: '', password: '', category: 'confirmed', leaveStartMonth: '' });
            loadData();
        } catch (err) {
            alert(err.response?.data?.error || err.response?.data?.message || 'Failed to save');
        }
    };

    const handleEdit = (emp) => {
        setEditItem(emp);
        setForm({
            employeeCode: emp.employeeCode, firstName: emp.name?.split(' ')[0] || '', lastName: emp.name?.split(' ').slice(1).join(' ') || '',
            email: emp.email || '', phone: emp.phone || '', gender: emp.gender || 'male',
            departmentId: emp.departmentId || '', designationId: emp.designationId || '',
            joiningDate: emp.joiningDate?.split('T')[0] || '', password: '',
            category: emp.category || 'confirmed', leaveStartMonth: emp.leaveStartMonth || '',
        });
        setShowModal(true);
    };

    const handleDelete = async (uuid) => {
        if (!confirm('Delete this employee?')) return;
        try { await api.delete(`/employees/${uuid}`); loadData(); } catch (err) { alert('Failed to delete'); }
    };

    const generateUsers = async () => {
        if (!confirm('This will create portal accounts for all employees who do not have one. The username and password will be their Employee Code. Continue?')) return;
        try {
            const res = await api.post('/employees/generate-users');
            alert(res.data.message);
        } catch (err) { alert('Failed to generate users'); }
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ fontSize: '22px', fontWeight: 700 }}>Employees</h2>
                <div>
                    <button className="btn btn-ghost btn-sm" onClick={generateUsers} title="Create portal accounts for employees" style={{ marginRight: '8px', border: '1px solid var(--border)' }}>
                        <Key size={16} style={{ marginRight: '6px' }} /> Enable Portal Access
                    </button>
                    <button className="btn btn-primary" onClick={() => { setEditItem(null); setForm({ employeeCode: '', firstName: '', lastName: '', email: '', phone: '', gender: 'male', departmentId: '', designationId: '', joiningDate: '', password: '', category: 'confirmed', leaveStartMonth: '' }); setShowModal(true); }}>
                        <Plus size={16} /> Add Employee
                    </button>
                </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
                <div style={{ position: 'relative', maxWidth: '320px' }}>
                    <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input className="form-input" style={{ paddingLeft: '36px' }} placeholder="Search by name, code, phone..." value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
            </div>

            <div className="card">
                <table className="data-table">
                    <thead><tr>
                        <th>Code</th><th>Name</th><th>Department</th><th>Designation</th><th>Phone</th><th>Status</th><th>Actions</th>
                    </tr></thead>
                    <tbody>
                        {employees.map(emp => (
                            <tr key={emp.uuid}>
                                <td><strong>{emp.employeeCode}</strong></td>
                                <td>{emp.name}</td>
                                <td>{emp.department || '-'}</td>
                                <td>{emp.designation || '-'}</td>
                                <td>{emp.phone || '-'}</td>
                                <td><span className={`badge badge-${emp.status === 'active' ? 'success' : 'danger'}`}>{emp.status}</span></td>
                                <td style={{ display: 'flex', gap: '6px' }}>
                                    <button className="btn btn-ghost btn-sm" onClick={() => syncUser(emp.uuid)} title="Push to Biometric Devices" style={{ color: 'var(--primary)' }}><UserPlus size={14} /></button>
                                    <button className="btn btn-ghost btn-sm" onClick={() => handleEdit(emp)}><Edit size={14} /></button>
                                    <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(emp.uuid)}><Trash2 size={14} /></button>
                                </td>
                            </tr>
                        ))}
                        {employees.length === 0 && <tr><td colSpan="7" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No employees found</td></tr>}
                    </tbody>
                </table>
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{editItem ? 'Edit Employee' : 'Add Employee'}</h3>
                            <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>✕</button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="modal-body">
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Employee Code *</label>
                                        <input className="form-input" value={form.employeeCode} onChange={e => setForm({ ...form, employeeCode: e.target.value })} required />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Gender</label>
                                        <select className="form-select" value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}>
                                            <option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">First Name *</label>
                                        <input className="form-input" value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} required />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Last Name</label>
                                        <input className="form-input" value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} />
                                    </div>
                                </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Email</label>
                                        <input className="form-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Phone</label>
                                        <input className="form-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
                                    </div>
                                </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Department</label>
                                        <select className="form-select" value={form.departmentId} onChange={e => setForm({ ...form, departmentId: e.target.value ? parseInt(e.target.value) : '' })}>
                                            <option value="">Select</option>
                                            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Designation</label>
                                        <select className="form-select" value={form.designationId} onChange={e => setForm({ ...form, designationId: e.target.value ? parseInt(e.target.value) : '' })}>
                                            <option value="">Select</option>
                                            {designations
                                                .filter(d => !form.departmentId || d.departmentId === parseInt(form.departmentId) || !d.departmentId)
                                                .map(d => <option key={d.id} value={d.id}>{d.name}</option>)
                                            }
                                        </select>
                                    </div>
                                </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Joining Date</label>
                                        <input className="form-input" type="date" value={form.joiningDate} onChange={e => setForm({ ...form, joiningDate: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Category</label>
                                        <select className="form-select" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                                            <option value="confirmed">Confirmed</option>
                                            <option value="time_scale">Time-Scale</option>
                                            <option value="contract">Contract</option>
                                            <option value="adhoc">Adhoc</option>
                                            <option value="part_time">Part-Time</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Leave Start Month</label>
                                    <select className="form-select" value={form.leaveStartMonth} onChange={e => setForm({ ...form, leaveStartMonth: e.target.value ? parseInt(e.target.value) : '' })}>
                                        <option value="">Not Set</option>
                                        <option value="1">January</option><option value="2">February</option><option value="3">March</option>
                                        <option value="4">April</option><option value="5">May</option><option value="6">June</option>
                                        <option value="7">July</option><option value="8">August</option><option value="9">September</option>
                                        <option value="10">October</option><option value="11">November</option><option value="12">December</option>
                                    </select>
                                </div>
                                {!editItem && (
                                    <div className="form-group">
                                        <label className="form-label">Password (default = employee code)</label>
                                        <input className="form-input" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Leave blank to use employee code" />
                                    </div>
                                )}
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">{editItem ? 'Update' : 'Create'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
