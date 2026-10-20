const express = require('express');
const { pool } = require('../config/database');
const { requireRole } = require('../middleware/authentication');

module.exports = function arrivalRoutes(role) {
  const router = express.Router();
  router.post('/queues/:queueId/arrive', ...requireRole(role), async (request, response) => {
    const id = Number(request.params.queueId);
    if (!Number.isSafeInteger(id) || id < 1) return response.status(422).json({ error: 'Invalid queue entry.' });
    const ownership = role === 'patient' ? ' AND patient_id = ?' : '';
    const params = role === 'patient' ? [id, request.user.id] : [id];
    try {
      const [result] = await pool.execute(`UPDATE queue_entries SET arrived_at = COALESCE(arrived_at, CURRENT_TIMESTAMP)
        WHERE id = ? AND queue_date = CURRENT_DATE AND status IN ('waiting','called','not_present')${ownership}`, params);
      if (!result.affectedRows) {
        const [rows] = await pool.execute(`SELECT id FROM queue_entries WHERE id = ? AND queue_date = CURRENT_DATE AND status IN ('waiting','called','not_present') AND arrived_at IS NOT NULL${ownership}`, params);
        if (!rows.length) return response.status(409).json({ error: 'This entry is no longer available for arrival check-in. Refresh your queue.' });
      }
      return response.json({ message: role === 'patient' ? 'You are checked in. Staff can see that you have arrived.' : 'Patient arrival confirmed.' });
    } catch (error) { return response.status(503).json({ error: 'Arrival could not be confirmed. Please try again.' }); }
  });
  return router;
};
