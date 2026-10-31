'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, clipboard, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { VaultStore } = require('./vault.cjs');
const { documentArguments, openMarkdownDocument } = require('./document-open.cjs');
const { PublishManager } = require('./publish-manager.cjs');
const { SkillBridge } = require('./skill-bridge.cjs');
const publishConfig = require('./publish-config.json');

// Electron 45 binds the macOS Keychain service before ready. Keep its legacy
// identity so existing encrypted publishing keys remain readable after renaming.
// https://github.com/electron/electron/blob/v45.0.0/shell/browser/electron_browser_main_parts.cc
app.setName('Obsidian Replica');
app.setPath('userData', process.env.OBSION_USER_DATA || process.env.OBSIDIAN_REPLICA_USER_DATA || path.join(app.getPath('appData'), 'Obsidian Replica'));
let window;
let store;
let initialization;
let closeApproved = false;
let closeRequested = false;
let closeTimeout;
let publisher;
let skillBridge;
const preferencesFile = path.join(app.getPath('userData'), 'vault.json');
let rendererReady = false;
const pendingDocuments = new Set(documentArguments(process.argv));
const undeliveredDocuments = [...pendingDocuments];
function deliverDocuments() {
  if (!rendererReady || !window) return;
  for (const file of undeliveredDocuments.splice(0)) window.webContents.send('vault:open-document', file);
}
function requestDocument(file) {
  if (!/\.md$/i.test(file)) return;
  const absolute = path.resolve(file);
  if (!pendingDocuments.has(absolute)) { pendingDocuments.add(absolute); undeliveredDocuments.push(absolute); }
  deliverDocuments();
  if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
}
app.on('open-file', (event, file) => { event.preventDefault(); requestDocument(file); });

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, args, cwd) => { for (const file of documentArguments(args, cwd)) requestDocument(file); if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(createWindow).catch(error => { dialog.showErrorBox('옵시온을 시작하지 못했습니다', error.message); app.quit(); });
}

async function rememberVault(root) {
  await fs.mkdir(path.dirname(preferencesFile), { recursive: true });
  const temporary = `${preferencesFile}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ path: root }, null, 2), { mode: 0o600 });
  await fs.rename(temporary, preferencesFile);
}

async function initialize() {
  if (store) return store.snapshot();
  if (!initialization) initialization = (async () => {
    let root = process.env.OBSION_VAULT || process.env.OBSIDIAN_REPLICA_VAULT;
    if (!root) {
      try { root = JSON.parse(await fs.readFile(preferencesFile, 'utf8')).path; }
      catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    }
    const defaultRoot = path.join(app.getPath('documents'), 'Obsion Vault');
    root = root || defaultRoot;
    const next = new VaultStore(root);
    const snapshot = await next.initialize({ create: root === defaultRoot || !!(process.env.OBSION_VAULT || process.env.OBSIDIAN_REPLICA_VAULT), seed: true });
    store = next;
    await rememberVault(store.root);
    return snapshot;
  })().catch(error => { initialization = undefined; throw error; });
  return initialization;
}

async function selectVault(create) {
  await store?.drain();
  const selected = await dialog.showOpenDialog(window, {
    title: create ? '새 보관함을 만들 위치 선택' : '보관함 폴더 열기',
    buttonLabel: create ? '이 위치에 만들기' : '보관함 열기',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (selected.canceled || !selected.filePaths[0]) return null;
  let root = selected.filePaths[0];
  if (create) {
    const parent = root;
    root = path.join(parent, '새 보관함');
    let index = 1;
    while (await fs.lstat(root).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) root = path.join(parent, `새 보관함 ${index++}`);
  }
  const next = new VaultStore(root);
  const snapshot = await next.initialize({ create, seed: create });
  await rememberVault(next.root);
  store = next;
  initialization = Promise.resolve(snapshot);
  return snapshot;
}

const action = name => () => window?.webContents.send('vault:menu-action', name);

function installMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { label: '설정…', accelerator: 'CmdOrCtrl+,', click: action('settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: '파일', submenu: [{ label: '새 노트', accelerator: 'CmdOrCtrl+N', click: action('new-note') }, { label: '빠른 전환기', accelerator: 'CmdOrCtrl+O', click: action('quick-open') }, { label: '오늘의 일일 노트', click: action('daily-note') }, { label: '현재 노트 웹에 공유…', click: action('publish') }, { label: '공유한 문서 관리…', click: action('publications') }, { type: 'separator' }, { label: '저장', accelerator: 'CmdOrCtrl+S', click: action('save') }, { type: 'separator' }, { role: 'close' }] },
    { label: '편집', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' }, { label: '보관함 검색', accelerator: 'CmdOrCtrl+Shift+F', click: action('search') }] },
    { label: '보기', submenu: [{ label: '편집 / 읽기 모드', accelerator: 'CmdOrCtrl+E', click: action('toggle-preview') }, { label: '그래프 뷰', accelerator: 'CmdOrCtrl+G', click: action('graph') }, { label: '명령어 팔레트', accelerator: 'CmdOrCtrl+P', click: action('command-palette') }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu', label: '윈도우' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function installIPC() {
  async function selectedNote(target) {
    await initialize(); const selectedStore=store;
    if(!target||typeof target.path!=='string'||target.vaultPath!==selectedStore.root)throw new Error('공유할 보관함과 문서를 다시 선택해 주세요.');
    const snapshot=await selectedStore.snapshot();
    const note=snapshot.files.find(note=>note.path===target.path);
    if(!note)throw new Error('공유할 문서를 찾을 수 없습니다.');
    return {root:selectedStore.root,note};
  }
  const handlers = {
    initialize,
    'prepare-publish': async (target,options) => { const {root,note}=await selectedNote(target);return publisher.prepare(root,note,options); },
    'publish-note': async (target,options,digest) => { const {root,note}=await selectedNote(target);return publisher.publish(root,note,options,digest); },
    'configure-collaboration': async (target,id,enabled,pin) => { const {root,note}=await selectedNote(target);await store.drain();if(publisher.collaboration.find(id).notePath!==note.path)throw Error('공유할 노트를 다시 선택해 주세요.');await publisher.collaboration.configure(root,id,enabled,pin);return publisher.prepare(root,(await selectedNote(target)).note); },
    'collaboration-state': () => publisher.collaboration.state(),
    'select-publish-attachments': async () => { const selected=await dialog.showOpenDialog(window,{title:'공유할 첨부파일 선택',properties:['openFile','multiSelections']});return selected.canceled?[]:publisher.attachments.add(selected.filePaths); },
    'remove-publish-attachment': id => publisher.attachments.remove(id),
    'clear-publish-attachments': () => publisher.attachments.clear(),
    'list-publications': () => publisher.list(),
    'unpublish-note': id => publisher.unpublish(id),
    'copy-publish-link': async id => { const record=await publisher.publication(id);clipboard.writeText(record.url); },
    'open-published-note': async id => { const record=await publisher.publication(id);await shell.openExternal(record.url); },
    snapshot: async () => { await initialize(); return store.snapshot(); },
    'create-note': async (relative, content) => { await initialize(); return store.createNote(relative, content); },
    'write-note': async (relative, content) => { await initialize();if(publisher.collaboration.locked(store.root,relative))throw Error('공동 편집 중인 노트는 공유 링크에서 편집해 주세요.');return store.writeNote(relative, content); },
    'rename-note': async (oldPath, newPath) => { await initialize();const root=store.root;if(publisher.collaboration.locked(root,oldPath))throw Error('공동 편집을 끈 뒤 이름을 변경해 주세요.');await store.renameNote(oldPath,newPath);await publisher.rename(root,oldPath,newPath); },
    'trash-note': async relative => { await initialize();if(publisher.collaboration.locked(store.root,relative))throw Error('공동 편집을 끈 뒤 노트를 삭제해 주세요.');return store.trashNote(relative); },
    'create-folder': async relative => { await initialize(); return store.createFolder(relative); },
    'open-vault': () => selectVault(false),
    'create-vault': () => selectVault(true),
    'reveal-vault': async () => { await initialize(); await shell.openPath(store.root); },
    'ready-to-close': async () => { await store?.drain(); clearTimeout(closeTimeout); closeApproved = true; window?.close(); },
    'renderer-ready': () => { rendererReady = true; deliverDocuments(); },
    'open-document': async file => {
      if (!pendingDocuments.has(file)) throw new Error('운영체제가 요청한 문서만 열 수 있습니다.');
      await initialize(); await store.drain();
      try { const opened = await openMarkdownDocument(file, store); store = opened.store; initialization = Promise.resolve(opened.snapshot); return opened.snapshot; }
      finally { pendingDocuments.delete(file); }
    },
  };
  for (const [method, handler] of Object.entries(handlers)) ipcMain.handle(`vault:${method}`, async (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('허용되지 않은 앱 요청입니다.');
    return handler(...args);
  });
}

async function createWindow() {
  // The Keychain identity above is already fixed; all visible app naming uses Obsion.
  app.setName('Obsion');
  app.setAboutPanelOptions({ applicationName: '옵시온 · Obsion', applicationVersion: app.getVersion() });
  publisher=new PublishManager({directory:path.join(app.getPath('userData'),'publishing'),baseUrl:process.env.OBSION_PUBLISH_URL||publishConfig.baseUrl,storage:safeStorage,allowLocal:process.env.OBSION_ALLOW_LOCAL_PUBLISH==='1'});
  await publisher.initialize().catch(error=>console.error('공유 기능 초기화 확인 필요:',error.message));
  publisher.onCollaborationChange=event=>{if(window&&!window.isDestroyed())window.webContents.send('vault:collaboration-changed',event);};
  if(Object.values(publisher.records||{}).some(record=>!record.revoked&&(record.attachments?.length||record.collaboration)))publisher.startAttachmentHost().catch(error=>console.error('로컬 공유 연결 확인 필요:',error.message));
  app.once('will-quit',()=>publisher.attachmentHost?.stop());
  skillBridge = new SkillBridge({directory:app.getPath('userData'),publisher,getVaultRoot:async()=>{await initialize();return store.root;},drain:async()=>{await store?.drain();}});
  await skillBridge.start();
  app.once('will-quit',()=>skillBridge.stop());
  installIPC();
  installMenu();
  window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    title: '옵시온 · Obsion', titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 16 }, backgroundColor: '#ffffff', show: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  });
  const entry = path.join(__dirname, '..', 'dist', 'index.html');
  const devURL = process.env.VITE_DEV_SERVER_URL;
  const initialURL = devURL || pathToFileURL(entry).href;
  if (devURL && !/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(devURL)) throw new Error('개발 서버는 127.0.0.1만 사용할 수 있습니다.');
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('did-start-loading', () => { rendererReady = false; });
  window.webContents.on('will-navigate', (event, url) => { if (url !== initialURL) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.on('close', event => {
    if (closeApproved || window.webContents.isDestroyed()) return;
    event.preventDefault();
    if (closeRequested) return;
    closeRequested = true;
    window.webContents.send('vault:before-close');
    closeTimeout = setTimeout(async () => {
      closeRequested = false;
      const result = await dialog.showMessageBox(window, { type: 'warning', message: '저장 완료 응답을 기다리고 있습니다.', detail: '노트가 아직 저장되지 않았을 수 있습니다. 앱을 닫으시겠습니까?', buttons: ['계속 기다리기', '닫기'], defaultId: 0, cancelId: 0 });
      if (result.response === 1) { await store?.drain(); closeApproved = true; window.close(); }
    }, 10000);
  });
  window.on('closed', () => { clearTimeout(closeTimeout); window = undefined; });
  await window.loadURL(initialURL);
}

app.on('window-all-closed', () => app.quit());
process.on('SIGTERM', () => app.quit());
