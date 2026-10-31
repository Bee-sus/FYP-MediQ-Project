const statuses = new Set(['waiting','called','in_progress','completed','cancelled','not_present','skipped']);
function reviewOptions(query) {
  const page = Number(query.page || 1), pageSize = Number(query.pageSize || 10);
  const status = String(query.status || ''), inclusion = String(query.inclusion || ''), flags = String(query.flags || '');
  if (!Number.isSafeInteger(page) || page < 1 || ![10,25,50].includes(pageSize)
      || (status && !statuses.has(status)) || !['','included','excluded'].includes(inclusion)
      || !['','flagged','clear'].includes(flags)) return null;
  return {page,pageSize,status,inclusion,flags,search:String(query.search || '').trim().slice(0,120).toLowerCase()};
}
function filterVisits(visits, options) {
  return visits.filter(v => (!options.status || v.status === options.status)
    && (!options.inclusion || v.included === (options.inclusion === 'included'))
    && (!options.flags || (v.flags.length > 0) === (options.flags === 'flagged'))
    && (!options.search || (`Q${v.serviceId}-${String(v.queueNumber).padStart(3,'0')} ${v.serviceName}`).toLowerCase().includes(options.search)));
}
function visitCsv(visits) {
  const escape = value => '"' + String(value ?? '').replace(/^[=+@-]/,'\'$&').replaceAll('"','""') + '"';
  const rows = [['Ticket','Service','Status','Included','Actual wait (min)','Consultation (min)','Review flags'],
    ...visits.map(v => [`Q${v.serviceId}-${String(v.queueNumber).padStart(3,'0')}`,v.serviceName,v.status,v.included?'Yes':'No',v.waitMinutes,v.consultationMinutes,v.flags.join('; ')])];
  return '\uFEFF' + rows.map(row=>row.map(escape).join(',')).join('\r\n');
}
module.exports = {reviewOptions,filterVisits,visitCsv};
