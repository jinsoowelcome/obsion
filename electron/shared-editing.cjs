'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const {Text,ChangeSet}=require('@codemirror/state');
const {rebaseUpdates}=require('@codemirror/collab');
const {VaultStore}=require('./vault.cjs');
const {preparePublicNote,publicMarkdown}=require('./public-note.cjs');
const derive=promisify(crypto.scrypt);
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const fail=(status,message)=>Object.assign(Error(message),{status});
function split(raw){const prefix=/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(raw)?.[0]||'';return {prefix,body:raw.slice(prefix.length).replace(/^\uFEFF/,'').replace(/\r\n/g,'\n')};}
class SharedEditing{
 constructor(manager){this.manager=manager;this.rooms=new Map();this.sessions=new Map();this.attempts=new Map();}
 entries(){return Object.values(this.manager.records||{}).filter(record=>!record.revoked&&record.collaboration);}
 state(){return this.entries().map(record=>({vaultPath:record.vaultRoot,path:record.notePath,id:record.id}));}
 locked(root,file){return this.entries().some(record=>record.vaultRoot===root&&record.notePath===file);}
 notify(note,root){this.manager.onCollaborationChange?.({locked:this.state(),...(note?{note,vaultPath:root}:{})});}
 find(id){const record=Object.values(this.manager.records||{}).find(record=>record.id===id&&!record.revoked);if(!record)throw fail(404,'공유 문서를 찾을 수 없습니다.');return record;}
 reset(id){this.rooms.delete(id);for(const [key,session]of this.sessions)if(session.id===id)this.sessions.delete(key);}
 async source(record){const vault=new VaultStore(record.vaultRoot);const root=await fs.lstat(vault.root);if(!root.isDirectory()||root.isSymbolicLink())throw fail(409,'원본 보관함 위치를 확인해 주세요.');const target=await vault.checked(record.notePath,{note:true,mustExist:true});return {vault,target,note:await vault.readNote(target.absolute,target.relative)};}
 async configure(root,id,enabled,pin){return this.manager.serial(async()=>{
  const record=this.find(id);if(root!==record.vaultRoot||this.manager.originFor(record)!==this.manager.baseUrl)throw Error('Cloudflare에서 공유한 원본 보관함을 열어 주세요.');
  if(typeof enabled!=='boolean')throw Error('공동 편집 설정을 확인해 주세요.');
  if(!enabled){let publication;try{const {note}=await this.source(record);if(hash(note.content)===record.collaboration?.sourceHash){const preview=preparePublicNote(note,{title:record.title,summary:record.summary,theme:record.theme,attachments:record.attachments||[]});publication={markdown:preview.markdown,digest:record.digest,updatedAt:record.updatedAt};}}catch{}await this.manager.requestRoute('PUT','/api/pages/'+id+'/editing',{enabled:false,publication});delete record.collaboration;await this.manager.persist();this.reset(id);this.manager.stopUnusedAttachmentHost();this.notify();return;}
  if(typeof pin!=='string'||!/^\d{4}$/.test(pin))throw Error('편집 암호는 숫자 4자리로 입력해 주세요.');
  const {note}=await this.source(record),parts=split(note.content);
  if(publicMarkdown(parts.body)!==parts.body.trim())throw Error('공동 편집을 켜려면 본문의 숨김 주석을 별도 노트로 옮겨 주세요.');
  const preview=preparePublicNote(note,{title:record.title,summary:record.summary,theme:record.theme,attachments:record.attachments||[]});
  if(preview.digest!==record.digest||record.pending)throw Error('원본이 변경됐습니다. 공개 페이지를 업데이트한 뒤 공동 편집을 켜 주세요.');
  const salt=crypto.randomBytes(16).toString('hex'),pinHash=(await derive(pin,salt,32)).toString('hex');
  const backup=path.join(this.manager.directory,'edit-backups');await fs.mkdir(backup,{recursive:true,mode:0o700});await fs.writeFile(path.join(backup,id+'-'+Date.now()+'-'+crypto.randomBytes(4).toString('hex')+'.md'),note.content,{mode:0o600,flag:'wx'});
  const before=record.collaboration;record.collaboration={salt,pinHash,sourceHash:hash(note.content)};try{await this.manager.persist();}catch(error){if(before)record.collaboration=before;else delete record.collaboration;throw error;}this.reset(id);
  try{await this.manager.startAttachmentHost();await this.manager.requestRoute('PUT','/api/pages/'+id+'/editing',{enabled:true});}
  catch(error){if(before)record.collaboration=before;else delete record.collaboration;await this.manager.persist();this.manager.stopUnusedAttachmentHost();this.notify();throw error;}
  this.notify();
 });}
 async room(record){
  if(!record.collaboration)throw fail(403,'게시자가 공동 편집을 중지했습니다.');
  if(this.rooms.has(record.id))return this.rooms.get(record.id);
  const {note}=await this.source(record);if(hash(note.content)!==record.collaboration.sourceHash)throw fail(409,'원본이 다른 앱에서 변경됐습니다. 게시자가 공동 편집을 다시 설정해야 합니다.');
  const parts=split(note.content),room={epoch:crypto.randomBytes(16).toString('hex'),prefix:parts.prefix,raw:note.content,doc:Text.of(parts.body.split('\n')),version:0,base:0,history:[],bytes:0};this.rooms.set(record.id,room);return room;
 }
 prune(){for(const [token,session]of this.sessions)if(session.expires<Date.now()||!this.entries().some(record=>record.id===session.id))this.sessions.delete(token);for(const [key,value]of this.attempts)if((value.seen||0)<Date.now()-900000)this.attempts.delete(key);}
 async login(record,input,client){
  this.prune();const key=record.id+':'+client,attempt=this.attempts.get(key)||{count:0,until:0};if(attempt.until>Date.now())throw fail(429,'암호를 여러 번 틀렸습니다. 1분 후 다시 시도해 주세요.');
  const valid=typeof input.pin==='string'&&/^\d{4}$/.test(input.pin);const candidate=valid?await derive(input.pin,record.collaboration.salt,32):Buffer.alloc(32);
  if(!valid||!crypto.timingSafeEqual(candidate,Buffer.from(record.collaboration.pinHash,'hex'))){if(this.attempts.size>2048)this.attempts.clear();attempt.count++;attempt.seen=Date.now();if(attempt.count>=5){attempt.until=Date.now()+60000;attempt.count=0;}this.attempts.set(key,attempt);throw fail(401,'편집 암호가 맞지 않습니다.');}
  this.attempts.delete(key);if(this.sessions.size>=256||[...this.sessions.values()].filter(session=>session.id===record.id).length>=32)throw fail(429,'참여 인원이 많습니다. 잠시 후 다시 시도해 주세요.');
  const room=await this.room(record),token=crypto.randomBytes(32).toString('hex'),clientID=crypto.randomBytes(16).toString('hex');
  this.sessions.set(token,{id:record.id,clientID,name:String(input.name||'참여자').replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,24)||'참여자',expires:Date.now()+8*3600000,seen:Date.now()});
  return {session:token,clientID,content:room.doc.toString(),version:room.version,epoch:room.epoch};
 }
 publication(record){return {markdown:preparePublicNote({path:record.notePath,content:this.rooms.get(record.id).raw},{title:record.title,summary:record.summary,theme:record.theme,attachments:record.attachments||[]}).markdown,digest:record.digest,updatedAt:record.updatedAt};}
 async synchronize(record,session,input){
  const room=await this.room(record),version=input.version;
  if(input.epoch!==room.epoch||!Number.isSafeInteger(version)||version<room.base||version>room.version)throw fail(409,'편집 세션이 바뀌었습니다. 작성 내용을 복사해 둔 뒤 다시 참여해 주세요.');
  if(input.updates!==undefined){
   if(!Array.isArray(input.updates)||!input.updates.length||input.updates.length>100)throw fail(400,'변경 내용을 확인할 수 없습니다.');
   let changes,doc=room.doc;
   try{changes=rebaseUpdates(input.updates.map(update=>({clientID:session.clientID,changes:ChangeSet.fromJSON(update.changes)})),room.history.slice(version-room.base));for(const update of changes)doc=update.changes.apply(doc);}catch{throw fail(400,'문서 변경 형식을 확인해 주세요.');}
   if(changes.length){
    const body=doc.toString();if(Buffer.byteLength(body)>200*1024)throw fail(413,'공동 편집 본문은 200KB까지 지원합니다.');
    if(!room.prefix&&/^---\n/.test(body)||publicMarkdown(body)!==body.trim())throw fail(400,'공동 편집에서는 YAML 속성이나 숨김 주석을 추가할 수 없습니다.');
    const {vault,target,note}=await this.source(record);if(note.content!==room.raw||hash(note.content)!==record.collaboration.sourceHash)throw fail(409,'원본이 다른 앱에서 변경됐습니다. 입력 내용을 보관하고 게시자에게 알려 주세요.');
    const content=room.prefix+body,preview=preparePublicNote({path:record.notePath,content},{title:record.title,summary:record.summary,theme:record.theme,attachments:record.attachments||[]});
    const previous=structuredClone(record);await vault.atomicWrite(target.absolute,content);
    record.digest=preview.digest;record.updatedAt=Math.max(Date.now(),record.updatedAt+1);record.collaboration.sourceHash=hash(content);
    try{await this.manager.persist();}catch(error){Object.assign(record,previous);await vault.atomicWrite(target.absolute,note.content);throw error;}
    room.raw=content;room.doc=doc;for(const update of changes){const size=JSON.stringify(update.changes.toJSON()).length;room.history.push({...update,size});room.bytes+=size;room.version++;}
    this.notify({path:record.notePath,content,modified:record.updatedAt},record.vaultRoot);
   }
  }
  const result={epoch:room.epoch,version:room.version,updates:room.history.slice(version-room.base).map(update=>({clientID:update.clientID,changes:update.changes.toJSON()})),participants:[...this.sessions.values()].filter(value=>value.id===record.id&&value.seen>Date.now()-20000).map(value=>({id:value.clientID,name:value.name})),publication:this.publication(record)};
  while(room.history.length>4096||room.bytes>8*1024*1024){room.bytes-=room.history.shift().size;room.base++;}return result;
 }
 async handle(id,action,input,token,client){return this.manager.serial(async()=>{
  this.prune();const record=this.find(id);if(!record.collaboration)throw fail(403,'공동 편집이 꺼져 있습니다.');
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail(400,'잘못된 편집 요청입니다.');
  if(action==='login')return this.login(record,input,client);
  const session=this.sessions.get(token);if(!session||session.id!==id)throw fail(401,'편집 인증이 만료됐습니다. 입력 내용을 복사해 두고 다시 참여해 주세요.');session.seen=Date.now();return this.synchronize(record,session,input);
 });}
}
module.exports={SharedEditing};
