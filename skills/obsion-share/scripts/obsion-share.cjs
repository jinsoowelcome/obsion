#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function request(connection, route, input) {
  return new Promise((resolve, reject) => {
    const body = input === undefined ? null : JSON.stringify(input);
    const outgoing = http.request({ socketPath: connection.socketPath, path: route, method: body === null ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + connection.token, ...(body === null ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }) } }, incoming => {
      let bytes = 0;
      const chunks = [];
      incoming.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) outgoing.destroy(Error('앱 응답이 너무 큽니다.'));
        else chunks.push(chunk);
      });
      incoming.on('error', reject);
      incoming.on('end', () => {
        let result;
        try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { reject(Error('앱의 JSON 응답을 확인할 수 없습니다.')); return; }
        if (incoming.statusCode >= 400) reject(Object.assign(Error(result.error || '공유 요청에 실패했습니다.'), { result }));
        else resolve(result);
      });
    });
    outgoing.on('error', reject);
    outgoing.setTimeout(180000, () => outgoing.destroy(Error('앱의 응답 시간이 초과됐습니다. list로 공유 상태를 먼저 확인해 주세요.')));
    outgoing.end(body);
  });
}

async function readConnection(directory) {
  const file = path.join(directory, 'skill-connection.json');
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077)) throw Error('앱의 비공개 연결 파일 권한을 확인해 주세요.');
  const connection = JSON.parse(await fs.readFile(file, 'utf8'));
  if (connection.version !== 1 || connection.socketPath !== path.join(directory, 'skill.sock') || !/^[a-f0-9]{64}$/.test(connection.token)) throw Error('앱 연결 정보의 형식을 확인해 주세요.');
  return connection;
}

async function connect() {
  const directory = process.env.OBSION_USER_DATA || path.join(os.homedir(), 'Library/Application Support/Obsidian Replica');
  async function available() {
    const connection = await readConnection(directory);
    await request(connection, '/status');
    return connection;
  }
  try { return await available(); } catch (error) {
    if (!['ENOENT', 'ECONNREFUSED', 'ECONNRESET'].includes(error.code)) throw error;
  }
  if (process.platform !== 'darwin') throw Error('이 Obsion 공유 연결은 macOS 앱이 필요합니다.');
  let config = {};
  try { config = JSON.parse(await fs.readFile(path.join(os.homedir(), '.config/obsion-share/config.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const candidates = [process.env.OBSION_APP, config.appPath, '/Applications/Obsion.app', path.join(os.homedir(), 'Applications/Obsion.app'), path.resolve(__dirname, '../../../release/mac/Obsion.app')].filter(Boolean);
  let appPath;
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && candidate.endsWith('.app') && await fs.stat(candidate).then(info => info.isDirectory(), () => false)) { appPath = candidate; break; }
  }
  if (!appPath) throw Error('Obsion 앱을 찾지 못했습니다. OBSION_APP에 앱 경로를 지정하거나 저장소에서 npm run skill:install을 실행해 주세요.');
  await new Promise((resolve, reject) => {
    const child = spawn('open', ['-a', appPath], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(Error('Obsion 앱을 실행하지 못했습니다.')));
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    await delay(500);
    try { return await available(); } catch (error) {
      if (!['ENOENT', 'ECONNREFUSED', 'ECONNRESET'].includes(error.code)) throw error;
    }
  }
  throw Error('Obsion 공유 연결이 준비되지 않았습니다. 최신 앱을 실행하고 이전 버전이 열려 있다면 저장 후 재시작해 주세요.');
}

async function main() {
  const command = process.argv[2];
  if (command === '--help' || command === '-h') {
    console.log('obsion-share: list | status | prepare | publish | editing\nprepare/publish/editing accept one JSON object on stdin. PINs belong on stdin, never command arguments.');
    return;
  }
  const route = { list: '/status', status: '/status', prepare: '/prepare', publish: '/publish', editing: '/editing' }[command];
  if (!route || process.argv.length !== 3) throw Error('명령은 list, status, prepare, publish, editing 중 하나이며 요청 JSON은 표준 입력으로 전달하세요.');
  let input;
  if (!['list', 'status'].includes(command)) {
    let bytes = 0;
    const chunks = [];
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 32768) throw Error('요청 JSON은 32KiB까지 지원합니다.');
      chunks.push(chunk);
    }
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Error('표준 입력에 올바른 JSON 요청이 필요합니다.'); }
  }
  const connection = await connect();
  console.log(JSON.stringify(await request(connection, route, input), null, 2));
}

if (require.main === module) main().catch(error => { console.error(JSON.stringify(error.result || { error: error.message })); process.exitCode = 1; });
module.exports = { request, readConnection };
