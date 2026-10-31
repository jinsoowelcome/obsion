'use strict';
const crypto = require('node:crypto');
const MAX_PUBLIC_BYTES = 200 * 1024;
function publicMarkdown(source) {
 let text=String(source).replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
 if(text.startsWith('---\n')){
  const end=text.indexOf('\n---',4);
  if(end<0 || (text[end+4] && text[end+4]!=='\n')) throw Error('YAML 메타데이터의 닫는 ---를 확인해 주세요.');
  if(/^\s*publish\s*:\s*false\s*(?:#.*)?$/im.test(text.slice(4,end)))throw Error('이 노트에는 publish: false가 설정돼 있습니다. 공유하려면 이 설정을 먼저 변경해 주세요.');
  text=text.slice(end+4).replace(/^\n/,'');
 }
 let fence=null,comment=false,htmlComment=false;const output=[];
 for(const line of text.split('\n')){
  const boundary=/^\s{0,3}(\x60{3,}|~{3,})/.exec(line);
  if(fence){output.push(line);if(boundary&&boundary[1][0]===fence[0]&&boundary[1].length>=fence.length)fence=null;continue;}
  if(!comment&&!htmlComment&&boundary){fence=boundary[1];output.push(line);continue;}
  let visible='',index=0,inline='';
  while(index<line.length){
   if(htmlComment){if(line.slice(index,index+3)==='-->'){htmlComment=false;index+=3;}else index++;continue;}
   if(!comment&&!inline&&line.slice(index,index+4)==='<!--'){htmlComment=true;index+=4;continue;}
   if(!comment&&line[index]==='\x60'){const run=/^\x60+/.exec(line.slice(index))[0];if(!inline)inline=run;else if(inline===run)inline='';visible+=run;index+=run.length;continue;}
   if(!inline&&line.slice(index,index+2)==='%%'){comment=!comment;index+=2;continue;}
   if(!comment)visible+=line[index];index++;
  }
  output.push(visible);
 }
 if(comment)throw Error('숨김 주석의 닫는 %%를 확인해 주세요.');
 if(htmlComment)throw Error('HTML 주석의 닫는 -->를 확인해 주세요.');
 return output.join('\n').trim();
}
function preparePublicNote(note,options={}){
 const title=String(options.title||note.path.split('/').pop().replace(/\.md$/i,'')).trim();
 if(!title||title.length>200)throw Error('공개 제목은 1~200자로 입력해 주세요.');
 const markdown=publicMarkdown(note.content);
 if(Buffer.byteLength(markdown,'utf8')>MAX_PUBLIC_BYTES)throw Error('공유 본문은 200KB까지 지원합니다.');
 const summary=String(options.summary||'').trim().slice(0,400),theme=options.theme==='dark'?'dark':'light';
 const payload={title,markdown,summary,theme};
 if(options.attachments?.length)payload.attachments=options.attachments;
 return {...payload,digest:crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'),bytes:Buffer.byteLength(markdown,'utf8')};
}
module.exports={publicMarkdown,preparePublicNote,MAX_PUBLIC_BYTES};
