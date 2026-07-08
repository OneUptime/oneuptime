<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <a href="/README.md">English</a> ·
  <a href="/translations/README.zh-CN.md">简体中文</a> ·
  <a href="/translations/README.zh-TW.md">繁體中文</a> ·
  <a href="/translations/README.ja.md">日本語</a> ·
  <a href="/translations/README.ko.md">한국어</a> ·
  <a href="/translations/README.es.md">Español</a> ·
  <a href="/translations/README.fr.md">Français</a> ·
  <a href="/translations/README.de.md">Deutsch</a> ·
  <a href="/translations/README.pt.md">Português</a> ·
  <a href="/translations/README.it.md">Italiano</a> ·
  <a href="/translations/README.ru.md">Русский</a> ·
  <a href="/translations/README.hi.md">हिन्दी</a> ·
  <a href="/translations/README.nl.md">Nederlands</a> ·
  <a href="/translations/README.da.md">Dansk</a> ·
  <a href="/translations/README.sv.md">Svenska</a> ·
  <a href="/translations/README.no.md">Norsk</a>
</p>

<div align="center">
  <a href="https://oneuptime.com">
    <img alt="OneUptime 로고" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>에이전틱 옵저버빌리티 — 가동 시간, 인시던트, 온콜, 상태 페이지, 로그, 트레이스, 메트릭 및 APM을 위한 하나의 오픈소스 플랫폼.</h3>

  <p><b>문제가 발생하면 가장 먼저 알아채고, 가장 빠르게 해결하세요.</b></p>

  <p>OneUptime은 여러 개의 SaaS 도구를 무료로 셀프 호스팅할 수 있는 하나의 플랫폼으로 대체합니다. 장애를 감지하고, 적임자를 호출하며, 상태 페이지를 갱신하고, 근본 원인을 찾아내고, 수정 PR까지 열어줍니다.</p>

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
    <a href="https://oneuptime.com/pricing"><b>가격</b></a> &nbsp;•&nbsp;
    <a href="#contributing"><b>기여하기</b></a>
  </p>

  <a href="https://oneuptime.com"><b>🚀 OneUptime Cloud를 사용해 보세요 — 영구 무료 요금제, 신용카드 불필요 →</b></a>
</div>

<br/>

<div align="center">
  <img alt="실시간 인시던트가 진행 중인 OneUptime 관제 센터" width="92%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/hero-command-center.png"/>
</div>

---

## 옵저버빌리티 스택 전체를 대체하세요

OneUptime은 모니터링, 알림, 인시던트 대응, 옵저버빌리티를 하나의 오픈소스 앱으로 통합합니다 — 그래서 여러 개의 개별 도구를 위해 비용을 지불하거나 이를 이어 붙일 필요가 없습니다.

| 이것 대신… | OneUptime을 이렇게 사용하세요… |
|---|---|
| Pingdom / UptimeRobot | **가동 시간 모니터링** — 전 세계 여러 지역에서 웹사이트, API, ping, 포트, SSL, DNS 및 신테틱 검사 |
| StatusPage.io | **상태 페이지** — 구독자를 갖춘 브랜드화된 공개 및 비공개 상태 페이지 |
| PagerDuty / Opsgenie | **온콜 및 알림** — 스케줄, 에스컬레이션 정책, SMS / 통화 / 푸시 / Slack |
| Incident.io | **인시던트 관리** — 선언, 분류, 커뮤니케이션, 사후 분석 |
| Datadog / New Relic | **APM 및 메트릭** — 트레이스, 대시보드, 서비스 성능 |
| Loggly | **로그 관리** — 로그 수집, 검색, 알림 |
| Sentry | **오류 추적** — 전체 스택 트레이스와 컨텍스트를 포함한 예외 |

이 모든 것이 **100% 오픈소스(Apache 2.0)**이며 셀프 호스팅이 무료입니다.

---

<details>
<summary><b>🌙 하나의 인시던트, 처음부터 끝까지 처리</b></summary>

<br/>

새벽 2시 47분. 결제가 타임아웃되기 시작합니다. 대부분의 도구가 첫 알림을 울리기도 전에 OneUptime이 무엇을 하는지 — 그리고 아래 스크린샷이 실제로 무엇을 보여주는지 확인하세요.

### 1 · 감지 — *몇 초 만에 파악*

여러 지역의 프로브가 결제 지연 시간이 5초 임계값을 넘어서는 것을 포착하고 자동으로 인시던트를 엽니다 — 고객이 새로고침을 누르기도 전에.

![감지 — 글로벌 모니터링이 결제 API의 성능 저하를 포착](/Home/Static/img/readme/detect.png?raw=true)

### 2 · 대응 — *적임자에게 호출*

Payments 정책의 온콜 엔지니어에게 전화, 문자, 푸시 알림이 전송되며, 누군가 확인할 때까지 자동으로 백업으로 에스컬레이션됩니다.

![대응 — 인시던트가 온콜로 라우팅되어 확인됨](/Home/Static/img/readme/respond.png?raw=true)

### 3 · 커뮤니케이션 — *고객에게 상황 공유*

상태 페이지가 스스로 갱신되고 모든 구독자에게 이메일과 SMS로 알림이 전송됩니다 — 누구도 직접 업데이트를 작성할 필요가 없습니다.

![커뮤니케이션 — 공개 상태 페이지가 갱신되고 구독자에게 알림](/Home/Static/img/readme/communicate.png?raw=true)

### 4 · 진단 — *근본 원인 발견*

트레이스, 로그, 메트릭이 정확한 스팬 단위까지 상관 분석됩니다: 누락된 인덱스에 막혀 `orders`에서 느리게 실행되는 `SELECT … FOR UPDATE`.

![진단 — 트레이스 워터폴이 느린 데이터베이스 스팬을 정확히 짚어냄](/Home/Static/img/readme/diagnose.png?raw=true)

### 5 · 자동 수정 — *수정안을 대신 작성*

AI 에이전트가 인시던트에 연결된 수정 사항을 담은 풀 리퀘스트를 테스트를 통과한 상태로 엽니다 — 여러분은 검토하고 병합만 하면 됩니다. 결코 잠들지 않는 SRE처럼.

![자동 수정 — AI 에이전트가 수정 사항을 담은 풀 리퀘스트를 엶](/Home/Static/img/readme/autofix.png?raw=true)

</details>

---

<a name="quick-start"></a>

## ⚡ 빠른 시작

### ☁️ OneUptime Cloud — 가장 쉬운 방법

설정이 필요 없고, 항상 최신 상태이며, 오픈소스 프로젝트를 지원합니다.

**→ [oneuptime.com에서 무료로 가입하세요](https://oneuptime.com)**

### 🐳 Docker Compose로 셀프 호스팅

단일 서버(Debian / Ubuntu / RHEL, Docker + Docker Compose)에 필요한 모든 것이 담겨 있습니다. 홈랩과 소규모 팀에 적합하며 — Raspberry Pi에서도 작동합니다.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config (then edit it — set strong, random secrets!)
cp config.example.env config.env

# 3. Start everything
npm start
```

이제 OneUptime이 **http://localhost**에서 실행됩니다 — 열어서 첫 계정을 만드세요.

📖 전체 가이드: [Docker Compose 설치](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [사이징 및 요구 사항](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ Helm을 사용한 Kubernetes — 프로덕션용

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 전체 설치 방법 및 값은 [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)에서 확인하세요

> **기존 설치를 업그레이드하시나요?** [업그레이드 가이드](/App/FeatureSet/Docs/Content/en/installation/upgrading.md)를 참고하세요.

---

## ✨ 기본 제공되는 모든 기능

| | 기능 | 하는 일 |
|---|---|---|
| 📊 | **가동 시간 모니터링** | 전 세계 여러 지역에서 웹사이트, API, IP, 포트, SSL, DNS 및 신테틱 모니터. |
| 📋 | **상태 페이지** | 아름답게 브랜드화된 상태 페이지, 인시던트 이력, 예정된 유지보수, 구독자 알림. |
| 🚨 | **인시던트 관리** | 선언, 배정, 커뮤니케이션, 해결, 사후 분석까지 이어지는 엔드투엔드 인시던트 워크플로. |
| 📞 | **온콜 및 알림** | SMS, 전화 통화, 푸시, 이메일, Slack 알림을 갖춘 온콜 스케줄 및 에스컬레이션 정책. |
| 📝 | **로그 관리** | OpenTelemetry를 통해 로그를 수집, 저장, 검색하고 알림을 받습니다. |
| 🔍 | **APM 및 트레이스** | 느린 경로와 병목을 찾기 위한 분산 트레이스, 스팬, 성능 대시보드. |
| 📈 | **메트릭 및 대시보드** | 텔레메트리 전반에 걸친 맞춤형 대시보드 — 팀에 필요한 뷰를 직접 구성하세요. |
| 🐛 | **오류 추적** | 전체 스택 트레이스, 컨텍스트, 릴리스 추적과 함께 예외를 포착합니다. |
| ⚡ | **워크플로** | Slack, Jira, GitHub, Microsoft Teams 및 5,000개 이상의 앱과 자동화하고 통합하세요. |
| 🤖 | **AI 코파일럿** | 로그, 트레이스, 메트릭 전반의 이상을 찾고, 근본 원인을 짚어내며, 수정 사항을 담은 PR을 여는 상시 가동 에이전트. |

<details>
<summary><b>⚡ 반복 작업을 자동화하세요</b></summary>

<br/>

에스컬레이션, 티켓 발행, 알림을 시각적인 노코드 캔버스에서 연결하거나 — 맞춤형 코드를 넣으세요. 위의 인시던트는 아무도 손대지 않고도 온콜을 호출하고, Jira 티켓을 열고, Slack에 게시했습니다.

![워크플로 — 인시던트 에스컬레이션을 위한 노코드 자동화 캔버스](/Home/Static/img/readme/workflows.png?raw=true)

</details>

### 🖥️ 인프라 모니터링

복사하여 붙여넣는 **OpenTelemetry 기반** 에이전트를 넣어 서비스가 구동되는 모든 것을 감시하세요 — 바로 사용할 수 있는 알림 템플릿도 포함되어 있습니다:

- **서버 및 VM** — Linux, macOS, Windows에서 CPU, 메모리, 디스크, 네트워크, 프로세스, 로그. [문서 →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** — 한 번의 `helm install`로 노드/파드/컨테이너/클러스터 메트릭, 이벤트, 로그, eBPF 트레이스 및 서비스 맵이 제공됩니다. [문서 →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** — 단일 에이전트가 모든 컨테이너를 자동으로 발견하고 메트릭과 로그를 전송합니다. [문서 →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** — Podman의 Docker 호환 소켓을 통한 동일한 단일 에이전트 자동 발견. [문서 →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** — 노드, VM, 컨테이너, 스토리지, HA 상태, 백업 커버리지 및 복제 상태. [문서 →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** — 클러스터 상태, 용량 예측, OSD/풀/PG/모니터 가시성. [문서 →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

---

## 💼 커뮤니티 vs. 엔터프라이즈

| | **커뮤니티** | **엔터프라이즈** |
|---|---|---|
| **적합 대상** | 셀프 호스터 및 소규모 팀 | 프리미엄 지원이 필요한 규제 산업 팀 |
| **비용** | 무료 및 오픈소스 | [영업팀 문의](mailto:sales@oneuptime.com) |
| **기능** | 전체 기능 세트 | 전체 기능 세트 + 강화된 이미지, 우선 지원, 맞춤형 기능 및 데이터 레지던시 |

---

## 💡 왜 OneUptime인가요?

우리의 사명은 간단합니다: **다운타임을 줄이고 더 많은 제품이 성공하도록 돕는 것.** 일곱 개의 벤더를 억지로 이어 붙이는 대신, 문제가 *왜* 발생하는지 이해하고, 인시던트에 빠르게 대응하며, 운영 부담을 줄이도록 돕는 하나의 플랫폼을 얻습니다 — 완전한 오픈소스이므로 데이터와 스택을 여러분이 소유합니다.

---

<a name="contributing"></a>

## 🤝 기여하기

크기에 관계없이 모든 기여를 환영합니다. 여기서 시작하세요:

- 🐛 **[열린 이슈](https://github.com/OneUptime/oneuptime/issues)** — 하나 골라 맡거나, [새로 등록](https://github.com/OneUptime/oneuptime/issues/new)하세요
- ✅ 코드베이스를 위한 **[테스트 작성 돕기](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)**
- 🧑‍💻 환경을 설정하려면 **[로컬 개발 가이드](/App/FeatureSet/Docs/Content/en/installation/local-development.md)**
- 📖 **[기여 가이드라인](/CONTRIBUTING.md)**을 읽어보세요
- 💬 **[개발자 Slack](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** 또는 **[커뮤니티 Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)**에서 대화하세요

## ❤️ 프로젝트 후원하기

OneUptime이 유용하다면:

- ⭐ **이 저장소에 스타를 눌러주세요** — 다른 사람들이 우리를 찾는 데 정말 도움이 됩니다
- 💵 **[후원하기](https://github.com/sponsors/OneUptime)** — 모든 후원금은 새로운 기능으로 이어집니다
- 🛍️ **[굿즈 구매하기](https://shop.oneuptime.com)** — 모든 수익은 오픈소스 개발에 사용됩니다

---

## 📄 라이선스

OneUptime은 [Apache License 2.0](/LICENSE)에 따라 라이선스가 부여됩니다.

<div align="center">
  <sub><a href="https://oneuptime.com">OneUptime</a> 팀과 <a href="https://github.com/OneUptime/oneuptime/graphs/contributors">기여자들</a>이 ❤️를 담아 만들었습니다.</sub>
</div>
