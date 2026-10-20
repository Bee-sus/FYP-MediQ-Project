(function (root) {
  function describeQueueAvailability(service) {
    const activePatients = Math.max(0, Number(service.activePatients) || 0);
    const queueCapacity = Number(service.queueCapacity);
    const hasCapacity = Number.isFinite(queueCapacity) && queueCapacity > 0;
    const open = Boolean(Number(service.isQueueOpen));
    const full = hasCapacity && activePatients >= queueCapacity;
    const estimatedWait = Number(service.estimatedWaitMinutes);
    const hasEstimate = service.estimatedWaitMinutes != null && Number.isFinite(estimatedWait);
    const waitText = !open || full ? 'No estimate while unavailable'
      : hasEstimate && estimatedWait > 0 ? `About ${Math.max(1, Math.round(estimatedWait))} min if you join now`
        : activePatients === 0 ? 'No patients ahead' : 'Wait estimate unavailable';

    if (!open) return { status: 'closed', label: 'Closed', activePatients, waitText, advice: 'Check again later or book an appointment.' };
    if (full) return { status: 'full', label: 'Full', activePatients, waitText, advice: 'No places right now. Check again in 15 minutes or book an appointment.' };
    if (activePatients === 0) return { status: 'quiet', label: 'Quiet', activePatients, waitText, advice: 'You can join this queue now.' };
    const busy = (hasEstimate && estimatedWait >= 30)
      || (hasCapacity ? activePatients >= Math.max(3, Math.ceil(queueCapacity * 0.75)) : activePatients >= 4);
    return busy
      ? { status: 'busy', label: 'Busy', activePatients, waitText, advice: 'Check again in 15 minutes before travelling, or book an appointment.' }
      : { status: 'moderate', label: 'Some waiting', activePatients, waitText, advice: 'You can join if this service matches your visit.' };
  }

  if (typeof window !== 'undefined') root.describeQueueAvailability = describeQueueAvailability;
  if (typeof module !== 'undefined' && module.exports) module.exports = { describeQueueAvailability };
})(typeof window === 'undefined' ? globalThis : window);
