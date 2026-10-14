function formatQueueTicket(serviceId, queueNumber) {
  const service = Number(serviceId);
  const number = Number(queueNumber);
  if (!Number.isSafeInteger(service) || service < 1 || !Number.isSafeInteger(number) || number < 1) {
    return 'Queue number unavailable';
  }
  return `Q${service}-${String(number).padStart(3, '0')}`;
}
