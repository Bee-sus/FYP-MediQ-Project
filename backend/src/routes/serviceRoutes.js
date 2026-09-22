const express = require('express');
const { pool } = require('../config/database');
const router = express.Router();
router.get('/', async (request, response) => {
  try {
    const [rows] = await pool.execute(`SELECT id, name, description, average_duration_minutes AS averageDurationMinutes,
      is_queue_open AS isQueueOpen FROM clinic_services WHERE is_active = TRUE ORDER BY name`);
    return response.json({ source: 'database', services: rows.map(row => ({ ...row, availability: row.isQueueOpen ? 'Available' : 'Queue closed' })) });
  } catch (error) { return response.status(503).json({ error: 'Clinic services are temporarily unavailable.' }); }
});
module.exports = router;
