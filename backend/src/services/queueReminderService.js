const { pool } = require('../config/database');
const { formatQueueTicket } = require('./queueTicket');

const REMINDER_TITLE = 'Queue reminder';
const ACTIVE_AHEAD_STATUSES = "'waiting','called','in_progress'";

function reminderReason({ status, elapsedSeconds, estimatedMinutes, initialPeopleAhead, peopleAhead }) {
  if (status !== 'waiting') return null;
  if (Number(initialPeopleAhead) > 0 && Number(peopleAhead) === 0) return 'next_in_line';
  const estimate = Number(estimatedMinutes);
  if (Number.isFinite(estimate) && estimate >= 0 && Number(elapsedSeconds) >= estimate * 60) return 'estimate_reached';
  return null;
}

async function sendReminderForQueue(db, queueId) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT q.id, q.patient_id AS patientId, q.service_id AS serviceId,
              q.queue_number AS queueNumber, q.status, s.name AS serviceName,
              p.estimated_minutes AS estimatedMinutes, p.people_ahead AS initialPeopleAhead,
              TIMESTAMPDIFF(SECOND, q.joined_at, CURRENT_TIMESTAMP) AS elapsedSeconds
       FROM queue_entries q JOIN clinic_services s ON s.id = q.service_id
       JOIN waiting_time_predictions p ON p.id = (
         SELECT latest.id FROM waiting_time_predictions latest
         WHERE latest.queue_entry_id = q.id ORDER BY latest.predicted_at DESC, latest.id DESC LIMIT 1
       )
       WHERE q.id = ? AND q.queue_date = CURRENT_DATE FOR UPDATE`,
      [queueId],
    );
    if (!rows.length || rows[0].status !== 'waiting') {
      await connection.rollback();
      return false;
    }
    const entry = rows[0];
    const [existing] = await connection.execute(
      'SELECT id FROM notifications WHERE queue_entry_id = ? AND title = ? LIMIT 1 FOR UPDATE',
      [queueId, REMINDER_TITLE],
    );
    if (existing.length) {
      await connection.rollback();
      return false;
    }
    const [aheadRows] = await connection.execute(
      `SELECT COUNT(*) AS peopleAhead FROM queue_entries
       WHERE service_id = ? AND queue_date = CURRENT_DATE AND queue_number < ?
         AND status IN (${ACTIVE_AHEAD_STATUSES})`,
      [entry.serviceId, entry.queueNumber],
    );
    const reason = reminderReason({ ...entry, peopleAhead: aheadRows[0].peopleAhead });
    if (!reason) {
      await connection.rollback();
      return false;
    }
    const ticket = formatQueueTicket(entry.serviceId, entry.queueNumber);
    const message = reason === 'next_in_line'
      ? `${ticket} is next in line for ${entry.serviceName}. Please stay ready; clinic staff will call when ready.`
      : `${ticket}'s estimated time for ${entry.serviceName} has arrived. Please watch your queue status; clinic staff will call when ready.`;
    await connection.execute(
      `INSERT INTO notifications (patient_id, queue_entry_id, title, message, notification_type)
       VALUES (?, ?, ?, ?, 'queue')`,
      [entry.patientId, queueId, REMINDER_TITLE, message],
    );
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function sendDueQueueReminders(db = pool) {
  const [candidates] = await db.execute(
    `SELECT q.id FROM queue_entries q
     JOIN waiting_time_predictions p ON p.id = (
       SELECT latest.id FROM waiting_time_predictions latest
       WHERE latest.queue_entry_id = q.id ORDER BY latest.predicted_at DESC, latest.id DESC LIMIT 1
     )
     WHERE q.queue_date = CURRENT_DATE AND q.status = 'waiting'
       AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.queue_entry_id = q.id AND n.title = ?)
       AND (
         TIMESTAMPDIFF(SECOND, q.joined_at, CURRENT_TIMESTAMP) >= p.estimated_minutes * 60
         OR (COALESCE(p.people_ahead, 0) > 0 AND NOT EXISTS (
           SELECT 1 FROM queue_entries ahead
           WHERE ahead.service_id = q.service_id AND ahead.queue_date = q.queue_date
             AND ahead.queue_number < q.queue_number AND ahead.status IN (${ACTIVE_AHEAD_STATUSES})
         ))
       )
     ORDER BY q.joined_at LIMIT 100`,
    [REMINDER_TITLE],
  );
  let sent = 0;
  for (const candidate of candidates) {
    if (await sendReminderForQueue(db, candidate.id)) sent += 1;
  }
  return sent;
}

module.exports = { reminderReason, sendDueQueueReminders };
