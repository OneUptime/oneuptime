<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <a href="/README.md">English</a> ·
  <a href="/Docs/translations/README.zh-CN.md">简体中文</a> ·
  <a href="/Docs/translations/README.zh-TW.md">繁體中文</a> ·
  <a href="/Docs/translations/README.ja.md">日本語</a> ·
  <a href="/Docs/translations/README.ko.md">한국어</a> ·
  <a href="/Docs/translations/README.es.md">Español</a> ·
  <a href="/Docs/translations/README.fr.md">Français</a> ·
  <a href="/Docs/translations/README.de.md">Deutsch</a> ·
  <a href="/Docs/translations/README.pt.md">Português</a> ·
  <a href="/Docs/translations/README.it.md">Italiano</a> ·
  <a href="/Docs/translations/README.ru.md">Русский</a> ·
  <a href="/Docs/translations/README.hi.md">हिन्दी</a> ·
  <a href="/Docs/translations/README.fa.md">فارسی</a> ·
  <a href="/Docs/translations/README.nl.md">Nederlands</a> ·
  <a href="/Docs/translations/README.da.md">Dansk</a> ·
  <a href="/Docs/translations/README.sv.md">Svenska</a> ·
  <a href="/Docs/translations/README.no.md">Norsk</a>
</p>

<p align="center">
  <a href="https://oneuptime.com"><img alt="OneUptime" width="50%" src="/packages/Home/Static/img/OneUptimePNG/7.png"></a>
</p>

<p align="center">
  <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0%20%2B%20Enterprise%20%28ee%2F%29-1a73e8" alt="License"></a>
  <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
</p>

OneUptime은 오픈 소스 옵저버빌리티 플랫폼입니다. 웹사이트, API, 서버가 제대로 동작하는지 확인하고, 앱이 보내는 로그, 메트릭, 트레이스를 수집하며, 무언가 고장 나면 온콜 담당자를 호출하고, 상태 페이지로 고객에게 알립니다. 이 모든 일이 하나의 제품 안에서 일어나므로, 문제를 알아챈 도구가 곧바로 팀을 호출합니다.

[OneUptime Cloud](https://oneuptime.com)에서 사용하거나 자체 서버에서 실행할 수 있습니다.

<p align="center">
  <img alt="인시던트 중의 OneUptime: 타임라인, 온콜 담당자, 상태 페이지, OneUptime AI의 조사" width="100%" src="/packages/Home/Static/img/readme/hero-command-center.png">
</p>

## 하는 일

- **[모니터링](https://oneuptime.com/docs/ko/monitor/create-monitor)**: 전 세계의 프로브나 자체 네트워크 안에서 웹사이트, API, 포트, DNS, 인증서를 확인합니다. 서버, Kubernetes, Docker, VMware, 데이터베이스, 네트워크 장비도 지켜봅니다.
- **[인시던트와 온콜](https://oneuptime.com/docs/ko/incidents/index)**: 각 인시던트를 하나의 타임라인에서 처리합니다. 전화, SMS, 이메일, 푸시, Slack, Microsoft Teams로 온콜 담당자를 호출하고, 누군가 응답할 때까지 에스컬레이션합니다.
- **[상태 페이지](https://oneuptime.com/docs/ko/status-pages/index)**: 공개 또는 비공개 상태 페이지로 고객에게 상황을 알리고, 예정된 유지 관리도 그곳에서 공지합니다.
- **[로그, 메트릭, 트레이스](https://oneuptime.com/docs/ko/telemetry/open-telemetry)**: OpenTelemetry로 보내고, 검색하고, 대시보드를 만듭니다. 예외, 프로파일, 실제 사용자 모니터링, 보안 이벤트도 같은 곳에 있습니다.
- **[워크플로와 런북](https://oneuptime.com/docs/ko/workflows/index)**: 반복 작업을 자동화하고, Jira, ServiceNow 등 팀이 이미 쓰는 도구와 연결합니다.
- **[OneUptime AI](https://oneuptime.com/docs/ko/ai/ai-sre)**: 새 인시던트와 경고를 조사하고, 출처가 달린 근본 원인 분석을 게시합니다. 수정을 켜면 팀이 검토할 수정 사항을 풀 리퀘스트로 열 수 있습니다.
- **[API, CLI, Terraform](https://oneuptime.com/docs/ko/api-reference/api-reference)**: 스크립트와 CI에서 OneUptime을 자동화하고, 모니터, 상태 페이지, 온콜을 코드로 관리합니다.

나머지는 모두 [문서](https://oneuptime.com/docs/ko/introduction/getting-started)에 있습니다.

## 시작하기

### OneUptime Cloud

[가입](https://oneuptime.com/accounts/register)하고 프로젝트를 만듭니다. 무료 요금제에는 신용카드가 필요하지 않습니다.

### Docker Compose로 자체 호스팅

메모리가 8 GB 이상인 Linux 서버와 Docker, Docker Compose, Git, Node.js가 필요합니다.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config, with a random value for every secret
cp config.example.env config.env
while grep -q "please-change-this-to-random-value" config.env; do
  sed -i "0,/please-change-this-to-random-value/{s/please-change-this-to-random-value/$(openssl rand -hex 32)/}" config.env
done

# 3. Start everything
npm start
```

`npm start`에서 **OneUptime is up!** 메시지가 나오면 `http://localhost`를 열고 가입합니다. 첫 계정이 인스턴스의 관리자가 됩니다. 서버에서는 3단계 전에 `config.env`의 `HOST`를 서버의 도메인 이름이나 IP 주소로 설정하고, 그 주소를 엽니다.

서버 크기, HTTPS, 백업, 업데이트는 [Docker Compose 가이드](https://oneuptime.com/docs/ko/installation/docker-compose)에서 다룹니다.

### Helm으로 Kubernetes에 설치

대규모 프로덕션이나 고가용성이 필요하다면 Helm 차트를 설치합니다.

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime --set host=oneuptime.example.com
```

`host`는 사람들이 OneUptime에 접속할 도메인 이름이나 IP 주소로 설정합니다. 스토리지, HTTPS, 데이터베이스, 업그레이드는 [차트의 README](/HelmChart/Public/oneuptime/README.md)에서 다룹니다.

## Community와 Enterprise

- **Community Edition**: 무료 오픈 소스이며, 위의 모든 기능과 SAML 및 OIDC 싱글 사인온을 포함합니다.
- **Enterprise Edition**: SCIM 프로비저닝, 감사 로그, 팀 컴플라이언스, 인스턴스 상태 대시보드와 우선 지원을 더합니다. 프로덕션에서 사용하려면 라이선스가 필요합니다: [영업팀 문의](mailto:sales@oneuptime.com).

두 에디션의 비교는 [문서](https://oneuptime.com/docs/ko/self-hosted/enterprise)에 있습니다.

## 도움 받기

- [Slack의 OneUptime 커뮤니티](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)에서 질문합니다.
- 버그 신고와 기능 요청은 [GitHub 이슈](https://github.com/OneUptime/oneuptime/issues)에 남깁니다.
- 보안 취약점은 [SECURITY.md](/.github/SECURITY.md)에 설명된 대로 비공개로 신고합니다.
- 그 밖의 문의는 [support@oneuptime.com](mailto:support@oneuptime.com)으로 이메일을 보냅니다.

## 기여하기

버그 수정, 기능, 문서, 테스트 모두 환영합니다. 소스에서 OneUptime을 실행하는 방법은 [로컬 개발 가이드](https://oneuptime.com/docs/ko/installation/local-development)에, 풀 리퀘스트와 라이선스가 어떻게 동작하는지는 [기여 가이드라인](/.github/CONTRIBUTING.md)에 있습니다. 처음이라면 [good first issue](https://github.com/OneUptime/oneuptime/labels/good%20first%20issue) 레이블이 붙은 이슈부터 시작해 보세요.

OneUptime이 유용하다면 이 저장소에 별을 주거나 [프로젝트를 후원](https://github.com/sponsors/OneUptime)해 주세요.

## 라이선스

OneUptime은 [Apache License 2.0](/LICENSE)에 따른 오픈소스이며, [`ee/`](/ee) 디렉터리만 예외입니다. 이 디렉터리에는 엔터프라이즈 에디션이 들어 있으며 [OneUptime Enterprise License](/ee/LICENSE)에 따라 라이선스가 부여됩니다. 커뮤니티 에디션 이미지에는 `ee/`의 코드가 포함되지 않습니다. 이 구분은 저장소 루트의 [`LICENSE`](/LICENSE) 파일에 명시되어 있습니다.
