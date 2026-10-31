const crypto=require('crypto');
// Bounded in-memory request throttling supplements the persistent account limit.
// Missing accounts follow the same request limits as registered addresses.
function createRecoveryLimiter(now=Date.now){
 const entries=new Map();
 return (ip,email,role)=>{
  const current=now();
  for(const [key,value] of entries)if(current-value.start>=3600000)entries.delete(key);
  const keys=[['ip:'+ip,20,0],['account:'+role+':'+email,5,60000]];
  for(const [raw,limit,cooldown] of keys){const key=crypto.createHash('sha256').update(raw).digest('hex'),entry=entries.get(key);if(entry&&(entry.count>=limit||current-entry.last<cooldown))return {allowed:false,retryAfter:Math.max(1,Math.ceil(((entry.count>=limit?entry.start+3600000:entry.last+cooldown)-current)/1000))};}
  if(entries.size>10000)return {allowed:false,retryAfter:60};
  for(const [raw] of keys){const key=crypto.createHash('sha256').update(raw).digest('hex'),entry=entries.get(key)||{start:current,count:0};entry.last=current;entry.count++;entries.set(key,entry);}
  return {allowed:true};
 };
}
module.exports={createRecoveryLimiter};
