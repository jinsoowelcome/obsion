const PUBLISHER_KEY='E_oGwEUqTJfO_t12XmB_kf-l1SDHSULQ5GnvimuYBLo';
export const pageID=/^[a-f0-9]{32}$/;
export function eligible(request:Request){const at=Number(request.headers.get('x-replica-timestamp'));return Number.isSafeInteger(at)&&Math.abs(Date.now()-at)<=300000&&pageID.test(request.headers.get('x-replica-nonce')||'')&&/^[A-Za-z0-9_-]{86}$/.test(request.headers.get('x-replica-signature')||'');}
function base64url(value:string){const s=value.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(s+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));}
export async function authenticate(request:Request,body:string){
 const timestamp=request.headers.get('x-replica-timestamp')||'',nonce=request.headers.get('x-replica-nonce')||'',signature=request.headers.get('x-replica-signature')||'';
 const at=Number(timestamp);
 if(!Number.isSafeInteger(at)||Math.abs(Date.now()-at)>300000||!pageID.test(nonce))return null;
 try{
  const key=await crypto.subtle.importKey('raw',base64url(PUBLISHER_KEY),{name:'Ed25519'},false,['verify']);
  const message=[request.method,new URL(request.url).pathname,timestamp,nonce,body].join('\n');
  if(!await crypto.subtle.verify({name:'Ed25519'},key,base64url(signature),new TextEncoder().encode(message)))return null;
  return {nonce,at};
 }catch{return null;}
}
export const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'}});
