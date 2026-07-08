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
    <img alt="Logotipo da OneUptime" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>Uma plataforma de código aberto para disponibilidade, incidentes, plantão, páginas de status, logs, traces, métricas e APM.</h3>

  <p>Monitoramento, StatusPage, Plantão, Incidentes, Logs e APM — substitua uma prateleira inteira de ferramentas SaaS por uma única plataforma que você pode hospedar por conta própria gratuitamente.</p>

  <p>
    <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/github/license/OneUptime/oneuptime?color=1a73e8" alt="Licença"></a>
    <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Versão"></a>
    <a href="https://github.com/OneUptime/oneuptime/stargazers"><img src="https://img.shields.io/github/stars/OneUptime/oneuptime?style=flat" alt="Estrelas"></a>
    <a href="https://artifacthub.io/packages/helm/oneuptime/oneuptime"><img src="https://img.shields.io/badge/Helm-Chart-0f1689" alt="Helm Chart"></a>
    <a href="https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA"><img src="https://img.shields.io/badge/Slack-Community-4A154B" alt="Slack"></a>
  </p>

  <p>
    <a href="https://oneuptime.com"><b>Site</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/docs"><b>Documentação</b></a> &nbsp;•&nbsp;
    <a href="#quick-start"><b>Início Rápido</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/pricing"><b>Preços</b></a> &nbsp;•&nbsp;
    <a href="#contributing"><b>Contribuir</b></a>
  </p>

  <a href="https://oneuptime.com"><b>🚀 Experimente o OneUptime Cloud — plano gratuito para sempre, sem cartão de crédito →</b></a>
</div>

<br/>

<div align="center">
  <img alt="Painel do OneUptime" width="90%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/monitoring.png"/>
</div>

---

## Substitua toda a sua stack de observabilidade

O OneUptime reúne monitoramento, alertas, resposta a incidentes e observabilidade em um único aplicativo de código aberto — para que você pare de pagar por (e de costurar) uma dúzia de ferramentas separadas.

| Em vez de… | Use o OneUptime para… |
|---|---|
| Pingdom / UptimeRobot | **Monitoramento de Disponibilidade** — verificações de site, API, ping, porta, SSL, DNS e sintéticas a partir de todo o mundo |
| StatusPage.io | **Páginas de Status** — páginas de status públicas e privadas com sua marca e com assinantes |
| PagerDuty / Opsgenie | **Plantão e Alertas** — escalas, políticas de escalonamento, SMS / chamada / push / Slack |
| Incident.io | **Gestão de Incidentes** — declare, trie, comunique e faça o post-mortem |
| Datadog / New Relic | **APM e Métricas** — traces, dashboards e desempenho de serviços |
| Loggly | **Gestão de Logs** — colete, pesquise e receba alertas sobre logs |
| Sentry | **Rastreamento de Erros** — exceções com stack traces completos e contexto |

Tudo isso é **100% de código aberto (Apache 2.0)** e gratuito para hospedar por conta própria.

---

<a name="quick-start"></a>

## ⚡ Início Rápido

### ☁️ OneUptime Cloud — o jeito fácil

Sem configuração, sempre atualizado e que financia o projeto de código aberto.

**→ [Cadastre-se gratuitamente em oneuptime.com](https://oneuptime.com)**

### 🐳 Hospede por conta própria com o Docker Compose

Tudo o que você precisa em um único servidor (Debian / Ubuntu / RHEL, Docker + Docker Compose). Ótimo para homelabs e equipes pequenas — até um Raspberry Pi funciona.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config (then edit it — set strong, random secrets!)
cp config.example.env config.env

# 3. Start everything
npm start
```

O OneUptime agora está em execução em **http://localhost** — abra-o e crie sua primeira conta.

📖 Guia completo: [Instalação com Docker Compose](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [Dimensionamento e requisitos](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ Kubernetes com Helm — para produção

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 Instruções completas de instalação e valores no [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **Atualizando uma instalação existente?** Consulte o [guia de atualização](/App/FeatureSet/Docs/Content/en/installation/upgrading.md).

---

## ✨ Recursos

| | Recurso | O que faz |
|---|---|---|
| 📊 | **Monitoramento de Disponibilidade** | Monitores de site, API, IP, porta, SSL, DNS e sintéticos a partir de várias regiões globais. |
| 📋 | **Páginas de Status** | Belas páginas de status com sua marca, histórico de incidentes, manutenções programadas e notificações a assinantes. |
| 🚨 | **Gestão de Incidentes** | Fluxo de incidentes ponta a ponta: declare, atribua, comunique, resolva e execute post-mortems. |
| 📞 | **Plantão e Alertas** | Escalas de plantão e políticas de escalonamento com alertas por SMS, chamada telefônica, push, e-mail e Slack. |
| 📝 | **Gestão de Logs** | Ingira, armazene, pesquise e receba alertas sobre logs via OpenTelemetry. |
| 🔍 | **APM e Traces** | Traces distribuídos, spans e dashboards de desempenho para encontrar caminhos lentos e gargalos. |
| 📈 | **Métricas e Dashboards** | Dashboards personalizados sobre sua telemetria — construa as visões de que sua equipe precisa. |
| 🐛 | **Rastreamento de Erros** | Capture exceções com stack traces completos, contexto e rastreamento de versões. |
| ⚡ | **Workflows** | Automatize e integre com Slack, Jira, GitHub, Microsoft Teams e mais de 5.000 aplicativos. |
| 🤖 | **AI Copilot** | Um agente sempre ativo que encontra anomalias em logs, traces e métricas, identifica causas-raiz e abre PRs com correções. |

### 🖥️ Monitoramento de Infraestrutura

Insira agentes **baseados em OpenTelemetry**, prontos para copiar e colar, para observar tudo em que seus serviços rodam — com modelos de alerta prontos incluídos:

- **Servidores e VMs** — CPU, memória, disco, rede, processos e logs de Linux, macOS e Windows. [Documentação →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** — um único `helm install` entrega métricas de nó/pod/container/cluster, eventos, logs e traces e mapas de serviço via eBPF. [Documentação →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** — um único agente descobre automaticamente cada container e envia métricas e logs. [Documentação →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** — a mesma descoberta automática de um único agente via socket compatível com Docker do Podman. [Documentação →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** — nós, VMs, containers, armazenamento, estado de HA, cobertura de backup e saúde de replicação. [Documentação →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** — saúde do cluster, previsões de capacidade e visibilidade de OSD/pool/PG/monitor. [Documentação →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

<details>
<summary><b>📸 Veja as capturas de tela</b></summary>
<br/>

**Monitoramento de Disponibilidade**
![Monitoring](/Home/Static/img/readme/monitoring.png?raw=true)

**Páginas de Status**
![Status Pages](/Home/Static/img/readme/statuspages.png?raw=true)

**Gestão de Incidentes**
![Incident Management](/Home/Static/img/readme/incident-management.png?raw=true)

**Plantão e Alertas**
![On Call and Alerts](/Home/Static/img/readme/on-call.png?raw=true)

**Gestão de Logs**
![Logs Management](/Home/Static/img/readme/logs-management.png?raw=true)

**Monitoramento de Desempenho de Aplicações**
![APM](/Home/Static/img/readme/apm.png?raw=true)

**Workflows**
![Workflows](/Home/Static/img/readme/workflows.png?raw=true)

</details>

---

## 💼 Community vs. Enterprise

| | **Community** | **Enterprise** |
|---|---|---|
| **Ideal para** | Auto-hospedagem e equipes pequenas | Equipes reguladas que precisam de suporte premium |
| **Custo** | Gratuito e de código aberto | [Fale com vendas](mailto:sales@oneuptime.com) |
| **Recursos** | Conjunto completo de recursos | Conjunto completo de recursos + imagens reforçadas, suporte prioritário, recursos personalizados e residência de dados |

---

## 💡 Por que o OneUptime?

Nossa missão é simples: **reduzir o tempo de inatividade e ajudar mais produtos a terem sucesso.** Em vez de remendar sete fornecedores, você tem uma única plataforma que ajuda a entender *por que* as coisas quebram, responder rápido a incidentes e reduzir o trabalho operacional — totalmente de código aberto, para que você seja dono dos seus dados e da sua stack.

---

<a name="contributing"></a>

## 🤝 Contribuindo

Recebemos bem contribuições de todos os tamanhos. Comece aqui:

- 🐛 **[Issues abertas](https://github.com/OneUptime/oneuptime/issues)** — pegue uma para resolver, ou [abra uma nova](https://github.com/OneUptime/oneuptime/issues/new)
- ✅ **[Ajude a escrever testes](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)** para o código
- 🧑‍💻 **[Guia de desenvolvimento local](/App/FeatureSet/Docs/Content/en/installation/local-development.md)** para configurar seu ambiente
- 📖 Leia as **[diretrizes de contribuição](CONTRIBUTING.md)**
- 💬 Converse conosco no **[Slack de Desenvolvedores](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** ou no **[Slack da Comunidade](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)**

## ❤️ Apoie o projeto

Se o OneUptime é útil para você:

- ⭐ **Dê uma estrela neste repositório** — isso realmente ajuda outras pessoas a nos encontrarem
- 💵 **[Seja um patrocinador](https://github.com/sponsors/OneUptime)** — cada dólar entrega novos recursos
- 🛍️ **[Adquira produtos da nossa loja](https://shop.oneuptime.com)** — toda a receita financia o desenvolvimento de código aberto

---

## 📄 Licença

O OneUptime é licenciado sob a [Apache License 2.0](LICENSE).

<div align="center">
  <sub>Feito com ❤️ pela equipe do <a href="https://oneuptime.com">OneUptime</a> e pelos <a href="https://github.com/OneUptime/oneuptime/graphs/contributors">contribuidores</a>.</sub>
</div>
