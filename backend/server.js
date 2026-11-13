'use strict';
require('dotenv').config();
const express=require('express'),helmet=require('helmet'),session=require('express-session');
const MySQLStore=require('express-mysql-session')(session);
const {rateLimit}=require('express-rate-limit');
const multer=require('multer'),crypto=require('crypto'),fs=require('fs'),path=require('path'),bcrypt=require('bcryptjs'),QR=require('qrcode');
const {Gateway,Wallets}=require('fabric-network');
const nodemailer=require('nodemailer');
const db=require('./config/db');
const {requireAuth,requireAdmin}=require('./middleware/auth');
const app=express(),PORT=Number(process.env.PORT||3000);
const CHANNEL=process.env.FABRIC_CHANNEL||'mychannel',CHAINCODE=process.env.FABRIC_CHAINCODE||'certichain';
const ORG=process.env.FABRIC_ORG_PATH||path.resolve(__dirname,'../../../fabric-samples/test-network/organizations/peerOrganizations/org1.example.com');
const CCP=process.env.FABRIC_CCP_PATH||path.join(ORG,'connection-org1.json');
const WALLET=process.env.FABRIC_WALLET_PATH||path.join(__dirname,'wallet');
const STORE=path.join(__dirname,'storage','certificates');
const FABRIC_ENABLED=String(process.env.FABRIC_ENABLED||'true').toLowerCase()!=='false';

// PASSWORD_RESET_IMPLEMENTATION
const mailer=nodemailer.createTransport({
 host:process.env.SMTP_HOST,
 port:Number(process.env.SMTP_PORT||587),
 secure:String(process.env.SMTP_SECURE).toLowerCase()==='true',
 auth:{
  user:process.env.SMTP_USER,
  pass:process.env.SMTP_PASS
 },
 connectionTimeout:10000,
 greetingTimeout:10000,
 socketTimeout:15000
});
const escapeHtml=value=>String(value).replace(/[&<>"']/g,ch=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[ch]);

app.use(helmet({contentSecurityPolicy:false}));
if(process.env.NODE_ENV==='production')app.set('trust proxy',1);
app.use(express.json({limit:'1mb'}));

const sessionStore=new MySQLStore({
 clearExpired:true,
 checkExpirationInterval:15*60*1000,
 expiration:8*60*60*1000
},db);

app.use(session({
 name:'certichain.sid',
 secret:process.env.SESSION_SECRET||'CHANGE_THIS_SESSION_SECRET',
 store:sessionStore,
 resave:false,
 saveUninitialized:false,
 cookie:{
  httpOnly:true,
  sameSite:process.env.COOKIE_SAMESITE||'lax',
  secure:process.env.NODE_ENV==='production',
  maxAge:8*60*60*1000
 }
}));

const loginLimiter=rateLimit({
 windowMs:15*60*1000,
 limit:10,
 standardHeaders:true,
 legacyHeaders:false,
 skipSuccessfulRequests:true,
 message:{error:'Too many login attempts. Please try again after 15 minutes.'}
});

const registerLimiter=rateLimit({
 windowMs:60*60*1000,
 limit:5,
 standardHeaders:true,
 legacyHeaders:false,
 message:{error:'Too many registration attempts. Please try again after one hour.'}
});

const passwordResetLimiter=rateLimit({
 windowMs:15*60*1000,
 limit:5,
 standardHeaders:true,
 legacyHeaders:false,
 message:{error:'Too many password recovery attempts. Please try again later.'}
});
const passwordUpdateLimiter=rateLimit({
 windowMs:15*60*1000,
 limit:10,
 standardHeaders:true,
 legacyHeaders:false,
 message:{error:'Too many reset attempts. Please try again later.'}
});

const documentVerifyLimiter=rateLimit({
 windowMs:15*60*1000,
 limit:10,
 standardHeaders:true,
 legacyHeaders:false,
 message:{error:'Too many document verification attempts. Try again later.'}
});
const publicReadLimiter=rateLimit({
 windowMs:15*60*1000,
 limit:60,
 standardHeaders:true,
 legacyHeaders:false,
 message:{error:'Too many public verification requests. Try again later.'}
});


app.use('/admin',express.static(path.resolve(__dirname,'../frontend/admin')));
app.use('/student',express.static(path.resolve(__dirname,'../frontend/student')));
app.use('/verify',express.static(path.resolve(__dirname,'../frontend/public')));
app.use('/assets',express.static(path.resolve(__dirname,'../frontend/assets')));
app.use('/',express.static(path.resolve(__dirname,'../frontend')));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024},fileFilter:(req,f,cb)=>f.mimetype==='application/pdf'&&f.originalname.toLowerCase().endsWith('.pdf')?cb(null,true):cb(new Error('Only PDF files are accepted'))});
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{4,64}$/.test(id);
const hash=b=>'0x'+crypto.createHash('sha256').update(b).digest('hex');
const parse=b=>JSON.parse(b.toString());

// ---------- Simulated ledger (used only when FABRIC_ENABLED=false) ----------
async function ensureLedgerTables(){
 await db.execute(`CREATE TABLE IF NOT EXISTS ledger_certificates(
  certificate_id VARCHAR(64) PRIMARY KEY,
  document_hash VARCHAR(80) NOT NULL,
  issuer_msp_id VARCHAR(40) NOT NULL,
  issued_at VARCHAR(40) NOT NULL,
  revoked TINYINT(1) NOT NULL DEFAULT 0,
  revoked_at VARCHAR(40) NULL
 )`);
 await db.execute(`CREATE TABLE IF NOT EXISTS ledger_history(
  id INT AUTO_INCREMENT PRIMARY KEY,
  certificate_id VARCHAR(64) NOT NULL,
  tx_id VARCHAR(80) NOT NULL,
  ts VARCHAR(40) NOT NULL,
  value TEXT NOT NULL,
  INDEX idx_ledger_history_cert(certificate_id)
 )`);
}
const rowToCert=r=>({
 certificateId:r.certificate_id,
 documentHash:r.document_hash,
 issuerMspId:r.issuer_msp_id,
 issuedAt:r.issued_at,
 revoked:!!r.revoked,
 ...(r.revoked_at?{revokedAt:r.revoked_at}:{})
});
async function simRead(id){
 const [rows]=await db.execute('SELECT * FROM ledger_certificates WHERE certificate_id=?',[id]);
 return rows.length?rowToCert(rows[0]):null;
}
async function simHistory(cert){
 await db.execute('INSERT INTO ledger_history(certificate_id,tx_id,ts,value) VALUES(?,?,?,?)',
  [cert.certificateId,crypto.randomBytes(32).toString('hex'),new Date().toISOString(),JSON.stringify(cert)]);
}
async function simLedger(fn,args){
 const out=v=>Buffer.from(JSON.stringify(v));
 if(fn==='IssueCertificate'){
  const [id,docHash]=args;
  if(await simRead(id))throw new Error('Certificate '+id+' already exists');
  const issuedAt=new Date().toISOString();
  await db.execute('INSERT INTO ledger_certificates(certificate_id,document_hash,issuer_msp_id,issued_at,revoked) VALUES(?,?,?,?,0)',[id,docHash,'Org1MSP',issuedAt]);
  const cert=await simRead(id);await simHistory(cert);return out(cert);
 }
 if(fn==='RevokeCertificate'){
  const [id]=args;const cur=await simRead(id);
  if(!cur)throw new Error('Certificate '+id+' does not exist');
  if(cur.revoked)throw new Error('Certificate '+id+' is already revoked');
  await db.execute('UPDATE ledger_certificates SET revoked=1,revoked_at=? WHERE certificate_id=?',[new Date().toISOString(),id]);
  const cert=await simRead(id);await simHistory(cert);return out(cert);
 }
 if(fn==='ReadCertificate'){
  const cert=await simRead(args[0]);
  if(!cert)throw new Error('Certificate '+args[0]+' does not exist');
  return out(cert);
 }
 if(fn==='VerifyCertificate'){
  const [id,docHash]=args;const cert=await simRead(id);
  if(!cert)return out({exists:false,valid:false,revoked:false,hashMatches:false,message:'Certificate record not found.'});
  const hashMatches=cert.documentHash.toLowerCase()===String(docHash).toLowerCase();
  const valid=!cert.revoked&&hashMatches;
  return out({exists:true,valid,revoked:cert.revoked,hashMatches,certificate:cert,
   message:cert.revoked?'This certificate has been revoked.':hashMatches?'Certificate is valid. The document hash matches the ledger record.':'Document hash does not match the ledger record.'});
 }
 if(fn==='GetAllCertificates'){
  const [rows]=await db.execute('SELECT * FROM ledger_certificates');
  return out(rows.map(rowToCert));
 }
 if(fn==='GetCertificateHistory'){
  const [rows]=await db.execute('SELECT tx_id,ts,value FROM ledger_history WHERE certificate_id=? ORDER BY id ASC',[args[0]]);
  if(!rows.length)throw new Error('Certificate '+args[0]+' does not exist');
  return out(rows.map(r=>({txId:r.tx_id,timestamp:r.ts,isDelete:false,value:JSON.parse(r.value)})));
 }
 throw new Error('Unsupported ledger function: '+fn);
}

async function fabric(fn){
 if(!FABRIC_ENABLED){
  return fn({
   submitTransaction:(f,...a)=>simLedger(f,a),
   evaluateTransaction:(f,...a)=>simLedger(f,a)
  });
 }
 if(!fs.existsSync(CCP))throw new Error('Fabric connection profile not found: '+CCP);
 const ccp=JSON.parse(fs.readFileSync(CCP,'utf8')),wallet=await Wallets.newFileSystemWallet(WALLET);
 if(!await wallet.get('appUser'))throw new Error('appUser missing in Fabric wallet. Configure FABRIC_WALLET_PATH.');
 const gw=new Gateway();await gw.connect(ccp,{wallet,identity:'appUser',discovery:{enabled:true,asLocalhost:true}});
 try{return await fn((await gw.getNetwork(CHANNEL)).getContract(CHAINCODE));}finally{gw.disconnect();}
}
async function all(){const b=await fabric(c=>c.evaluateTransaction('GetAllCertificates'));return parse(b);}
async function audit(user,action,id,details={}){await db.execute('INSERT INTO audit_notes(actor_user_id,action,certificate_id,details) VALUES(?,?,?,?)',[user?.id||null,action,id,JSON.stringify(details)]);}

app.get('/api/health',(req,res)=>res.json({status:'ok',application:'CertiChain API',channel:CHANNEL,chaincode:CHAINCODE,ledger:FABRIC_ENABLED?'hyperledger-fabric':'simulated-mysql'}));
app.get('/api/auth/me',(req,res)=>res.json({user:req.session.user||null}));
app.post('/api/auth/register',registerLimiter,async(req,res)=>{try{
 const name=String(req.body.fullName||'').trim(),email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||''),studentId=String(req.body.studentId||'').trim();
 if(name.length<2||!email.includes('@')||password.length<8)return res.status(400).json({error:'Enter a name, valid email and password (8+ characters).'});
 const h=await bcrypt.hash(password,12);const [r]=await db.execute("INSERT INTO users(full_name,email,password_hash,role,student_id) VALUES(?,?,?,'student',?)",[name,email,h,studentId||null]);
 req.session.user={id:r.insertId,fullName:name,email,role:'student'};res.status(201).json({user:req.session.user});
 }catch(e){res.status(400).json({error:e.code==='ER_DUP_ENTRY'?'Email or student ID already registered.':e.message});}});
app.post('/api/auth/login',loginLimiter,async(req,res)=>{try{
 const email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||'');
 const [rows]=await db.execute('SELECT id,full_name,email,password_hash,role FROM users WHERE email=?',[email]);
 if(!rows.length||!await bcrypt.compare(password,rows[0].password_hash))return res.status(401).json({error:'Invalid email or password.'});
 const u=rows[0];req.session.user={id:u.id,fullName:u.full_name,email:u.email,role:u.role};res.json({user:req.session.user});
 }catch(e){res.status(500).json({error:e.message});}});

// Student password recovery: generic response prevents account enumeration.
const resetGenericMessage='If a student account exists for that email, a password reset link has been sent.';

app.post('/api/auth/forgot-password',passwordResetLimiter,async(req,res)=>{
 const email=String(req.body.email||'').trim().toLowerCase();
 if(email.length>190||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
  return res.json({message:resetGenericMessage});
 }

 let tokenHash;
 try{
  const [users]=await db.execute(
   "SELECT id,full_name,email FROM users WHERE email=? AND role='student' LIMIT 1",
   [email]
  );

  if(users.length){
   const user=users[0];
   const token=crypto.randomBytes(32).toString('hex');
   tokenHash=crypto.createHash('sha256').update(token).digest('hex');

   await db.execute(
    "DELETE FROM password_reset_tokens WHERE user_id=? AND used_at IS NULL",
    [user.id]
   );

   await db.execute(
    "INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE))",
    [user.id,tokenHash]
   );

   const baseUrl=(process.env.PUBLIC_BASE_URL||`http://localhost:${PORT}`).replace(/\/+$/,'');
   const resetUrl=baseUrl+'/student/reset-password.html?token='+encodeURIComponent(token);
   const safeName=escapeHtml(user.full_name);

   try{
    await mailer.sendMail({
     from:process.env.MAIL_FROM||process.env.SMTP_USER,
     to:user.email,
     subject:'Reset your CertiChain student account password',
     text:`Hello ${user.full_name},\n\nA password reset was requested for your CertiChain student account.\n\nUse this link within 15 minutes:\n${resetUrl}\n\nIf you did not request this, you can ignore this email.\n\nCertiChain`,
     html:`<!doctype html><html><body style="margin:0;padding:32px;background:#f5f5f1;font-family:Arial,sans-serif;color:#26364a"><div style="max-width:560px;margin:auto;padding:32px;background:#fff;border:1px solid #d9dddf"><h2 style="color:#172d46">CertiChain</h2><p>Hello ${safeName},</p><p>A password reset was requested for your student account.</p><p style="margin:28px 0"><a href="${resetUrl}" style="display:inline-block;padding:13px 22px;background:#172d46;color:#fff;text-decoration:none">Reset password</a></p><p>This link expires in <strong>15 minutes</strong> and can only be used once.</p><p>If you did not request this, ignore this email. Your password will not change.</p><hr style="border:0;border-top:1px solid #ddd"><small>CertiChain · Academic Certificate Authentication</small></div></body></html>`
    });
   }catch(mailError){
    await db.execute(
     'DELETE FROM password_reset_tokens WHERE token_hash=?',
     [tokenHash]
    );
    console.error('Password reset email delivery failed:',mailError.message);
   }
  }

  return res.json({message:resetGenericMessage});
 }catch(error){
  console.error('Password recovery request failed:',error.message);
  return res.json({message:resetGenericMessage});
 }
});

app.post('/api/auth/reset-password',passwordUpdateLimiter,async(req,res)=>{
 const token=String(req.body.token||'').trim();
 const password=String(req.body.password||'');

 if(!/^[a-f0-9]{64}$/i.test(token)){
  return res.status(400).json({error:'This reset link is invalid or has expired. Request a new link.'});
 }
 if(password.length<8||Buffer.byteLength(password,'utf8')>72){
  return res.status(400).json({error:'Password must be at least 8 characters and no more than 72 bytes.'});
 }

 const tokenHash=crypto.createHash('sha256').update(token).digest('hex');
 const connection=await db.getConnection();
 let userId=null;

 try{
  await connection.beginTransaction();

  const [rows]=await connection.execute(
   "SELECT id,user_id FROM password_reset_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>UTC_TIMESTAMP() LIMIT 1 FOR UPDATE",
   [tokenHash]
  );

  if(!rows.length){
   await connection.rollback();
   return res.status(400).json({error:'This reset link is invalid or has expired. Request a new link.'});
  }

  const reset=rows[0];
  userId=reset.user_id;
  const passwordHash=await bcrypt.hash(password,12);

  const [updated]=await connection.execute(
   "UPDATE users SET password_hash=? WHERE id=? AND role='student'",
   [passwordHash,userId]
  );

  if(!updated.affectedRows){
   await connection.rollback();
   return res.status(400).json({error:'This reset link is invalid or has expired. Request a new link.'});
  }

  await connection.execute(
   'UPDATE password_reset_tokens SET used_at=UTC_TIMESTAMP() WHERE id=?',
   [reset.id]
  );

  await connection.execute(
   'DELETE FROM password_reset_tokens WHERE user_id=? AND id<>?',
   [userId,reset.id]
  );

  await connection.commit();
 }catch(error){
  await connection.rollback().catch(()=>{});
  console.error('Password reset failed:',error.message);
  return res.status(500).json({error:'Unable to reset password right now. Please try again.'});
 }finally{
  connection.release();
 }

 // Invalidate all existing sessions belonging to this student.
 try{
  const [sessions]=await db.execute('SELECT session_id,data FROM sessions');
  const matchingIds=[];

  for(const row of sessions){
   try{
    const data=typeof row.data==='string'?JSON.parse(row.data):row.data;
    if(String(data?.user?.id)===String(userId)){
     matchingIds.push(row.session_id);
    }
   }catch(_){}
  }

  if(matchingIds.length){
   const placeholders=matchingIds.map(()=>'?').join(',');
   await db.execute(
    `DELETE FROM sessions WHERE session_id IN (${placeholders})`,
    matchingIds
   );
  }
 }catch(error){
  console.error('Session invalidation warning:',error.message);
 }

 return res.json({success:true,message:'Your password has been reset. Please sign in with your new password.'});
});

app.post('/api/auth/logout',(req,res)=>req.session.destroy(()=>res.json({success:true})));
app.post('/api/certificates/issue',requireAdmin,upload.single('certificate'),async(req,res)=>{let temp;
 try{
  const id=String(req.body.certificateId||'').trim(),email=String(req.body.studentEmail||'').trim().toLowerCase(),title=String(req.body.title||'').trim(),institution=String(req.body.institution||'').trim();
  if(!validId(id)||!email.includes('@')||!title||!institution)return res.status(400).json({error:'Provide a valid ID, student email, title and institution.'});
  if(!req.file||req.file.buffer.subarray(0,5).toString()!=='%PDF-')return res.status(400).json({error:'Upload a valid PDF.'});
  await fs.promises.mkdir(STORE,{recursive:true});const final=path.join(STORE,id+'.pdf');
  if(fs.existsSync(final))return res.status(409).json({error:'Stored PDF already exists for this ID.'});
  temp=path.join(STORE,id+'.'+crypto.randomUUID()+'.tmp');await fs.promises.writeFile(temp,req.file.buffer,{flag:'wx'});
  const h=hash(req.file.buffer),raw=await fabric(c=>c.submitTransaction('IssueCertificate',id,h));
  await fs.promises.rename(temp,final);temp=null;
  await db.execute('INSERT INTO certificate_metadata(certificate_id,student_email,title,institution,created_by) VALUES(?,?,?,?,?)',[id,email,title,institution,req.session.user.id]);
  await audit(req.session.user,'ISSUE',id,{studentEmail:email,title});
  res.status(201).json({certificate:parse(raw),documentHash:h,documentStored:true});
 }catch(e){if(temp)await fs.promises.unlink(temp).catch(()=>{});res.status(400).json({error:e.message});}});
app.post('/api/certificates/verify',documentVerifyLimiter,upload.single('certificate'),async(req,res)=>{try{
 const id=String(req.body.certificateId||'').trim();if(!validId(id)||!req.file)return res.status(400).json({error:'Certificate ID and PDF are required.'});
 if(req.file.buffer.subarray(0,5).toString()!=='%PDF-')return res.status(400).json({error:'Invalid PDF signature.'});
 const h=hash(req.file.buffer),raw=await fabric(c=>c.evaluateTransaction('VerifyCertificate',id,h)),v=parse(raw);
 const status=!v.exists?'NOT_FOUND':v.revoked?'REVOKED':!v.hashMatches?'HASH_MISMATCH':'VALID';
 res.json({valid:v.valid,status,message:v.message,uploadedHash:h,record:v.certificate||null});
 }catch(e){res.status(404).json({error:e.message});}});
app.post('/api/certificates/revoke',requireAdmin,async(req,res)=>{try{
 const id=String(req.body.certificateId||'').trim();if(!validId(id))return res.status(400).json({error:'Invalid certificate ID.'});
 const raw=await fabric(c=>c.submitTransaction('RevokeCertificate',id));await audit(req.session.user,'REVOKE',id,{});
 res.json({certificate:parse(raw)});
 }catch(e){res.status(400).json({error:e.message});}});
app.get('/api/certificates',requireAdmin,async(req,res)=>{try{
 let a=await all();const search=String(req.query.search||'').toLowerCase(),status=req.query.status||'all',page=Math.max(1,+req.query.page||1),limit=Math.min(100,Math.max(1,+req.query.limit||10));
 if(!['all','active','revoked'].includes(status))return res.status(400).json({error:'Invalid status filter'});
 if(status==='active')a=a.filter(x=>!x.revoked);if(status==='revoked')a=a.filter(x=>x.revoked);
 if(search)a=a.filter(x=>x.certificateId.toLowerCase().includes(search)||String(x.issuerMspId).toLowerCase().includes(search));
 a.sort((x,y)=>new Date(y.issuedAt)-new Date(x.issuedAt));const total=a.length;
 res.json({success:true,pagination:{total,page,limit,totalPages:Math.ceil(total/limit)},certificates:a.slice((page-1)*limit,page*limit)});
 }catch(e){res.status(500).json({error:e.message});}});
app.get('/api/dashboard/stats',requireAdmin,async(req,res)=>{try{
 const a=await all(),rev=a.filter(x=>x.revoked).length;
 const [m]=await db.execute('SELECT COUNT(*) AS mappedStudents FROM certificate_metadata');
 res.json({statistics:{totalCertificates:a.length,activeCertificates:a.length-rev,revokedCertificates:rev,mappedCertificates:m[0].mappedStudents},recentCertificates:[...a].sort((x,y)=>new Date(y.issuedAt)-new Date(x.issuedAt)).slice(0,6)});
 }catch(e){res.status(500).json({error:e.message});}});
app.get('/api/certificates/:id/history',requireAdmin,async(req,res)=>{try{
 const id=req.params.id;if(!validId(id))return res.status(400).json({error:'Invalid ID'});
 const raw=await fabric(c=>c.evaluateTransaction('GetCertificateHistory',id));res.json({certificateId:id,history:parse(raw)});
 }catch(e){res.status(404).json({error:e.message});}});
app.get('/api/certificates/:id/document',requireAuth,async(req,res)=>{try{
 const id=req.params.id;
 if(!validId(id))return res.status(400).json({error:'Invalid ID'});
 if(req.session.user.role==='student'){
  const [rows]=await db.execute('SELECT certificate_id FROM certificate_metadata WHERE certificate_id=? AND student_email=?',[id,req.session.user.email]);
  if(!rows.length)return res.status(403).json({error:'You are not authorized to access this certificate.'});
 }else if(req.session.user.role!=='admin'){
  return res.status(403).json({error:'Access denied.'});
 }
 const f=path.join(STORE,id+'.pdf');
 if(!fs.existsSync(f))return res.status(404).json({error:'PDF not stored locally.'});
 res.type('application/pdf').download(f,id+'.pdf');
 }catch(e){res.status(500).json({error:'Unable to download certificate.'});}});
app.get('/api/student/certificates',requireAuth,async(req,res)=>{if(req.session.user.role!=='student')return res.status(403).json({error:'Student account required.'});
 const [rows]=await db.execute('SELECT certificate_id AS certificateId,title,institution,created_at AS assignedAt FROM certificate_metadata WHERE student_email=? ORDER BY created_at DESC',[req.session.user.email]);
 const ledger=await all();const byId=new Map(ledger.map(x=>[x.certificateId,x]));
 res.json({certificates:rows.map(m=>({...m,ledger:byId.get(m.certificateId)||null}))});});
app.get('/api/public/verify/:id',publicReadLimiter,async(req,res)=>{try{
 const id=req.params.id;if(!validId(id))return res.status(400).json({error:'Invalid ID'});
 const raw=await fabric(c=>c.evaluateTransaction('ReadCertificate',id)),r=parse(raw);
 const [m]=await db.execute('SELECT title,institution FROM certificate_metadata WHERE certificate_id=?',[id]);
 res.json({exists:true,status:r.revoked?'REVOKED':'RECORDED',valid:!r.revoked,certificateId:id,issuedAt:r.issuedAt,issuerMspId:r.issuerMspId,documentHash:r.documentHash,metadata:m[0]||null,message:r.revoked?'This certificate has been revoked.':'Ledger record found. Upload the original PDF to verify its hash.'});
 }catch(e){res.status(404).json({exists:false,status:'NOT_FOUND',valid:false,message:'Certificate record not found.'});}});
app.get('/api/public/qr/:id',publicReadLimiter,async(req,res)=>{try{const id=req.params.id;if(!validId(id))return res.status(400).json({error:'Invalid ID'});
 const url=(process.env.PUBLIC_BASE_URL||`http://localhost:${PORT}`)+'/verify/?id='+encodeURIComponent(id);
 res.type('png').send(await QR.toBuffer(url,{width:300,margin:2}));
 }catch(e){res.status(500).json({error:e.message});}});
app.get('/api/admin/audit',requireAdmin,async(req,res)=>{const [rows]=await db.execute('SELECT a.id,a.action,a.certificate_id AS certificateId,a.details,a.created_at AS createdAt,u.email AS actor FROM audit_notes a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.created_at DESC LIMIT 100');res.json({events:rows});});
app.get('/api/admin/analytics',requireAdmin,async(req,res)=>{try{const a=await all();const byMonth={};for(const x of a){const k=String(x.issuedAt).slice(0,7);byMonth[k]=(byMonth[k]||0)+1;}res.json({monthly:Object.entries(byMonth).sort().map(([month,count])=>({month,count})),status:{active:a.filter(x=>!x.revoked).length,revoked:a.filter(x=>x.revoked).length}});}catch(e){res.status(500).json({error:e.message});}});
app.use((err,req,res,next)=>res.status(400).json({error:err.message||'Request failed'}));
sessionStore.onReady().then(async()=>{
 if(!FABRIC_ENABLED)await ensureLedgerTables();
 app.listen(PORT,()=>console.log(`CertiChain running on port ${PORT} (ledger: ${FABRIC_ENABLED?'fabric':'simulated'})`));
}).catch(error=>{
 console.error('Startup failed:',error.message);
 process.exit(1);
});