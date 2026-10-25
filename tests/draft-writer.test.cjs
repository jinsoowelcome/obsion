'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('close flush queued with an empty map rejects when in-flight and retry saves fail', async () => {
  const { DraftWriter } = await import('../src/draft-writer.ts');
  const started = deferred();
  const inFlight = deferred();
  let writes = 0;
  const drafts = new DraftWriter(async () => {
    writes += 1;
    if (writes === 1) { started.resolve(); await inFlight.promise; }
    throw new Error('disk unavailable');
  });
  drafts.set('note.md', 'unsaved edit');
  const autosave = drafts.flush();
  const autosaveRejected = assert.rejects(autosave, /disk unavailable/);
  await started.promise;
  assert.equal(drafts.size, 0);
  const closeFlush = drafts.flush();
  const closeRejected = assert.rejects(closeFlush, /disk unavailable/);
  inFlight.resolve();
  await Promise.all([autosaveRejected, closeRejected]);
  assert.equal(writes, 2);
  assert.equal(drafts.size, 1, 'failed close preserves the unsaved draft');
});

test('a newer draft survives an older failed write and a concurrently queued flush', async () => {
  const { DraftWriter } = await import('../src/draft-writer.ts');
  const started = deferred();
  const inFlight = deferred();
  const writes = [];
  let disk;
  const drafts = new DraftWriter(async (path, content) => {
    writes.push([path, content]);
    if (writes.length === 1) { started.resolve(); await inFlight.promise; throw new Error('temporary failure'); }
    disk = content;
  });
  drafts.set('note.md', 'older');
  const autosave = drafts.flush();
  const rejected = assert.rejects(autosave, /temporary failure/);
  await started.promise;
  drafts.set('note.md', 'latest');
  const concurrent = drafts.flush();
  inFlight.resolve();
  await rejected;
  await concurrent;
  await drafts.flush();
  assert.deepEqual(writes, [['note.md', 'older'], ['note.md', 'latest']]);
  assert.equal(disk, 'latest');
  assert.equal(drafts.size, 0, 'stale failed content must not be requeued');
});

test('a flush drains edits made while its successful write is in flight', async () => {
  const { DraftWriter } = await import('../src/draft-writer.ts');
  const started = deferred();
  const inFlight = deferred();
  const writes = [];
  const drafts = new DraftWriter(async (path, content) => {
    writes.push([path, content]);
    if (writes.length === 1) { started.resolve(); await inFlight.promise; }
  });
  drafts.set('note.md', 'initial edit');
  const saving = drafts.flush();
  await started.promise;
  drafts.set('note.md', 'latest edit');
  drafts.set('other.md', 'another note');
  inFlight.resolve();
  await saving;
  assert.deepEqual(writes, [['note.md', 'initial edit'], ['note.md', 'latest edit'], ['other.md', 'another note']]);
  assert.equal(drafts.size, 0);
});

test('a failed batch restores unattempted drafts without replacing newer edits', async () => {
  const { DraftWriter } = await import('../src/draft-writer.ts');
  const started = deferred();
  const inFlight = deferred();
  let failing = true;
  const writes = [];
  const drafts = new DraftWriter(async (path, content) => {
    writes.push([path, content]);
    if (failing) { started.resolve(); await inFlight.promise; throw new Error('retry later'); }
  });
  drafts.set('first.md', 'first');
  drafts.set('second.md', 'old second');
  const saving = drafts.flush();
  const rejected = assert.rejects(saving, /retry later/);
  await started.promise;
  drafts.set('second.md', 'new second');
  inFlight.resolve();
  await rejected;
  assert.equal(drafts.size, 2);
  failing = false;
  await drafts.flush();
  assert.deepEqual(writes, [['first.md', 'first'], ['second.md', 'new second'], ['first.md', 'first']]);
  assert.equal(drafts.size, 0);
});
