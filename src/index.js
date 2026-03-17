require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');

const { tenantMiddleware } = require('./middleware/tenant');
const { authMiddleware } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');

// Route imports
const authRoutes = require('./routes/auth');
const departmentRoutes = require('./routes/departments');
const designationRoutes = require('./routes/designations');
const employeeRoutes = require('./routes/employees');
const academicRoutes = require('./routes/academic');
const studentRoutes = require('./routes/students');
const workShiftRoutes = require('./routes/workShifts');
const timesheetRoutes = require('./routes/timesheets');
const leaveRoutes = require('./routes/leaves');
const announcementRoutes = require('./routes/announcements');
const deviceRoutes = require('./routes/devices');
const portalRoutes = require('./routes/portal');
const iclockRoutes = require('./routes/iclock');
const dashboardRoutes = require('./routes/dashboard');
const tenantRoutes = require('./routes/tenants');

const app = express();

// Trust proxy for correct IP behind nginx
app.set('trust proxy', true);

// Security & utility middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan('short'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS
app.use(cors({
  origin: (origin, callback) => {
    // Allow all apextime.in subdomains + localhost
    if (!origin || origin.includes('apextime.in') || origin.includes('localhost')) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all for now
    }
  },
  credentials: true,
}));

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/api/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ESSL ADMS/iClock routes (no auth, device-level auth via serial number)
app.use('/iclock', iclockRoutes);

// Auth routes (no tenant middleware needed for login)
app.use('/api/auth', tenantMiddleware, authRoutes);

// Tenant management (super admin only)
app.use('/api/tenants', authMiddleware, tenantRoutes);

// All other routes need tenant + auth
app.use('/api/dashboard', tenantMiddleware, authMiddleware, dashboardRoutes);
app.use('/api/departments', tenantMiddleware, authMiddleware, departmentRoutes);
app.use('/api/designations', tenantMiddleware, authMiddleware, designationRoutes);
app.use('/api/employees', tenantMiddleware, authMiddleware, employeeRoutes);
app.use('/api/academic', tenantMiddleware, authMiddleware, academicRoutes);
app.use('/api/students', tenantMiddleware, authMiddleware, studentRoutes);
app.use('/api/work-shifts', tenantMiddleware, authMiddleware, workShiftRoutes);
app.use('/api/attendance', tenantMiddleware, authMiddleware, timesheetRoutes);
app.use('/api/leave', tenantMiddleware, authMiddleware, leaveRoutes);
app.use('/api/announcements', tenantMiddleware, authMiddleware, announcementRoutes);
app.use('/api/devices', tenantMiddleware, authMiddleware, deviceRoutes);
app.use('/api/portal', tenantMiddleware, authMiddleware, portalRoutes);
app.use('/api/reports', tenantMiddleware, authMiddleware, require('./routes/reports'));
app.use('/api/compoff', tenantMiddleware, authMiddleware, require('./routes/compoff'));

// Serve React frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/dist')));
  app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
  });
}

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 5001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 ApexTime Cloud API running on port ${PORT}`);
  console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
