const express = require('express');
const { pool } = require('../config/database');
const { requireRole } = require('../middleware/authentication');
const router = express.Router();
router.patch('/services/:serviceId/notice', ...requireRole('staff'), async (request, response) => {
  const serviceId = Number(request.params.serviceId);
  const notice = typeof request.body.notice === 'string' ? request.body.notice.trim() : null;
  if (!Number.isSafeInteger(serviceId) || serviceId < 1 || notice === null || notice.length > 300 || (notice.length > 0 && notice.length < 3)) return response.status(422).json({ error: 'Enter a notice between 3 and 300 characters, or leave it empty to clear it.' });
  let connection;
  try {
    connection = await pool.getConnection(); await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT id FROM clinic_services WHERE id = ? AND is_active = TRUE FOR UPDATE', [serviceId]);
    if (!rows.length) { await connection.rollback(); return response.status(404).json({ error: 'Clinic service not found.' }); }
    await connection.execute('UPDATE clinic_services SET delay_notice = ?, delay_notice_updated_at = CURRENT_TIMESTAMP WHERE id = ?', [notice || null, serviceId]);
    await connection.execute("INSERT INTO staff_audit_logs (staff_id, action, entity_type, entity_id, details) VALUES (?, ?, 'clinic_service', ?, ?)", [request.user.id, notice ? 'service_notice_updated' : 'service_notice_cleared', serviceId, notice || 'Notice cleared']);
    await connection.commit();
    return response.json({ message: notice ? 'Service notice published.' : 'Service notice cleared.', delayNotice: notice || null });
  } catch (error) {
    if (connection) await connection.rollback();
    return response.status(503).json({ error: 'Service notice could not be saved. Please try again.' });
  } finally { if (connection) connection.release(); }
});
module.exports = router;
