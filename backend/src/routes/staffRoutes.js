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
const { sendQueueCallEmail } = require('../services/emailVerificationService');
async function emailCalledPatient(patientId, serviceId, queueNumber, serviceName) {
  try {
    const [patients] = await pool.execute('SELECT email FROM users WHERE id = ? AND is_active = TRUE', [patientId]);
    if (!patients[0]?.email) return { sent: false };
    return await sendQueueCallEmail({ email: patients[0].email, ticket: formatQueueTicket(serviceId, queueNumber), serviceName });
  } catch (error) { console.error('Queue call email failed:', error.code || 'DELIVERY_FAILED'); return { sent: false }; }
}

const transitions = {
  waiting: new Set(['called', 'cancelled']),
  called: new Set(['in_progress', 'cancelled', 'not_present']),
  not_present: new Set(['called', 'cancelled']),
  in_progress: new Set(['completed']),
};

const transitionDetails = {
  not_present: { title: 'You missed your call', message: 'Staff could not find you when called. Check in when you arrive and contact reception. Staff will recall you when the service is free; your original ticket remains active.' },
  called: { title: 'It is your turn', message: 'Clinic staff have called your queue number. Please proceed to the clinic counter.' },
  in_progress: { title: 'Consultation started', message: 'Your consultation is now in progress.' },
  completed: { title: 'Consultation completed', message: 'Your consultation has been marked as completed. Thank you for visiting.' },
  cancelled: { title: 'Queue cancelled by staff', message: 'Clinic staff cancelled your queue entry.' },
};

async function lockQueueService(connection, queueId) {
  // All staff queue transitions take the service lock before individual tickets.
  // This also serializes normal calls, recalls, and complete-and-call-next.
  await connection.execute(
    `SELECT s.id FROM clinic_services s
     WHERE s.id = (SELECT service_id FROM queue_entries WHERE id = ? AND queue_date = CURRENT_DATE)
     FOR UPDATE`,
    [queueId],
  );
}

async function serviceIsBusy(connection, serviceId, excludeQueueId) {
  const [rows] = await connection.execute(
    `SELECT id FROM queue_entries WHERE service_id = ? AND queue_date = CURRENT_DATE
     AND status IN ('called','in_progress') AND id <> ? LIMIT 1 FOR UPDATE`,
    [serviceId, excludeQueueId],
  );
  return rows.length > 0;
}

router.get('/overview', ...requireRole('staff'), async (request, response) => {
  try {
    const [counts] = await pool.execute(
      `SELECT COUNT(*) AS total,
              SUM(status = 'waiting') AS waiting,
              SUM(status = 'not_present') AS notPresent,
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
        total: Number(counts[0].total || 0), notPresent: Number(counts[0].notPresent || 0), waiting: Number(counts[0].waiting || 0),
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
      `SELECT id, name, queue_capacity AS queueCapacity, is_active AS isActive, is_queue_open AS isQueueOpen, delay_notice AS delayNotice
       FROM clinic_services WHERE is_active = TRUE ORDER BY name`,
    );
    const [entries] = await pool.execute(
      `SELECT q.id, q.queue_number AS queueNumber, q.status, q.join_location AS joinLocation, q.arrived_at AS arrivedAt, q.joined_at AS joinedAt,
              TIMESTAMPDIFF(SECOND, q.joined_at, CURRENT_TIMESTAMP) AS elapsedQueueSeconds,
              q.called_at AS calledAt, q.consultation_started_at AS consultationStartedAt,
              q.service_id AS serviceId, q.cancellation_reason AS cancellationReason, u.full_name AS patientName, TIMESTAMPDIFF(YEAR, u.birth_date, CURRENT_DATE) AS patientAge, u.identification_type AS identificationType, CASE WHEN u.identification_number IS NULL THEN NULL ELSE CONCAT('••••', RIGHT(u.identification_number, 4)) END AS maskedIdentification,
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
       WHERE q.queue_date = CURRENT_DATE AND q.status IN ('waiting','called','in_progress','not_present','cancelled')
       ORDER BY q.service_id, FIELD(q.status, 'in_progress','called','waiting','not_present','cancelled'), q.queue_number`,
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
    await lockQueueService(connection, queueId);
    const [rows] = await connection.execute(
      `SELECT q.id, q.patient_id AS patientId, q.service_id AS serviceId, q.status,
              q.queue_number AS queueNumber, q.arrived_at AS arrivedAt, s.name AS serviceName
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
    if (nextStatus === 'called') {
      if (entry.status === 'not_present' && !entry.arrivedAt) { await connection.rollback(); return response.status(409).json({ error: 'Confirm this patient has arrived before recalling them.' }); }
      if (await serviceIsBusy(connection, entry.serviceId, queueId)) {
        await connection.rollback();
        return response.status(409).json({ error: 'Finish the current patient before calling or recalling another patient.' });
      }
    }
    if (entry.status === 'waiting' && nextStatus === 'called') {
      const [earlierEntries] = await connection.execute(
        `SELECT id FROM queue_entries
         WHERE service_id = ? AND queue_date = CURRENT_DATE AND status = 'waiting' AND queue_number < ?
         LIMIT 1 FOR UPDATE`,
        [entry.serviceId, entry.queueNumber],
      );
      if (earlierEntries.length) {
        await connection.rollback();
        return response.status(409).json({ error: 'Call the earliest waiting patient in this service first.' });
      }
    }
    const timestamps = nextStatus === 'not_present' ? ', missed_call_at = CURRENT_TIMESTAMP, arrived_at = NULL' : nextStatus === 'called' ? ', called_at = CURRENT_TIMESTAMP'
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
    const email = nextStatus === 'called' ? await emailCalledPatient(entry.patientId, entry.serviceId, entry.queueNumber, entry.serviceName) : null;
    return response.json({ message: `Queue ${formatQueueTicket(entry.serviceId, entry.queueNumber)} updated to ${nextStatus.replace('_', ' ')}.${email ? email.sent ? ' Call email sent.' : ' Call email was not sent; the in-system notification is available.' : ''}`, emailSent: email?.sent });
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
    await lockQueueService(connection, queueId);
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

    if (await serviceIsBusy(connection, entry.serviceId, queueId)) {
      await connection.rollback();
      return response.status(409).json({ error: 'Resolve the other active patient in this service before calling the next patient.' });
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
    if (next) await emailCalledPatient(next.patientId, entry.serviceId, next.queueNumber, entry.serviceName);
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

const { buildQualityReport, automaticReportOptions } = require('../services/reportQuality');
async function loadStaffReport(from, to, options) {
  const [rows] = await pool.execute(`SELECT q.id, q.service_id AS serviceId, s.name AS serviceName, q.queue_number AS queueNumber, q.status,
    q.is_test_visit AS isTestVisit, DATE_FORMAT(q.queue_date, '%Y-%m') AS visitMonth, q.joined_at AS joinedAt, q.consultation_started_at AS consultationStartedAt, q.completed_at AS completedAt,
    CASE WHEN q.consultation_started_at IS NOT NULL THEN TIMESTAMPDIFF(SECOND,q.joined_at,q.consultation_started_at)/60.0 END AS waitMinutes,
    CASE WHEN q.status = 'completed' AND q.completed_at IS NOT NULL AND q.consultation_started_at IS NOT NULL THEN TIMESTAMPDIFF(SECOND,q.consultation_started_at,q.completed_at)/60.0 END AS consultationMinutes,
    CASE WHEN q.status IN ('waiting','called','not_present') THEN TIMESTAMPDIFF(SECOND,q.joined_at,CURRENT_TIMESTAMP)/60.0 END AS elapsedWaitMinutes,
    CASE WHEN q.status = 'in_progress' THEN TIMESTAMPDIFF(SECOND,q.consultation_started_at,CURRENT_TIMESTAMP)/60.0 END AS elapsedConsultationMinutes,
    p.estimated_minutes AS predictedMinutes, p.model_version AS predictionModel
    FROM queue_entries q JOIN clinic_services s ON s.id = q.service_id
    LEFT JOIN waiting_time_predictions p ON p.id = (SELECT MAX(latest.id) FROM waiting_time_predictions latest WHERE latest.queue_entry_id=q.id)
    WHERE q.queue_date BETWEEN ? AND ? ORDER BY q.joined_at DESC,q.id DESC`, [from,to]);
  return buildQualityReport(rows, from, to, options, MODEL_VERSION);
}

function reportDates(request) {
  const from = String(request.query.from || '');
  const to = String(request.query.to || '');
  const options = automaticReportOptions();
  if (request.query.serviceId) {
    const id = Number(request.query.serviceId);
    if (!Number.isSafeInteger(id) || id < 1) return null;
    options.serviceId = id;
  }
  return validDate(from) && validDate(to) && from <= to && options ? { from, to, options } : null;
}

router.get('/reports', ...requireRole('staff'), async (request, response) => {
  const dates = reportDates(request);
  if (!dates) return response.status(422).json({ error: 'Choose a valid report start and end date.' });
  try {
    return response.json(await loadStaffReport(dates.from, dates.to, dates.options));
  } catch (error) { return response.status(503).json({ error: 'The staff report could not be generated.' }); }
});

router.get('/reports/pdf', ...requireRole('staff'), async (request, response) => {
  const dates = reportDates(request);
  if (!dates) return response.status(422).json({ error: 'Choose a valid report start and end date.' });
  try {
    const report = await loadStaffReport(dates.from, dates.to, {...dates.options, includeAllVisits: request.query.includeVisitDetails === 'true'});
    report.includeVisitDetails = request.query.includeVisitDetails === 'true';
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

const {reviewOptions,filterVisits,visitCsv} = require('../services/reportVisits');
router.get('/reports/visits', ...requireRole('staff'), async (request,response) => {
  const dates=reportDates(request), options=reviewOptions(request.query);
  if(!dates || !options) return response.status(422).json({error:'Choose valid dates and visit filters.'});
  try {
    const report=await loadStaffReport(dates.from,dates.to,{...dates.options,includeAllVisits:true});
    const matches=filterVisits(report.visits,options);
    if(request.query.format === 'csv') {
      response.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="mediq-visits-${dates.from}-to-${dates.to}.csv"`,'Cache-Control':'no-store'});
      return response.send(visitCsv(matches));
    }
    const pages=Math.max(1,Math.ceil(matches.length/options.pageSize)), page=Math.min(options.page,pages);
    return response.json({visits:matches.slice((page-1)*options.pageSize,page*options.pageSize),page,pages,pageSize:options.pageSize,total:matches.length,periodTotal:report.detailTotal});
  } catch(error){return response.status(503).json({error:'Visit records could not be loaded. Please retry.'});}
});

module.exports = router;
