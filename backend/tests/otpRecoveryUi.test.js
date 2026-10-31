const fs=require('fs');const path=require('path');const vm=require('vm');
function harness(){
 const elements=[];const storage=new Map();
 const make=tag=>{
  const nodes=new Map();const element={tag,hidden:false,disabled:false,value:'',children:[],textContent:'',
   setAttribute:jest.fn(),remove:jest.fn(),replaceChildren(){this.children=[];},append(child){this.children.push(child);},addEventListener:jest.fn(),focus:jest.fn(),showModal(){this.open=true;},close(){this.open=false;},
   querySelector(selector){if(!nodes.has(selector)){const node=make(selector);if(selector==='form'){node.hidden=true;node.elements={code:make('code')};}nodes.set(selector,node);}return nodes.get(selector);}};
  elements.push(element);return element;
 };
 const status=make('status');const document={createElement:make,querySelector:selector=>selector==='#form-status'?status:null,querySelectorAll:()=>[],body:{append:jest.fn()}};
 const response=(data,ok=true)=>({ok,headers:{get:()=> 'application/json'},json:async()=>data});
 const fetch=jest.fn().mockResolvedValue(response({settings:{clinicName:'Test'}}));const interval=jest.fn();
 const context=vm.createContext({document,fetch,sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},window:{location:{assign:jest.fn()}},setInterval:callback=>{interval.mockImplementation(callback);return 1;},clearInterval:jest.fn(),setTimeout,console});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../frontend/auth.js'),'utf8'),context);
 return {context,elements,storage,fetch,response,interval,open(extra={}){context.openPatientVerification({verificationSession:'a'.repeat(43),verificationEmail:'patient@example.test',...extra});return elements.findLast(e=>e.tag==='dialog');}};
}
test('refresh restores code entry after resend cooldown has ended',()=>{
 const h=harness();const dialog=h.open({resendAt:Date.now()-1000,codeExpiresAt:Date.now()+300000});
 expect(dialog.querySelector('form').hidden).toBe(false);expect(dialog.querySelector('.otp-send').textContent).toBe('Resend code');expect(dialog.querySelector('form').querySelector('small').textContent).toContain('Code expires in');
});
test('expired codes disable verification and allow requesting a replacement',()=>{
 const h=harness();const dialog=h.open({codeExpiresAt:Date.now()-1000,resendAt:Date.now()-1000});
 expect(dialog.querySelector('form').querySelector('button').disabled).toBe(true);expect(dialog.querySelector('.otp-send').disabled).toBe(false);expect(dialog.querySelector('form').querySelector('small').textContent).toContain('Code expired');
});
test('expired sessions clear the saved challenge and offer sign-in recovery',async()=>{
 const h=harness();const dialog=h.open();h.fetch.mockResolvedValueOnce(h.response({error:'Session expired',code:'VERIFICATION_SESSION_EXPIRED'},false));
 await dialog.querySelector('.otp-send').onclick();
 expect(h.storage.has('mediq-pending-verification')).toBe(false);expect(dialog.querySelector('.otp-send').hidden).toBe(true);expect(dialog.children.find(e=>e.className==='otp-restart').hidden).toBe(false);
});
test('sending a code saves its expiry for a later page refresh',async()=>{
 const h=harness();const dialog=h.open();h.fetch.mockResolvedValueOnce(h.response({message:'Code sent',expiresIn:600,resendAfter:60}));
 await dialog.querySelector('.otp-send').onclick();const saved=JSON.parse(h.storage.get('mediq-pending-verification'));
 expect(saved.codeExpiresAt).toBeGreaterThan(Date.now()+590000);expect(dialog.querySelector('form').hidden).toBe(false);
});
test('non-JSON server errors produce helpful feedback rather than a parsing error',async()=>{
 const h=harness();const dialog=h.open();h.fetch.mockResolvedValueOnce({ok:false,headers:{get:()=> 'text/html'}});
 await dialog.querySelector('.otp-send').onclick();expect(dialog.querySelector('.otp-result').textContent).toContain('unexpected response');
});
