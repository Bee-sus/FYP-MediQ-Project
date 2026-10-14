const { reminderReason, sendDueQueueReminders } = require('../src/services/queueReminderService');

test('reminders are due only for waiting patients at their estimate or newly next in line', () => {
  expect(reminderReason({ status: 'waiting', elapsedSeconds: 299, estimatedMinutes: 5, initialPeopleAhead: 0, peopleAhead: 0 })).toBeNull();
  expect(reminderReason({ status: 'waiting', elapsedSeconds: 300, estimatedMinutes: 5, initialPeopleAhead: 0, peopleAhead: 0 })).toBe('estimate_reached');
  expect(reminderReason({ status: 'waiting', elapsedSeconds: 60, estimatedMinutes: 10, initialPeopleAhead: 2, peopleAhead: 0 })).toBe('next_in_line');
  expect(reminderReason({ status: 'called', elapsedSeconds: 600, estimatedMinutes: 5, initialPeopleAhead: 1, peopleAhead: 0 })).toBeNull();
});

test('a due queue creates one patient inbox reminder and leaves the call to staff', async () => {
  const connection = {
    beginTransaction: jest.fn().mockResolvedValue(),
    execute: jest.fn()
      .mockResolvedValueOnce([[{
        id: 81, patientId: 21, serviceId: 8, queueNumber: 1,
        status: 'waiting', serviceName: 'Dental Consultation', estimatedMinutes: 5,
        initialPeopleAhead: 0, elapsedSeconds: 300,
      }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ peopleAhead: 0 }]])
      .mockResolvedValueOnce([{ insertId: 101 }]),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
  };
  const db = {
    execute: jest.fn().mockResolvedValueOnce([[{ id: 81 }]]),
    getConnection: jest.fn().mockResolvedValueOnce(connection),
  };

  expect(await sendDueQueueReminders(db)).toBe(1);
  expect(connection.execute.mock.calls[3][0]).toContain('INSERT INTO notifications');
  expect(connection.execute.mock.calls[3][1][3]).toContain('staff will call when ready');
  expect(connection.execute.mock.calls.some(([sql]) => sql.includes('UPDATE queue_entries SET status'))).toBe(false);
  expect(connection.commit).toHaveBeenCalledTimes(1);
  expect(connection.release).toHaveBeenCalledTimes(1);
});

test('a reminder already recorded for the queue is not sent again', async () => {
  const connection = {
    beginTransaction: jest.fn().mockResolvedValue(),
    execute: jest.fn()
      .mockResolvedValueOnce([[{
        id: 81, patientId: 21, serviceId: 8, queueNumber: 1,
        status: 'waiting', serviceName: 'Dental Consultation', estimatedMinutes: 5,
        initialPeopleAhead: 0, elapsedSeconds: 400,
      }]])
      .mockResolvedValueOnce([[{ id: 101 }]]),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
  };
  const db = {
    execute: jest.fn().mockResolvedValueOnce([[{ id: 81 }]]),
    getConnection: jest.fn().mockResolvedValueOnce(connection),
  };

  expect(await sendDueQueueReminders(db)).toBe(0);
  expect(connection.execute).toHaveBeenCalledTimes(2);
  expect(connection.rollback).toHaveBeenCalledTimes(1);
  expect(connection.commit).not.toHaveBeenCalled();
});
