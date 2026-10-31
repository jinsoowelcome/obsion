'use strict';
const http=require('node:http');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
class AttachmentHost{
 constructor(manager){this.manager=manager;this.token=crypto.randomBytes(32).toString('hex');this.stopped=false;}
 async openServer(){
  if(this.server)return;
  this.server=http.createServer(async(req,res)=>{
   const supplied=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+this.token);
   if(supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected)){res.writeHead(403);res.end();return;}
   if(req.url==='/ready'&&req.method==='GET'){res.writeHead(204);res.end();return;}
   const editing=/^\/collab\/([a-f0-9]{32})\/(login|updates)$/.exec(req.url||'');
   if(editing){
    const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    if(req.method!=='POST'||!String(req.headers['content-type']||'').startsWith('application/json')){send(405,{error:'JSON 편집 요청이 필요합니다.'});return;}
    try{let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>300000){send(413,{error:'편집 요청이 너무 큽니다.'});return;}chunks.push(chunk);}let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{error:'잘못된 편집 요청입니다.'});return;}
     const result=await this.manager.collaboration.handle(editing[1],editing[2],input,String(req.headers['x-obsion-session']||''),String(req.headers['x-obsion-client']||'unknown'));send(200,result);
    }catch(error){send(error.status||503,{error:error.status?error.message:'원본 노트를 저장하지 못했습니다. 게시자에게 알려 주세요.'});}return;
   }
   const match=/^\/download\/([a-f0-9]{32})\/([a-f0-9]{64})$/.exec(req.url||'');
   if(!match||!['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end();return;}
   try{
    const file=this.manager.attachmentPath(match[1],match[2]);
    const handle=await fsp.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    const stat=await handle.stat();if(!stat.isFile()){await handle.close();throw Error();}
    res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    if(req.method==='HEAD'){await handle.close();res.end();return;}
    const stream=handle.createReadStream();stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
   }catch{if(!res.headersSent)res.writeHead(404);res.end();}
  });
  this.server.requestTimeout=15000;
  await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(0,'127.0.0.1',resolve);});
 }
 async pulse(){if(this.origin)return this.manager.requestRoute('PUT','/api/attachment-host',{origin:this.origin,token:this.token});}
 async start(){
  if(this.stopped)throw Error('첨부파일 다운로드 서버가 종료됐습니다.');
  if(this.starting)return this.starting;
  if(this.origin){await this.pulse();return;}
  this.starting=this.connect().catch(error=>{if(!this.stopped){clearTimeout(this.retry);this.retry=setTimeout(()=>this.start().catch(()=>{}),10000);this.retry.unref();}throw error;}).finally(()=>{this.starting=null;});return this.starting;
 }
 async connect(){
  await this.openServer();
  const candidates=process.env.OBSION_CLOUDFLARED?[process.env.OBSION_CLOUDFLARED]:[path.join(os.homedir(),'.local/bin/cloudflared'),'/opt/homebrew/bin/cloudflared','/usr/local/bin/cloudflared'];let executable;
  for(const candidate of candidates)try{await fsp.access(candidate,fs.constants.X_OK);executable=candidate;break;}catch{}
  if(!executable)throw Error('로컬 첨부 공유에 필요한 cloudflared를 설치해 주세요.');
  const config=path.join(this.manager.directory,'download-tunnel.yml');await fsp.writeFile(config,'no-autoupdate: true\n',{mode:0o600});
  const env={...process.env};for(const name of Object.keys(env))if(name.startsWith('TUNNEL_'))delete env[name];
  const {powerSaveBlocker}=require('electron');this.powerSaveBlocker=powerSaveBlocker;
  if(powerSaveBlocker&&this.blocker===undefined)this.blocker=powerSaveBlocker.start('prevent-app-suspension');
  const port=this.server.address().port;
  this.child=spawn(executable,['tunnel','--config',config,'--no-autoupdate','--url','http://127.0.0.1:'+port,'--protocol','http2','--metrics','127.0.0.1:0'],{stdio:['ignore','ignore','pipe'],env});
  this.child.stderr.on('data',chunk=>{if(process.env.OBSION_TUNNEL_DEBUG==='1')console.error(chunk.toString());});
  try{
   this.origin=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{reject(Error('다운로드 터널 연결 시간이 초과됐습니다. 다시 시도해 주세요.'));},45000);
    let output='';
    const finish=(error,value)=>{clearTimeout(timer);this.child?.stderr.removeListener('data',read);error?reject(error):resolve(value);};
    const read=chunk=>{output=(output+chunk.toString()).slice(-16000);const match=/https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(output);if(match&&output.includes('Registered tunnel connection'))finish(null,match[0]);};
    this.child.stderr.on('data',read);this.child.once('error',()=>finish(Error('다운로드 터널을 실행하지 못했습니다.')));this.child.once('exit',()=>finish(Error('다운로드 터널 연결이 종료됐습니다.')));
   });
   let reachable=false;
   for(let attempt=0;attempt<30&&!this.stopped;attempt++){
    try{const result=await this.pulse();if(process.env.OBSION_TUNNEL_DEBUG==='1')console.log('download tunnel probe',result?.reachable,result?.probeStatus,result?.probeError);if(result?.reachable){reachable=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,2000));
   }
   if(!reachable)throw Error('다운로드 터널의 공개 주소를 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
   await this.pulse();
   clearInterval(this.timer);this.timer=setInterval(()=>this.pulse().catch(()=>{}),30000);this.timer.unref();
   this.child.once('exit',()=>{this.origin=null;clearInterval(this.timer);if(!this.stopped){this.retry=setTimeout(()=>this.start().catch(()=>{}),10000);this.retry.unref();}});
  }catch(error){this.child?.kill();this.origin=null;throw error;}
 }
 stop(){this.stopped=true;clearInterval(this.timer);clearTimeout(this.retry);this.child?.kill();this.server?.close();if(this.blocker!==undefined)this.powerSaveBlocker?.stop(this.blocker);this.blocker=undefined;this.origin=null;}
}
module.exports={AttachmentHost};
