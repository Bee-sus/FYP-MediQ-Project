const express = require('express');

const router = express.Router();

// Temporary development data. This will be replaced by MySQL queries
// after the database connection is configured.
const clinicServices = [
  {
    id: 1,
    name: 'General Consultation',
    description: 'Standard consultation with a clinic doctor.',
    averageDurationMinutes: 15,
    availability: 'Available',
  },
  {
    id: 2,
    name: 'Follow-up Consultation',
    description: 'Follow-up visit for an existing condition.',
    averageDurationMinutes: 10,
    availability: 'Available',
  },
];

router.get('/', (request, response) => {
  response.json({
    source: 'development-data',
    services: clinicServices,
  });
});

module.exports = router;
