const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const systemRoutes = require('./routes/systemRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const authRoutes = require('./routes/authRoutes');
const patientRoutes = require('./routes/patientRoutes');
const staffRoutes = require('./routes/staffRoutes');
const { requireRole } = require('./middleware/authentication');

const app = express();
const frontendDirectory = path.join(__dirname, '../../frontend');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use('/api', systemRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/staff', staffRoutes);
app.get('/api/admin/overview', ...requireRole('admin'), (request, response) => response.json({ message: 'Administrator dashboard access confirmed.', user: request.user }));
app.use(express.static(frontendDirectory));

app.get('*', (request, response) => {
  response.sendFile(path.join(frontendDirectory, 'index.html'));
});

module.exports = app;
