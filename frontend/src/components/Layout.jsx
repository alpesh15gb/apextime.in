import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
    LayoutDashboard, Users, Building2, Clock, CheckCircle2,
    CalendarOff, Megaphone, HardDrive, LogOut, Settings, FileText, Briefcase, Calendar
} from 'lucide-react';
import dayjs from 'dayjs';

export default function Layout() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const navItems = [
        {
            section: 'Overview', items: [
                { to: '/', icon: <LayoutDashboard />, label: 'Dashboard' },
            ]
        },
        {
            section: 'People', items: [
                { to: '/employees', icon: <Users />, label: 'Employees' },
                { to: '/departments', icon: <Building2 />, label: 'Departments' },
                { to: '/designations', icon: <Briefcase />, label: 'Designations' },
            ]
        },
        {
            section: 'Attendance', items: [
                { to: '/work-shifts', icon: <Clock />, label: 'Work Shifts' },
                { to: '/attendance', icon: <Clock />, label: 'Timesheets' },
                { to: '/approvals', icon: <CheckCircle2 />, label: 'Approvals' },
                { to: '/leave-requests', icon: <CalendarOff />, label: 'Leave Requests' },
                { to: '/reports', icon: <FileText />, label: 'Reports' },
            ]
        },
        {
            section: 'System', items: [
                { to: '/announcements', icon: <Megaphone />, label: 'Announcements' },
                { to: '/devices', icon: <HardDrive />, label: 'Devices' },
            ]
        },
    ];

    // Add Super Admin specific routes
    if (user?.role === 'super_admin') {
        const systemSection = navItems.find(s => s.section === 'System');
        if (systemSection) {
            systemSection.items.push(
                { to: '/tenants', icon: <Building2 />, label: 'Organizations' }
            );
        }
    }

    const subscriptionExpiry = user?.tenant?.subscriptionExpiry;
    const daysLeft = subscriptionExpiry ? dayjs(subscriptionExpiry).diff(dayjs(), 'day') : null;

    return (
        <div className="app-layout">
            <aside className="sidebar">
                <div className="sidebar-header">
                    <div className="sidebar-brand">
                        <div className="sidebar-brand-icon">AT</div>
                        <div>
                            <h1>ApexTime Business</h1>
                            <p>{user?.tenant?.name || 'Portal'}</p>
                        </div>
                    </div>
                </div>

                <nav className="sidebar-nav">
                    {navItems.map((section) => (
                        <div className="nav-section" key={section.section}>
                            <div className="nav-section-title">{section.section}</div>
                            {section.items.map((item) => (
                                <NavLink
                                    key={item.to}
                                    to={item.to}
                                    end={item.to === '/'}
                                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                                >
                                    {item.icon}
                                    <span>{item.label}</span>
                                </NavLink>
                            ))}
                        </div>
                    ))}
                </nav>

                <div className="sidebar-footer" style={{ padding: '12px', borderTop: '1px solid var(--border)' }}>
                    {daysLeft !== null && user?.role !== 'super_admin' && (
                        <div style={{ 
                            fontSize: '11px', 
                            background: daysLeft < 7 ? '#fee2e2' : '#f0f9ff', 
                            padding: '10px', 
                            borderRadius: '8px', 
                            marginBottom: '12px',
                            color: daysLeft < 7 ? '#991b1b' : '#0369a1',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}>
                            <Calendar size={14} />
                            <div>
                                <div style={{ fontWeight: 'bold' }}>Subscription Plan</div>
                                <div>{daysLeft <= 0 ? 'Expired' : `${daysLeft} days remaining`}</div>
                            </div>
                        </div>
                    )}
                    <div className="nav-item" onClick={handleLogout} style={{ color: 'var(--danger)', cursor: 'pointer' }}>
                        <LogOut />
                        <span>Logout</span>
                    </div>
                </div>
            </aside>

            <main className="main-content">
                <header className="top-bar">
                    <div className="top-bar-left">
                        <h2 className="page-title"></h2>
                    </div>
                    <div className="top-bar-right">
                        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                            {user?.employee?.name || user?.username}
                        </span>
                        <div className="user-avatar">
                            {(user?.employee?.name?.[0] || user?.username?.[0] || 'U').toUpperCase()}
                        </div>
                    </div>
                </header>

                <div className="content-area">
                    <Outlet />
                </div>
            </main>
        </div>
    );
}
