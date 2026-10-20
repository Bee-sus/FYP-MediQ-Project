const express = require('express');
const { pool } = require('../config/database');
const { requireRole } = require('../middleware/authentication');
const { hashPassword, verifyPassword, meetsPasswordRules } = require('../services/passwordService');

const { validDate, futureSlot, lockBookings, hasConflict } = require('../services/appointmentService');

const { validTime, slotIsOpen } = require('../services/clinicScheduleService');
const { estimateLiveRemainingWait, predictInitialWait } = require('../services/waitPredictionService');
const { formatQueueTicket } = require('../services/queueTicket');

const { validateIdentity } = require('../services/patientIdentity');
const router = express.Router();
const activeStatuses = "'waiting','called','in_progress'";
const activeTicketStatuses = activeStatuses + ",'not_present'";

async function createAppointmentReminders(patientId) {
  await pool.execute(`INSERT INTO notifications (patient_id, appointment_id, title, message, notification_type)
    SELECT a.patient_id, a.id, 'Appointment reminder', CONCAT('Reminder: your ', s.name, ' appointment is on ', DATE_FORMAT(a.appointment_date, '%d %b %Y'), ' at ', TIME_FORMAT(a.appointment_time, '%h:%i %p'), '.'), 'appointment'
    FROM appointments a JOIN clinic_services s ON s.id = a.service_id
    WHERE a.patient_id = ? AND a.status = 'approved' AND a.appointment_date BETWEEN CURRENT_DATE AND DATE_ADD(CURRENT_DATE, INTERVAL 1 DAY)
      AND a.reminder_sent_at IS NULL`, [patientId]);
  await pool.execute(`UPDATE appointments SET reminder_sent_at = CURRENT_TIMESTAMP WHERE patient_id = ? AND status = 'approved'
    AND appointment_date BETWEEN CURRENT_DATE AND DATE_ADD(CURRENT_DATE, INTERVAL 1 DAY) AND reminder_sent_at IS NULL`, [patientId]);
}

function queueSelect(whereClause) {
  return `SELECT q.id, q.queue_number AS queueNumber, q.status, q.called_at AS calledAt, q.missed_call_at AS missedCallAt, q.join_location AS joinLocation, q.arrived_at AS arrivedAt, q.joined_at AS joinedAt,
                 q.cancelled_at AS cancelledAt, q.cancellation_reason AS cancellationReason,
                 s.id AS serviceId, s.name AS serviceName, s.delay_notice AS delayNotice, s.delay_notice_updated_at AS delayNoticeUpdatedAt,
                 s.average_duration_minutes AS averageDurationMinutes,
                 (SELECT COUNT(*) FROM queue_entries ahead
                  WHERE ahead.service_id = q.service_id AND ahead.queue_date = q.queue_date
                    AND ahead.queue_number < q.queue_number AND ahead.status IN ('waiting','called','in_progress')) AS peopleAhead,
                 (SELECT COUNT(*) FROM queue_entries done
                  WHERE done.service_id = q.service_id AND done.queue_date = q.queue_date
                    AND done.status = 'completed'
                    AND done.completed_at >= CURRENT_TIMESTAMP - INTERVAL 30 MINUTE) AS completedLast30m,
                 (SELECT MAX(TIMESTAMPDIFF(SECOND, ahead.consultation_started_at, CURRENT_TIMESTAMP)) / 60.0
                  FROM queue_entries ahead
                  WHERE ahead.service_id = q.service_id AND ahead.queue_date = q.queue_date
                    AND ahead.queue_number < q.queue_number AND ahead.status = 'in_progress'
                    AND ahead.consultation_started_at IS NOT NULL) AS consultationElapsedMinutesAhead,
                 (SELECT estimated_minutes FROM waiting_time_predictions p
                  WHERE p.queue_entry_id = q.id ORDER BY p.predicted_at DESC LIMIT 1) AS estimatedMinutes,
                 (SELECT model_version FROM waiting_time_predictions p
                  WHERE p.queue_entry_id = q.id ORDER BY p.predicted_at DESC LIMIT 1) AS predictionModel,
                 (SELECT n.message FROM notifications n
                  WHERE n.queue_entry_id = q.id AND n.title = 'Queue reminder'
                  ORDER BY n.created_at DESC LIMIT 1) AS reminderMessage
          FROM queue_entries q JOIN clinic_services s ON s.id = q.service_id
          WHERE ${whereClause}`;
}

router.get('/overview', ...requireRole('patient'), async (request, response) => {
  try {
    await createAppointmentReminders(request.user.id);
    const [activeQueues] = await pool.execute(
      `${queueSelect(`q.patient_id = ? AND q.queue_date = CURRENT_DATE AND q.status IN (${activeTicketStatuses})`)}
       ORDER BY q.joined_at DESC LIMIT 1`,
      [request.user.id],
    );
    const [services] = await pool.execute(
      `SELECT s.id, s.name, s.description, s.doctor_name AS doctorName, s.service_details AS serviceDetails, s.average_duration_minutes AS averageDurationMinutes,
       s.delay_notice AS delayNotice, s.queue_capacity AS queueCapacity, (SELECT COUNT(*) FROM queue_entries q WHERE q.service_id = s.id AND q.queue_date = CURRENT_DATE AND q.status IN (${activeStatuses})) AS activePatients
       FROM clinic_services s WHERE s.is_active = TRUE ORDER BY s.name`,
    );
    const [history] = await pool.execute(
      `SELECT q.id, q.queue_number AS queueNumber, q.queue_date AS queueDate, q.status,
              s.id AS serviceId, s.name AS serviceName
       FROM queue_entries q JOIN clinic_services s ON s.id = q.service_id
       WHERE q.patient_id = ? ORDER BY q.joined_at DESC LIMIT 3`,
      [request.user.id],
    );
    const [appointments] = await pool.execute(
      `SELECT a.id, DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointmentDate,
              TIME_FORMAT(a.appointment_time, '%H:%i') AS appointmentTime,
              a.status, s.name AS serviceName
       FROM appointments a JOIN clinic_services s ON s.id = a.service_id
       WHERE a.patient_id = ? AND a.appointment_date >= CURRENT_DATE
         AND a.status IN ('pending', 'approved', 'reschedule_proposed')
       ORDER BY a.appointment_date, a.appointment_time LIMIT 1`,
      [request.user.id],
    );
    const [notifications] = await pool.execute(
      `SELECT id, title, message, notification_type AS type, read_at AS readAt, created_at AS createdAt
       FROM notifications WHERE patient_id = ? ORDER BY created_at DESC LIMIT 3`,
      [request.user.id],
    );
    const [unreadRows] = await pool.execute(
      'SELECT COUNT(*) AS unreadCount FROM notifications WHERE patient_id = ? AND read_at IS NULL',
      [request.user.id],
    );
    return response.json({
      user: request.user,
      activeQueue: activeQueues[0] ? { ...activeQueues[0], ...estimateLiveRemainingWait(activeQueues[0]) } : null,
      services,
      recentQueues: history,
      nextAppointment: appointments[0] || null,
      notifications,
      unreadNotificationCount: Number(unreadRows[0].unreadCount),
    });
  } catch (error) {
    return response.status(503).json({ error: 'Patient dashboard data is temporarily unavailable.' });
  }
});

router.get('/services', ...requireRole('patient'), async (request, response) => {
  try {
    const [services] = await pool.execute(
      `SELECT s.id, s.name, s.description, s.doctor_name AS doctorName, s.service_details AS serviceDetails, s.average_duration_minutes AS averageDurationMinutes,
       s.delay_notice AS delayNotice, s.queue_capacity AS queueCapacity, (SELECT COUNT(*) FROM queue_entries q WHERE q.service_id = s.id AND q.queue_date = CURRENT_DATE AND q.status IN (${activeStatuses})) AS activePatients
       FROM clinic_services s WHERE s.is_active = TRUE ORDER BY s.name`,
    );
    return response.json({ services });
  } catch (error) {
    return response.status(503).json({ error: 'Clinic services are temporarily unavailable.' });
  }
});

router.get('/queues/availability', ...requireRole('patient'), async (request, response) => {
  try {
    const [services] = await pool.execute(
      `SELECT s.id, s.name, s.description, s.doctor_name AS doctorName,
              s.service_details AS serviceDetails, s.average_duration_minutes AS averageDurationMinutes,
              s.queue_capacity AS queueCapacity, s.is_queue_open AS isQueueOpen, s.delay_notice AS delayNotice,
              COUNT(CASE WHEN q.status IN (${activeStatuses}) THEN q.id END) AS activePatients,
              COALESCE(MAX(q.queue_number), 0) AS lastQueueNumber
       FROM clinic_services s
       LEFT JOIN queue_entries q ON q.service_id = s.id AND q.queue_date = CURRENT_DATE
       WHERE s.is_active = TRUE
       GROUP BY s.id, s.name, s.description, s.doctor_name, s.service_details,
                s.average_duration_minutes, s.queue_capacity, s.is_queue_open, s.delay_notice
       ORDER BY s.name`,
    );
    const availability = await Promise.all(services.map(async (service) => {
      const activePatients = Number(service.activePatients) || 0;
      const queueCapacity = service.queueCapacity == null ? null : Number(service.queueCapacity);
      const isQueueOpen = Boolean(Number(service.isQueueOpen));
      const isFull = queueCapacity != null && queueCapacity > 0 && activePatients >= queueCapacity;
      const { lastQueueNumber, ...publicService } = service;
      if (!isQueueOpen || isFull) {
        return { ...publicService, activePatients, queueCapacity, isQueueOpen, estimatedWaitMinutes: null, estimateSource: null };
      }
      const prediction = await predictInitialWait({
        connection: pool,
        serviceId: service.id,
        aheadCount: Number(lastQueueNumber) || 0,
        baselineAheadCount: activePatients,
        averageDurationMinutes: service.averageDurationMinutes,
      });
      return {
        ...publicService, activePatients, queueCapacity, isQueueOpen,
        estimatedWaitMinutes: prediction.estimatedMinutes,
        estimateSource: prediction.modelVersion,
      };
    }));
    response.set('Cache-Control', 'no-store');
    return response.json({ services: availability, updatedAt: new Date().toISOString() });
  } catch (error) {
    return response.status(503).json({ error: 'Current queue availability is temporarily unavailable.' });
  }
});

router.get('/queues/active', ...requireRole('patient'), async (request, response) => {
  try {
    const [rows] = await pool.execute(
      `${queueSelect(`q.patient_id = ? AND q.queue_date = CURRENT_DATE AND q.status IN (${activeTicketStatuses})`)}
       ORDER BY q.joined_at DESC LIMIT 1`,
      [request.user.id],
    );
    const queue = rows[0] ? { ...rows[0], ...estimateLiveRemainingWait(rows[0]) } : null;
    return response.json({ queue });
  } catch (error) {
    return response.status(503).json({ error: 'Queue status is temporarily unavailable.' });
  }
});

router.post('/queues', ...requireRole('patient'), async (request, response) => {
  const joinLocation = request.body.joinLocation ?? 'unknown';
  if (!['at_clinic', 'remote', 'unknown'].includes(joinLocation)) return response.status(422).json({ error: 'Choose whether you are at the clinic or joining remotely.' });
  const serviceId = Number(request.body.serviceId);
  if (!Number.isSafeInteger(serviceId) || serviceId < 1) {
    return response.status(422).json({ error: 'Select a valid clinic service.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [request.user.id]);

    const [existing] = await connection.execute(
      `SELECT id FROM queue_entries
       WHERE patient_id = ? AND queue_date = CURRENT_DATE AND status IN (${activeTicketStatuses})
       LIMIT 1`,
      [request.user.id],
    );
    if (existing.length) {
      await connection.rollback();
      return response.status(409).json({ error: 'You already have an active queue today.', queueId: existing[0].id });
    }

    const [services] = await connection.execute(
      `SELECT id, name, average_duration_minutes AS averageDurationMinutes, queue_capacity AS queueCapacity
       FROM clinic_services WHERE id = ? AND is_active = TRUE AND is_queue_open = TRUE FOR UPDATE`,
      [serviceId],
    );
    if (!services.length) {
      await connection.rollback();
      return response.status(404).json({ error: 'This clinic queue is currently closed.' });
    }

    const [numberRows] = await connection.execute(
      'SELECT COALESCE(MAX(queue_number), 0) + 1 AS nextNumber FROM queue_entries WHERE service_id = ? AND queue_date = CURRENT_DATE',
      [serviceId],
    );
    const queueNumber = Number(numberRows[0].nextNumber);
    const [countRows] = await connection.execute(
      `SELECT COUNT(*) AS peopleAhead FROM queue_entries
       WHERE service_id = ? AND queue_date = CURRENT_DATE AND status IN (${activeStatuses})`,
      [serviceId],
    );
    const peopleAhead = Number(countRows[0].peopleAhead);
    if (services[0].queueCapacity && peopleAhead >= Number(services[0].queueCapacity)) {
      await connection.rollback();
      return response.status(409).json({ error: 'This queue has reached its patient capacity. Please choose another service or try later.' });
    }
    const prediction = await predictInitialWait({
      connection,
      serviceId,
      aheadCount: Math.max(0, queueNumber - 1),
      baselineAheadCount: peopleAhead,
      averageDurationMinutes: services[0].averageDurationMinutes,
    });
    const estimatedMinutes = prediction.estimatedMinutes;
    const [queueResult] = await connection.execute(
      `INSERT INTO queue_entries (patient_id, service_id, queue_date, queue_number, status, join_location, arrived_at, is_test_visit)
       VALUES (?, ?, CURRENT_DATE, ?, 'waiting', ?, IF(? = 'at_clinic', CURRENT_TIMESTAMP, NULL), ?)`,
      [request.user.id, serviceId, queueNumber, joinLocation, joinLocation, process.env.QUEUE_VISIT_MODE === 'operational' ? 0 : 1],
    );
    await connection.execute(
      `INSERT INTO waiting_time_predictions
       (queue_entry_id, estimated_minutes, model_version, people_ahead, service_duration_minutes, joined_hour, joined_weekday)
       VALUES (?, ?, ?, ?, ?, HOUR(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')), WEEKDAY(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')))`,
      [queueResult.insertId, estimatedMinutes, prediction.modelVersion, peopleAhead, Number(services[0].averageDurationMinutes)],
    );
    await connection.execute(
      `INSERT INTO notifications (patient_id, queue_entry_id, title, message, notification_type)
       VALUES (?, ?, 'Queue joined', ?, 'queue')`,
      [request.user.id, queueResult.insertId, `Your queue number for ${services[0].name} is ${formatQueueTicket(serviceId, queueNumber)}.`],
    );
    await connection.commit();
    return response.status(201).json({
      message: 'You have joined the queue.',
      queue: {
        id: queueResult.insertId,
        queueNumber,
        serviceId,
        serviceName: services[0].name,
        status: 'waiting',
        joinLocation,
        peopleAhead,
        estimatedMinutes,
        predictionModel: prediction.modelVersion,
        predictionNotice: prediction.dataNotice,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      return response.status(409).json({ error: 'The queue changed while you were joining. Please try again.' });
    }
    return response.status(503).json({ error: 'The queue could not be joined. Please try again.' });
  } finally {
    if (connection) connection.release();
  }
});

router.post('/queues/:queueId/cancel', ...requireRole('patient'), async (request, response) => {
  const queueId = Number(request.params.queueId);
  const reason = String(request.body.reason || '').trim();
  if (!Number.isSafeInteger(queueId) || queueId < 1) return response.status(422).json({ error: 'Invalid queue entry.' });
  if (reason.length < 3 || reason.length > 300) {
    return response.status(422).json({ error: 'Provide a cancellation reason between 3 and 300 characters.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT id, status FROM queue_entries
       WHERE id = ? AND patient_id = ? AND queue_date = CURRENT_DATE FOR UPDATE`,
      [queueId, request.user.id],
    );
    if (!rows.length) {
      await connection.rollback();
      return response.status(404).json({ error: 'Queue entry was not found.' });
    }
    if (!['waiting', 'called', 'not_present'].includes(rows[0].status)) {
      await connection.rollback();
      return response.status(409).json({ error: 'This queue can no longer be cancelled.' });
    }
    await connection.execute(
      `UPDATE queue_entries SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancellation_reason = ?
       WHERE id = ? AND patient_id = ?`,
      [reason, queueId, request.user.id],
    );
    await connection.execute(
      `INSERT INTO notifications (patient_id, queue_entry_id, title, message, notification_type)
       VALUES (?, ?, 'Queue cancelled', 'Your queue entry was cancelled and remains available in your history.', 'queue')`,
      [request.user.id, queueId],
    );
    await connection.commit();
    return response.json({ message: 'Your queue entry has been cancelled.' });
  } catch (error) {
    if (connection) await connection.rollback();
    return response.status(503).json({ error: 'The queue could not be cancelled. Please try again.' });
  } finally {
    if (connection) connection.release();
  }
});

router.get('/history', ...requireRole('patient'), async (request, response) => {
  const allowedStatuses = new Set(['completed', 'cancelled', 'skipped']);
  const status = allowedStatuses.has(request.query.status) ? request.query.status : null;
  const page = Math.max(1, Number.parseInt(request.query.page, 10) || 1);
  const limit = 8;
  const offset = (page - 1) * limit;
  try {
    const statusClause = status ? ' AND q.status = ?' : '';
    const parameters = status ? [request.user.id, status] : [request.user.id];
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM queue_entries q WHERE q.patient_id = ?${statusClause}`,
      parameters,
    );
    const [items] = await pool.execute(
      `SELECT q.id, q.queue_number AS queueNumber, q.queue_date AS queueDate, q.joined_at AS joinedAt,
              q.status, q.cancellation_reason AS cancellationReason, s.id AS serviceId, s.name AS serviceName
       FROM queue_entries q JOIN clinic_services s ON s.id = q.service_id
       WHERE q.patient_id = ?${statusClause}
       ORDER BY q.joined_at DESC LIMIT ${limit} OFFSET ${offset}`,
      parameters,
    );
    return response.json({ items, page, totalPages: Math.max(1, Math.ceil(Number(countRows[0].total) / limit)), total: Number(countRows[0].total), status });
  } catch (error) {
    return response.status(503).json({ error: 'Queue history is temporarily unavailable.' });
  }
});

router.get('/appointments', ...requireRole('patient'), async (request, response) => {
  try {
    await createAppointmentReminders(request.user.id);
    const [items] = await pool.execute(
      `SELECT a.id, DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointmentDate, TIME_FORMAT(a.appointment_time, '%H:%i') AS appointmentTime,
              a.notes, a.status, a.rejection_reason AS rejectionReason, a.created_at AS createdAt,
              s.name AS serviceName
       FROM appointments a JOIN clinic_services s ON s.id = a.service_id
       WHERE a.patient_id = ? ORDER BY a.appointment_date DESC, a.appointment_time DESC`,
      [request.user.id],
    );
    return response.json({ appointments: items });
  } catch (error) {
    return response.status(503).json({ error: 'Appointments are temporarily unavailable.' });
  }
});

router.post('/appointments', ...requireRole('patient'), async (request, response) => {
  const serviceId = Number(request.body.serviceId);
  const date = String(request.body.appointmentDate || '');
  const time = String(request.body.appointmentTime || '');
  const notes = String(request.body.notes || '').trim();
  if (!Number.isSafeInteger(serviceId) || serviceId < 1) return response.status(422).json({ error: 'Select a valid clinic service.' });
  if (!validDate(date)) {
    return response.status(422).json({ error: 'Select a future appointment date.' });
  }
  if (!validTime(time)) {
    return response.status(422).json({ error: 'Select one of the available clinic time slots.' });
  }
  if (!futureSlot(date, time)) return response.status(422).json({ error: 'Select a future appointment date and time.' });
  if (notes.length > 500) return response.status(422).json({ error: 'Appointment notes cannot exceed 500 characters.' });
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await lockBookings(connection);
    if (!(await slotIsOpen(connection, date, time))) {
      await connection.rollback();
      return response.status(409).json({ error: 'The clinic is closed at that time. Select an available slot.' });
    }
    const [services] = await connection.execute('SELECT id, name FROM clinic_services WHERE id = ? AND is_active = TRUE', [serviceId]);
    if (!services.length) {
      await connection.rollback();
      return response.status(404).json({ error: 'This clinic service is unavailable.' });
    }
    if (await hasConflict(connection, request.user.id, date, time)) {
      await connection.rollback();
      return response.status(409).json({ error: 'This slot is already reserved, or you already have an appointment on this date. Choose another available slot.' });
    }
    const [result] = await connection.execute(
      `INSERT INTO appointments (patient_id, service_id, appointment_date, appointment_time, notes)
       VALUES (?, ?, ?, ?, ?)`,
      [request.user.id, serviceId, date, time, notes || null],
    );
    await connection.execute(
      `INSERT INTO notifications (patient_id, appointment_id, title, message, notification_type)
       VALUES (?, ?, 'Appointment requested', ?, 'appointment')`,
      [request.user.id, result.insertId, `Your ${services[0].name} request is waiting for clinic approval.`],
    );
    await connection.commit();
    return response.status(201).json({ message: 'Appointment request submitted for clinic approval.', appointmentId: result.insertId });
  } catch (error) {
    if (connection) await connection.rollback();
    return response.status(503).json({ error: 'The appointment request could not be submitted.' });
  } finally {
    if (connection) connection.release();
  }
});

router.post('/appointments/:appointmentId/cancel', ...requireRole('patient'), async (request, response) => {
  const appointmentId = Number(request.params.appointmentId);
  if (!Number.isSafeInteger(appointmentId) || appointmentId < 1) return response.status(422).json({ error: 'Invalid appointment.' });
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await lockBookings(connection);
    const [rows] = await connection.execute(
      `SELECT id FROM appointments WHERE id = ? AND patient_id = ? AND status IN ('pending','approved','reschedule_proposed') FOR UPDATE`,
      [appointmentId, request.user.id],
    );
    if (!rows.length) {
      await connection.rollback();
      return response.status(404).json({ error: 'An appointment eligible for cancellation was not found.' });
    }
    await connection.execute("UPDATE appointments SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP WHERE id = ? AND patient_id = ?", [appointmentId, request.user.id]);
    await connection.execute(
      `INSERT INTO notifications (patient_id, appointment_id, title, message, notification_type)
       VALUES (?, ?, 'Appointment cancelled', 'Your appointment request has been cancelled.', 'appointment')`,
      [request.user.id, appointmentId],
    );
    await connection.commit();
    return response.json({ message: 'Appointment cancelled.' });
  } catch (error) {
    if (connection) await connection.rollback();
    return response.status(503).json({ error: 'The appointment could not be cancelled.' });
  } finally {
    if (connection) connection.release();
  }
});

router.get('/notifications', ...requireRole('patient'), async (request, response) => {
  try {
    const [items] = await pool.execute(
      `SELECT id, title, message, notification_type AS type, read_at AS readAt, created_at AS createdAt
       FROM notifications WHERE patient_id = ? ORDER BY created_at DESC LIMIT 50`,
      [request.user.id],
    );
    return response.json({ notifications: items, unreadCount: items.filter((item) => !item.readAt).length });
  } catch (error) {
    return response.status(503).json({ error: 'Notifications are temporarily unavailable.' });
  }
});

router.patch('/notifications/:notificationId/read', ...requireRole('patient'), async (request, response) => {
  const id = Number(request.params.notificationId);
  if (!Number.isSafeInteger(id) || id < 1) return response.status(422).json({ error: 'Invalid notification.' });
  try {
    const [result] = await pool.execute('UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = ? AND patient_id = ?', [id, request.user.id]);
    return result.affectedRows ? response.json({ message: 'Notification marked as read.' }) : response.status(404).json({ error: 'Notification not found.' });
  } catch (error) {
    return response.status(503).json({ error: 'The notification could not be updated.' });
  }
});

router.patch('/notifications/read-all', ...requireRole('patient'), async (request, response) => {
  try {
    await pool.execute('UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE patient_id = ?', [request.user.id]);
    return response.json({ message: 'All notifications marked as read.' });
  } catch (error) {
    return response.status(503).json({ error: 'Notifications could not be updated.' });
  }
});

router.get('/profile', ...requireRole('patient'), async (request, response) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, full_name AS fullName, email, phone_number AS phone, birth_date AS birthDate, TIMESTAMPDIFF(YEAR, birth_date, CURRENT_DATE) AS age, identification_type AS identificationType, identification_number AS identificationNumber, gender, created_at AS createdAt
       FROM users WHERE id = ? AND role = 'patient' LIMIT 1`,
      [request.user.id],
    );
    return rows.length ? response.json({ profile: rows[0] }) : response.status(404).json({ error: 'Patient profile not found.' });
  } catch (error) {
    return response.status(503).json({ error: 'Profile details are temporarily unavailable.' });
  }
});

router.patch('/profile', ...requireRole('patient'), async (request, response) => {
  const updateIdentity = Object.hasOwn(request.body, 'identificationType') || Object.hasOwn(request.body, 'identificationNumber');
  const identity = validateIdentity(request.body);
  const fullName = String(request.body.fullName || '').trim();
  const phone = String(request.body.phone || '').trim();
  const gender = String(request.body.gender || '');
  const digits = phone.replace(/\D/g, '');
  const genders = new Set(['female', 'male', 'other', 'prefer-not-to-say']);
  const errors = { ...identity.errors };
  if (fullName.length < 2 || fullName.length > 120 || !/^[\p{L}][\p{L} .'-]+$/u.test(fullName)) errors.fullName = 'Enter a valid full name.';
  if (!/^[+0-9 ()-]+$/.test(phone) || digits.length < 8 || digits.length > 15) errors.phone = 'Enter a valid phone number with 8–15 digits.';
  if (!genders.has(gender)) errors.gender = 'Select a gender option.';
  if (Object.keys(errors).length) return response.status(422).json({ error: 'Check the highlighted fields.', fields: errors });
  try {
    await pool.execute(`UPDATE users SET full_name = ?, phone_number = ?, gender = ?${updateIdentity ? ', identification_type = ?, identification_number = ?' : ''} WHERE id = ? AND role = 'patient'`, [fullName, phone, gender, ...(updateIdentity ? [identity.type, identity.number] : []), request.user.id]);
    return response.json({ message: 'Profile updated.', profile: { fullName, phone, gender } });
  } catch (error) {
    return response.status(503).json({ error: 'The profile could not be updated.' });
  }
});

router.post('/profile/password', ...requireRole('patient'), async (request, response) => {
  if (!meetsPasswordRules(request.body.newPassword)) return response.status(422).json({ error: 'The new password does not meet all security requirements.' });
  if (request.body.newPassword !== request.body.confirmPassword) return response.status(422).json({ error: 'New passwords do not match.' });
  try {
    const [rows] = await pool.execute("SELECT password_hash AS passwordHash FROM users WHERE id = ? AND role = 'patient' LIMIT 1", [request.user.id]);
    if (!rows.length || !(await verifyPassword(String(request.body.currentPassword || ''), rows[0].passwordHash))) {
      return response.status(401).json({ error: 'Current password is incorrect.' });
    }
    const passwordHash = await hashPassword(request.body.newPassword);
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, request.user.id]);
    await pool.execute('DELETE FROM user_sessions WHERE user_id = ? AND token_hash <> ?', [request.user.id, request.sessionTokenHash]);
    return response.json({ message: 'Password updated. Other sessions were signed out.' });
  } catch (error) {
    return response.status(503).json({ error: 'The password could not be updated.' });
  }
});

module.exports = router;
