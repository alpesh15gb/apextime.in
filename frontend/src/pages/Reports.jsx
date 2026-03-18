import React, { useState, useEffect, Fragment } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
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

const ApexReportMonthly = ({ data, meta }) => {
    const { user } = useAuth();
    // Helper to sum durations (HH:mm)
    const sumDurations = (durations) => {
        let totalMins = 0;
        durations.forEach(d => {
            if (!d || d === '00:00' || d === '-') return;
            const [h, m] = d.split(':').map(Number);
            totalMins += (h * 60) + m;
        });
        const hours = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    };

    return (
        <div className="report-container printable apex-report" style={{ background: 'white', color: 'black', padding: '20px', fontFamily: 'monospace', fontSize: '12px' }}>
            {data.map((emp, empIdx) => {
                const dayKeys = Object.keys(emp.days).sort();
                const totals = {
                    gross: sumDurations(dayKeys.map(k => emp.days[k]?.workHrs)),
                    extra: sumDurations(dayKeys.map(k => emp.days[k]?.ot)),
                    less: sumDurations(dayKeys.map(k => emp.days[k]?.early)),
                    net: '00:00' // Will calc net manually if needed
                };

                return (
                    <div key={emp.id} style={{ marginBottom: 40, pageBreakAfter: 'always' }}>
                        {/* Header */}
                        <div style={{ textAlign: 'center', position: 'relative', marginBottom: 20 }}>
                            <div style={{ position: 'absolute', right: 0, top: 0 }}>Page {empIdx + 1} of {data.length}</div>
                            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 'bold', textTransform: 'uppercase' }}>{user?.tenant?.name || 'APEXTIME.IN'}</h2>
                            <div style={{ fontSize: 14, fontWeight: 'bold' }}>Work Hours Summary From {dayjs(meta.startDate).format('DD/MM/YYYY')} To {dayjs(meta.endDate).format('DD/MM/YYYY')}</div>
                            
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 15, fontSize: 11, borderBottom: '1px solid #000', paddingBottom: 5 }}>
                                <div style={{ textAlign: 'left' }}>
                                    <div>Run by: System Admin</div>
                                    <div>Date: {dayjs().format('DD/MM/YYYY')}</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div>Date: {dayjs().format('DD/MM/YYYY')}</div>
                                    <div>Time: {dayjs().format('HH:mm')}</div>
                                </div>
                            </div>
                        </div>

                        {/* Employee Title */}
                        <div style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 5 }}>{emp.code} - {emp.name}</div>

                        <table style={{ width: '100%', borderCollapse: 'collapse', borderTop: '1px solid #000' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #000' }}>
                                    <th style={{ textAlign: 'left', padding: '4px 2px' }}>Date</th>
                                    <th style={{ textAlign: 'center', padding: '4px 2px' }}>First IN</th>
                                    <th style={{ textAlign: 'center', padding: '4px 2px' }}>Last OUT</th>
                                    <th style={{ textAlign: 'center', padding: '4px 2px' }}>Gross Hours</th>
                                    <th style={{ textAlign: 'center', padding: '4px 2px' }}>Extra Hours</th>
                                    <th style={{ textAlign: 'center', padding: '4px 2px' }}>Net-Work Hours</th>
                                    <th style={{ textAlign: 'center', padding: '4px 2px' }}>Total Overtime</th>
                                    <th style={{ textAlign: 'center', padding: '4px 2px' }}>Less Hours</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dayKeys.map(k => {
                                    const day = emp.days[k];
                                    const isHoliday = day?.status === 'WO' || day?.status === 'OFF';
                                    return (
                                        <tr key={k} style={{ color: isHoliday ? '#666' : 'black' }}>
                                            <td style={{ padding: '2px' }}>{dayjs(k).format('DD/MM/YYYY')}</td>
                                            <td style={{ textAlign: 'center' }}>{day?.in || ''}</td>
                                            <td style={{ textAlign: 'center' }}>{day?.out || ''}</td>
                                            <td style={{ textAlign: 'center' }}>{day?.workHrs !== '00:00' ? day?.workHrs : ''}</td>
                                            <td style={{ textAlign: 'center' }}>{day?.ot !== '00:00' ? day?.ot : ''}</td>
                                            <td style={{ textAlign: 'center' }}>{day?.workHrs !== '00:00' ? day?.workHrs : ''}</td>
                                            <td style={{ textAlign: 'center' }}>{day?.ot !== '00:00' ? day?.ot : ''}</td>
                                            <td style={{ textAlign: 'center' }}>{day?.early !== '00:00' ? day?.early : ''}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                <tr style={{ borderTop: '2px solid #000', fontWeight: 'bold' }}>
                                    <td colSpan={3} style={{ textAlign: 'right', padding: '8px' }}>Total</td>
                                    <td style={{ textAlign: 'center' }}>{totals.gross}</td>
                                    <td style={{ textAlign: 'center' }}>{totals.extra}</td>
                                    <td style={{ textAlign: 'center' }}>{totals.gross}</td>
                                    <td style={{ textAlign: 'center' }}>{totals.extra}</td>
                                    <td style={{ textAlign: 'center' }}>{totals.less}</td>
                                </tr>
                            </tfoot>
                        </table>
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
        if (location.pathname.includes('/apex-monthly')) return 'apex_monthly';
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

        if (reportType === 'monthly' || reportType === 'apex_monthly') {
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
                                <select value={reportType} onChange={e => setReportType(e.target.value)} className="form-input" style={{ width: 150 }}>
                                    <option value="daily">Daily</option>
                                    <option value="weekly">Weekly</option>
                                    <option value="monthly">Monthly</option>
                                    <option value="apex_monthly">Apex Monthly</option>
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
                    ) : reportType === 'apex_monthly' ? (
                        <ApexReportMonthly data={gridData.data} meta={gridData.meta} />
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
