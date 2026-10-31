'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {preparePublicNote}=require('./public-note.cjs');
const {AttachmentSelection}=require('./publish-attachments.cjs');
const {SharedEditing}=require('./shared-editing.cjs');
const keyFor=(root,file)=>crypto.createHash('sha256').update(root+'\0'+file.normalize('NFC')).digest('hex');
class PublishManager{
 constructor({directory,baseUrl,fetcher=fetch,storage=null,allowLocal=false}){
  const url=baseUrl?new URL(baseUrl):null;
  if(url&&url.protocol!=='https:'&&!(allowLocal&&url.protocol==='http:'&&url.hostname==='127.0.0.1'))throw Error('공유 서비스는 HTTPS를 사용해야 합니다.');
  this.directory=directory;this.baseUrl=url?.origin||'';this.fetcher=fetcher;this.storage=storage;this.queue=Promise.resolve();this.records=null;this.attachments=new AttachmentSelection();this.collaboration=new SharedEditing(this);
 }
 serial(operation){const task=this.queue.then(operation);this.queue=task.catch(()=>{});return task;}
 async initialize(){
  if(this.records)return;
  await fs.mkdir(this.directory,{recursive:true,mode:0o700});
  try{this.records=JSON.parse(await fs.readFile(path.join(this.directory,'records.json'),'utf8'));if(!this.records||Array.isArray(this.records))throw Error();}
  catch(error){if(error.code!=='ENOENT')throw Error('공유 기록을 읽을 수 없습니다. 기존 records.json을 확인해 주세요.');this.records={};}
  const pem=path.join(this.directory,'private-key.pem'),encrypted=path.join(this.directory,'private-key.encrypted');
  if(this.storage?.isEncryptionAvailable()){
   try{const raw=await fs.readFile(pem,'utf8');const bytes=this.storage.encryptString(raw);if(this.storage.decryptString(bytes)!==raw)throw Error('키 보관 확인 실패');await fs.writeFile(encrypted,bytes,{mode:0o600});await fs.unlink(pem);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
 }
 async identity(){
  await this.initialize();
  try{const data=await fs.readFile(path.join(this.directory,'private-key.encrypted'));if(!this.storage?.isEncryptionAvailable())throw Error('기기 키 보관함을 사용할 수 없습니다.');return crypto.createPrivateKey(this.storage.decryptString(data));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  try{return crypto.createPrivateKey(await fs.readFile(path.join(this.directory,'private-key.pem'),'utf8'));}
  catch(error){if(error.code==='ENOENT')throw Error('이 기기의 공유 기능이 아직 연결되지 않았습니다.');throw error;}
 }
 originFor(record){if(record&&!record.revoked){const url=new URL(record.url);if(url.protocol!=='https:'&&url.origin!==this.baseUrl)throw Error('이전 공유 주소를 확인해 주세요.');return url.origin;}return this.baseUrl;}
 async configured(origin=this.baseUrl){if(!origin)return false;try{await this.identity();return true;}catch{return false;}}
 async persist(){
  const target=path.join(this.directory,'records.json'),temporary=target+'.tmp-'+crypto.randomUUID();
  await fs.writeFile(temporary,JSON.stringify(this.records,null,2),{mode:0o600});
  await fs.rename(temporary,target);
 }
 view(record){return record?{id:record.id,title:record.title,url:record.url,updatedAt:record.updatedAt,sourcePath:record.notePath,isPublished:!record.revoked,pending:!!record.pending,summary:record.summary,theme:record.theme,collaborationEnabled:!!record.collaboration&&!record.revoked}:null;}
 attachmentOptions(options,record){return {...options,attachments:this.attachments.resolve(options.attachments,record&&!record.revoked?record.attachments||[]:[])};}
 attachmentPath(pageId,fileId){if(!/^[a-f0-9]{32}$/.test(pageId)||!/^[a-f0-9]{64}$/.test(fileId))throw Error('잘못된 첨부파일입니다.');return path.join(this.directory,'attachments',pageId,fileId);}
 async startAttachmentHost(){const {AttachmentHost}=require('./attachment-host.cjs');if(!this.attachmentHost)this.attachmentHost=new AttachmentHost(this);await this.attachmentHost.start();}
 stopUnusedAttachmentHost(){if(!Object.values(this.records||{}).some(record=>!record.revoked&&(record.attachments?.length||record.collaboration))){this.attachmentHost?.stop();this.attachmentHost=null;}}
 async prepare(root,note,options={}){
  await this.initialize();
  const record=this.records[keyFor(root,note.path)];
  const preview=preparePublicNote(note,this.attachmentOptions({...options,title:options.title??record?.title,summary:options.summary??record?.summary,theme:options.theme??record?.theme},record));
  const origin=this.originFor(record);
  return {preview,status:{configured:await this.configured(origin),serviceUrl:origin,supportsAttachments:origin===this.baseUrl,isPublished:!!record&&!record.revoked,hasChanges:!!record&&!record.revoked&&record.digest!==preview.digest,...(record?this.view(record):{})}};
 }
 async request(method,id,payload,origin=this.baseUrl){
  return this.requestRoute(method,'/api/pages/'+id,payload,origin);
 }
 async requestRoute(method,route,payload,origin=this.baseUrl){
  if(!origin)throw Error('Cloudflare 공유 서버 주소를 먼저 설정해 주세요.');
  const body=payload?JSON.stringify(payload):'',timestamp=String(Date.now()),nonce=crypto.randomBytes(16).toString('hex');
  const message=[method,route,timestamp,nonce,body].join('\n');
  const signature=crypto.sign(null,Buffer.from(message),await this.identity()).toString('base64url');
  let response;
  try{response=await this.fetcher(origin+route,{method,redirect:'error',headers:{'Content-Type':'application/json','X-Replica-Timestamp':timestamp,'X-Replica-Nonce':nonce,'X-Replica-Signature':signature},...(method!=='DELETE'?{body}:{}),signal:AbortSignal.timeout(60000)});}
  catch{throw Error('공유 서버에 연결하지 못했습니다. 기존 공개본은 유지됩니다.');}
  let result;try{result=await response.json();}catch{throw Error('공유 서버 응답을 확인할 수 없습니다.');}
  if(!response.ok){if(method==='DELETE'&&response.status===404)return {unpublished:true};const error=Error(result.error||'공유 요청을 완료하지 못했습니다.');error.definite=response.status>=400&&response.status<500;throw error;}
  return result;
 }
 async publish(root,note,options,expectedDigest,expectedRecord){
  return this.serial(async()=>{
   await this.initialize();
   const previousRecord=this.records[keyFor(root,note.path)];
   if(expectedRecord!==undefined&&JSON.stringify(previousRecord||null)!==expectedRecord)throw Error('미리보기 이후 공유 설정이 변경됐습니다. 다시 준비해 주세요.');
   if(previousRecord&&!previousRecord.revoked&&previousRecord.collaboration)throw Error('공동 편집을 끈 뒤 공개 페이지나 첨부파일을 업데이트해 주세요.');
   const preview=preparePublicNote(note,this.attachmentOptions(options,previousRecord));
   if(!expectedDigest||preview.digest!==expectedDigest)throw Error('미리보기 이후 내용이 변경됐습니다. 미리보기를 다시 확인해 주세요.');
   const key=keyFor(root,note.path),previous=this.records[key],id=previous&&!previous.revoked?previous.id:crypto.randomBytes(16).toString('hex');
   const origin=this.originFor(previous);if(!origin)throw Error('Cloudflare 공유 서버 주소를 먼저 설정해 주세요.');
   if(preview.attachments?.length&&origin!==this.baseUrl)throw Error('첨부파일은 Cloudflare 공유에서 지원합니다. 이전 공유를 중지한 뒤 새 링크를 만들어 주세요.');
   await this.identity();
   if(preview.attachments?.length){
    for(const file of preview.attachments){const target=this.attachmentPath(id,file.id),selected=this.attachments.files.get(file.id);await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});if(selected)await fs.writeFile(target,selected.bytes,{mode:0o600});else await fs.access(target);}
    try{await this.startAttachmentHost();}catch(error){this.stopUnusedAttachmentHost();if(!previous||previous.revoked)await fs.rm(path.join(this.directory,'attachments',id),{recursive:true,force:true});throw error;}
   }
   const before=previous?structuredClone(previous):null;
   // Save the management identity BEFORE upload. A lost HTTP response must
   // never leave a published page whose URL this device cannot revoke.
   this.records[key]=previous&&!previous.revoked?{...previous,attachments:preview.attachments||[],pending:true}:{id,url:origin+'/p/'+id,vaultRoot:root,notePath:note.path,title:preview.title,summary:preview.summary,theme:preview.theme,attachments:preview.attachments||[],digest:'',updatedAt:Date.now(),revoked:false,pending:true};
   await this.persist();
   const {bytes,...payload}=preview;
   let result;
   try{result=await this.request('PUT',id,payload,origin);}
   catch(error){if(error.definite){if(before)this.records[key]=before;else delete this.records[key];await this.persist();this.stopUnusedAttachmentHost();if(!previous||previous.revoked)await fs.rm(path.join(this.directory,'attachments',id),{recursive:true,force:true});}throw error;}
   if(result.digest!==preview.digest)throw Error('서버의 게시 결과를 확인할 수 없습니다. 공유 목록을 확인해 주세요.');
   const record={id,url:origin+'/p/'+id,vaultRoot:root,notePath:note.path,title:preview.title,summary:preview.summary,theme:preview.theme,attachments:preview.attachments||[],digest:preview.digest,updatedAt:result.updatedAt,revoked:false,pending:false};
   this.records[key]=record;await this.persist();
   this.stopUnusedAttachmentHost();
   const cache=path.join(this.directory,'attachments',id);try{const keep=new Set(record.attachments.map(file=>file.id));for(const file of await fs.readdir(cache))if(/^[a-f0-9]{64}$/.test(file)&&!keep.has(file))await fs.unlink(path.join(cache,file));}catch(error){if(error.code!=='ENOENT')console.error('이전 첨부 정리 확인 필요:',error.message);}
   return {preview,status:{configured:true,serviceUrl:origin,supportsAttachments:origin===this.baseUrl,...this.view(record),hasChanges:false}};
  });
 }
 async list(){await this.initialize();return Object.values(this.records).filter(record=>!record.revoked).map(record=>this.view(record)).sort((a,b)=>b.updatedAt-a.updatedAt);}
 async unpublish(id){
  return this.serial(async()=>{
   await this.initialize();const record=Object.values(this.records).find(record=>record.id===id);
   if(!record||record.revoked)return {unpublished:true};
   await this.request('DELETE',id,undefined,this.originFor(record));record.revoked=true;record.pending=false;await this.persist();this.collaboration.reset(id);this.collaboration.notify();this.stopUnusedAttachmentHost();await fs.rm(path.join(this.directory,'attachments',id),{recursive:true,force:true});return {unpublished:true};
  });
 }
 async publication(id){await this.initialize();const record=Object.values(this.records).find(record=>record.id===id&&!record.revoked);if(!record)throw Error('현재 공유 중인 문서가 아닙니다.');return this.view(record);}
 async rename(root,oldPath,newPath){
  return this.serial(async()=>{await this.initialize();const oldKey=keyFor(root,oldPath),record=this.records[oldKey];if(!record)return;const newKey=keyFor(root,newPath);if(this.records[newKey]&&!this.records[newKey].revoked)throw Error('새 파일 이름에 다른 공유 기록이 있습니다.');delete this.records[oldKey];record.notePath=newPath;this.records[newKey]=record;await this.persist();});
 }
}
module.exports={PublishManager,keyFor};
