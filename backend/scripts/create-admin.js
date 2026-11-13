require('dotenv').config();
const bcrypt=require('bcryptjs');
const db=require('../config/db');
(async()=>{
  const args=process.argv.slice(2);
  const get=k=>{const i=args.indexOf('--'+k);return i>=0?args[i+1]:null};
  const email=(get('email')||'').trim().toLowerCase();
  const password=get('password')||'';
  if(!email||!password||password.length<10){console.error("Usage: npm run create-admin -- --email admin@example.com --password 'AtLeast10Chars!'");process.exit(1);}
  try{
    const hash=await bcrypt.hash(password,12);
    await db.execute("INSERT INTO users(full_name,email,password_hash,role) VALUES(?,?,?,'admin') ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash),role='admin'",['CertiChain Administrator',email,hash]);
    console.log('Admin account created/updated:',email);
  }catch(e){console.error(e.message);process.exitCode=1;}
  finally{await db.end();}
})();
