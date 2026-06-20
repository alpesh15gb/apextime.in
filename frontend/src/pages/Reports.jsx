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
    const { user } = useAuth();
    // Group by department
    const departments = {};
    data.forEach(emp => {
        if (!departments[emp.department]) departments[emp.department] = [];
        departments[emp.department].push(emp);
    });

    const stats = { present: 0, in: 0, absent: 0, leave: 0 };
    data.forEach(emp => {
        const day = emp.days[meta.startDate];
        if (day?.status === 'P' || day?.status === 'PH') stats.present++;
        if (day?.in) stats.in++;
        if (day?.status === 'A') stats.absent++;
        if (day?.status === 'L' || day?.status === 'OL') stats.leave++;
    });

    return (
        <div className="report-container printable" style={{ background: 'white', color: 'black', padding: '10px', fontSize: '11px' }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 'bold', textTransform: 'uppercase' }}>{user?.tenant?.name || 'APEXTIME BUSINESS'}</h2>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 15, fontSize: 10 }}>
                <div>Report Date : {dayjs(meta.startDate).format('DD/MM/YYYY')}</div>
                <div style={{ fontWeight: 'bold', fontSize: 14 }}>Daily Performance Report</div>
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
                        <th style={{ border: '1px solid #000', padding: 4 }}>Loss Hrs.</th>
                        <th style={{ border: '1px solid #000', padding: 4 }}>In Duration</th>
                        <th style={{ border: '1px solid #000', padding: 4 }}>Out Duration</th>
                        <th style={{ border: '1px solid #000', padding: 4 }}>Shift Duration</th>
                        <th style={{ border: '1px solid #000', padding: 4 }}>Status Code</th>
                        <th style={{ border: '1px solid #000', padding: 4 }}>In Device</th>
                        <th style={{ border: '1px solid #000', padding: 4 }}>Out Device</th>
                        <th style={{ border: '1px solid #000', padding: 4 }}>Last Punch</th>
                        <th style={{ border: '1px solid #000', padding: 4 }}>Direction</th>
                        <th style={{ border: '1px solid #000', padding: 4 }}>WOP</th>
                        <th style={{ border: '1px solid #000', padding: 4 }}>HP</th>
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
                                        <td style={{ border: '1px solid #000', padding: 4, textAlign: 'center', color: (day?.lossOfHours && day.lossOfHours !== '00:00') ? '#e67e22' : 'inherit' }}>{day?.lossOfHours && day.lossOfHours !== '00:00' ? day.lossOfHours : ''}</td>
                                        <td style={{ border: '1px solid #000', padding: 4, textAlign: 'center' }}>{day?.InDuration && day.InDuration !== '00:00' ? day.InDuration : ''}</td>
                                        <td style={{ border: '1px solid #000', padding: 4, textAlign: 'center' }}>{day?.OutDuration && day.OutDuration !== '00:00' ? day.OutDuration : ''}</td>
                                        <td style={{ border: '1px solid #000', padding: 4, textAlign: 'center' }}>{day?.ShiftDuration && day.ShiftDuration !== '00:00' ? day.ShiftDuration : ''}</td>
                                        <td style={{ border: '1px solid #000', padding: 4, textAlign: 'center', fontWeight: 'bold', color: day?.StatusCode === 0 ? 'red' : day?.StatusCode === 3 ? 'blue' : day?.StatusCode === 4 ? 'purple' : day?.StatusCode === 5 ? 'orange' : 'inherit' }}>{day?.StatusCode || ''}</td>
                                        <td style={{ border: '1px solid #000', padding: 4, textAlign: 'center' }}>{day?.InDevice || ''}</td>
                                        <td style={{ border: '1px solid #000', padding: 4, textAlign: 'center' }}>{day?.OutDevice || ''}</td>
                                        <td style={{ border: '1px solid #000', padding: 4, textAlign: 'center' }}>{day?.LastPunch || ''}</td>
                                        <td style={{ border: '1px solid #000', padding: 4, textAlign: 'center' }}>{day?.Direction || ''}</td>
                                        <td style={{ border: '1px solid #000', padding: 4, textAlign: 'center' }}>{day?.WeeklyOffPresent || ''}</td>
                                        <td style={{ border: '1px solid #000', padding: 4, textAlign: 'center' }}>{day?.HolidayPresent || ''}</td>
                                        <td style={{ border: '1px solid #000', padding: 4 }}>
                                            {day?.LeaveType ? `${day.LeaveType} (${day.LeaveDuration})` : ''}
                                            {day?.IsOnLeave && !day?.LeaveType ? 'On Leave' : ''}
                                        </td>
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
    const { user } = useAuth();
    const dayKeys = [];
    const daysInMonth = dayjs(meta.startDate).daysInMonth();
    const start = dayjs(meta.startDate).startOf('month');
    for (let i = 0; i < daysInMonth; i++) {
        dayKeys.push(start.add(i, 'day').format('YYYY-MM-DD'));
    }

    return (
        <div className="report-container printable" style={{ background: 'white', color: 'black', padding: '10px' }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 'bold', textTransform: 'uppercase' }}>{user?.tenant?.name || 'APEXTIME BUSINESS'}</h2>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 12 }}>
                <div>Report from : {dayjs(meta.startDate).format('DD-MM-YYYY')} To : {dayjs(meta.endDate).format('DD-MM-YYYY')}</div>
                <div style={{ fontWeight: 'bold', fontSize: 16 }}>Monthly Performance Report</div>
                <div>Print Date : {dayjs().format('DD/MM/YYYY')}</div>
            </div>

            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
                    <thead>
                        <tr style={{ background: '#eee' }}>
                            <th style={{ border: '1px solid #000', padding: 4, textAlign: 'left', width: 150 }}>Employee</th>
                            {dayKeys.map(k => (
                                <th key={k} style={{ border: '1px solid #000', padding: 2, minWidth: 25 }}>
                                    {dayjs(k).date()}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {data.map(emp => (
                            <tr key={emp.id}>
                                <td style={{ border: '1px solid #000', padding: '2px 4px', fontWeight: 'bold' }}>
                                    {emp.code} - {emp.name}
                                </td>
                                {dayKeys.map(k => {
                                    const day = emp.days[k];
                                    let content = '-';
                                    let color = 'black';
                                    if (day) {
                                        content = day.status;
                                        if (content === 'A') color = 'red';
                                        if (content === 'P') color = 'green';
                                        if (content === 'PH') color = '#e67e22';
                                        if (content === 'WO') color = 'blue';
                                    }
                                    return (
                                        <td key={k} style={{ border: '1px solid #000', padding: 2, textAlign: 'center', color, fontWeight: 'bold' }}>
                                            {content}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const WeeklyReport = ({ data, meta }) => {
    const { user } = useAuth();
    const dayKeys = Object.keys(data[0]?.days || {}).sort();

    return (
        <div className="report-container printable" style={{ background: 'white', color: 'black', padding: '10px' }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 'bold', textTransform: 'uppercase' }}>{user?.tenant?.name || 'APEXTIME BUSINESS'}</h2>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 12 }}>
                <div>Range: {meta.startDate} to {meta.endDate}</div>
                <div style={{ fontWeight: 'bold', fontSize: 16 }}>Weekly Performance Report</div>
                <div>Print Date : {dayjs().format('DD/MM/YYYY')}</div>
            </div>

            {data.map((emp) => (
                <div key={emp.id} className="report-employee-row" style={{ marginBottom: 15, border: '2px solid #000', pageBreakInside: 'avoid' }}>
                    <div style={{ display: 'flex' }}>
                        <div style={{ width: 140, borderRight: '2px solid #000', padding: '4px 6px', fontSize: 9, display: 'flex', flexDirection: 'column', justifyContent: 'center', lineHeight: 1.2 }}>
                            <div style={{ fontWeight: 'bold', fontSize: 10, wordBreak: 'break-word', lineHeight: 1.1, marginBottom: 4 }}>{emp.name}</div>
                            <div style={{ marginBottom: 1 }}>Code: {emp.code}</div>
                            <div style={{ marginBottom: 1 }}>Dept: {emp.department}</div>
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
                                            return (
                                                <th key={k} style={{ borderRight: '1px solid #ccc', fontSize: 7, color: d.day() === 0 ? 'red' : '#000' }}>
                                                    <div>{d.format('ddd')}</div>
                                                    <div>{d.date()}</div>
                                                </th>
                                            );
                                        })}
                                    </tr>
                                </thead>
                                <tbody>
                                    {['IN', 'OUT', 'Shift', 'OT', 'Status'].map((metric) => (
                                        <tr key={metric} style={{ height: 18 }}>
                                            <td style={{ fontWeight: 'bold', borderRight: '1px solid #ccc', background: '#f0f0f0' }}>{metric}</td>
                                            {dayKeys.map(k => {
                                                const day = emp.days[k];
                                                let content = '';
                                                let style = { borderRight: '1px solid #ccc', fontSize: 8 };
                                                if (metric === 'IN') content = day?.in || '';
                                                if (metric === 'OUT') content = day?.out || '';
                                                if (metric === 'Shift') content = day?.shift || '';
                                                if (metric === 'OT') content = day?.ot === '00:00' ? '' : day?.ot;
                                                if (metric === 'Status') {
                                                    content = day?.status;
                                                    if (content === 'A') style.color = 'red';
                                                    if (content === 'P') style.color = 'green';
                                                    if (content === 'PH') style.color = '#e67e22';
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
            ))}
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
        <div className="report-container printable apex-report-monthly" style={{ background: 'white', color: 'black', padding: '0px', fontFamily: 'monospace', fontSize: '10px' }}>
            {data.map((emp, empIdx) => {
                const dayKeys = Object.keys(emp.days).sort();
                const totals = {
                    gross: sumDurations(dayKeys.map(k => emp.days[k]?.workHrs)),
                    extra: sumDurations(dayKeys.map(k => emp.days[k]?.ot)),
                    less: sumDurations(dayKeys.map(k => emp.days[k]?.early)),
                    lossOfHours: sumDurations(dayKeys.map(k => emp.days[k]?.lossOfHours)),
                    net: '00:00'
                };

                // Helper to subtract durations
                const subtractDurations = (total, extra) => {
                    if (!total || total === '00:00') return '00:00';
                    if (!extra || extra === '00:00') return total;
                    const [th, tm] = total.split(':').map(Number);
                    const [eh, em] = extra.split(':').map(Number);
                    let totalMins = (th * 60 + tm) - (eh * 60 + em);
                    if (totalMins < 0) totalMins = 0;
                    const h = Math.floor(totalMins / 60);
                    const m = totalMins % 60;
                    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                };

                const netWorkDurations = dayKeys.map(k => subtractDurations(emp.days[k]?.workHrs, emp.days[k]?.ot));
                totals.net = sumDurations(netWorkDurations);

                return (
                    <div key={emp.id} className="apex-page" style={{ padding: '15px', boxSizing: 'border-box', height: '100%', display: 'flex', flexDirection: 'column' }}>
                        {/* Header */}
                        <div style={{ textAlign: 'center', position: 'relative', marginBottom: 10 }}>
                            <div style={{ position: 'absolute', right: 0, top: 0, fontSize: '9px' }}>Page {empIdx + 1} of {data.length}</div>
                            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 'bold', textTransform: 'uppercase' }}>{user?.tenant?.name || 'APEXTIME BUSINESS'}</h2>
                            <div style={{ fontSize: 12, fontWeight: 'bold' }}>Work Hours Summary From {dayjs(meta.startDate).format('DD/MM/YYYY')} To {dayjs(meta.endDate).format('DD/MM/YYYY')}</div>
                            
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 9, borderBottom: '1px solid #000', paddingBottom: 2 }}>
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
                        <div style={{ fontWeight: 'bold', fontSize: 11, marginBottom: 5 }}>{emp.code} - {emp.name}</div>

                        <table style={{ width: '100%', borderCollapse: 'collapse', borderTop: '1px solid #000' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #000', fontSize: '9px' }}>
                                    <th style={{ textAlign: 'left', padding: '2px' }}>Date</th>
                                    <th style={{ textAlign: 'center', padding: '2px' }}>Shift</th>
                                    <th style={{ textAlign: 'center', padding: '2px' }}>First IN</th>
                                    <th style={{ textAlign: 'center', padding: '2px' }}>Last OUT</th>
                                    <th style={{ textAlign: 'center', padding: '2px', fontWeight: 'bold' }}>Gross</th>
                                    <th style={{ textAlign: 'center', padding: '2px', fontWeight: 'bold' }}>Work Hours</th>
                                    <th style={{ textAlign: 'center', padding: '2px' }}>Loss Hrs</th>
                                    <th style={{ textAlign: 'center', padding: '2px' }}>Overtime</th>
                                    <th style={{ textAlign: 'center', padding: '2px' }}>Less Hrs</th>
                                </tr>
                            </thead>
                            <tbody style={{ fontSize: '9.5px' }}>
                                {dayKeys.map(k => {
                                    const day = emp.days[k];
                                    const isHoliday = day?.status === 'WO' || day?.status === 'OFF';
                                    
                                    // Local Gross calculation for display
                                    let displayGross = '00:00';
                                    if (day?.in && day?.out) {
                                        const [ih, im] = day.in.split(':').map(Number);
                                        const [oh, om] = day.out.split(':').map(Number);
                                        let diff = (oh * 60 + om) - (ih * 60 + im);
                                        if (diff < 0) diff += 1440;
                                        displayGross = `${Math.floor(diff / 60).toString().padStart(2, '0')}:${(diff % 60).toString().padStart(2, '0')}`;
                                    }

                                    return (
                                        <tr key={k} style={{ color: isHoliday ? '#666' : 'black', borderBottom: '1px solid #eee' }}>
                                            <td style={{ padding: '2px' }}>{dayjs(k).format('DD/MM/YYYY')}</td>
                                            <td style={{ textAlign: 'center', fontSize: '8.5px', padding: '2px' }}>{day?.shift || '-'}</td>
                                            <td style={{ textAlign: 'center', padding: '2px' }}>{day?.in || ''}</td>
                                            <td style={{ textAlign: 'center', padding: '2px' }}>{day?.out || ''}</td>
                                            <td style={{ textAlign: 'center', padding: '2px', fontWeight: 'bold' }}>{displayGross !== '00:00' ? displayGross : ''}</td>
                                            <td style={{ textAlign: 'center', padding: '2px', fontWeight: 'bold' }}>{day?.workHrs !== '00:00' ? day?.workHrs : ''}</td>
                                            <td style={{ textAlign: 'center', padding: '2px', color: (day?.lossOfHours && day.lossOfHours !== '00:00') ? '#e67e22' : 'inherit' }}>{day?.lossOfHours && day.lossOfHours !== '00:00' ? day.lossOfHours : ''}</td>
                                            <td style={{ textAlign: 'center', padding: '2px' }}>{day?.ot !== '00:00' ? day?.ot : ''}</td>
                                            <td style={{ textAlign: 'center', padding: '2px' }}>{day?.early !== '00:00' ? day?.early : ''}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                <tr style={{ borderTop: '2px solid #000', fontWeight: 'bold', fontSize: '10px' }}>
                                    <td colSpan={4} style={{ textAlign: 'right', padding: '4px' }}>Total</td>
                                    <td style={{ textAlign: 'center' }}>{totals.gross}</td>
                                    <td style={{ textAlign: 'center' }}>{totals.net}</td>
                                    <td style={{ textAlign: 'center', color: totals.lossOfHours !== '00:00' ? '#e67e22' : 'inherit' }}>{totals.lossOfHours}</td>
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

const PerformanceReport = ({ data, meta }) => {
    const { user } = useAuth();
    const dayKeys = [];
    const daysInMonth = dayjs(meta.startDate).daysInMonth();
    const start = dayjs(meta.startDate).startOf('month');
    for (let i = 0; i < daysInMonth; i++) {
        dayKeys.push(start.add(i, 'day').format('YYYY-MM-DD'));
    }

    return (
        <div className="report-container printable landscape-report" style={{ background: 'white', color: 'black', padding: '10px' }}>
            <style>{`
                @media print {
                    @page { size: landscape; margin: 5mm; }
                }
            `}</style>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, fontSize: 12 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 'bold' }}>Monthly Performance Report</h2>
                <div>From : {dayjs(meta.startDate).format('YYYY/MM/DD')} To Date : {dayjs(meta.endDate).format('YYYY/MM/DD')}</div>
            </div>
            <div style={{ textAlign: 'right', marginBottom: 10, fontSize: 12 }}>
                Print Date {dayjs().format('DD/MM/DD')}
            </div>

            {data.map(emp => {
                const present = parseFloat(emp.stats?.present || 0);
                const absent = parseFloat(emp.stats?.absent || 0);
                const wo = parseFloat(emp.stats?.wo || 0);
                const leave = parseFloat(emp.stats?.leave || 0);
                const hld = parseFloat(emp.stats?.hld || 0);
                const paidDay = present + wo + leave + hld;

                const getBg = (status) => (status === 'WO' || status === 'OFF' ? 'gray' : 'transparent');
                const getTextColor = (status) => (status === 'WO' || status === 'OFF' ? 'white' : 'black');

                // Get Shift Start from the first available day
                let shiftStartTime = '00:00:00';
                for (let k of dayKeys) {
                    if (emp.days[k]?.shiftStart) {
                        shiftStartTime = emp.days[k].shiftStart;
                        break;
                    }
                }

                return (
                    <div key={emp.id} style={{ marginBottom: 15, pageBreakInside: 'avoid' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 8.5, textAlign: 'center', tableLayout: 'fixed' }}>
                            <thead>
                                <tr>
                                    <th style={{ width: 140, border: '1px solid #000', textAlign: 'left', padding: '1px 3px', fontWeight: 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Dep : {emp.department}</th>
                                    <th style={{ width: 32, border: '1px solid #000' }}></th>
                                    {dayKeys.map((k, i) => (
                                        <th key={k} style={{ border: '1px solid #000', padding: '1px' }}>
                                            {i + 1}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {/* Row 1 */}
                                <tr>
                                    <td style={{ textAlign: 'left', padding: '1px 3px', border: '1px solid #000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`Name : ${emp.name}`}>Name : {emp.name}</td>
                                    <td style={{ border: '1px solid #000' }}>IN</td>
                                    {dayKeys.map(k => (
                                        <td key={`in-${k}`} style={{ border: '1px solid #000', background: getBg(emp.days[k]?.status), color: getTextColor(emp.days[k]?.status) }}>{emp.days[k]?.in || '0:0'}</td>
                                    ))}
                                </tr>
                                {/* Row 2 */}
                                <tr>
                                    <td style={{ textAlign: 'left', padding: '1px 3px', border: '1px solid #000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>E.Code : {emp.code}</td>
                                    <td style={{ border: '1px solid #000' }}>OUT</td>
                                    {dayKeys.map(k => (
                                        <td key={`out-${k}`} style={{ border: '1px solid #000', background: getBg(emp.days[k]?.status), color: getTextColor(emp.days[k]?.status) }}>{emp.days[k]?.out || '0:0'}</td>
                                    ))}
                                </tr>
                                {/* Row 3 */}
                                <tr>
                                    <td style={{ textAlign: 'left', padding: '1px 3px', border: '1px solid #000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Desig. :{emp.designation}</td>
                                    <td style={{ border: '1px solid #000' }}>Shift</td>
                                    {dayKeys.map(k => (
                                        <td key={`shift-${k}`} style={{ border: '1px solid #000', background: getBg(emp.days[k]?.status), color: getTextColor(emp.days[k]?.status) }}>{emp.days[k]?.shift || 'OFF'}</td>
                                    ))}
                                </tr>
                                {/* Row 4 */}
                                <tr>
                                    <td style={{ textAlign: 'left', padding: '1px 3px', border: '1px solid #000' }}>{shiftStartTime}</td>
                                    <td style={{ border: '1px solid #000' }}>Late</td>
                                    {dayKeys.map(k => (
                                        <td key={`late-${k}`} style={{ border: '1px solid #000', background: getBg(emp.days[k]?.status), color: getTextColor(emp.days[k]?.status) }}>{emp.days[k]?.late || '00:00'}</td>
                                    ))}
                                </tr>
                                {/* Row 5 */}
                                <tr>
                                    <td style={{ textAlign: 'left', padding: '1px 3px', border: '1px solid #000' }}>Total Working Hrs : {emp.stats?.totalWorkHrs || '0:0'}</td>
                                    <td style={{ border: '1px solid #000' }}>W.Hrs</td>
                                    {dayKeys.map(k => (
                                        <td key={`work-${k}`} style={{ border: '1px solid #000', background: getBg(emp.days[k]?.status), color: getTextColor(emp.days[k]?.status) }}>{emp.days[k]?.workHrs || ''}</td>
                                    ))}
                                </tr>
                                {/* Row 6 */}
                                <tr>
                                    <td style={{ textAlign: 'left', padding: '1px 3px', border: '1px solid #000' }}>Total OT Hrs : {emp.stats?.totalOtHrs || '0:0'}</td>
                                    <td style={{ border: '1px solid #000' }}>OT</td>
                                    {dayKeys.map(k => (
                                        <td key={`ot-${k}`} style={{ border: '1px solid #000', background: getBg(emp.days[k]?.status), color: getTextColor(emp.days[k]?.status) }}>{emp.days[k]?.ot !== '00:00' ? emp.days[k]?.ot : ''}</td>
                                    ))}
                                </tr>
                                {/* Row 7 */}
                                <tr>
                                    <td style={{ textAlign: 'left', padding: '1px 3px', border: '1px solid #000', fontSize: 8 }}>Absent : {absent.toFixed(2)}, Present : {present.toFixed(2)}</td>
                                    <td style={{ border: '1px solid #000' }}>Early</td>
                                    {dayKeys.map(k => (
                                        <td key={`early-${k}`} style={{ border: '1px solid #000', background: getBg(emp.days[k]?.status), color: getTextColor(emp.days[k]?.status) }}>{emp.days[k]?.early || ''}</td>
                                    ))}
                                </tr>
                                {/* Row 8 */}
                                <tr>
                                    <td style={{ textAlign: 'left', padding: '1px 3px', border: '1px solid #000' }}>Paid Day : {paidDay.toFixed(2)}</td>
                                    <td style={{ border: '1px solid #000' }}></td>
                                    {dayKeys.map(k => (
                                        <td key={`status-${k}`} style={{ border: '1px solid #000', background: getBg(emp.days[k]?.status), color: getTextColor(emp.days[k]?.status) }}>{emp.days[k]?.status || ''}</td>
                                    ))}
                                </tr>
                                {/* Row 9 */}
                                <tr>
                                    <td colSpan={dayKeys.length + 2} style={{ textAlign: 'left', padding: '2px 3px', border: '1px solid #000' }}>
                                        WO : {wo.toFixed(2)}, HLD : {hld.toFixed(2)}, Leave : {leave.toFixed(2)}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                );
            })}
        </div>
    );
};

const MonthlyStatusReport = ({ data, meta }) => {
    const { user } = useAuth();
    
    // Group by department
    const departments = {};
    data.forEach(emp => {
        if (!departments[emp.department]) departments[emp.department] = [];
        departments[emp.department].push(emp);
    });

    const dayKeys = [];
    const start = dayjs(meta.startDate);
    const end = dayjs(meta.endDate);
    const diff = end.diff(start, 'day') + 1;
    for (let i = 0; i < diff; i++) {
        dayKeys.push(start.add(i, 'day').format('YYYY-MM-DD'));
    }

    const getDayAbbrev = (dateStr) => {
        const d = dayjs(dateStr).day();
        const map = ['S', 'M', 'T', 'W', 'Th', 'F', 'St'];
        return map[d];
    };

    return (
        <div className="report-container printable landscape-report" style={{ background: 'white', color: 'black', padding: '15px', fontFamily: 'Arial, sans-serif' }}>
            <style>{`
                @media print {
                    @page { size: landscape; margin: 5mm; }
                    .monthly-status-table {
                        page-break-inside: auto;
                    }
                    .monthly-status-employee-body {
                        page-break-inside: avoid !important;
                        break-inside: avoid !important;
                    }
                }
                .monthly-status-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 8.5px;
                    text-align: center;
                }
                .monthly-status-table th, .monthly-status-table td {
                    border: 1px dotted #000;
                    padding: 3px 2px;
                    height: 18px;
                }
                .monthly-status-table thead th {
                    border: 1px solid #000;
                    font-weight: bold;
                    background: #eee;
                }
                .monthly-status-label-col {
                    width: 70px;
                    font-weight: bold;
                    text-align: left;
                    padding-left: 5px !important;
                    border-left: 1px solid #000 !important;
                }
                .monthly-status-day-col {
                    min-width: 25px;
                }
                .monthly-status-table td:last-child, .monthly-status-table th:last-child {
                    border-right: 1px solid #000 !important;
                }
            `}</style>
            
            {/* Report Header */}
            <div style={{ textAlign: 'center', marginBottom: 15, position: 'relative' }}>
                <h2 style={{ margin: '0 0 5px 0', fontSize: 16, fontWeight: 'bold' }}>Monthly Status Report (Basic Work Duration)</h2>
                <div style={{ fontSize: 11, marginBottom: 15 }}>{dayjs(meta.startDate).format('MMM DD YYYY')} To {dayjs(meta.endDate).format('MMM DD YYYY')}</div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, borderBottom: '2px solid #000', paddingBottom: 4 }}>
                    <div><strong>Company:</strong> {user?.tenant?.name || 'Default'}</div>
                    <div>Printed On {dayjs().format('MMM DD YYYY HH:mm')}</div>
                </div>
            </div>

            <table className="monthly-status-table" style={{ border: '1px solid #000' }}>
                <thead>
                    <tr>
                        <th className="monthly-status-label-col">Days</th>
                        {dayKeys.map((k, i) => (
                            <th key={k} className="monthly-status-day-col">
                                {i + 1} {getDayAbbrev(k)}
                            </th>
                        ))}
                    </tr>
                </thead>
                
                {Object.entries(departments).map(([deptName, emps]) => (
                    <Fragment key={deptName}>
                        <tbody className="monthly-status-employee-body">
                            <tr>
                                <td colSpan={dayKeys.length + 1} style={{ textAlign: 'left', fontWeight: 'bold', fontSize: '11px', background: '#f5f5f5', border: '1px solid #000', padding: '6px' }}>
                                    Department: &nbsp;&nbsp;&nbsp;&nbsp; {deptName}
                                </td>
                            </tr>
                        </tbody>

                        {emps.map(emp => (
                            <tbody key={emp.id} className="monthly-status-employee-body" style={{ border: '1px solid #000' }}>
                                {/* Employee Header Row */}
                                <tr>
                                    <td colSpan={dayKeys.length + 1} style={{ textAlign: 'left', fontWeight: 'bold', fontSize: '10px', background: '#fafafa', border: '1px solid #000', borderBottom: 'none', padding: '5px' }}>
                                        <div style={{ display: 'flex', gap: 40 }}>
                                            <div>Emp. Code &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; {emp.code}</div>
                                            <div>Emp. Name: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; {emp.name}</div>
                                        </div>
                                    </td>
                                </tr>
                                
                                {/* Status Row */}
                                <tr style={{ borderTop: '1px solid #000' }}>
                                    <td className="monthly-status-label-col">Status</td>
                                    {dayKeys.map(k => {
                                        const day = emp.days[k];
                                        let status = day?.status || 'A';
                                        
                                        // Handle WOP (Weekly Off Present)
                                        if (day?.shift === 'OFF' && (day?.in || day?.out)) {
                                            status = 'WOP';
                                        }

                                        let color = 'black';
                                        if (status === 'A') color = 'red';
                                        if (status === 'P') color = 'green';
                                        if (status === 'PH') color = '#e67e22';
                                        if (status === 'WO') color = 'blue';
                                        if (status === 'WOP') color = 'purple';
                                        if (day?.missedOut) color = '#cc8400';

                                        return (
                                            <td key={`status-${k}`} style={{ color, fontWeight: 'bold' }}>
                                                {status}
                                            </td>
                                        );
                                    })}
                                </tr>
                                {/* InTime Row */}
                                <tr>
                                    <td className="monthly-status-label-col">InTime</td>
                                    {dayKeys.map(k => (
                                        <td key={`in-${k}`}>
                                            {emp.days[k]?.in || ''}
                                        </td>
                                    ))}
                                </tr>
                                {/* OutTime Row */}
                                <tr>
                                    <td className="monthly-status-label-col">OutTime</td>
                                    {dayKeys.map(k => (
                                        <td key={`out-${k}`}>
                                            {emp.days[k]?.out || ''}
                                        </td>
                                    ))}
                                </tr>
                                {/* Total Work Hours Row */}
                                <tr style={{ borderBottom: '1px solid #000' }}>
                                    <td className="monthly-status-label-col">Total</td>
                                    {dayKeys.map(k => {
                                        const workHrs = emp.days[k]?.workHrs;
                                        return (
                                            <td key={`total-${k}`} style={{ fontWeight: '500' }}>
                                                {workHrs && workHrs !== '00:00' ? workHrs : '00:00'}
                                            </td>
                                        );
                                    })}
                                </tr>
                                
                                {/* Small spacer row for separating employees on screen */}
                                <tr className="no-print" style={{ height: '8px', border: 'none' }}>
                                    <td colSpan={dayKeys.length + 1} style={{ border: 'none', background: 'transparent', height: '8px' }}></td>
                                </tr>
                            </tbody>
                        ))}
                    </Fragment>
                ))}
            </table>

            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', fontSize: 10, borderTop: '1px solid #ddd', paddingTop: 8 }} className="print-footer">
                <div>Generated By: {user?.username || 'essl'}</div>
                <div>Page No 1</div>
            </div>
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
        if (location.pathname.includes('/monthly-status')) return 'monthly_status';
        if (location.pathname.includes('/monthly')) return 'monthly';
        if (location.pathname.includes('/apex-monthly')) return 'apex_monthly';
        if (location.pathname.includes('/performance-report')) return 'performance_report';
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

        if (reportType === 'monthly' || reportType === 'monthly_status' || reportType === 'apex_monthly' || reportType === 'performance_report') {
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

        if (reportType === 'performance_report') {
            const aoa = [];
            const title = `Monthly Performance Report (${gridData.meta.startDate} to ${gridData.meta.endDate})`;
            aoa.push([title]);
            aoa.push([]);

            const dayKeys = Object.keys(gridData.data[0].days).sort();
            
            gridData.data.forEach(emp => {
                const present = parseFloat(emp.stats?.present || 0);
                const absent = parseFloat(emp.stats?.absent || 0);
                const wo = parseFloat(emp.stats?.wo || 0);
                const leave = parseFloat(emp.stats?.leave || 0);
                const hld = parseFloat(emp.stats?.hld || 0);
                const paidDay = present + wo + leave + hld;

                let shiftStartTime = '00:00:00';
                for (let k of dayKeys) {
                    if (emp.days[k]?.shiftStart) {
                        shiftStartTime = emp.days[k].shiftStart;
                        break;
                    }
                }

                const headerRow = [`Dep : ${emp.department}`, '', ...dayKeys.map((_, i) => i + 1)];
                aoa.push(headerRow);

                const row1 = [`Name : ${emp.name}`, 'IN', ...dayKeys.map(k => emp.days[k]?.in || '0:0')];
                aoa.push(row1);

                const row2 = [`E.Code : ${emp.code}`, 'OUT', ...dayKeys.map(k => emp.days[k]?.out || '0:0')];
                aoa.push(row2);

                const row3 = [`Desig. :${emp.designation}`, 'Shift', ...dayKeys.map(k => emp.days[k]?.shift || 'OFF')];
                aoa.push(row3);

                const row4 = [shiftStartTime, 'Late', ...dayKeys.map(k => emp.days[k]?.late || '00:00')];
                aoa.push(row4);

                const row5 = [`Total Working Hrs : ${emp.stats?.totalWorkHrs || '0:0'}`, 'W.Hrs', ...dayKeys.map(k => emp.days[k]?.workHrs || '')];
                aoa.push(row5);

                const row6 = [`Total OT Hrs : ${emp.stats?.totalOtHrs || '0:0'}`, 'OT', ...dayKeys.map(k => emp.days[k]?.ot !== '00:00' ? emp.days[k]?.ot : '')];
                aoa.push(row6);

                const row7 = [`Absent : ${absent.toFixed(2)}, Present : ${present.toFixed(2)}`, 'Early', ...dayKeys.map(k => emp.days[k]?.early || '')];
                aoa.push(row7);

                const row8 = [`Paid Day : ${paidDay.toFixed(2)}`, '', ...dayKeys.map(k => emp.days[k]?.status || '')];
                aoa.push(row8);

                const row9 = [`WO : ${wo.toFixed(2)}, HLD : ${hld.toFixed(2)}, Leave : ${leave.toFixed(2)}`, '', ...dayKeys.map(() => '')];
                aoa.push(row9);

                aoa.push([]);
            });

            const ws = XLSX.utils.aoa_to_sheet(aoa);
            ws['!cols'] = [{ wch: 30 }, { wch: 8 }];
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Performance Report");
            const deptSuffix = departmentId ? `_${departments.find(d => d.id == departmentId)?.name || departmentId}` : '';
            XLSX.writeFile(wb, `Performance_Report_${gridData.meta.startDate}${deptSuffix}.xlsx`);
            return;
        }

        const aoa = [];
        const title = reportType === 'monthly' 
            ? `Monthly Performance Report - ${gridData.meta.monthName} ${gridData.meta.year}`
            : reportType === 'monthly_status'
            ? `Monthly Status Report (Basic Work Duration) - ${gridData.meta.monthName} ${gridData.meta.year}`
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

            const rowLunch = ['', '', '', 'LUNCH'];
            dayKeys.forEach(k => rowLunch.push(emp.days[k]?.lunch || ''));
            aoa.push(rowLunch);

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
                                <select value={reportType} onChange={e => setReportType(e.target.value)} className="form-input" style={{ width: 170 }}>
                                    <option value="daily">Daily</option>
                                    <option value="weekly">Weekly</option>
                                    <option value="monthly">Monthly</option>
                                    <option value="monthly_status">Monthly Status</option>
                                    <option value="apex_monthly">Apex Monthly</option>
                                    <option value="performance_report">Performance Report</option>
                                </select>

                                {(reportType === 'monthly' || reportType === 'monthly_status' || reportType === 'apex_monthly' || reportType === 'performance_report') ? (
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
                    {reportType === 'daily' && <DailyReport data={gridData.data} meta={gridData.meta} />}
                    {reportType === 'weekly' && <WeeklyReport data={gridData.data} meta={gridData.meta} />}
                    {reportType === 'monthly' && <MonthlyReport data={gridData.data} meta={gridData.meta} />}
                    {reportType === 'monthly_status' && <MonthlyStatusReport data={gridData.data} meta={gridData.meta} />}
                    {reportType === 'apex_monthly' && <ApexReportMonthly data={gridData.data} meta={gridData.meta} />}
                    {reportType === 'performance_report' && <PerformanceReport data={gridData.data} meta={gridData.meta} />}
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
    @page { size: ${reportType === 'performance_report' || reportType === 'monthly_status' ? 'landscape' : 'portrait'}; margin: 5mm; }
    html, body, #root, .app-layout, .main-content, .content-area {
        height: auto !important;
        overflow: visible !important;
        display: block !important;
    }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: white !important; }
    .printable { color: #000; }
    .no-print, .sidebar, .top-bar { display: none !important; }
    .report-employee-row { break-inside: avoid; border: 1px solid #000 !important; }
    .apex-page { page-break-after: always; height: 100%; box-sizing: border-box; }
}
`}</style>
        </div>
    );
}
