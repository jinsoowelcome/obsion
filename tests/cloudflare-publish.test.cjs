'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { preparePublicNote } = require('../electron/public-note.cjs');
const id = 'a'.repeat(32);
async function fixture(run) {
  const worker = (await import('../publish-service/worker/cloudflare.ts')).default;
  const sqlite = new DatabaseSync(':memory:');
  const migrations=path.join(__dirname,'../publish-service/drizzle');
  for(const file of fs.readdirSync(migrations).filter(file=>file.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(migrations,file),'utf8'));
  const DB = { prepare(sql) {
    let values = [];
    return { bind(...args) { values = args; return this; }, async run() { return sqlite.prepare(sql).run(...values); }, async first() { return sqlite.prepare(sql).get(...values) || null; } };
  } };
  const keys = crypto.generateKeyPairSync('ed25519');
  const env = { DB, PUBLISHER_PUBLIC_KEY: keys.publicKey.export({ format: 'jwk' }).x };
  function signed(method, body = '', options = {}) {
    const route = options.route || '/api/pages/' + id, timestamp = String(options.timestamp || Date.now()), nonce = options.nonce || crypto.randomBytes(16).toString('hex');
    const signature = crypto.sign(null, Buffer.from([method, route, timestamp, nonce, body].join('\n')), options.privateKey || keys.privateKey).toString('base64url');
    return new Request('https://share.example' + route, { method, headers: { 'X-Replica-Timestamp': timestamp, 'X-Replica-Nonce': nonce, 'X-Replica-Signature': signature }, ...(method === 'PUT' ? { body } : {}) });
  }
  const payload = () => { const { bytes, ...data } = preparePublicNote({ path: 'note.md', content: '# 내용\n<script>alert(1)</script>\n[위험](javascript:alert(1))' }, { title: '<제목>', summary: '설명', theme: 'dark' }); return JSON.stringify(data); };
  try { await run({ env, signed, payload, request: request => worker.fetch(request, env) }); } finally { sqlite.close(); }
}
test('Cloudflare publishing creates, reads, updates, and revokes a D1 page', () => fixture(async ({ request, signed, payload }) => {
  const data = payload();
  assert.equal((await request(signed('PUT', data))).status, 200);
  const response = await request(new Request('https://share.example/p/' + id));
  assert.equal(response.status, 200);
  const html = await response.text();
  assert(html.includes('&lt;제목&gt;')); assert(html.includes('published-page dark'));
  assert(!html.includes('<script>')); assert(!html.includes('href="javascript:'));
  assert(response.headers.get('content-security-policy').includes("default-src 'none'"));
  assert.equal((await request(signed('PUT', data))).status, 200);
  assert.equal((await request(signed('DELETE'))).status, 200);
  assert.equal((await request(new Request('https://share.example/p/' + id))).status, 404);
}));
test('Cloudflare rejects replayed, expired, and foreign signed requests', () => fixture(async ({ request, signed, payload }) => {
  const original = signed('PUT', payload());
  const replay = original.clone();
  assert.equal((await request(original)).status, 200);
  assert.equal((await request(replay)).status, 401);
  assert.equal((await request(signed('DELETE', '', { timestamp: Date.now() - 600000 }))).status, 401);
  assert.equal((await request(signed('DELETE', '', { privateKey: crypto.generateKeyPairSync('ed25519').privateKey }))).status, 401);
}));
test('Cloudflare rejects inconsistent content and limits streamed request size', () => fixture(async ({ request, signed, payload }) => {
  const data = JSON.parse(payload()); data.markdown += 'tampered';
  assert.equal((await request(signed('PUT', JSON.stringify(data)))).status, 400);
  assert.equal((await request(signed('PUT', 'x'.repeat(300001)))).status, 413);
}));
test('Cloudflare health reports a missing publisher configuration and publishing fails closed', () => fixture(async ({ request, env, signed, payload }) => {
  env.PUBLISHER_PUBLIC_KEY = '';
  const response = await request(new Request('https://share.example/health'));
  assert.equal((await response.json()).publisherConfigured, false);
  assert.equal((await request(signed('PUT', payload()))).status, 503);
}));

test('local attachment downloads require an active host and disappear when removed or revoked',()=>fixture(async({request,signed,payload,env})=>{
 const bytes=Buffer.from('download content');
 const file={id:'b'.repeat(64),name:'공유 자료.txt',size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 const original=JSON.parse(payload());const {digest,...base}=original;
 const withFiles={...base,attachments:[file]};withFiles.digest=crypto.createHash('sha256').update(JSON.stringify(withFiles)).digest('hex');
 assert.equal((await request(signed('PUT',JSON.stringify(withFiles)))).status,200);
 const url='https://share.example/p/'+id+'/files/'+file.id;
 assert.equal((await request(new Request(url))).status,503);
 const origin='https://example-test.trycloudflare.com',token='c'.repeat(64);
 assert.equal((await request(signed('PUT',JSON.stringify({origin:'https://127.0.0.1',token}),{route:'/api/attachment-host'}))).status,400);
 const nativeFetch=global.fetch;global.fetch=async(_url,options)=>{assert.equal(options.redirect,'manual');return new Response(null,{status:204});};
 try{const heartbeat=await request(signed('PUT',JSON.stringify({origin,token}),{route:'/api/attachment-host'}));assert.equal(heartbeat.status,200);assert.equal((await heartbeat.json()).reachable,true);}finally{global.fetch=nativeFetch;}
 const previousFetch=global.fetch;
 global.fetch=async(input,options)=>{assert.equal(options.redirect,'manual');assert.equal(input,origin+'/download/'+id+'/'+file.id);assert.equal(options.headers.Authorization,'Bearer '+token);return new Response(bytes,{headers:{'Content-Length':String(bytes.length)}});};
 try{
  const response=await request(new Request(url));assert.equal(response.status,200);assert(response.headers.get('content-disposition').includes('attachment;'));assert(response.headers.get('content-disposition').includes('filename*=UTF-8'));assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  global.fetch=async()=>new Response(Buffer.alloc(bytes.length));assert.equal((await request(new Request(url))).status,503);
  global.fetch=async()=>new Response(bytes);assert.equal((await request(new Request(url))).status,200);
  const page=await request(new Request('https://share.example/p/'+id));const html=await page.text();assert(html.includes('공유 자료.txt'));assert(html.includes('/files/'+file.id));assert(!html.includes(token));assert(!html.includes(origin));
  await env.DB.prepare('UPDATE attachment_host SET updated_at = ? WHERE id = 1').bind(Date.now()-100000).run();
  assert.equal((await request(new Request(url))).status,503);
  assert.equal((await request(signed('PUT',payload()))).status,200);
  assert.equal((await request(new Request(url))).status,404);
  await request(signed('DELETE'));assert.equal((await request(new Request(url))).status,404);
 }finally{global.fetch=previousFetch;}
}));

test('browser editing is owner-enabled, rejects cross-site requests, and synchronizes the public copy',()=>fixture(async({request,signed,payload,env})=>{
 await request(signed('PUT',payload()));const editUrl='https://share.example/p/'+id+'/edit';assert.equal((await request(new Request(editUrl))).status,404);
 assert.equal((await request(signed('PUT',JSON.stringify({enabled:true}),{route:'/api/pages/'+id+'/editing'}))).status,200);
 assert.equal((await request(new Request(editUrl))).status,200);
 const login='https://share.example/api/pages/'+id+'/collab/login';
 assert.equal((await request(new Request(login,{method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json'},body:'{}'}))).status,403);
 const fetcher=global.fetch;
 global.fetch=async(url,options)=>{assert.equal(options.redirect,'manual');if(url.endsWith('/ready'))return new Response(null,{status:204});assert.equal(options.headers.Authorization,'Bearer '+'c'.repeat(64));return Response.json({epoch:'epoch',version:1,updates:[],participants:[],publication:{markdown:'브라우저 수정',digest:'f'.repeat(64),updatedAt:Date.now()+100}});};
 try{
  await request(signed('PUT',JSON.stringify({origin:'https://example-test.trycloudflare.com',token:'c'.repeat(64)}),{route:'/api/attachment-host'}));
  const result=await request(new Request('https://share.example/api/pages/'+id+'/collab/updates',{method:'POST',headers:{Origin:'https://share.example','Content-Type':'application/json','X-Obsion-Session':'d'.repeat(64)},body:'{}'}));assert.equal(result.status,200);assert.equal((await result.json()).publication,undefined);
  assert.equal((await (await request(new Request('https://share.example/api/pages/'+id))).json()).markdown,'브라우저 수정');
  await request(signed('PUT',JSON.stringify({enabled:false}),{route:'/api/pages/'+id+'/editing'}));assert.equal((await request(new Request(editUrl))).status,404);
  assert.equal((await request(new Request(login,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}))).status,403);
 }finally{global.fetch=fetcher;}
 env.ASSETS={fetch:async()=>new Response('console.log("editor")')};const asset=await request(new Request('https://share.example/editor.js'));assert.equal(asset.status,200);assert(asset.headers.get('content-type').startsWith('text/javascript'));
}));
