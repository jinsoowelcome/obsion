export interface PublishAttachment {id:string;name:string;size:number;sha256:string}
export interface PublishOptions { title?:string;summary?:string;theme?:'light'|'dark';attachments?:string[] }
export interface PublishPreview {title:string;markdown:string;summary:string;theme:'light'|'dark';digest:string;bytes:number;attachments?:PublishAttachment[]}
export interface Publication {id:string;title:string;url:string;updatedAt:number;sourcePath:string;isPublished:boolean;pending?:boolean;summary:string;theme:'light'|'dark';collaborationEnabled?:boolean}
export interface PublishStatus {configured:boolean;serviceUrl:string;supportsAttachments?:boolean;isPublished:boolean;hasChanges:boolean;pending?:boolean;id?:string;url?:string;title?:string;updatedAt?:number;summary?:string;theme?:'light'|'dark';collaborationEnabled?:boolean}
export interface PublishPrepared {preview:PublishPreview;status:PublishStatus}
export interface PublishTarget {vaultPath:string;path:string}
