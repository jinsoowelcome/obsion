'use strict';

const fs = require('node:fs/promises');
const nativeFs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_NOTE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 5000;
const fold = value => value.normalize('NFC').toLocaleLowerCase('en-US');

class VaultStore {
  constructor(root) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('보관함의 절대 경로가 필요합니다.');
    this.root = path.resolve(root);
    this.queue = Promise.resolve();
  }

  serial(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  async drain() { await this.queue; }

  initialize({ create = false, seed = false } = {}) {
    return this.serial(async () => {
      let created = false;
      try { await fs.lstat(this.root); }
      catch (error) {
        if (error.code !== 'ENOENT' || !create) throw error;
        await fs.mkdir(this.root, { recursive: true });
        created = true;
      }
      const rootInfo = await fs.lstat(this.root);
      if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('실제 폴더를 보관함으로 선택해 주세요.');
      this.root = await fs.realpath(this.root);
      if (created && seed) {
        await this._createNote('환영합니다!.md', '새로운 **보관함**입니다.\n\n생각을 적고 [[링크를 만들거나]] 다른 노트와 연결해 보세요.\n\n이 공간은 마크다운 파일로 저장됩니다. 원하는 순간에 새 노트부터 시작하세요.\n');
        await this._createNote('링크를 만들거나.md', '# 노트 연결하기\n\n`[[노트 이름]]`을 입력하면 노트 사이에 링크를 만들 수 있습니다.\n\n[[환영합니다!]] 노트에서 연결을 시작해 보세요.\n');
      }
      return this._snapshot();
    });
  }

  relative(value, note = false) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 2048 || value.includes('\0') || value.includes('\\') || path.isAbsolute(value)) throw new Error('올바른 상대 경로를 입력해 주세요.');
    const parts = value.split('/');
    if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.') || part.trim() !== part || part.includes(':') || /[\r\n]/.test(part))) throw new Error('숨김 경로나 상위 폴더는 사용할 수 없습니다.');
    if (note && !/\.md$/i.test(parts.at(-1))) throw new Error('노트는 .md 확장자로 저장해 주세요.');
    return parts.join('/');
  }

  async checked(value, { note = false, mustExist = false, allowMissingLeaf = false } = {}) {
    const relative = this.relative(value, note);
    const parts = relative.split('/');
    let current = this.root;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const entries = await fs.readdir(current);
      const foldedMatch = entries.find(entry => fold(entry) === fold(part));
      if (foldedMatch && foldedMatch !== part) throw new Error(`이름이 겹치는 파일 또는 폴더가 있습니다: ${foldedMatch}`);
      current = path.join(current, part);
      let info;
      try { info = await fs.lstat(current); }
      catch (error) {
        if (error.code === 'ENOENT' && index === parts.length - 1 && allowMissingLeaf && !mustExist) return { absolute: current, relative, info: null };
        if (error.code === 'ENOENT') {
          const missing = new Error(`파일 또는 폴더를 찾지 못했습니다: ${parts.slice(0, index + 1).join('/')}`, { cause: error });
          missing.code = 'ENOENT';
          throw missing;
        }
        throw error;
      }
      if (info.isSymbolicLink()) throw new Error('심볼릭 링크는 보관함에서 열 수 없습니다.');
      if (index < parts.length - 1 && !info.isDirectory()) throw new Error('상위 경로가 폴더가 아닙니다.');
      if (index === parts.length - 1) return { absolute: current, relative, info };
    }
    throw new Error('올바르지 않은 경로입니다.');
  }

  validateContent(content) {
    if (typeof content !== 'string') throw new Error('노트 내용은 문자열이어야 합니다.');
    if (Buffer.byteLength(content, 'utf8') > MAX_NOTE_BYTES) throw new Error('노트 하나는 8MB까지 저장할 수 있습니다.');
  }

  async readNote(absolute, relative) {
    const handle = await fs.open(absolute, nativeFs.constants.O_RDONLY | nativeFs.constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new Error('일반 마크다운 파일만 열 수 있습니다.');
      if (info.size > MAX_NOTE_BYTES) throw new Error(`8MB를 넘는 노트는 열 수 없습니다: ${relative}`);
      return { path: relative, content: await handle.readFile('utf8'), modified: info.mtimeMs };
    } finally { await handle.close(); }
  }

  async _snapshot() {
    const files = [];
    const folders = [];
    let totalBytes = 0;
    let visited = 0;
    const visit = async (directory, prefix = '', depth = 0) => {
      if (depth > 64) throw new Error('폴더 깊이는 64단계까지 지원합니다.');
      const entries = await fs.readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        if (++visited > 20000) throw new Error('이 보관함에는 너무 많은 항목이 있습니다. 20,000개 이하의 폴더를 선택해 주세요.');
        const relative = prefix + entry.name;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          folders.push(relative);
          await visit(absolute, `${relative}/`, depth + 1);
        } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
          if (files.length >= MAX_FILES) throw new Error('이 복제본은 보관함당 5,000개의 노트를 지원합니다.');
          const note = await this.readNote(absolute, relative);
          totalBytes += Buffer.byteLength(note.content, 'utf8');
          if (totalBytes > MAX_TOTAL_BYTES) throw new Error('열린 보관함의 노트 용량은 총 64MB까지 지원합니다.');
          files.push(note);
        }
      }
    };
    await visit(this.root);
    return { name: path.basename(this.root), path: this.root, files, folders };
  }

  snapshot() { return this.serial(() => this._snapshot()); }

  async atomicWrite(absolute, content, create) {
    const temporary = path.join(path.dirname(absolute), `.replica-${crypto.randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(content, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      if (create) {
        // A hard-link publishes a complete new file without replacing an existing one.
        await fs.link(temporary, absolute);
        await fs.unlink(temporary);
      } else {
        await fs.rename(temporary, absolute);
      }
    } finally {
      if (handle) await handle.close();
      await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }

  async _createNote(value, content) {
    this.validateContent(content);
    // Validate the whole user path before making even its first parent folder.
    const relative = this.relative(value, true);
    const parts = relative.split('/');
    const missingParents = [];
    for (let index = 1; index < parts.length; index += 1) {
      const parent = parts.slice(0, index).join('/');
      if (missingParents.length) { missingParents.push(parent); continue; }
      const checkedParent = await this.checked(parent, { allowMissingLeaf: true });
      if (!checkedParent.info) missingParents.push(parent);
      else if (!checkedParent.info.isDirectory()) throw new Error('상위 경로가 폴더가 아닙니다.');
    }
    // When all parents already exist, reject duplicate leaves before mutations.
    if (!missingParents.length) {
      const existing = await this.checked(relative, { note: true, allowMissingLeaf: true });
      if (existing.info) throw new Error('같은 이름의 노트가 이미 있습니다.');
    }
    const createdParents = [];
    try {
      for (const parent of missingParents) {
        const checkedParent = await this.checked(parent, { allowMissingLeaf: true });
        if (checkedParent.info && !checkedParent.info.isDirectory()) throw new Error('상위 경로가 폴더가 아닙니다.');
        if (!checkedParent.info) {
          await fs.mkdir(checkedParent.absolute);
          createdParents.push(checkedParent.absolute);
        }
      }
      const target = await this.checked(relative, { note: true, allowMissingLeaf: true });
      if (target.info) throw new Error('같은 이름의 노트가 이미 있습니다.');
      await this.atomicWrite(target.absolute, content, true);
      return this.readNote(target.absolute, target.relative);
    } catch (error) {
      // Remove only newly created empty folders if publishing the note failed.
      for (const parent of createdParents.reverse()) await fs.rmdir(parent).catch(() => {});
      throw error;
    }
  }

  createNote(value, content) { return this.serial(() => this._createNote(value, content)); }

  writeNote(value, content) {
    return this.serial(async () => {
      this.validateContent(content);
      const target = await this.checked(value, { note: true, mustExist: true });
      if (!target.info.isFile()) throw new Error('저장할 노트 파일을 찾지 못했습니다.');
      await this.atomicWrite(target.absolute, content, false);
      return this.readNote(target.absolute, target.relative);
    });
  }

  renameNote(oldValue, newValue) {
    return this.serial(async () => {
      if (oldValue === newValue) return;
      const source = await this.checked(oldValue, { note: true, mustExist: true });
      const target = await this.checked(newValue, { note: true, allowMissingLeaf: true });
      if (!source.info.isFile()) throw new Error('이름을 바꿀 노트를 찾지 못했습니다.');
      if (target.info) throw new Error('같은 이름의 노트가 이미 있습니다.');
      // Link then unlink refuses collisions instead of rename() replacing data.
      await fs.link(source.absolute, target.absolute);
      try { await fs.unlink(source.absolute); }
      catch (error) { await fs.unlink(target.absolute); throw error; }
    });
  }

  trashNote(value) {
    return this.serial(async () => {
      const source = await this.checked(value, { note: true, mustExist: true });
      if (!source.info.isFile()) throw new Error('삭제할 노트를 찾지 못했습니다.');
      const trash = path.join(this.root, '.trash');
      await fs.mkdir(trash).catch(error => { if (error.code !== 'EEXIST') throw error; });
      const trashInfo = await fs.lstat(trash);
      if (!trashInfo.isDirectory() || trashInfo.isSymbolicLink()) throw new Error('보관함 휴지통 폴더를 사용할 수 없습니다.');
      const name = `${Date.now()}-${crypto.randomUUID()}-${path.basename(source.relative)}`;
      await fs.link(source.absolute, path.join(trash, name));
      await fs.unlink(source.absolute);
    });
  }

  createFolder(value) {
    return this.serial(async () => {
      const parts = this.relative(value).split('/');
      for (let index = 0; index < parts.length; index += 1) {
        const target = await this.checked(parts.slice(0, index + 1).join('/'), { allowMissingLeaf: true });
        if (target.info && !target.info.isDirectory()) throw new Error('같은 이름의 파일이 있습니다.');
        if (!target.info) await fs.mkdir(target.absolute);
        else if (index === parts.length - 1) throw new Error('같은 이름의 폴더가 이미 있습니다.');
      }
    });
  }
}

module.exports = { VaultStore, MAX_NOTE_BYTES };
