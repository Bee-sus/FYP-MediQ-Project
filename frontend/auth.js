fetch('/api/settings').then(response => response.json()).then(data => document.querySelectorAll('.brand small').forEach(item => { item.textContent = data.settings.clinicName; })).catch(() => {});
const registrationMessages = {
  fullName: 'Enter your full name using at least 2 letters.', email: 'Enter a valid email address.',
  phone: 'Enter a valid phone number containing 8–15 digits.', birthDate: 'Enter a valid date of birth that is not in the future.',
  gender: 'Select a gender option.', password: 'Meet all five password requirements.',
  confirmPassword: 'Re-enter the same password.', terms: 'Accept the Terms and Privacy Notice to register.',
};

function passwordRules(value) {
  return { length: value.length >= 12, upper: /[A-Z]/.test(value), lower: /[a-z]/.test(value), number: /\d/.test(value), symbol: /[^A-Za-z0-9]/.test(value) };
}

function setFieldState(field, showMessage = true) {
  const error = document.querySelector(`#${field.id}-error`);
  if (!error) return field.checkValidity();
  field.setCustomValidity('');
  let message = '';
  if (field.name === 'birthDate' && field.value && new Date(`${field.value}T00:00:00`) > new Date()) message = registrationMessages.birthDate;
  else if (field.name === 'phone' && field.value && (field.value.replace(/\D/g, '').length < 8 || field.value.replace(/\D/g, '').length > 15)) message = registrationMessages.phone;
  else if (field.name === 'password' && !Object.values(passwordRules(field.value)).every(Boolean)) message = registrationMessages.password;
  else if (field.name === 'confirmPassword' && field.value !== document.querySelector('#password').value) message = registrationMessages.confirmPassword;
  else if (!field.validity.valid) message = registrationMessages[field.name] || 'Check this field.';
  field.setCustomValidity(message); error.textContent = showMessage ? message : ''; field.setAttribute('aria-invalid', String(Boolean(message)));
  return !message;
}

function updatePasswordMatch() {
  const confirmation = document.querySelector('#confirm-password'); if (!confirmation) return;
  const status = document.querySelector('#password-match'); const matches = confirmation.value && confirmation.value === document.querySelector('#password').value;
  status.textContent = !confirmation.value ? 'Re-enter your password.' : matches ? 'Passwords match.' : 'Passwords do not match.';
  status.classList.toggle('success', Boolean(matches)); status.classList.toggle('error', Boolean(confirmation.value && !matches));
  setFieldState(confirmation, confirmation.dataset.touched === 'true' || Boolean(confirmation.value));
}

function updatePasswordDisplay() {
  const password = document.querySelector('#password'); if (!password || !document.querySelector('#password-strength')) return;
  const rules = passwordRules(password.value);
  Object.entries(rules).forEach(([rule, passed]) => document.querySelector(`[data-rule="${rule}"]`)?.classList.toggle('met', passed));
  const score = Object.values(rules).filter(Boolean).length; const labels = ['Not entered', 'Very weak', 'Weak', 'Fair', 'Good', 'Strong'];
  document.querySelector('#password-strength').textContent = password.value ? labels[score] : labels[0];
  document.querySelector('#strength-bar').style.width = password.value ? `${score * 20}%` : '0';
  setFieldState(password, password.dataset.touched === 'true'); updatePasswordMatch();
}

function configurePasswordToggles() {
  document.querySelectorAll('[data-password-toggle]').forEach((button) => button.addEventListener('click', () => {
    const input = document.querySelector(`#${button.dataset.passwordToggle}`); const show = input.type === 'password';
    input.type = show ? 'text' : 'password'; button.textContent = show ? 'Hide' : 'Show';
    button.setAttribute('aria-label', `${show ? 'Hide' : 'Show'} ${input.id === 'password' ? 'password' : 'confirmed password'}`);
  }));
}

function showServerFieldErrors(fields = {}) {
  Object.entries(fields).forEach(([name, message]) => {
    const field = document.querySelector(`[name="${name}"]`); const error = field && document.querySelector(`#${field.id}-error`);
    if (field) field.setAttribute('aria-invalid', 'true'); if (error) error.textContent = message;
  });
}

async function submitAuthForm(form, status) {
  const values = Object.fromEntries(new FormData(form));
  const isRegistration = form.dataset.authForm === 'register';
  const roles = { 'patient-login': 'patient', 'staff-login': 'staff', 'admin-login': 'admin' };
  const payload = { ...values, terms: values.terms === 'on', remember: values.remember === 'on' };
  if (!isRegistration) payload.role = roles[form.dataset.authForm];
  const response = await fetch(`/api/auth/${isRegistration ? 'register' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const result = await response.json();
  if(result.verificationMethod==='otp'&&result.verificationSession){status.hidden=true;openPatientVerification(result);return;}
  if (!response.ok) { showServerFieldErrors(result.fields); throw new Error(result.error || 'The request could not be completed.'); }
  status.textContent = result.message; status.className = 'form-status'; status.hidden = false;
  if (result.verificationPreviewUrl) { const link = document.createElement('a'); link.href = result.verificationPreviewUrl; link.textContent = ' Open local verification link'; status.append(link); }
  if (result.requiresVerification) return;
  if (result.redirect) window.location.assign(result.redirect);
  else if (isRegistration) setTimeout(() => window.location.assign('/patient-login.html'), 900);
}

function configureAuthForm() {
  const form = document.querySelector('[data-auth-form]'); if (!form) return; configurePasswordToggles();
  if (form.dataset.authForm === 'register') {
    const birthDate = form.querySelector('#birth-date'); const now = new Date(); birthDate.max = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    form.querySelectorAll('input, select').forEach((field) => {
      field.addEventListener('blur', () => { field.dataset.touched = 'true'; setFieldState(field); });
      field.addEventListener(field.type === 'checkbox' || field.tagName === 'SELECT' ? 'change' : 'input', () => setFieldState(field, field.dataset.touched === 'true'));
    });
    const ageOutput = document.querySelector('#registration-age');
    function updateRegistrationAge() {
      if (!ageOutput) return;
      const value = birthDate.value;
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      const today = Object.fromEntries(parts.map(part => [part.type, part.value]));
      const [year, month, day] = value.split('-').map(Number);
      const age = Number(today.year) - year - (Number(today.month) < month || (Number(today.month) === month && Number(today.day) < day) ? 1 : 0);
      ageOutput.textContent = !value || !birthDate.checkValidity() || age < 0 ? 'Age will be calculated from your date of birth.' : 'Age: ' + age + (age === 1 ? ' year' : ' years');
    }
    birthDate.addEventListener('input', updateRegistrationAge); birthDate.addEventListener('change', updateRegistrationAge); updateRegistrationAge();
    form.querySelector('#password').addEventListener('input', updatePasswordDisplay); form.querySelector('#confirm-password').addEventListener('input', updatePasswordMatch); updatePasswordDisplay();
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); const status = document.querySelector('#form-status');
    if (form.dataset.authForm === 'register') {
      const fields = [...form.querySelectorAll('input, select')]; fields.forEach((field) => { field.dataset.touched = 'true'; setFieldState(field); });
      const firstInvalid = fields.find((field) => !field.checkValidity());
      if (firstInvalid) { status.textContent = 'Please correct the highlighted registration fields.'; status.className = 'form-status error'; status.hidden = false; firstInvalid.focus(); return; }
    }
    const button = form.querySelector('.submit-button'); button.disabled = true; status.textContent = 'Please wait…'; status.className = 'form-status'; status.hidden = false;
    try { await submitAuthForm(form, status); } catch (error) { status.textContent = error.message; status.className = 'form-status error'; status.hidden = false; } finally { button.disabled = false; }
  });
  form.querySelector('.resend-verification')?.addEventListener('click', async () => {
    const status = document.querySelector('#form-status'); const email = form.elements.email.value.trim();
    if (!email) { status.textContent = 'Enter your email address first.'; status.className = 'form-status error'; status.hidden = false; return; }
    const role = form.dataset.authForm === 'staff-login' ? 'staff' : 'patient';
    try { const response = await fetch('/api/auth/resend-verification', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, role }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); status.textContent = result.message; status.className = 'form-status'; status.hidden = false; if (result.verificationPreviewUrl) { const link = document.createElement('a'); link.href = result.verificationPreviewUrl; link.textContent = ' Open local verification link'; status.append(link); } }
    catch (error) { status.textContent = error.message; status.className = 'form-status error'; status.hidden = false; }
  });
}

let otpDialog,otpTimer;
configureAuthForm();
if(['register','patient-login'].includes(document.querySelector('[data-auth-form]')?.dataset.authForm)){
 try{const pending=JSON.parse(sessionStorage.getItem('mediq-pending-verification')||'null');if(pending?.verificationSession)openPatientVerification(pending);}catch(_){}
}

function openPatientVerification(context){
 // Native dialog keeps focus inside the verification flow and supports Escape.
 if(otpDialog){clearInterval(otpTimer);otpDialog.remove();}
 try{sessionStorage.setItem('mediq-pending-verification',JSON.stringify(context));}catch(_){}
 otpDialog=document.createElement('dialog');otpDialog.className='patient-otp-dialog';otpDialog.setAttribute('aria-labelledby','otp-heading');
 otpDialog.innerHTML='<button type="button" class="otp-close" aria-label="Continue verification later">×</button><div class="otp-symbol" aria-hidden="true">@</div><p class="eyebrow">Finish registration</p><h2 id="otp-heading">Verify your email address</h2><p class="otp-description">We will send a six-digit code to <strong id="otp-email"></strong>.</p><button type="button" class="submit-button otp-send">Send verification code</button><form class="otp-code-form" hidden><label for="otp-code">Verification code</label><input id="otp-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required /><small>The code expires in 10 minutes. Use the newest email.</small><button class="submit-button" type="submit">Verify email</button></form><p class="otp-result" role="status" aria-live="polite"></p><a class="submit-button otp-continue" href="/patient-login.html" hidden>Continue to sign in</a>';
 document.body.append(otpDialog);otpDialog.querySelector('#otp-email').textContent=context.verificationEmail||'your registered email';
 const send=otpDialog.querySelector('.otp-send'),form=otpDialog.querySelector('form'),result=otpDialog.querySelector('.otp-result'),input=form.elements.code;
 let busy=false,verified=false,deadline=Number(context.resendAt)||0;
 const update=()=>{const wait=Math.max(0,Math.ceil((deadline-Date.now())/1000));send.disabled=busy||wait>0;send.textContent=busy?'Sending…':wait?`Resend code in ${wait}s`:form.hidden?'Send verification code':'Resend code';};
 const later=()=>{otpDialog.close();if(verified){window.location.assign('/patient-login.html');return;}const status=document.querySelector('#form-status');status.replaceChildren();status.className='form-status';status.hidden=false;const reopen=document.createElement('button');reopen.type='button';reopen.className='otp-resume';reopen.textContent='Continue email verification';reopen.onclick=()=>otpDialog.showModal();status.append(reopen);};
 otpDialog.querySelector('.otp-close').onclick=later;otpDialog.addEventListener('cancel',event=>{event.preventDefault();later();});
 const post=async(path,body)=>{const response=await fetch('/api/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({verificationSession:context.verificationSession,...body})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Please try again.');return data;};
 send.onclick=async()=>{if(busy)return;busy=true;update();result.textContent='Sending your verification code…';form.querySelector('button').disabled=true;
  try{const data=await post('request-email-code',{});deadline=Date.now()+data.resendAfter*1000;context.resendAt=deadline;try{sessionStorage.setItem('mediq-pending-verification',JSON.stringify(context));}catch(_){}form.hidden=false;input.value='';result.textContent=data.previewCode?`Local testing code: ${data.previewCode}`:data.message;input.focus();}
  catch(error){result.textContent=error.message;}finally{busy=false;form.querySelector('button').disabled=false;update();}
 };
 form.onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;form.querySelector('button').disabled=true;send.disabled=true;result.textContent='Checking your code…';
  try{const data=await post('verify-email-code',{code:input.value.trim()});verified=true;clearInterval(otpTimer);try{sessionStorage.removeItem('mediq-pending-verification');}catch(_){}form.hidden=true;send.hidden=true;otpDialog.querySelector('h2').textContent='Email verified';otpDialog.querySelector('.otp-description').textContent='Your Patient account is ready. You can now sign in.';result.textContent=data.message;otpDialog.querySelector('.otp-continue').hidden=false;}
  catch(error){result.textContent=error.message;input.focus();}finally{busy=false;form.querySelector('button').disabled=false;if(!verified)update();}
 };
 if(deadline>Date.now()){form.hidden=false;result.textContent='Enter the latest code sent to your email.';}
 update();otpTimer=setInterval(update,1000);otpDialog.showModal();
}
