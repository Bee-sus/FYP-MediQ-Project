const { queueEstimatePresentation } = require('../../frontend/queue-estimate');

const joinedAt = '2026-10-14T09:00:00.000Z'; // 5:00 pm in Malaysia.

describe('patient wait presentation', () => {
  test('shows the saved estimate at the front of the queue on both patient pages', () => {
    const result = queueEstimatePresentation(
      { status: 'waiting', peopleAhead: 0, joinedAt, estimatedMinutes: 12, remainingWaitMinutes: 0 },
      new Date('2026-10-14T09:07:00.000Z'),
    );
    expect(result.waitValue).toBe('~5 min');
    expect(result.clockText).toMatch(/5:12/);
  });

  test('stops displaying a countdown after the estimate passes without a staff call', () => {
    const result = queueEstimatePresentation(
      { status: 'waiting', peopleAhead: 0, joinedAt, estimatedMinutes: 12 },
      new Date('2026-10-14T09:13:00.000Z'),
    );
    expect(result.waitValue).toBe('Waiting for call');
    expect(result.clockText).toMatch(/5:12/);
  });

  test('uses the current queue estimate when people are ahead', () => {
    const result = queueEstimatePresentation(
      { status: 'waiting', peopleAhead: 2, joinedAt, estimatedMinutes: 12, remainingWaitMinutes: 7 },
      new Date('2026-10-14T09:07:00.000Z'),
    );
    expect(result.waitValue).toBe('~7 min');
    expect(result.clockText).toMatch(/5:14/);
  });
});
