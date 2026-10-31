'use strict';
const { app, safeStorage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PublishManager } = require('../electron/publish-manager.cjs');
const { baseUrl } = require('../electron/publish-config.json');
app.setName('Obsidian Replica');
app.setPath('userData', process.env.OBSION_USER_DATA || path.join(app.getPath('appData'), 'Obsidian Replica'));
app.whenReady().then(async () => {
  const identity = new PublishManager({ directory: path.join(app.getPath('userData'), 'publishing'), baseUrl, storage: safeStorage });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'obsion-cloudflare-check-'));
  const manager = new PublishManager({ directory, baseUrl });
  manager.identity = () => identity.identity();
  let published;
  try {
    const note = { path: 'connection-check.md', content: '# Cloudflare 연결 확인\n\n이 문서는 자동 연결 확인용 문서이며 확인 후 삭제됩니다.' };
    const prepared = await manager.prepare('/connection-check', note);
    published = await manager.publish('/connection-check', note, {}, prepared.preview.digest);
    let response = await fetch(published.status.url, { redirect: 'error' });
    assert.equal(response.status, 200); assert((await response.text()).includes('Cloudflare 연결 확인'));
    note.content += '\n\n수정 요청 확인 완료.';
    const update = await manager.prepare('/connection-check', note);
    const updated = await manager.publish('/connection-check', note, {}, update.preview.digest);
    assert.equal(updated.status.url, published.status.url);
    response = await fetch(updated.status.url, { redirect: 'error' });
    assert((await response.text()).includes('수정 요청 확인 완료.'));
    await manager.unpublish(published.status.id);
    assert.equal((await fetch(published.status.url, { redirect: 'error' })).status, 404);
    console.log('Cloudflare 실제 서버: 게시 200, 수정 반영, 공유 중지 후 404 확인 완료.');
  } finally {
    if (published) await manager.unpublish(published.status.id);
    await fs.rm(directory, { recursive: true, force: true });
  }
  app.quit();
}).catch(error => { console.error(error.message); app.exit(1); });
