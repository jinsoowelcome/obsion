import {eq,lt} from 'drizzle-orm';
import {getDb} from '../../../../db';
import {pages,nonces} from '../../../../db/schema';
import {authenticate,eligible,json,pageID} from '../../../../lib/auth';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,context:Context){
 const {id}=await context.params;
 if(!pageID.test(id))return json({error:'공유 문서를 찾을 수 없습니다.'},404);
 const page=await getDb().select().from(pages).where(eq(pages.id,id)).get();
 return page?json(page):json({error:'공유가 중지됐거나 존재하지 않는 문서입니다.'},404);
}
async function authorize(request:Request,body:string){
 const auth=await authenticate(request,body);if(!auth)return false;
 const db=getDb();
 try{await db.insert(nonces).values({nonce:auth.nonce,createdAt:Date.now()});}catch{return false;}
 await db.delete(nonces).where(lt(nonces.createdAt,Date.now()-600000));return true;
}
export async function PUT(request:Request,context:Context){
 const {id}=await context.params;
 if(!pageID.test(id))return json({error:'잘못된 공유 ID입니다.'},400);
 if(!eligible(request))return json({error:'게시 권한을 확인할 수 없습니다.'},401);
 if(Number(request.headers.get('content-length'))>300000)return json({error:'문서가 너무 큽니다.'},413);
 const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let length=0;
 if(reader){while(true){const item=await reader.read();if(item.done)break;length+=item.value.byteLength;if(length>300000){await reader.cancel();return json({error:'문서가 너무 큽니다.'},413);}chunks.push(item.value);}}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let body;try{body=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return json({error:'잘못된 문서 인코딩입니다.'},400);}
 if(!await authorize(request,body))return json({error:'게시 권한을 확인할 수 없습니다.'},401);
 let data;try{data=JSON.parse(body);}catch{return json({error:'잘못된 요청입니다.'},400);}
 if(typeof data.title!=='string'||!data.title.trim()||data.title.length>200||typeof data.markdown!=='string'||new TextEncoder().encode(data.markdown).length>204800||typeof data.summary!=='string'||data.summary.length>400||!['light','dark'].includes(data.theme)||!/^[a-f0-9]{64}$/.test(data.digest))return json({error:'공개 문서 형식이 올바르지 않습니다.'},400);
 const now=Date.now(),db=getDb();
 await db.insert(pages).values({id,title:data.title,markdown:data.markdown,summary:data.summary,theme:data.theme,digest:data.digest,createdAt:now,updatedAt:now}).onConflictDoUpdate({target:pages.id,set:{title:data.title,markdown:data.markdown,summary:data.summary,theme:data.theme,digest:data.digest,updatedAt:now}});
 return json({id,digest:data.digest,updatedAt:now});
}
export async function DELETE(request:Request,context:Context){
 const {id}=await context.params;
 if(!pageID.test(id))return json({error:'잘못된 공유 ID입니다.'},400);
 if(!await authorize(request,''))return json({error:'공유 중지 권한을 확인할 수 없습니다.'},401);
 await getDb().delete(pages).where(eq(pages.id,id));
 return json({id,unpublished:true});
}
