import type {PublishOptions,PublishPrepared,PublishTarget,Publication} from './publish-types';
export interface NoteFile { path: string; content: string; modified: number }
export interface VaultSnapshot { name: string; path: string; files: NoteFile[]; folders: string[]; requestedNote?: string }
export interface VaultAPI {
  initialize(): Promise<VaultSnapshot>;
  snapshot(): Promise<VaultSnapshot>;
  createNote(path: string, content: string): Promise<NoteFile>;
  writeNote(path: string, content: string): Promise<NoteFile>;
  renameNote(oldPath: string, newPath: string): Promise<void>;
  trashNote(path: string): Promise<void>;
  createFolder(path: string): Promise<void>;
  openVault(): Promise<VaultSnapshot | null>;
  createVault(): Promise<VaultSnapshot | null>;
  revealVault(): Promise<void>;
  onMenuAction(callback: (action: string) => void): () => void;
  onBeforeClose?(callback: () => void): () => void;
  readyToClose?(): Promise<void>;
  rendererReady?(): Promise<void>;
  openDocument?(path: string): Promise<VaultSnapshot>;
  onOpenDocument?(callback: (path: string) => void): () => void;
  preparePublish?(target:PublishTarget,options?:PublishOptions):Promise<PublishPrepared>;
  publishNote?(target:PublishTarget,options:PublishOptions,digest:string):Promise<PublishPrepared>;
  listPublications?():Promise<Publication[]>;
  unpublishNote?(id:string):Promise<{unpublished:boolean}>;
  copyPublishLink?(id:string):Promise<void>;
  openPublishedNote?(id:string):Promise<void>;
}
declare global { interface Window { vault?: VaultAPI } }
