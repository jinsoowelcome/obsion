'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const crypto=require('node:crypto');
const {ChangeSet}=require('@codemirror/state');const {VaultStore}=require('../electron/vault.cjs');const {PublishManager}=require('../electron/publish-manager.cjs');
async function fixture(run){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'obsion-editing-'));const root=path.join(directory,'vault'),vault=new VaultStore(root);await vault.initialize({create:true});const source='---\nprivate: keep-this\n---\n# Shared\n';await vault.createNote('shared.md',source);const publishing=path.join(directory,'publishing');await fs.mkdir(publishing);await fs.writeFile(path.join(publishing,'private-key.pem'),crypto.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});const requests=[];const manager=new PublishManager({directory:publishing,baseUrl:'https://sharing.example',fetcher:async(url,options)=>{requests.push({url,options});return Response.json({digest:options.body?JSON.parse(options.body).digest:undefined,updatedAt:Date.now()});}});manager.startAttachmentHost=async()=>{};const preview=await manager.prepare(root,{path:'shared.md',content:source});const published=await manager.publish(root,{path:'shared.md',content:source},{},preview.preview.digest);try{await run({manager,vault,root,id:published.status.id,directory,source});}finally{manager.attachmentHost?.stop();await fs.rm(directory,{recursive:true,force:true});}}
test('two browser edits are merged, source metadata is preserved, and retry does not duplicate text',()=>fixture(async({manager,root,id,source,directory})=>{
 await manager.collaboration.configure(root,id,true,'1234');assert(manager.collaboration.locked(root,'shared.md'));
 const a=await manager.collaboration.handle(id,'login',{pin:'1234',name:'Alice'},'','client-a'),b=await manager.collaboration.handle(id,'login',{pin:'1234',name:'Bob'},'','client-b');
 const changes=(text,insert)=>ChangeSet.of({from:text.length,insert},text.length).toJSON();
 const first={epoch:a.epoch,version:a.version,updates:[{changes:changes(a.content,'Alice\n')}]};
 await manager.collaboration.handle(id,'updates',first,a.session,'client-a');
 const result=await manager.collaboration.handle(id,'updates',{epoch:b.epoch,version:b.version,updates:[{changes:changes(b.content,'Bob\n')}]},b.session,'client-b');
 assert.equal(result.version,2);const file=path.join(root,'shared.md'),content=await fs.readFile(file,'utf8');assert(content.startsWith('---\nprivate: keep-this\n---\n'));assert(content.includes('Alice\n'));assert(content.includes('Bob\n'));
 await manager.collaboration.handle(id,'updates',first,a.session,'client-a');assert.equal(await fs.readFile(file,'utf8'),content);
 const backups=await fs.readdir(path.join(directory,'publishing/edit-backups'));assert.equal(await fs.readFile(path.join(directory,'publishing/edit-backups',backups[0]),'utf8'),source);
 assert(!JSON.stringify(manager.view(manager.collaboration.find(id))).includes('pinHash'));
 await manager.collaboration.configure(root,id,false);assert(!manager.collaboration.locked(root,'shared.md'));await assert.rejects(manager.collaboration.handle(id,'updates',{epoch:a.epoch,version:0},a.session,'client-a'),error=>error.status===403);
}));
test('editing requires a PIN, throttles repeated guesses, and refuses external source changes',()=>fixture(async({manager,root,id})=>{
 await manager.collaboration.configure(root,id,true,'4829');
 for(let index=0;index<5;index++)await assert.rejects(manager.collaboration.handle(id,'login',{pin:'0000'},'','guessing-client'),error=>error.status===401);
 await assert.rejects(manager.collaboration.handle(id,'login',{pin:'4829'},'','guessing-client'),error=>error.status===429);
 const session=await manager.collaboration.handle(id,'login',{pin:'4829'},'','other-client');
 await assert.rejects(manager.collaboration.handle(id,'updates',{epoch:session.epoch,version:session.version},'invalid','other-client'),error=>error.status===401);
 await fs.writeFile(path.join(root,'shared.md'),'외부 편집기의 수정');const update=ChangeSet.of({from:0,insert:'browser'},session.content.length).toJSON();
 await assert.rejects(manager.collaboration.handle(id,'updates',{epoch:session.epoch,version:session.version,updates:[{changes:update}]},session.session,'other-client'),error=>error.status===409);assert.equal(await fs.readFile(path.join(root,'shared.md'),'utf8'),'외부 편집기의 수정');
 await manager.collaboration.configure(root,id,false);assert(!manager.collaboration.locked(root,'shared.md'));
}));
test('shared updates and native publishing are locked while browser editing is enabled',()=>fixture(async({manager,root,id,source})=>{
 await manager.collaboration.configure(root,id,true,'1234');const session=await manager.collaboration.handle(id,'login',{pin:'1234'},'','client');
 const preview=await manager.prepare(root,{path:'shared.md',content:source});await assert.rejects(manager.publish(root,{path:'shared.md',content:source},{},preview.preview.digest),/공동 편집/);
 await manager.unpublish(id);assert(!manager.collaboration.locked(root,'shared.md'));await assert.rejects(manager.collaboration.handle(id,'updates',{epoch:session.epoch,version:0},session.session,'client'),error=>error.status===404);
}));
