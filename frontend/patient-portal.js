fetch('/api/settings').then(response => response.json()).then(data => document.querySelectorAll('.brand small').forEach(item => { item.textContent = data.settings.clinicName; })).catch(() => {});
const page = document.body.dataset.patientPage;
const pageDetails = {
  services: ['Clinic services', 'Choose how the clinic can help with your visit.'],
  history: ['Queue history', 'Review your previous and cancelled queue entries.'],
  appointments: ['Appointments', 'Request a clinic appointment and follow its approval status.'],
  notifications: ['Notifications', 'Keep up with queue, appointment and account activity.'],
  profile: ['Your profile', 'Keep your Patient information and password up to date.'],
};

function navigationLink(key, href, symbol, label) {
  const active = page === key ? ' class="active" aria-current="page"' : '';
  return `<a${active} href="${href}"><svg class="portal-icon" aria-hidden="true" focusable="false"><use href="/portal-icons.svg#${key === 'status' ? 'queue' : key}"></use></svg>${label}</a>`;
}

function renderShell() {
  const [title, description] = pageDetails[page];
  document.body.innerHTML = `
    <header class="portal-header">
      <a class="brand" href="/">Medi<span>Q</span><small>Clinic name pending</small></a>
      <div class="portal-account">
        <a id="patient-name" href="/patient-profile.html">Patient</a>
        <button id="logout-button" class="action-button secondary-action" type="button">Sign out</button>
      </div>
    </header>
    <div class="portal-layout">
      <nav class="portal-nav" aria-label="Patient portal">
        ${navigationLink('overview', '/patient-dashboard.html', '⌂', 'Overview')}
        ${navigationLink('services', '/patient-services.html', '✚', 'Clinic services')}
        ${navigationLink('queue', '/join-queue.html', '＋', 'Join queue')}
        ${navigationLink('status', '/queue-status.html', 'Q', 'Queue status')}
        ${navigationLink('appointments', '/appointments.html', '□', 'Appointments')}
        ${navigationLink('notifications', '/notifications.html', '○', 'Notifications')}
        ${navigationLink('history', '/queue-history.html', '↻', 'Queue history')}
        ${navigationLink('profile', '/patient-profile.html', '◎', 'Profile')}
      </nav>
      <main class="patient-main patient-feature-main">
        <section class="feature-page-heading">
          <div><p class="eyebrow">Patient portal</p><h1>${title}</h1><p>${description}</p></div>
          <a class="return-overview" href="/patient-dashboard.html">← Overview</a>
        </section>
        <p id="page-alert" class="dashboard-alert" role="status" aria-live="polite" hidden></p>
        <div id="page-content"><p class="dashboard-loading">Loading…</p></div>
      </main>
    </div>
  `;
  document.querySelector('#logout-button').addEventListener('click', logout);
  document.querySelector('.portal-nav .active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function showAlert(message, type = 'success') {
  const alert = document.querySelector('#page-alert');
  alert.textContent = message;
  alert.className = `dashboard-alert ${type}`;
  alert.setAttribute('role', type === 'error' ? 'alert' : 'status');
  alert.hidden = false;
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (response.status === 401 || response.status === 403) {
    window.location.replace('/patient-login.html');
    throw new Error('Sign in required.');
  }
  if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('The server could not process this request. Please try again.');
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'The request could not be completed.');
    error.fields = data.fields;
    throw error;
  }
  return data;
}

async function logout() {
  await window.mediqSignOut(document.querySelector('#logout-button'));
}

function patientFailure(error) {
  return error instanceof TypeError ? 'Connection lost. The request was not confirmed. Check your connection and try again.' : error.message;
}

async function identifyPatient() {
  const data = await api('/api/auth/me');
  document.querySelector('#patient-name').textContent = data.user.fullName;
  return data.user;
}

function createServiceCard(service) {
  const availability = describeQueueAvailability(service);
  const card = document.createElement('article');
  card.className = 'feature-service-card';
  card.dataset.queueStatus = availability.status;
  const name=String(service.name||'').toLowerCase();
  const icon=/dental|dentist/.test(name)?'dental':/follow/.test(name)?'followup':/pharmacy|medication/.test(name)?'pharmacy':/specialist/.test(name)?'specialist':/general|consultation/.test(name)?'general':null;
  card.innerHTML = `
    <div class="service-card-header"><div class="feature-service-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><use href="/portal-icons.svg#${icon?'service-'+icon:'services'}"></use></svg></div><div class="feature-service-copy"><h2></h2><p></p></div></div>
    <div class="service-availability"><span class="queue-load-badge"></span><small class="service-availability-count"></small></div><p class="service-availability-advice"></p>
    <div class="feature-service-actions">
      <a class="secondary-card-action">Book appointment</a>
      <a class="primary-card-action">Join queue</a>
    </div>
  `;
  card.querySelector('h2').textContent = service.name;
  card.querySelector('p').textContent = `${service.doctorName ? `Dr. ${service.doctorName} · ` : ''}${service.serviceDetails || service.description || 'Clinic consultation service.'}`;
  card.querySelector('.queue-load-badge').textContent = availability.status==='quiet'?'Available':availability.label;
  card.querySelector('.service-availability-count').textContent = `${availability.activePatients} ${availability.activePatients === 1 ? 'patient' : 'patients'} ahead`;
  card.querySelector('.service-availability-advice').textContent = service.delayNotice ? `Service update: ${service.delayNotice} · Waiting times may change.` : availability.advice;
  card.querySelector('.service-availability-advice').hidden=!service.delayNotice&&availability.status==='quiet';
  card.querySelector('.service-availability-count').hidden=availability.status==='closed';
  card.querySelector('.secondary-card-action').href = `/appointments.html?service=${service.id}`;
  const joinLink = card.querySelector('.primary-card-action');
  if (availability.status === 'closed' || availability.status === 'full') {
    joinLink.removeAttribute('href');
    joinLink.setAttribute('aria-disabled', 'true');
    joinLink.textContent = 'Queue unavailable';
  } else joinLink.href = `/join-queue.html?service=${service.id}`;
  return card;
}

async function loadServicesPage() {
  const data = await api('/api/patient/queues/availability');
  const content = document.querySelector('#page-content');
  content.className = 'feature-services-grid';
  if (data.services.length) content.replaceChildren(...data.services.map(createServiceCard));
  else content.innerHTML = '<p class="feature-empty">No clinic services are available right now.</p>';
}

function historyRow(item) {
  const row = document.createElement('article');
  row.className = 'detailed-history-row';
  row.innerHTML = `
    <div class="history-date"><strong></strong><span></span></div>
    <div class="history-main"><h2></h2><p></p></div>
    <span class="record-status"></span>
  `;
  const date = new Date(item.queueDate);
  row.querySelector('.history-date strong').textContent = String(date.getDate()).padStart(2, '0');
  row.querySelector('.history-date span').textContent = new Intl.DateTimeFormat('en-MY', { month: 'short', year: 'numeric' }).format(date);
  row.querySelector('.history-main h2').textContent = item.serviceName;
  row.querySelector('.history-main p').textContent = `Queue ${formatQueueTicket(item.serviceId, item.queueNumber)}${item.cancellationReason ? ` · Reason: ${item.cancellationReason}` : ''}`;
  const status = row.querySelector('.record-status');
  status.textContent = item.status === 'not_present' ? 'Not present' : item.status === 'in_progress' ? 'In consultation' : item.status.replace('_', ' ');
  status.dataset.status = item.status;
  return row;
}

let historyRequestVersion = 0;
let historyState = { status: '', page: 1, totalPages: 1, loaded: false };
let historyFailed = false;
async function loadHistoryPage(status = '', requestedPage = 1) {
  const version = ++historyRequestVersion;
  const content = document.querySelector('#page-content');
  if (!document.querySelector('#history-records')) {
  content.innerHTML = `
    <div class="filter-bar" role="group" aria-label="Filter queue history">
      ${['', 'completed', 'cancelled', 'skipped'].map((value) => `<button type="button" data-history-filter="${value}">${value === 'skipped' ? 'Skipped (legacy)' : value || 'All'}</button>`).join('')}
    </div>
    <p id="history-feedback" class="activity-count" role="status" aria-live="polite"></p>
    <div id="history-records" class="records-card"></div>
    <div class="pagination"><button id="previous-page" type="button" disabled>← Previous</button><span id="history-page"></span><button id="next-page" type="button" disabled>Next →</button></div>
  `;
  document.querySelectorAll('[data-history-filter]').forEach(button => button.addEventListener('click', () => loadHistoryPage(button.dataset.historyFilter, 1)));
  document.querySelector('#previous-page').addEventListener('click', () => loadHistoryPage(historyState.status, historyState.page - 1));
  document.querySelector('#next-page').addEventListener('click', () => loadHistoryPage(historyState.status, historyState.page + 1));
  }
  const records = document.querySelector('#history-records');
  const previous = document.querySelector('#previous-page');
  const next = document.querySelector('#next-page');
  content.setAttribute('aria-busy', 'true');
  previous.disabled = true; next.disabled = true;
  document.querySelector('#history-feedback').textContent = 'Loading queue history…';
  try {
    const query = new URLSearchParams({ page: requestedPage });
    if (status) query.set('status', status);
    const data = await api(`/api/patient/history?${query}`);
    if (version !== historyRequestVersion) return;
    historyState = { status, page: data.page, totalPages: data.totalPages, loaded: true };
    if (data.items.length) records.replaceChildren(...data.items.map(historyRow));
    else records.innerHTML = '<div class="feature-empty"><strong>No matching queue records</strong><p>Your queue activity will appear here.</p></div>';
    document.querySelectorAll('[data-history-filter]').forEach(button => {
      const active = button.dataset.historyFilter === status;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelector('#history-page').textContent = `Page ${data.page} of ${data.totalPages}`;
    document.querySelector('#history-feedback').textContent = '';
    if (historyFailed) window.mediqFeedback('Queue history refreshed.');
    historyFailed = false;
  } catch (error) {
    if (version !== historyRequestVersion || error.message === 'Sign in required.') return;
    historyFailed = true;
    document.querySelector('#history-feedback').textContent = historyState.loaded ? 'Could not refresh. Your previous queue history is still shown.' : 'Queue history could not be loaded.';
    window.mediqFeedback(patientFailure(error), { type: 'error', title: 'Queue history unavailable', retry: () => loadHistoryPage(status, requestedPage) });
  } finally {
    if (version === historyRequestVersion) {
      content.setAttribute('aria-busy', 'false');
      previous.disabled = !historyState.loaded || historyState.page <= 1;
      next.disabled = !historyState.loaded || historyState.page >= historyState.totalPages;
    }
  }
}

let patientAppointmentItems = [];
let patientAppointmentVersion = 0;

function renderPatientAppointments() {
  const list = document.querySelector('#appointment-list');
  const filter = document.querySelector('#patient-appointment-filter').value;
  const items = filter ? patientAppointmentItems.filter(item => item.status === filter) : patientAppointmentItems;
  document.querySelector('#appointment-count').textContent = `${items.length} of ${patientAppointmentItems.length} appointment${patientAppointmentItems.length === 1 ? '' : 's'}`;
  if (items.length) list.replaceChildren(...items.map(appointmentCard));
  else list.innerHTML = '<div class="feature-empty"><strong>No matching appointments</strong><p>Choose another status to review your appointment activity.</p></div>';
}

async function refreshPatientAppointments() {
  const version = ++patientAppointmentVersion;
  try {
    const data = await api('/api/patient/appointments');
    if (version !== patientAppointmentVersion) return;
    patientAppointmentItems = data.appointments;
    renderPatientAppointments();
  } catch (error) { if (version === patientAppointmentVersion) throw error; }
}

async function showAppointmentOutcome(message) {
  window.mediqFeedback(message, { title: 'Appointment updated' });
  async function refreshList() {
    try {
      await refreshPatientAppointments();
      window.mediqFeedback('Appointment activity is up to date.');
    } catch (error) {
      if (error.message === 'Sign in required.') return;
      window.mediqFeedback(`${message} The appointment list could not refresh. Your change is saved.`, { type: 'warning', retry: refreshList, retryLabel: 'Refresh list' });
    }
  }
  try { await refreshPatientAppointments(); }
  catch (error) {
    if (error.message === 'Sign in required.') return;
    window.mediqFeedback(`${message} The appointment list could not refresh. Your change is saved.`, { type: 'warning', retry: refreshList, retryLabel: 'Refresh list' });
  }
}

function appointmentCard(item) {
  const card = document.createElement('article');
  card.className = 'appointment-card';
  card.innerHTML = `
    <div class="appointment-date"><strong></strong><span></span></div>
    <div class="appointment-details"><div><h2></h2><span class="record-status"></span></div><p class="appointment-time"></p><p class="appointment-notes"></p><p class="rejection-reason" hidden></p></div>
    <button class="cancel-appointment portal-action" data-tone="danger" type="button">Cancel</button>
  `;
  const date = new Date(`${String(item.appointmentDate).slice(0, 10)}T00:00:00`);
  card.querySelector('.appointment-date strong').textContent = String(date.getDate()).padStart(2, '0');
  card.querySelector('.appointment-date span').textContent = new Intl.DateTimeFormat('en-MY', { month: 'short', year: 'numeric' }).format(date);
  card.querySelector('h2').textContent = item.serviceName;
  const status = card.querySelector('.record-status');
  status.textContent = item.status === 'reschedule_proposed' ? 'Awaiting your response' : item.status;
  status.dataset.status = item.status;
  card.querySelector('.appointment-time').textContent = `Appointment time: ${formatTimeRange(item.appointmentTime)} (Malaysia time)`;
  card.querySelector('.appointment-notes').textContent = item.notes || 'No additional notes.';
  if (item.rejectionReason) {
    const reason = card.querySelector('.rejection-reason');
    reason.textContent = `Clinic response: ${item.rejectionReason}`;
    reason.hidden = false;
  }
  const cancel = card.querySelector('.cancel-appointment');
  cancel.hidden = !['pending', 'approved'].includes(item.status);
  cancel.addEventListener('click', async () => {
    if (!(await window.mediqDialog({ title: 'Cancel appointment?', message: 'Your appointment request will be cancelled and its slot released.', confirmLabel: 'Cancel appointment', danger: true }))) return;
    if (cancel.disabled) return;
    cancel.disabled = true; cancel.textContent = 'Cancelling…';
    try {
      const result = await api(`/api/patient/appointments/${item.id}/cancel`, { method: 'POST' });
      item.status = 'cancelled';
      renderPatientAppointments();
      await showAppointmentOutcome(result.message);
    } catch (error) {
      if (error.message !== 'Sign in required.') window.mediqFeedback(patientFailure(error), { type: 'error', title: 'Cancellation not confirmed' });
    }
    finally { cancel.disabled = false; cancel.textContent = 'Cancel appointment'; }
  });
  if (item.status === 'reschedule_proposed') {
    const actions = document.createElement('div');
    actions.className = 'proposal-actions';
    const explanation = document.createElement('p');
    explanation.textContent = 'Staff proposed this new time and released your original slot. Accept to confirm, or decline to cancel.';
    actions.append(explanation);
    ['accept', 'decline'].forEach(decision => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cancel-appointment portal-action';
      button.dataset.tone = decision === 'accept' ? 'primary' : 'danger';
      button.textContent = decision === 'accept' ? 'Accept new time' : 'Decline and cancel';
      button.addEventListener('click', async () => {
        if (!(await window.mediqDialog({ title: decision === 'accept' ? 'Accept proposed time?' : 'Decline proposed time?', message: decision === 'accept' ? 'Confirm this proposed appointment time?' : 'Decline this time and cancel the appointment?', confirmLabel: decision === 'accept' ? 'Accept new time' : 'Decline and cancel', danger: decision === 'decline' }))) return;
        actions.querySelectorAll('button').forEach(control => { control.disabled = true; });
        try {
          const result = await api('/api/patient/appointments/' + item.id + '/respond', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision, appointmentDate: item.appointmentDate, appointmentTime: item.appointmentTime }),
          });
          item.status = decision === 'accept' ? 'approved' : 'cancelled';
          renderPatientAppointments();
          await showAppointmentOutcome(result.message);
        } catch (error) {
          if (error.message !== 'Sign in required.') window.mediqFeedback(patientFailure(error), { type: 'error', title: 'Response not confirmed' });
        }
        finally { actions.querySelectorAll('button').forEach(control => { control.disabled = false; }); }
      });
      actions.append(button);
    });
    card.append(actions);
  }
  return card;
}

async function loadAppointmentsPage() {
  const [servicesData, appointmentData] = await Promise.all([api('/api/patient/services'), api('/api/patient/appointments')]);
  const content = document.querySelector('#page-content');
  content.innerHTML = `
    <div class="appointment-layout">
      <section class="feature-form-card"><p class="eyebrow">New request</p><h2>Book an appointment</h2><p>Appointments require confirmation from clinic staff.</p><form id="appointment-form">
        <label>Clinic service<select name="serviceId" required><option value="">Select a service</option></select></label>
        <div class="feature-form-row"><label>Date<input name="appointmentDate" type="date" required /></label><label>Available time<select name="appointmentTime" required disabled><option value="">Select a date first</option></select><small>Available 30-minute slots follow clinic hours, in Malaysia time.</small></label></div>
        <label>Additional notes <small>Optional</small><textarea name="notes" maxlength="500" rows="4" placeholder="Briefly describe anything the clinic should know."></textarea></label>
        <button class="feature-submit" type="submit">Submit appointment request</button><p id="appointment-status" class="inline-status" role="status" hidden></p>
      </form></section>
      <section><div class="list-heading"><div><p class="eyebrow">Your requests</p><h2>Appointment activity</h2></div><label class="activity-filter">Filter<select id="patient-appointment-filter"><option value="">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="reschedule_proposed">Awaiting response</option><option value="completed">Completed</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></select></label></div><p id="appointment-count" class="activity-count"></p><div id="appointment-list" class="appointment-list"></div></section>
    </div>
  `;
  const select = document.querySelector('[name="serviceId"]');
  servicesData.services.forEach((service) => select.add(new Option(service.name, service.id)));
  const requestedService = new URLSearchParams(window.location.search).get('service');
  if (requestedService) select.value = requestedService;
  const dateInput = document.querySelector('[name="appointmentDate"]');
  dateInput.min = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const timeSelect = document.querySelector('[name="appointmentTime"]');
  const submit = document.querySelector('#appointment-form [type="submit"]');
  submit.disabled = true;
  let version = 0;
  dateInput.addEventListener('change', async () => {
    const current = ++version;
    timeSelect.disabled = true;
    submit.disabled = true;
    timeSelect.replaceChildren(new Option('Loading available times…', ''));
    try {
      const data = await api('/api/patient/appointments/availability?date=' + encodeURIComponent(dateInput.value));
      if (current !== version) return;
      timeSelect.replaceChildren(new Option(data.slots.length ? 'Select a time slot' : data.closureReason ? `Clinic closed: ${data.closureReason}` : 'No available times', ''), ...data.slots.map(time => new Option(formatTimeRange(time), time)));
      timeSelect.disabled = !data.slots.length;
      submit.disabled = !data.slots.length;
    } catch (error) { if (current === version) showAlert(error.message, 'error'); }
  });
  patientAppointmentItems = appointmentData.appointments;
  document.querySelector('#patient-appointment-filter').addEventListener('change', renderPatientAppointments);
  renderPatientAppointments();
  document.querySelector('#appointment-form').addEventListener('submit', submitAppointment);
}

async function submitAppointment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector('#appointment-status');
  const payload = Object.fromEntries(new FormData(form));
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const result = await api('/api/patient/appointments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    form.reset();
    form.elements.serviceId.value = payload.serviceId;
    form.elements.appointmentTime.replaceChildren(new Option('Select a date first', ''));
    form.elements.appointmentTime.disabled = true;
    status.hidden = true;
    await showAppointmentOutcome(result.message);
  } catch (error) {
    status.textContent = patientFailure(error);
    status.className = 'inline-status error';
    status.hidden = false;
    if (error.message !== 'Sign in required.') window.mediqFeedback(patientFailure(error), { type: 'error', title: 'Request not confirmed' });
  } finally { button.disabled = form.elements.appointmentTime.disabled; }
}

function notificationCard(item) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `notification-card${item.readAt ? '' : ' unread'}`;
  card.innerHTML = '<span class="notification-symbol" aria-hidden="true"></span><span class="notification-copy"><strong></strong><span></span><small></small></span><i></i>';
  card.querySelector('.notification-symbol').textContent = item.type === 'queue' ? 'Q' : item.type === 'appointment' ? 'A' : 'i';
  card.querySelector('strong').textContent = item.title;
  card.querySelector('.notification-copy>span').textContent = item.message;
  card.querySelector('small').textContent = new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt));
  card.querySelector('i').textContent = item.readAt ? '' : 'New';
  card.addEventListener('click', async () => {
    if (card.disabled) return;
    card.disabled = true;
    try {
      if (!item.readAt) {
        await api(`/api/patient/notifications/${item.id}/read`, { method: 'PATCH' });
        item.readAt = new Date().toISOString();
        card.classList.remove('unread');
        card.querySelector('i').textContent = '';
      }
      window.location.assign(item.type === 'appointment' ? '/appointments.html' : item.type === 'queue' ? '/queue-status.html' : '/patient-dashboard.html');
    } catch (error) {
      if (error.message !== 'Sign in required.') window.mediqFeedback(patientFailure(error), { type: 'error', title: 'Could not open notification', retry: () => card.click() });
    } finally {
      card.disabled = false;
    }
  });
  return card;
}

function formatClock(time) {
  const [hour, minute] = String(time).slice(0, 5).split(':').map(Number);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function formatTimeRange(start) {
  const [hour, minute] = String(start).slice(0, 5).split(':').map(Number);
  const endMinutes = hour * 60 + minute + 30;
  const end = `${String(Math.floor(endMinutes / 60) % 24).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
  return `${formatClock(start)} – ${formatClock(end)}`;
}

async function loadNotificationsPage() {
  const data = await api('/api/patient/notifications');
  const content = document.querySelector('#page-content');
  content.innerHTML = `<div class="list-heading"><div><p class="eyebrow">Inbox</p><h2>Recent updates</h2></div><button id="read-all" type="button">Mark all as read</button></div><div id="notification-list" class="notification-list"></div>`;
  const list = document.querySelector('#notification-list');
  if (data.notifications.length) list.replaceChildren(...data.notifications.map(notificationCard));
  else list.innerHTML = '<div class="feature-empty"><strong>You are all caught up</strong><p>Queue and appointment updates will appear here.</p></div>';
  const button = document.querySelector('#read-all');
  button.disabled = !data.unreadCount;
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true; button.textContent = 'Marking as read…';
    try {
      const result = await api('/api/patient/notifications/read-all', { method: 'PATCH' });
      data.notifications.forEach(item => { item.readAt = item.readAt || new Date().toISOString(); });
      list.querySelectorAll('.notification-card').forEach(card => { card.classList.remove('unread'); card.querySelector('i').textContent = ''; });
      data.unreadCount = 0;
      window.mediqFeedback(result.message);
    } catch (error) {
      if (error.message !== 'Sign in required.') window.mediqFeedback(patientFailure(error), { type: 'error', title: 'Could not update notifications', retry: () => button.click() });
    } finally {
      button.disabled = !data.unreadCount;
      button.textContent = 'Mark all as read';
    }
  });
}

function passwordRules(value) {
  return { length: value.length >= 12, upper: /[A-Z]/.test(value), lower: /[a-z]/.test(value), number: /\d/.test(value), symbol: /[^A-Za-z0-9]/.test(value) };
}

async function loadProfilePage() {
  const data = await api('/api/patient/profile');
  const profile = data.profile;
  const content = document.querySelector('#page-content');
  content.innerHTML = `
    <div class="profile-layout"><section class="feature-form-card"><p class="eyebrow">Personal details</p><h2>Account information</h2><form id="profile-form">
      <label>Full name<input name="fullName" maxlength="120" required /></label><label>Email address<input name="email" type="email" readonly /><small>Email changes require verification and are not available yet.</small></label>
      <div class="feature-form-row"><label>Phone number<input name="phone" type="tel" maxlength="20" required /></label><label>Gender<select name="gender" required><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option><option value="prefer-not-to-say">Prefer not to say</option></select></label></div>
      <div class="feature-form-row"><label>Date of birth<input name="birthDate" type="date" readonly /></label><label>Age<input name="age" readonly /><small>Calculated from your date of birth.</small></label></div><div class="feature-form-row"><label>ID type (optional)<select name="identificationType"><option value="">Not provided</option><option value="mykad">MyKad / IC</option><option value="passport">Passport</option></select></label><label>Identification number (optional)<input name="identificationNumber" maxlength="30" autocomplete="off" /><small>Your full number is only shown in your own profile.</small></label></div><button class="feature-submit" type="submit">Save profile changes</button><p id="profile-status" class="inline-status" role="status" hidden></p>
    </form></section><section class="feature-form-card"><p class="eyebrow">Security</p><h2>Change password</h2><p>Changing your password signs out your other sessions.</p><form id="password-form">
      <label>Current password<span class="password-inline"><input name="currentPassword" type="password" autocomplete="current-password" required /><button type="button" data-toggle-password>Show</button></span></label><label>New password<span class="password-inline"><input id="new-password" name="newPassword" type="password" autocomplete="new-password" minlength="12" required /><button type="button" data-toggle-password>Show</button></span></label>
      <ul id="profile-password-rules" class="compact-password-rules"><li data-rule="length">12+ characters</li><li data-rule="upper">Uppercase</li><li data-rule="lower">Lowercase</li><li data-rule="number">Number</li><li data-rule="symbol">Symbol</li></ul>
      <label>Confirm new password<span class="password-inline"><input name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required aria-describedby="password-match" /><button type="button" data-toggle-password>Show</button></span><small id="password-match" aria-live="polite">Re-enter the new password.</small></label><button class="feature-submit" type="submit">Update password</button><p id="password-status" class="inline-status" role="status" hidden></p>
    </form></section></div>
  `;
  const profileForm = document.querySelector('#profile-form');
  profileForm.elements.fullName.value = profile.fullName;
  profileForm.elements.email.value = profile.email;
  profileForm.elements.phone.value = profile.phone || '';
  profileForm.elements.identificationType.value = profile.identificationType || '';
  profileForm.elements.identificationNumber.value = profile.identificationNumber || '';
  profileForm.elements.age.value = profile.age == null ? 'Not available' : profile.age + (Number(profile.age) === 1 ? ' year' : ' years');
  profileForm.elements.gender.value = profile.gender || 'prefer-not-to-say';
  profileForm.elements.birthDate.value = String(profile.birthDate || '').slice(0, 10);
  profileForm.addEventListener('submit', updateProfile);
  document.querySelector('#password-form').addEventListener('submit', updatePassword);
  document.querySelectorAll('[data-toggle-password]').forEach((button) => button.addEventListener('click', () => {
    const input = button.previousElementSibling;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    button.textContent = showing ? 'Show' : 'Hide';
  }));
  document.querySelector('#new-password').addEventListener('input', (event) => {
    const rules = passwordRules(event.target.value);
    Object.entries(rules).forEach(([rule, met]) => document.querySelector(`[data-rule="${rule}"]`).classList.toggle('met', met));
  });
  const confirmation = document.querySelector('[name="confirmPassword"]');
  const updateMatch = () => {
    const match = document.querySelector('#password-match');
    if (!confirmation.value) {
      match.textContent = 'Re-enter the new password.';
      match.className = '';
    } else if (confirmation.value === document.querySelector('#new-password').value) {
      match.textContent = 'Passwords match.';
      match.className = 'field-match';
    } else {
      match.textContent = 'Passwords do not match yet.';
      match.className = 'field-mismatch';
    }
  };
  confirmation.addEventListener('input', updateMatch);
  document.querySelector('#new-password').addEventListener('input', updateMatch);
}

async function updateProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector('#profile-status');
  try {
    const result = await api('/api/patient/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    status.textContent = result.message;
    status.className = 'inline-status';
    status.hidden = false;
    document.querySelector('#patient-name').textContent = result.profile.fullName;
  } catch (error) {
    status.textContent = error.fields ? Object.values(error.fields).join(' ') : error.message;
    status.className = 'inline-status error';
    status.hidden = false;
  }
}

async function updatePassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector('#password-status');
  const payload = Object.fromEntries(new FormData(form));
  if (!Object.values(passwordRules(payload.newPassword)).every(Boolean) || payload.newPassword !== payload.confirmPassword) {
    status.textContent = 'Meet all requirements and ensure the new passwords match.';
    status.className = 'inline-status error';
    status.hidden = false;
    return;
  }
  try {
    const result = await api('/api/patient/profile/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    status.textContent = result.message;
    status.className = 'inline-status';
    status.hidden = false;
    form.reset();
  } catch (error) {
    status.textContent = error.message;
    status.className = 'inline-status error';
    status.hidden = false;
  }
}

async function initialise() {
  renderShell();
  try {
    await identifyPatient();
    if (page === 'services') {
      await loadServicesPage();
      setInterval(() => {
        if (document.visibilityState === 'visible') loadServicesPage().catch(() => showAlert('Queue availability could not be refreshed.', 'error'));
      }, 30000);
    }
    if (page === 'history') await loadHistoryPage();
    if (page === 'appointments') await loadAppointmentsPage();
    if (page === 'notifications') await loadNotificationsPage();
    if (page === 'profile') await loadProfilePage();
  } catch (error) {
    if (error.message !== 'Sign in required.') showAlert(error.message, 'error');
  }
}

initialise();
