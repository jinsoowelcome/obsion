import { renderPage, renderHome, renderNotFound, renderEditor } from './html.ts';

export interface Env { DB: D1Database; PUBLISHER_PUBLIC_KEY: string; ASSETS?: Fetcher }
export interface PublishedPage {
  id: string; title: string; markdown: string; summary: string; theme: string;
  digest: string; created_at: number; updated_at: number;
  attachments: string;
  editing_enabled: number;
}
export interface Attachment { id: string; name: string; size: number; sha256: string }
export function attachmentsFor(page: PublishedPage): Attachment[] { return JSON.parse(page.attachments || '[]'); }
const pageID = /^[a-f0-9]{32}$/;
const headers = {
  'Cache-Control': 'no-store, max-age=0', 'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; img-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
};
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
const html = (body: string, status = 200) => new Response(body, { status, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));

async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get('content-length')) > 300000) return null;
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 300000) { await reader.cancel(); return null; }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
}

async function authenticate(request: Request, body: string, env: Env): Promise<boolean> {
  const timestamp = request.headers.get('x-replica-timestamp') || '';
  const nonce = request.headers.get('x-replica-nonce') || '';
  const signature = request.headers.get('x-replica-signature') || '';
  if (!Number.isSafeInteger(Number(timestamp)) || Math.abs(Date.now() - Number(timestamp)) > 300000 || !pageID.test(nonce) || !/^[\w-]{86}$/.test(signature)) return false;
  try {
    const key = await crypto.subtle.importKey('raw', decode(env.PUBLISHER_PUBLIC_KEY), { name: 'Ed25519' }, false, ['verify']);
    const message = [request.method, new URL(request.url).pathname, timestamp, nonce, body].join('\n');
    if (!await crypto.subtle.verify({ name: 'Ed25519' }, key, decode(signature), new TextEncoder().encode(message))) return false;
  } catch { return false; }
  // The unique nonce insert prevents concurrent replay of a signed request.
  try { await env.DB.prepare('INSERT INTO publish_nonces (nonce, created_at) VALUES (?, ?)').bind(nonce, Date.now()).run(); }
  catch (error) {
    if (String(error).includes('UNIQUE constraint')) return false;
    throw error;
  }
  await env.DB.prepare('DELETE FROM publish_nonces WHERE created_at < ?').bind(Date.now() - 600000).run();
  return true;
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (pathname === '/editor.js' && ['GET', 'HEAD'].includes(request.method)) {
    if (!env.ASSETS) return json({error:'편집기 파일이 준비되지 않았습니다.'},503);
    const asset=await env.ASSETS.fetch(request);return new Response(asset.body,{status:asset.status,headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}});
  }
  const configure=/^\/api\/pages\/([a-f0-9]{32})\/editing$/.exec(pathname);
  if(configure&&request.method==='PUT'){
    const body=await readBody(request);if(body===null)return json({error:'요청이 너무 큽니다.'},413);
    if(!await authenticate(request,body,env))return json({error:'편집 설정 권한을 확인할 수 없습니다.'},401);
    let data;try{data=JSON.parse(body);}catch{return json({error:'잘못된 설정입니다.'},400);}
    if(typeof data?.enabled!=='boolean')return json({error:'잘못된 설정입니다.'},400);
    const page=await env.DB.prepare('SELECT * FROM published_pages WHERE id=?').bind(configure[1]).first<PublishedPage>();if(!page)return json({error:'공유 문서가 없습니다.'},404);
    await env.DB.prepare('UPDATE published_pages SET editing_enabled=? WHERE id=?').bind(data.enabled?1:0,page.id).run();
    const publication=data.publication;
    if(!data.enabled&&publication&&typeof publication.markdown==='string'&&new TextEncoder().encode(publication.markdown).length<=204800&&/^[a-f0-9]{64}$/.test(publication.digest)&&Number.isSafeInteger(publication.updatedAt))await env.DB.prepare('UPDATE published_pages SET markdown=?,digest=?,updated_at=? WHERE id=? AND updated_at<?').bind(publication.markdown,publication.digest,publication.updatedAt,page.id,publication.updatedAt).run();
    return json({enabled:data.enabled});
  }
  const collaboration=/^\/api\/pages\/([a-f0-9]{32})\/collab\/(login|updates)$/.exec(pathname);
  if(collaboration&&request.method==='POST'){
    const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'이 페이지에서는 편집 요청을 허용하지 않습니다.'},403);
    if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON 요청이 필요합니다.'},415);
    const page=await env.DB.prepare('SELECT * FROM published_pages WHERE id=?').bind(collaboration[1]).first<PublishedPage>();if(!page||!page.editing_enabled)return json({error:'공동 편집이 꺼져 있거나 공유가 중지됐습니다.'},403);
    const host=await env.DB.prepare('SELECT origin,token,updated_at FROM attachment_host WHERE id=1').first<{origin:string;token:string;updated_at:number}>();
    if(!host||Date.now()-host.updated_at>90000||!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(host.origin))return json({error:'게시자의 PC와 Obsion 앱이 켜져 있어야 편집할 수 있습니다.'},503);
    const body=await readBody(request);if(body===null||collaboration[2]==='login'&&body.length>4096)return json({error:'요청이 너무 큽니다.'},413);
    try{
      const session=request.headers.get('x-obsion-session')||'';
      const response=await fetch(host.origin+'/collab/'+page.id+'/'+collaboration[2],{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json',Authorization:'Bearer '+host.token,'X-Obsion-Session':/^[a-f0-9]{64}$/.test(session)?session:'','X-Obsion-Client':request.headers.get('CF-Connecting-IP')||'unknown'},body,signal:AbortSignal.timeout(30000)});
      const result=await response.json() as Record<string,any>;
      if(response.ok&&result.publication){const value=result.publication;if(typeof value.markdown!=='string'||new TextEncoder().encode(value.markdown).length>204800||!/^[a-f0-9]{64}$/.test(value.digest)||!Number.isSafeInteger(value.updatedAt))return json({error:'편집 저장 결과를 확인하지 못했습니다.'},503);await env.DB.prepare('UPDATE published_pages SET markdown=?,digest=?,updated_at=? WHERE id=? AND editing_enabled=1 AND updated_at<?').bind(value.markdown,value.digest,value.updatedAt,page.id,value.updatedAt).run();delete result.publication;}
      return json(result,response.status);
    }catch{return json({error:'원본 PC에 연결하지 못했습니다. 입력 내용을 보관하고 잠시 후 다시 시도해 주세요.'},503);}
  }
  const editor=/^\/p\/([a-f0-9]{32})\/edit$/.exec(pathname);
  if(editor&&['GET','HEAD'].includes(request.method)){const page=await env.DB.prepare('SELECT * FROM published_pages WHERE id=?').bind(editor[1]).first<PublishedPage>();return page&&page.editing_enabled?html(renderEditor(page)):html(renderNotFound(),404);}
  if (pathname === '/api/attachment-host' && request.method === 'PUT') {
    const body = await readBody(request);
    if (body === null) return json({ error: '요청이 너무 큽니다.' }, 413);
    if (!await authenticate(request, body, env)) return json({ error: '다운로드 연결 권한을 확인할 수 없습니다.' }, 401);
    let data; try { data = JSON.parse(body); } catch { return json({ error: '잘못된 요청입니다.' }, 400); }
    if (!data || typeof data.origin !== 'string' || !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(data.origin) || typeof data.token !== 'string' || !/^[a-f0-9]{64}$/.test(data.token)) return json({ error: '잘못된 다운로드 연결입니다.' }, 400);
    await env.DB.prepare('INSERT INTO attachment_host (id,origin,token,updated_at) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET origin=excluded.origin,token=excluded.token,updated_at=excluded.updated_at').bind(data.origin, data.token, Date.now()).run();
    let reachable = false; let probeStatus = 0; let probeError = '';
    try { const probe = await fetch(data.origin + '/ready', { headers: { Authorization: 'Bearer ' + data.token }, redirect: 'manual', signal: AbortSignal.timeout(5000) }); probeStatus = probe.status; reachable = probe.status === 204; await probe.body?.cancel(); } catch (error) { probeError = error instanceof Error ? error.message : 'connection error'; }
    return json({ connected: true, reachable, probeStatus, probeError });
  }
  const download = /^\/p\/([a-f0-9]{32})\/files\/([a-f0-9]{64})$/.exec(pathname);
  if (download && ['GET', 'HEAD'].includes(request.method)) {
    const page = await env.DB.prepare('SELECT * FROM published_pages WHERE id = ?').bind(download[1]).first<PublishedPage>();
    const file = page && attachmentsFor(page).find(file => file.id === download[2]);
    if (!file) return html(renderNotFound(), 404);
    const unavailable = () => html('<!doctype html><html lang="ko"><meta charset="utf-8"><title>다운로드 대기</title><h1>지금은 파일을 다운로드할 수 없습니다.</h1><p>게시자의 PC와 Obsion 앱이 켜져 있어야 합니다. 잠시 후 다시 시도해 주세요.</p></html>', 503);
    const host = await env.DB.prepare('SELECT origin, token, updated_at FROM attachment_host WHERE id = 1').first<{ origin: string; token: string; updated_at: number }>();
    if (!host || Date.now() - host.updated_at > 90000 || !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(host.origin)) return unavailable();
    try {
      const response = await fetch(host.origin + '/download/' + download[1] + '/' + file.id, { method: request.method, redirect: 'manual', headers: { Authorization: 'Bearer ' + host.token }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) return unavailable();
      let bytes: Uint8Array | null = null;
      if (request.method !== 'HEAD') {
        const reader = response.body?.getReader(); if (!reader) return unavailable();
        bytes = new Uint8Array(file.size); let offset = 0;
        while (true) { const chunk = await reader.read(); if (chunk.done) break; if (offset + chunk.value.byteLength > file.size) { await reader.cancel(); return unavailable(); } bytes.set(chunk.value, offset); offset += chunk.value.byteLength; }
        if (offset !== file.size) return unavailable();
        const checksum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
        if (checksum !== file.sha256) return unavailable();
      }
      const filename = encodeURIComponent(file.name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
      return new Response(bytes, { headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.size), 'Content-Disposition': 'attachment; filename="download"; filename*=UTF-8\'\'' + filename } });
    } catch { return unavailable(); }
  }
  if (pathname === '/health' && request.method === 'GET') {
    await env.DB.prepare('SELECT id FROM published_pages LIMIT 1').first();
    return json({ ok: true, service: 'obsion-publish', provider: 'cloudflare', publisherConfigured: /^[\w-]{43}$/.test(env.PUBLISHER_PUBLIC_KEY || '') });
  }
  if (pathname === '/' && ['GET', 'HEAD'].includes(request.method)) return html(renderHome());
  const publicMatch = /^\/p\/([a-f0-9]{32})$/.exec(pathname);
  const apiMatch = /^\/api\/pages\/([a-f0-9]{32})$/.exec(pathname);
  const id = (publicMatch || apiMatch)?.[1];
  if (!id) return pathname.startsWith('/api/') ? json({ error: '공유 문서를 찾을 수 없습니다.' }, 404) : html(renderNotFound(), 404);
  if (['GET', 'HEAD'].includes(request.method)) {
    const page = await env.DB.prepare('SELECT * FROM published_pages WHERE id = ?').bind(id).first<PublishedPage>();
    if (!page) return apiMatch ? json({ error: '공유가 중지됐거나 존재하지 않는 문서입니다.' }, 404) : html(renderNotFound(), 404);
    return publicMatch ? html(renderPage(page)) : json({ id: page.id, title: page.title, markdown: page.markdown, summary: page.summary, theme: page.theme, digest: page.digest, attachments: attachmentsFor(page), editingEnabled:!!page.editing_enabled, createdAt: page.created_at, updatedAt: page.updated_at });
  }
  if (!apiMatch || !['PUT', 'DELETE'].includes(request.method)) return json({ error: '지원하지 않는 요청입니다.' }, 405);
  if (!/^[\w-]{43}$/.test(env.PUBLISHER_PUBLIC_KEY || '')) return json({ error: '서버의 게시 키 설정이 필요합니다.' }, 503);
  let body: string | null;
  try { body = request.method === 'PUT' ? await readBody(request) : ''; }
  catch { return json({ error: '잘못된 문서 인코딩입니다.' }, 400); }
  if (body === null) return json({ error: '문서가 너무 큽니다.' }, 413);
  if (!await authenticate(request, body, env)) return json({ error: '게시 권한을 확인할 수 없습니다.' }, 401);
  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM published_pages WHERE id = ?').bind(id).run();
    return json({ id, unpublished: true });
  }
  let data;
  try { data = JSON.parse(body); } catch { return json({ error: '잘못된 요청입니다.' }, 400); }
  if (!data || typeof data.title !== 'string' || !data.title.trim() || data.title.length > 200 || typeof data.markdown !== 'string' || new TextEncoder().encode(data.markdown).length > 204800 || typeof data.summary !== 'string' || data.summary.length > 400 || !['light', 'dark'].includes(data.theme) || typeof data.digest !== 'string' || !/^[a-f0-9]{64}$/.test(data.digest)) return json({ error: '공개 문서 형식이 올바르지 않습니다.' }, 400);
  const attachments: Attachment[] = [];
  if (data.attachments !== undefined) {
    if (!Array.isArray(data.attachments) || data.attachments.length > 10) return json({ error: '첨부파일은 최대 10개까지 지원합니다.' }, 400);
    for (const file of data.attachments) {
      if (!file || typeof file.id !== 'string' || !/^[a-f0-9]{64}$/.test(file.id) || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256) || typeof file.name !== 'string' || !file.name || file.name.length > 200 || /[\x00-\x1f\x7f\\/]/.test(file.name) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 5 * 1024 * 1024 || file.data !== undefined) return json({ error: '첨부파일 형식이 올바르지 않습니다.' }, 400);
      attachments.push({ id: file.id, name: file.name, size: file.size, sha256: file.sha256 });
    }
    if (new Set(attachments.map(file => file.id)).size !== attachments.length || attachments.reduce((sum, file) => sum + file.size, 0) > 10 * 1024 * 1024) return json({ error: '첨부파일은 중복 없이 합계 10MB까지 지원합니다.' }, 400);
  }
  const payload = JSON.stringify({ title: data.title, markdown: data.markdown, summary: data.summary, theme: data.theme, ...(attachments.length ? { attachments } : {}) });
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))), b => b.toString(16).padStart(2, '0')).join('');
  if (digest !== data.digest) return json({ error: '문서의 내용 확인 값이 일치하지 않습니다.' }, 400);
  const now = Date.now();
  await env.DB.prepare('INSERT INTO published_pages (id,title,markdown,summary,theme,digest,attachments,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,markdown=excluded.markdown,summary=excluded.summary,theme=excluded.theme,digest=excluded.digest,attachments=excluded.attachments,editing_enabled=0,updated_at=excluded.updated_at').bind(id, data.title, data.markdown, data.summary, data.theme, digest, JSON.stringify(attachments), now, now).run();
  return json({ id, digest, updatedAt: now });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const response = await handleRequest(request, env);
      return request.method === 'HEAD' ? new Response(null, response) : response;
    } catch (error) {
      console.error('publish request failed', error instanceof Error ? error.message : 'unknown error');
      return json({ error: '공유 서버에서 요청을 처리하지 못했습니다.' }, 503);
    }
  },
};
