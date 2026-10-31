const fs=require('fs'),path=require('path'),vm=require('vm');
function harness(saved){
 const nodes=new Map(),storage=new Map();if(saved)storage.set('mediq-password-recovery',JSON.stringify(saved));
 const node=id=>{if(!nodes.has(id))nodes.set(id,{id,value:'',hidden:false,disabled:false,textContent:'',classList:{toggle:jest.fn()},setAttribute:jest.fn(),removeAttribute:jest.fn(),focus:jest.fn(),addEventListener:jest.fn()});return nodes.get(id);};
 const emailForm=node('#recovery-email-form'),passwordForm=node('#recovery-password-form');
 emailForm.elements={email:node('#recovery-email'),role:node('#recovery-role')};passwordForm.elements={code:node('#recovery-code'),newPassword:node('#recovery-new-password'),confirmPassword:node('#recovery-confirm-password')};
 for(const form of [emailForm,passwordForm]){form.querySelector=()=>node(form.id+'-submit');form.reset=()=>Object.values(form.elements).forEach(input=>{input.value='';});}
 passwordForm.hidden=true;const steps=[node('step1'),node('step2'),node('step3')];
 const document={querySelector:node,getElementById:id=>node('#'+id),querySelectorAll:selector=>selector==='.recovery-steps li'?steps:selector==='[data-recovery-toggle]'?[]:[...Object.values(emailForm.elements),...Object.values(passwordForm.elements),emailForm.querySelector(),passwordForm.querySelector(),node('#recovery-resend'),node('#recovery-change-email')]};
 const response=data=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>data});const fetch=jest.fn();
 const context=vm.createContext({document,location:{search:'?role=staff'},URLSearchParams,fetch,sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},setInterval:jest.fn(),readAuthResponse:res=>res.json(),authFailure:error=>error.message,passwordRules:value=>({length:value.length>=12,upper:/[A-Z]/.test(value),lower:/[a-z]/.test(value),number:/\d/.test(value),symbol:/[^A-Za-z0-9]/.test(value)}),FormData:function(form){return Object.entries(form.elements).map(([key,input])=>[key,input.value]);}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../frontend/password-recovery.js'),'utf8'),context);
 return {context,node,emailForm,passwordForm,fetch,response,storage};
}
test('request saves only recovery context and opens code entry',async()=>{
 const h=harness();h.fetch.mockResolvedValueOnce(h.response({resetSession:'c'.repeat(43),expiresIn:600,resendAfter:60,message:'Check your inbox'}));
 await h.context.requestRecoveryCode('staff@example.test','staff');
 const saved=JSON.parse(h.storage.get('mediq-password-recovery'));expect(saved.role).toBe('staff');expect(saved).not.toHaveProperty('newPassword');expect(saved).not.toHaveProperty('code');expect(h.passwordForm.hidden).toBe(false);expect(h.node('#recovery-back').href).toBe('/staff-login.html');
});
test('refresh restores an unexpired recovery request and cooldown',()=>{
 const h=harness({role:'staff',email:'staff@example.test',resetSession:'c'.repeat(43),expiresAt:Date.now()+300000,resendAt:Date.now()+30000});
 expect(h.passwordForm.hidden).toBe(false);expect(h.node('#recovery-resend').disabled).toBe(true);expect(h.node('#recovery-expiry').textContent).toContain('Code expires in');
});
test('expired saved requests are cleared rather than trapping the user',()=>{
 const h=harness({role:'staff',email:'staff@example.test',resetSession:'c'.repeat(43),expiresAt:Date.now()-1000});expect(h.storage.has('mediq-password-recovery')).toBe(false);expect(h.passwordForm.hidden).toBe(true);
});
test('success clears recovery storage and shows the correct sign-in destination',async()=>{
 const h=harness({role:'staff',email:'staff@example.test',resetSession:'c'.repeat(43),expiresAt:Date.now()+300000,resendAt:0});
 h.passwordForm.elements.code.value='123456';h.passwordForm.elements.newPassword.value='New-Staff-Password-2026!';h.passwordForm.elements.confirmPassword.value='New-Staff-Password-2026!';
 h.fetch.mockResolvedValueOnce(h.response({message:'Password reset',redirect:'/staff-login.html'}));await h.passwordForm.onsubmit({preventDefault(){}});
 expect(h.storage.has('mediq-password-recovery')).toBe(false);expect(h.node('#recovery-continue').href).toBe('/staff-login.html');expect(h.passwordForm.hidden).toBe(true);expect(h.passwordForm.elements.newPassword.value).toBe('');
});
