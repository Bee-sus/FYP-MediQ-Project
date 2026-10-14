const { buildOperationalPredictionPayload, estimateLiveRemainingWait, predictInitialWait } = require('../src/services/waitPredictionService');

describe('operational wait prediction mapping', () => {
  test('maps queue state into the arrival-time F4 model inputs', () => {
    const payload = buildOperationalPredictionPayload({
      lineCount0: 3,
      inProgressSize: 1,
      numCompletedToday: 4,
      numCompletedLast30m: 2,
      customersArrivedLast30m: 5,
      avgWaitLast30m: 6.25,
      arrivalHour: 9 + 30.5 / 60,
    }, { aheadCount: 7 });

    expect(payload).toEqual({
      line_count0: 3,
      ahead_count: 7,
      none_in_line: false,
      none_in_progress: false,
      none_completed: false,
      arrival_hour: 9,
      arrival_minute: 30,
      arrival_second: 30,
      in_progress_size: 1,
      num_completed_today: 4,
      num_completed_last_30m: 2,
      customers_arrived_last_30m: 5,
      avg_wait_last_30m: 6.25,
    });
  });

  test('uses the transparent average-duration fallback when the model is unavailable in tests', async () => {
    const estimate = await predictInitialWait({
      connection: { execute: jest.fn() },
      serviceId: 3,
      aheadCount: 8,
      baselineAheadCount: 2,
      averageDurationMinutes: 15,
    });

    expect(estimate).toEqual({
      estimatedMinutes: 30,
      modelVersion: 'baseline-average-duration-v1',
      dataNotice: 'Fallback estimate from people ahead and average consultation duration.',
    });
  });
});

describe('live remaining-wait estimate', () => {
  test('decreases with current people ahead using recent completion throughput', () => {
    expect(estimateLiveRemainingWait({ peopleAhead: 2, completedLast30m: 3 })).toEqual({
      remainingWaitMinutes: 20,
      remainingEstimateMethod: 'recent-throughput',
    });
    expect(estimateLiveRemainingWait({ peopleAhead: 1, completedLast30m: 3 }).remainingWaitMinutes).toBe(10);
  });

  test('uses the service average when there are no recent completions', () => {
    expect(estimateLiveRemainingWait({ peopleAhead: 3, completedLast30m: 0, averageDurationMinutes: 15 })).toEqual({
      remainingWaitMinutes: 45,
      remainingEstimateMethod: 'average-duration-fallback',
    });
  });

  test('does not let sparse slow completions increase the baseline estimate', () => {
    expect(estimateLiveRemainingWait({ peopleAhead: 2, completedLast30m: 1, averageDurationMinutes: 15 })).toEqual({
      remainingWaitMinutes: 30,
      remainingEstimateMethod: 'average-duration-fallback',
    });
  });

  test('reduces the wait as an earlier consultation progresses without reaching zero before completion', () => {
    expect(estimateLiveRemainingWait({ peopleAhead: 1, completedLast30m: 0, averageDurationMinutes: 15, consultationElapsedMinutesAhead: 5 })).toMatchObject({
      remainingWaitMinutes: 10,
      consultationProgressApplied: true,
    });
    expect(estimateLiveRemainingWait({ peopleAhead: 1, completedLast30m: 0, averageDurationMinutes: 15, consultationElapsedMinutesAhead: 20 })).toMatchObject({
      remainingWaitMinutes: 1,
      consultationProgressApplied: true,
    });
  });

  test('returns zero once called or already in consultation', () => {
    expect(estimateLiveRemainingWait({ status: 'called', peopleAhead: 5 })).toEqual({
      remainingWaitMinutes: 0,
      remainingEstimateMethod: 'patient-called-or-in-progress',
    });
  });
});
