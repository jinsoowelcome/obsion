'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { VaultStore } = require('./vault.cjs');

function documentArguments(args, cwd = process.cwd()) {
  return [...new Set(args.filter(value => typeof value === 'string' && !value.startsWith('-') && /\.md$/i.test(value)).map(value => path.resolve(cwd, value)))];
}

// Opening an individual document does not scan unrelated sibling files.
class DocumentStore extends VaultStore {
  constructor(file) { super(path.dirname(file)); this.document = path.basename(file); this.documentOnly = true; }
  async _snapshot() {
    const files = [];
    if (this.document) {
      const target = await this.checked(this.document, { note: true, mustExist: true });
      files.push(await this.readNote(target.absolute, target.relative));
    }
    return { name: '개별 문서', path: this.root, files, folders: [] };
  }
  async createNote(value, content) { const note = await super.createNote(value, content); this.document = note.path; return note; }
  async renameNote(oldPath, newPath) { await super.renameNote(oldPath, newPath); if (this.document === oldPath) this.document = newPath; }
  async trashNote(value) { await super.trashNote(value); if (this.document === value) this.document = null; }
  async createFolder() { throw new Error('폴더를 관리하려면 보관함을 열어 주세요.'); }
}

async function openMarkdownDocument(file, currentStore) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.md$/i.test(file)) throw new Error('마크다운 파일을 선택해 주세요.');
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('일반 마크다운 파일만 열 수 있습니다.');
  const absolute = await fs.realpath(file);
  if (currentStore && !currentStore.documentOnly) {
    const relative = path.relative(currentStore.root, absolute);
    if (relative && !relative.startsWith('../') && !path.isAbsolute(relative)) {
      const snapshot = await currentStore.snapshot();
      const note = snapshot.files.find(note => note.path.normalize('NFC') === relative.normalize('NFC'));
      if (note) return { store: currentStore, snapshot: { ...snapshot, requestedNote: note.path } };
    }
  }
  const store = new DocumentStore(absolute);
  const snapshot = await store.initialize();
  return { store, snapshot: { ...snapshot, requestedNote: snapshot.files[0].path } };
}

module.exports = { documentArguments, openMarkdownDocument };
