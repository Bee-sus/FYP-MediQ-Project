const { describeQueueAvailability } = require('../../frontend/queue-availability');

describe('patient queue availability guidance', () => {
  test('uses each service wait and count rather than comparing unrelated services', () => {
    expect(describeQueueAvailability({ isQueueOpen: 1, activePatients: 0, queueCapacity: 10, estimatedWaitMinutes: 5 }))
      .toMatchObject({ status: 'quiet', waitText: 'About 5 min if you join now' });
    expect(describeQueueAvailability({ isQueueOpen: 1, activePatients: 2, queueCapacity: 10, estimatedWaitMinutes: 35 }))
      .toMatchObject({ status: 'busy', activePatients: 2, waitText: 'About 35 min if you join now' });
  });

  test('does not suggest joining a full or closed queue', () => {
    expect(describeQueueAvailability({ isQueueOpen: 1, activePatients: 3, queueCapacity: 3, estimatedWaitMinutes: null }).status).toBe('full');
    expect(describeQueueAvailability({ isQueueOpen: 0, activePatients: 0, queueCapacity: 3, estimatedWaitMinutes: null }).status).toBe('closed');
  });
});
