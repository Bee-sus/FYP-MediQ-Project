const statusLabels = { waiting: 'Waiting', called: 'Called', in_progress: 'In consultation', skipped: 'Skipped' };
const actionLabels = { called: 'Call patient', in_progress: 'Start consultation', completed: 'Complete', skipped: 'Skip', waiting: 'Return to waiting' };

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
    summaryCard('Pending appointments', summary.pendingAppointments, 'For the next staff stage', 'violet'),
    summaryCard('Average duration', summary.averageDuration == null ? '—' : `${summary.averageDuration} min`, summary.averageDuration == null ? 'Available after completed visits' : 'From today’s completed visits'),
  );
}

function actionsFor(status) {
  if (status === 'waiting') return ['called', 'skipped'];
  if (status === 'called') return ['in_progress', 'skipped'];
  if (status === 'in_progress') return ['completed'];
  if (status === 'skipped') return ['called', 'waiting'];
  return [];
}

function confirmAction(title, message) {
  const dialog = document.querySelector('#staff-confirmation');
  document.querySelector('#confirmation-title').textContent = title;
  document.querySelector('#confirmation-message').textContent = message;
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
  const actions = row.querySelector('.queue-actions');
  actionsFor(entry.status).filter((nextStatus) => nextStatus !== 'called' || entry.status !== 'waiting' || isFirstWaiting).forEach((nextStatus, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = index === 0 ? 'staff-primary-button' : 'staff-text-button';
    button.textContent = actionLabels[nextStatus];
    button.addEventListener('click', async () => {
      const confirmed = await confirmAction(`${actionLabels[nextStatus]}?`, `${entry.patientName} (${row.querySelector('.queue-number').textContent}) will be moved from ${statusLabels[entry.status].toLowerCase()} to ${nextStatus === 'in_progress' ? 'in consultation' : nextStatus}. The patient will be notified.`);
      if (!confirmed) return;
      try {
        const result = await staffApi(`/api/staff/queues/${entry.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nextStatus }) });
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
  panel.querySelector('p').textContent = `${entries.length} active patient${entries.length === 1 ? '' : 's'}`;
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

document.querySelector('#refresh-button').addEventListener('click', loadStaffDashboard);
document.querySelector('#logout-button').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  window.location.replace('/');
});

loadStaffDashboard();
