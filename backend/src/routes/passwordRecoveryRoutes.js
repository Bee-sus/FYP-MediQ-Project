const crypto=require('crypto');
const express=require('express');
const {pool}=require('../config/database');
const {hashToken,sendPasswordRecoveryEmail}=require('../services/emailVerificationService');
const {codeHash}=require('../services/patientOtpService');
const {hashPassword,verifyPassword,meetsPasswordRules}=require('../services/passwordService');
const {createRecoveryLimiter}=require('../services/passwordRecoveryLimiter');
const router=express.Router(),limitRequest=createRecoveryLimiter();
const genericMessage='If an active account matches this email and account type, a reset code has been sent. Check your inbox and spam folder.';
const badCode='The code is incorrect, expired or already used. Request a new code if needed.';

router.post('/forgot-password',async(request,response)=>{
 const email=String(request.body.email||'').trim().toLowerCase(),role=String(request.body.role||'');
 if(email.length>190||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!['patient','staff'].includes(role))return response.status(422).json({error:'Enter a valid email address and select Patient or Staff.'});
 const allowance=limitRequest(request.ip,email,role);
 if(!allowance.allowed){response.set('Retry-After',String(allowance.retryAfter));return response.status(429).json({error:'Please wait before requesting another reset code.',retryAfter:allowance.retryAfter});}
 const preview=process.env.NODE_ENV!=='production'&&String(process.env.EMAIL_DELIVERY_MODE).toLowerCase()==='preview';
 if(!preview&&(!process.env.SMTP_HOST||!process.env.SMTP_USER||!process.env.SMTP_PASSWORD))return response.status(503).json({error:'Password reset email is currently unavailable. Please contact the clinic.'});
 const session=crypto.randomBytes(32).toString('base64url');
 let connection;
 try{
  connection=await pool.getConnection();await connection.beginTransaction();
  const [users]=await connection.execute("SELECT id,email FROM users WHERE email=? AND role=? AND is_active=TRUE AND deleted_at IS NULL FOR UPDATE",[email,role]);
  let delivery;
  if(users.length){
   const user=users[0];
   const [records]=await connection.execute('SELECT *,TIMESTAMPDIFF(SECOND,requested_at,NOW()) AS secondsSinceRequest,TIMESTAMPDIFF(SECOND,request_window,NOW()) AS windowAge FROM password_reset_codes WHERE user_id=? FOR UPDATE',[user.id]);
   const previous=records[0],inWindow=previous&&Number(previous.windowAge)<3600;
   // Do not replace a valid code when a request is throttled at database level.
   if(!previous||(Number(previous.secondsSinceRequest)>=60&&(!inWindow||Number(previous.request_count)<5))){
    const code=String(crypto.randomInt(1000000)).padStart(6,'0');
    try{delivery=await sendPasswordRecoveryEmail({email:user.email,code});}catch(error){console.warn('Password reset mail failed:',error.code||'DELIVERY_FAILED');}
    if(delivery?.sent||delivery?.previewCode)await connection.execute(`INSERT INTO password_reset_codes (user_id,session_hash,code_hash,expires_at,requested_at,request_count,request_window)
     VALUES (?,?,?,DATE_ADD(NOW(),INTERVAL 10 MINUTE),NOW(),?,NOW())
     ON DUPLICATE KEY UPDATE session_hash=VALUES(session_hash),code_hash=VALUES(code_hash),expires_at=VALUES(expires_at),attempts=0,requested_at=NOW(),request_count=VALUES(request_count),request_window=IF(?,request_window,NOW())`,[user.id,hashToken(session),codeHash(session,code),inWindow?Number(previous.request_count)+1:1,Boolean(inWindow)]);
   }
  }
  await connection.commit();
  response.set('Cache-Control','no-store');
  return response.json({message:genericMessage,resetSession:session,expiresIn:600,resendAfter:60,...(preview&&delivery?.previewCode?{previewCode:delivery.previewCode}:{})});
 }catch(error){if(connection)await connection.rollback();return response.status(503).json({error:'Password recovery is temporarily unavailable. Please retry.'});}
 finally{if(connection)connection.release();}
});

router.post('/reset-password',async(request,response)=>{
 const session=String(request.body.resetSession||''),code=String(request.body.code||''),{newPassword,confirmPassword}=request.body;
 if(!/^[A-Za-z0-9_-]{43}$/.test(session)||!/^\d{6}$/.test(code))return response.status(422).json({error:'Enter the six-digit reset code from your email.'});
 if(!meetsPasswordRules(newPassword))return response.status(422).json({error:'Use 12–128 characters with uppercase, lowercase, a number and a symbol.'});
 if(newPassword!==confirmPassword)return response.status(422).json({error:'The new passwords do not match.'});
 let connection,committed=false;
 try{
  connection=await pool.getConnection();await connection.beginTransaction();
  const [owners]=await connection.execute('SELECT user_id FROM password_reset_codes WHERE session_hash=?',[hashToken(session)]);
  if(!owners.length){await connection.rollback();return response.status(410).json({error:badCode});}
  const [users]=await connection.execute("SELECT id,email,role,password_hash FROM users WHERE id=? AND role IN ('patient','staff') AND is_active=TRUE AND deleted_at IS NULL FOR UPDATE",[owners[0].user_id]);
  const [records]=await connection.execute('SELECT *,expires_at>NOW() AS codeValid FROM password_reset_codes WHERE user_id=? AND session_hash=? FOR UPDATE',[owners[0].user_id,hashToken(session)]);
  const user=users[0],record=records[0];
  if(!user||!record||!record.codeValid){await connection.rollback();return response.status(410).json({error:badCode});}
  if(Number(record.attempts)>=5){await connection.rollback();return response.status(429).json({error:'Too many incorrect codes. Request a new code to continue.'});}
  const actual=Buffer.from(codeHash(session,code),'hex'),expected=Buffer.from(record.code_hash,'hex');
  if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected)){
   await connection.execute('UPDATE password_reset_codes SET attempts=attempts+1 WHERE user_id=?',[user.id]);
   await connection.commit();committed=true;
   return response.status(422).json({error:badCode});
  }
  if(await verifyPassword(newPassword,user.password_hash)){await connection.rollback();return response.status(422).json({error:'Choose a password different from your current password.'});}
  await connection.execute('UPDATE users SET password_hash=?,must_change_password=FALSE WHERE id=?',[await hashPassword(newPassword),user.id]);
  await connection.execute('DELETE FROM user_sessions WHERE user_id=?',[user.id]);
  await connection.execute('DELETE FROM password_reset_codes WHERE user_id=?',[user.id]);
  await connection.commit();committed=true;
  try{await sendPasswordRecoveryEmail({email:user.email,changed:true});}catch(error){console.warn('Password change notice failed:',error.code||'DELIVERY_FAILED');}
  response.set('Cache-Control','no-store');
  return response.json({message:'Password reset successfully. All previous sessions have been signed out. Sign in with your new password.',redirect:user.role==='staff'?'/staff-login.html':'/patient-login.html'});
 }catch(error){if(connection&&!committed)await connection.rollback();return response.status(503).json({error:'Password reset could not be completed. Please retry.'});}
 finally{if(connection)connection.release();}
});
module.exports=router;
