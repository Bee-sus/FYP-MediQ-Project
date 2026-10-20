function matchesQueueFilter(entry, query, status) {
  if (status && entry.status !== status) return false;
  const search = String(query || '').trim().toLowerCase();
  const ticket = formatQueueTicket(entry.serviceId, entry.queueNumber);
  return !search || `${entry.patientName} ${ticket}`.toLowerCase().includes(search);
}
