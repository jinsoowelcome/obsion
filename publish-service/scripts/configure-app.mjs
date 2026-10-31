import fs from 'node:fs/promises';
const url = new URL(process.argv[2] || '');
if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('HTTPS 서버의 기본 주소를 입력하세요.');
const response = await fetch(url.origin + '/health', { redirect: 'error' });
const health = await response.json();
if (!response.ok || !health.ok || health.provider !== 'cloudflare' || !health.publisherConfigured) throw new Error('D1과 게시 키가 준비된 Obsion Cloudflare 서버인지 확인하지 못했습니다.');
await fs.writeFile(new URL('../../electron/publish-config.json', import.meta.url), JSON.stringify({ baseUrl: url.origin }, null, 2) + '\n');
console.log('앱 공유 주소 설정 완료:', url.origin);
