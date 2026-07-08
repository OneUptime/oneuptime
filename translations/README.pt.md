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
    <img alt="Logotipo da OneUptime" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>Observabilidade agêntica — uma plataforma open-source para uptime, incidentes, plantão, páginas de status, logs, traces, métricas e APM.</h3>

  <p><b>Quando algo dá errado, seja o primeiro a saber — e o mais rápido a corrigir.</b></p>

  <p>A OneUptime substitui uma prateleira inteira de ferramentas SaaS por uma única plataforma que você pode auto-hospedar gratuitamente. Ela detecta a falha, aciona a pessoa certa, atualiza sua página de status, encontra a causa raiz e até abre o PR com a correção.</p>

  <p>
    <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/github/license/OneUptime/oneuptime?color=1a73e8" alt="License"></a>
    <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
    <a href="https://github.com/OneUptime/oneuptime/stargazers"><img src="https://img.shields.io/github/stars/OneUptime/oneuptime?style=flat" alt="Stars"></a>
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

  <a href="https://oneuptime.com"><b>🚀 Experimente a OneUptime Cloud — plano gratuito para sempre, sem cartão de crédito →</b></a>
</div>

<br/>

<div align="center">
  <img alt="Central de comando da OneUptime durante um incidente ao vivo" width="92%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/hero-command-center.png"/>
</div>

---

## Substitua toda a sua stack de observabilidade

A OneUptime reúne monitoramento, alertas, resposta a incidentes e observabilidade em um único aplicativo open-source — para você parar de pagar por (e de emendar) uma dúzia de ferramentas separadas.

| Em vez de… | Use a OneUptime para… |
|---|---|
| Pingdom / UptimeRobot | **Monitoramento de Uptime** — verificações de site, API, ping, porta, SSL, DNS e sintéticas de todo o mundo |
| StatusPage.io | **Páginas de Status** — páginas de status públicas e privadas com sua marca e assinantes |
| PagerDuty / Opsgenie | **Plantão e Alertas** — escalas, políticas de escalonamento, SMS / chamada / push / Slack |
| Incident.io | **Gestão de Incidentes** — declarar, triar, comunicar e fazer post-mortem |
| Datadog / New Relic | **APM e Métricas** — traces, dashboards e desempenho de serviços |
| Loggly | **Gestão de Logs** — coletar, pesquisar e alertar sobre logs |
| Sentry | **Rastreamento de Erros** — exceções com stack traces completos e contexto |

Tudo isso é **100% open source (Apache 2.0)** e gratuito para auto-hospedar.

---

<details>
<summary><b>🌙 Um incidente, resolvido de ponta a ponta</b></summary>

<br/>

São 2h47 da manhã. O checkout começa a dar timeout. Veja o que a OneUptime faz antes que a maioria das ferramentas sequer dispare o primeiro alerta — e o que as capturas de tela abaixo realmente mostram.

### 1 · Detectar — *saiba em segundos*

Sondas em várias regiões detectam a latência do checkout ultrapassando seu limite de 5s e abrem um incidente automaticamente — antes que seus clientes cliquem em atualizar.

![Detectar — o monitoramento global detecta a degradação da API de checkout](/Home/Static/img/readme/detect.png?raw=true)

### 2 · Responder — *a pessoa certa, acionada*

O engenheiro de plantão da política de Payments é chamado, recebe mensagem e notificação push, escalando para o backup automaticamente até que alguém confirme.

![Responder — o incidente é encaminhado ao plantão e confirmado](/Home/Static/img/readme/respond.png?raw=true)

### 3 · Comunicar — *clientes informados*

Sua página de status se atualiza sozinha e cada assinante é notificado por e-mail e SMS — ninguém precisa redigir a atualização à mão.

![Comunicar — a página de status pública se atualiza e notifica os assinantes](/Home/Static/img/readme/communicate.png?raw=true)

### 4 · Diagnosticar — *causa raiz, encontrada*

Traces, logs e métricas são correlacionados até o span exato: um `SELECT … FOR UPDATE` lento em `orders`, travado por um índice ausente.

![Diagnosticar — a cascata de traces identifica o span lento do banco de dados](/Home/Static/img/readme/diagnose.png?raw=true)

### 5 · Correção Automática — *a correção, redigida para você*

O agente de IA abre um pull request com a correção, vinculado ao incidente, com os testes passando — você revisa e faz o merge. Como um SRE que nunca dorme.

![Correção Automática — o agente de IA abre um pull request com a correção](/Home/Static/img/readme/autofix.png?raw=true)

</details>

---

<a name="quick-start"></a>

## ⚡ Início Rápido

### ☁️ OneUptime Cloud — o jeito fácil

Zero configuração, sempre atualizado, e ajuda a financiar o projeto open-source.

**→ [Cadastre-se gratuitamente em oneuptime.com](https://oneuptime.com)**

### 🐳 Auto-hospede com Docker Compose

Tudo o que você precisa em um único servidor (Debian / Ubuntu / RHEL, Docker + Docker Compose). Ótimo para homelabs e pequenas equipes — até um Raspberry Pi funciona.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config (then edit it — set strong, random secrets!)
cp config.example.env config.env

# 3. Start everything
npm start
```

A OneUptime já está rodando em **http://localhost** — abra e crie sua primeira conta.

📖 Guia completo: [Instalação com Docker Compose](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [Dimensionamento e requisitos](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ Kubernetes com Helm — para produção

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 Instruções completas de instalação e valores no [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **Atualizando uma instalação existente?** Consulte o [guia de atualização](/App/FeatureSet/Docs/Content/en/installation/upgrading.md).

---

## ✨ Tudo incluído

| | Recurso | O que faz |
|---|---|---|
| 📊 | **Monitoramento de Uptime** | Monitores de site, API, IP, porta, SSL, DNS e sintéticos de várias regiões globais. |
| 📋 | **Páginas de Status** | Belas páginas de status com sua marca, histórico de incidentes, manutenções agendadas e notificações a assinantes. |
| 🚨 | **Gestão de Incidentes** | Fluxo de incidente de ponta a ponta: declarar, atribuir, comunicar, resolver e conduzir post-mortems. |
| 📞 | **Plantão e Alertas** | Escalas de plantão e políticas de escalonamento com alertas por SMS, chamada telefônica, push, e-mail e Slack. |
| 📝 | **Gestão de Logs** | Ingira, armazene, pesquise e alerte sobre logs via OpenTelemetry. |
| 🔍 | **APM e Traces** | Traces distribuídos, spans e dashboards de desempenho para encontrar caminhos lentos e gargalos. |
| 📈 | **Métricas e Dashboards** | Dashboards personalizados sobre sua telemetria — crie as visões de que sua equipe precisa. |
| 🐛 | **Rastreamento de Erros** | Capture exceções com stack traces completos, contexto e rastreamento de versões. |
| ⚡ | **Workflows** | Automatize e integre com Slack, Jira, GitHub, Microsoft Teams e mais de 5.000 aplicativos. |
| 🤖 | **Copiloto de IA** | Um agente sempre ativo que encontra anomalias em logs, traces e métricas, identifica causas raiz e abre PRs com correções. |

### ⚡ Automatize o trabalho repetitivo

Configure escalonamentos, tickets e notificações em um canvas visual e no-code — ou insira código personalizado. O incidente acima acionou o plantão, abriu um ticket no Jira e publicou no Slack sem que ninguém movesse um dedo.

![Workflows — um canvas de automação no-code para escalonamento de incidentes](/Home/Static/img/readme/workflows.png?raw=true)

### 🖥️ Monitoramento de Infraestrutura

Insira agentes prontos para copiar e colar, **baseados em OpenTelemetry**, para observar tudo em que seus serviços rodam — com modelos de alerta prontos incluídos:

- **Servidores e VMs** — CPU, memória, disco, rede, processos e logs de Linux, macOS e Windows. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** — um único `helm install` entrega métricas de nó/pod/container/cluster, eventos, logs e traces & mapas de serviço via eBPF. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** — um único agente descobre automaticamente cada container e entrega métricas e logs. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** — a mesma descoberta automática de um único agente via socket compatível com Docker do Podman. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** — nós, VMs, containers, armazenamento, estado de HA, cobertura de backup e saúde da replicação. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** — saúde do cluster, previsões de capacidade e visibilidade de OSD/pool/PG/monitor. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

---

## 💼 Community vs. Enterprise

| | **Community** | **Enterprise** |
|---|---|---|
| **Ideal para** | Auto-hospedagem e pequenas equipes | Equipes reguladas que precisam de suporte premium |
| **Custo** | Gratuito e open source | [Fale com vendas](mailto:sales@oneuptime.com) |
| **Recursos** | Conjunto completo de recursos | Conjunto completo de recursos + imagens reforçadas, suporte prioritário, recursos personalizados e residência de dados |

---

## 💡 Por que a OneUptime?

Nossa missão é simples: **reduzir o tempo de inatividade e ajudar mais produtos a terem sucesso.** Em vez de emendar sete fornecedores com fita adesiva, você ganha uma plataforma que ajuda a entender *por que* as coisas quebram, a responder a incidentes rapidamente e a reduzir o trabalho operacional — totalmente open source, para que você seja dono dos seus dados e da sua stack.

---

<a name="contributing"></a>

## 🤝 Contribuindo

Damos as boas-vindas a contribuições de todos os tamanhos. Comece por aqui:

- 🐛 **[Issues abertas](https://github.com/OneUptime/oneuptime/issues)** — escolha uma, ou [abra uma nova](https://github.com/OneUptime/oneuptime/issues/new)
- ✅ **[Ajude a escrever testes](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)** para o código
- 🧑‍💻 **[Guia de desenvolvimento local](/App/FeatureSet/Docs/Content/en/installation/local-development.md)** para configurar o ambiente
- 📖 Leia as **[diretrizes de contribuição](/CONTRIBUTING.md)**
- 💬 Converse conosco no **[Slack de Desenvolvedores](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** ou no **[Slack da Comunidade](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)**

## ❤️ Apoie o projeto

Se a OneUptime for útil para você:

- ⭐ **Dê uma estrela a este repositório** — isso realmente ajuda outras pessoas a nos encontrarem
- 💵 **[Seja nosso patrocinador](https://github.com/sponsors/OneUptime)** — cada dólar entrega novos recursos
- 🛍️ **[Garanta alguns produtos](https://shop.oneuptime.com)** — toda a receita financia o desenvolvimento open-source

---

## 📄 Licença

A OneUptime é licenciada sob a [Apache License 2.0](/LICENSE).

<div align="center">
  <sub>Feito com ❤️ pela equipe da <a href="https://oneuptime.com">OneUptime</a> e pelos <a href="https://github.com/OneUptime/oneuptime/graphs/contributors">contribuidores</a>.</sub>
</div>
