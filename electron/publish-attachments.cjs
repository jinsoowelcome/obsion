'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const MAX_FILE_BYTES=5*1024*1024,MAX_TOTAL_BYTES=10*1024*1024,MAX_FILES=10;
class AttachmentSelection{
 constructor(){this.files=new Map();}
 async add(paths){
  if(!Array.isArray(paths)||paths.length>MAX_FILES)throw Error('첨부파일은 최대 10개까지 선택할 수 있습니다.');
  const added=[];
  for(const file of paths){
   const handle=await fs.open(file,'r');let bytes;
   try{const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX_FILE_BYTES)throw Error('첨부파일은 일반 파일만 가능하며 파일당 5MB까지 지원합니다.');bytes=await handle.readFile();if(bytes.length>MAX_FILE_BYTES)throw Error('첨부파일은 파일당 5MB까지 지원합니다.');}finally{await handle.close();}
   const name=path.basename(file).normalize('NFC');if(!name||name.length>200||/[\x00-\x1f\x7f\\/]/.test(name))throw Error('첨부파일 이름을 확인해 주세요.');
   const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
   const id=crypto.createHash('sha256').update(name+'\0'+sha256).digest('hex');
   added.push({id,name,size:bytes.length,sha256,bytes});
  }
  const next=new Map(this.files);for(const file of added)next.set(file.id,file);
  if([...next.values()].reduce((sum,file)=>sum+file.size,0)>MAX_TOTAL_BYTES)throw Error('첨부파일은 합계 10MB까지 지원합니다. 사용하지 않는 첨부를 제거해 주세요.');
  this.files=next;return added.map(({bytes,...file})=>file);
 }
 resolve(ids,previous=[]){
  const selected=ids===undefined?previous.map(file=>file.id):ids;
  if(!Array.isArray(selected)||selected.length>MAX_FILES||new Set(selected).size!==selected.length)throw Error('첨부파일은 중복 없이 최대 10개까지 지원합니다.');
  const result=selected.map(id=>{const file=this.files.get(id)||previous.find(file=>file.id===id);if(!file)throw Error('첨부파일을 다시 선택해 주세요.');const {bytes,...metadata}=file;return metadata;});
  if(result.reduce((sum,file)=>sum+file.size,0)>MAX_TOTAL_BYTES)throw Error('첨부파일은 합계 10MB까지 지원합니다.');return result;
 }
 remove(id){this.files.delete(id);}
 clear(){this.files.clear();}
}
module.exports={AttachmentSelection,MAX_FILE_BYTES,MAX_TOTAL_BYTES,MAX_FILES};
