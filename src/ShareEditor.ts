import {EditorState,ChangeSet} from '@codemirror/state';
import {EditorView,keymap} from '@codemirror/view';
import {history,defaultKeymap,historyKeymap} from '@codemirror/commands';
import {markdown} from '@codemirror/lang-markdown';
import {collab,getSyncedVersion,sendableUpdates,receiveUpdates} from '@codemirror/collab';
import {renderPublicMarkdown} from '../publish-service/lib/render';
const element=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const form=element<HTMLFormElement>('edit-login'),message=element('edit-status'),container=element('shared-editor'),preview=element('edit-preview'),people=element('edit-people');
const page=/\/p\/([a-f0-9]{32})\/edit/.exec(location.pathname)?.[1];
let view:EditorView|null=null,session='',epoch='',inFlight=false,halted=false,timer:ReturnType<typeof setTimeout>|undefined;
function status(text:string,error=false){message.textContent=text;message.classList.toggle('error',error);}
async function request(action:string,input:unknown){
 const response=await fetch('/api/pages/'+page+'/collab/'+action,{method:'POST',headers:{'Content-Type':'application/json',...(session?{'X-Obsion-Session':session}:{})},body:JSON.stringify(input),signal:AbortSignal.timeout(35000)});
 const value=await response.json();if(!response.ok)throw Object.assign(Error(value.error||'원본에 연결하지 못했습니다.'),{status:response.status});return value;
}
async function synchronize(){
 if(!view||inFlight||halted)return;inFlight=true;
 try{
  const updates=sendableUpdates(view.state)?.slice(0,100);
  const result=await request('updates',{epoch,version:getSyncedVersion(view.state),...(updates?.length?{updates:updates.map(update=>({changes:update.changes.toJSON()}))}:{})});
  if(result.epoch!==epoch)throw Object.assign(Error('편집 세션이 바뀌었습니다. 입력 내용을 복사한 뒤 다시 참여해 주세요.'),{status:409});
  if(result.updates.length)view.dispatch(receiveUpdates(view.state,result.updates.map((update:{changes:unknown;clientID:string})=>({clientID:update.clientID,changes:ChangeSet.fromJSON(update.changes)}))));
  people.textContent='참여자: '+result.participants.map((participant:{name:string})=>participant.name).join(', ');
  status(sendableUpdates(view.state)?.length?'변경 내용을 저장하고 있습니다…':'원본 노트에 저장됨 · '+new Date().toLocaleTimeString('ko-KR'));
  if(sendableUpdates(view.state)?.length){clearTimeout(timer);timer=setTimeout(()=>void synchronize(),350);}
 }catch(error){const failure=error as Error&{status?:number};if([401,403,409].includes(failure.status||0)){halted=true;element('edit-rejoin').hidden=false;}status(failure.message+' 입력 내용은 편집기에 유지됩니다.',true);}
 finally{inFlight=false;}
}
form.addEventListener('submit',async event=>{
 event.preventDefault();if(inFlight)return;
 if(view&&sendableUpdates(view.state)?.length&&!confirm('전송되지 않은 입력이 있습니다. 입력 내용 복사 버튼으로 보관했나요? 계속하면 현재 서버 내용으로 다시 엽니다.'))return;
 const button=element<HTMLButtonElement>('edit-join');button.disabled=true;status('편집 암호와 원본 연결을 확인하고 있습니다…');
 try{
  const pin=element<HTMLInputElement>('edit-pin'),result=await request('login',{name:element<HTMLInputElement>('edit-name').value,pin:pin.value});pin.value='';
  session=result.session;epoch=result.epoch;halted=false;view?.destroy();container.replaceChildren();
  view=new EditorView({parent:container,state:EditorState.create({doc:result.content,extensions:[markdown(),history(),keymap.of([...defaultKeymap,...historyKeymap]),EditorView.lineWrapping,collab({startVersion:result.version,clientID:result.clientID}),EditorView.updateListener.of(update=>{if(update.docChanged){if(!preview.hidden)preview.innerHTML=renderPublicMarkdown(update.state.doc.toString());clearTimeout(timer);timer=setTimeout(()=>void synchronize(),350);}}),EditorView.theme({'&':{minHeight:'55vh',fontSize:'16px'},'.cm-content':{padding:'18px',fontFamily:'ui-monospace, monospace',lineHeight:'1.8'},'.cm-scroller':{overflow:'auto'},'&.cm-focused':{outline:'none'}})]})});
  form.hidden=true;element('edit-workspace').hidden=false;element('edit-rejoin').hidden=true;preview.hidden=true;container.hidden=false;status('편집에 참여했습니다. 수정 내용은 자동 저장됩니다.');await synchronize();
 }catch(error){status((error as Error).message,true);element<HTMLInputElement>('edit-pin').value='';}finally{button.disabled=false;}
});
element('edit-toggle-preview').addEventListener('click',()=>{if(!view)return;preview.hidden=!preview.hidden;container.hidden=!preview.hidden;if(!preview.hidden)preview.innerHTML=renderPublicMarkdown(view.state.doc.toString());element('edit-toggle-preview').textContent=preview.hidden?'미리보기':'편집기로 돌아가기';});
element('edit-copy').addEventListener('click',()=>{if(view)navigator.clipboard.writeText(view.state.doc.toString()).then(()=>status('현재 입력 내용을 복사했습니다.')).catch(()=>status('복사하지 못했습니다. 편집기에서 전체 선택 후 복사해 주세요.',true));});
element('edit-rejoin').addEventListener('click',()=>{form.hidden=false;element<HTMLInputElement>('edit-pin').focus();});
setInterval(()=>{if(document.visibilityState==='visible')void synchronize();},2000);
window.addEventListener('beforeunload',event=>{if(view&&sendableUpdates(view.state)?.length){event.preventDefault();event.returnValue='';}});
