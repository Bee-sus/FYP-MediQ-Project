const crypto=require('crypto');
const {hashToken}=require('./emailVerificationService');
const codeHash=(session,code)=>crypto.createHmac('sha256',session).update(code).digest('hex');
async function createPatientVerification(connection,userId){
 const session=crypto.randomBytes(32).toString('base64url');
 // Keep the delivery rate limit when a Patient signs in again to resume verification.
 await connection.execute(`INSERT INTO patient_email_codes (user_id,session_hash,session_expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 24 HOUR))
 ON DUPLICATE KEY UPDATE session_hash=VALUES(session_hash),session_expires_at=VALUES(session_expires_at),code_hash=NULL,expires_at=NULL,attempts=0`,[userId,hashToken(session)]);
 return session;
}
module.exports={createPatientVerification,codeHash};
