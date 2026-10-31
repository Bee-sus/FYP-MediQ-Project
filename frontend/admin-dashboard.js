const $ = selector => document.querySelector(selector);
let scheduleRevision = null;
let scheduleDirty = false;
let editingServiceId = null;
let auditPage = 1;
let patientPage = 1;
const loaded = new Set();
const adminPicture = setupProfilePicturePicker($('#create-staff-form .profile-picture-field'), $('#create-staff-form [name="fullName"]'));

async function adminApi(path, options = {}) {
  const response = await fetch('/api/admin' + path, { credentials: 'same-origin', ...options });
  if (response.status === 401 || response.status === 403) {
    window.location.replace('/admin-login.html');
    throw new Error('Administrator sign-in required.');
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error(response.status === 413 ? 'The selected picture is too large.' : 'The server returned an invalid response. Restart the application server and try again.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}

function json(method, body) { return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
function alertMessage(message, error = false) {
  const alert = $('#admin-alert');
  alert.textContent = message;
  alert.className = 'staff-alert' + (error ? ' error' : '');
  alert.setAttribute('role', error ? 'alert' : 'status');
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
function button(text, handler, className = 'staff-secondary-button') {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
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
    const element = document.createElement('details');
    element.className = 'admin-card staff-record';
    element.innerHTML = '<summary><span class="staff-avatar"></span><span><strong></strong></span><span class="staff-state"></span></summary><div class="staff-record-body"><dl><dt>Staff ID</dt><dd class="staff-code"></dd><dt>Email</dt><dd class="staff-email"></dd><dt>Contact</dt><dd class="staff-phone"></dd><dt>Created</dt><dd class="staff-created"></dd></dl><div class="admin-card-actions"></div></div>';
    const avatar = element.querySelector('.staff-avatar');
    if (person.profilePictureUrl) {
      const image = document.createElement('img'); image.src = person.profilePictureUrl; image.alt = '';
      image.onerror = () => { avatar.replaceChildren(); avatar.textContent = person.fullName.slice(0, 1).toUpperCase(); };
      avatar.append(image);
    } else avatar.textContent = person.fullName.slice(0, 1).toUpperCase();
    element.querySelector('summary strong').textContent = person.fullName;
    element.querySelector('.staff-state').append(badge(person.isActive));
    element.querySelector('.staff-code').textContent = person.staffCode || 'Not assigned';
    element.querySelector('.staff-email').textContent = person.email;
    element.querySelector('.staff-phone').textContent = person.phone || 'Not provided';
    element.querySelector('.staff-created').textContent = new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium' }).format(new Date(person.createdAt));
    const actions = element.querySelector('.admin-card-actions');
    actions.append(button(person.isActive ? 'Deactivate' : 'Activate', async () => {
      if (!(await window.mediqDialog({ title: person.isActive ? 'Deactivate staff account?' : 'Restore staff access?', message: person.isActive ? `Deactivate ${person.fullName}? Their sessions will be signed out.` : `Restore staff access for ${person.fullName}?`, confirmLabel: person.isActive ? 'Deactivate' : 'Restore access', danger: Boolean(person.isActive) }))) return;
      const result = await adminApi('/staff/' + person.id, json('PATCH', { isActive: !Boolean(person.isActive) }));
      alertMessage(result.message);
      await loadStaff();
    }));
    if (!Number(person.hasActivityHistory)) {
      actions.append(button('Delete permanently', async () => {
        if (!(await window.mediqDialog({ title: 'Delete unused staff account?', message: `Permanently delete ${person.fullName}'s unused Staff account? This removes their login and sessions and cannot be undone. Accounts with activity history must be deactivated instead.`, confirmLabel: 'Delete permanently', danger: true }))) return;
        const result = await adminApi('/staff/' + person.id, { method: 'DELETE' });
        alertMessage(result.message);
        await loadStaff();
      }, 'staff-danger-button'));
    } else {
      const historyNote = document.createElement('small');
      historyNote.textContent = 'Activity history retained. Deactivate this account to remove access.';
      actions.append(historyNote);
    }
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
      const credentials = result.credentials;
      form.reset();
      $('#generated-staff-password').value = credentials.temporaryPassword;
      adminPicture.setValue('');
      alertMessage(result.message);
      $('#credential-id').textContent = credentials.staffCode;
      $('#credential-name').textContent = credentials.fullName;
      $('#credential-email').textContent = credentials.email;
      $('#credential-password').textContent = credentials.temporaryPassword;
      $('#credential-email-status').textContent = credentials.emailSent
        ? 'The onboarding email was sent. The Staff member must verify their email and change the temporary password.'
        : credentials.emailFailed
          ? 'The account was created, but the onboarding email failed to send. Check the SMTP settings and server log.'
          : 'No email was sent because SMTP is not configured. Use the email draft or configure SMTP before creating accounts for real delivery.';
      $('#email-credentials').textContent = credentials.emailSent ? 'Email sent' : 'Open email draft';
      $('#email-credentials').disabled = Boolean(credentials.emailSent);
      const verification = $('#credential-verification');
      verification.replaceChildren(); verification.hidden = !credentials.verificationPreviewUrl; $('#verification-link-label').hidden = !credentials.verificationPreviewUrl;
      if (credentials.verificationPreviewUrl) { const link = document.createElement('a'); link.href = credentials.verificationPreviewUrl; link.textContent = 'Open local verification link'; verification.append(link); }
      $('#email-credentials').onclick = () => {
        const subject = encodeURIComponent('Your MediQ Staff login credentials');
        const body = encodeURIComponent(`Hello ${credentials.fullName},\n\nThe clinic administrator has created your MediQ Staff account.\n\nStaff ID: ${credentials.staffCode}\nLogin email: ${credentials.email}\nTemporary password: ${credentials.temporaryPassword}\n\nPlease verify your email using the link provided by the clinic, then sign in and change the temporary password to a password of your choice. Keep these details private.`);
        window.location.href = `mailto:${encodeURIComponent(credentials.email)}?subject=${subject}&body=${body}`;
      };
      $('#credentials-dialog').showModal();
      await loadStaff();
    } finally { submit.disabled = false; }
  });
});
async function loadServices() {
  const { services } = await adminApi('/services');
  $('#admin-services').replaceChildren(...services.map(service => {
    const element = card(service.name, `${service.doctorName ? `Doctor: ${service.doctorName}. ` : ''}${service.serviceDetails || service.description || 'No service details.'} Average duration: ${service.averageDurationMinutes} minutes. Capacity: ${service.queueCapacity || 'No limit'}.`);
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
  form.elements.doctorName.value = service?.doctorName || '';
  form.elements.serviceDetails.value = service?.serviceDetails || '';
  form.elements.averageDurationMinutes.value = service?.averageDurationMinutes || 15;
  form.elements.queueCapacity.value = service?.queueCapacity || '';
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
  await loadClosures();
}
async function loadClosures() {
  const { closures } = await adminApi('/closures');
  $('#closure-list').replaceChildren(...closures.map(item => {
    const element = card(new Intl.DateTimeFormat('en-MY', { dateStyle: 'full' }).format(new Date(`${item.closureDate}T00:00:00`)), item.reason);
    element.querySelector('.admin-card-actions').append(button('Remove closure', async () => {
      const result = await adminApi('/closures/' + item.closureDate, { method: 'DELETE' });
      alertMessage(result.message); await loadClosures();
    }));
    return element;
  }));
  if (!closures.length) $('#closure-list').textContent = 'No upcoming special closure dates.';
}
$('#closure-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  run(async () => {
    const result = await adminApi('/closures', json('POST', Object.fromEntries(new FormData(form))));
    alertMessage(result.message); form.reset(); await loadClosures();
  });
});
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
  if (scheduleDirty && !(await window.mediqDialog({ title: 'Discard unsaved changes?', message: 'Discard your unsaved hours and reload the saved schedule?', confirmLabel: 'Discard changes', danger: true }))) return;
  $('#reload-hours').disabled = true;
  try { await loadHours(); } finally { $('#reload-hours').disabled = false; }
}));
window.addEventListener('beforeunload', event => { if (scheduleDirty) { event.preventDefault(); event.returnValue = ''; } });

let auditVersion = 0;
async function loadAudit(page = 1) {
  const version = ++auditVersion;
  const filters = new FormData($('#audit-filter-form'));
  const data = await adminApi('/audit?page=' + page + '&role=' + encodeURIComponent(filters.get('role')) + '&query=' + encodeURIComponent(filters.get('query')));
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

async function loadPatients() {
  const query = new FormData($('#patient-search-form')).get('query') || '';
  const data = await adminApi('/patients?query=' + encodeURIComponent(query)+'&page='+patientPage);
  if(!data.patients.length&&patientPage>1){patientPage--;return loadPatients();}
  $('#patient-page').textContent='Page '+data.page;$('#patient-previous').disabled=data.page<=1;$('#patient-next').disabled=!data.hasMore;
  $('#patient-details').replaceChildren();
  $('#patient-list').replaceChildren(...data.patients.map(patient => {
    const element = card(patient.fullName, `${patient.email} · ${patient.phone || 'No contact number'}`);
    element.dataset.patientId=patient.id;
    const state=document.createElement('div');state.className='patient-account-state';state.append(badge(Boolean(patient.isActive)));const verified=document.createElement('span');verified.textContent=patient.verifiedAt?'Email verified':'Awaiting email verification';state.append(verified);element.querySelector('p').after(state);
    element.querySelector('.admin-card-actions').append(button('View history', () => loadPatientDetails(patient.id)));
    element.querySelector('.admin-card-actions').append(button(patient.isActive?'Deactivate':'Reactivate',async()=>{
      if(!(await window.mediqDialog({title:patient.isActive?'Deactivate patient?':'Reactivate patient?',message:patient.isActive?'This patient will be signed out and unable to sign in. Their visit history will be kept.':'This patient will be able to sign in again after email verification.',confirmLabel:patient.isActive?'Deactivate':'Reactivate'})))return;
      const result=await adminApi('/patients/'+patient.id,json('PATCH',{isActive:!Boolean(patient.isActive)}));alertMessage(result.message);await loadPatients();
    }));
    element.querySelector('.admin-card-actions').append(button('Delete account',async()=>{
      if(!(await window.mediqDialog({title:'Delete patient account?',message:'This permanently removes the patient’s account details and login access. Linked clinic visit history is retained anonymously. Active queue entries and appointments must be completed or cancelled first. This cannot be undone.',confirmLabel:'Delete account',danger:true})))return;
      const result=await adminApi('/patients/'+patient.id,{method:'DELETE'});alertMessage(result.message);await loadPatients();
    },'staff-danger-button'));
    return element;
  }));
  if (!data.patients.length) $('#patient-list').textContent = 'No patients match this search.';
}
async function loadPatientDetails(id) {
  const data = await adminApi('/patients/' + id);
  const panel = $('#patient-details');
  panel.innerHTML = '<article class="admin-card patient-history"><div class="staff-section-heading"><div><h3></h3><p class="patient-contact"></p></div><button type="button" class="staff-secondary-button close-patient-history">Close</button></div><div class="patient-history-columns"><section><h4>Queue history</h4><div class="queue-history-list"></div></section><section><h4>Appointments</h4><div class="appointment-history-list"></div></section></div></article>';
  panel.querySelector('h3').textContent = data.patient.fullName;
  panel.querySelector('.patient-contact').textContent = `${data.patient.email} · ${data.patient.phone || 'No contact number'}`;
  const edit=document.createElement('form');edit.className='patient-account-edit';edit.innerHTML='<h4>Account details</h4><label>Full name<input name="fullName" minlength="2" maxlength="120" required /></label><label>Contact number<input name="phone" type="tel" maxlength="30" required /></label><button type="submit" class="staff-primary-button">Save details</button><p role="status"></p>';
  edit.elements.fullName.value=data.patient.fullName;edit.elements.phone.value=data.patient.phone||'';
  edit.onsubmit=async event=>{event.preventDefault();const submit=edit.querySelector('button');submit.disabled=true;try{const result=await adminApi('/patients/'+id,json('PATCH',Object.fromEntries(new FormData(edit))));edit.querySelector('p').textContent=result.message;panel.querySelector('h3').textContent=edit.elements.fullName.value.trim();panel.querySelector('.patient-contact').textContent=data.patient.email+' · '+edit.elements.phone.value.trim();const listing=$('#patient-list').querySelector(`[data-patient-id="${id}"]`);if(listing){listing.querySelector('h3').textContent=edit.elements.fullName.value.trim();listing.querySelector('p').textContent=data.patient.email+' · '+edit.elements.phone.value.trim();}loaded.delete('patients');}catch(error){edit.querySelector('p').textContent=error.message;}finally{submit.disabled=false;}};
  panel.querySelector('.patient-history-columns').before(edit);
  const makeRows = items => items.map(item => { const row = document.createElement('p'); row.textContent = `${String(item.queueDate || item.appointmentDate).slice(0, 10)} · ${item.serviceName} · ${item.status}`; return row; });
  panel.querySelector('.queue-history-list').replaceChildren(...makeRows(data.queues));
  panel.querySelector('.appointment-history-list').replaceChildren(...makeRows(data.appointments));
  if (!data.queues.length) panel.querySelector('.queue-history-list').textContent = 'No queue history.';
  if (!data.appointments.length) panel.querySelector('.appointment-history-list').textContent = 'No appointments.';
  panel.querySelector('.close-patient-history').addEventListener('click', () => panel.replaceChildren());
}
async function loadSettings() {
  const { settings } = await adminApi('/settings'); const form = $('#settings-form');
  for (const key of ['clinicName', 'address', 'phone', 'timezone']) form.elements[key].value = settings[key] || '';
  document.querySelectorAll('.brand small').forEach(item => { item.textContent = settings.clinicName; });
}
$('#patient-search-form').addEventListener('submit', event => { event.preventDefault();patientPage=1;run(loadPatients); });
$('#patient-previous').onclick=()=>{patientPage=Math.max(1,patientPage-1);run(loadPatients);};
$('#patient-next').onclick=()=>{patientPage++;run(loadPatients);};
$('#settings-form').addEventListener('submit', event => { event.preventDefault(); run(async () => { const result = await adminApi('/settings', json('PUT', Object.fromEntries(new FormData(event.currentTarget)))); alertMessage(result.message); await loadSettings(); }); });
const loaders = { overview: loadOverview, staff: loadStaff, services: loadServices, hours: loadHours, patients: loadPatients, settings: loadSettings, activity: loadAudit };
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
$('#audit-filter-form').addEventListener('submit', event => { event.preventDefault(); run(() => loadAudit(1)); });
$('#audit-previous').addEventListener('click', () => run(() => loadAudit(auditPage - 1)));
$('#audit-next').addEventListener('click', () => run(() => loadAudit(auditPage + 1)));
$('#logout-button').addEventListener('click', () => run(async () => {
  if (scheduleDirty && !(await window.mediqDialog({ title: 'Sign out?', message: 'Sign out and discard unsaved hours?', confirmLabel: 'Sign out', danger: true }))) return;
  const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  if (!response.ok && response.status !== 401) throw new Error('Sign-out failed. Please try again.');
  scheduleDirty = false;
  window.location.replace('/');
}));
$('#close-credentials').addEventListener('click', () => $('#credentials-dialog').close());
run(async () => { await loadSettings(); if (location.hash && location.hash !== '#overview') await loadOverview(); await showPanel(); });
