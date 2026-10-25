'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { VaultStore } = require('../electron/vault.cjs');

async function fixture(t) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-replica-vault-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const store = new VaultStore(path.join(parent, 'vault'));
  await store.initialize({ create: true });
  return { parent, root: store.root, store };
}

test('notes persist as UTF-8 Markdown through create, update, rename and reopen', async t => {
  const { store, root } = await fixture(t);
  await store.createFolder('메모/프로젝트');
  await store.createNote('메모/프로젝트/생각.md', '# 생각\n[[다른 노트]]');
  await store.writeNote('메모/프로젝트/생각.md', '# 고친 생각\n한글 내용');
  await store.renameNote('메모/프로젝트/생각.md', '메모/프로젝트/기록.md');
  const reopened = new VaultStore(root);
  const snapshot = await reopened.initialize();
  assert.equal(snapshot.files.length, 1);
  assert.equal(snapshot.files[0].path, '메모/프로젝트/기록.md');
  assert.equal(snapshot.files[0].content, '# 고친 생각\n한글 내용');
  assert.ok(snapshot.files[0].modified > 0);
  assert.deepEqual(snapshot.folders, ['메모', '메모/프로젝트']);
  assert.equal(await fs.readFile(path.join(root, '메모/프로젝트/기록.md'), 'utf8'), '# 고친 생각\n한글 내용');
});

test('duplicate creates and rename collisions never replace data, including case variants', async t => {
  const { store } = await fixture(t);
  await store.createNote('Alpha.md', 'original');
  await store.createNote('Beta.md', 'other');
  await assert.rejects(store.createNote('Alpha.md', 'overwrite'));
  await assert.rejects(store.createNote('alpha.md', 'overwrite'));
  await assert.rejects(store.renameNote('Beta.md', 'Alpha.md'));
  await assert.rejects(store.renameNote('Beta.md', 'ALPHA.md'));
  const files = (await store.snapshot()).files;
  assert.equal(files.find(file => file.path === 'Alpha.md').content, 'original');
  assert.equal(files.find(file => file.path === 'Beta.md').content, 'other');
});

test('nested new notes create parents only after path validation and keep symlink parents contained', async t => {
  const { store, root, parent } = await fixture(t);
  const created = await store.createNote('프로젝트/새 폴더/첫 노트.md', '새로운 기록');
  assert.equal(created.path, '프로젝트/새 폴더/첫 노트.md');
  assert.equal(await fs.readFile(path.join(root, created.path), 'utf8'), '새로운 기록');
  await assert.rejects(store.createNote('만들지않음/../bad.md', 'invalid'));
  await assert.rejects(store.createNote('만들지않음/invalid.txt', 'invalid'));
  assert.equal(await fs.stat(path.join(root, '만들지않음')).then(() => true, () => false), false);
  await store.createFolder('Notes');
  await assert.rejects(store.createNote('notes/new/note.md', 'case collision'));
  assert.deepEqual(await fs.readdir(path.join(root, 'Notes')), []);
  const outside = path.join(parent, 'outside');
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(root, 'shortcut'));
  await assert.rejects(store.createNote('shortcut/new/note.md', 'must stay inside'));
  assert.deepEqual(await fs.readdir(outside), []);
  await assert.rejects(store.createNote(created.path, 'must not overwrite'));
  assert.equal(await fs.readFile(path.join(root, created.path), 'utf8'), '새로운 기록');
});

test('relative traversal, absolute paths, hidden metadata and symlinks stay outside vault operations', async t => {
  const { store, root, parent } = await fixture(t);
  const outside = path.join(parent, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'private.md'), 'private');
  await fs.symlink(outside, path.join(root, 'shortcut'));
  await fs.symlink(path.join(outside, 'private.md'), path.join(root, 'linked.md'));
  for (const relative of ['../private.md', '/tmp/private.md', '.obsidian/config.md', 'folder/../../private.md', 'shortcut/private.md', 'linked.md', 'bad\\name.md']) await assert.rejects(store.writeNote(relative, 'changed'));
  await assert.rejects(store.createNote('shortcut/new.md', 'changed'));
  await assert.rejects(store.createFolder('shortcut/child'));
  assert.deepEqual((await store.snapshot()).files, []);
  assert.equal(await fs.readFile(path.join(outside, 'private.md'), 'utf8'), 'private');
  await assert.rejects(new VaultStore(path.join(root, 'shortcut')).initialize());
});

test('trash preserves deleted content, hides recovery files and refuses a linked trash directory', async t => {
  const { store, root, parent } = await fixture(t);
  await store.createNote('recover.md', 'keep this');
  await store.trashNote('recover.md');
  assert.equal((await store.snapshot()).files.length, 0);
  const entries = await fs.readdir(path.join(root, '.trash'));
  assert.equal(entries.length, 1);
  assert.equal(await fs.readFile(path.join(root, '.trash', entries[0]), 'utf8'), 'keep this');
  await fs.rm(path.join(root, '.trash'), { recursive: true });
  await fs.mkdir(path.join(parent, 'outside-trash'));
  await fs.symlink(path.join(parent, 'outside-trash'), path.join(root, '.trash'));
  await store.createNote('retained.md', 'do not lose');
  await assert.rejects(store.trashNote('retained.md'));
  assert.equal((await store.snapshot()).files[0].content, 'do not lose');
});

test('queued writes finish in order and a rejected operation does not poison later saves', async t => {
  const { store, root } = await fixture(t);
  await store.createNote('ordered.md', 'initial');
  const first = store.writeNote('ordered.md', 'first');
  const rejected = store.writeNote('../invalid.md', 'invalid');
  const final = store.writeNote('ordered.md', 'final');
  const results = await Promise.allSettled([first, rejected, final]);
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected', 'fulfilled']);
  await store.drain();
  assert.equal(await fs.readFile(path.join(root, 'ordered.md'), 'utf8'), 'final');
  assert.deepEqual((await fs.readdir(root)).filter(file => file.startsWith('.replica-')), []);
});

test('only newly created default/demo vaults receive sample notes', async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-replica-seed-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'new-vault');
  const store = new VaultStore(root);
  assert.equal((await store.initialize({ create: true, seed: true })).files.length, 2);
  await store.createNote('my-note.md', 'user content');
  const reopened = new VaultStore(root);
  assert.equal((await reopened.initialize({ create: true, seed: true })).files.length, 3);
  const emptyExisting = path.join(parent, 'existing');
  await fs.mkdir(emptyExisting);
  assert.equal((await new VaultStore(emptyExisting).initialize({ create: true, seed: true })).files.length, 0);
});
