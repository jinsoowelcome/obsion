import {eq} from 'drizzle-orm';
import {notFound} from 'next/navigation';
import type {Metadata} from 'next';
import {getDb} from '../../../db';
import {pages} from '../../../db/schema';
import {pageID} from '../../../lib/auth';
import {renderPublicMarkdown} from '../../../lib/render';
export const dynamic='force-dynamic';
type Props={params:Promise<{id:string}>};
async function find(id:string){return pageID.test(id)?getDb().select().from(pages).where(eq(pages.id,id)).get():undefined;}
export async function generateMetadata({params}:Props):Promise<Metadata>{const page=await find((await params).id);return{title:page?page.title+' · 옵시온':'공유 문서 없음',description:page?.summary||'옵시온에서 공유한 문서',robots:{index:false,follow:false}};}
export default async function SharedPage({params}:Props){
 const page=await find((await params).id);if(!page)notFound();
 return <main className={'published-page '+(page.theme==='dark'?'dark':'')}>
 <header className="site-header"><a href="/" className="brand"><span className="brand-mark">◈</span><span>옵시온</span></a><span className="shared-badge">공유된 문서</span></header>
 <article className="document"><div className="document-label">PUBLISHED NOTE</div><h1>{page.title}</h1>{page.summary&&<p className="document-summary">{page.summary}</p>}<div className="document-meta"><span className="meta-dot"/>{new Date(page.updatedAt).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric'})} 업데이트<span>읽기 전용</span></div><div className="markdown" dangerouslySetInnerHTML={{__html:renderPublicMarkdown(page.markdown)}}/></article>
 <footer className="site-footer"><span className="brand-mark">◈</span><span>옵시온으로 게시한 문서입니다.</span><span className="footer-right">게시자가 선택한 내용만 표시됩니다.</span></footer></main>;
}
