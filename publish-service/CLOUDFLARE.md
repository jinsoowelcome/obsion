# Obsion 공유 서버 — Cloudflare Workers + D1

공유 서버는 `worker/cloudflare.ts`를 Cloudflare Workers에 직접 배포합니다. Sites의 배포·인증·커넥터 없이 동작하며, 기존 읽기 페이지 디자인과 앱의 Ed25519 서명 API를 사용합니다. 이전 Sites 프레임워크 파일은 참고용으로 남아 있고 현재 npm 실행 스크립트에는 연결되지 않습니다.

현재 서버는 https://obsion-publish.jinsoowelcome.workers.dev 입니다. `jinsoowelcome@gmail.com` 계정의 `obsion-publish` Worker와 APAC의 동명 D1 DB를 사용합니다. 이 맥의 앱 게시 키로 실제 게시·수정·공유 중지(404)를 확인했습니다. 앱의 `electron/publish-config.json`도 이 주소를 사용합니다.

## 최초 연결

Node.js 22.13 이상(22.x)에서 저장소 루트의 의존성과 서버 의존성을 설치합니다.

```sh
npm ci
npm --prefix publish-service ci
npm run share:key
cd publish-service
npx wrangler login
npm run db:create
```

`share:key`는 기존 앱 게시 키를 재사용하거나 새 키를 생성합니다. 개인 키는 앱 데이터 폴더에만 저장하고, 가능한 경우 Electron safeStorage로 암호화합니다. 공개 키만 `wrangler.jsonc`의 `PUBLISHER_PUBLIC_KEY`에 기록합니다. 다른 기기의 키를 배포하면 그 기기가 게시 권한을 갖게 되므로 현재 작업 기기에서 실행하세요.

`db:create` 출력의 데이터베이스 ID를 `wrangler.jsonc`의 `d1_databases[0].database_id`에 넣습니다. 여러 Cloudflare 계정이 있으면 설정 파일의 `account_id` 또는 `CLOUDFLARE_ACCOUNT_ID`로 배포 계정을 지정합니다. 초기 UUID는 로컬 개발용 자리 표시자입니다.

```sh
npm run db:migrate
npm run build
npm run deploy
```

배포 결과의 HTTPS 주소를 앱에 연결합니다.

```sh
npm run configure:app -- https://obsion-publish.<계정서브도메인>.workers.dev
cd ..
npm run package
open release/mac/Obsion.app
```

`configure:app`은 `/health`에서 D1 연결과 게시 키 설정을 확인한 뒤 앱 주소를 저장합니다. 비밀 Cloudflare 토큰은 저장소에 기록하지 않습니다. `wrangler login` 또는 환경 변수 `CLOUDFLARE_API_TOKEN`을 사용합니다.

## 개발과 검증

```sh
# 저장소 루트: 실제 SQLite로 서명 API·게시·삭제·재전송 차단 검증
npm test
# 이 맥의 게시 키로 실제 서버에 확인용 문서를 게시·수정·삭제
npm run share:check
# 서버 타입 검사와 배포 번들 생성 (실제 배포 없음)
npm --prefix publish-service run build
```

macOS 12에서는 최신 Workers 로컬 실행기(workerd)의 OS 요구 사항 때문에 로컬 미리보기가 실패할 수 있습니다. 배포 번들 생성은 로컬 실행기를 시작하지 않습니다. 지원되는 OS에서 `npm run db:migrate:local`과 `npm start`를 사용하세요. 원격 미리보기가 필요하면 별도의 개발 D1 DB를 생성하고 `wrangler.jsonc`의 D1 바인딩에 그 ID를 `preview_database_id`로 설정한 뒤 `npm run dev`를 실행합니다.

앱은 `OBSION_PUBLISH_URL` 환경 변수로 서버 주소를 임시 지정할 수 있습니다. 로컬 HTTP 연결은 `OBSION_ALLOW_LOCAL_PUBLISH=1`을 명시한 경우의 `127.0.0.1`만 허용합니다.

## API와 저장

- `GET /health`: D1 준비 상태와 게시 키 설정 상태
- `GET /p/<id>`: 공개 읽기 페이지
- `GET /api/pages/<id>`: 공개 문서 JSON
- `PUT /api/pages/<id>`: 서명된 게시·수정
- `DELETE /api/pages/<id>`: 서명된 공유 중지
- `PUT /api/attachment-host`: 서명된 로컬 다운로드 터널 등록·30초 간격 연결 갱신
- `GET /p/<id>/files/<file-id>`: 공개 노트에 포함된 첨부파일 다운로드
- `PUT /api/pages/<id>/editing`: 게시자의 서명으로 공동 편집 켜기·끄기
- `GET /p/<id>/edit`: 브라우저 편집 화면
- `POST /api/pages/<id>/collab/login`: 이름·PIN으로 로컬 편집 세션 생성
- `POST /api/pages/<id>/collab/updates`: 세션 인증 후 OT 변경 전송·가져오기

문서는 D1의 `published_pages`에 저장합니다. `publish_nonces`의 고유 키로 서명 재전송을 막고 10분이 지난 nonce를 정리합니다. 서명은 요청 시각, nonce, HTTP 메서드, 경로, 본문을 포함합니다. 본문은 200KiB, 전체 요청은 300,000바이트까지 허용하며 서버에서도 내용 digest를 확인합니다.

공개 HTML은 노트의 HTML을 이스케이프하고 외부 이미지·스크립트·추적 리소스를 로드하지 않습니다. 보관함 목록은 공개하지 않습니다. 사용자가 선택한 첨부파일만 다운로드 목록에 포함합니다. Cloudflare의 현재 요금제 한도와 D1 사용량은 Cloudflare 대시보드에서 확인하세요.

## 로컬 첨부 다운로드 (R2 사용 안 함)

첨부파일 바이트는 이 PC의 앱 데이터 `publishing/attachments/<page-id>/<file-id>`에 보관합니다. 파일명·크기·SHA-256만 D1의 노트 메타데이터에 기록합니다. 파일당 5MiB, 최대 10개·합계 10MiB를 허용합니다. 공유 창의 명시적인 파일 선택을 통해서만 로컬 파일을 가져오며 원래 경로는 서버나 웹 페이지에 보내지 않습니다.

이 맥에는 공식 `cloudflared` 2026.10.7 x64를 `~/.local/bin/cloudflared`에 설치했습니다. 다른 PC에서는 [공식 설치 안내](https://developers.cloudflare.com/tunnel/downloads/)에 따라 설치한 후 해당 경로에 놓거나 `OBSION_CLOUDFLARED` 환경 변수로 실행 파일 경로를 지정합니다.

앱은 로컬 서버를 `127.0.0.1`의 임의 포트에 바인딩하고 Quick Tunnel을 실행합니다. 임의 Bearer 토큰이 없는 요청은 로컬 서버에서 거부합니다. Worker는 공개 노트에 현재 포함된 파일인지 확인하고, 90초 이내 갱신된 터널에만 요청을 전달합니다. 파일 크기와 SHA-256을 확인한 뒤 `Content-Disposition: attachment`와 UTF-8 파일명을 설정합니다. 터널 주소와 토큰은 공개 API·페이지에 포함하지 않습니다.

[Lithos의 로컬 공유 구현](https://github.com/beaur8-prog/lithos/blob/main/electron/share-tunnel.cjs)을 참고해 터널 URL과 실제 연결 완료를 모두 확인하고, 별도 설정 파일·환경 변수 격리·임의 metrics 포트·HTTP/2 연결을 사용합니다. 첨부 공유 중에는 자동 잠자기를 막습니다. 사용자가 직접 잠자기를 선택하거나 네트워크를 끊으면 다운로드는 중지됩니다.

PC·인터넷·앱이 중지되면 노트 페이지는 계속 읽을 수 있고 파일 다운로드는 503 안내를 반환합니다. 앱이 다시 실행되면 새 터널 주소를 등록하므로 기존 다운로드 링크를 유지합니다. 공유 중지 또는 첨부 제거 후 해당 다운로드 경로는 404를 반환합니다. 공유를 중지하면 로컬 공유 사본도 삭제합니다.

[Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)는 계정·도메인 없이 임시 주소를 제공하지만 가동 시간을 보장하지 않습니다. 이 구현은 로컬 PC에서 파일을 전달하기 위한 방식이며 R2 활성화나 R2 결제를 요구하지 않습니다. 이 버전은 한 게시 키에 하나의 PC 다운로드 호스트를 사용합니다.

## 브라우저 공동 편집

[Lithos의 공동 편집 설계](https://github.com/beaur8-prog/lithos/blob/main/electron/share-collaboration.cjs)를 참고해 CodeMirror의 OT 변경 이력·참여자 세션·로컬 원본 백업을 사용합니다. 앱에서 공유한 문서에 명시적으로 편집을 켜야 합니다. PIN은 숫자 4자리이고 scrypt salt/hash만 로컬 공유 기록에 보관합니다. Cloudflare에는 PIN을 저장하지 않으며 로그인·편집 요청을 인증된 터널로 원본 PC에 전달합니다. 암호를 5번 틀리면 해당 문서와 요청 IP의 로그인을 1분간 제한합니다. 세션은 메모리에만 보관하며 최대 8시간, 문서당 최대 32명입니다.

브라우저는 2초 간격으로 다른 사람의 변경을 받고 입력 후 약 350ms부터 자동 저장합니다. 서버는 클라이언트의 기준 버전에서 변경을 재배치해 동시에 편집한 내용을 병합합니다. 중복 재전송을 제외하고, 이력 범위를 벗어난 세션·외부 편집기로 변경된 원본은 409로 중지합니다. 브라우저는 미전송 입력을 지우지 않고 재참여와 복사 버튼을 제공합니다.

`electron/shared-editing.cjs`가 보관함 경로를 검증하고 원본을 원자적으로 저장합니다. YAML prefix는 유지하고 본문만 편집하며 200KiB 한도를 적용합니다. 본문 숨김 주석은 공동 편집 전 분리해야 하고 편집 중에도 새 숨김 주석·YAML prefix 추가는 거부합니다. 변경된 공개 본문과 digest는 Worker가 D1에 반영하며, 실패 시 후속 동기화 요청에서 최신 로컬 상태를 다시 반영합니다. 공동 편집을 끌 때도 최신 공개본을 반영합니다.

편집 중인 노트는 데스크톱에서 읽기 전용이며 이름 변경·삭제·일반 게시 업데이트를 차단합니다. 선택한 첨부 사본은 브라우저 편집으로 바뀌지 않고 새 로컬 파일을 자동으로 읽지 않습니다. 활성 첨부 또는 공동 편집이 있으면 앱이 자동 잠자기를 방지합니다. 본문 변경 전 원본은 `publishing/edit-backups/`에 저장하며 개인 키와 함께 공개 저장소에 넣지 않습니다.

`npm run build:share`는 브라우저 편집기 자산을 `publish-service/generated/`에 생성합니다. 서버의 build/deploy 스크립트가 이 단계를 실행하고 Worker Assets 바인딩으로 `/editor.js`를 제공합니다. 코드 변경 후 정적 편집기와 Worker를 함께 배포하세요.

## 전역 공유 스킬·암호 변경·목록 조회

2026-10-31 기준 `obsion-share`를 Codex 전역 스킬로 설치했습니다. 저장소 루트에서 `npm run package`와 `npm run skill:install`로 앱을 빌드하고 전역 설치·앱 위치 등록을 다시 할 수 있습니다. 스킬 원본과 사용 예시는 [SKILL.md](../skills/obsion-share/SKILL.md)에 있습니다.

“옵시언으로 공유해줘”, “옵시언으로 이 파일 첨부해서 공유해줘”, “옵시온으로 편집 가능하게 공유해줘. 암호는 1234”, “옵시온 공유 링크 암호를 5678로 바꿔줘”, “옵시언에서 현재 공유중인 페이지 알려줘” 요청을 지원합니다. 숫자는 예시이며 기본 암호는 없습니다.

스킬 도우미는 `electron/skill-bridge.cjs`의 사용자 전용 Unix 소켓으로 실행 중인 앱에 요청합니다. `prepare`로 공개 미리보기·첨부 목록을 확인하고 `publish`로 게시하며, 개인 키는 앱에 남겨 둡니다. `status`와 `list`는 앱의 로컬 공유 기록을 조회하고, `editing`은 선택한 페이지의 편집 여부와 PIN을 변경합니다. 이 로컬 API를 Cloudflare나 TCP 포트에 노출하지 않습니다.

PIN을 변경하면 같은 문서 ID·URL에 새 scrypt salt/hash를 적용하고 기존 참여 세션을 무효화합니다. 평문 PIN은 저장하지 않으며 요청 JSON의 표준 입력으로 전달합니다. 참여자는 새 PIN으로 다시 접속해야 합니다. 목록은 현재 기기에서 관리하는 공유만 포함하며 중지한 항목을 제외합니다. 게시 결과가 불확실한 `pending` 항목은 별도로 표시합니다.

전체 자동 테스트 37개와 macOS 12 Intel 패키징, 설치한 도우미의 실제 앱 연결·로컬 미리보기를 확인했습니다. PIN 변경과 목록 필터링은 별도 로컬 통합 테스트로 검증했으며, 전역 도우미 연결 확인 자체는 운영 페이지를 새로 게시하지 않았습니다. 자세한 작업 기록은 [인수인계 문서](../OBSION_HANDOFF.md)와 [구현 가이드](../docs/앱_공유페이지_첨부파일_공동편집_구현가이드.md)에 있습니다.

## 기존 Sites 공유

새 Cloudflare DB에는 기존 Sites D1 데이터가 자동으로 복사되지 않습니다. 현재 연결 계정으로는 이전 Sites 프로젝트에 접근하지 못했습니다. 기존 URL은 Sites 주소를 계속 사용하며, 앱은 기존 공유 기록의 URL로 수정·공유 중지를 요청합니다. 이를 위해서는 해당 기존 기기의 서명 개인 키도 필요합니다. 새로 공유한 노트만 설정된 Cloudflare 주소를 사용합니다.

기존 URL까지 옮기려면 이전 DB 내보내기와 도메인 리디렉션 권한이 별도로 필요합니다. `.chatgpt.site` 호스트를 Cloudflare 계정에서 직접 소유하거나 연결할 수는 없습니다.
