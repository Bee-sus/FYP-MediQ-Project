const express = require('express');
const { pool } = require('../config/database');
const { requireRole } = require('../middleware/authentication');

const router = express.Router();

router.get('/overview', ...requireRole('patient'), async (request, response) => {
  try {
    const [activeQueues] = await pool.execute(
      `SELECT q.id, q.queue_number AS queueNumber, q.status, q.joined_at AS joinedAt,
              s.name AS serviceName,
              (SELECT COUNT(*) FROM queue_entries ahead
               WHERE ahead.service_id = q.service_id AND ahead.queue_date = q.queue_date
                 AND ahead.queue_number < q.queue_number AND ahead.status IN ('waiting','called','in_progress')) AS peopleAhead,
              (SELECT estimated_minutes FROM waiting_time_predictions p
               WHERE p.queue_entry_id = q.id ORDER BY p.predicted_at DESC LIMIT 1) AS estimatedMinutes
       FROM queue_entries q JOIN clinic_services s ON s.id = q.service_id
       WHERE q.patient_id = ? AND q.queue_date = CURRENT_DATE
         AND q.status IN ('waiting','called','in_progress')
       ORDER BY q.joined_at DESC LIMIT 1`,
      [request.user.id],
    );
    const [services] = await pool.execute(
      `SELECT id, name, description, average_duration_minutes AS averageDurationMinutes
       FROM clinic_services WHERE is_active = TRUE ORDER BY name`,
    );
    const [history] = await pool.execute(
      `SELECT q.id, q.queue_number AS queueNumber, q.queue_date AS queueDate, q.status,
              s.name AS serviceName
       FROM queue_entries q JOIN clinic_services s ON s.id = q.service_id
       WHERE q.patient_id = ? ORDER BY q.joined_at DESC LIMIT 5`,
      [request.user.id],
    );
    return response.json({ user: request.user, activeQueue: activeQueues[0] || null, services, recentQueues: history });
  } catch (error) {
    return response.status(503).json({ error: 'Patient dashboard data is temporarily unavailable.' });
  }
});

module.exports = router;
