const $ = selector => document.querySelector(selector);
let scheduleRevision = null;
let scheduleDirty = false;
let editingServiceId = null;
let auditPage = 1;
const loaded = new Set();

async function adminApi(path, options = {}) {
  const response = await fetch('/api/admin' + path, { credentials: 'same-origin', ...options });
  if (response.status === 401 || response.status === 403) {
    window.location.replace('/admin-login.html');
    throw new Error('Administrator sign-in required.');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}

function json(method, body) { return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
function alertMessage(message, error = false) {
  const alert = $('#admin-alert');
  alert.textContent = message;
  alert.className = 'staff-alert' + (error ? ' error' : '');
  alert.hidden = false;
}
async function run(work) {
  try { await work(); } catch (error) { alertMessage(error.message, true); }
}
function card(title, description) {
  const element = document.createElement('article');
  element.className = 'admin-card';
  element.innerHTML = '<h3></h3><p></p><div class="admin-card-actions"></div>';
  element.querySelector('h3').textContent = title;
  element.querySelector('p').textContent = description;
  return element;
}
function badge(active) {
  const element = document.createElement('span');
  element.className = 'admin-badge' + (active ? '' : ' inactive');
  element.textContent = active ? 'Active' : 'Inactive';
  return element;
}
function button(text, handler) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'staff-secondary-button';
  element.textContent = text;
  element.addEventListener('click', () => run(async () => {
    element.disabled = true;
    try { await handler(); } finally { element.disabled = false; }
  }));
  return element;
}

async function loadOverview() {
  const data = await adminApi('/overview');
  $('#admin-name').textContent = data.user.fullName;
  const labels = { patients: 'Registered patients', activeStaff: 'Active staff', activeServices: 'Active services', pendingAppointments: 'Pending appointments' };
  $('#admin-summary').replaceChildren(...Object.entries(labels).map(([key, label]) => {
    const element = document.createElement('article');
    element.className = 'summary-card blue';
    element.innerHTML = '<span></span><strong></strong>';
    element.querySelector('span').textContent = label;
    element.querySelector('strong').textContent = data.summary[key];
    return element;
  }));
}

async function loadStaff() {
  const { staff } = await adminApi('/staff');
  $('#staff-list').replaceChildren(...staff.map(person => {
    const element = card(person.fullName, person.email);
    element.querySelector('.admin-card-actions').append(badge(person.isActive), button(person.isActive ? 'Deactivate' : 'Activate', async () => {
      if (!window.confirm(person.isActive ? `Deactivate ${person.fullName}? Their sessions will be signed out.` : `Restore staff access for ${person.fullName}?`)) return;
      const result = await adminApi('/staff/' + person.id, json('PATCH', { isActive: !Boolean(person.isActive) }));
      alertMessage(result.message);
      await loadStaff();
    }));
    return element;
  }));
  if (!staff.length) $('#staff-list').textContent = 'No staff accounts yet. Create the first account using this form.';
}

$('#create-staff-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  run(async () => {
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const result = await adminApi('/staff', json('POST', Object.fromEntries(new FormData(form))));
      form.reset();
      $('#staff-password').type = 'password';
      $('#toggle-password').textContent = 'Show password';
      $('#toggle-password').setAttribute('aria-pressed', 'false');
      alertMessage(result.message);
      await loadStaff();
    } finally { submit.disabled = false; }
  });
});
$('#toggle-password').addEventListener('click', () => {
  const show = $('#staff-password').type === 'password';
  $('#staff-password').type = show ? 'text' : 'password';
  $('#toggle-password').textContent = show ? 'Hide password' : 'Show password';
  $('#toggle-password').setAttribute('aria-pressed', String(show));
});

async function loadServices() {
  const { services } = await adminApi('/services');
  $('#admin-services').replaceChildren(...services.map(service => {
    const element = card(service.name, `${service.description || 'No description.'} Average duration: ${service.averageDurationMinutes} minutes.`);
    element.querySelector('.admin-card-actions').append(badge(service.isActive), button('Edit service', () => openService(service)));
    return element;
  }));
  if (!services.length) $('#admin-services').textContent = 'No clinic services yet.';
}
function openService(service = null) {
  editingServiceId = service?.id ?? null;
  const form = $('#service-form');
  form.reset();
  form.elements.name.value = service?.name || '';
  form.elements.description.value = service?.description || '';
  form.elements.averageDurationMinutes.value = service?.averageDurationMinutes || 15;
  form.elements.isActive.checked = service ? Boolean(service.isActive) : true;
  $('#service-dialog-title').textContent = service ? 'Edit clinic service' : 'Add clinic service';
  $('#service-error').textContent = '';
  $('#service-dialog').showModal();
}
$('#new-service').addEventListener('click', () => openService());
$('#close-service').addEventListener('click', () => $('#service-dialog').close());
$('#service-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const payload = Object.fromEntries(new FormData(form));
  payload.isActive = form.elements.isActive.checked;
  submit.disabled = true;
  try {
    const result = await adminApi(editingServiceId ? '/services/' + editingServiceId : '/services', json(editingServiceId ? 'PUT' : 'POST', payload));
    $('#service-dialog').close();
    alertMessage(result.message);
    await loadServices();
  } catch (error) { $('#service-error').textContent = error.message; }
  finally { submit.disabled = false; }
});

async function loadHours() {
  const data = await adminApi('/hours');
  scheduleRevision = data.revision;
  scheduleDirty = false;
  $('#schedule-note').textContent = data.revision === 0 ? 'Initial hours match the previous prototype: every day, 09:00–17:00, with a 12:00–14:00 break. Review and save the clinic’s actual weekly hours.' : 'Weekly appointment hours are configured. Review them before making changes.';
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  $('#hours-days').replaceChildren(...data.days.map(day => {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'hours-day';
    fieldset.dataset.day = day.dayOfWeek;
    fieldset.innerHTML = '<legend></legend><label class="admin-checkbox"><input name="isOpen" type="checkbox" /> Open for appointments</label><div class="hours-times"></div>';
    fieldset.querySelector('legend').textContent = names[day.dayOfWeek];
    fieldset.querySelector('[name="isOpen"]').checked = day.isOpen;
    const labels = { opensAt: 'Opens', closesAt: 'Closes', breakStart: 'Break starts (optional)', breakEnd: 'Break ends (optional)' };
    Object.entries(labels).forEach(([key, text]) => {
      const label = document.createElement('label');
      label.textContent = text;
      const input = document.createElement('input');
      input.type = 'time'; input.step = '1800'; input.name = key;
      input.value = day[key] || '';
      input.required = key === 'opensAt' || key === 'closesAt';
      label.append(input);
      fieldset.querySelector('.hours-times').append(label);
    });
    updateDayAvailability(fieldset);
    return fieldset;
  }));
  $('#save-hours').disabled = false;
}
function updateDayAvailability(fieldset) {
  const isOpen = fieldset.querySelector('[name="isOpen"]').checked;
  fieldset.classList.toggle('closed', !isOpen);
  fieldset.querySelectorAll('.hours-times input').forEach(input => { input.disabled = !isOpen; });
}
$('#hours-form').addEventListener('input', () => { scheduleDirty = true; });
$('#hours-form').addEventListener('change', event => {
  if (event.target.matches('[name="isOpen"]')) updateDayAvailability(event.target.closest('.hours-day'));
});
$('#hours-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const days = [...document.querySelectorAll('.hours-day')].map(fieldset => {
      const day = { dayOfWeek: Number(fieldset.dataset.day), isOpen: fieldset.querySelector('[name="isOpen"]').checked };
      ['opensAt', 'closesAt', 'breakStart', 'breakEnd'].forEach(key => { day[key] = fieldset.querySelector(`[name="${key}"]`).value || null; });
      return day;
    });
    $('#save-hours').disabled = true;
    document.querySelectorAll('.hours-day').forEach(day => { day.disabled = true; });
    $('#reload-hours').disabled = true;
    try {
      const result = await adminApi('/hours', json('PUT', { days, revision: scheduleRevision }));
      scheduleRevision = result.revision;
      scheduleDirty = false;
      alertMessage(result.message);
      await loadHours();
    } finally { $('#save-hours').disabled = false; $('#reload-hours').disabled = false; document.querySelectorAll('.hours-day').forEach(day => { day.disabled = false; }); }
  });
});
$('#reload-hours').addEventListener('click', () => run(async () => {
  if (scheduleDirty && !window.confirm('Discard your unsaved hours and reload the saved schedule?')) return;
  $('#reload-hours').disabled = true;
  try { await loadHours(); } finally { $('#reload-hours').disabled = false; }
}));
window.addEventListener('beforeunload', event => { if (scheduleDirty) { event.preventDefault(); event.returnValue = ''; } });

let auditVersion = 0;
async function loadAudit(page = 1) {
  const version = ++auditVersion;
  const data = await adminApi('/audit?page=' + page);
  if (version !== auditVersion) return;
  auditPage = data.page;
  $('#audit-list').replaceChildren(...data.items.map(item => {
    const time = new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(item.createdAt));
    const element = card(item.action.replaceAll('_', ' '), `${item.actorName} · ${item.actorRole} · ${time} (Malaysia time)`);
    const details = document.createElement('p');
    details.textContent = `${item.entityType.replaceAll('_', ' ')} #${item.entityId} — ${item.details || ''}`;
    element.append(details);
    return element;
  }));
  if (!data.items.length) $('#audit-list').textContent = 'No activity recorded yet.';
  $('#audit-page').textContent = 'Page ' + data.page;
  $('#audit-previous').disabled = data.page <= 1;
  $('#audit-next').disabled = !data.hasMore;
}

const loaders = { overview: loadOverview, staff: loadStaff, services: loadServices, hours: loadHours, activity: loadAudit };
async function showPanel() {
  const name = Object.hasOwn(loaders, location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
  document.querySelectorAll('.staff-nav a').forEach(link => {
    const active = link.hash === '#' + name;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    if (active) link.scrollIntoView({ inline: 'center', block: 'nearest' });
  });
  if (name !== 'hours' || !loaded.has(name)) { await loaders[name](); loaded.add(name); }
}
window.addEventListener('hashchange', () => run(showPanel));
$('#refresh-overview').addEventListener('click', () => run(loadOverview));
$('#refresh-staff').addEventListener('click', () => run(loadStaff));
$('#refresh-audit').addEventListener('click', () => run(() => loadAudit()));
$('#audit-previous').addEventListener('click', () => run(() => loadAudit(auditPage - 1)));
$('#audit-next').addEventListener('click', () => run(() => loadAudit(auditPage + 1)));
$('#logout-button').addEventListener('click', () => run(async () => {
  if (scheduleDirty && !window.confirm('Sign out and discard unsaved hours?')) return;
  const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  if (!response.ok && response.status !== 401) throw new Error('Sign-out failed. Please try again.');
  scheduleDirty = false;
  window.location.replace('/');
}));
run(async () => { if (location.hash && location.hash !== '#overview') await loadOverview(); await showPanel(); });
