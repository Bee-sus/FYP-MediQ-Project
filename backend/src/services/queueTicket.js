function formatQueueTicket(serviceId, queueNumber) {
  const service = Number(serviceId);
  const number = Number(queueNumber);
  if (!Number.isSafeInteger(service) || service < 1 || !Number.isSafeInteger(number) || number < 1) {
    throw new RangeError('A queue ticket needs a valid service and queue number.');
  }
  return `Q${service}-${String(number).padStart(3, '0')}`;
}

module.exports = { formatQueueTicket };
