const express = require('express');
const { checkDatabaseConnection } = require('../config/database');

const router = express.Router();

router.get('/health', async (request, response) => {
  let database = 'not connected';

  try {
    await checkDatabaseConnection();
    database = 'connected';
  } catch (error) {
    // The first UI milestone can run before MySQL is configured.
  }

  response.json({
    application: 'MediQ',
    status: 'running',
    database,
    timestamp: new Date().toISOString(),
  });
});

router.get('/project-status', (request, response) => {
  response.json({
    milestone: 'Patient portal',
    completed: [
      'Node.js and Express server scaffold',
      'Initial responsive user interface',
      'MySQL connection configuration',
      'Draft database schema',
      'Patient registration with server-side validation',
      'Password hashing and secure sessions',
      'Patient, Staff and Administrator role access',
      'Patient dashboard with MySQL data',
      'Transactional patient queue registration',
      'Patient queue status and cancellation',
      'Patient appointment requests and cancellation',
      'Patient notification centre',
      'Patient queue history, profile and password management',
      'Staff operations overview and live queue management',
      'Validated queue transitions with patient notifications and audit records',
      'Machine-learning service boundary defined',
    ],
    planned: [
      'Staff queue management dashboard',
      'Waiting-time model training and evaluation',
    ],
  });
});

module.exports = router;
