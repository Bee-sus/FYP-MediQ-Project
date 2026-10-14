const express = require('express');
const { pool } = require('../config/database');
const { requireRole } = require('../middleware/authentication');
const { MODEL_VERSION, estimateLiveRemainingWait } = require('../services/waitPredictionService');
const { formatQueueTicket } = require('../services/queueTicket');
const { validProfilePicture } = require('../services/profilePictureService');
const { hashPassword, verifyPassword, meetsPasswordRules } = require('../services/passwordService');
const { validDate } = require('../services/appointmentService');
const { generateStaffReportPdf } = require('../services/staffReportPdf');

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
              TIMESTAMPDIFF(SECOND, q.joined_at, CURRENT_TIMESTAMP) AS elapsedQueueSeconds,
              q.called_at AS calledAt, q.consultation_started_at AS consultationStartedAt,
              q.service_id AS serviceId, q.cancellation_reason AS cancellationReason, u.full_name AS patientName,
              s.average_duration_minutes AS averageDurationMinutes,
              (SELECT COUNT(*) FROM queue_entries ahead
               WHERE ahead.service_id = q.service_id AND ahead.queue_date = q.queue_date
                 AND ahead.queue_number < q.queue_number AND ahead.status IN ('waiting','called','in_progress')) AS peopleAhead,
              (SELECT COUNT(*) FROM queue_entries done
               WHERE done.service_id = q.service_id AND done.queue_date = q.queue_date
                 AND done.status = 'completed' AND done.completed_at >= CURRENT_TIMESTAMP - INTERVAL 30 MINUTE) AS completedLast30m,
              (SELECT MAX(TIMESTAMPDIFF(SECOND, ahead.consultation_started_at, CURRENT_TIMESTAMP)) / 60.0
               FROM queue_entries ahead
               WHERE ahead.service_id = q.service_id AND ahead.queue_date = q.queue_date
                 AND ahead.queue_number < q.queue_number AND ahead.status = 'in_progress'
                 AND ahead.consultation_started_at IS NOT NULL) AS consultationElapsedMinutesAhead,
              (SELECT estimated_minutes FROM waiting_time_predictions p
               WHERE p.queue_entry_id = q.id ORDER BY p.predicted_at DESC LIMIT 1) AS estimatedMinutes,
              (SELECT model_version FROM waiting_time_predictions p
               WHERE p.queue_entry_id = q.id ORDER BY p.predicted_at DESC LIMIT 1) AS predictionModel
       FROM queue_entries q JOIN users u ON u.id = q.patient_id
       JOIN clinic_services s ON s.id = q.service_id
       WHERE q.queue_date = CURRENT_DATE AND q.status IN ('waiting','called','in_progress','cancelled')
       ORDER BY q.service_id, FIELD(q.status, 'in_progress','called','waiting','cancelled'), q.queue_number`,
    );
    return response.json({ services, entries: entries.map((entry) => entry.status === 'cancelled'
      ? entry : { ...entry, ...estimateLiveRemainingWait(entry) }) });
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
      [request.user.id, `queue_${nextStatus}`, queueId, `${formatQueueTicket(entry.serviceId, entry.queueNumber)} · ${entry.serviceName}`],
    );
    await connection.commit();
    return response.json({ message: `Queue ${formatQueueTicket(entry.serviceId, entry.queueNumber)} updated to ${nextStatus.replace('_', ' ')}.` });
  } catch (error) {
    if (connection) await connection.rollback();
    return response.status(503).json({ error: 'The queue status could not be updated.' });
  } finally {
    if (connection) connection.release();
  }
});

router.post('/queues/:queueId/complete-and-call-next', ...requireRole('staff'), async (request, response) => {
  const queueId = Number(request.params.queueId);
  if (!Number.isSafeInteger(queueId) || queueId < 1) return response.status(422).json({ error: 'Provide a valid queue entry.' });

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
    if (entry.status !== 'in_progress') {
      await connection.rollback();
      return response.status(409).json({ error: 'Only a consultation in progress can be completed.' });
    }

    const [waitingRows] = await connection.execute(
      `SELECT id, patient_id AS patientId, queue_number AS queueNumber
       FROM queue_entries
       WHERE service_id = ? AND queue_date = CURRENT_DATE AND status = 'waiting'
       ORDER BY queue_number LIMIT 1 FOR UPDATE`,
      [entry.serviceId],
    );
    const next = waitingRows[0] || null;
    await connection.execute("UPDATE queue_entries SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?", [queueId]);
    await connection.execute(
      `INSERT INTO notifications (patient_id, queue_entry_id, title, message, notification_type)
       VALUES (?, ?, ?, ?, 'queue')`,
      [entry.patientId, queueId, transitionDetails.completed.title, transitionDetails.completed.message],
    );
    await connection.execute(
      `INSERT INTO staff_audit_logs (staff_id, action, entity_type, entity_id, details)
       VALUES (?, 'queue_completed', 'queue_entry', ?, ?)`,
      [request.user.id, queueId, `${formatQueueTicket(entry.serviceId, entry.queueNumber)} · ${entry.serviceName}`],
    );
    if (next) {
      await connection.execute("UPDATE queue_entries SET status = 'called', called_at = CURRENT_TIMESTAMP WHERE id = ?", [next.id]);
      await connection.execute(
        `INSERT INTO notifications (patient_id, queue_entry_id, title, message, notification_type)
         VALUES (?, ?, ?, ?, 'queue')`,
        [next.patientId, next.id, transitionDetails.called.title, transitionDetails.called.message],
      );
      await connection.execute(
        `INSERT INTO staff_audit_logs (staff_id, action, entity_type, entity_id, details)
         VALUES (?, 'queue_called', 'queue_entry', ?, ?)`,
        [request.user.id, next.id, `${formatQueueTicket(entry.serviceId, next.queueNumber)} · ${entry.serviceName}`],
      );
    }
    await connection.commit();
    const completedNumber = formatQueueTicket(entry.serviceId, entry.queueNumber);
    const nextNumber = next ? formatQueueTicket(entry.serviceId, next.queueNumber) : null;
    return response.json({
      message: next ? `${completedNumber} completed and ${nextNumber} called.` : `${completedNumber} completed. No patient is waiting in this service.`,
      calledQueueId: next?.id || null,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    return response.status(503).json({ error: 'The queue could not be advanced.' });
  } finally {
    if (connection) connection.release();
  }
});

router.get('/profile', ...requireRole('staff'), async (request, response) => {
  try {
    const [rows] = await pool.execute(`SELECT staff_code AS staffCode, full_name AS fullName, email,
      phone_number AS phone, profile_picture_url AS profilePictureUrl
      FROM users WHERE id = ? AND role = 'staff' LIMIT 1`, [request.user.id]);
    if (!rows.length) return response.status(404).json({ error: 'Staff account not found.' });
    return response.json({ profile: rows[0] });
  } catch (error) { return response.status(503).json({ error: 'Staff profile is unavailable.' }); }
});

router.patch('/profile', ...requireRole('staff'), async (request, response) => {
  const fullName = String(request.body.fullName || '').trim();
  const phone = String(request.body.phone || '').trim();
  const profilePictureUrl = String(request.body.profilePictureUrl || '').trim();
  if (fullName.length < 2 || fullName.length > 120 || phone.length < 7 || phone.length > 30
      || !validProfilePicture(profilePictureUrl)) {
    return response.status(422).json({ error: 'Enter a valid name, contact number and optional picture.' });
  }
  try {
    await pool.execute(`UPDATE users SET full_name = ?, phone_number = ?, profile_picture_url = ?
      WHERE id = ? AND role = 'staff'`, [fullName, phone, profilePictureUrl || null, request.user.id]);
    return response.json({ message: 'Staff profile updated.' });
  } catch (error) { return response.status(503).json({ error: 'Staff profile could not be updated.' }); }
});

router.patch('/password', ...requireRole('staff'), async (request, response) => {
  const currentPassword = String(request.body.currentPassword || '');
  const newPassword = String(request.body.newPassword || '');
  if (!meetsPasswordRules(newPassword) || currentPassword === newPassword) return response.status(422).json({ error: 'Use a different strong password with at least 12 characters.' });
  try {
    const [rows] = await pool.execute("SELECT password_hash AS passwordHash FROM users WHERE id = ? AND role = 'staff'", [request.user.id]);
    if (!rows.length || !(await verifyPassword(currentPassword, rows[0].passwordHash))) return response.status(401).json({ error: 'Current password is incorrect.' });
    await pool.execute("UPDATE users SET password_hash = ?, must_change_password = FALSE WHERE id = ? AND role = 'staff'", [await hashPassword(newPassword), request.user.id]);
    return response.json({ message: 'Password changed successfully.' });
  } catch (error) { return response.status(503).json({ error: 'Password could not be changed.' }); }
});

async function loadStaffReport(from, to) {
  const [summary] = await pool.execute(`SELECT COUNT(*) AS totalPatients,
      SUM(q.status = 'completed') AS completed, SUM(q.status = 'cancelled') AS cancelled,
      ROUND(AVG(CASE WHEN q.consultation_started_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, q.joined_at, q.consultation_started_at) END), 1) AS averageWaitMinutes,
      ROUND(AVG(CASE WHEN q.completed_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, q.consultation_started_at, q.completed_at) END), 1) AS averageConsultationMinutes
      FROM queue_entries q WHERE q.queue_date BETWEEN ? AND ?`, [from, to]);
  const [services] = await pool.execute(`SELECT s.name AS serviceName, COUNT(q.id) AS patientCount,
      SUM(q.status = 'completed') AS completed FROM clinic_services s LEFT JOIN queue_entries q
      ON q.service_id = s.id AND q.queue_date BETWEEN ? AND ? GROUP BY s.id, s.name ORDER BY patientCount DESC, s.name`, [from, to]);
  const [predictionRows] = await pool.execute(`SELECT COUNT(*) AS measuredVisits,
      SUM(p.model_version = ?) AS modelVisits,
      SUM(p.model_version <> ?) AS fallbackVisits,
      ROUND(AVG(CASE WHEN p.model_version = ? THEN ABS(p.estimated_minutes - p.actual_wait_minutes) END), 1) AS meanAbsoluteErrorMinutes,
      SUM(CASE WHEN p.model_version = ? AND ABS(p.estimated_minutes - p.actual_wait_minutes) <= 5 THEN 1 ELSE 0 END) AS withinFiveMinutes
      FROM queue_entries q JOIN waiting_time_predictions p ON p.queue_entry_id = q.id
        AND p.id = (SELECT MAX(latest.id) FROM waiting_time_predictions latest WHERE latest.queue_entry_id = q.id)
      WHERE q.queue_date BETWEEN ? AND ? AND q.consultation_started_at IS NOT NULL
        AND p.actual_wait_minutes IS NOT NULL`, [MODEL_VERSION, MODEL_VERSION, MODEL_VERSION, MODEL_VERSION, from, to]);
  const [predictionServices] = await pool.execute(`SELECT s.name AS serviceName, COUNT(*) AS measuredVisits,
      ROUND(AVG(ABS(p.estimated_minutes - p.actual_wait_minutes)), 1) AS meanAbsoluteErrorMinutes,
      SUM(ABS(p.estimated_minutes - p.actual_wait_minutes) <= 5) AS withinFiveMinutes
      FROM queue_entries q JOIN clinic_services s ON s.id = q.service_id
      JOIN waiting_time_predictions p ON p.queue_entry_id = q.id
        AND p.id = (SELECT MAX(latest.id) FROM waiting_time_predictions latest WHERE latest.queue_entry_id = q.id)
      WHERE q.queue_date BETWEEN ? AND ? AND q.consultation_started_at IS NOT NULL
        AND p.actual_wait_minutes IS NOT NULL AND p.model_version = ?
      GROUP BY s.id, s.name ORDER BY measuredVisits DESC, s.name`, [from, to, MODEL_VERSION]);
  const prediction = predictionRows[0] || {};
  return {
    from, to, summary: summary[0], services,
    predictionPerformance: {
      measuredVisits: Number(prediction.measuredVisits || 0),
      modelVisits: Number(prediction.modelVisits || 0),
      fallbackVisits: Number(prediction.fallbackVisits || 0),
      meanAbsoluteErrorMinutes: prediction.meanAbsoluteErrorMinutes == null ? null : Number(prediction.meanAbsoluteErrorMinutes),
      withinFiveMinutes: Number(prediction.withinFiveMinutes || 0),
      services: predictionServices.map(service => ({
        serviceName: service.serviceName,
        measuredVisits: Number(service.measuredVisits || 0),
        meanAbsoluteErrorMinutes: service.meanAbsoluteErrorMinutes == null ? null : Number(service.meanAbsoluteErrorMinutes),
        withinFiveMinutes: Number(service.withinFiveMinutes || 0),
      })),
    },
  };
}

function reportDates(request) {
  const from = String(request.query.from || '');
  const to = String(request.query.to || '');
  return validDate(from) && validDate(to) && from <= to ? { from, to } : null;
}

router.get('/reports', ...requireRole('staff'), async (request, response) => {
  const dates = reportDates(request);
  if (!dates) return response.status(422).json({ error: 'Choose a valid report start and end date.' });
  try {
    return response.json(await loadStaffReport(dates.from, dates.to));
  } catch (error) { return response.status(503).json({ error: 'The staff report could not be generated.' }); }
});

router.get('/reports/pdf', ...requireRole('staff'), async (request, response) => {
  const dates = reportDates(request);
  if (!dates) return response.status(422).json({ error: 'Choose a valid report start and end date.' });
  try {
    const report = await loadStaffReport(dates.from, dates.to);
    const pdf = await generateStaffReportPdf(report);
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="mediq-queue-report-${dates.from}-to-${dates.to}.pdf"`,
      'Content-Length': pdf.length,
      'Cache-Control': 'no-store',
    });
    return response.send(pdf);
  } catch (error) { return response.status(503).json({ error: 'The PDF report could not be generated.' }); }
});

module.exports = router;
