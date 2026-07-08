<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <a href="/README.md">English</a> ·
  <a href="/README.zh-CN.md">简体中文</a> ·
  <a href="/README.zh-TW.md">繁體中文</a> ·
  <a href="/README.ja.md">日本語</a> ·
  <a href="/README.ko.md">한국어</a> ·
  <a href="/README.es.md">Español</a> ·
  <a href="/README.fr.md">Français</a> ·
  <a href="/README.de.md">Deutsch</a> ·
  <a href="/README.pt.md">Português</a> ·
  <a href="/README.it.md">Italiano</a> ·
  <a href="/README.ru.md">Русский</a> ·
  <a href="/README.hi.md">हिन्दी</a> ·
  <a href="/README.nl.md">Nederlands</a> ·
  <a href="/README.da.md">Dansk</a> ·
  <a href="/README.sv.md">Svenska</a> ·
  <a href="/README.no.md">Norsk</a>
</p>

<div align="center">
  <a href="https://oneuptime.com">
    <img alt="OneUptime 로고" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>가동 시간, 인시던트, 온콜, 상태 페이지, 로그, 트레이스, 메트릭, APM을 위한 하나의 오픈소스 플랫폼.</h3>

  <p>모니터링, 상태 페이지, 온콜, 인시던트, 로그, APM — 한 무더기의 SaaS 도구를 무료로 셀프 호스팅할 수 있는 하나의 플랫폼으로 대체하세요.</p>

  <p>
    <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/github/license/OneUptime/oneuptime?color=1a73e8" alt="License"></a>
    <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
    <a href="https://github.com/OneUptime/oneuptime/stargazers"><img src="https://img.shields.io/github/stars/OneUptime/oneuptime?style=flat" alt="Stars"></a>
    <a href="https://artifacthub.io/packages/helm/oneuptime/oneuptime"><img src="https://img.shields.io/badge/Helm-Chart-0f1689" alt="Helm Chart"></a>
    <a href="https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA"><img src="https://img.shields.io/badge/Slack-Community-4A154B" alt="Slack"></a>
  </p>

  <p>
    <a href="https://oneuptime.com"><b>웹사이트</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/docs"><b>문서</b></a> &nbsp;•&nbsp;
    <a href="#quick-start"><b>빠른 시작</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/pricing"><b>요금제</b></a> &nbsp;•&nbsp;
    <a href="#contributing"><b>기여하기</b></a>
  </p>

  <a href="https://oneuptime.com"><b>🚀 OneUptime Cloud를 사용해 보세요 — 영구 무료 요금제, 신용카드 불필요 →</b></a>
</div>

<br/>

<div align="center">
  <img alt="OneUptime 대시보드" width="90%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/monitoring.png"/>
</div>

---

## 옵저버빌리티 스택 전체를 대체하세요

OneUptime은 모니터링, 알림, 인시던트 대응, 옵저버빌리티를 하나의 오픈소스 앱으로 통합합니다 — 그래서 수십 개의 개별 도구를 위해 (그리고 그것들을 이어 붙이느라) 비용을 지불하는 일을 멈출 수 있습니다.

| 이것 대신… | OneUptime을 이렇게 활용하세요… |
|---|---|
| Pingdom / UptimeRobot | **가동 시간 모니터링** — 전 세계 어디서든 웹사이트, API, 핑, 포트, SSL, DNS, 합성 검사 |
| StatusPage.io | **상태 페이지** — 구독자를 지원하는 브랜드형 공개 및 비공개 상태 페이지 |
| PagerDuty / Opsgenie | **온콜 및 알림** — 일정, 에스컬레이션 정책, SMS / 통화 / 푸시 / Slack |
| Incident.io | **인시던트 관리** — 선언, 분류, 커뮤니케이션, 사후 검토 |
| Datadog / New Relic | **APM 및 메트릭** — 트레이스, 대시보드, 서비스 성능 |
| Loggly | **로그 관리** — 로그 수집, 검색, 알림 |
| Sentry | **오류 추적** — 전체 스택 트레이스와 컨텍스트가 포함된 예외 |

이 모든 것이 **100% 오픈소스(Apache 2.0)** 이며 무료로 셀프 호스팅할 수 있습니다.

---

<a name="quick-start"></a>

## ⚡ 빠른 시작

### ☁️ OneUptime Cloud — 손쉬운 방법

설정이 필요 없고, 항상 최신 상태이며, 오픈소스 프로젝트를 지원하는 데 보탬이 됩니다.

**→ [oneuptime.com에서 무료로 가입하기](https://oneuptime.com)**

### 🐳 Docker Compose로 셀프 호스팅

단일 서버(Debian / Ubuntu / RHEL, Docker + Docker Compose)에 필요한 모든 것. 홈랩과 소규모 팀에 안성맞춤 — Raspberry Pi에서도 작동합니다.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config (then edit it — set strong, random secrets!)
cp config.example.env config.env

# 3. Start everything
npm start
```

이제 OneUptime이 **http://localhost** 에서 실행 중입니다 — 열어서 첫 계정을 만드세요.

📖 전체 가이드: [Docker Compose 설치](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [사이징 및 요구 사항](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ Helm을 사용한 Kubernetes — 프로덕션용

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 전체 설치 안내 및 값은 [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **기존 설치를 업그레이드하시나요?** [업그레이드 가이드](/App/FeatureSet/Docs/Content/en/installation/upgrading.md)를 참조하세요.

---

## ✨ 기능

| | 기능 | 하는 일 |
|---|---|---|
| 📊 | **가동 시간 모니터링** | 여러 글로벌 리전에서 웹사이트, API, IP, 포트, SSL, DNS, 합성 모니터. |
| 📋 | **상태 페이지** | 아름다운 브랜드형 상태 페이지, 인시던트 이력, 예약된 유지보수, 구독자 알림. |
| 🚨 | **인시던트 관리** | 선언, 배정, 커뮤니케이션, 해결, 사후 검토에 이르는 엔드투엔드 인시던트 워크플로. |
| 📞 | **온콜 및 알림** | SMS, 전화 통화, 푸시, 이메일, Slack 알림을 지원하는 온콜 일정 및 에스컬레이션 정책. |
| 📝 | **로그 관리** | OpenTelemetry를 통한 로그 수집, 저장, 검색, 알림. |
| 🔍 | **APM 및 트레이스** | 느린 경로와 병목을 찾기 위한 분산 트레이스, 스팬, 성능 대시보드. |
| 📈 | **메트릭 및 대시보드** | 텔레메트리 위에 구축하는 맞춤형 대시보드 — 팀에 필요한 뷰를 만드세요. |
| 🐛 | **오류 추적** | 전체 스택 트레이스, 컨텍스트, 릴리스 추적과 함께 예외를 캡처합니다. |
| ⚡ | **워크플로** | Slack, Jira, GitHub, Microsoft Teams 및 5,000개 이상의 앱과 자동화 및 통합. |
| 🤖 | **AI 코파일럿** | 로그, 트레이스, 메트릭 전반에서 이상 징후를 찾고, 근본 원인을 파악하며, 수정 사항으로 PR을 여는 상시 작동 에이전트. |

### 🖥️ 인프라 모니터링

복사-붙여넣기가 가능한 **OpenTelemetry 기반** 에이전트를 배치하여 서비스가 실행되는 모든 것을 관찰하세요 — 바로 사용할 수 있는 알림 템플릿이 포함되어 있습니다:

- **서버 및 VM** — Linux, macOS, Windows에서 CPU, 메모리, 디스크, 네트워크, 프로세스, 로그. [문서 →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** — 하나의 `helm install`로 노드/파드/컨테이너/클러스터 메트릭, 이벤트, 로그, eBPF 트레이스 및 서비스 맵을 제공합니다. [문서 →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** — 단일 에이전트가 모든 컨테이너를 자동 검색하고 메트릭과 로그를 전송합니다. [문서 →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** — Podman의 Docker 호환 소켓을 통한 동일한 단일 에이전트 자동 검색. [문서 →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** — 노드, VM, 컨테이너, 스토리지, HA 상태, 백업 커버리지, 복제 상태. [문서 →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** — 클러스터 상태, 용량 예측, OSD/풀/PG/모니터 가시성. [문서 →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

<details>
<summary><b>📸 스크린샷 보기</b></summary>
<br/>

**가동 시간 모니터링**
![Monitoring](/Home/Static/img/readme/monitoring.png?raw=true)

**상태 페이지**
![Status Pages](/Home/Static/img/readme/statuspages.png?raw=true)

**인시던트 관리**
![Incident Management](/Home/Static/img/readme/incident-management.png?raw=true)

**온콜 및 알림**
![On Call and Alerts](/Home/Static/img/readme/on-call.png?raw=true)

**로그 관리**
![Logs Management](/Home/Static/img/readme/logs-management.png?raw=true)

**애플리케이션 성능 모니터링**
![APM](/Home/Static/img/readme/apm.png?raw=true)

**워크플로**
![Workflows](/Home/Static/img/readme/workflows.png?raw=true)

</details>

---

## 💼 커뮤니티 vs. 엔터프라이즈

| | **커뮤니티** | **엔터프라이즈** |
|---|---|---|
| **적합한 대상** | 셀프 호스터 및 소규모 팀 | 프리미엄 지원이 필요한 규제 대상 팀 |
| **비용** | 무료 및 오픈소스 | [영업팀에 문의](mailto:sales@oneuptime.com) |
| **기능** | 전체 기능 세트 | 전체 기능 세트 + 강화된 이미지, 우선 지원, 맞춤 기능, 데이터 레지던시 |

---

## 💡 왜 OneUptime인가?

우리의 사명은 간단합니다: **다운타임을 줄이고 더 많은 제품이 성공하도록 돕는 것.** 일곱 개의 벤더를 억지로 이어 붙이는 대신, 무엇이 *왜* 고장 나는지 이해하고, 인시던트에 빠르게 대응하며, 운영 부담을 줄이는 데 도움이 되는 하나의 플랫폼을 얻게 됩니다 — 완전한 오픈소스이므로 데이터와 스택을 온전히 소유합니다.

---

<a name="contributing"></a>

## 🤝 기여하기

크고 작은 모든 기여를 환영합니다. 여기서 시작하세요:

- 🐛 **[열린 이슈](https://github.com/OneUptime/oneuptime/issues)** — 하나를 골라 맡거나 [새 이슈를 등록](https://github.com/OneUptime/oneuptime/issues/new)하세요
- ✅ 코드베이스를 위한 **[테스트 작성 돕기](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)**
- 🧑‍💻 환경 설정을 위한 **[로컬 개발 가이드](/App/FeatureSet/Docs/Content/en/installation/local-development.md)**
- 📖 **[기여 가이드라인](CONTRIBUTING.md)** 읽기
- 💬 **[개발자 Slack](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** 또는 **[커뮤니티 Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)**에서 함께 이야기 나누기

## ❤️ 프로젝트 후원하기

OneUptime이 유용하다면:

- ⭐ **이 저장소에 별을 눌러 주세요** — 다른 사람들이 우리를 찾는 데 정말로 도움이 됩니다
- 💵 **[후원하기](https://github.com/sponsors/OneUptime)** — 모든 후원이 새로운 기능을 만들어 냅니다
- 🛍️ **[굿즈 구매하기](https://shop.oneuptime.com)** — 모든 수익은 오픈소스 개발에 사용됩니다

---

## 📄 라이선스

OneUptime은 [Apache License 2.0](LICENSE)에 따라 라이선스가 부여됩니다.

<div align="center">
  <sub><a href="https://oneuptime.com">OneUptime</a> 팀과 <a href="https://github.com/OneUptime/oneuptime/graphs/contributors">기여자들</a>이 ❤️를 담아 만들었습니다.</sub>
</div>
