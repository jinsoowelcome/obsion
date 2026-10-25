import {Marked} from 'marked';
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
const parser=new Marked({gfm:true,renderer:{
 html({text}){return escape(text);},
 link({href,title,tokens}){const label=this.parser.parseInline(tokens);try{const url=new URL(href);if(!['https:','http:','mailto:'].includes(url.protocol))return label;return '<a href="'+escape(url.href)+'"'+(title?' title="'+escape(title)+'"':'')+' target="_blank" rel="noopener noreferrer nofollow">'+label+'</a>';}catch{return label;}},
 image({text}){return '<span class="attachment-note">[이미지: '+escape(text||'첨부파일')+']</span>';}
},extensions:[{name:'wikilink',level:'inline',start(source:string){return source.indexOf('[[');},tokenizer(source:string){const m=/^\[\[([^\]\n]+)\]\]/.exec(source);if(m)return{type:'wikilink',raw:m[0],label:m[1].split('|')[1]||m[1].split('#')[0]};},renderer(token){return '<span class="unpublished-link" title="연결된 노트는 이 공유에 포함되지 않습니다.">'+escape(String(token.label))+'</span>';}}]});
export const renderPublicMarkdown=(markdown:string)=>parser.parse(markdown,{async:false});
