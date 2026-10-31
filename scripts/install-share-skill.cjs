'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function main() {
  const root = path.resolve(__dirname, '..');
  const source = path.join(root, 'skills/obsion-share');
  const target = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills/obsion-share');
  const appPath = process.env.OBSION_APP || path.join(root, 'release/mac/Obsion.app');
  await fs.cp(source, target, { recursive: true });
  const configuration = path.join(os.homedir(), '.config/obsion-share');
  await fs.mkdir(configuration, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(configuration, 'config.json'), JSON.stringify({ appPath }, null, 2) + '\n', { mode: 0o600 });
  console.log('전역 스킬 설치 완료: ' + target);
  console.log('Obsion 앱 연결: ' + appPath);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
