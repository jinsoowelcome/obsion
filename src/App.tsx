import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { ArrowDownAZ, ArrowLeft, ArrowRight, BookOpen, Bookmark, CalendarDays, Check, ChevronDown, ChevronRight, ChevronsUpDown, CircleHelp, Command, FilePlus2, FileSearch, FileText, Folder, FolderOpen, FolderPlus, Link2, List, MoreHorizontal, Network, PanelLeft, PanelRight, Pencil, Plus, Search, Settings, Share2, SquarePen, Terminal, Trash2, X } from 'lucide-react';
import { browserVault } from './browser-vault';
import { canonical, countWords, pathWithoutExtension, resolveLink, titleOf, wikiLinks } from './lib';
import { MarkdownEditor } from './MarkdownEditor';
import type { EditorMode } from './MarkdownEditor';
import Graph from './Graph';
import PublishDialog from './PublishDialog';
import type { PublishTarget } from './publish-types';
import type { VaultSnapshot } from './types';
import { DraftWriter } from './draft-writer';

const api = window.vault || browserVault;
type Modal = 'new-note' | 'new-folder' | 'rename' | 'quick' | 'command' | 'settings' | 'vault' | 'help' | 'trash' | null;
type Preferences = { theme: 'light' | 'dark' | 'system'; fontSize: number; readableWidth: boolean; lineNumbers: boolean };
const loadJSON = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
function IconButton({ label, children, onClick, active = false, disabled = false }: { label: string; children: ReactNode; onClick?(): void; active?: boolean; disabled?: boolean }) { return <button type="button" title={label} aria-label={label} className={`icon-button${active ? ' active' : ''}`} disabled={disabled} onClick={onClick}>{children}</button>; }

export default function App() {
  const [vault, setVault] = useState<VaultSnapshot | null>(null);
  const vaultRef = useRef<VaultSnapshot | null>(null);
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [sidebar, setSidebar] = useState<'files' | 'search' | 'bookmarks'>('files');
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(loadJSON('rea-sidebar-width', 300));
  const [graphVisible, setGraphVisible] = useState(loadJSON('rea-show-graph', true));
  const [graphWidth, setGraphWidth] = useState(48);
  const [backlinksVisible, setBacklinksVisible] = useState(false);
  const [outlineVisible, setOutlineVisible] = useState(false);
  const [mode, setMode] = useState<EditorMode>(loadJSON('rea-editor-mode', 'live'));
  const [preferences, setPreferences] = useState<Preferences>(loadJSON('rea-preferences', { theme: 'light', fontSize: 16, readableWidth: true, lineNumbers: false }));
  const [systemDark, setSystemDark] = useState(matchMedia('(prefers-color-scheme: dark)').matches);
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedFolder, setSelectedFolder] = useState('');
  const [sortDescending, setSortDescending] = useState(false);
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [publishOpen,setPublishOpen]=useState(false);
  const [publishTarget,setPublishTarget]=useState<PublishTarget|null>(null);
  const [dialogValue, setDialogValue] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [dialogBusy, setDialogBusy] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [settingsSection, setSettingsSection] = useState('외형');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [noteMenu, setNoteMenu] = useState(false);
  const [title, setTitle] = useState('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved');
  const [toast, setToast] = useState('');
  const pending = useRef(new DraftWriter((path, content) => api.writeNote(path, content)));
  const [transitioning, setTransitioning] = useState(false);
  const transitionRef = useRef(false);
  const transitionTask = useRef(Promise.resolve());
  const documentQueue = useRef(Promise.resolve());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dark = preferences.theme === 'dark' || (preferences.theme === 'system' && systemDark);
  const notes = vault?.files || [];
  const note = notes.find(file => file.path === active);
  const showToast = useCallback((message: string) => { setToast(message); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 4500); }, []);
  const handleError = useCallback((error: unknown) => showToast(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error)), [showToast]);
  const updateVault = useCallback((next: VaultSnapshot) => { vaultRef.current = next; setVault(next); }, []);
  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current);
    if (pending.current.size) setSaveStatus('saving');
    try { await pending.current.flush(); setSaveStatus(pending.current.size ? 'pending' : 'saved'); }
    catch (error) { setSaveStatus('error'); throw error; }
  }, []);
  const runTransition = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    if (transitionRef.current) throw Error('이전 작업을 마친 뒤 다시 시도해 주세요.');
    transitionRef.current = true; setTransitioning(true);
    const task = (async () => { await flush(); return operation(); })();
    transitionTask.current = task.then(() => {}, () => {});
    try { return await task; }
    finally { transitionRef.current = false; setTransitioning(false); }
  }, [flush]);
  const flushRef = useRef(flush); flushRef.current = flush;
  const openNote = useCallback((path: string, record = true) => {
    setActive(path); setTabs(current => current.includes(path) ? current : [...current, path]);
    if (record) { setHistory(current => { const next = current.slice(0, historyIndex + 1); if (next.at(-1) !== path) next.push(path); setHistoryIndex(next.length - 1); return next; }); }
    setNoteMenu(false); setContextMenu(null);
  }, [historyIndex]);
  const adoptVault = useCallback((snapshot: VaultSnapshot) => {
    updateVault(snapshot); setPublishOpen(false);
    const workspace = loadJSON<{ tabs: string[]; active: string }>(`rea-workspace:${snapshot.path}`, { tabs: ['환영합니다!.md'], active: '환영합니다!.md' });
    const open = workspace.tabs.filter(path => snapshot.files.some(note => note.path === path));
    const preferred = snapshot.requestedNote || workspace.active;
    const chosen = snapshot.files.some(note => note.path === preferred) ? preferred : open[0] || snapshot.files[0]?.path || '';
    if (chosen && !open.includes(chosen)) open.push(chosen);
    setTabs(open); setActive(chosen); setHistory(chosen ? [chosen] : []); setHistoryIndex(chosen ? 0 : -1);
    setBookmarks(loadJSON(`rea-bookmarks:${snapshot.path}`, [])); setSelectedFolder(''); setCollapsed(new Set()); setSaveStatus('saved');
  }, [updateVault]);
  useEffect(() => { let mounted = true; api.initialize().then(snapshot => { if (mounted) adoptVault(snapshot); }).catch(handleError); return () => { mounted = false; }; }, [adoptVault, handleError]);
  useEffect(() => api.onOpenDocument?.(file => {
    documentQueue.current = documentQueue.current.then(async () => {
      await transitionTask.current;
      await runTransition(async () => { const snapshot = await api.openDocument!(file); adoptVault(snapshot); setMode('reading'); setModal(null); });
    }).catch(handleError);
  }), [runTransition, adoptVault, handleError]);
  useEffect(() => { if (vault) api.rendererReady?.().catch(handleError); }, [!!vault, handleError]);
  useEffect(() => { document.title = active ? `${titleOf(active)} - 옵시온` : '옵시온'; }, [active]);
  useEffect(() => { setTitle(active ? titleOf(active) : ''); }, [active]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.setProperty('--font-size', `${preferences.fontSize}px`);
    localStorage.setItem('rea-preferences', JSON.stringify(preferences));
  }, [dark, preferences]);
  useEffect(() => { const media = matchMedia('(prefers-color-scheme: dark)'); const listener = () => setSystemDark(media.matches); media.addEventListener('change', listener); return () => media.removeEventListener('change', listener); }, []);
  useEffect(() => { localStorage.setItem('rea-editor-mode', JSON.stringify(mode)); }, [mode]);
  useEffect(() => { localStorage.setItem('rea-sidebar-width', JSON.stringify(sidebarWidth)); }, [sidebarWidth]);
  useEffect(() => { localStorage.setItem('rea-show-graph', JSON.stringify(graphVisible)); }, [graphVisible]);
  useEffect(() => { if (vault) { localStorage.setItem(`rea-workspace:${vault.path}`, JSON.stringify({ tabs, active })); localStorage.setItem(`rea-bookmarks:${vault.path}`, JSON.stringify(bookmarks)); } }, [tabs, active, bookmarks, vault?.path]);
  useEffect(() => api.onBeforeClose?.(() => { transitionTask.current.then(() => flushRef.current()).then(() => api.readyToClose?.()).catch(handleError); }), [handleError]);
  useEffect(() => { const close = () => setContextMenu(null); window.addEventListener('click', close); return () => window.removeEventListener('click', close); }, []);
  const changeContent = useCallback((content: string) => {
    const current = vaultRef.current; if (!current || !active || transitionRef.current) return;
    updateVault({ ...current, files: current.files.map(file => file.path === active ? { ...file, content, modified: Date.now() } : file) });
    pending.current.set(active, content); setSaveStatus('pending'); clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { flush().catch(handleError); }, 350);
  }, [active, updateVault, flush, handleError]);
  function showDialog(kind: Modal, initial = '') { setModal(kind); setDialogValue(initial); setDialogError(''); setPaletteQuery(''); setPaletteIndex(0); setContextMenu(null); setNoteMenu(false); }
  async function openSharing() { const target=vault&&active?{vaultPath:vault.path,path:active}:null;try{await flush();setPublishTarget(target);setPublishOpen(true);setNoteMenu(false);setModal(null);}catch(error){handleError(error);} }
  function newNoteDialog(target = '') { showDialog('new-note', target || (selectedFolder ? selectedFolder + '/제목 없음' : '제목 없음')); }
  const followLink = useCallback((target: string) => {
    const current = vaultRef.current; if (!current) return;
    const clean = target.split('#')[0].trim(); const resolved = resolveLink(clean, active, current.files);
    if (resolved) openNote(resolved); else { setDialogValue(clean); setDialogError(''); setModal('new-note'); }
  }, [active, openNote]);
  async function refresh() { return runTransition(async () => { const next = await api.snapshot(); updateVault(next); return next; }); }
  async function createNote(name: string, content = '') {
    return runTransition(async () => {
      const relative = name.trim().replace(/\.md$/i, '') + '.md';
      const file = await api.createNote(relative, content);
      const snapshot = await api.snapshot(); updateVault(snapshot); openNote(file.path); setMode('live');
      return file;
    });
  }
  async function dailyNote() {
    try {
      const date = new Date(); const name = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const current = notes.find(note => note.path === name + '.md');
      if (current) openNote(current.path); else await createNote(name, `## 오늘의 기록\n\n\n## 할 일\n\n- [ ] \n`);
    } catch (error) { handleError(error); }
  }
  async function renameNote(newTitle: string) {
    if (!note) return;
    const name = newTitle.trim().replace(/\.md$/i, '');
    if (!name) { setTitle(titleOf(active)); throw Error('노트 이름을 입력하세요.'); }
    const folder = active.includes('/') ? active.slice(0, active.lastIndexOf('/') + 1) : '';
    const nextPath = folder + name + '.md';
    if (nextPath === active) return;
    await runTransition(async () => {
      const oldPath = active; await api.renameNote(oldPath, nextPath);
      const snapshot = await api.snapshot(); updateVault(snapshot); setTabs(current => current.map(path => path === oldPath ? nextPath : path)); setBookmarks(current => current.map(path => path === oldPath ? nextPath : path)); setActive(nextPath);
      setHistory(current => current.map(path => path === oldPath ? nextPath : path));
    });
  }
  function closeTab(path: string) {
    flush().catch(handleError); const remaining = tabs.filter(item => item !== path); setTabs(remaining);
    if (active === path) setActive(remaining[Math.max(0, tabs.indexOf(path) - 1)] || '');
  }
  function toggleBookmark(path = active) { if (path) setBookmarks(current => current.includes(path) ? current.filter(item => item !== path) : [...current, path]); }
  async function trashNote(path = active) {
    try { await runTransition(async () => { await api.trashNote(path); const snapshot = await api.snapshot(); updateVault(snapshot); closeTab(path); setBookmarks(current => current.filter(item => item !== path)); setModal(null); showToast('노트를 보관함의 .trash 폴더로 이동했습니다.'); }); } catch (error) { handleError(error); }
  }
  async function submitDialog(event: FormEvent) {
    event.preventDefault(); setDialogBusy(true); setDialogError('');
    try {
      if (!dialogValue.trim()) throw Error('이름을 입력하세요.');
      if (modal === 'new-note') await createNote(dialogValue);
      if (modal === 'new-folder') { await api.createFolder(dialogValue.trim()); await refresh(); }
      if (modal === 'rename') await renameNote(dialogValue);
      setModal(null);
    } catch (error) { setDialogError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error)); }
    finally { setDialogBusy(false); }
  }
  async function chooseVault(create: boolean) {
    try { await runTransition(async () => { const next = await (create ? api.createVault() : api.openVault()); if (next) { adoptVault(next); setModal(null); } }); } catch (error) { handleError(error); }
  }
  const actions = [
    { id:'publish',label:'현재 노트 웹에 공유',shortcut:'',icon:Share2,run:()=>void openSharing() },
    { id:'publications',label:'공유한 문서 관리',shortcut:'',icon:Share2,run:()=>{setPublishTarget(null);setPublishOpen(true);setModal(null);} },
    { id: 'new-note', label: '새 노트 만들기', shortcut: '⌘ N', icon: FilePlus2, run: () => newNoteDialog() },
    { id: 'quick-open', label: '빠른 전환기 열기', shortcut: '⌘ O', icon: FileSearch, run: () => showDialog('quick') },
    { id: 'search', label: '모든 노트 검색', shortcut: '⌘ ⇧ F', icon: Search, run: () => { setSidebarVisible(true); setSidebar('search'); setModal(null); setTimeout(() => document.getElementById('vault-search')?.focus(), 0); } },
    { id: 'graph', label: '그래프 뷰 열기 / 닫기', shortcut: '⌘ G', icon: Network, run: () => { setGraphVisible(current => !current); setModal(null); } },
    { id: 'toggle-preview', label: '편집 / 읽기 모드 전환', shortcut: '⌘ E', icon: BookOpen, run: () => { setMode(current => current === 'reading' ? 'live' : 'reading'); setModal(null); } },
    { id: 'source', label: '마크다운 소스 보기', shortcut: '', icon: Terminal, run: () => { setMode('source'); setModal(null); } },
    { id: 'daily-note', label: '오늘의 일일 노트 열기', shortcut: '', icon: CalendarDays, run: () => { void dailyNote(); setModal(null); } },
    { id: 'backlinks', label: '백링크 패널 열기 / 닫기', shortcut: '', icon: Link2, run: () => { setGraphVisible(true); setBacklinksVisible(v => !v); setModal(null); } },
    { id: 'outline', label: '문서 개요 열기 / 닫기', shortcut: '', icon: List, run: () => { setGraphVisible(true); setOutlineVisible(v => !v); setModal(null); } },
    { id: 'bookmark', label: '현재 노트 북마크 전환', shortcut: '', icon: Bookmark, run: () => { toggleBookmark(); setModal(null); } },
    { id: 'refresh', label: '보관함 파일 새로고침', shortcut: '', icon: FolderOpen, run: () => { refresh().then(() => showToast('보관함을 새로고침했습니다.')).catch(handleError); setModal(null); } },
    { id: 'save', label: '현재 변경사항 저장', shortcut: '⌘ S', icon: Check, run: () => { flush().then(() => showToast('모든 변경사항을 저장했습니다.')).catch(handleError); setModal(null); } },
    { id: 'settings', label: '설정 열기', shortcut: '⌘ ,', icon: Settings, run: () => showDialog('settings') },
    { id: 'vault', label: '다른 보관함 열기', shortcut: '', icon: Folder, run: () => showDialog('vault') },
  ];
  const latestActions = useRef(actions); latestActions.current = actions;
  useEffect(() => {
    const run = (id: string) => { if (transitionRef.current) return; if (id === 'command-palette') showDialog('command'); else latestActions.current.find(action => action.id === id)?.run(); };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setModal(null); setNoteMenu(false); setContextMenu(null); return; }
      if (!(event.metaKey || event.ctrlKey)) return;
      const map: Record<string, string> = { n: 'new-note', o: 'quick-open', p: 'command-palette', g: 'graph', e: 'toggle-preview', s: 'save', ',': 'settings' };
      const id = event.shiftKey && event.key.toLowerCase() === 'f' ? 'search' : map[event.key.toLowerCase()];
      if (id) { event.preventDefault(); run(id); }
    };
    window.addEventListener('keydown', keydown); const unsubscribe = api.onMenuAction(run);
    return () => { window.removeEventListener('keydown', keydown); unsubscribe(); };
  }, []);
  const paletteItems = modal === 'quick'
    ? notes.filter(note => canonical(note.path).includes(canonical(paletteQuery))).map(note => ({ id: note.path, label: titleOf(note.path), detail: note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/')) : '보관함', shortcut: '', icon: FileText, run: () => { openNote(note.path); setModal(null); } }))
    : actions.filter(action => canonical(action.label).includes(canonical(paletteQuery))).map(action => ({ ...action, detail: '' }));
  const backlinks = note ? notes.filter(file => file.path !== active && wikiLinks(file.content).some(link => resolveLink(link.target, file.path, notes) === active)) : [];
  const outline = note ? [...note.content.matchAll(/^(#{1,6})\s+(.+)$/gm)].map(match => ({ level: match[1].length, text: match[2] })) : [];
  const filtered = sidebar === 'bookmarks' ? notes.filter(note => bookmarks.includes(note.path)) : notes;
  const allFolders = new Set(vault?.folders || []);
  for (const file of notes) { const parts = file.path.split('/'); parts.pop(); for (let i = 1; i <= parts.length; i++) allFolders.add(parts.slice(0, i).join('/')); }
  function renderFolder(folder: string, depth = 0): ReactNode {
    const directFolders = [...allFolders].filter(path => path.substring(0, path.lastIndexOf('/')) === folder && path !== folder && (folder || !path.includes('/'))).sort((a, b) => a.localeCompare(b, 'ko'));
    const directNotes = filtered.filter(file => (file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '') === folder).sort((a, b) => a.path.localeCompare(b.path, 'ko') * (sortDescending ? -1 : 1));
    return <>{sidebar !== 'bookmarks' && directFolders.map(path => <div key={path}><button className={`tree-folder ${selectedFolder === path ? 'selected-folder' : ''}`} style={{ paddingLeft: 13 + depth * 16 }} onClick={() => { setSelectedFolder(path); setCollapsed(current => { const next = new Set(current); next.has(path) ? next.delete(path) : next.add(path); return next; }); }}>{collapsed.has(path) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}<span>{path.split('/').pop()}</span></button>{!collapsed.has(path) && renderFolder(path, depth + 1)}</div>)}{directNotes.map(file => <button key={file.path} className={`tree-note ${file.path === active ? 'selected' : ''}`} style={{ paddingLeft: 25 + depth * 16 }} onClick={() => { openNote(file.path); setSelectedFolder(folder); }} onContextMenu={event => { event.preventDefault(); setContextMenu({ x: Math.min(event.clientX, window.innerWidth - 200), y: Math.min(event.clientY, window.innerHeight - 160), path: file.path }); }} title={file.path}>{titleOf(file.path)}{bookmarks.includes(file.path) && <Bookmark size={11} />}</button>)}</>;
  }
  const searchResults = query.trim() ? notes.map(file => { const q = canonical(query.trim()); const at = canonical(file.content).indexOf(q); const matches = canonical(file.path).includes(q) || at >= 0; return { file, at, matches }; }).filter(result => result.matches) : [];
  function goHistory(delta: number) { const index = historyIndex + delta; if (index < 0 || index >= history.length) return; setHistoryIndex(index); const path = history[index]; if (notes.some(note => note.path === path)) openNote(path, false); }
  if (!vault) return <div className="loading-screen"><Network size={28} /><span>{toast || '보관함을 여는 중…'}</span>{toast && <button className="primary-button" onClick={() => api.initialize().then(adoptVault).catch(handleError)}>다시 시도</button>}</div>;

  return <div className={`app${transitioning ? ' interaction-locked' : ''}`} aria-busy={transitioning} style={{ '--sidebar-width': `${sidebarVisible ? sidebarWidth : 0}px`, '--graph-width': `${graphWidth}%` } as CSSProperties}>
    <aside className="left-shell" style={{ width: sidebarVisible ? sidebarWidth + 44 : 44 }}>
      <div className="sidebar-titlebar"><div className="traffic-clearance" />{sidebarVisible && <><IconButton label="파일 탐색기" active={sidebar === 'files'} onClick={() => setSidebar('files')}><FolderClosed /></IconButton><IconButton label="검색" active={sidebar === 'search'} onClick={() => setSidebar('search')}><Search size={20} /></IconButton><IconButton label="북마크" active={sidebar === 'bookmarks'} onClick={() => setSidebar('bookmarks')}><Bookmark size={19} /></IconButton><span className="flex-spacer" /></>}<IconButton label="왼쪽 사이드바 접기 / 펼치기" onClick={() => setSidebarVisible(!sidebarVisible)}><PanelLeft size={18} /></IconButton></div>
      <nav className="ribbon" aria-label="주요 도구"><IconButton label="빠른 전환기 열기" onClick={() => showDialog('quick')}><FileSearch size={20} /></IconButton><IconButton label="그래프 뷰 열기" active={graphVisible} onClick={() => setGraphVisible(!graphVisible)}><Network size={20} /></IconButton><IconButton label="새 노트 만들기" onClick={() => newNoteDialog()}><SquarePen size={20} /></IconButton><IconButton label="오늘의 일일 노트 열기" onClick={() => void dailyNote()}><CalendarDays size={20} /></IconButton><IconButton label="읽기 모드 전환" onClick={() => setMode(mode === 'reading' ? 'live' : 'reading')}><BookOpen size={20} /></IconButton><IconButton label="명령어 팔레트 열기" onClick={() => showDialog('command')}><Terminal size={21} /></IconButton><IconButton label="문서 개요" active={outlineVisible} onClick={() => { setGraphVisible(true); setOutlineVisible(!outlineVisible); }}><List size={20} /></IconButton></nav>
      {sidebarVisible && <div className="sidebar-body">
        {sidebar === 'files' ? <><div className="file-toolbar"><IconButton label="새 노트" onClick={() => newNoteDialog()}><SquarePen size={18} /></IconButton><IconButton label="새 폴더" onClick={() => showDialog('new-folder', selectedFolder ? selectedFolder + '/새 폴더' : '새 폴더')}><FolderPlus size={18} /></IconButton><IconButton label="정렬 순서 변경" active={sortDescending} onClick={() => setSortDescending(!sortDescending)}><ArrowDownAZ size={18} /></IconButton><IconButton label="현재 파일 표시" onClick={() => { if (active.includes('/')) setCollapsed(new Set()); setSelectedFolder(active.includes('/') ? active.slice(0, active.lastIndexOf('/')) : ''); }}><PanelLeft size={18} /></IconButton><IconButton label="모두 접기 / 펼치기" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(allFolders))}><ChevronsUpDown size={17} /></IconButton></div><div className="file-tree" role="navigation" aria-label="보관함 파일">{renderFolder('')}{!notes.length && <div className="sidebar-empty">아직 노트가 없습니다.<button className="text-button" onClick={() => newNoteDialog()}>첫 노트 만들기</button></div>}</div></> : sidebar === 'search' ? <div className="search-sidebar"><div className="search-field"><Search size={15} /><input id="vault-search" placeholder="검색어 입력…" aria-label="보관함 검색" value={query} onChange={e => setQuery(e.target.value)} />{query && <IconButton label="검색 지우기" onClick={() => setQuery('')}><X size={13} /></IconButton>}</div><div className="search-caption muted">{query.trim() ? `${searchResults.length}개 파일에서 검색됨` : '노트 이름과 내용에서 검색합니다.'}</div>{searchResults.map(({ file, at }) => <button className="search-result" key={file.path} onClick={() => openNote(file.path)}><strong><FileText size={13} />{titleOf(file.path)}</strong><span>{at < 0 ? file.path : file.content.slice(Math.max(0, at - 25), at + query.length + 65).replace(/\n/g, ' ')}</span></button>)}</div> : <div className="bookmark-list"><div className="sidebar-caption">북마크</div>{bookmarks.length ? filtered.map(file => <button key={file.path} className={`tree-note ${active === file.path ? 'selected' : ''}`} onClick={() => openNote(file.path)}><Bookmark size={13} />{titleOf(file.path)}</button>) : <div className="sidebar-empty">자주 보는 노트를 북마크하세요.<button className="text-button" disabled={!active} onClick={() => toggleBookmark()}>현재 노트 북마크</button></div>}</div>}
        <div className="vault-footer"><button className="vault-switch" onClick={() => showDialog('vault')} title={vault.path}><ChevronsUpDown size={16} /><span>{vault.name}</span></button><IconButton label="도움말" onClick={() => showDialog('help')}><CircleHelp size={17} /></IconButton><IconButton label="설정" onClick={() => showDialog('settings')}><Settings size={17} /></IconButton></div>
      </div>}
    </aside>
    {sidebarVisible && <div className="resize-handle sidebar-resizer" role="separator" aria-label="사이드바 크기 조절" onPointerDown={event => { const start = event.clientX, width = sidebarWidth; event.currentTarget.setPointerCapture(event.pointerId); const move = (e: PointerEvent) => setSidebarWidth(Math.max(200, Math.min(440, width + e.clientX - start))); const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop); }} />}
    <main className="workspace">
      <section className="note-pane">
        <div className="tab-strip"><div className="note-tabs">{tabs.map(path => <div key={path} role="tab" aria-selected={active === path} className={`tab ${active === path ? 'active' : ''}`} onClick={() => openNote(path)}><span>{titleOf(path)}</span><button aria-label={`${titleOf(path)} 탭 닫기`} title="탭 닫기" onClick={event => { event.stopPropagation(); closeTab(path); }}><X size={16} /></button></div>)}</div><IconButton label="새 탭" onClick={() => showDialog('quick')}><Plus size={20} /></IconButton><span className="drag-fill" /><IconButton label="열린 탭 목록" onClick={() => showDialog('quick')}><ChevronDown size={17} /></IconButton>{!graphVisible && <IconButton label="오른쪽 그래프 열기" onClick={() => setGraphVisible(true)}><PanelRight size={18} /></IconButton>}</div>
        <div className="pane-header"><IconButton label="뒤로가기" disabled={historyIndex <= 0} onClick={() => goHistory(-1)}><ArrowLeft size={18} /></IconButton><IconButton label="앞으로 가기" disabled={historyIndex >= history.length - 1} onClick={() => goHistory(1)}><ArrowRight size={18} /></IconButton><span className="breadcrumb">{note ? note.path.replace(/\.md$/i, '').split('/').join(' / ') : '새 탭'}</span>{active && <><IconButton label="노트 웹에 공유" onClick={()=>void openSharing()}><Share2 size={18}/></IconButton><IconButton label={mode === 'reading' ? '편집 모드로 전환' : '읽기 모드로 전환'} onClick={() => setMode(mode === 'reading' ? 'live' : 'reading')}>{mode === 'reading' ? <Pencil size={18} /> : <BookOpen size={19} />}</IconButton><div className="menu-anchor"><IconButton label="노트 옵션" active={noteMenu} onClick={() => setNoteMenu(!noteMenu)}><MoreHorizontal size={20} /></IconButton>{noteMenu && <div className="dropdown note-dropdown"><button onClick={()=>void openSharing()}><Share2 size={15}/>웹에 공유</button><button onClick={() => showDialog('rename', titleOf(active))}><Pencil size={15} />이름 바꾸기</button><button onClick={() => { toggleBookmark(); setNoteMenu(false); }}><Bookmark size={15} />{bookmarks.includes(active) ? '북마크 해제' : '북마크 추가'}</button><button onClick={() => { setMode(mode === 'source' ? 'live' : 'source'); setNoteMenu(false); }}><Terminal size={15} />{mode === 'source' ? '실시간 미리보기' : '소스 모드'}</button><button className="danger" onClick={() => showDialog('trash')}><Trash2 size={15} />휴지통으로 이동</button></div>}</div></>}</div>
        {note ? <div className="editor-scroll"><article className={`note-document ${preferences.readableWidth ? 'readable' : ''}`}><input className="note-title" aria-label="노트 제목" disabled={transitioning} value={title} onChange={e => setTitle(e.target.value)} onBlur={() => { if (title !== titleOf(active)) renameNote(title).catch(error => { setTitle(titleOf(active)); handleError(error); }); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setTitle(titleOf(active)); event.currentTarget.blur(); } }} /><MarkdownEditor disabled={transitioning} key={active} value={note.content} onChange={changeContent} mode={mode} dark={dark} lineNumbers={preferences.lineNumbers} onLink={followLink} /></article></div> : <div className="empty-note"><FileText size={40} strokeWidth={1} /><h2>새로운 생각을 시작하세요</h2><button className="primary-button" onClick={() => newNoteDialog()}>새 노트 만들기</button><button className="text-button" onClick={() => showDialog('quick')}>기존 노트 열기 <kbd>⌘ O</kbd></button></div>}
      </section>
      {graphVisible && <><div className="resize-handle graph-resizer" role="separator" aria-label="그래프 크기 조절" onPointerDown={event => { const start = event.clientX, width = graphWidth, available = event.currentTarget.parentElement!.clientWidth; event.currentTarget.setPointerCapture(event.pointerId); const move = (e: PointerEvent) => setGraphWidth(Math.max(25, Math.min(65, width - (e.clientX - start) / available * 100))); const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop); }} /><section className="graph-pane"><div className="tab-strip"><div className="tab active graph-tab"><Network size={15} /><span>그래프 뷰</span><button aria-label="그래프 뷰 닫기" onClick={() => setGraphVisible(false)}><X size={16} /></button></div><IconButton label="빠른 전환기" onClick={() => showDialog('quick')}><Plus size={20} /></IconButton><span className="drag-fill" /><IconButton label="백링크 패널" active={backlinksVisible} onClick={() => setBacklinksVisible(!backlinksVisible)}><ChevronDown size={17} /></IconButton><IconButton label="오른쪽 사이드바 접기" onClick={() => setGraphVisible(false)}><PanelRight size={18} /></IconButton></div><div className="pane-header"><IconButton label="그래프에서 이전 노트" disabled={historyIndex <= 0} onClick={() => goHistory(-1)}><ArrowLeft size={18} /></IconButton><IconButton label="그래프에서 다음 노트" disabled={historyIndex >= history.length - 1} onClick={() => goHistory(1)}><ArrowRight size={18} /></IconButton><span className="breadcrumb">그래프 뷰</span><IconButton label="그래프 노트 목록" onClick={() => showDialog('quick')}><MoreHorizontal size={20} /></IconButton></div><Graph notes={notes} active={active} onOpen={id => id.startsWith('?') ? followLink(id.slice(1)) : openNote(id)} />{outlineVisible && <div className="detail-panel"><div className="detail-heading"><strong>개요</strong><IconButton label="개요 닫기" onClick={() => setOutlineVisible(false)}><X size={14} /></IconButton></div>{outline.length ? outline.map((heading, i) => <div key={i} className="outline-entry" style={{ paddingLeft: 14 + (heading.level - 1) * 12 }}>{heading.text}</div>) : <p className="muted"># 제목을 추가하면 개요가 표시됩니다.</p>}</div>}{backlinksVisible && <div className="detail-panel"><div className="detail-heading"><strong>백링크 <span>{backlinks.length}</span></strong><IconButton label="백링크 닫기" onClick={() => setBacklinksVisible(false)}><X size={14} /></IconButton></div>{backlinks.length ? backlinks.map(file => <button className="backlink-entry" key={file.path} onClick={() => openNote(file.path)}><Link2 size={14} /><span>{titleOf(file.path)}</span></button>) : <p className="muted">이 노트로 연결되는 링크가 없습니다.</p>}</div>}</section></>}
    </main>
    <footer className="statusbar"><button title={saveStatus === 'error' ? '저장 재시도' : vault.path} onClick={() => flush().catch(handleError)} className={saveStatus === 'error' ? 'danger' : ''}>{saveStatus === 'saved' ? <Check size={12} /> : <span className={`status-dot ${saveStatus}`} />}{saveStatus === 'saved' ? '저장됨' : saveStatus === 'error' ? '저장 실패 · 재시도' : '저장 중…'}</button><span className="flex-spacer"/><button onClick={() => { setGraphVisible(true); setBacklinksVisible(!backlinksVisible); }}>{backlinks.length}개 백링크</button><button onClick={() => setMode(mode === 'reading' ? 'live' : 'reading')} title={mode === 'reading' ? '읽기' : mode === 'source' ? '소스 모드' : '실시간 미리보기'}>{mode === 'reading' ? <BookOpen size={13} /> : <Pencil size={13} />}</button><span>{countWords(note?.content || '')}개 단어</span><span>{(note?.content || '').length}개 문자</span></footer>
    {contextMenu && <div className="dropdown context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}><button onClick={() => { openNote(contextMenu.path); showDialog('rename', titleOf(contextMenu.path)); }}><Pencil size={14} />이름 바꾸기</button><button onClick={() => toggleBookmark(contextMenu.path)}><Bookmark size={14} />북마크 전환</button><button className="danger" onClick={() => { openNote(contextMenu.path); showDialog('trash'); }}><Trash2 size={14} />휴지통으로 이동</button></div>}
    {modal && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null); }}>
      {(modal === 'quick' || modal === 'command') ? <div className="palette modal" role="dialog" aria-modal="true" aria-label={modal === 'quick' ? '빠른 전환기' : '명령어 팔레트'}><div className="palette-search">{modal === 'quick' ? <Search size={20} /> : <Command size={20} />}<input autoFocus aria-label={modal === 'quick' ? '노트 찾기' : '명령어 검색'} placeholder={modal === 'quick' ? '열고 싶은 노트 이름을 입력하세요…' : '명령어 입력…'} value={paletteQuery} onChange={e => { setPaletteQuery(e.target.value); setPaletteIndex(0); }} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setPaletteIndex(i => Math.min(paletteItems.length - 1, i + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setPaletteIndex(i => Math.max(0, i - 1)); } if (e.key === 'Enter') { e.preventDefault(); if (paletteItems[paletteIndex]) paletteItems[paletteIndex].run(); else if (modal === 'quick' && paletteQuery.trim()) newNoteDialog(paletteQuery); } }} /><kbd>esc</kbd></div><div className="palette-results">{paletteItems.map((item, i) => <button key={item.id} className={i === paletteIndex ? 'palette-item selected' : 'palette-item'} onMouseEnter={() => setPaletteIndex(i)} onClick={item.run}><item.icon size={16} /><span>{item.label}{item.detail && <small>{item.detail}</small>}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}</button>)}{!paletteItems.length && <div className="palette-empty">{modal === 'quick' ? <><p>일치하는 노트가 없습니다.</p><button className="text-button" onClick={() => newNoteDialog(paletteQuery)}>“{paletteQuery}” 노트 만들기</button></> : '일치하는 명령어가 없습니다.'}</div>}</div><div className="palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> 선택</span><span><kbd>↵</kbd> 열기</span></div></div>
      : modal === 'settings' ? <div className="settings-modal modal" role="dialog" aria-modal="true" aria-label="설정"><aside><h3>설정</h3>{['일반', '편집기', '외형', '정보'].map(section => <button key={section} className={settingsSection === section ? 'selected' : ''} onClick={() => setSettingsSection(section)}>{section}</button>)}</aside><div className="settings-content"><IconButton label="설정 닫기" onClick={() => setModal(null)}><X size={20} /></IconButton><h2>{settingsSection}</h2>{settingsSection === '외형' ? <><div className="setting-row"><div><strong>기본 테마</strong><p>작업 공간의 색상을 선택합니다.</p></div><select aria-label="기본 테마" value={preferences.theme} onChange={e => setPreferences(p => ({ ...p, theme: e.target.value as Preferences['theme'] }))}><option value="light">밝게</option><option value="dark">어둡게</option><option value="system">시스템 설정</option></select></div><div className="setting-row"><div><strong>텍스트 글꼴 크기</strong><p>{preferences.fontSize}px</p></div><input aria-label="텍스트 글꼴 크기" type="range" min={12} max={24} value={preferences.fontSize} onChange={e => setPreferences(p => ({ ...p, fontSize: Number(e.target.value) }))} /></div></> : settingsSection === '편집기' ? <><div className="setting-row"><div><strong>읽기 좋은 줄 길이</strong><p>문서 너비를 편안하게 유지합니다.</p></div><input type="checkbox" aria-label="읽기 좋은 줄 길이" checked={preferences.readableWidth} onChange={e => setPreferences(p => ({ ...p, readableWidth: e.target.checked }))} /></div><div className="setting-row"><div><strong>줄 번호 표시</strong><p>편집기에서 줄 번호를 표시합니다.</p></div><input type="checkbox" aria-label="줄 번호 표시" checked={preferences.lineNumbers} onChange={e => setPreferences(p => ({ ...p, lineNumbers: e.target.checked }))} /></div><div className="setting-row"><div><strong>기본 보기</strong><p>실시간 미리보기 또는 마크다운 원문</p></div><select aria-label="기본 보기" value={mode} onChange={e => setMode(e.target.value as EditorMode)}><option value="live">실시간 미리보기</option><option value="source">소스 모드</option><option value="reading">읽기 모드</option></select></div></> : settingsSection === '일반' ? <><div className="setting-row"><div><strong>보관함 위치</strong><p className="vault-path">{vault.path}</p></div><button className="secondary-button" onClick={() => api.revealVault().catch(handleError)}>폴더 열기</button></div><div className="setting-row"><div><strong>다른 보관함</strong><p>로컬 폴더를 선택합니다.</p></div><button className="secondary-button" onClick={() => void chooseVault(false)}>열기</button></div><div className="setting-row"><div><strong>자동 저장</strong><p>입력을 멈춘 뒤 변경사항을 파일에 저장합니다.</p></div><span className="accent-text">사용 중</span></div></> : <div className="about-content"><Network size={35} /><h2>옵시온</h2><p>로컬 마크다운으로 생각을 기록하고 연결하는 작업 공간입니다.</p><p className="muted">노트는 내 기기의 .md 파일로 저장됩니다. 필요한 문서만 선택해 웹으로 공유할 수 있습니다.</p><p className="muted">노트를 연결하고, 검색하고, 그래프로 살펴보세요.</p><small>Version 1.0.0 · Obsion</small></div>}</div></div>
      : modal === 'vault' ? <div className="modal small-modal" role="dialog" aria-modal="true" aria-label="보관함 관리"><div className="modal-heading"><h2>보관함 열기</h2><IconButton label="닫기" onClick={() => setModal(null)}><X size={19} /></IconButton></div><div className="current-vault"><FolderOpen size={24} /><div><strong>{vault.name}</strong><p>{vault.path}</p></div></div><button className="vault-action" onClick={() => void chooseVault(false)}><FolderOpen size={21} /><span><strong>기존 폴더 열기</strong><small>폴더의 마크다운 노트를 불러옵니다.</small></span><ChevronRight size={17} /></button><button className="vault-action" onClick={() => void chooseVault(true)}><FolderPlus size={21} /><span><strong>새 보관함 만들기</strong><small>새로운 로컬 폴더에서 시작합니다.</small></span><ChevronRight size={17} /></button><p className="modal-hint">노트는 일반 .md 파일로 저장됩니다.</p></div>
      : modal === 'help' ? <div className="modal small-modal" role="dialog" aria-modal="true" aria-label="도움말"><div className="modal-heading"><h2>기록하고, 연결하세요</h2><IconButton label="닫기" onClick={() => setModal(null)}><X size={19} /></IconButton></div><p>노트에서 <code>[[노트 이름]]</code>을 입력하면 노트가 연결되고 그래프와 백링크에 표시됩니다.</p><p>실시간 미리보기에서는 <kbd>⌘</kbd> 키를 누른 채 링크를 클릭하세요. 읽기 모드에서는 바로 클릭할 수 있습니다.</p><div className="shortcut-list">{actions.filter(action => action.shortcut).map(action => <div key={action.id}><span>{action.label}</span><kbd>{action.shortcut}</kbd></div>)}<div><span>명령어 팔레트</span><kbd>⌘ P</kbd></div></div><p className="muted">삭제한 노트는 보관함의 .trash 폴더에서 복구할 수 있습니다. 파일을 외부에서 수정했다면 명령어 팔레트의 ‘보관함 파일 새로고침’을 실행하세요.</p></div>
      : modal === 'trash' ? <div className="modal small-modal" role="dialog" aria-modal="true" aria-label="노트 삭제"><div className="modal-heading"><h2>휴지통으로 이동</h2><IconButton label="닫기" onClick={() => setModal(null)}><X size={19} /></IconButton></div><p>“{titleOf(active)}” 노트를 보관함의 .trash 폴더로 이동합니다. 원본 파일은 그곳에서 복구할 수 있습니다.</p><div className="modal-actions"><button className="secondary-button" onClick={() => setModal(null)}>취소</button><button className="danger-button" onClick={() => void trashNote()}>이동</button></div></div>
      : <form className="modal small-modal" role="dialog" aria-modal="true" aria-label={modal === 'new-note' ? '새 노트' : modal === 'new-folder' ? '새 폴더' : '이름 바꾸기'} onSubmit={submitDialog}><div className="modal-heading"><h2>{modal === 'new-note' ? '새 노트' : modal === 'new-folder' ? '새 폴더' : '이름 바꾸기'}</h2><IconButton label="닫기" onClick={() => setModal(null)}><X size={19} /></IconButton></div><label className="form-label" htmlFor="note-name">{modal === 'new-folder' ? '폴더 이름' : '노트 이름'}</label><input autoFocus id="note-name" className="dialog-input" value={dialogValue} onFocus={e => e.currentTarget.select()} onChange={e => setDialogValue(e.target.value)} placeholder="이름 입력" /><p className="modal-hint">{modal === 'new-note' ? '폴더/노트 이름으로 폴더 안에 만들 수 있습니다. .md는 자동으로 붙습니다.' : modal === 'rename' ? '이 노트의 파일 이름을 변경합니다. 기존 링크는 직접 수정할 수 있습니다.' : '보관함 안에 폴더를 만듭니다.'}</p>{dialogError && <div className="form-error" role="alert">{dialogError}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>취소</button><button className="primary-button" disabled={dialogBusy || !dialogValue.trim()}>{dialogBusy ? '처리 중…' : modal === 'rename' ? '변경' : '만들기'}</button></div></form>}
    </div>}
    {publishOpen&&<PublishDialog api={api} target={publishTarget} onClose={()=>setPublishOpen(false)} onNotice={showToast}/>}
    {toast && <div className="toast" role="status">{toast}<button aria-label="알림 닫기" onClick={() => setToast('')}><X size={14} /></button></div>}
  </div>;
}
function FolderClosed() { return <Folder size={21} />; }
