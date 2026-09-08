const express = require('express');
const { pool } = require('../config/database');
const { requireRole } = require('../middleware/authentication');

const router = express.Router();

const transitions = {
  waiting: new Set(['called', 'skipped']),
  called: new Set(['in_progress', 'skipped']),
  in_progress: new Set(['completed']),
  skipped: new Set(['waiting', 'called']),
};

const transitionDetails = {
  called: { title: 'It is your turn', message: 'Clinic staff have called your queue number. Please proceed to the clinic counter.' },
  in_progress: { title: 'Consultation started', message: 'Your consultation is now in progress.' },
  completed: { title: 'Consultation completed', message: 'Your consultation has been marked as completed. Thank you for visiting.' },
  skipped: { title: 'Queue number skipped', message: 'Your queue number was skipped. Please speak to clinic staff if you are present.' },
  waiting: { title: 'Returned to queue', message: 'Clinic staff have returned your number to the waiting queue.' },
};

router.get('/overview', ...requireRole('staff'), async (request, response) => {
  try {
    const [counts] = await pool.execute(
      `SELECT COUNT(*) AS total,
              SUM(status = 'waiting') AS waiting,
              SUM(status = 'called') AS called,
              SUM(status = 'in_progress') AS inProgress,
              SUM(status = 'completed') AS completed,
              SUM(status = 'skipped') AS skipped
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
        completed: Number(counts[0].completed || 0), skipped: Number(counts[0].skipped || 0),
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
      `SELECT id, name, is_active AS isActive, is_queue_open AS isQueueOpen
       FROM clinic_services WHERE is_active = TRUE ORDER BY name`,
    );
    const [entries] = await pool.execute(
      `SELECT q.id, q.queue_number AS queueNumber, q.status, q.joined_at AS joinedAt,
              q.called_at AS calledAt, q.consultation_started_at AS consultationStartedAt,
              q.service_id AS serviceId, u.full_name AS patientName
       FROM queue_entries q JOIN users u ON u.id = q.patient_id
       WHERE q.queue_date = CURRENT_DATE AND q.status IN ('waiting','called','in_progress','skipped')
       ORDER BY q.service_id, FIELD(q.status, 'in_progress','called','waiting','skipped'), q.queue_number`,
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
    await connection.execute(`UPDATE queue_entries SET status = ?${timestamps} WHERE id = ?`, [nextStatus, queueId]);
    const notice = transitionDetails[nextStatus];
    await connection.execute(
      `INSERT INTO notifications (patient_id, queue_entry_id, title, message, notification_type)
       VALUES (?, ?, ?, ?, 'queue')`,
      [entry.patientId, queueId, notice.title, notice.message],
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

module.exports = router;
