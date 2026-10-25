import {useCallback,useEffect,useState} from 'react';
import {Check,Copy,ExternalLink,FileText,Globe,Loader2,LockKeyhole,RefreshCw,Share2,Trash2,X} from 'lucide-react';
import type {VaultAPI} from './types';
import type {Publication,PublishOptions,PublishPrepared,PublishTarget} from './publish-types';
import {renderPublicMarkdown} from '../publish-service/lib/render';
import './publish.css';

type Props={api:VaultAPI;target:PublishTarget|null;onClose():void;onNotice(message:string):void};
export default function PublishDialog({api,target,onClose,onNotice}:Props){
 const [tab,setTab]=useState<'current'|'list'>(target?'current':'list');
 const [prepared,setPrepared]=useState<PublishPrepared|null>(null);
 const [options,setOptions]=useState<PublishOptions|null>(null);
 const [publications,setPublications]=useState<Publication[]>([]);
 const [loading,setLoading]=useState(true),[preparing,setPreparing]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[confirmation,setConfirmation]=useState<string|null>(null);
 const available=!!api.preparePublish&&!!api.publishNote;
 const message=(error:unknown)=>error instanceof Error?error.message.replace(/^Error invoking remote method '[^']+': Error: /,''):String(error);
 const refreshList=useCallback(async()=>{if(api.listPublications)setPublications(await api.listPublications());},[api]);
 useEffect(()=>{
  let cancelled=false;
  (async()=>{
   try{
    if(!available)throw Error('웹 공유는 옵시온 데스크톱 앱에서 사용할 수 있습니다.');
    const [list,current]=await Promise.all([api.listPublications!(),target?api.preparePublish!(target):Promise.resolve(null)]);
    if(cancelled)return;
    setPublications(list);setPrepared(current);
    if(current)setOptions({title:current.preview.title,summary:current.preview.summary,theme:current.preview.theme});
   }catch(error){if(!cancelled)setError(message(error));}
   finally{if(!cancelled)setLoading(false);}
  })();
  return()=>{cancelled=true;};
 },[api,target?.vaultPath,target?.path,available]);
 useEffect(()=>{
  if(!options||!target||!available)return;
  let cancelled=false;setPreparing(true);
  const timer=setTimeout(()=>api.preparePublish!(target,options).then(value=>{if(!cancelled){setPrepared(value);setError('');}}).catch(error=>{if(!cancelled)setError(message(error));}).finally(()=>{if(!cancelled)setPreparing(false);}),220);
  return()=>{cancelled=true;clearTimeout(timer);};
 },[options?.title,options?.summary,options?.theme,target?.path,target?.vaultPath,api,available]);
 useEffect(()=>{
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopPropagation();if(!busy)onClose();}};
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 },[busy,onClose]);
 async function publish(){
  if(!prepared||!target||!options)return;
  setBusy(true);setError('');
  try{const result=await api.publishNote!(target,options,prepared.preview.digest);setPrepared(result);await refreshList();onNotice('공개 링크가 준비됐습니다. 링크를 복사해 공유하세요.');}
  catch(error){setError(message(error));try{setPrepared(await api.preparePublish!(target,options));}catch{}}
  finally{setBusy(false);}
 }
 async function unpublish(id:string){
  setBusy(true);setError('');
  try{await api.unpublishNote!(id);setConfirmation(null);await refreshList();if(target&&options)setPrepared(await api.preparePublish!(target,options));onNotice('공유를 중지했습니다. 로컬 노트는 그대로 보관됩니다.');}
  catch(error){setError(message(error));}
  finally{setBusy(false);}
 }
 async function copy(id:string){try{await api.copyPublishLink!(id);onNotice('공유 링크를 복사했습니다.');}catch(error){setError(message(error));}}
 async function open(id:string){try{await api.openPublishedNote!(id);}catch(error){setError(message(error));}}
 const current=prepared?.status;
 return <div className="modal-backdrop publish-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
 <section className="modal publish-dialog" role="dialog" aria-modal="true" aria-label="노트 웹 공유">
  <header className="publish-heading"><div className="publish-heading-icon"><Share2 size={21}/></div><div><h2>웹에 공유</h2><p>선택한 노트를 하나의 웹 페이지로 게시합니다.</p></div><button className="icon-button" aria-label="공유 창 닫기" disabled={busy} onClick={onClose}><X size={21}/></button></header>
  <nav className="publish-tabs"><button className={tab==='current'?'selected':''} disabled={!target||busy} onClick={()=>setTab('current')}><FileText size={14}/>현재 노트</button><button className={tab==='list'?'selected':''} disabled={busy} onClick={()=>setTab('list')}><Globe size={14}/>공유한 문서 <span>{publications.length}</span></button></nav>
  {error&&<div className="publish-error" role="alert">{error}</div>}
  {loading?<div className="publish-loading"><Loader2 className="spin" size={22}/>공유 상태를 확인하고 있습니다…</div>:tab==='current'&&target&&prepared&&options?<div className="publish-columns">
   <aside className="publish-controls">
    <div className={'publish-state '+(current?.isPublished?'published':'')}><span/>{current?.isPublished?(current.pending?'게시 결과 확인 필요':current.hasChanges?'수정 내용이 있습니다':'공유 중'):'아직 공유하지 않은 노트'}</div>
    <label htmlFor="publish-title">공개 제목</label><input id="publish-title" aria-label="공개 제목" maxLength={200} disabled={busy} value={options.title||''} onChange={event=>setOptions({...options,title:event.target.value})}/>
    <label htmlFor="publish-summary">설명 <span>선택</span></label><textarea id="publish-summary" aria-label="공개 설명" rows={3} maxLength={400} disabled={busy} placeholder="문서에 대한 짧은 설명" value={options.summary||''} onChange={event=>setOptions({...options,summary:event.target.value})}/>
    <label htmlFor="publish-theme">페이지 테마</label><select id="publish-theme" aria-label="공유 페이지 테마" disabled={busy} value={options.theme||'light'} onChange={event=>setOptions({...options,theme:event.target.value as 'light'|'dark'})}><option value="light">밝게</option><option value="dark">어둡게</option></select>
    <div className="publish-scope"><LockKeyhole size={16}/><div><strong>이 노트 하나만 게시합니다</strong><p>연결된 노트와 첨부파일은 업로드하지 않습니다. YAML 메타데이터와 숨김 주석은 제외됩니다.</p></div></div>
    <p className="publish-audience">게시하면 링크를 아는 누구나 로그인 없이 읽을 수 있습니다. 오른쪽 미리보기를 확인해 주세요.</p>
    {current?.isPublished&&current.url&&<div className="publish-url-box"><label>공개 링크</label><input aria-label="공개 링크" readOnly value={current.url}/><div><button className="secondary-button" disabled={busy} onClick={()=>void copy(current.id!)}><Copy size={13}/>복사</button><button className="secondary-button" disabled={busy} onClick={()=>void open(current.id!)}><ExternalLink size={13}/>열기</button></div><small>{current.updatedAt&&new Date(current.updatedAt).toLocaleString('ko-KR')} 게시</small></div>}
    {!current?.configured&&<p className="publish-error-inline">이 기기의 공유 서버 연결이 필요합니다.</p>}
    <div className="publish-control-bottom"><button className="primary-button publish-primary" disabled={busy||preparing||!current?.configured||!options.title?.trim()} onClick={()=>void publish()}>{busy?<Loader2 className="spin" size={16}/>:current?.isPublished?<RefreshCw size={15}/>:<Globe size={15}/>}{busy?'처리 중…':current?.isPublished?'공개 페이지 업데이트':'공유 링크 만들기'}</button>
    {current?.isPublished&&<button className="text-button danger" disabled={busy} onClick={()=>setConfirmation(current.id!)}>공유 중지</button>}
    <span className="publish-update-hint">수정한 내용은 업데이트를 눌러야 반영됩니다.</span></div>
   </aside>
   <div className={'publish-preview '+(prepared.preview.theme==='dark'?'dark':'')}><div className="publish-preview-label"><span>웹 페이지 미리보기</span>{preparing?<Loader2 className="spin" size={12}/>:<Check size={13}/>}</div><article><span className="publish-preview-brand">◈ OBSION</span><h1>{prepared.preview.title}</h1>{prepared.preview.summary&&<p className="preview-summary">{prepared.preview.summary}</p>}<div className="publish-preview-rule"/><div className="markdown" onClick={event=>event.preventDefault()} dangerouslySetInnerHTML={{__html:renderPublicMarkdown(prepared.preview.markdown)}}/></article></div>
  </div>:<div className="publication-list">
   {publications.length?publications.map(record=><article key={record.id} className="publication-row"><div className="publication-icon"><Globe size={20}/></div><div className="publication-detail"><h3>{record.title}{record.pending&&<small>게시 결과 확인 필요</small>}</h3><span>{record.url}</span><small>{new Date(record.updatedAt).toLocaleString('ko-KR')} 업데이트</small></div><button className="icon-button" disabled={busy} aria-label={record.title+' 링크 복사'} title="링크 복사" onClick={()=>void copy(record.id)}><Copy size={17}/></button><button className="icon-button" disabled={busy} aria-label={record.title+' 공개 페이지 열기'} title="공개 페이지 열기" onClick={()=>void open(record.id)}><ExternalLink size={17}/></button><button className="icon-button danger" disabled={busy} aria-label={record.title+' 공유 중지'} title="공유 중지" onClick={()=>setConfirmation(record.id)}><Trash2 size={16}/></button></article>):<div className="publish-empty"><Globe size={35} strokeWidth={1}/><h3>아직 공유한 문서가 없습니다</h3><p>노트를 열고 ‘공유 링크 만들기’를 눌러 보세요.</p></div>}
   <p className="publish-list-hint">노트를 삭제하거나 다른 보관함으로 옮겨도 이 목록에서 공개 링크를 관리할 수 있습니다.</p>
  </div>}
  {confirmation&&<div className="publish-confirm"><div><strong>이 문서의 공유를 중지할까요?</strong><p>링크로 더 이상 읽을 수 없게 됩니다. 로컬 노트는 유지되며, 이미 복사된 내용까지 회수하지는 못합니다.</p></div><button className="secondary-button" disabled={busy} onClick={()=>setConfirmation(null)}>취소</button><button className="danger-button" disabled={busy} onClick={()=>void unpublish(confirmation)}>{busy?'처리 중…':'공유 중지'}</button></div>}
 </section></div>;
}
