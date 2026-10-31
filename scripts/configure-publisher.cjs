'use strict';
const { app, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { PublishManager } = require('../electron/publish-manager.cjs');
app.setName('Obsidian Replica');
app.setPath('userData', process.env.OBSION_USER_DATA || path.join(app.getPath('appData'), 'Obsidian Replica'));
app.whenReady().then(async () => {
  const directory = path.join(app.getPath('userData'), 'publishing');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const files = await fs.readdir(directory);
  if (!files.includes('private-key.pem') && !files.includes('private-key.encrypted')) {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    await fs.writeFile(path.join(directory, 'private-key.pem'), privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' });
  }
  const manager = new PublishManager({ directory, baseUrl: '', storage: safeStorage });
  const publicKey = crypto.createPublicKey(await manager.identity()).export({ format: 'jwk' }).x;
  const configPath = path.join(__dirname, '../publish-service/wrangler.jsonc');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  config.vars.PUBLISHER_PUBLIC_KEY = publicKey;
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log('이 기기의 공개 게시 키를 Cloudflare 설정에 연결했습니다. 개인 키는 앱 데이터 폴더에 보관됩니다.');
  app.quit();
}).catch(error => { console.error(error.message); app.exit(1); });
