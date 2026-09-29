const express = require('express');
const { pool } = require('../config/database');
const { requireRole } = require('../middleware/authentication');
const { validProfilePicture } = require('../services/profilePictureService');
const { hashPassword, verifyPassword, meetsPasswordRules } = require('../services/passwordService');

const router = express.Router();

const transitions = {
  waiting: new Set(['called', 'cancelled']),
  called: new Set(['in_progress', 'cancelled']),
  in_progress: new Set(['completed']),
};

const transitionDetails = {
  called: { title: 'It is your turn', message: 'Clinic staff have called your queue number. Please proceed to the clinic counter.' },
  in_progress: { title: 'Consultation started', message: 'Your consultation is now in progress.' },
  completed: { title: 'Consultation completed', message: 'Your consultation has been marked as completed. Thank you for visiting.' },
  cancelled: { title: 'Queue cancelled by staff', message: 'Clinic staff cancelled your queue entry.' },
};

router.get('/overview', ...requireRole('staff'), async (request, response) => {
  try {
    const [counts] = await pool.execute(
      `SELECT COUNT(*) AS total,
              SUM(status = 'waiting') AS waiting,
              SUM(status = 'called') AS called,
              SUM(status = 'in_progress') AS inProgress,
              SUM(status = 'completed') AS completed,
              SUM(status = 'cancelled') AS cancelled
       FROM queue_entries WHERE queue_date = CURRENT_DATE`,
    );
    const [appointmentRows] = await pool.execute("SELECT COUNT(*) AS pendingAppointments FROM appointments WHERE status = 'pending'");
    const [durationRows] = await pool.execute(
      `SELECT ROUND(AVG(TIMESTAMPDIFF(MINUTE, consultation_started_at, completed_at))) AS averageDuration
       FROM queue_entries WHERE queue_date = CURRENT_DATE AND status = 'completed'
         AND consultation_started_at IS NOT NULL AND completed_at IS NOT NULL`,
    );
    return response.json({
      user: request.user,
      summary: {
        total: Number(counts[0].total || 0), waiting: Number(counts[0].waiting || 0),
        called: Number(counts[0].called || 0), inProgress: Number(counts[0].inProgress || 0),
        completed: Number(counts[0].completed || 0), cancelled: Number(counts[0].cancelled || 0),
        pendingAppointments: Number(appointmentRows[0].pendingAppointments || 0),
        averageDuration: durationRows[0].averageDuration == null ? null : Number(durationRows[0].averageDuration),
      },
    });
  } catch (error) {
    return response.status(503).json({ error: 'Staff overview data is temporarily unavailable.' });
  }
});

router.get('/queues', ...requireRole('staff'), async (request, response) => {
  try {
    const [services] = await pool.execute(
      `SELECT id, name, queue_capacity AS queueCapacity, is_active AS isActive, is_queue_open AS isQueueOpen
       FROM clinic_services WHERE is_active = TRUE ORDER BY name`,
    );
    const [entries] = await pool.execute(
      `SELECT q.id, q.queue_number AS queueNumber, q.status, q.joined_at AS joinedAt,
              q.called_at AS calledAt, q.consultation_started_at AS consultationStartedAt,
              q.service_id AS serviceId, q.cancellation_reason AS cancellationReason, u.full_name AS patientName
       FROM queue_entries q JOIN users u ON u.id = q.patient_id
       WHERE q.queue_date = CURRENT_DATE AND q.status IN ('waiting','called','in_progress','cancelled')
       ORDER BY q.service_id, FIELD(q.status, 'in_progress','called','waiting','cancelled'), q.queue_number`,
    );
    return response.json({ services, entries });
  } catch (error) {
    return response.status(503).json({ error: 'Live queue data is temporarily unavailable.' });
  }
});

router.patch('/services/:serviceId/queue', ...requireRole('staff'), async (request, response) => {
  const serviceId = Number(request.params.serviceId);
  const isOpen = request.body.isOpen;
  if (!Number.isSafeInteger(serviceId) || serviceId < 1 || typeof isOpen !== 'boolean') {
    return response.status(422).json({ error: 'Provide a valid service and queue state.' });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [result] = await connection.execute('UPDATE clinic_services SET is_queue_open = ? WHERE id = ? AND is_active = TRUE', [isOpen, serviceId]);
    if (!result.affectedRows) {
      await connection.rollback();
      return response.status(404).json({ error: 'Clinic service not found.' });
    }
    await connection.execute(
      `INSERT INTO staff_audit_logs (staff_id, action, entity_type, entity_id, details)
       VALUES (?, ?, 'clinic_service', ?, ?)`,
      [request.user.id, isOpen ? 'queue_opened' : 'queue_closed', serviceId, isOpen ? 'Service queue opened' : 'Service queue closed'],
    );
    await connection.commit();
    return response.json({ message: `Service queue ${isOpen ? 'opened' : 'closed'}.`, isOpen });
  } catch (error) {
    if (connection) await connection.rollback();
    return response.status(503).json({ error: 'The service queue could not be updated.' });
  } finally {
    if (connection) connection.release();
  }
});

router.patch('/queues/:queueId/status', ...requireRole('staff'), async (request, response) => {
  const queueId = Number(request.params.queueId);
  const nextStatus = String(request.body.status || '');
  const reason = String(request.body.reason || '').trim();
  if (nextStatus === 'cancelled' && (reason.length < 3 || reason.length > 300)) return response.status(422).json({ error: 'Provide a cancellation reason between 3 and 300 characters.' });
  if (!Number.isSafeInteger(queueId) || queueId < 1 || !transitionDetails[nextStatus]) {
    return response.status(422).json({ error: 'Provide a valid queue entry and status.' });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT q.id, q.patient_id AS patientId, q.service_id AS serviceId, q.status,
              q.queue_number AS queueNumber, s.name AS serviceName
       FROM queue_entries q JOIN clinic_services s ON s.id = q.service_id
       WHERE q.id = ? AND q.queue_date = CURRENT_DATE FOR UPDATE`,
      [queueId],
    );
    if (!rows.length) {
      await connection.rollback();
      return response.status(404).json({ error: 'Today’s queue entry was not found.' });
    }
    const entry = rows[0];
    if (!transitions[entry.status] || !transitions[entry.status].has(nextStatus)) {
      await connection.rollback();
      return response.status(409).json({ error: `A ${entry.status.replace('_', ' ')} entry cannot move to ${nextStatus.replace('_', ' ')}.` });
    }
    if (entry.status === 'waiting' && nextStatus === 'called') {
      const [earlierEntries] = await connection.execute(
        `SELECT id FROM queue_entries
         WHERE service_id = ? AND queue_date = CURRENT_DATE AND status = 'waiting' AND queue_number < ?
         LIMIT 1`,
        [entry.serviceId, entry.queueNumber],
      );
      if (earlierEntries.length) {
        await connection.rollback();
        return response.status(409).json({ error: 'Call the earliest waiting patient in this service first.' });
      }
    }
    const timestamps = nextStatus === 'called' ? ', called_at = CURRENT_TIMESTAMP'
      : nextStatus === 'in_progress' ? ', consultation_started_at = CURRENT_TIMESTAMP'
        : nextStatus === 'completed' ? ', completed_at = CURRENT_TIMESTAMP' : '';
    if (nextStatus === 'cancelled') {
      await connection.execute('UPDATE queue_entries SET status = ?, cancelled_at = CURRENT_TIMESTAMP, cancellation_reason = ? WHERE id = ?', [nextStatus, reason, queueId]);
    } else {
      await connection.execute(`UPDATE queue_entries SET status = ?${timestamps} WHERE id = ?`, [nextStatus, queueId]);
    }
    if (nextStatus === 'in_progress') await connection.execute(
      `UPDATE waiting_time_predictions p JOIN queue_entries q ON q.id = p.queue_entry_id
       SET p.actual_wait_minutes = TIMESTAMPDIFF(MINUTE, q.joined_at, CURRENT_TIMESTAMP)
       WHERE p.queue_entry_id = ?`, [queueId],
    );
    const notice = transitionDetails[nextStatus];
    await connection.execute(
      `INSERT INTO notifications (patient_id, queue_entry_id, title, message, notification_type)
       VALUES (?, ?, ?, ?, 'queue')`,
      [entry.patientId, queueId, notice.title, nextStatus === 'cancelled' ? `${notice.message} Reason: ${reason}` : notice.message],
    );
    await connection.execute(
      `INSERT INTO staff_audit_logs (staff_id, action, entity_type, entity_id, details)
       VALUES (?, ?, 'queue_entry', ?, ?)`,
      [request.user.id, `queue_${nextStatus}`, queueId, `Q-${String(entry.queueNumber).padStart(3, '0')} · ${entry.serviceName}`],
    );
    await connection.commit();
    return response.json({ message: `Queue Q-${String(entry.queueNumber).padStart(3, '0')} updated to ${nextStatus.replace('_', ' ')}.` });
  } catch (error) {
    if (connection) await connection.rollback();
    return response.status(503).json({ error: 'The queue status could not be updated.' });
  } finally {
    if (connection) connection.release();
  }
});

router.get('/profile', ...requireRole('staff'), async (request, response) => {
  try {
    const [rows] = await pool.execute(`SELECT staff_code AS staffCode, full_name AS fullName, email,
      phone_number AS phone, profile_picture_url AS profilePictureUrl
      FROM users WHERE id = ? AND role = 'staff' LIMIT 1`, [request.user.id]);
    return response.json({ profile: rows[0] });
  } catch (error) { return response.status(503).json({ error: 'Staff profile is unavailable.' }); }
});

router.patch('/profile', ...requireRole('staff'), async (request, response) => {
  const fullName = String(request.body.fullName || '').trim();
  const phone = String(request.body.phone || '').trim();
  const profilePictureUrl = String(request.body.profilePictureUrl || '').trim();
  if (fullName.length < 2 || fullName.length > 120 || phone.length < 7 || phone.length > 30
      || !validProfilePicture(profilePictureUrl)) {
    return response.status(422).json({ error: 'Enter a valid name, contact number and optional picture URL.' });
  }
  try {
    await pool.execute(`UPDATE users SET full_name = ?, phone_number = ?, profile_picture_url = ?
      WHERE id = ? AND role = 'staff'`, [fullName, phone, profilePictureUrl || null, request.user.id]);
    return response.json({ message: 'Staff profile updated.' });
  } catch (error) { return response.status(503).json({ error: 'Staff profile could not be updated.' }); }
});

router.patch('/password', ...requireRole('staff'), async (request, response) => {
  const currentPassword = String(request.body.currentPassword || ''); const newPassword = String(request.body.newPassword || '');
  if (!meetsPasswordRules(newPassword) || currentPassword === newPassword) return response.status(422).json({ error: 'Use a different strong password with at least 12 characters.' });
  try {
    const [rows] = await pool.execute("SELECT password_hash AS passwordHash FROM users WHERE id = ? AND role = 'staff'", [request.user.id]);
    if (!rows.length || !(await verifyPassword(currentPassword, rows[0].passwordHash))) return response.status(401).json({ error: 'Current password is incorrect.' });
    await pool.execute("UPDATE users SET password_hash = ?, must_change_password = FALSE WHERE id = ? AND role = 'staff'", [await hashPassword(newPassword), request.user.id]);
    return response.json({ message: 'Password changed successfully.' });
  } catch (error) { return response.status(503).json({ error: 'Password could not be changed.' }); }
});

router.get('/reports', ...requireRole('staff'), async (request, response) => {
  const from = String(request.query.from || '');
  const to = String(request.query.to || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return response.status(422).json({ error: 'Choose a valid report start and end date.' });
  }
  try {
    const [summary] = await pool.execute(`SELECT COUNT(*) AS totalPatients,
      SUM(q.status = 'completed') AS completed, SUM(q.status = 'cancelled') AS cancelled,
      ROUND(AVG(CASE WHEN q.consultation_started_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, q.joined_at, q.consultation_started_at) END), 1) AS averageWaitMinutes,
      ROUND(AVG(CASE WHEN q.completed_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, q.consultation_started_at, q.completed_at) END), 1) AS averageConsultationMinutes
      FROM queue_entries q WHERE q.queue_date BETWEEN ? AND ?`, [from, to]);
    const [services] = await pool.execute(`SELECT s.name AS serviceName, COUNT(q.id) AS patientCount,
      SUM(q.status = 'completed') AS completed FROM clinic_services s LEFT JOIN queue_entries q
      ON q.service_id = s.id AND q.queue_date BETWEEN ? AND ? GROUP BY s.id, s.name ORDER BY patientCount DESC, s.name`, [from, to]);
    return response.json({ from, to, summary: summary[0], services });
  } catch (error) { return response.status(503).json({ error: 'The staff report could not be generated.' }); }
});

module.exports = router;
