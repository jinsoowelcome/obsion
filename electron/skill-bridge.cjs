'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { VaultStore } = require('./vault.cjs');
const { keyFor } = require('./publish-manager.cjs');
const { AttachmentSelection } = require('./publish-attachments.cjs');
const { preparePublicNote, publicMarkdown } = require('./public-note.cjs');

const fail = (status, message, extra = {}) => Object.assign(Error(message), { status, ...extra });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const stamp = record => JSON.stringify(record || null);

// Only the running app owns the publishing key, records, and live Tunnel.
// The global skill reaches it over a user-private Unix socket, never a TCP port.
class SkillBridge {
  constructor({ directory, publisher, getVaultRoot = async () => null, drain = async () => {} }) {
    this.directory = directory;
    this.publisher = publisher;
    this.getVaultRoot = getVaultRoot;
    this.drain = drain;
    this.socketPath = path.join(directory, 'skill.sock');
    this.connectionFile = path.join(directory, 'skill-connection.json');
    this.token = crypto.randomBytes(32).toString('hex');
    this.preparations = new Map();
    this.queue = Promise.resolve();
  }

  async start() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    await fs.rm(this.socketPath, { force: true });
    this.server = http.createServer((request, response) => this.serve(request, response));
    this.server.requestTimeout = 10000;
    this.server.headersTimeout = 10000;
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.socketPath, () => { this.server.off('error', reject); resolve(); });
    });
    await fs.chmod(this.socketPath, 0o600);
    const temporary = this.connectionFile + '.tmp';
    await fs.writeFile(temporary, JSON.stringify({ version: 1, socketPath: this.socketPath, token: this.token, pid: process.pid }), { mode: 0o600 });
    await fs.rename(temporary, this.connectionFile);
  }

  stop() {
    this.preparations.clear();
    this.server?.close();
    this.server?.closeAllConnections();
    // Leave discovery in place on exit; the next app replaces the stale socket.
  }

  async serve(request, response) {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    try {
      const actual = Buffer.from(request.headers.authorization || '');
      const expected = Buffer.from('Bearer ' + this.token);
      if (request.headers.origin || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw fail(403, '허용되지 않은 로컬 공유 요청입니다.');
      if (request.method === 'GET' && request.url === '/status') {
        response.end(JSON.stringify({ ready: true, configured: await this.publisher.configured(), publications: await this.publisher.list() }));
        return;
      }
      if (request.method !== 'POST' || !['/prepare', '/publish', '/editing'].includes(request.url)) throw fail(404, '지원하지 않는 공유 요청입니다.');
      let length = 0;
      const chunks = [];
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 32768) throw fail(413, '공유 요청이 너무 큽니다.');
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(400, 'JSON 요청을 확인해 주세요.'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, '공유 요청을 확인해 주세요.');
      const task = this.queue.then(() => this.perform(request.url, input));
      this.queue = task.catch(() => {});
      response.end(JSON.stringify(await task));
    } catch (error) {
      response.statusCode = error.status || 400;
      response.end(JSON.stringify({ error: error.message, ...(error.publication ? { publication: error.publication } : {}) }));
    }
  }

  async source(file, chosenRoot) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.md$/i.test(file)) throw fail(400, '공유할 Markdown 파일의 절대 경로가 필요합니다.');
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw fail(400, '일반 Markdown 파일을 선택해 주세요.');
    const absolute = await fs.realpath(file);
    let root = chosenRoot || await this.getVaultRoot();
    const relative = root && path.relative(root, absolute);
    if (!root || !relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) root = path.dirname(absolute);
    const vault = new VaultStore(root);
    const target = await vault.checked(path.relative(root, absolute), { note: true, mustExist: true });
    return { file: absolute, root, note: await vault.readNote(target.absolute, target.relative) };
  }

  async perform(route, input) {
    await this.drain();
    await this.publisher.initialize();
    if (route === '/editing') {
      if (typeof input.enabled !== 'boolean' || input.enabled && (typeof input.pin !== 'string' || !/^\d{4}$/.test(input.pin))) throw fail(400, '편집 여부와 숫자 4자리 암호를 확인해 주세요.');
      const record = this.publisher.collaboration.find(input.id);
      await this.publisher.collaboration.configure(record.vaultRoot, record.id, input.enabled, input.pin);
      return { ...this.publisher.view(record), editUrl: input.enabled ? record.url + '/edit' : null, requiresRunningApp: input.enabled || !!record.attachments?.length };
    }
    if (route === '/prepare') return this.prepare(input);
    return this.publish(input);
  }

  async prepare(input) {
    for (const [id, value] of this.preparations) if (value.expires < Date.now()) this.preparations.delete(id);
    if (this.preparations.size >= 8) throw fail(429, '공유 미리보기가 많습니다. 기존 미리보기는 10분 뒤 만료됩니다.');
    const source = await this.source(input.file);
    const previous = this.publisher.records[keyFor(source.root, source.note.path)];
    if (previous && !previous.revoked && previous.collaboration) throw fail(409, '이미 공동 편집 중입니다. 기존 링크를 사용하거나 공동 편집을 끈 뒤 업데이트하세요.', { publication: this.publisher.view(previous) });
    if (input.editable !== undefined && typeof input.editable !== 'boolean') throw fail(400, '편집 여부를 확인해 주세요.');
    if (input.editable) {
      const body = source.note.content.replace(/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
      if (publicMarkdown(body) !== body.trim()) throw fail(400, '공동 편집 전에 본문의 숨김 주석을 별도 노트로 옮겨 주세요.');
    }
    const selection = new AttachmentSelection();
    const added = await selection.add(input.attachments || []);
    const existing = previous && !previous.revoked ? previous.attachments || [] : [];
    const attachments = [...new Map([...existing, ...added].map(file => [file.id, file])).values()];
    selection.resolve(attachments.map(file => file.id), existing);
    const options = { title: input.title ?? previous?.title, summary: input.summary ?? previous?.summary, theme: input.theme ?? previous?.theme, attachments: attachments.map(file => file.id) };
    const preview = preparePublicNote(source.note, { ...options, attachments });
    const origin = this.publisher.originFor(previous);
    if (!await this.publisher.configured(origin)) throw fail(503, '앱의 Cloudflare 공유 연결을 먼저 설정해 주세요.');
    if ((attachments.length || input.editable) && origin !== this.publisher.baseUrl) throw fail(400, '첨부와 공동 편집은 Cloudflare 링크에서 지원합니다. 이전 공유를 중지한 뒤 다시 공유하세요.');
    const preparationId = crypto.randomBytes(24).toString('hex');
    const value = { ...source, note: undefined, sourceHash: hash(source.note.content), options, preview, selection, editable: !!input.editable, previous: stamp(previous), expires: Date.now() + 600000 };
    this.preparations.set(preparationId, value);
    return { preparationId, expiresAt: value.expires, file: source.file, preview, editable: value.editable, previous: this.publisher.view(previous), requiresRunningApp: !!attachments.length || value.editable };
  }

  async publish(input) {
    const prepared = this.preparations.get(input.preparationId);
    if (!prepared || prepared.expires < Date.now()) throw fail(409, '공유 미리보기가 만료됐습니다. 다시 준비해 주세요.');
    if (input.digest !== prepared.preview.digest) throw fail(409, '확인한 미리보기의 digest가 필요합니다.');
    if (prepared.editable && (typeof input.pin !== 'string' || !/^\d{4}$/.test(input.pin))) throw fail(400, '편집 암호는 숫자 4자리로 입력해 주세요.');
    const source = await this.source(prepared.file, prepared.root);
    if (hash(source.note.content) !== prepared.sourceHash || stamp(this.publisher.records[keyFor(source.root, source.note.path)]) !== prepared.previous) throw fail(409, '미리보기 이후 원본이나 공유 설정이 바뀌었습니다. 다시 준비해 주세요.');
    // Consume before sending: an ambiguous network result must be inspected, not retried blindly.
    this.preparations.delete(input.preparationId);
    const inserted = new Map();
    for (const [id, file] of prepared.selection.files) if (!this.publisher.attachments.files.has(id)) {
      this.publisher.attachments.files.set(id, file);
      inserted.set(id, file);
    }
    let result;
    try {
      result = await this.publisher.publish(source.root, source.note, prepared.options, input.digest, prepared.previous);
      if (prepared.editable) {
        try { await this.publisher.collaboration.configure(source.root, result.status.id, true, input.pin); }
        catch (error) { throw fail(502, '읽기 링크는 생성됐지만 공동 편집 설정에 실패했습니다: ' + error.message, { publication: result.status }); }
      }
    } finally {
      for (const [id, file] of inserted) if (this.publisher.attachments.files.get(id) === file) this.publisher.attachments.files.delete(id);
    }
    return { ...(await this.publisher.publication(result.status.id)), editUrl: prepared.editable ? result.status.url + '/edit' : null, attachments: prepared.preview.attachments || [], requiresRunningApp: prepared.editable || !!prepared.preview.attachments?.length };
  }
}
module.exports = { SkillBridge };
