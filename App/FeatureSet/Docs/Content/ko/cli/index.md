# OneUptime CLI

OneUptime CLI는 터미널에서 OneUptime 리소스를 직접 관리하기 위한 명령줄 인터페이스입니다. 모니터, 인시던트, 알림, 상태 페이지 등에 대한 전체 CRUD 작업을 지원합니다.

## 기능

- 프로덕션, 스테이징 및 개발을 위한 명명된 컨텍스트를 통한 **다중 환경 지원**
- OneUptime 인스턴스에서 사용 가능한 리소스의 **자동 검색**
- CLI 플래그, 환경 변수 또는 저장된 컨텍스트를 통한 **유연한 인증**
- JSON, 테이블 및 와이드 표시 모드를 갖춘 **스마트 출력 형식**
- CI/CD 파이프라인 및 자동화 워크플로를 위한 **스크립팅 가능**

## 설치

```bash
npm install -g @oneuptime/cli
```

## 빠른 시작

```bash
# OneUptime 인스턴스로 인증
oneuptime login <your-api-key> https://oneuptime.com

# 모니터 목록 조회
oneuptime monitor list

# 특정 인시던트 보기
oneuptime incident get <incident-id>

# 사용 가능한 모든 리소스 보기
oneuptime resources
```

## 문서

| 가이드                                  | 설명                                       |
| --------------------------------------- | ------------------------------------------ |
| [인증](./authentication.md)             | 로그인, 컨텍스트 및 자격 증명 관리         |
| [리소스 작업](./resource-operations.md) | 모니터, 인시던트, 알림 등에 대한 CRUD 작업 |
| [출력 형식](./output-formats.md)        | JSON, 테이블 및 와이드 출력 모드           |
| [스크립팅 및 CI/CD](./scripting.md)     | 자동화, 환경 변수 및 파이프라인 사용       |
| [명령 참조](./command-reference.md)     | 모든 명령 및 옵션에 대한 전체 참조         |

## 전역 옵션

이 플래그는 모든 명령과 함께 사용할 수 있습니다:

| 플래그                  | 설명                               |
| ----------------------- | ---------------------------------- |
| `--api-key <key>`       | 이 명령에 대한 API 키 재정의       |
| `--url <url>`           | 이 명령에 대한 인스턴스 URL 재정의 |
| `--context <name>`      | 특정 명명된 컨텍스트 사용          |
| `-o, --output <format>` | 출력 형식: `json`, `table`, `wide` |
| `--no-color`            | 색상 출력 비활성화                 |
| `--help`                | 명령 도움말 표시                   |
| `--version`             | CLI 버전 표시                      |

## 도움말 받기

```bash
# 일반 도움말
oneuptime --help

# 특정 명령에 대한 도움말
oneuptime monitor --help
oneuptime monitor list --help
```
