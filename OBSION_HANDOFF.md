# 옵시온(Obsion) 프로젝트 인수인계

공동 편집 업데이트: 공유 창에서 4자리 PIN으로 편집을 켜면 링크 참여자가 브라우저에서 함께 편집할 수 있습니다. CodeMirror OT로 변경을 병합해 로컬 원본에 자동 저장하고 공개 D1 본문도 갱신합니다. 원본 백업·YAML 보존·앱 읽기 전용 잠금·외부 변경 충돌 거부를 포함합니다. `electron/shared-editing.cjs`, `src/ShareEditor.ts`, `publish-service/CLOUDFLARE.md`가 현재 구현입니다.

첨부 다운로드 업데이트: 공유 창에서 선택한 파일을 이 PC의 앱 데이터에 복사해 두고 Cloudflare Quick Tunnel을 통해 다운로드하도록 구현했습니다. R2는 사용하지 않습니다. 다운로드 시 게시자의 PC·인터넷·Obsion 앱이 실행 중이어야 합니다. 파일당 5MiB, 최대 10개·합계 10MiB입니다. 최신 동작은 README와 `publish-service/CLOUDFLARE.md`를 참고하세요.

Cloudflare 전환 업데이트: 공유 서버를 `https://obsion-publish.jinsoowelcome.workers.dev`에 배포하고 앱에 연결했습니다. 실제 서버에서 확인용 문서의 게시·수정·삭제 후 404를 검증했습니다. 실행 진입점은 `publish-service/worker/cloudflare.ts`, 배포 설정은 `publish-service/wrangler.jsonc`입니다. [현재 배포 절차](publish-service/CLOUDFLARE.md)를 우선 참고하세요. 아래 Sites 소유권·배포 설명은 이전 서비스에만 적용됩니다. 기존 공유 기록은 해당 기록의 기존 서버로 관리합니다.

작성 기준: **2026-10-25, 한국 시간**. 새 Codex 계정이나 새 작업 환경에서 이 문서를 먼저 읽고 개발을 이어가기 위한 기록입니다. 비밀 키와 로그인 토큰의 실제 값은 포함하지 않습니다.

2026-10-31 업데이트: 현재 작업 저장소는 macOS 12 Intel(x64)을 기준으로 Node.js 22, Electron 43.8.4, `release/mac/Obsion.app` 패키징을 사용합니다. 아래의 옛 설치 경로와 Apple Silicon 환경 기록은 이전 개발 Mac에서 작성한 내용이며, 현재 기기의 설치·노트·공유 상태를 뜻하지 않습니다.

## 1. 먼저 알아둘 현재 상태

**옵시온은 실행 가능한 macOS 마크다운 노트 앱입니다.** 처음에는 Obsidian을 분석해 독립적으로 만든 `Obsidian Replica`라는 이름이었고, 사용자가 선택한 이름인 **옵시온(Obsion)**으로 바꿨습니다.

- 앱 개발, macOS 앱 설치, `.md` 파일의 기본 앱 연결까지 완료했습니다.
- 노트 한 장을 공개 링크로 공유하는 서버를 구현하고 실제 웹에 배포했습니다.
- 앱과 웹 공유 페이지 모두 새 이름을 적용했습니다. 기존 문서와 공유 링크는 유지했습니다.
- 전체 소스를 [GitHub: jinsoowelcome/obsion](https://github.com/jinsoowelcome/obsion)의 `main`에 업로드했습니다.
- 이 문서 작성 시 자동 테스트 **22개가 모두 통과**했습니다. 설치된 앱의 실행과 `.md` 기본 앱 연결, 공개 웹페이지 3곳의 HTTP 200 응답도 확인했습니다.

**소스를 가져오는 것과 기존 웹 공유 서비스의 관리 권한을 넘기는 것은 별개입니다.** 특히 계정 이전 시에는 8절을 먼저 확인하세요.

## 2. 새 계정에서 바로 이어가는 순서

### 같은 Mac에서 Codex 계정만 바꾸는 경우

1. 새 계정으로 Codex에 로그인합니다. 같은 macOS 사용자 계정을 계속 쓴다면 아래의 소스·앱·노트 폴더는 그대로 남아 있습니다.
2. 기존 작업 폴더를 엽니다.

   ```sh
   cd "/Users/jinsoojeon/work/rea실습/obsidian-replica"
   git status --short --branch
   git log -3 --oneline
   ```

3. 이 파일을 새 대화에 첨부하거나 읽도록 지시합니다. 마지막 절의 요청문을 그대로 사용해도 됩니다.
4. `npm test`로 현재 상태를 확인합니다. 앱을 실행하려면 다음 명령을 사용합니다.

   ```sh
   open "$HOME/Applications/Obsion.app"
   ```

5. GitHub와 Sites 연결은 새 계정에서 따로 확인합니다. 기존 Sites 프로젝트에 접근할 수 있는지는 `get_site`로 확인해야 합니다.
6. 기존 노트 폴더와 앱 설정 폴더를 초기화하지 않습니다. 공유 기능을 유지하려면 macOS 키체인도 그대로 사용해야 합니다.

### 새 컴퓨터나 새 macOS 사용자로 옮기는 경우

1. 아래 GitHub 저장소를 복제합니다.
2. 개인 노트 보관함은 GitHub에 없으므로 따로 옮깁니다.
3. 기존 공유를 관리하려면 공유 기록, 키, macOS 키체인과 Sites 접근 권한을 별도로 검토합니다. 암호화된 키 파일만 복사해서는 동작이 보장되지 않습니다.
4. 먼저 로컬 앱 개발을 재개하고, 기존 공유 서버의 이전은 8절에 따라 별도로 진행합니다.

```sh
git clone https://github.com/jinsoowelcome/obsion.git
cd obsion
npm ci
npm test
npm run build
npm run desktop
```

`npm run desktop`은 빌드한 `dist/`를 엽니다. 화면을 수정했다면 다시 `npm run build`를 실행합니다. 브라우저 개발 미리보기는 `npm run dev`이며, 브라우저에서는 시험용 로컬 저장소를 사용합니다.

## 3. 지금까지 한 작업

| 순서 | 작업 | 결과 |
| --- | --- | --- |
| 1 | Codex 작업 환경과 개발 도구 준비 | 터미널, Node.js/npm, GitHub CLI 등을 사용해 개발 환경을 구성했습니다. |
| 2 | Browser Use·Computer Use 전역 스킬 구성 | 브라우저 제어 스킬을 설치하고, 현재 Codex 컴퓨터 제어 도구에 맞는 스킬을 구성했습니다. |
| 3 | 원본 Obsidian 설치 | `/Applications/Obsidian.app`을 분석 대상으로 준비했습니다. |
| 4 | REA MCP 설치 | `rea-agents@6.7.0`과 `reverse-engineer-anything` 스킬을 연결했습니다. |
| 5 | 네이티브 분석 도구 설치 | Temurin JDK 21과 Ghidra 12.1.4를 준비하고 Mac arm64 분석 프로그램을 빌드했습니다. 별도 시험 실행 파일의 디컴파일도 확인했습니다. |
| 6 | Obsidian 분석 | 설치된 1.14.5의 패키지 구조와 JavaScript를 REA로 분석하고 실제 화면을 관찰했습니다. |
| 7 | 노트 앱 새 구현 | React·Electron·CodeMirror를 사용해 편집기, 파일 보관함, 링크, 검색, 그래프 등을 독립적으로 구현했습니다. |
| 8 | 안정성 보완과 설치 | 저장 중 종료, 실패한 저장의 재시도, 동시 편집 중 초안 보존, 경로 검사와 이름 충돌 등을 보완하고 macOS 앱으로 설치했습니다. |
| 9 | 설명 문서 작성 | 분석·제작 과정과 Codex 설치부터 복제 준비까지의 단계별 매뉴얼을 실제 보관함에 작성했습니다. |
| 10 | `.md` 기본 앱 지정 | Finder 등에서 마크다운 파일을 열면 이 앱이 실행되도록 연결했습니다. |
| 11 | 페이지 공유 조사와 구현 | Obsidian Publish의 흐름을 조사하고 별도 공유 서버와 앱의 공유 화면을 구현했습니다. |
| 12 | 이름 변경 | 사용자 선택에 따라 Obsidian Replica를 옵시온(Obsion)으로 변경하고 기존 데이터와 공개 링크를 유지했습니다. |
| 13 | GitHub 업로드 | 데스크톱과 공유 서버 소스 158개 파일을 `main`에 올렸습니다. 이 인수인계 파일은 그 이후 추가하는 문서입니다. |

Obsidian 복제 작업의 중심은 **REA의 JavaScript 분석과 화면 관찰**이었습니다. Ghidra로 Obsidian 전체를 디컴파일한 결과를 그대로 옮긴 프로젝트가 아닙니다. 원본 앱의 소스나 번들을 복사해 실행하지 않습니다.

## 4. 경로와 저장소

### 이전 개발 Mac의 실제 경로 (2026-10-25)

| 대상 | 경로 |
| --- | --- |
| 작업 폴더 | `/Users/jinsoojeon/work/rea실습/obsidian-replica` |
| 설치된 앱 | `/Users/jinsoojeon/Applications/Obsion.app` |
| 실제 노트 보관함 | `/Users/jinsoojeon/Documents/Obsidian Replica Vault` |
| 앱 설정·데이터 | `/Users/jinsoojeon/Library/Application Support/Obsidian Replica` |
| 선택한 보관함 기록 | 위 설정 폴더의 `vault.json` |
| 공유 키와 게시 기록 | 위 설정 폴더의 `publishing/` |
| 원본 Obsidian | `/Applications/Obsidian.app` |
| 당시 패키지 생성 위치 | 작업 폴더의 `release/mac-arm64/Obsion.app` |

작업 폴더 이름의 한글은 파일시스템에서 유니코드 정규화 방식이 다르게 보일 수 있습니다. 경로 문자열을 새로 조합하기보다 실제 폴더를 선택하거나 따옴표로 감싸 사용하세요.

**현재 보관함의 옛 이름은 그대로 유지한 정상 상태입니다.** 새로 설치한 환경의 기본 보관함 이름만 `~/Documents/Obsion Vault`입니다. 기존 폴더를 무작정 새 이름으로 바꾸면 공유 기록의 경로 식별에도 영향을 줄 수 있습니다.

### GitHub

- 저장소: <https://github.com/jinsoowelcome/obsion>
- 기본 브랜치: `main`
- 인수인계 문서 추가 전 소스 커밋: `8c23a651b47823cb9749da42d0e84e6e6990fa09`
- 해당 커밋: <https://github.com/jinsoowelcome/obsion/commit/8c23a651b47823cb9749da42d0e84e6e6990fa09>
- 마지막 커밋은 `git log -1 --oneline`로 확인합니다. 위 해시는 이 문서 자체를 포함하는 해시가 아닙니다.
- 저장소는 공개 상태입니다. 복제는 가능하지만 푸시에는 쓰기 권한이 있는 GitHub 로그인이 필요합니다.

GitHub 연결 도구는 업로드 당시 읽기 권한만 확인됐으므로, 실제 푸시는 GitHub CLI에 로그인된 `jinsoowelcome` 계정으로 수행했습니다. 새 계정에서도 연결 도구의 권한과 CLI의 로그인 상태가 같다고 가정하지 마세요. `gh auth status`와 저장소 권한을 확인하면 됩니다.

GitHub에는 의존성·설치 앱·빌드 결과·개인 노트·개인 키·로컬 DB를 올리지 않았습니다. `evidence/rea-evidence.json`도 로컬 분석 전용으로 제외했습니다. 분석 보고서와 시험용 보관함의 화면 캡처는 포함했습니다.

## 5. 앱 기능과 소스 구조

### 구현한 기능

- 일반 `.md` 파일 생성, 편집, 자동 저장, 이름 변경과 중첩 폴더.
- 실시간 미리보기, 마크다운 원문, 읽기 모드.
- `[[노트]]`와 `[[노트|표시 이름]]`, 폴더를 고려한 링크 해석, 백링크.
- 연결 그래프와 노드 이동, 확대·축소, 패널 크기 조절.
- 전체 내용 검색, 빠른 전환기, 탭, 이전·다음 이동.
- 북마크, 일일 노트, 명령어 팔레트, 문서 개요.
- 밝은·어두운·시스템 테마, 글꼴 크기, 줄 번호와 읽기 너비.
- 네이티브 폴더 열기·새 보관함, `.md` 파일의 OS 열기 요청 처리.
- 휴지통 `.trash`를 통한 복구 가능한 삭제.
- 현재 노트의 웹 공유, 미리보기, 업데이트, 링크 복사·열기, 공유 중지와 게시 목록.

실시간 미리보기에서 노트 링크는 `⌘+클릭`, 읽기 모드에서는 일반 클릭으로 엽니다. 외부 편집기로 파일을 수정했다면 명령어 팔레트의 **보관함 파일 새로고침**을 사용합니다.

보관함은 일반 폴더이며, 로그인한 클라우드 계정에 자동 저장되는 구조가 아닙니다. 다른 폴더에 있는 `.md` 한 개를 OS로 열면 주변 파일 전체를 자동 수집하지 않고 개별 문서로 처리합니다.

### 주요 파일

| 파일 | 담당 |
| --- | --- |
| `src/App.tsx` | 앱 화면·탭·검색·설정·단축키와 기능 연결 |
| `src/MarkdownEditor.tsx` | CodeMirror 기반 편집기와 보기 모드 |
| `src/draft-writer.ts` | 저장 대기열, 실패한 초안 보존과 종료 전 저장 |
| `src/Graph.tsx` | 위키 링크에서 만든 노트 그래프 |
| `src/lib.ts`, `src/render-markdown.ts` | 링크 해석과 마크다운 표시 |
| `src/browser-vault.ts` | 브라우저 미리보기용 저장소 |
| `src/PublishDialog.tsx`, `src/publish.css` | 공유 설정·미리보기·게시 목록 화면 |
| `electron/main.cjs` | 창, 메뉴, IPC, 보관함 선택과 공유 기능 연결 |
| `electron/preload.cjs` | 화면이 사용할 수 있는 명시적인 앱 API |
| `electron/vault.cjs` | 파일 읽기·쓰기·이름 변경·휴지통과 경로 검사 |
| `electron/document-open.cjs` | OS에서 요청한 `.md` 파일 열기 |
| `electron/public-note.cjs` | 공개할 본문 정리, 크기 제한과 미리보기 digest |
| `electron/publish-manager.cjs` | 개인 키 보관, 서명 요청과 게시 기록 관리 |
| `electron/publish-config.json` | 공유 서버 주소 |
| `publish-service/app/p/[id]/page.tsx` | 공개 문서 읽기 페이지 |
| `publish-service/app/api/pages/[id]/route.ts` | 공개 조회와 서명된 게시·삭제 API |
| `publish-service/lib/auth.ts` | 허용 공개 키와 Ed25519 서명 검사 |
| `publish-service/lib/render.ts` | 공개 본문의 마크다운 표시 |
| `publish-service/db/schema.ts`, `publish-service/drizzle/` | D1 테이블 구조와 SQL 마이그레이션 |
| `tests/` | 저장·초안·링크·공유 기능 테스트 |
| `evidence/ANALYSIS.md`, `evidence/PUBLISH.md` | 원본 분석 및 공유 기능의 근거와 검증 범위 |

공유 미리보기는 서버의 `publish-service/lib/render.ts`를 재사용합니다. 데스크톱만 작업하더라도 이 파일을 임의로 빼거나 경로를 옮기면 빌드에 영향을 줍니다.

### 개발과 패키징

이전 개발 환경은 macOS Apple Silicon, Node.js **24.13.1**, npm **11.8.0**, Electron **45.0.0**이었습니다. 현재 macOS 12 Intel 환경은 Node.js **22.22.1**, npm **10.9.4**, Electron **43.8.4**로 빌드·패키징·실행을 확인했습니다. 정확한 의존성은 각 `package-lock.json`을 사용합니다.

```sh
npm ci
npm test
npm run build
npm run desktop
```

```sh
npm run package
```

현재 x64 패키징 결과는 `release/mac/Obsion.app`입니다. 이 명령은 다른 위치에 설치된 앱을 자동으로 바꾸지 않습니다. 설치 앱을 교체할 때는 기존 앱이 저장을 마치고 정상 종료된 뒤 진행합니다.

개발 중 보관함·앱 데이터 경로를 분리할 수 있는 환경 변수는 `OBSION_VAULT`, `OBSION_USER_DATA`입니다. 기존 `OBSIDIAN_REPLICA_VAULT`, `OBSIDIAN_REPLICA_USER_DATA`도 호환용으로 지원합니다. 시험용 경로는 먼저 만들고 사용하세요.

## 6. 페이지 공유 서비스

### 현재 주소와 공개 문서

- 서비스: <https://replica-note-share-mvninhns.beaur8.chatgpt.site>
- [옵시온 웹 공유 사용법](https://replica-note-share-mvninhns.beaur8.chatgpt.site/p/893b195d974a05f2e6f9e0b23e1a6859)
- [옵시디언 분석과 복제 앱 제작 과정](https://replica-note-share-mvninhns.beaur8.chatgpt.site/p/f7ba8f48337efd2a86e118bc2a29a4ee)

이름은 바꿨지만 기존 공개 링크를 유지하기 위해 주소의 `replica-note-share-...` 부분은 바꾸지 않았습니다. 작성 시 세 주소 모두 HTTP 200으로 확인했습니다.

### 사용 흐름

1. 노트 위쪽 공유 아이콘이나 노트 옵션의 웹 공유를 엽니다.
2. 공개 제목·설명·테마와 본문 미리보기를 확인합니다.
3. **공유 링크 만들기**를 눌러 현재 노트만 게시합니다.
4. 수정 후 **공개 페이지 업데이트**를 누르면 같은 URL에 반영합니다. 로컬 수정만으로 자동 게시되지는 않습니다.
5. **공유한 문서**에서 복사·열기·공유 중지를 할 수 있습니다. 원래 노트를 삭제했거나 다른 보관함으로 옮겼어도 게시 목록에서 관리할 수 있습니다.
6. 공유 중지는 공개본만 제거합니다. 로컬 `.md` 파일은 남습니다. 중지 뒤 다시 게시하면 새 링크를 만듭니다.

### 구현 방식

- Obsidian Publish의 게시·재게시·게시 취소 흐름을 참고해 **별도의 서버**로 구현했습니다. Obsidian 유료 계정이나 원본 Publish 서버를 사용하지 않습니다.
- 서버는 Sites의 Vinext/Cloudflare Worker와 D1을 사용합니다. 현재 D1 바인딩은 `DB`이며 R2는 사용하지 않습니다.
- `published_pages`에는 공개 문서, `publish_nonces`에는 요청 재사용을 막는 일회용 값이 들어갑니다.
- 읽기는 익명에게 공개합니다. 게시·삭제는 허용 기기의 Ed25519 서명이 있어야 합니다.
- 서명에는 HTTP 메서드, API 경로, 시각, nonce, 본문이 포함됩니다. 시각 허용 범위는 5분입니다.
- 현재는 서버에 **한 개의 허용 공개 키**를 등록한 개인용 구성입니다. 계정 가입·여러 사용자별 권한 관리 서비스는 구현하지 않았습니다.
- 개인 키는 화면이나 공개 페이지로 전달하지 않습니다. 로컬 앱의 `safeStorage`를 사용해 OS가 지원하는 암호화로 보관합니다.
- 게시 ID를 업로드 전에 로컬에 기록합니다. 응답이 유실돼도 관리할 수 있는 URL이 남습니다. 이때 목록에 게시 결과 확인이 필요한 상태가 표시될 수 있습니다.
- 미리보기 후 파일이 바뀌면 digest가 달라져 게시를 거부하므로 새 미리보기를 확인해야 합니다.
- 앱 안에서 노트 이름을 바꾸면 게시 기록도 따라가도록 구현했습니다. 외부 프로그램에서 파일이나 보관함 경로를 바꾼 경우의 재연결은 별도 처리가 필요합니다.

### 공개되는 내용

선택한 본문만 전송합니다. YAML frontmatter와 `%%` 숨김 주석, HTML 주석은 제거하고 코드 예시는 보존합니다. `publish: false`가 설정되면 게시를 거부합니다. 연결된 다른 노트와 첨부파일은 자동 업로드하지 않습니다.

원본 HTML 실행과 위험한 URL 스킴을 차단하고 외부 이미지도 자동으로 불러오지 않습니다. 공개 응답에는 `no-store`와 `noindex`를 적용합니다. 다만 링크로 읽은 사람이 이미 저장한 사본을 회수하는 기능은 없습니다.

### 배포 식별자

아래 값은 비밀 키가 아닌 프로젝트 식별자입니다. 수정할 때 직접 새 값을 추측하지 말고, manifest와 도구 응답의 값을 그대로 사용합니다.

| 항목 | 현재 값 |
| --- | --- |
| Sites 프로젝트 | `appgprj_6addb1fa78ac8191ae05a919d601c231` |
| 접근 범위 | `public` |
| 현재 버전 | `3` |
| 저장 버전 ID | `appgprj_6addb1fa78ac8191ae05a919d601c231~appgver_4be80448166481919b17cf00bd420456` |
| 성공한 배포 ID | `appgdep_6addbcec1f288191997c696c93f53189` |
| 배포 소스 커밋 | `d4fd81f1e58a9a74d7edf85cc89b42cdf0e82494` |
| 설정 파일 | `publish-service/.openai/hosting.json` |

현재 계정에서는 작성 시 `get_site`로 소유자 권한·버전 3·공개 상태를 확인했습니다. 이 권한이 새 계정에도 자동으로 생기는 것은 아닙니다.

### 서버 수정과 배포를 이어갈 때

현재 Mac의 `publish-service/`에는 Sites가 사용하는 별도의 `.git`이 있습니다. 바깥 프로젝트의 `.git`은 GitHub 저장소용입니다. GitHub에는 서버의 실제 파일들을 포함했으며 서브모듈로 올리지 않았습니다.

새 GitHub 복제본에는 서버의 별도 `.git`이 없습니다. Sites 배포 작업은 다음 원칙을 따릅니다.

1. 현재 설치된 **Sites 스킬**을 먼저 읽습니다. 스킬 버전 경로나 캐시 경로는 새 환경에서 다시 찾습니다.
2. 기존 프로젝트를 `get_site`로 확인하고 같은 프로젝트의 소스 쓰기 자격 증명을 발급받습니다. 토큰을 문서·파일·명령 인자·로그에 넣지 않습니다.
3. 기존 서버 checkout을 이용하거나, GitHub 저장소 바깥의 빈 디렉터리에 Sites 공식 source helper로 별도 checkout을 엽니다. GitHub 원격 저장소로 Sites 배포 커밋을 잘못 밀지 않도록 구분합니다.
4. 서버 변경을 해당 checkout에 반영하고 기존 `.openai/hosting.json`의 프로젝트·D1 설정을 유지합니다.
5. 공식 helper로 빌드, 소스 커밋·푸시, 배포 아카이브 준비를 진행합니다.
6. 정확히 푸시한 커밋과 대응 아카이브로 버전을 저장하고, 현재 공개 범위를 유지해 배포합니다.
7. 비종료 상태일 때만 배포 상태를 확인하고 성공·실패가 확정되면 멈춥니다.

독립적인 서버 개발에는 `publish-service/`에서 `npm ci`, `npm run build`를 사용할 수 있습니다. 빌드된 서버의 로컬 미리보기는 `npm start -- --port 4175`입니다. 이는 실제 서비스 배포가 아닙니다.

로컬 DB를 처음 준비할 때 사용할 기존 마이그레이션은 `drizzle/0000_stiff_plazm.sql`입니다. 먼저 빌드해 `dist/server/wrangler.json`을 만든 다음, 아직 적용하지 않은 마이그레이션만 한 번 적용합니다.

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_stiff_plazm.sql
```

`npm run db:generate`는 스키마를 변경했을 때 새 SQL을 만드는 명령입니다. 기존 SQL을 적용하는 작업과 구분하세요. GitHub에는 DB 구조만 있고 운영 D1의 문서 데이터는 없습니다.

## 7. 이름을 바꾸면서 일부 옛 문자열을 남긴 이유

화면·설치 앱·메뉴·웹페이지의 서비스 이름은 이미 **옵시온/Obsion**입니다. 아래 옛 이름들은 기존 데이터와의 호환성을 위해 남겨 두었습니다.

| 유지한 값 | 이유 |
| --- | --- |
| 번들 ID `local.rea.obsidian-replica` | 기존 macOS 앱 식별과 `.md` 파일 연결 유지 |
| `~/Library/Application Support/Obsidian Replica` | 기존 설정·키·공유 기록·앱 저장 상태 유지 |
| 기존 보관함 `Obsidian Replica Vault` | 사용자 파일과 공유 관리 경로 유지 |
| 시작 직후 `app.setName('Obsidian Replica')` | 준비 단계에서 선택하는 macOS Keychain 식별자 유지 |
| 준비 후 `app.setName('Obsion')` | 실제 메뉴·앱 이름에 새 브랜드 적용 |
| 기존 브라우저 저장 키 | 브라우저 미리보기 데이터·환경 설정 유지 |
| `X-Replica-*` 서명 헤더와 기존 URL | 기존 클라이언트·서버·공개 링크 호환 |

특히 `electron/main.cjs`의 준비 전 이름 설정을 단순히 `Obsion`으로 일괄 치환하지 마세요. 기존 공유 키를 복호화하지 못할 수 있습니다. 이번 변경에서는 **설치한 실제 Obsion 런타임으로 기존 키를 읽고, 같은 공개 URL에 문서를 업데이트하는 것까지 확인**했습니다.

## 8. 계정 이전에서 반드시 구분할 것

### A. 소스 코드

GitHub에 있으므로 새 Codex 계정에서도 공개 저장소를 복제해 작업할 수 있습니다. 푸시는 `jinsoowelcome/obsion`에 쓰기 권한이 있는 GitHub 인증이 별도로 필요합니다.

### B. 개인 노트와 앱 설정

개인 노트는 로컬 보관함에 있습니다. 앱을 정상 종료한 뒤 보관함 폴더와 아래 사용자 데이터 폴더를 **비공개 백업 위치**에 보존하세요.

```text
~/Documents/Obsidian Replica Vault/
~/Library/Application Support/Obsidian Replica/
```

두 번째 폴더에는 공유 관리 정보와 암호화된 키도 들어 있습니다. 새 컴퓨터에서는 `vault.json`의 절대 경로가 달라질 수 있습니다. 보관함을 앱에서 다시 선택하고 공유 기록과의 경로 대응도 검토해야 합니다.

### C. 기존 공개 문서를 업데이트·삭제할 권한

현재 파일은 다음 두 개이며, 작성 시 모두 권한 `0600`을 확인했습니다.

```text
~/Library/Application Support/Obsidian Replica/publishing/private-key.encrypted
~/Library/Application Support/Obsidian Replica/publishing/records.json
```

- `private-key.encrypted`: 이 기기의 서명 개인 키를 OS가 지원하는 방식으로 암호화한 파일입니다.
- `records.json`: 게시 ID·URL·원래 보관함과 노트 경로 등 관리 기록입니다.
- 현재 평문 `private-key.pem`은 남아 있지 않습니다.
- 새 설치에서 게시 개인 키를 자동 발급하는 기능은 없습니다. 키가 없으면 공유 기능이 연결되지 않은 상태로 표시됩니다.
- macOS 키체인이 필요한 암호화이므로 **암호화 파일만 다른 기기나 다른 macOS 사용자에게 복사해도 복호화가 보장되지 않습니다.**
- 공유 키의 안전한 내보내기·가져오기 화면은 아직 구현하지 않았습니다. 기기를 옮긴다면 기존 환경에서 복호화할 수 있을 때 안전한 이전 절차를 마련하거나, 새 키와 서버의 허용 공개 키를 함께 교체하는 작업이 필요합니다.
- 새 키를 만들기만 해서는 기존 서버에 게시할 수 없습니다. 서버의 허용 공개 키와 맞아야 합니다. 기존 게시물을 계속 관리하려면 관리 기록도 보존해야 합니다.
- 기록의 식별자는 보관함 절대 경로와 노트 상대 경로를 이용합니다. 새 Mac에서 보관함 경로를 바꾸면 기존 링크와의 매핑을 이전하는 작업도 필요합니다.

이 문서에는 개인 키·키체인 비밀·GitHub 토큰·Sites 쓰기 토큰을 넣지 않았습니다. 이러한 값은 공개 GitHub에 추가하지 않습니다.

### D. Sites 호스팅 프로젝트의 소유·배포 권한

공유 서버는 기존 Sites 계정의 프로젝트에 배포돼 있습니다. **새 Codex 계정으로 로그인했다고 프로젝트 소유권이나 운영 DB가 자동 이전되지는 않습니다.**

1. 기존 계정의 접근 수단을 유지한 상태에서 새 계정으로 `get_site`를 호출해 접근 여부를 확인합니다.
2. 권한이 없다면 서비스에서 협업 권한 부여나 소유권 이전을 지원하는지 확인합니다. 이 프로젝트에서 계정 간 소유권 이전을 실행하거나 지원 여부를 검증한 적은 없습니다.
3. 이전을 지원하지 않아 새 Sites 프로젝트가 필요하다면 별도 이전 작업으로 진행합니다. 새 프로젝트의 ID·주소·DB를 사용해야 하고, 클라이언트의 서버 주소와 키 설정도 맞춰야 합니다.
4. 새 프로젝트에 코드만 배포하면 운영 D1 데이터는 따라오지 않습니다. 운영 데이터의 내보내기·가져오기는 아직 수행하지 않았습니다.
5. 기존 링크의 주소를 그대로 유지할 수 있는지도 별도 확인 사항입니다. 새 호스트로 링크를 자동 이전하거나 리디렉션하는 기능은 구현하지 않았습니다.

이 항목은 계정 이전 방법을 정리한 것이며, 실제 소유권 이전·키 이전·DB 이전을 완료했다는 뜻은 아닙니다.

## 9. 검증한 것과 남은 범위

### 검증 완료

- UTF-8 파일 생성·저장·이름 변경·다시 열기, 충돌과 경로 탈출 방지, 휴지통 처리.
- 저장 실패 중 종료, 저장 도중 새 입력, 재시도와 초안 보존.
- 위키 링크 해석, 코드 예시 제외, 마크다운 링크와 그래프 관계.
- 공개 본문 정리, 크기 제한, 서명 게시·업데이트·이름 변경·재시작·공유 중지.
- 미리보기 이후 변경 거부, 응답 유실 시 관리 ID 보존, 권한 거절 처리.
- 서로 다른 보관함의 같은 파일명 구분, 공개 HTML·URL·이미지 처리.
- **인수인계 작성 시 `npm test`: 22개 통과, 실패 0개.**
- 이전 개발 과정에서 앱·서버의 프로덕션 빌드와 macOS 패키징 성공.
- 실제 공유 서버에서 생성·익명 열람·동일 URL 업데이트·삭제, 이후 404 확인.
- 이름 변경 후 실제 설치 앱에서 기존 공유 키를 읽고 기존 링크에 업데이트 성공.
- 작성 시 앱 실행 중, `.md` 기본 앱은 `/Users/jinsoojeon/Applications/Obsion.app`.

원본 분석과 초기 앱 동작은 REA·화면 관찰로 검증했습니다. 공유 기능 개발 시 컴퓨터 제어 연결 오류가 있어 **공유 화면 전체의 자동 시각 검증은 완료하지 못했습니다.** 빌드·자동 테스트·HTTP 검증과 실제 설치 앱의 API 실행으로 확인한 범위를 구분해서 기록했습니다.

### 아직 구현하지 않은 기능과 제한

- 원본 Obsidian의 모든 기능·플러그인 ABI와의 동등성은 목표로 검증하지 않았습니다.
- 커뮤니티 플러그인 실행, Sync, Canvas, Bases는 없습니다.
- PDF·이미지·수식·Mermaid 렌더링은 지원하지 않습니다.
- 외부 파일 변경 자동 감시, 여러 편집기의 충돌 병합은 없습니다.
- 노트 이름을 바꿨을 때 다른 노트의 본문 링크를 자동 수정하지 않습니다.
- 보관함당 5,000개 노트, 노트당 8MiB, 전체 64MiB 제한이 있습니다.
- 공개 본문은 200KiB, 제목은 200자, 설명은 400자까지입니다.
- 공유 사이트 비밀번호, 사용자 지정 도메인, 보관함 전체 탐색·검색은 없습니다. 선택한 첨부파일은 로컬 PC를 통한 다운로드로 지원합니다.
- 공유 서비스의 여러 사용자별 인증·권한과 안전한 키 이전 UI는 없습니다.
- 현재 패키징은 macOS 12 Intel(x64)용입니다. 배포용 Developer ID 서명·공증·자동 업데이트는 적용하지 않았습니다. 이전 Mac의 설치 앱은 로컬 임시 서명으로 검증했고, 이번 로컬 빌드에서는 코드 서명을 생략했습니다.

## 10. 설치한 도구·스킬과 연결 문제

### 이전 개발 Mac에 있던 도구

| 항목 | 확인한 상태 |
| --- | --- |
| Codex CLI | `~/.local/bin/codex` 존재 |
| Node.js / npm | `24.13.1` / `11.8.0`, `/usr/local/bin/` |
| GitHub CLI | `/opt/homebrew/bin/gh`, 프로젝트 업로드에 사용 |
| Browser Use 실행기 | `~/.local/bin/browser-use` 존재. 설치 매뉴얼에는 Python 패키지 0.13.11로 기록 |
| Browser Use 스킬 | `~/.agents/skills/browser-use/SKILL.md` |
| Computer Use 스킬 | `~/.agents/skills/computer-use/SKILL.md` |
| REA 스킬 | `~/.agents/skills/reverse-engineer-anything/SKILL.md` |
| REA MCP 설정 | `~/.codex/config.toml`의 `mcp_servers.rea` |
| REA 실행 | `npx -y rea-agents@6.7.0 mcp` |
| Ghidra | `~/Applications/Ghidra/ghidra_12.1.4_PUBLIC` |
| Java | `~/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home` |

REA 설정의 `GHIDRA_INSTALL_DIR`와 `JAVA_HOME`은 위 실제 경로로 등록돼 있습니다. Ghidra가 단순 명령 이름으로 PATH에서 검색되지 않는다고 설치가 없다고 판단하지 마세요. `support/analyzeHeadless` 파일도 확인했습니다.

기존 설치 매뉴얼에 기록한 Java 버전은 Temurin **21.0.13**입니다. 이 버전과 Ghidra **12.1.4**를 사용해 네이티브 분석을 시험했습니다. 새 환경에서는 현재 REA의 설치 안내와 호환성을 다시 확인해야 합니다.

이 Mac에서는 새 Codex 계정으로 로그인하는 것만으로 도구를 다시 설치할 필요는 없습니다. 먼저 스킬 파일과 MCP 연결이 보이는지 확인합니다. 스킬의 설치 버전·허용 도구·연결 상태는 새 세션에서 읽고 확인합니다.

### 작업할 때 도구를 선택한 기준

- 설치된 앱의 번들·실행 파일 분석: REA.
- 이미 있는 옵시온 소스의 구조 확인·수정: 일반 코드 도구. 불필요하게 REA 분석을 다시 시작하지 않습니다.
- 웹페이지 조작: Browser Use나 연결된 브라우저 도구.
- 네이티브 화면·창·대화상자 조작: Computer Use.
- 공유 서버 수정·배포: 현재 설치된 Sites 스킬과 연결 도구.

컴퓨터 제어에서 `Sky Computer Use native pipe startup failed` 오류가 반복된 적이 있습니다. 그때 화면을 확인했다고 주장하지 않고 앱 API·빌드·테스트·HTTP 검증으로 진행했습니다. 새 세션에서 연결 상태가 달라질 수 있으므로 필요한 경우 다시 확인하되, 실패한 연결을 무작정 반복하지 않습니다.

계정이나 연결이 바뀌면 과거 세션의 도구 핸들, 메모리 속 인증 정보, 브라우저 연결과 실행 세션 번호는 재사용할 수 없습니다. 기존 대화의 도구 내부 상태에 의존하지 말고 현재 환경에서 다시 연결하세요.

## 11. 추가로 작성해 둔 문서

현재 실제 보관함에 아래 문서가 있습니다. 개인 보관함 자체는 GitHub에 올리지 않았습니다.

1. `Codex 설치부터 옵시디언 복제 준비까지 단계별 매뉴얼.md`
   - Codex와 개발 도구, 전역 스킬, Browser Use 실행기, Obsidian, REA, Java·Ghidra의 설치 과정을 쉽게 설명한 문서입니다.
   - 현재 Mac에서 확인한 분량은 471줄입니다.
2. `옵시디언 분석과 복제 앱 제작 과정.md`
   - 무엇을 분석했고 어떤 구조로 새 앱을 만들었는지, 저장과 링크 문제를 어떻게 고치고 검증했는지 설명합니다.
   - 현재 178줄이며, 6절에 공개 링크가 있습니다.
3. `웹 공유 기능 사용법.md`
   - 현재 공개 제목은 **옵시온 웹 공유 사용법**입니다. 게시·업데이트·공유 중지와 현재 지원 범위를 설명합니다.
   - 6절의 기존 링크로 계속 접근할 수 있습니다.

소스 저장소의 `README.md`, `evidence/ANALYSIS.md`, `evidence/PUBLISH.md`에도 개발 방법과 검증 근거가 정리돼 있습니다. 로컬 `release/`에는 이름 변경·공유 기능 추가·파일 열기 기능 추가 전의 앱 백업들이 남아 있습니다. 백업 앱은 GitHub 업로드 대상이 아닙니다.

## 12. 다음 작업자가 지켜야 할 진행 기준

1. 먼저 이 파일, `README.md`, 실제 `git status`와 `git log`를 읽고 이미 끝낸 작업을 반복하지 않습니다.
2. 현재 사용자 요청은 **계정 이전을 위한 기록 작성**입니다. 키·운영 DB·Sites 소유권을 자동으로 옮기거나 초기화하라는 요청은 없었습니다.
3. 기존 보관함, 게시 기록, 암호화 키와 호환용 식별자를 보존합니다.
4. 노트 기능을 시험할 때는 별도 시험용 보관함을 사용하고, 사용자 문서를 시험 게시하지 않습니다.
5. 실제 변경에 맞는 테스트를 실행합니다. 웹 배포나 설치 앱 변경은 소스 수정과 별개이므로 무엇까지 반영했는지 구분해 보고합니다.
6. 사용자에게 짧고 구체적인 한국어로 진행 상황을 알려줍니다. 기존 대화에서는 불필요한 재확인보다 실제 작업 진행을 선호했습니다.

### 새 계정의 첫 대화에 붙여 넣을 요청문

```text
이 저장소의 OBSION_HANDOFF.md를 먼저 읽고 옵시온(Obsion) 프로젝트를 이어서 작업해줘.
저장소는 https://github.com/jinsoowelcome/obsion 이고, 이 Mac의 기존 작업 폴더는
/Users/jinsoojeon/work/rea실습/obsidian-replica 야.
앱, 웹 공유 기능, 이름 변경과 GitHub 업로드는 완료됐어.
먼저 현재 git 상태와 테스트를 확인하고, 기존 노트·공유 기록·키는 보존해줘.
Sites와 GitHub의 새 계정 접근 권한은 별도로 확인해줘.
계정/키/DB 이전을 실제로 진행하기 전에는 내가 요청한 범위를 확인하고,
다음으로 할 일은 내 새 요청에 맞춰 진행해줘.
```
