import React, { useState, useEffect, Fragment } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../lib/api';
import dayjs from 'dayjs';
import { Download, Printer, Calendar, Clock, MapPin } from 'lucide-react';
import * as XLSX from 'xlsx';

const LocationCell = ({ location, address, onFetch }) => {
    if (!location || location === '-') return <span>-</span>;
    if (!location.includes(',')) return <span>{location}</span>;
    const [lat, lng] = location.split(',').map(s => s.trim());
    return (
        <div style={{ fontSize: 10 }}>
            {address ? ( <div title={location}>{address}</div> ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>{Number(lat).toFixed(4)}, {Number(lng).toFixed(4)}</span>
                    <button onClick={() => onFetch(lat, lng)} className="no-print" style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0 }} title="Get Address">📍</button>
                </div>
            )}
        </div>
    );
};

const DailyReport = ({ data, meta }) => {
    // Group by department
    const departments = {};
    data.forEach(emp => {
        if (!departments[emp.department]) departments[emp.department] = [];
        departments[emp.department].push(emp);
    });

    const stats = { present: 0, in: 0, absent: 0, leave: 0 };
    data.forEach(emp => {
        const day = emp.days[meta.startDate];
        if (day?.status === 'P') stats.present++;
        if (day?.in) stats.in++;
        if (day?.status === 'A') stats.absent++;
        if (day?.status === 'L' || day?.status === 'OL') stats.leave++;
    });

    return (
        <div className="report-container printable" style={{ background: 'white', color: 'black', padding: '10px', fontSize: '11px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
                <div>Report Date : {dayjs(meta.startDate).format('DD/MM/YYYY')}</div>
                <div style={{ fontWeight: 'bold', fontSize: 16 }}>Daily Performance Report</div>
                <div>Print Date : {dayjs().format('DD/MM/YYYY')}</div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, fontWeight: 'bold' }}>
                <div>Total Present : {stats.present}.00</div>
                <div>Total In : {stats.in}</div>
                <div>Total Absent : {stats.absent}.00</div>
                <div>Total Leave : {stats.leave}.00</div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #000' }}>
                <thead>
                    <tr style={{ borderBottom: '1px solid #000' }}>
                        <th style={{ border: '1px solid #000', padding: 4 }}>Emp.Code</th>
                        <th style={{ border: '1px solid #000', padding: 4 }}>Employee Name</th>
                        <th style={{ border: '1px solid #000', padding: 4 }}>Designation</th>
                        <th style={{ border: '1px solid #000', padding: 4 }}>Shift</th>
                        <th style={{ border: '1px solid #000', padding: 4 }}>Shift Time</th>
                        <th style={{ border: '1px solid #000', padding: 4 }}>In Time</th>
                        <th style={{ border: '1px solid #000', padding: 4 }}>Late Arrival</th>
                        <th style={{ border: '1px solid #000', padding: 4 }}>Out Time</th>
                        <th style={{ border: '1px solid #000', padding: 4 }}>Early Dept.</th>
                        <th style={{ border: '1px solid #000', padding: 4 }}>Work Hrs.</th>
                        <th style={{ border: '1px solid #000', padding: 4 }}>OT</th>
                        <th style={{ border: '1px solid #000', padding: 4 }}>Status</th>
                        <th style={{ border: '1px solid #000', padding: 4 }}>Remark</th>
                    </tr>
                </thead>
                <tbody>
                    {Object.entries(departments).map(([deptName, emps]) => (
                        <Fragment key={deptName}>
                            <tr style={{ background: '#f5f5f5', fontWeight: 'bold' }}>
                                <td colSpan={13} style={{ border: '1px solid #000', padding: '4px 8px' }}>Department : {deptName}</td>
                            </tr>
                            {emps.map(emp => {
                                const day = emp.days[meta.startDate];
                                return (
                                    <tr key={emp.id}>
                                        <td style={{ border: '1px solid #000', padding: 4, textAlign: 'center' }}>{emp.code}</td>
                                        <td style={{ border: '1px solid #000', padding: 4 }}>{emp.name}</td>
                                        <td style={{ border: '1px solid #000', padding: 4 }}>{emp.designation}</td>
                                        <td style={{ border: '1px solid #000', padding: 4, textAlign: 'center' }}>{day?.shift || '-'}</td>
                                        <td style={{ border: '1px solid #000', padding: 4, textAlign: 'center' }}>{day?.shiftStart ? `${day.shiftStart}-${day.shiftEnd}` : '-'}</td>
                                        <td style={{ border: '1px solid #000', padding: 4, textAlign: 'center' }}>{day?.in || ''}</td>
                                        <td style={{ border: '1px solid #000', padding: 4, textAlign: 'center' }}>{day?.late || ''}</td>
                                        <td style={{ border: '1px solid #000', padding: 4, textAlign: 'center' }}>{day?.out || ''}</td>
                                        <td style={{ border: '1px solid #000', padding: 4, textAlign: 'center' }}>{day?.early || ''}</td>
                                        <td style={{ border: '1px solid #000', padding: 4, textAlign: 'center' }}>{day?.workHrs || ''}</td>
                                        <td style={{ border: '1px solid #000', padding: 4, textAlign: 'center' }}>{day?.ot !== '00:00' ? day?.ot : ''}</td>
                                        <td style={{ border: '1px solid #000', padding: 4, textAlign: 'center', fontWeight: 'bold', color: day?.status === 'A' ? 'red' : 'inherit' }}>{day?.status || ''}</td>
                                        <td style={{ border: '1px solid #000', padding: 4 }}></td>
                                    </tr>
                                );
                            })}
                        </Fragment>
                    ))}
                </tbody>
            </table>
            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                <div>This Report is Generated Automated by System</div>
                <div>Page No 1 of 1</div>
            </div>
        </div>
    );
};

const MonthlyReport = ({ data, meta }) => {
    return (
        <div className="report-container printable" style={{ background: 'white', color: 'black', padding: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 12 }}>
                <div>Report from : {dayjs(meta.startDate).format('DD-MM-YYYY')} To : {dayjs(meta.endDate).format('DD-MM-YYYY')}</div>
                <div style={{ fontWeight: 'bold', fontSize: 16 }}>Monthly Performance Report</div>
                <div>Print Date : {dayjs().format('DD/MM/YYYY')}</div>
            </div>

            {data.map(emp => {
                const dayKeys = Object.keys(emp.days).sort();
                return (
                    <div key={emp.id} style={{ marginBottom: 30, border: '1px solid #000', pageBreakInside: 'avoid' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 3fr 1fr', background: '#f5f5f5', borderBottom: '1px solid #000', fontSize: 11, fontWeight: 'bold' }}>
                            <div style={{ padding: 4, borderRight: '1px solid #000' }}>Dept:- {emp.department}</div>
                            <div style={{ padding: 4, borderRight: '1px solid #000' }}>Desig : {emp.designation}</div>
                            <div style={{ padding: 4 }}>Attendance Month Of:- {dayjs(meta.startDate).format('MMM YYYY')}</div>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #000', background: '#eee' }}>
                                    <th style={{ borderRight: '1px solid #000', padding: 4, width: 80 }}>EmpCode</th>
                                    <th style={{ borderRight: '1px solid #000', padding: 4, width: 120 }}>Name</th>
                                    <th style={{ borderRight: '1px solid #000', padding: 4 }}>Present</th>
                                    <th style={{ borderRight: '1px solid #000', padding: 4 }}>HL</th>
                                    <th style={{ borderRight: '1px solid #000', padding: 4 }}>WO</th>
                                    <th style={{ borderRight: '1px solid #000', padding: 4 }}>Absent</th>
                                    <th style={{ borderRight: '1px solid #000', padding: 4 }}>Leave</th>
                                    <th style={{ borderRight: '1px solid #000', padding: 4 }}>PaidDays</th>
                                    <th style={{ borderRight: '1px solid #000', padding: 4 }}>Early Going</th>
                                    <th style={{ borderRight: '1px solid #000', padding: 4 }}>LateHrs.</th>
                                    <th style={{ borderRight: '1px solid #000', padding: 4 }}>WorkHrs.</th>
                                    <th style={{ padding: 4 }}>OvTim</th>
                                </tr>
                                <tr>
                                    <td style={{ borderRight: '1px solid #000', padding: 4, textAlign: 'center' }}>{emp.code}</td>
                                    <td style={{ borderRight: '1px solid #000', padding: 4 }}>{emp.name}</td>
                                    <td style={{ borderRight: '1px solid #000', padding: 4, textAlign: 'center' }}>{emp.stats.present}</td>
                                    <td style={{ borderRight: '1px solid #000', padding: 4, textAlign: 'center' }}>0</td>
                                    <td style={{ borderRight: '1px solid #000', padding: 4, textAlign: 'center' }}>{emp.stats.wo}</td>
                                    <td style={{ borderRight: '1px solid #000', padding: 4, textAlign: 'center' }}>{emp.stats.absent}</td>
                                    <td style={{ borderRight: '1px solid #000', padding: 4, textAlign: 'center' }}>{emp.stats.leave}</td>
                                    <td style={{ borderRight: '1px solid #000', padding: 4, textAlign: 'center' }}>{emp.stats.present + emp.stats.wo}</td>
                                    <td style={{ borderRight: '1px solid #000', padding: 4, textAlign: 'center' }}>-</td>
                                    <td style={{ borderRight: '1px solid #000', padding: 4, textAlign: 'center' }}>{emp.stats.totalLateHrs}</td>
                                    <td style={{ borderRight: '1px solid #000', padding: 4, textAlign: 'center' }}>{emp.stats.totalWorkHrs}</td>
                                    <td style={{ padding: 4, textAlign: 'center' }}>{emp.stats.totalOtHrs}</td>
                                </tr>
                            </thead>
                        </table>
                        
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 8, textAlign: 'center' }}>
                                <tbody>
                                    <tr style={{ background: '#eee', borderTop: '1px solid #000' }}>
                                        <td style={{ fontWeight: 'bold', borderRight: '1px solid #000', width: 60 }}>Date</td>
                                        {dayKeys.map(k => <td key={k} style={{ borderRight: '1px solid #000', fontWeight: 'bold' }}>{dayjs(k).date()}</td>)}
                                    </tr>
                                    <tr style={{ height: 20 }}>
                                        <td style={{ fontWeight: 'bold', borderRight: '1px solid #000' }}>Arrived</td>
                                        {dayKeys.map(k => <td key={k} style={{ borderRight: '1px solid #000' }}>{emp.days[k]?.in || ''}</td>)}
                                    </tr>
                                    <tr style={{ height: 20 }}>
                                        <td style={{ fontWeight: 'bold', borderRight: '1px solid #000' }}>Departure</td>
                                        {dayKeys.map(k => <td key={k} style={{ borderRight: '1px solid #000' }}>{emp.days[k]?.out || ''}</td>)}
                                    </tr>
                                    <tr style={{ height: 20 }}>
                                        <td style={{ fontWeight: 'bold', borderRight: '1px solid #000' }}>Working</td>
                                        {dayKeys.map(k => <td key={k} style={{ borderRight: '1px solid #000' }}>{emp.days[k]?.workHrs || ''}</td>)}
                                    </tr>
                                    <tr style={{ height: 20 }}>
                                        <td style={{ fontWeight: 'bold', borderRight: '1px solid #000' }}>O.Time</td>
                                        {dayKeys.map(k => <td key={k} style={{ borderRight: '1px solid #000' }}>{emp.days[k]?.ot !== '00:00' ? emp.days[k]?.ot : ''}</td>)}
                                    </tr>
                                    <tr style={{ height: 20 }}>
                                        <td style={{ fontWeight: 'bold', borderRight: '1px solid #000' }}>Status</td>
                                        {dayKeys.map(k => <td key={k} style={{ borderRight: '1px solid #000', fontWeight: 'bold', color: emp.days[k]?.status === 'A' ? 'red' : 'inherit' }}>{emp.days[k]?.status}</td>)}
                                    </tr>
                                    <tr style={{ height: 20 }}>
                                        <td style={{ fontWeight: 'bold', borderRight: '1px solid #000' }}>Shift</td>
                                        {dayKeys.map(k => <td key={k} style={{ borderRight: '1px solid #000' }}>{emp.days[k]?.shift}</td>)}
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default function Reports() {
    const location = useLocation();
    const [activeTab, setActiveTab] = useState('performance');
    
    // Determine report type from URL
    const getInitialReportType = () => {
        if (location.pathname.includes('/daily')) return 'daily';
        if (location.pathname.includes('/weekly')) return 'weekly';
        if (location.pathname.includes('/monthly')) return 'monthly';
        return 'monthly';
    };

    const [reportType, setReportType] = useState(getInitialReportType());

    // Sync reportType when URL changes
    useEffect(() => {
        setReportType(getInitialReportType());
    }, [location.pathname]);

    // Department filter (shared)
    const [departments, setDepartments] = useState([]);
    const [departmentId, setDepartmentId] = useState('');

    // Performance State
    const [selectedDate, setSelectedDate] = useState(dayjs().format('YYYY-MM-DD'));
    const [month, setMonth] = useState(dayjs().month() + 1);
    const [year, setYear] = useState(dayjs().year());
    const [gridData, setGridData] = useState(null);

    // Approvals State
    const [approvalStart, setApprovalStart] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
    const [approvalEnd, setApprovalEnd] = useState(dayjs().endOf('month').format('YYYY-MM-DD'));
    const [approvalStatus, setApprovalStatus] = useState('');
    const [approvalData, setApprovalData] = useState(null);
    const [addresses, setAddresses] = useState({}); // { id: 'Address String' }
    const [fetchingAddresses, setFetchingAddresses] = useState(false);

    const [loading, setLoading] = useState(false);

    // Load departments once
    useEffect(() => {
        api.get('/departments').then(res => setDepartments(res.data || []));
    }, []);

    // Initial Load
    useEffect(() => {
        if (activeTab === 'performance') loadGridData();
        else loadApprovalData();
    }, [activeTab, reportType, selectedDate, month, year, departmentId, approvalStart, approvalEnd, approvalStatus]);

    const loadGridData = () => {
        setLoading(true);
        let endpoint = '/reports/grid';
        let params = {};

        if (reportType === 'monthly') {
            endpoint = '/reports/monthly';
            params = { month, year };
        } else if (reportType === 'daily') {
            params = { startDate: selectedDate, endDate: selectedDate };
        } else if (reportType === 'weekly') {
            const start = dayjs(selectedDate).startOf('week');
            params = { startDate: start.format('YYYY-MM-DD'), endDate: start.add(6, 'day').format('YYYY-MM-DD') };
        }

        if (departmentId) params.departmentId = departmentId;

        api.get(endpoint, { params })
            .then(res => { setGridData(res.data); setLoading(false); })
            .catch(() => { alert('Failed to load report'); setLoading(false); });
    };

    const loadApprovalData = () => {
        setLoading(true);
        const params = { startDate: approvalStart, endDate: approvalEnd };
        if (approvalStatus) params.status = approvalStatus;
        if (departmentId) params.departmentId = departmentId;
        api.get('/reports/approvals', { params })
            .then(res => { setApprovalData(res.data); setLoading(false); })
            .catch(() => { alert('Failed to load approvals'); setLoading(false); });
    };

    const fetchOneAddress = async (id, lat, lng) => {
        if (addresses[id]) return;
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
            const data = await res.json();
            const addr = data.address;
            const shortAddr = [addr.road, addr.suburb, addr.city, addr.state].filter(Boolean).join(', ');
            setAddresses(prev => ({ ...prev, [id]: shortAddr || data.display_name }));
        } catch (err) {
            setAddresses(prev => ({ ...prev, [id]: 'Addr Error' }));
        }
    };

    const fetchAllAddresses = async () => {
        if (!approvalData) return;
        setFetchingAddresses(true);
        const toFetch = approvalData.filter(r => r.location && r.location.includes(',') && !addresses[r.id]);
        for (const row of toFetch) {
            const [lat, lng] = row.location.split(',').map(s => s.trim());
            await fetchOneAddress(row.id, lat, lng);
            await new Promise(r => setTimeout(r, 1100));
        }
        setFetchingAddresses(false);
    };

    const handleExportExcel = () => {
        if (activeTab === 'performance') exportGridExcel();
        else exportApprovalsExcel();
    };

    const exportGridExcel = () => {
        if (!gridData || !gridData.data) return;
        const aoa = [];
        const title = reportType === 'monthly' 
            ? `Monthly Performance Report - ${gridData.meta.monthName} ${gridData.meta.year}`
            : `${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Performance Report (${gridData.meta.startDate} to ${gridData.meta.endDate})`;
        
        aoa.push([title]);
        aoa.push([]);

        const dayKeys = Object.keys(gridData.data[0].days).sort();
        const headerRow = ['Name', 'Code', 'Dept', 'Metric'];
        dayKeys.forEach(k => headerRow.push(dayjs(k).format('DD/MM')));
        aoa.push(headerRow);

        gridData.data.forEach(emp => {
            const rowIn = [emp.name, emp.code, emp.department, 'IN'];
            dayKeys.forEach(k => rowIn.push(emp.days[k]?.in || ''));
            aoa.push(rowIn);

            const rowOut = ['', '', '', 'OUT'];
            dayKeys.forEach(k => rowOut.push(emp.days[k]?.out || ''));
            aoa.push(rowOut);

            const rowShift = ['', '', '', 'Shift'];
            dayKeys.forEach(k => rowShift.push(emp.days[k]?.shift || ''));
            aoa.push(rowShift);

            const rowStatus = ['', '', '', 'Status'];
            dayKeys.forEach(k => rowStatus.push(emp.days[k]?.status || ''));
            aoa.push(rowStatus);

            const rowSum = [`P: ${emp.stats.present}, A: ${emp.stats.absent}, Work: ${emp.stats.totalWorkHrs}, OT: ${emp.stats.totalOtHrs || '00:00'}`, '', '', ''];
            aoa.push(rowSum);
            aoa.push([]);
        });

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 8 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Attendance");
        const deptSuffix = departmentId ? `_${departments.find(d => d.id == departmentId)?.name || departmentId}` : '';
        XLSX.writeFile(wb, `Performance_Report_${reportType}_${gridData.meta.startDate}${deptSuffix}.xlsx`);
    };

    const exportApprovalsExcel = () => {
        if (!approvalData) return;
        const exportData = approvalData.map(d => ({ ...d, location: addresses[d.id] || d.location }));
        const ws = XLSX.utils.json_to_sheet(exportData);
        ws['!cols'] = [{ wch: 12 }, { wch: 20 }, { wch: 10 }, { wch: 15 }, { wch: 8 }, { wch: 8 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 20 }, { wch: 25 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Approvals");
        const deptSuffix = departmentId ? `_${departments.find(d => d.id == departmentId)?.name || departmentId}` : '';
        XLSX.writeFile(wb, `Approvals_Report_${approvalStart}_to_${approvalEnd}${deptSuffix}.xlsx`);
    };

    const handlePrint = () => window.print();

    return (
        <div>
            <div className="no-print" style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h2 style={{ fontSize: 22, fontWeight: 700 }}>Reports</h2>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <button className={`btn ${activeTab === 'performance' ? 'btn-primary' : 'btn-ghost'} `} onClick={() => setActiveTab('performance')}>Performance Grid</button>
                        <button className={`btn ${activeTab === 'approvals' ? 'btn-primary' : 'btn-ghost'} `} onClick={() => setActiveTab('approvals')}>Approvals / Day Wise</button>
                    </div>
                </div>

                <div className="card" style={{ padding: 16, display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                        <select value={departmentId} onChange={e => setDepartmentId(e.target.value)} className="form-input" style={{ width: 180 }}>
                            <option value="">All Departments</option>
                            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>

                        {activeTab === 'performance' ? (
                            <>
                                <select value={reportType} onChange={e => setReportType(e.target.value)} className="form-input" style={{ width: 120 }}>
                                    <option value="daily">Daily</option>
                                    <option value="weekly">Weekly</option>
                                    <option value="monthly">Monthly</option>
                                </select>

                                {reportType === 'monthly' ? (
                                    <>
                                        <select value={month} onChange={e => setMonth(e.target.value)} className="form-input" style={{ width: 140 }}>
                                            {Array.from({ length: 12 }, (_, i) => (
                                                <option key={i + 1} value={i + 1}>{dayjs().month(i).format('MMMM')}</option>
                                            ))}
                                        </select>
                                        <select value={year} onChange={e => setYear(e.target.value)} className="form-input" style={{ width: 100 }}>
                                            {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
                                        </select>
                                    </>
                                ) : (
                                    <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="form-input" />
                                )}
                            </>
                        ) : (
                            <>
                                <input type="date" value={approvalStart} onChange={e => setApprovalStart(e.target.value)} className="form-input" />
                                <span style={{ color: 'var(--text-secondary)' }}>to</span>
                                <input type="date" value={approvalEnd} onChange={e => setApprovalEnd(e.target.value)} className="form-input" />
                                <select value={approvalStatus} onChange={e => setApprovalStatus(e.target.value)} className="form-input" style={{ width: 140 }}>
                                    <option value="">All Status</option>
                                    <option value="approved">Approved</option>
                                    <option value="rejected">Rejected</option>
                                    <option value="pending">Pending</option>
                                </select>
                                <button
                                    className="btn btn-ghost"
                                    onClick={fetchAllAddresses}
                                    disabled={fetchingAddresses || !approvalData}
                                    title="Fetch addresses for all records (slow)"
                                >
                                    {fetchingAddresses ? 'Fetching...' : '📍 Fetch Addresses'}
                                </button>
                            </>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <button className="btn btn-ghost" onClick={handleExportExcel} disabled={loading}><Download size={16} /> Excel</button>
                        <button className="btn btn-primary" onClick={handlePrint} disabled={loading}><Printer size={16} /> Print</button>
                    </div>
                </div>
            </div>

            {loading && <div style={{ padding: 40, textAlign: 'center' }}>Loading Report...</div>}

            {!loading && activeTab === 'performance' && gridData && (
                <>
                    {reportType === 'daily' ? (
                        <DailyReport data={gridData.data} meta={gridData.meta} />
                    ) : reportType === 'monthly' ? (
                        <MonthlyReport data={gridData.data} meta={gridData.meta} />
                    ) : (
                        <div className="report-container printable" style={{ background: 'white', color: 'black', padding: '20px' }}>
                            <div style={{ textAlign: 'center', marginBottom: 10 }} className="print-header">
                                <h3>{reportType.toUpperCase()} Performance Report</h3>
                                <p style={{ marginBottom: 0 }}>Range: {gridData.meta.startDate} to {gridData.meta.endDate}</p>
                            </div>

                            {gridData.data.map((emp) => {
                                const dayKeys = Object.keys(emp.days).sort();
                                return (
                                    <div key={emp.id} className="report-employee-row" style={{ marginBottom: 15, border: '2px solid #000', pageBreakInside: 'avoid' }}>
                                        <div style={{ display: 'flex' }}>
                                            <div style={{ width: 140, borderRight: '2px solid #000', padding: '4px 6px', fontSize: 9, display: 'flex', flexDirection: 'column', justifyContent: 'center', lineHeight: 1.2 }}>
                                                <div style={{ fontWeight: 'bold', fontSize: 10, wordBreak: 'break-word', lineHeight: 1.1, marginBottom: 4 }}>{emp.name}</div>
                                                <div style={{ marginBottom: 1 }}>Code: {emp.code}</div>
                                                <div style={{ marginBottom: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Dept: {emp.department}</div>
                                                <div style={{ marginTop: 4, borderTop: '1px solid #000', paddingTop: 4, fontSize: 8.5 }}>
                                                    <div>P: {emp.stats.present}, A: {emp.stats.absent}, WO: {emp.stats.wo}</div>
                                                    <div>Work: {emp.stats.totalWorkHrs}</div>
                                                    {emp.stats.totalOtHrs !== '00:00' && <div>OT: {emp.stats.totalOtHrs}</div>}
                                                </div>
                                            </div>

                                            <div style={{ flex: 1, overflowX: 'auto' }}>
                                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9, textAlign: 'center', tableLayout: 'fixed' }}>
                                                    <thead>
                                                        <tr style={{ background: '#eee', borderBottom: '1px solid #000', height: 18 }}>
                                                            <th style={{ borderRight: '1px solid #ccc', width: 45, fontSize: 8 }}>Metric</th>
                                                            {dayKeys.map(k => {
                                                                const d = dayjs(k);
                                                                const isSunday = d.day() === 0;
                                                                return (
                                                                    <th key={k} style={{ borderRight: '1px solid #ccc', fontSize: 7, color: isSunday ? 'red' : '#000' }}>
                                                                        <div>{d.format('ddd')}</div>
                                                                        <div>{d.date()}</div>
                                                                    </th>
                                                                );
                                                            })}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {['IN', 'OUT', 'Shift', 'Late', 'OT', 'Status'].map((metric) => (
                                                            <tr key={metric} style={{ height: 18 }}>
                                                                <td style={{ fontWeight: 'bold', borderRight: '1px solid #ccc', background: '#f0f0f0' }}>{metric}</td>
                                                                {dayKeys.map(k => {
                                                                    const day = emp.days[k];
                                                                    let content = '';
                                                                    let style = { borderRight: '1px solid #ccc', fontSize: 8, background: day?.shift === 'OFF' ? '#ddd' : '#fff' };

                                                                    if (metric === 'IN') content = day?.in || '';
                                                                    if (metric === 'OUT') content = day?.out || '';
                                                                    if (metric === 'Shift') content = day?.shift || '';
                                                                    if (metric === 'Late') content = day?.late === '00:00' ? '' : day?.late;
                                                                    if (metric === 'OT') content = day?.ot === '00:00' ? '' : day?.ot;
                                                                    if (metric === 'Status') {
                                                                        content = day?.status;
                                                                        if (content === 'A') style.color = 'red';
                                                                        if (content === 'P') style.color = 'green';
                                                                        if (content === 'WO') style.color = 'blue';
                                                                        style.fontWeight = 'bold';
                                                                    }
                                                                    return <td key={k} style={style}>{content}</td>;
                                                                })}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            )}

            {!loading && activeTab === 'approvals' && approvalData && (
                <div className="report-container printable" style={{ background: 'white', color: 'black', padding: '20px' }}>
                    <div style={{ textAlign: 'center', marginBottom: 20 }} className="print-header">
                        <h3>Day Wise Approval Report</h3>
                        <p>From: {approvalStart} To: {approvalEnd}</p>
                    </div>

                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead>
                            <tr style={{ background: '#eee', borderBottom: '2px solid #000' }}>
                                <th style={{ padding: 8, textAlign: 'left', border: '1px solid #ccc' }}>Date</th>
                                <th style={{ padding: 8, textAlign: 'left', border: '1px solid #ccc' }}>Employee</th>
                                <th style={{ padding: 8, textAlign: 'left', border: '1px solid #ccc' }}>Time (In/Out)</th>
                                <th style={{ padding: 8, textAlign: 'left', border: '1px solid #ccc', width: 150 }}>Location</th>
                                <th style={{ padding: 8, textAlign: 'left', border: '1px solid #ccc' }}>Status</th>
                                <th style={{ padding: 8, textAlign: 'left', border: '1px solid #ccc' }}>Remarks</th>
                            </tr>
                        </thead>
                        <tbody>
                            {approvalData.map(row => (
                                <tr key={row.id}>
                                    <td style={{ padding: 6, border: '1px solid #ccc' }}>{row.date}</td>
                                    <td style={{ padding: 6, border: '1px solid #ccc' }}>
                                        <div style={{ fontWeight: 'bold' }}>{row.employeeName}</div>
                                        <div style={{ fontSize: 9, color: 'gray' }}>{row.employeeCode}</div>
                                    </td>
                                    <td style={{ padding: 6, border: '1px solid #ccc' }}>{row.inTime} - {row.outTime}</td>
                                    <td style={{ padding: 6, border: '1px solid #ccc', fontSize: 9 }}>
                                        <LocationCell location={row.location} address={addresses[row.id]} onFetch={(lat, lng) => fetchOneAddress(row.id, lat, lng)} />
                                    </td>
                                    <td style={{ padding: 6, border: '1px solid #ccc' }}>
                                        <span style={{ fontWeight: 'bold', color: row.status === 'approved' ? 'green' : row.status === 'rejected' ? 'red' : 'orange' }}>{row.status.toUpperCase()}</span>
                                    </td>
                                    <td style={{ padding: 6, border: '1px solid #ccc' }}>{row.remarks}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <style>{`
@media print {
    @page { size: landscape; margin: 3mm; }
    html, body, #root, .app-layout, .main-content, .content-area {
        height: auto !important;
        overflow: visible !important;
        display: block !important;
    }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: white !important; }
    .printable, .printable * { color: #000 !important; }
    .no-print, .sidebar, .top-bar { display: none !important; }
    .report-employee-row { break-inside: avoid; border: 1px solid #000 !important; }
}
`}</style>
        </div>
    );
}
