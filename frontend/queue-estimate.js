const queueClock = new Intl.DateTimeFormat('en-MY', {
  hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur',
});

function queueEstimatePresentation(queue, now = new Date()) {
  if (queue.status === 'not_present') return { waitValue: 'Awaiting recall', waitLabel: 'Check in and contact reception', clockText: '' };
  if (queue.status === 'called') return { waitValue: 'Called', waitLabel: 'Queue status', clockText: '' };
  if (queue.status === 'in_progress') return { waitValue: 'In consultation', waitLabel: 'Queue status', clockText: '' };

  const peopleAhead = Number(queue.peopleAhead);
  const joinedAt = new Date(queue.joinedAt);
  const initialMinutes = Number(queue.estimatedMinutes);
  const hasInitial = queue.estimatedMinutes != null && Number.isFinite(initialMinutes) && initialMinutes >= 0
    && Number.isFinite(joinedAt.getTime());
  const currentTime = new Date(now);

  if (peopleAhead === 0) {
    if (!hasInitial) return { waitValue: 'Waiting for call', waitLabel: 'Staff will call when ready', clockText: '' };
    const expectedAt = new Date(joinedAt.getTime() + initialMinutes * 60000);
    if (expectedAt <= currentTime) return {
      waitValue: 'Waiting for call', waitLabel: 'Staff will call when ready',
      clockText: `Estimate was around ${queueClock.format(expectedAt)}`,
    };
    return {
      waitValue: `~${Math.ceil((expectedAt - currentTime) / 60000)} min`,
      waitLabel: 'Estimated wait to consultation',
      clockText: `Around ${queueClock.format(expectedAt)}`,
    };
  }

  const remainingMinutes = Number(queue.remainingWaitMinutes);
  if (queue.remainingWaitMinutes != null && Number.isFinite(remainingMinutes) && remainingMinutes >= 0) {
    const expectedAt = new Date(currentTime.getTime() + remainingMinutes * 60000);
    return {
      waitValue: `~${Math.ceil(remainingMinutes)} min`,
      waitLabel: 'Estimated wait to consultation',
      clockText: `Around ${queueClock.format(expectedAt)}`,
    };
  }
  return { waitValue: 'Calculating', waitLabel: 'Estimated wait to consultation', clockText: '' };
}

if (typeof module !== 'undefined') module.exports = { queueEstimatePresentation };
