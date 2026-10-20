fetch('/api/settings').then(response => response.json()).then(data => document.querySelectorAll('.brand small').forEach(item => { item.textContent = data.settings.clinicName; })).catch(() => {});
const statusLabels = {
  not_present: 'Missed call',
  waiting: 'Waiting',
  called: 'Called',
  in_progress: 'In consultation',
  completed: 'Completed',
  skipped: 'Skipped',
  cancelled: 'Cancelled',
};

function formatDate(value) {
  return new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function renderQueue(queue) {
  const container = document.querySelector('#active-queue');
  if (!queue) {
    container.className = 'queue-dashboard-card empty-queue';
    container.innerHTML = `
      <div>
        <span class="empty-icon" aria-hidden="true">Q</span>
        <h3>You are not in a queue today</h3>
        <p>Choose an available clinic service below when you are ready to join.</p>
      </div>
      <a class="action-button primary-action" href="/join-queue.html">Join a queue</a>
    `;
    return;
  }

  const estimate = queueEstimatePresentation(queue);
  container.className = 'queue-dashboard-card active-queue';
  container.innerHTML = `
    <div class="queue-identity">
      <span>${queue.serviceName}</span>
      <strong>${formatQueueTicket(queue.serviceId, queue.queueNumber)}</strong>
      <small>Your queue number</small>
    </div>
    <a class="queue-details-link" href="/queue-status.html">View queue details →</a>
    <div class="queue-metrics">
      <div><span>Status</span><strong>${statusLabels[queue.status] || queue.status}</strong></div>
      <div><span>People ahead</span><strong>${queue.peopleAhead}</strong></div>
      <div>
        <span>${estimate.waitLabel}</span>
        <strong>${estimate.waitValue}</strong>
        <small class="queue-estimated-clock">${estimate.clockText}</small>
      </div>
    </div>
    <p class="estimate-explanation">${queue.status === 'waiting' ? 'Your queue status updates automatically. Staff will call you when ready.' : 'Your queue status has updated.'}</p>
  `;
  if (queue.delayNotice) { const notice = document.createElement('p'); notice.className = 'service-delay-notice'; notice.textContent = 'Service update: ' + queue.delayNotice + ' · Waiting times may change.'; container.append(notice); }
}

function renderServices(services) {
  const container = document.querySelector('#patient-services');
  if (!services.length) {
    container.innerHTML = '<p class="dashboard-empty">No clinic services are currently available.</p>';
    return;
  }

  container.replaceChildren(...services.map((service) => {
    const card = document.createElement('article');
    card.className = 'patient-service-card';
    card.innerHTML = `
      <div><h3></h3><p></p></div>
      <div class="service-card-footer">
        <a href="/join-queue.html"></a>
      </div>
    `;
    card.querySelector('h3').textContent = service.name;
    card.querySelector('p').textContent = `${service.doctorName ? `Dr. ${service.doctorName} · ` : ''}${service.serviceDetails || service.description || 'Clinic consultation service.'}`;
    if (service.delayNotice) { const notice = document.createElement('p'); notice.className = 'service-delay-notice'; notice.textContent = 'Service update: ' + service.delayNotice; card.append(notice); }
    card.querySelector('a').href = `/join-queue.html?service=${service.id}`;
    card.querySelector('a').textContent = 'Select service';
    return card;
  }));
}

function renderHistory(items) {
  const container = document.querySelector('#queue-history');
  if (!items.length) {
    container.innerHTML = `
      <div class="dashboard-empty">
        <strong>No previous queue visits</strong>
        <p>Your completed and cancelled queue entries will appear here.</p>
      </div>
    `;
    return;
  }

  container.replaceChildren(...items.map((item) => {
    const row = document.createElement('div');
    row.className = 'history-row';
    row.innerHTML = `
      <div><strong></strong><span></span></div>
      <div><span class="history-status"></span><strong class="history-number"></strong></div>
    `;
    row.querySelector('strong').textContent = item.serviceName;
    row.querySelector('div span').textContent = formatDate(item.queueDate);
    row.querySelector('.history-status').textContent = statusLabels[item.status] || item.status;
    row.querySelector('.history-status').dataset.status = item.status;
    row.querySelector('.history-number').textContent = formatQueueTicket(item.serviceId, item.queueNumber);
    return row;
  }));
}

function renderAppointment(appointment) {
  const container = document.querySelector('#next-appointment');
  if (!appointment) {
    container.innerHTML = '<div class="overview-empty"><strong>No upcoming appointment</strong><p>Request a date and time when you need a planned visit.</p><a href="/appointments.html">Book an appointment</a></div>';
    return;
  }
  const date = new Date(`${String(appointment.appointmentDate).slice(0, 10)}T00:00:00`);
  container.innerHTML = '<div class="overview-appointment"><div><strong></strong><span></span></div><div><h3></h3><p></p><small></small></div></div>';
  container.querySelector('strong').textContent = String(date.getDate()).padStart(2, '0');
  container.querySelector('span').textContent = new Intl.DateTimeFormat('en-MY', { month: 'short' }).format(date);
  container.querySelector('h3').textContent = appointment.serviceName;
  container.querySelector('p').textContent = `${appointment.appointmentTime} · ${appointment.status === 'reschedule_proposed' ? 'Awaiting your response' : appointment.status}`;
  container.querySelector('small').textContent = appointment.status === 'reschedule_proposed' ? 'Open Appointments to accept or decline the new time' : appointment.status === 'pending' ? 'Awaiting clinic approval' : 'Confirmed by the clinic';
}

function renderNotifications(items, unreadCount) {
  const container = document.querySelector('#notification-preview');
  if (!items.length) {
    container.innerHTML = '<div class="overview-empty"><strong>No notifications yet</strong><p>Queue and appointment updates will appear here.</p></div>';
    return;
  }
  const heading = document.createElement('p');
  heading.className = 'notification-summary';
  heading.textContent = unreadCount ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}` : 'You are all caught up';
  const list = document.createElement('div');
  list.className = 'overview-notifications';
  items.slice(0, 2).forEach((item) => {
    const row = document.createElement('div');
    row.className = item.readAt ? '' : 'unread';
    row.innerHTML = '<span aria-hidden="true"></span><div><strong></strong><p></p></div>';
    row.querySelector('span').textContent = item.type === 'queue' ? 'Q' : item.type === 'appointment' ? 'A' : 'i';
    row.querySelector('strong').textContent = item.title;
    row.querySelector('p').textContent = item.message;
    list.append(row);
  });
  container.replaceChildren(heading, list);
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  window.location.replace('/');
}

async function loadPatientDashboard() {
  document.querySelector('#current-date').textContent = new Intl.DateTimeFormat('en-MY', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  try {
    const response = await fetch('/api/patient/overview', { credentials: 'same-origin' });
    if (response.status === 401 || response.status === 403) {
      window.location.replace('/patient-login.html');
      return;
    }

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Dashboard could not be loaded.');
    document.querySelector('#patient-name').textContent = data.user.fullName;
    document.querySelector('#welcome-heading').textContent = `Welcome, ${data.user.fullName.split(' ')[0]}`;
    renderQueue(data.activeQueue);
    renderAppointment(data.nextAppointment);
    renderNotifications(data.notifications, data.unreadNotificationCount);
    renderServices(data.services);
    renderHistory(data.recentQueues);
  } catch (error) {
    const alert = document.querySelector('#dashboard-alert');
    alert.textContent = error.message;
    alert.hidden = false;
  }
}

document.querySelector('#logout-button').addEventListener('click', logout);
document.querySelector('.portal-nav .active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
loadPatientDashboard();
setInterval(() => { if (!document.hidden) loadPatientDashboard(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadPatientDashboard(); });
