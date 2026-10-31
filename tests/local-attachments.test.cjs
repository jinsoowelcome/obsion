'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {PublishManager}=require('../electron/publish-manager.cjs');
const {AttachmentHost}=require('../electron/attachment-host.cjs');
const {AttachmentSelection}=require('../electron/publish-attachments.cjs');
test('attachment selection enforces bounds and the local server only serves authenticated cached files',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'obsion-attachments-'));
 const manager=new PublishManager({directory,baseUrl:'https://example.com'});
 const host=new AttachmentHost(manager);
 try{
  const source=path.join(directory,'문서.txt');const bytes=Buffer.from('선택한 파일 내용');await fs.writeFile(source,bytes);
  const selection=new AttachmentSelection();const [file]=await selection.add([source]);assert.equal(file.size,bytes.length);assert.equal(file.data,undefined);assert.equal(file.path,undefined);
  assert.throws(()=>selection.resolve([file.id,file.id]),/중복/);
  const oversized=path.join(directory,'large');await fs.writeFile(oversized,Buffer.alloc(5*1024*1024+1));await assert.rejects(selection.add([oversized]),/5MB/);
  const page='a'.repeat(32),target=manager.attachmentPath(page,file.id);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);
  await host.openServer();const origin='http://127.0.0.1:'+host.server.address().port;
  const url=origin+'/download/'+page+'/'+file.id;
  assert.equal((await fetch(url)).status,403);
  const headers={Authorization:'Bearer '+host.token};const response=await fetch(url,{headers});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  assert.equal((await fetch(origin+'/download/'+page+'/'+'b'.repeat(64),{headers})).status,404);
  assert.equal((await fetch(origin+'/download/../../etc/passwd',{headers})).status,404);
  await fs.unlink(target);await fs.symlink('/etc/hosts',target);assert.equal((await fetch(url,{headers})).status,404);
 }finally{host.stop();await fs.rm(directory,{recursive:true,force:true});}
});
