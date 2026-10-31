const recoveryEmailForm=document.querySelector('#recovery-email-form');
const recoveryPasswordForm=document.querySelector('#recovery-password-form');
const recoveryStatus=document.querySelector('#recovery-status');
const recoveryResend=document.querySelector('#recovery-resend');
const recoveryRole=document.querySelector('#recovery-role');
let recoveryContext=null,recoveryBusy=false,recoveryDone=false,recoveryRequestAfter=0;
const recoveryKey='mediq-password-recovery';
const requestedRole=new URLSearchParams(location.search).get('role');
recoveryRole.value=requestedRole==='staff'?'staff':'patient';
function recoveryLink(role){return role==='staff'?'/staff-login.html':'/patient-login.html';}
function recoveryMessage(message,error=false){recoveryStatus.hidden=false;recoveryStatus.className='recovery-status'+(error?' error':'');recoveryStatus.textContent=message;}
function recoveryStep(step){document.querySelectorAll('.recovery-steps li').forEach((item,index)=>{if(index===step)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');});}
function recoverySave(){try{if(recoveryContext)sessionStorage.setItem(recoveryKey,JSON.stringify(recoveryContext));else sessionStorage.removeItem(recoveryKey);}catch(_){}}
function recoveryUpdate(){
 document.querySelector('#recovery-back').href=recoveryLink(recoveryContext?.role||recoveryRole.value);
 const requestWait=Math.max(0,Math.ceil((recoveryRequestAfter-Date.now())/1000));const requestButton=recoveryEmailForm.querySelector('[type="submit"]');requestButton.disabled=recoveryBusy||requestWait>0;requestButton.textContent=recoveryBusy?'Please wait…':requestWait?`Try again in ${requestWait}s`:'Send reset code';
 const wait=Math.max(0,Math.ceil(((recoveryContext?.resendAt||0)-Date.now())/1000));
 recoveryResend.disabled=recoveryBusy||wait>0;recoveryResend.textContent=wait?`Resend code in ${wait}s`:'Resend code';
 if(recoveryContext&&!recoveryDone){const remaining=Math.max(0,Math.ceil((recoveryContext.expiresAt-Date.now())/1000));document.querySelector('#recovery-expiry').textContent=remaining?`Code expires in ${Math.floor(remaining/60)}m ${remaining%60}s. Use the newest email.`:'Code expired. Request a new code below.';recoveryPasswordForm.querySelector('[type="submit"]').disabled=recoveryBusy||!remaining;}
}
function recoveryShowCode(){recoveryRole.value=recoveryContext.role;recoveryEmailForm.hidden=true;recoveryPasswordForm.hidden=false;document.querySelector('#recovery-destination').textContent=`${recoveryContext.role==='staff'?'Staff':'Patient'} · ${recoveryContext.email}`;document.querySelector('#recovery-heading').textContent='Choose a new password';document.querySelector('#recovery-description').textContent='Enter the code from your email and a strong new password.';recoveryStep(1);recoveryUpdate();}
function recoveryControls(disabled){recoveryBusy=disabled;document.querySelectorAll('#recovery-email-form input,#recovery-email-form select,#recovery-email-form button,#recovery-password-form input,#recovery-password-form button').forEach(control=>{control.disabled=disabled;});recoveryUpdate();}
async function recoveryPost(path,payload){const response=await fetch('/api/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await readAuthResponse(response);if(!response.ok)throw Object.assign(new Error(data.error||'Please retry.'),{retryAfter:data.retryAfter});return data;}
async function requestRecoveryCode(email,role){
 recoveryControls(true);recoveryMessage('Requesting a reset code…');
 try{const data=await recoveryPost('forgot-password',{email,role});const sameAccount=recoveryContext?.email===email&&recoveryContext?.role===role;recoveryContext={email,role,resetSession:data.resetSession,expiresAt:Date.now()+data.expiresIn*1000,resendAt:Date.now()+data.resendAfter*1000};recoverySave();if(!sameAccount)recoveryPasswordForm.reset();document.querySelector('#recovery-code').value='';updateRecoveryRules();recoveryShowCode();recoveryMessage(data.previewCode?`Local testing code: ${data.previewCode}`:data.message);document.querySelector('#recovery-code').focus();}
 catch(error){recoveryMessage(authFailure(error),true);if(error.retryAfter){recoveryRequestAfter=Date.now()+error.retryAfter*1000;if(recoveryContext){recoveryContext.resendAt=recoveryRequestAfter;recoverySave();}}}
 finally{recoveryControls(false);}
}
recoveryEmailForm.onsubmit=event=>{event.preventDefault();if(!recoveryBusy)requestRecoveryCode(recoveryEmailForm.elements.email.value.trim(),recoveryRole.value);};
recoveryResend.onclick=()=>{if(!recoveryBusy&&recoveryContext)requestRecoveryCode(recoveryContext.email,recoveryContext.role);};
document.querySelector('#recovery-change-email').onclick=()=>{if(recoveryBusy)return;recoveryEmailForm.elements.email.value=recoveryContext.email;recoveryRole.value=recoveryContext.role;recoveryContext=null;recoverySave();recoveryPasswordForm.reset();recoveryEmailForm.hidden=false;recoveryPasswordForm.hidden=true;recoveryStatus.hidden=true;document.querySelector('#recovery-heading').textContent='Forgot your password?';document.querySelector('#recovery-description').textContent='Enter your email and account type. We will email you a six-digit reset code.';recoveryStep(0);recoveryUpdate();};
recoveryPasswordForm.onsubmit=async event=>{
 event.preventDefault();if(recoveryBusy||!recoveryContext)return;
 const payload=Object.fromEntries(new FormData(recoveryPasswordForm));
 if(!Object.values(passwordRules(payload.newPassword)).every(Boolean)||payload.newPassword.length>128){recoveryMessage('Please meet all password requirements.',true);return;}
 if(payload.newPassword!==payload.confirmPassword){recoveryMessage('The new passwords do not match.',true);document.querySelector('#recovery-confirm-password').focus();return;}
 recoveryControls(true);recoveryMessage('Resetting your password…');
 try{const data=await recoveryPost('reset-password',{...payload,resetSession:recoveryContext.resetSession});recoveryDone=true;recoveryContext=null;recoverySave();recoveryPasswordForm.reset();recoveryPasswordForm.hidden=true;document.querySelector('#recovery-success').hidden=false;document.querySelector('#recovery-continue').href=data.redirect;document.querySelector('#recovery-back').href=data.redirect;document.querySelector('#recovery-heading').textContent='Password reset';document.querySelector('#recovery-description').textContent='Your new password is ready to use.';recoveryStep(2);recoveryMessage(data.message);}
 catch(error){recoveryMessage(authFailure(error),true);}
 finally{recoveryControls(false);}
};
function updateRecoveryRules(){const value=recoveryPasswordForm.elements.newPassword.value,rules=passwordRules(value);rules.length=rules.length&&value.length<=128;Object.entries(rules).forEach(([name,passed])=>document.querySelector(`#recovery-rules [data-rule="${name}"]`).classList.toggle('met',passed));const confirm=recoveryPasswordForm.elements.confirmPassword.value;document.querySelector('#recovery-match').textContent=confirm?(confirm===value?'Passwords match.':'Passwords do not match.'):'';}
recoveryPasswordForm.addEventListener('input',updateRecoveryRules);
document.querySelectorAll('[data-recovery-toggle]').forEach(button=>button.onclick=()=>{const input=document.getElementById(button.dataset.recoveryToggle),show=input.type==='password';input.type=show?'text':'password';button.textContent=show?'Hide':'Show';button.setAttribute('aria-label',(show?'Hide':'Show')+' '+(input.name==='newPassword'?'new password':'confirmed password'));});
recoveryRole.onchange=recoveryUpdate;
try{const saved=JSON.parse(sessionStorage.getItem(recoveryKey)||'null');if(saved&&/^[A-Za-z0-9_-]{43}$/.test(saved.resetSession||'')&&['patient','staff'].includes(saved.role)&&saved.expiresAt>Date.now()&&(!requestedRole||requestedRole===saved.role)){recoveryContext=saved;recoveryShowCode();recoveryMessage('Enter the latest reset code from your email.');}else sessionStorage.removeItem(recoveryKey);}catch(_){}
recoveryUpdate();setInterval(recoveryUpdate,1000);
