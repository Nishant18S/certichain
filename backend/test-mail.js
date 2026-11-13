require('dotenv').config();
const nodemailer=require('nodemailer');
const t=nodemailer.createTransport({
  host:process.env.SMTP_HOST,
  port:Number(process.env.SMTP_PORT||587),
  secure:String(process.env.SMTP_SECURE).toLowerCase()==='true',
  auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}
});
t.sendMail({
  from:process.env.MAIL_FROM||process.env.SMTP_USER,
  to:process.env.SMTP_USER,
  subject:'SMTP test',
  text:'It works'
}).then(i=>console.log('SENT',i.response))
  .catch(e=>console.error('FAILED',e.code,e.responseCode,e.message));