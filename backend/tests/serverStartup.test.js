const fs=require('fs');const path=require('path');const vm=require('vm');const {EventEmitter}=require('events');
function harness(){
 const server=new EventEmitter();let listening;const app={listen:jest.fn((port,callback)=>{listening=callback;return server;})};const timeout=jest.fn(()=>({unref:jest.fn()})),interval=jest.fn(()=>({unref:jest.fn()}));const process={env:{PORT:'3000'}};const console={log:jest.fn(),error:jest.fn(),warn:jest.fn()};
 const context=vm.createContext({require:name=>name==='dotenv'?{config:jest.fn()}:name==='./app'?app:{sendDueQueueReminders:jest.fn()},process,console,setTimeout:timeout,setInterval:interval});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/server.js'),'utf8'),context);return {server,listening,timeout,interval,process,console};
}
test('occupied ports show a clear message without starting background reminders',()=>{const h=harness();h.server.emit('error',{code:'EADDRINUSE'});expect(h.console.error.mock.calls[0][0]).toContain('Port 3000 is already in use');expect(h.process.exitCode).toBe(1);expect(h.interval).not.toHaveBeenCalled();expect(h.timeout).not.toHaveBeenCalled();});
test('background reminders start only after the server is listening',()=>{const h=harness();h.listening();expect(h.interval).toHaveBeenCalledTimes(1);expect(h.timeout).toHaveBeenCalledTimes(1);});
