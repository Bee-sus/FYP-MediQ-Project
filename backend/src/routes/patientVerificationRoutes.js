const express=require('express');
const crypto=require('crypto');
const {pool}=require('../config/database');
const {hashToken,sendPatientOtpEmail}=require('../services/emailVerificationService');
const {codeHash}=require('../services/patientOtpService');
const router=express.Router();
const problem=(status,message)=>Object.assign(new Error(message),{status});
async function withVerification(request,response,work){
 const session=String(request.body.verificationSession||'');
 if(!/^[A-Za-z0-9_-]{43}$/.test(session))return response.status(422).json({error:'Verification session is invalid. Sign in again to resume verification.'});
 let connection;
 try{
  connection=await pool.getConnection();await connection.beginTransaction();
  const [rows]=await connection.execute(`SELECT p.*,u.email,u.email_verified_at AS verifiedAt,
   TIMESTAMPDIFF(SECOND,p.sent_at,NOW()) AS secondsSinceSend,
   TIMESTAMPDIFF(SECOND,p.send_window,NOW()) AS windowAge,
   (p.expires_at > NOW()) AS codeValid
   FROM patient_email_codes p JOIN users u ON u.id=p.user_id
   WHERE p.session_hash=? AND p.session_expires_at>NOW() AND u.role='patient' AND u.is_active=TRUE FOR UPDATE`,[hashToken(session)]);
  if(!rows.length||rows[0].verifiedAt)throw Object.assign(problem(410,'Verification session expired or already used. Sign in to continue.'),{publicCode:'VERIFICATION_SESSION_EXPIRED'});
  const result=await work(connection,rows[0],session);
  await connection.commit();return response.status(result.status||200).json(result.body);
 }catch(error){if(connection)await connection.rollback();return response.status(error.status||503).json({error:error.status?error.message:'Email verification is temporarily unavailable. Please retry.',...(error.publicCode?{code:error.publicCode}:{})});}
 finally{if(connection)connection.release();}
}
router.post('/request-email-code',(request,response)=>withVerification(request,response,async(connection,row,session)=>{
 if(row.secondsSinceSend!==null&&Number(row.secondsSinceSend)<60)throw problem(429,'Please wait 60 seconds between verification emails.');
 const inWindow=row.windowAge!==null&&Number(row.windowAge)<3600;
 if(inWindow&&Number(row.send_count)>=5)throw problem(429,'Email limit reached. Try again in an hour.');
 const code=String(crypto.randomInt(1000000)).padStart(6,'0');
 let delivery;try{delivery=await sendPatientOtpEmail({email:row.email,code});}catch(_){throw problem(503,'We could not send the verification email. Please try again shortly.');}
 if(!delivery.sent&&!delivery.previewCode)throw problem(503,'We could not send the verification email. Please contact the clinic if this continues.');
 await connection.execute(`UPDATE patient_email_codes SET code_hash=?,expires_at=DATE_ADD(NOW(),INTERVAL 10 MINUTE),attempts=0,sent_at=NOW(),send_count=?,send_window=IF(?,send_window,NOW()) WHERE user_id=?`,[codeHash(session,code),inWindow?Number(row.send_count)+1:1,inWindow,row.user_id]);
 return {body:{message:delivery.sent?'Verification code sent. Check your email.':'Local preview code ready.',expiresIn:600,resendAfter:60,...(process.env.NODE_ENV!=='production'&&delivery.previewCode?{previewCode:delivery.previewCode}:{})}};
}));
router.post('/verify-email-code',(request,response)=>{
 if(!/^\d{6}$/.test(String(request.body.code||'')))return response.status(422).json({error:'Enter the six-digit verification code.'});
 return withVerification(request,response,async(connection,row,session)=>{
  if(!row.code_hash||!row.codeValid)throw problem(410,'This code has expired. Request a new code.');
  if(Number(row.attempts)>=5)throw problem(429,'Too many incorrect codes. Request a new code to continue.');
  const expected=Buffer.from(row.code_hash,'hex'),actual=Buffer.from(codeHash(session,String(request.body.code)),'hex');
  if(expected.length!==actual.length||!crypto.timingSafeEqual(expected,actual)){
   const attempts=Number(row.attempts);
   await connection.execute('UPDATE patient_email_codes SET attempts=attempts+1 WHERE user_id=?',[row.user_id]);
   const remaining=Math.max(0,4-attempts);
   return {status:remaining?422:429,body:{error:remaining?`Incorrect code. ${remaining} attempts remaining.`:'Too many incorrect codes. Request a new code.'}};
  }
  await connection.execute('UPDATE users SET email_verified_at=CURRENT_TIMESTAMP WHERE id=?',[row.user_id]);
  await connection.execute('DELETE FROM email_verification_tokens WHERE user_id=?',[row.user_id]);
  await connection.execute('DELETE FROM patient_email_codes WHERE user_id=?',[row.user_id]);
  return {body:{message:'Email verified successfully. You can now sign in.',redirect:'/patient-login.html'}};
 });
});
module.exports=router;
