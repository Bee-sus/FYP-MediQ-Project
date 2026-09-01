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
    milestone: 'Database authentication foundation',
    completed: [
      'Node.js and Express server scaffold',
      'Initial responsive user interface',
      'MySQL connection configuration',
      'Draft database schema',
      'Patient registration with server-side validation',
      'Password hashing and secure sessions',
      'Patient, Staff and Administrator role access',
      'Machine-learning service boundary defined',
    ],
    planned: [
      'Patient queue registration workflow',
      'Staff queue management dashboard',
      'Waiting-time model training and evaluation',
    ],
  });
});

module.exports = router;
