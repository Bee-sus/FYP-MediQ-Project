const statusLabels = { waiting: 'Waiting', called: 'Called', in_progress: 'In consultation', cancelled: 'Cancelled' };
const actionLabels = { called: 'Call patient', in_progress: 'Start consultation', completed: 'Complete', cancelled: 'Cancel queue' };

async function staffApi(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  if (response.status === 401 || response.status === 403) {
    window.location.replace('/staff-login.html');
    throw new Error('Staff sign-in required.');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The staff request could not be completed.');
  return data;
}

function showAlert(message, type = 'success') {
  const alert = document.querySelector('#staff-alert');
  alert.textContent = message;
  alert.className = `staff-alert ${type}`;
  alert.hidden = false;
}

function summaryCard(label, value, note, tone = '') {
  const card = document.createElement('article');
  card.className = `summary-card ${tone}`;
  card.innerHTML = '<span></span><strong></strong><small></small>';
  card.querySelector('span').textContent = label;
  card.querySelector('strong').textContent = value;
  card.querySelector('small').textContent = note;
  return card;
}

function renderSummary(summary) {
  const container = document.querySelector('#staff-summary');
  container.replaceChildren(
    summaryCard('Waiting', summary.waiting, 'Patients awaiting call', 'blue'),
    summaryCard('Active care', summary.called + summary.inProgress, `${summary.called} called · ${summary.inProgress} consulting`, 'amber'),
    summaryCard('Completed', summary.completed, 'Consultations today', 'green'),
    summaryCard('Pending appointments', summary.pendingAppointments, 'Awaiting staff decision', 'violet'),
    summaryCard('Average duration', summary.averageDuration == null ? '—' : `${summary.averageDuration} min`, summary.averageDuration == null ? 'Available after completed visits' : 'From today’s completed visits'),
  );
}

function actionsFor(status) {
  if (status === 'waiting') return ['called', 'cancelled'];
  if (status === 'called') return ['in_progress', 'cancelled'];
  if (status === 'in_progress') return ['completed'];

  return [];
}

function confirmAction(title, message) {
  const dialog = document.querySelector('#staff-confirmation');
  document.querySelector('#confirmation-title').textContent = title;
  document.querySelector('#confirmation-message').textContent = message;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
}

function queueRow(entry, isFirstWaiting) {
  const row = document.createElement('article');
  row.className = 'staff-queue-row';
  row.innerHTML = '<div class="queue-number"></div><div class="patient-details"><strong></strong><span></span></div><span class="staff-status"></span><div class="queue-actions"></div>';
  row.querySelector('.queue-number').textContent = `Q-${String(entry.queueNumber).padStart(3, '0')}`;
  row.querySelector('.patient-details strong').textContent = entry.patientName;
  row.querySelector('.patient-details span').textContent = `Joined ${new Intl.DateTimeFormat('en-MY', { timeStyle: 'short' }).format(new Date(entry.joinedAt))}`;
  const status = row.querySelector('.staff-status');
  status.textContent = statusLabels[entry.status];
  status.dataset.status = entry.status;
  if (entry.cancellationReason) row.querySelector('.patient-details span').textContent += ` · Reason: ${entry.cancellationReason}`;
  const actions = row.querySelector('.queue-actions');
  actionsFor(entry.status).filter((nextStatus) => nextStatus !== 'called' || entry.status !== 'waiting' || isFirstWaiting).forEach((nextStatus, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = index === 0 ? 'staff-primary-button' : 'staff-text-button';
    button.textContent = actionLabels[nextStatus];
    button.addEventListener('click', async () => {
      const reason = nextStatus === 'cancelled' ? window.prompt('Reason for cancelling this queue entry (3–300 characters):') : '';
      if (nextStatus === 'cancelled' && reason === null) return;
      const confirmed = await confirmAction(`${actionLabels[nextStatus]}?`, `${entry.patientName} (${row.querySelector('.queue-number').textContent}) will be moved from ${statusLabels[entry.status].toLowerCase()} to ${nextStatus === 'in_progress' ? 'in consultation' : nextStatus}. The patient will be notified.`);
      if (!confirmed) return;
      try {
        const result = await staffApi(`/api/staff/queues/${entry.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nextStatus, reason }) });
        showAlert(result.message);
        await loadStaffDashboard();
      } catch (error) { showAlert(error.message, 'error'); }
    });
    actions.append(button);
  });
  return row;
}

function servicePanel(service, entries) {
  const panel = document.createElement('section');
  panel.className = 'service-queue-panel';
  panel.innerHTML = '<header><div><span class="service-state"></span><h3></h3><p></p></div><button class="queue-toggle" type="button"></button></header><div class="service-queue-list"></div>';
  panel.querySelector('h3').textContent = service.name;
  panel.querySelector('p').textContent = `${entries.filter(entry => entry.status !== 'cancelled').length} active patient${entries.filter(entry => entry.status !== 'cancelled').length === 1 ? '' : 's'}`;
  const state = panel.querySelector('.service-state');
  state.textContent = service.isQueueOpen ? 'Queue open' : 'Queue closed';
  state.classList.toggle('closed', !service.isQueueOpen);
  const toggle = panel.querySelector('.queue-toggle');
  toggle.textContent = service.isQueueOpen ? 'Close queue' : 'Open queue';
  toggle.addEventListener('click', async () => {
    const nextState = !Boolean(service.isQueueOpen);
    const confirmed = await confirmAction(`${nextState ? 'Open' : 'Close'} ${service.name}?`, nextState ? 'Patients will be able to join this service queue.' : 'New patients will be prevented from joining. Existing patients remain in the queue.');
    if (!confirmed) return;
    try {
      const result = await staffApi(`/api/staff/services/${service.id}/queue`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isOpen: nextState }) });
      showAlert(result.message);
      await loadStaffDashboard();
    } catch (error) { showAlert(error.message, 'error'); }
  });
  const list = panel.querySelector('.service-queue-list');
  const firstWaitingId = entries.find((entry) => entry.status === 'waiting')?.id;
  if (entries.length) list.replaceChildren(...entries.map((entry) => queueRow(entry, entry.id === firstWaitingId)));
  else list.innerHTML = '<div class="staff-empty"><strong>No active patients</strong><span>This service queue is clear.</span></div>';
  return panel;
}

async function loadStaffDashboard() {
  try {
    const [overview, queueData] = await Promise.all([staffApi('/api/staff/overview'), staffApi('/api/staff/queues')]);
    document.querySelector('#staff-name').textContent = overview.user.fullName;
    renderSummary(overview.summary);
    const container = document.querySelector('#service-queues');
    container.replaceChildren(...queueData.services.map((service) => servicePanel(service, queueData.entries.filter((entry) => Number(entry.serviceId) === Number(service.id)))));
    document.querySelector('#last-updated').textContent = `Updated ${new Intl.DateTimeFormat('en-MY', { timeStyle: 'short' }).format(new Date())}`;
  } catch (error) {
    if (error.message !== 'Staff sign-in required.') showAlert(error.message, 'error');
  }
}

document.querySelector('#refresh-button').addEventListener('click', () => { loadStaffDashboard(); loadStaffAppointments(); });
document.querySelector('#logout-button').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  window.location.replace('/');
});

loadStaffDashboard();


let appointmentLoadVersion = 0;
let appointmentDecision = null;
let slotLoadVersion = 0;
const appointmentLabels = { pending: 'Pending', approved: 'Approved', reschedule_proposed: 'Awaiting patient response', rejected: 'Rejected', cancelled: 'Cancelled', completed: 'Completed' };

async function loadStaffAppointments() {
  const version = ++appointmentLoadVersion;
  const container = document.querySelector('#staff-appointments');
  container.textContent = 'Loading appointments…';
  try {
    const filter = document.querySelector('#appointment-filter').value;
    const data = await staffApi('/api/staff/appointments?status=' + encodeURIComponent(filter));
    if (version !== appointmentLoadVersion) return;
    container.replaceChildren(...data.appointments.map(staffAppointmentCard));
    if (!data.appointments.length) container.textContent = 'No appointments match this filter.';
  } catch (error) { if (version === appointmentLoadVersion) container.textContent = error.message; }
}

function staffAppointmentCard(item) {
  const card = document.createElement('article');
  card.className = 'staff-appointment';
  card.innerHTML = '<h3></h3><span class="staff-status"></span><p class="appointment-when"></p><p class="appointment-notes"></p><p class="appointment-response"></p><div class="queue-actions"></div>';
  card.querySelector('h3').textContent = item.patientName + ' · ' + item.serviceName;
  card.querySelector('.staff-status').textContent = appointmentLabels[item.status];
  card.querySelector('.staff-status').dataset.status = item.status;
  card.querySelector('.appointment-when').textContent = item.appointmentDate + ' at ' + item.appointmentTime + ' (Malaysia time)';
  card.querySelector('.appointment-notes').textContent = 'Patient notes: ' + (item.notes || 'None');
  card.querySelector('.appointment-response').textContent = item.rejectionReason ? 'Clinic response: ' + item.rejectionReason : '';
  const actions = item.status === 'pending' ? ['approve', 'reject', 'reschedule'] : item.status === 'approved' ? ['complete', 'reject', 'reschedule'] : item.status === 'reschedule_proposed' ? ['reject', 'reschedule'] : [];
  const labels = { approve: 'Approve', reject: 'Reject', reschedule: 'Propose new time', complete: 'Mark completed' };
  actions.forEach(action => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'staff-secondary-button';
    button.textContent = labels[action];
    button.addEventListener('click', () => {
      appointmentDecision = { item, action };
      ++slotLoadVersion;
      document.querySelector('#staff-appointment-form').reset();
      document.querySelector('#appointment-dialog-title').textContent = labels[action];
      document.querySelector('#appointment-dialog-description').textContent = item.patientName + ' · ' + item.appointmentDate + ' at ' + item.appointmentTime;
      document.querySelector('#reschedule-fields').hidden = action !== 'reschedule';
      document.querySelector('#proposed-date').required = action === 'reschedule';
      document.querySelector('#proposed-time').required = action === 'reschedule';
      document.querySelector('#proposed-time').replaceChildren(new Option('Select a date first', ''));
      document.querySelector('#proposed-time').disabled = true;
      document.querySelector('#appointment-reason-label').hidden = !['reject', 'reschedule'].includes(action);
      document.querySelector('#appointment-reason').required = ['reject', 'reschedule'].includes(action);
      document.querySelector('#appointment-dialog-error').textContent = '';
      document.querySelector('#appointment-dialog-submit').disabled = action === 'reschedule';
      document.querySelector('#appointment-dialog').showModal();
    });
    card.querySelector('.queue-actions').append(button);
  });
  return card;
}

document.querySelector('#proposed-date').addEventListener('change', async event => {
  const version = ++slotLoadVersion;
  const select = document.querySelector('#proposed-time');
  const submit = document.querySelector('#appointment-dialog-submit');
  select.disabled = true;
  submit.disabled = true;
  select.replaceChildren(new Option('Loading available times…', ''));
  try {
    const data = await staffApi('/api/staff/appointments/availability?date=' + encodeURIComponent(event.target.value));
    if (version !== slotLoadVersion) return;
    select.replaceChildren(new Option(data.slots.length ? 'Choose a time' : 'No available times', ''), ...data.slots.map(time => new Option(time, time)));
    select.disabled = !data.slots.length;
    submit.disabled = !data.slots.length;
    document.querySelector('#appointment-dialog-error').textContent = '';
  } catch (error) { if (version === slotLoadVersion) document.querySelector('#appointment-dialog-error').textContent = error.message; }
});

document.querySelector('#appointment-dialog-cancel').addEventListener('click', () => document.querySelector('#appointment-dialog').close());
document.querySelector('#staff-appointment-form').addEventListener('submit', async event => {
  event.preventDefault();
  const { item, action } = appointmentDecision;
  const submit = document.querySelector('#appointment-dialog-submit');
  submit.disabled = true;
  try {
    const result = await staffApi('/api/staff/appointments/' + item.id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason: document.querySelector('#appointment-reason').value, appointmentDate: document.querySelector('#proposed-date').value, appointmentTime: document.querySelector('#proposed-time').value }),
    });
    document.querySelector('#appointment-dialog').close();
    showAlert(result.message);
    await Promise.all([loadStaffAppointments(), loadStaffDashboard()]);
  } catch (error) { document.querySelector('#appointment-dialog-error').textContent = error.message; }
  finally { submit.disabled = false; }
});
document.querySelector('#appointment-filter').addEventListener('change', loadStaffAppointments);
function syncStaffNavigation() {
  const hash = ['#overview', '#live-queue', '#appointments'].includes(window.location.hash) ? window.location.hash : '#overview';
  document.querySelectorAll('.staff-nav a').forEach(item => {
    const active = item.hash === hash;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    if (active) item.scrollIntoView({ inline: 'center', block: 'nearest' });
  });
}
window.addEventListener('hashchange', syncStaffNavigation);
syncStaffNavigation();
loadStaffAppointments();
