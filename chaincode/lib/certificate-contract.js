'use strict';
const {Contract}=require('fabric-contract-api');
class CertificateContract extends Contract{
 _issuerOnly(ctx){if(ctx.clientIdentity.getMSPID()!=='Org1MSP'||ctx.clientIdentity.getAttributeValue('role')!=='issuer')throw new Error('Access denied: authorized Org1 issuer required');}
 _id(id){if(typeof id!=='string'||!/^[A-Za-z0-9_-]{4,64}$/.test(id))throw new Error('Invalid certificate ID');}
 _hash(h){if(typeof h!=='string'||!/^0x[a-fA-F0-9]{64}$/.test(h))throw new Error('Invalid SHA-256 hash');}
 _key(id){return 'CERT_'+id;}
 async InitLedger(ctx){return JSON.stringify({message:'CertiChain ledger initialized'});}
 async IssueCertificate(ctx,id,documentHash){this._issuerOnly(ctx);this._id(id);this._hash(documentHash);const key=this._key(id);const old=await ctx.stub.getState(key);if(old&&old.length)throw new Error('Certificate already exists: '+id);
 const c={certificateId:id,documentHash:documentHash.toLowerCase(),issuerMspId:ctx.clientIdentity.getMSPID(),issuerId:ctx.clientIdentity.getID(),issuedAt:new Date().toISOString(),revoked:false};
 await ctx.stub.putState(key,Buffer.from(JSON.stringify(c)));ctx.stub.setEvent('CertificateIssued',Buffer.from(JSON.stringify({certificateId:id,documentHash})));return JSON.stringify(c);}
 async ReadCertificate(ctx,id){this._id(id);const b=await ctx.stub.getState(this._key(id));if(!b||!b.length)throw new Error('Certificate not found: '+id);return b.toString();}
 async VerifyCertificate(ctx,id,h){this._id(id);this._hash(h);const b=await ctx.stub.getState(this._key(id));if(!b||!b.length)return JSON.stringify({exists:false,valid:false,hashMatches:false,revoked:false,certificate:null,message:'Certificate not found'});
 const c=JSON.parse(b.toString()),hashMatches=c.documentHash.toLowerCase()===h.toLowerCase(),valid=hashMatches&&!c.revoked;return JSON.stringify({exists:true,valid,hashMatches,revoked:!!c.revoked,certificate:c,message:c.revoked?'Certificate has been revoked':hashMatches?'The uploaded PDF matches the blockchain record.':'Document hash does not match the blockchain record'});}
 async RevokeCertificate(ctx,id){this._issuerOnly(ctx);this._id(id);const key=this._key(id),b=await ctx.stub.getState(key);if(!b||!b.length)throw new Error('Certificate not found: '+id);const c=JSON.parse(b.toString());if(c.revoked)throw new Error('Certificate already revoked');c.revoked=true;c.revokedAt=new Date().toISOString();c.revokedBy=ctx.clientIdentity.getID();await ctx.stub.putState(key,Buffer.from(JSON.stringify(c)));ctx.stub.setEvent('CertificateRevoked',Buffer.from(JSON.stringify({certificateId:id})));return JSON.stringify(c);}
 async GetAllCertificates(ctx){const it=await ctx.stub.getStateByRange('CERT_','CERT_\uffff'),a=[];try{while(true){const x=await it.next();if(x.value&&x.value.value)a.push(JSON.parse(x.value.value.toString('utf8')));if(x.done)break;}}finally{await it.close();}a.sort((x,y)=>new Date(y.issuedAt)-new Date(x.issuedAt));return JSON.stringify(a);}
 async GetCertificateHistory(ctx,id){this._id(id);const it=await ctx.stub.getHistoryForKey(this._key(id)),a=[];try{while(true){const x=await it.next();if(x.value)a.push({transactionId:x.value.txId,timestamp:x.value.timestamp,isDelete:x.value.isDelete,record:x.value.value&&x.value.value.length?JSON.parse(x.value.value.toString('utf8')):null});if(x.done)break;}}finally{await it.close();}return JSON.stringify(a);}
}
module.exports=CertificateContract;
