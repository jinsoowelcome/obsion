'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { PublishManager } = require('../electron/publish-manager.cjs');
const { SkillBridge } = require('../electron/skill-bridge.cjs');
const { request, readConnection } = require('../skills/obsion-share/scripts/obsion-share.cjs');

async function fixture(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'obsion-skill-'));
  const root = path.join(directory, 'vault');
  await fs.mkdir(root);
  const file = path.join(root, 'shared.md');
  await fs.writeFile(file, '---\nprivate: keep-local\n---\n# Shared\n\nHello\n');
  const publishing = path.join(directory, 'publishing');
  await fs.mkdir(publishing);
  await fs.writeFile(path.join(publishing, 'private-key.pem'), crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const calls = [];
  const manager = new PublishManager({ directory: publishing, baseUrl: 'https://sharing.example', fetcher: async (url, options) => {
    calls.push({ url, options });
    return Response.json({ digest: options.body ? JSON.parse(options.body).digest : undefined, updatedAt: Date.now() });
  } });
  manager.startAttachmentHost = async () => {};
  const bridge = new SkillBridge({ directory, publisher: manager, getVaultRoot: async () => root });
  try {
    await bridge.start();
    const connection = await readConnection(directory);
    await run({ directory, root, file, manager, bridge, connection, calls });
  } finally {
    bridge.stop();
    manager.attachmentHost?.stop();
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('skill previews stay local and source changes or an incorrect digest cannot be published', () => fixture(async ({ directory, file, connection, calls }) => {
  assert.equal((await fs.stat(path.join(directory, 'skill-connection.json'))).mode & 0o777, 0o600);
  assert.equal((await fs.stat(connection.socketPath)).mode & 0o777, 0o600);
  await assert.rejects(request({ ...connection, token: '0'.repeat(64) }, '/status'), /허용되지/);
  const browserStatus = await new Promise((resolve, reject) => {
    const req = http.get({ socketPath: connection.socketPath, path: '/status', headers: { Origin: 'https://example.com', Authorization: 'Bearer ' + connection.token } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
  });
  assert.equal(browserStatus, 403);
  const prepared = await request(connection, '/prepare', { file });
  assert.equal(calls.length, 0);
  assert(!prepared.preview.markdown.includes('keep-local'));
  await assert.rejects(request(connection, '/publish', { preparationId: prepared.preparationId, digest: 'wrong' }), /digest/);
  await fs.appendFile(file, '\nChanged after preview');
  await assert.rejects(request(connection, '/publish', { preparationId: prepared.preparationId, digest: prepared.preview.digest }), /바뀌었습니다/);
  assert.equal(calls.length, 0);
  assert.deepEqual((await request(connection, '/status')).publications, []);
}));

test('the skill shares only selected attachment snapshots and lists only active pages through its CLI', () => fixture(async ({ directory, file, manager, connection }) => {
  const selected = path.join(directory, 'selected.txt');
  const privateFile = path.join(directory, 'do-not-share.txt');
  await fs.writeFile(selected, 'snapshot bytes');
  await fs.writeFile(privateFile, 'not selected');
  const prepared = await request(connection, '/prepare', { file, attachments: [selected] });
  assert.equal(prepared.preview.attachments.length, 1);
  await fs.writeFile(selected, 'changed original');
  const result = await request(connection, '/publish', { preparationId: prepared.preparationId, digest: prepared.preview.digest });
  assert.equal(result.collaborationEnabled, false);
  assert.equal(result.editUrl, null);
  assert.equal(result.requiresRunningApp, true);
  assert.equal(await fs.readFile(manager.attachmentPath(result.id, result.attachments[0].id), 'utf8'), 'snapshot bytes');
  await assert.rejects(request(connection, '/publish', { preparationId: prepared.preparationId, digest: prepared.preview.digest }), /만료/);
  const cli = path.resolve(__dirname, '../skills/obsion-share/scripts/obsion-share.cjs');
  const listed = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'list'], { env: { ...process.env, OBSION_USER_DATA: directory } });
    let output = '', errors = '';
    child.stdout.on('data', bytes => { output += bytes; });
    child.stderr.on('data', bytes => { errors += bytes; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(JSON.parse(output)) : reject(Error(errors)));
  });
  assert.equal(listed.publications.length, 1);
  assert.equal(listed.publications[0].url, result.url);
  assert(!JSON.stringify(listed).includes('not selected'));
  await manager.unpublish(result.id);
  assert.deepEqual((await request(connection, '/status')).publications, []);
}));

test('changing a requested PIN keeps the same link and invalidates the previous PIN and sessions', () => fixture(async ({ file, manager, connection, calls }) => {
  const prepared = await request(connection, '/prepare', { file, editable: true });
  await assert.rejects(request(connection, '/publish', { preparationId: prepared.preparationId, digest: prepared.preview.digest }), /4자리/);
  assert.equal(calls.length, 0);
  const result = await request(connection, '/publish', { preparationId: prepared.preparationId, digest: prepared.preview.digest, pin: '1234' });
  assert.equal(result.collaborationEnabled, true);
  const session = await manager.collaboration.handle(result.id, 'login', { pin: '1234' }, '', 'one');
  const changed = await request(connection, '/editing', { id: result.id, enabled: true, pin: '5678' });
  assert.equal(changed.url, result.url);
  assert.equal(changed.editUrl, result.url + '/edit');
  await assert.rejects(manager.collaboration.handle(result.id, 'login', { pin: '1234' }, '', 'two'), error => error.status === 401);
  await assert.rejects(manager.collaboration.handle(result.id, 'updates', { epoch: session.epoch, version: 0 }, session.session, 'one'), error => error.status === 401);
  assert((await manager.collaboration.handle(result.id, 'login', { pin: '5678' }, '', 'three')).session);
  const listed = await request(connection, '/status');
  assert.equal(listed.publications[0].collaborationEnabled, true);
  assert(!JSON.stringify(listed).includes('pinHash'));
  await request(connection, '/editing', { id: result.id, enabled: false });
  assert.equal((await request(connection, '/status')).publications[0].collaborationEnabled, false);
}));
