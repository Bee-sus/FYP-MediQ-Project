const MODEL_VERSION = 'operational-f4-hist-gradient-boosting-v1';

const QUEUE_STATE_SQL = `
  SELECT
    COALESCE(SUM(status IN ('waiting', 'called')), 0) AS lineCount0,
    COALESCE(SUM(status = 'in_progress'), 0) AS inProgressSize,
    COALESCE(SUM(status = 'completed'), 0) AS numCompletedToday,
    COALESCE(SUM(status = 'completed' AND completed_at >= CURRENT_TIMESTAMP - INTERVAL 30 MINUTE), 0) AS numCompletedLast30m,
    COALESCE(SUM(joined_at >= CURRENT_TIMESTAMP - INTERVAL 30 MINUTE), 0) AS customersArrivedLast30m,
    AVG(CASE
      WHEN consultation_started_at >= CURRENT_TIMESTAMP - INTERVAL 30 MINUTE
       AND consultation_started_at IS NOT NULL
      THEN TIMESTAMPDIFF(SECOND, joined_at, consultation_started_at) / 60.0
      ELSE NULL
    END) AS avgWaitLast30m,
    HOUR(CURRENT_TIME()) + MINUTE(CURRENT_TIME()) / 60.0 + SECOND(CURRENT_TIME()) / 3600.0 AS arrivalHour
  FROM queue_entries
  WHERE service_id = ? AND queue_date = CURRENT_DATE
`;

function buildOperationalPredictionPayload(state, { aheadCount }) {
  const hour = Number(state.arrivalHour || 0);
  const lineCount0 = Number(state.lineCount0 || 0);
  const inProgressSize = Number(state.inProgressSize || 0);
  const numCompletedToday = Number(state.numCompletedToday || 0);
  const minuteValue = (hour % 1) * 60;
  const arrivalMinute = Math.max(0, Math.min(59, Math.floor(minuteValue + 1e-9)));
  const arrivalSecond = Math.max(0, Math.min(59, Math.floor(((minuteValue - arrivalMinute) * 60) + 1e-9)));
  return {
    line_count0: lineCount0,
    ahead_count: Number(aheadCount || 0),
    none_in_line: lineCount0 === 0,
    none_in_progress: inProgressSize === 0,
    none_completed: numCompletedToday === 0,
    arrival_hour: Math.max(0, Math.min(23, Math.floor(hour))),
    arrival_minute: arrivalMinute,
    arrival_second: arrivalSecond,
    in_progress_size: inProgressSize,
    num_completed_today: numCompletedToday,
    num_completed_last_30m: Number(state.numCompletedLast30m || 0),
    customers_arrived_last_30m: Number(state.customersArrivedLast30m || 0),
    avg_wait_last_30m: state.avgWaitLast30m == null ? null : Number(state.avgWaitLast30m),
  };
}

function estimateLiveRemainingWait(queue) {
  if (!queue) return { remainingWaitMinutes: null, remainingEstimateMethod: null };
  if (queue.status === 'called' || queue.status === 'in_progress') {
    return { remainingWaitMinutes: 0, remainingEstimateMethod: 'patient-called-or-in-progress' };
  }

  if (queue.status === 'not_present') return { remainingWaitMinutes: null, remainingEstimateMethod: 'awaiting-recall' };
  const peopleAhead = Math.max(0, Number(queue.peopleAhead) || 0);
  if (peopleAhead === 0) {
    return { remainingWaitMinutes: 0, remainingEstimateMethod: 'next-in-line' };
  }

  const completedLast30m = Math.max(0, Number(queue.completedLast30m) || 0);
  const averageDuration = Number(queue.averageDurationMinutes);
  const averageRate = Number.isFinite(averageDuration) && averageDuration > 0 ? 1 / averageDuration : 0;
  const recentRate = completedLast30m / 30;
  const effectiveRate = Math.max(averageRate, recentRate);
  if (effectiveRate <= 0) {
    return { remainingWaitMinutes: null, remainingEstimateMethod: 'unavailable' };
  }

  const elapsed = Math.max(0, Number(queue.consultationElapsedMinutesAhead) || 0);
  const remainingConsultationDuration = 1 / effectiveRate;
  const minutes = Math.max(1, peopleAhead / effectiveRate - Math.min(elapsed, remainingConsultationDuration));
  const method = recentRate > averageRate ? 'recent-throughput' : 'average-duration-fallback';
  return { remainingWaitMinutes: Math.round(minutes * 10) / 10, remainingEstimateMethod: method,
    ...(elapsed > 0 ? { consultationProgressApplied: true } : {}) };
}

async function predictInitialWait({ connection, serviceId, aheadCount, baselineAheadCount, averageDurationMinutes }) {
  const baseline = {
    estimatedMinutes: Number(baselineAheadCount) * Number(averageDurationMinutes),
    modelVersion: 'baseline-average-duration-v1',
    dataNotice: 'Fallback estimate from people ahead and average consultation duration.',
  };

  // Keep backend tests deterministic; production uses the local prediction API when available.
  if (process.env.NODE_ENV === 'test') return baseline;

  try {
    const [rows] = await connection.execute(QUEUE_STATE_SQL, [serviceId]);
    const payload = buildOperationalPredictionPayload(rows[0] || {}, { aheadCount });
    const baseUrl = (process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/predict-operational-wait`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) throw new Error(`Prediction service returned ${response.status}`);
    const result = await response.json();
    if (!Number.isFinite(Number(result.estimated_wait_minutes))) throw new Error('Prediction response had no valid wait estimate');
    return {
      estimatedMinutes: Math.max(0, Number(result.estimated_wait_minutes)),
      modelVersion: result.model || MODEL_VERSION,
      dataNotice: result.data_notice || 'Estimate from the operational wait model.',
    };
  } catch (error) {
    console.warn(`Operational wait model unavailable; using baseline estimate: ${error.message}`);
    return baseline;
  }
}

module.exports = {
  MODEL_VERSION,
  QUEUE_STATE_SQL,
  buildOperationalPredictionPayload,
  estimateLiveRemainingWait,
  predictInitialWait,
};
