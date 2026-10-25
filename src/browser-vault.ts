import type { NoteFile, VaultAPI, VaultSnapshot } from './types';
const key = 'rea-obsidian-browser-vault-v1';
const welcome = '새로운 *보관함*입니다.\n\n내용을 한번 적어보세요. [[링크를 만들거나]], 마크다운으로 생각을 기록해 보세요.\n\n준비가 되면 나만의 노트를 만들고 서로 연결해 보세요.\n';
function initial(): VaultSnapshot {
  try { const saved = localStorage.getItem(key); if (saved) return JSON.parse(saved); } catch { /* Fresh browser vault */ }
  return { name: '옵시온 보관함', path: '브라우저 저장소', folders: [], files: [
    { path: '환영합니다!.md', content: welcome, modified: Date.now() },
    { path: '링크를 만들거나.md', content: '노트에서 `[[노트 이름]]`을 입력하면 서로 연결할 수 있습니다.\n\n[[환영합니다!]]로 돌아가 보세요.\n', modified: Date.now() },
  ] };
}
let data = initial();
function save() { localStorage.setItem(key, JSON.stringify(data)); }
function valid(path: string) { if (!path || path.startsWith('/') || path.split('/').some(p => !p || p === '..' || p === '.' || p.startsWith('.')) || /[\\\x00-\x1f]/.test(path)) throw Error('올바른 이름을 입력하세요.'); }
export const browserVault: VaultAPI = {
  async initialize() { save(); return structuredClone(data); },
  async snapshot() { return structuredClone(data); },
  async createNote(path, content) {
    valid(path); if (data.files.some(f => f.path.toLowerCase() === path.toLowerCase())) throw Error('같은 이름의 노트가 있습니다.');
    const note: NoteFile = { path, content, modified: Date.now() }; data.files.push(note); save(); return note;
  },
  async writeNote(path, content) { const note = data.files.find(f => f.path === path); if (!note) throw Error('노트를 찾을 수 없습니다.'); Object.assign(note, { content, modified: Date.now() }); save(); return structuredClone(note); },
  async renameNote(oldPath, newPath) { valid(newPath); if (data.files.some(f => f.path !== oldPath && f.path.toLowerCase() === newPath.toLowerCase())) throw Error('같은 이름의 노트가 있습니다.'); const note = data.files.find(f => f.path === oldPath); if (!note) throw Error('노트를 찾을 수 없습니다.'); note.path = newPath; save(); },
  async trashNote(path) { const note = data.files.find(f => f.path === path); if (note) { const trash = JSON.parse(localStorage.getItem(key + '-trash') || '[]'); trash.push(note); localStorage.setItem(key + '-trash', JSON.stringify(trash)); } data.files = data.files.filter(f => f.path !== path); save(); },
  async createFolder(path) { valid(path); if (data.folders.includes(path)) throw Error('같은 이름의 폴더가 있습니다.'); data.folders.push(path); save(); },
  async openVault() { throw Error('폴더 보관함은 옵시온 데스크톱 앱에서 열 수 있습니다.'); },
  async createVault() { throw Error('새 보관함은 옵시온 데스크톱 앱에서 만들 수 있습니다.'); },
  async revealVault() { throw Error('브라우저에서는 내부 저장소를 사용합니다. 데스크톱 앱에서 파일 폴더를 열 수 있습니다.'); },
  onMenuAction() { return () => {}; },
};
