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
    milestone: 'Initial system foundation',
    completed: [
      'Node.js and Express server scaffold',
      'Initial responsive user interface',
      'MySQL connection configuration',
      'Draft database schema',
      'Machine-learning service boundary defined',
    ],
    planned: [
      'User authentication and role permissions',
      'Patient queue registration workflow',
      'Staff queue management dashboard',
      'Waiting-time model training and evaluation',
    ],
  });
});

module.exports = router;
