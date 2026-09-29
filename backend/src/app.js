const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const systemRoutes = require('./routes/systemRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const authRoutes = require('./routes/authRoutes');
const patientRoutes = require('./routes/patientRoutes');
const staffRoutes = require('./routes/staffRoutes');
const appointmentRoutes = require('./routes/appointmentRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
const frontendDirectory = path.join(__dirname, '../../frontend');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

app.use('/api', systemRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/patient', appointmentRoutes.patient);
app.use('/api/staff', staffRoutes);
app.use('/api/staff', appointmentRoutes.staff);
app.use('/api/admin', adminRoutes);
app.use('/api', (error, request, response, next) => {
  if (error?.type === 'entity.too.large') return response.status(413).json({ error: 'The selected image is too large. Choose a smaller picture and try again.' });
  if (error instanceof SyntaxError && error.status === 400) return response.status(400).json({ error: 'The submitted information could not be read. Refresh and try again.' });
  return next(error);
});
app.use(express.static(frontendDirectory));

app.get('*', (request, response) => {
  response.sendFile(path.join(frontendDirectory, 'index.html'));
});

module.exports = app;
