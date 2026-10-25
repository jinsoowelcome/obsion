# 분석 및 재현 기록

대상: `/Applications/Obsidian.app`, 버전 1.14.5. 분석일: 2026-10-25.

## 관찰한 사실

- REA가 `Contents/Resources/obsidian.asar`를 ASAR로 식별했습니다. SHA-256: `3a349274f789b62c5b35ad19de10311909a94e8783033569c2210a4bac491780`.
- 패키지 목록과 불활성 소스 읽기로 `app.js`, `app.css`, `main.js`, `starter.js`, `index.html`, CodeMirror·Markdown 관련 리소스를 확인했습니다.
- `main.js`, `starter.js`, HTML과 manifest를 선택한 REA 정적 분석에서 JavaScript 2개, AST 노드 100,060개, Electron 창 생성 후보 2개, IPC 등록 47개가 관찰됐습니다. 이는 실행 사실을 증명하지 않습니다.
- `app.js`의 별도 REA 분석은 JavaScript 1개, AST 노드 1,123,389개와 195개 모듈을 처리했습니다. 이 분석은 노드·미확정 항목 수 제한을 적용했습니다.
- Computer Use로 실제 열린 원본 화면과 접근성 트리를 확인했습니다. 밝은 테마, 파일 탐색기, 환영 노트의 실시간 미리보기, 오른쪽 그래프, 하단 단어/문자 수가 보였습니다. 원본을 변경하는 조작은 하지 않았습니다.
- 원본 패키지의 `index.html` 초기 body에는 dark 클래스가 있었지만 실제 화면은 light였습니다. 정적 기본값을 현재 사용자 설정으로 취급하지 않았습니다.

## 주요 REA 근거

| 근거 ID | 의미 |
| --- | --- |
| `ev_f89445529947bc356544a65c72fa5022391acfa8254221c1d75b09fb296be078` | 전체 ASAR 파일 목록, manifest만 선택한 최초 분석 |
| `ev_abac2bbfc23b70d3008fcdc47fc78e165994688ce80dc1e51d45b15a776efeeb` | main/starter/HTML/manifest 정적 분석 |
| `ev_cd4bfec0ebf4a9d426e0998185ee08dce37ea402146308f19e10de9bcb66b56e` | app.js 정적 분석 |
| `ev_be091b46dc42c6155936428f65bc337da85ee94f9516011db59b04c2842ad1f8` | 복제본 최초 밝은 화면의 브라우저 캡처 |
| `ev_ff4215f21b504747c9f9bb6dc1a9470edcf18196b5eedfd130519186994d90ac` | 실제 Electron 복제본의 노트 생성, 파일 저장, 읽기 링크 이동; 이후 검색 대기 selector 중복으로 시나리오 중단 |
| `ev_d3021420a7519144d39f8718857cc065095c273cd27dc43c63e950e61020fafd` | 검색 결과 열기, 북마크, 어두운 테마, 백링크 패널: 선언한 모든 단계 완료 |
| `ev_857cb1ed328f97327bea69621f0e63f00fbde6cd553e664df36ecc50c6f43912` | 빠른 전환기, 이름 변경, 명령어 팔레트, 소스 편집, 저장 단축키, 휴지통, 밝은 테마: 선언한 모든 단계 완료 |
| `ev_5e84bb6e7e5e89acad283b7ba53d62eaa33d09f5e5a63010174903719caeea8b` | 설치한 macOS 앱의 ASAR 내부 file:// 페이지를 직접 열어 프로덕션 DOM 321개 노드와 편집기·그래프 구조를 확인 |

REA의 Electron 연결 시나리오 두 건은 모든 선언 동작을 완료했으나 `completeness.missing_sections`에 `events`가 남았습니다. 따라서 전역적 동등성이나 전체 이벤트 수집 성공으로 보고하지 않습니다. 수집된 콘솔에는 앱 예외가 없었습니다. 실패한 이전 검증은 범위를 좁혀 수정 후 재검증했으며, 실패를 성공으로 집계하지 않았습니다.

설치된 앱은 `/Users/jinsoojeon/Applications/Obsidian Replica.app`입니다. 개발 서버 없이 패키지 내부 HTML을 로드했고, 로컬 임시 서명과 `codesign --verify --deep --strict`를 통과했습니다. 프로덕션 페이지 관찰은 스크립트 원문 수집을 생략한 `policy_filtered` 결과입니다. 웹 스크린샷 도구는 file:// 대상 캡처를 허용하지 않아 프로덕션 픽셀 캡처를 추가로 얻지 못했습니다. [밝은 화면](replica-light.png)과 [어두운 화면](replica-dark.png)은 각각 브라우저 미리보기와 실제 Electron 개발 실행에서 수집한 캡처입니다.

## 구현에서 선택한 사항

React/Electron 기반 새 구현, 제한된 contextBridge API, 별도 보관함과 설정 경로를 사용합니다. 그래프는 위키 링크를 해석해 작성한 독립 구현이고, 편집기는 CodeMirror, 읽기 모드는 Marked와 DOMPurify를 사용합니다. 원본의 내부 구현과 같은 코드라고 주장하지 않습니다.

## 미확인 및 제외 범위

선택하지 않은 소스·동적 호출·생략된 의미 그래프 관계는 미확정입니다. 원본 앱의 모든 기능, 플러그인 ABI, Sync/Publish 프로토콜, 캔버스·베이스, 첨부파일 렌더링을 재현하거나 동등성 검증하지 않았습니다. 원본의 모든 소스를 복구했다는 의미도 아닙니다.

정적 분석 및 실행 캡처의 전체 Evidence는 로컬의 `rea-evidence.json`에 보존합니다. 원본 패키지의 코드 일부가 분석 근거 안에 포함될 수 있으므로 이 파일은 로컬 분석용이며 GitHub 소스 저장소에서는 제외합니다. 화면 캡처는 별도 시험용 보관함에서 생성한 예시입니다.
