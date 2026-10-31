'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {publicMarkdown,preparePublicNote}=require('../electron/public-note.cjs');
const {PublishManager}=require('../electron/publish-manager.cjs');

async function fixture(run){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'replica-publish-test-'));
 const keys=crypto.generateKeyPairSync('ed25519');
 await fs.writeFile(path.join(directory,'private-key.pem'),keys.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});
 const requests=[];let networkFailure=false,deny=false;
 const fetcher=async(url,options)=>{
  const requestPath=new URL(url).pathname;
  const headers=options.headers;
  const message=[options.method,requestPath,headers['X-Replica-Timestamp'],headers['X-Replica-Nonce'],options.body||''].join('\n');
  assert(crypto.verify(null,Buffer.from(message),keys.publicKey,Buffer.from(headers['X-Replica-Signature'],'base64url')));
  assert.equal(options.redirect,'error');
  requests.push({url,options});
  if(networkFailure)throw Error('connection lost');
  if(deny)return Response.json({error:'denied'},{status:401});
  return Response.json(options.method==='DELETE'?{unpublished:true}:{id:requestPath.split('/').pop(),digest:JSON.parse(options.body).digest,updatedAt:Date.now()});
 };
 const manager=new PublishManager({directory,baseUrl:'https://sharing.example',fetcher});
 try{await run({manager,directory,requests,fetcher,fail:()=>{networkFailure=true;},recover:()=>{networkFailure=false;},deny:()=>{deny=true;}});}
 finally{await fs.rm(directory,{recursive:true,force:true});}
}

test('switching sharing servers preserves the original origin for existing links',()=>fixture(async({manager,directory,fetcher,requests})=>{
 const note={path:'note.md',content:'공유 내용'};
 const prepared=await manager.prepare('/vault',note,{});
 const published=await manager.publish('/vault',note,{},prepared.preview.digest);
 const moved=new PublishManager({directory,baseUrl:'https://cloudflare.example',fetcher});
 const next=await moved.prepare('/vault',note,{});
 assert.equal(next.status.serviceUrl,'https://sharing.example');
 await moved.publish('/vault',note,{},next.preview.digest);
 assert.equal(requests.at(-1).url,'https://sharing.example/api/pages/'+published.status.id);
 await moved.unpublish(published.status.id);
 assert.equal(new URL(requests.at(-1).url).origin,'https://sharing.example');
 const disconnected=new PublishManager({directory,baseUrl:'',fetcher});
 assert.equal((await disconnected.prepare('/new-vault',note,{})).status.configured,false);
}));

test('selected attachments are copied locally and only metadata is sent to the sharing server',()=>fixture(async({manager,directory,fetcher,requests})=>{
 manager.startAttachmentHost=async()=>{};
 const source=path.join(directory,'파일.txt');await fs.writeFile(source,'로컬 첨부 내용');
 const [file]=await manager.attachments.add([source]);const options={attachments:[file.id]};const note={path:'note.md',content:'본문'};
 const prepared=await manager.prepare('/vault',note,options);
 const published=await manager.publish('/vault',note,options,prepared.preview.digest);
 const payload=JSON.parse(requests.at(-1).options.body);assert.equal(payload.attachments[0].data,undefined);assert.equal(payload.attachments[0].name,'파일.txt');assert(!JSON.stringify(payload).includes(source));
 await fs.unlink(source);assert.equal(await fs.readFile(manager.attachmentPath(published.status.id,file.id),'utf8'),'로컬 첨부 내용');
 const reopened=new PublishManager({directory,baseUrl:'https://sharing.example',fetcher});assert.equal((await reopened.prepare('/vault',note)).preview.attachments[0].id,file.id);
 await reopened.unpublish(published.status.id);await assert.rejects(fs.access(manager.attachmentPath(published.status.id,file.id)));
}));

test('publishing removes frontmatter and hidden comments while preserving code examples',()=>{
 const source='---\npassword: secret\n---\n보이는 글 %%숨긴 내용%%\n<!-- hidden HTML -->\n\n```md\n%% 코드 예시 %%\n<!-- example -->\n```\n`%% inline example %%`\n';
 const result=publicMarkdown(source);
 assert(!result.includes('password: secret'));assert(!result.includes('숨긴 내용'));assert(!result.includes('hidden HTML'));
 assert(result.includes('%% 코드 예시 %%'));assert(result.includes('<!-- example -->'));assert(result.includes('%% inline example %%'));
 assert.throws(()=>publicMarkdown('보이는 글 %% 닫히지 않음'),/닫는/);
 assert.throws(()=>publicMarkdown('---\nsecret: value'),/닫는/);
 assert.throws(()=>publicMarkdown('---\npublish: false\n---\n공개 제외 노트'),/publish: false/);
});

test('public payload contains only the selected note and enforces its size limit',()=>{
 const note={path:'private/folder/노트.md',content:'공개 본문',modified:1};
 const preview=preparePublicNote(note,{summary:'설명'});
 assert.equal(preview.title,'노트');assert(!JSON.stringify(preview).includes('private/folder'));
 assert.deepEqual(Object.keys(preview).sort(),['bytes','digest','markdown','summary','theme','title']);
 assert.throws(()=>preparePublicNote({...note,content:'a'.repeat(204801)}),/200KB/);
});

test('create, update, rename, restart, and unshare preserve stable management and local content',()=>fixture(async({manager,directory,requests,fetcher})=>{
 const note={path:'노트.md',content:'초안',modified:1};
 await fs.writeFile(path.join(directory,'source.md'),note.content);
 const first=await manager.prepare('/vault',note,{});
 const published=await manager.publish('/vault',note,{},first.preview.digest);
 const edited={...note,content:'수정된 본문'};
 const next=await manager.prepare('/vault',edited,{});
 assert(next.status.hasChanges);
 const updated=await manager.publish('/vault',edited,{},next.preview.digest);
 assert.equal(updated.status.url,published.status.url);
 await manager.rename('/vault','노트.md','새 이름.md');
 const reopened=new PublishManager({directory,baseUrl:'https://sharing.example',fetcher});
 const status=await reopened.prepare('/vault',{...edited,path:'새 이름.md'},{});
 assert.equal(status.status.url,published.status.url);
 await reopened.unpublish(published.status.id);
 assert.equal((await reopened.list()).length,0);
 assert.equal(await fs.readFile(path.join(directory,'source.md'),'utf8'),'초안');
 for(const request of requests.filter(request=>request.options.body)){
  assert.deepEqual(Object.keys(JSON.parse(request.options.body)).sort(),['digest','markdown','summary','theme','title']);
  assert(!request.options.body.includes('/vault'));
 }
}));

test('a stale preview is rejected before any upload',()=>fixture(async({manager,requests})=>{
 const note={path:'노트.md',content:'검토한 내용'};
 const preview=await manager.prepare('/vault',note,{});
 await assert.rejects(manager.publish('/vault',{...note,content:'아직 검토하지 않은 변경'}, {},preview.preview.digest),/미리보기/);
 assert.equal(requests.length,0);
}));

test('a lost publish response leaves a durable record that can still be revoked after restart',()=>fixture(async({manager,directory,fetcher,fail,recover})=>{
 const note={path:'노트.md',content:'시험'};const preview=await manager.prepare('/vault',note,{});
 fail();await assert.rejects(manager.publish('/vault',note,{},preview.preview.digest),/연결/);
 const reopened=new PublishManager({directory,baseUrl:'https://sharing.example',fetcher});
 const pending=await reopened.list();assert.equal(pending.length,1);assert.equal(pending[0].pending,true);
 recover();await reopened.unpublish(pending[0].id);assert.equal((await reopened.list()).length,0);
}));

test('a definite permission refusal does not mark a new note as published',()=>fixture(async({manager,deny})=>{
 const note={path:'노트.md',content:'시험'};const preview=await manager.prepare('/vault',note,{});
 deny();await assert.rejects(manager.publish('/vault',note,{},preview.preview.digest),/denied/);
 assert.equal((await manager.list()).length,0);
}));

test('same relative filenames in different vaults get independent public URLs',()=>fixture(async({manager})=>{
 const note={path:'같은 이름.md',content:'시험'};const preview=preparePublicNote(note);
 const a=await manager.publish('/vault-a',note,{},preview.digest),b=await manager.publish('/vault-b',note,{},preview.digest);
 assert.notEqual(a.status.url,b.status.url);
}));

test('the public renderer cannot execute note HTML, load tracking images, or navigate unsafe URLs',async()=>{
 const {renderPublicMarkdown}=await import('../publish-service/lib/render.ts');
 const html=renderPublicMarkdown('<script>alert(1)</script>\n\n![tracker](https://tracking.invalid/pixel)\n\n[unsafe](javascript:alert(1))\n\n[local](file:///private/file)\n\n[[미공개 노트]]');
 assert(!html.includes('<script>'));assert(!html.includes('<img'));assert(!html.includes('href="javascript:'));assert(!html.includes('href="file:'));
 assert(html.includes('unpublished-link'));
});
