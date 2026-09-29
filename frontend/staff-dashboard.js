fetch('/api/settings').then(response => response.json()).then(data => document.querySelectorAll('.brand small').forEach(item => { item.textContent = data.settings.clinicName; })).catch(() => {});
const statusLabels = { waiting: 'Waiting', called: 'Called', in_progress: 'In consultation', cancelled: 'Cancelled' };
const actionLabels = { called: 'Call patient', in_progress: 'Start consultation', completed: 'Complete', cancelled: 'Cancel queue' };
const staffProfileForm = document.querySelector('#staff-profile-form');
const staffPicture = setupProfilePicturePicker(staffProfileForm.querySelector('.profile-picture-field'), staffProfileForm.elements.fullName);

function renderStaffAvatar(name, picture) {
  const avatar = document.querySelector('#staff-header-avatar');
  avatar.replaceChildren();
  if (picture) {
    const image = document.createElement('img'); image.src = picture; image.alt = '';
    image.onerror = () => { avatar.replaceChildren(); avatar.textContent = String(name || 'Staff').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase(); };
    avatar.append(image);
  } else avatar.textContent = String(name || 'Staff').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function formatClock(time) {
  const [hour, minute] = String(time).slice(0, 5).split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}
function formatTimeRange(start) {
  const [hour, minute] = String(start).slice(0, 5).split(':').map(Number);
  const endMinutes = hour * 60 + minute + 30;
  return `${formatClock(start)} – ${formatClock(`${String(Math.floor(endMinutes / 60) % 24).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`)}`;
}

async function staffApi(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  if (response.status === 401 || response.status === 403) {
    window.location.replace('/staff-login.html');
    throw new Error('Staff sign-in required.');
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error(response.status === 413 ? 'The selected picture is too large.' : 'The server returned an invalid response. Restart the application server and try again.');
  const data = await response.json();
  if (response.status === 428 && data.passwordChangeRequired) window.location.hash = '#profile';
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
  const activeCount = entries.filter(entry => entry.status !== 'cancelled').length;
  panel.querySelector('p').textContent = `${activeCount} active patient${activeCount === 1 ? '' : 's'}${service.queueCapacity ? ` · Capacity ${activeCount}/${service.queueCapacity}` : ''}`;
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

let appointmentLoadVersion = 0;
let appointmentPage = 1;
let appointmentDecision = null;
let slotLoadVersion = 0;
const appointmentLabels = { pending: 'Pending', approved: 'Approved', reschedule_proposed: 'Awaiting patient response', rejected: 'Rejected', cancelled: 'Cancelled', completed: 'Completed' };

async function loadStaffAppointments() {
  const version = ++appointmentLoadVersion;
  const container = document.querySelector('#staff-appointments');
  container.textContent = 'Loading appointments…';
  try {
    const filters = new FormData(document.querySelector('#appointment-filters'));
    const data = await staffApi('/api/staff/appointments?' + new URLSearchParams({ status: filters.get('status'), search: filters.get('search'), from: filters.get('from'), to: filters.get('to'), page: appointmentPage }));
    if (version !== appointmentLoadVersion) return;
    container.replaceChildren(...data.appointments.map(staffAppointmentCard));
    if (!data.appointments.length) container.textContent = 'No appointments match this filter.';
    document.querySelector('#appointment-page').textContent = `Page ${data.page}`;
    document.querySelector('#appointment-previous').disabled = data.page <= 1;
    document.querySelector('#appointment-next').disabled = !data.hasMore;
  } catch (error) { if (version === appointmentLoadVersion) container.textContent = error.message; }
}

function staffAppointmentCard(item) {
  const card = document.createElement('article');
  card.className = 'staff-appointment';
  card.innerHTML = '<h3></h3><span class="staff-status"></span><p class="appointment-when"></p><p class="appointment-notes"></p><p class="appointment-response"></p><div class="queue-actions"></div>';
  card.querySelector('h3').textContent = item.patientName + ' · ' + item.serviceName;
  card.querySelector('.staff-status').textContent = appointmentLabels[item.status];
  card.querySelector('.staff-status').dataset.status = item.status;
  card.querySelector('.appointment-when').textContent = item.appointmentDate + ' · ' + formatTimeRange(item.appointmentTime) + ' (Malaysia time)';
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
      document.querySelector('#appointment-dialog-description').textContent = item.patientName + ' · ' + item.appointmentDate + ' · ' + formatTimeRange(item.appointmentTime);
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
    select.replaceChildren(new Option(data.slots.length ? 'Choose a time' : 'No available times', ''), ...data.slots.map(time => new Option(formatTimeRange(time), time)));
    select.disabled = !data.slots.length;
    submit.disabled = !data.slots.length;
    document.querySelector('#appointment-dialog-error').textContent = data.closureReason ? `Clinic closed: ${data.closureReason}` : '';
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
document.querySelector('#appointment-filters').addEventListener('submit', event => { event.preventDefault(); appointmentPage = 1; loadStaffAppointments(); });
document.querySelector('#appointment-previous').addEventListener('click', () => { appointmentPage = Math.max(1, appointmentPage - 1); loadStaffAppointments(); });
document.querySelector('#appointment-next').addEventListener('click', () => { appointmentPage += 1; loadStaffAppointments(); });

let reportData = null;
function reportMetric(label, value, note) {
  const card = document.createElement('article');
  card.innerHTML = '<span></span><strong></strong><small></small>';
  card.querySelector('span').textContent = label;
  card.querySelector('strong').textContent = value;
  card.querySelector('small').textContent = note;
  return card;
}

function renderDonutChart(items) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const chart = document.createElement('div');
  chart.className = 'report-donut-layout';
  const donut = document.createElement('div');
  donut.className = 'report-donut';
  let offset = 0;
  const stops = items.map(item => {
    const start = total ? offset / total * 100 : 0;
    offset += item.value;
    const end = total ? offset / total * 100 : 0;
    return `${item.color} ${start}% ${end}%`;
  });
  donut.style.background = total ? `conic-gradient(${stops.join(',')})` : '#e8edf1';
  donut.innerHTML = '<div><strong></strong><span>patients</span></div>';
  donut.querySelector('strong').textContent = total;
  const legend = document.createElement('div');
  legend.className = 'report-legend';
  items.forEach(item => {
    const row = document.createElement('p');
    row.innerHTML = '<i></i><span></span><strong></strong>';
    row.querySelector('i').style.background = item.color;
    row.querySelector('span').textContent = item.label;
    row.querySelector('strong').textContent = `${item.value} (${total ? Math.round(item.value / total * 100) : 0}%)`;
    legend.append(row);
  });
  chart.append(donut, legend);
  return chart;
}

function renderServiceChart(services) {
  const chart = document.createElement('div');
  chart.className = 'report-bars';
  const maximum = Math.max(1, ...services.map(service => Number(service.patientCount)));
  services.forEach(service => {
    const row = document.createElement('div');
    row.innerHTML = '<div><span></span><strong></strong></div><div class="report-bar-track"><span></span></div>';
    row.querySelector('span').textContent = service.serviceName;
    row.querySelector('strong').textContent = service.patientCount;
    row.querySelector('.report-bar-track span').style.width = `${Number(service.patientCount) / maximum * 100}%`;
    chart.append(row);
  });
  if (!services.length) chart.textContent = 'No service activity in this period.';
  return chart;
}

function downloadReport(format, metrics) {
  if (format === 'pdf') {
    document.body.classList.add('printing-report');
    window.print();
    document.body.classList.remove('printing-report');
    return;
  }
  const escape = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [['MediQ Staff Report'], ['From', reportData.from], ['To', reportData.to], [], ['Metric', 'Value'], ...metrics.map(item => [item[0], item[1]]),
    [], ['Service', 'Patients', 'Completed', 'Completion rate'], ...reportData.services.map(item => [item.serviceName, item.patientCount, item.completed, `${item.patientCount ? Math.round(item.completed / item.patientCount * 100) : 0}%`])];
  const blob = new Blob([rows.map(row => row.map(escape).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `mediq-report-${reportData.from}-to-${reportData.to}.csv`; link.click(); URL.revokeObjectURL(link.href);
}

document.querySelector('#report-form').addEventListener('submit', async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const result = document.querySelector('#report-result');
  result.textContent = 'Generating report…';
  try {
    reportData = await staffApi(`/api/staff/reports?from=${encodeURIComponent(values.from)}&to=${encodeURIComponent(values.to)}`);
    const total = Number(reportData.summary.totalPatients) || 0;
    const completed = Number(reportData.summary.completed) || 0;
    const cancelled = Number(reportData.summary.cancelled) || 0;
    const active = Math.max(0, total - completed - cancelled);
    const completionRate = total ? Math.round(completed / total * 100) : 0;
    const metrics = [
      ['Total patients', total, 'All queue entries'], ['Completed', completed, `${completionRate}% completion rate`],
      ['Average wait', reportData.summary.averageWaitMinutes == null ? '—' : `${reportData.summary.averageWaitMinutes} min`, 'Join to consultation'],
      ['Average consultation', reportData.summary.averageConsultationMinutes == null ? '—' : `${reportData.summary.averageConsultationMinutes} min`, 'Consultation duration'],
    ];
    result.innerHTML = '<article class="report-document"><header class="report-title"><div><p class="staff-eyebrow">MediQ analytics</p><h3>Queue performance report</h3><span class="report-period"></span></div><div class="report-actions"><button id="print-report" class="staff-primary-button" type="button">Export PDF</button><button id="download-report" class="staff-secondary-button" type="button">Download CSV</button></div></header><div class="report-grid"></div><div class="report-chart-grid"><section><h4>Patient outcomes</h4><div id="outcome-chart"></div></section><section><h4>Patients by service</h4><div id="service-chart"></div></section></div><section class="report-table-section"><h4>Service performance</h4><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Service</th><th>Patients</th><th>Completed</th><th>Completion rate</th></tr></thead><tbody></tbody></table></div></section><aside class="report-insight"><strong>Report insight</strong><p></p></aside><footer class="report-footer"></footer></article>';
    result.querySelector('.report-period').textContent = `${reportData.from} to ${reportData.to}`;
    result.querySelector('.report-grid').replaceChildren(...metrics.map(item => reportMetric(...item)));
    result.querySelector('#outcome-chart').append(renderDonutChart([{ label: 'Completed', value: completed, color: '#0b8879' }, { label: 'Cancelled', value: cancelled, color: '#d95d50' }, { label: 'Active / other', value: active, color: '#e3a13a' }]));
    result.querySelector('#service-chart').append(renderServiceChart(reportData.services));
    const body = result.querySelector('tbody');
    reportData.services.forEach(service => { const row = body.insertRow(); [service.serviceName, service.patientCount, service.completed, `${service.patientCount ? Math.round(service.completed / service.patientCount * 100) : 0}%`].forEach(value => { row.insertCell().textContent = value; }); });
    const busiest = reportData.services.find(service => Number(service.patientCount) > 0);
    result.querySelector('.report-insight p').textContent = total ? `${busiest ? `${busiest.serviceName} handled the most patients (${busiest.patientCount}). ` : ''}${completionRate}% of patients completed their visit and ${cancelled} queue entr${cancelled === 1 ? 'y was' : 'ies were'} cancelled.` : 'No queue activity was recorded for the selected period.';
    result.querySelector('.report-footer').textContent = `Generated ${new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}`;
    result.querySelector('#download-report').addEventListener('click', () => downloadReport('csv', metrics));
    result.querySelector('#print-report').addEventListener('click', () => downloadReport('pdf', metrics));
  } catch (error) { result.textContent = error.message; }
});

document.querySelectorAll('[data-report-days]').forEach(button => button.addEventListener('click', () => {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - Number(button.dataset.reportDays));
  const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const form = document.querySelector('#report-form');
  form.elements.from.value = localDate(from);
  form.elements.to.value = localDate(to);
  document.querySelectorAll('[data-report-days]').forEach(item => item.classList.toggle('active', item === button));
}));
document.querySelector('[data-report-days="6"]').click();

async function loadStaffProfile() {
  const { profile } = await staffApi('/api/staff/profile');
  const form = document.querySelector('#staff-profile-form');
  for (const key of ['staffCode', 'fullName', 'email', 'phone', 'profilePictureUrl']) form.elements[key].value = profile[key] || '';
  staffPicture.setValue(profile.profilePictureUrl || '');
  renderStaffAvatar(profile.fullName, profile.profilePictureUrl);
}
document.querySelector('#staff-profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const result = await staffApi('/api/staff/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    showAlert(result.message); document.querySelector('#staff-name').textContent = form.elements.fullName.value;
    renderStaffAvatar(form.elements.fullName.value, form.elements.profilePictureUrl.value);
  } catch (error) { showAlert(error.message, 'error'); }
});
document.querySelector('#staff-password-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget;
  if (form.elements.newPassword.value !== form.elements.confirmPassword.value) return showAlert('New passwords do not match.', 'error');
  try { const result = await staffApi('/api/staff/password', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: form.elements.currentPassword.value, newPassword: form.elements.newPassword.value }) }); showAlert(result.message); form.reset(); document.querySelector('#password-change-note').textContent = 'Your password is up to date.'; }
  catch (error) { showAlert(error.message, 'error'); }
});
async function showStaffPanel() {
  const panels = ['overview', 'live-queue', 'appointments', 'reports', 'profile'];
  const requestedPanel = window.location.hash.slice(1);
  const activePanel = panels.includes(requestedPanel) ? requestedPanel : 'overview';
  if (!panels.includes(requestedPanel)) history.replaceState(null, '', '#overview');

  document.querySelectorAll('[data-staff-panel]').forEach(panel => {
    panel.hidden = panel.dataset.staffPanel !== activePanel;
  });
  document.querySelectorAll('.staff-nav a').forEach(item => {
    const active = item.hash === `#${activePanel}`;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    if (active) item.scrollIntoView({ inline: 'center', block: 'nearest' });
  });

  try {
    if (activePanel === 'appointments') await loadStaffAppointments();
    if (activePanel === 'profile') await loadStaffProfile();
  } catch (error) {
    showAlert(error.message, 'error');
  }
}
window.addEventListener('hashchange', showStaffPanel);
loadStaffDashboard();
loadStaffProfile().catch(error => showAlert(error.message, 'error'));
showStaffPanel();
setInterval(() => {
  const panel = window.location.hash.slice(1) || 'overview';
  if (!document.hidden && ['overview', 'live-queue'].includes(panel)) loadStaffDashboard();
}, 30000);
document.addEventListener('visibilitychange', () => {
  const panel = window.location.hash.slice(1) || 'overview';
  if (!document.hidden && ['overview', 'live-queue'].includes(panel)) loadStaffDashboard();
});
