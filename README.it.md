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
    <img alt="Logo di OneUptime" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>Un'unica piattaforma open-source per uptime, incidenti, reperibilità, pagine di stato, log, tracce, metriche e APM.</h3>

  <p>Monitoraggio, StatusPage, Reperibilità, Incidenti, Log e APM — sostituisci un intero scaffale di strumenti SaaS con una sola piattaforma che puoi ospitare autonomamente gratis.</p>

  <p>
    <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/github/license/OneUptime/oneuptime?color=1a73e8" alt="Licenza"></a>
    <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
    <a href="https://github.com/OneUptime/oneuptime/stargazers"><img src="https://img.shields.io/github/stars/OneUptime/oneuptime?style=flat" alt="Stelle"></a>
    <a href="https://artifacthub.io/packages/helm/oneuptime/oneuptime"><img src="https://img.shields.io/badge/Helm-Chart-0f1689" alt="Helm Chart"></a>
    <a href="https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA"><img src="https://img.shields.io/badge/Slack-Community-4A154B" alt="Slack"></a>
  </p>

  <p>
    <a href="https://oneuptime.com"><b>Sito web</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/docs"><b>Documentazione</b></a> &nbsp;•&nbsp;
    <a href="#quick-start"><b>Avvio rapido</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/pricing"><b>Prezzi</b></a> &nbsp;•&nbsp;
    <a href="#contributing"><b>Contribuisci</b></a>
  </p>

  <a href="https://oneuptime.com"><b>🚀 Prova OneUptime Cloud — piano gratuito per sempre, senza carta di credito →</b></a>
</div>

<br/>

<div align="center">
  <img alt="Dashboard di OneUptime" width="90%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/monitoring.png"/>
</div>

---

## Sostituisci l'intero stack di observability

OneUptime riunisce monitoraggio, notifiche, gestione degli incidenti e observability in un'unica app open-source — così smetti di pagare (e di mettere insieme) una dozzina di strumenti separati.

| Invece di… | Usa OneUptime per… |
|---|---|
| Pingdom / UptimeRobot | **Monitoraggio dell'Uptime** — controlli di siti web, API, ping, porte, SSL, DNS e controlli sintetici da tutto il mondo |
| StatusPage.io | **Pagine di Stato** — pagine di stato pubbliche e private personalizzate con iscritti |
| PagerDuty / Opsgenie | **Reperibilità e Notifiche** — turni, policy di escalation, SMS / chiamate / push / Slack |
| Incident.io | **Gestione degli Incidenti** — dichiara, valuta, comunica e fai il post-mortem |
| Datadog / New Relic | **APM e Metriche** — tracce, dashboard e prestazioni dei servizi |
| Loggly | **Gestione dei Log** — raccogli, cerca e ricevi notifiche sui log |
| Sentry | **Tracciamento degli Errori** — eccezioni con stack trace e contesto completi |

Tutto questo è **100% open source (Apache 2.0)** e gratuito da ospitare autonomamente.

---

<a name="quick-start"></a>

## ⚡ Avvio rapido

### ☁️ OneUptime Cloud — la via facile

Zero configurazione, sempre aggiornato, e finanzia il progetto open-source.

**→ [Registrati gratis su oneuptime.com](https://oneuptime.com)**

### 🐳 Ospitalo autonomamente con Docker Compose

Tutto ciò di cui hai bisogno su un singolo server (Debian / Ubuntu / RHEL, Docker + Docker Compose). Ottimo per homelab e piccoli team — funziona persino un Raspberry Pi.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config (then edit it — set strong, random secrets!)
cp config.example.env config.env

# 3. Start everything
npm start
```

OneUptime ora è in esecuzione su **http://localhost** — aprilo e crea il tuo primo account.

📖 Guida completa: [Installazione con Docker Compose](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [Dimensionamento e requisiti](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ Kubernetes con Helm — per la produzione

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 Istruzioni di installazione complete e valori su [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **Stai aggiornando un'installazione esistente?** Consulta la [guida all'aggiornamento](/App/FeatureSet/Docs/Content/en/installation/upgrading.md).

---

## ✨ Funzionalità

| | Funzionalità | Cosa fa |
|---|---|---|
| 📊 | **Monitoraggio dell'Uptime** | Monitor di siti web, API, IP, porte, SSL, DNS e sintetici da più regioni globali. |
| 📋 | **Pagine di Stato** | Splendide pagine di stato personalizzate, cronologia degli incidenti, manutenzioni pianificate e notifiche agli iscritti. |
| 🚨 | **Gestione degli Incidenti** | Flusso di lavoro degli incidenti end-to-end: dichiara, assegna, comunica, risolvi ed esegui i post-mortem. |
| 📞 | **Reperibilità e Notifiche** | Turni di reperibilità e policy di escalation con notifiche via SMS, chiamata telefonica, push, email e Slack. |
| 📝 | **Gestione dei Log** | Acquisisci, archivia, cerca e ricevi notifiche sui log tramite OpenTelemetry. |
| 🔍 | **APM e Tracce** | Tracce distribuite, span e dashboard delle prestazioni per individuare percorsi lenti e colli di bottiglia. |
| 📈 | **Metriche e Dashboard** | Dashboard personalizzate sulla tua telemetria — costruisci le viste di cui il tuo team ha bisogno. |
| 🐛 | **Tracciamento degli Errori** | Cattura le eccezioni con stack trace completi, contesto e tracciamento delle release. |
| ⚡ | **Workflow** | Automatizza e integra con Slack, Jira, GitHub, Microsoft Teams e oltre 5.000 app. |
| 🤖 | **AI Copilot** | Un agente sempre attivo che rileva anomalie tra log, tracce e metriche, individua le cause principali e apre PR con le correzioni. |

### 🖥️ Monitoraggio dell'infrastruttura

Inserisci agenti **basati su OpenTelemetry** con un semplice copia-incolla per tenere d'occhio tutto ciò su cui girano i tuoi servizi — con modelli di notifica già pronti inclusi:

- **Server e VM** — CPU, memoria, disco, rete, processi e log da Linux, macOS e Windows. [Documentazione →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** — un solo `helm install` fornisce metriche di nodi/pod/container/cluster, eventi, log e tracce eBPF e mappe dei servizi. [Documentazione →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** — un singolo agente rileva automaticamente ogni container e invia metriche e log. [Documentazione →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** — la stessa auto-rilevazione con un unico agente tramite il socket compatibile con Docker di Podman. [Documentazione →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** — nodi, VM, container, storage, stato HA, copertura dei backup e integrità della replica. [Documentazione →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** — integrità del cluster, previsioni di capacità e visibilità su OSD/pool/PG/monitor. [Documentazione →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

<details>
<summary><b>📸 Guarda gli screenshot</b></summary>
<br/>

**Monitoraggio dell'Uptime**
![Monitoring](/Home/Static/img/readme/monitoring.png?raw=true)

**Pagine di Stato**
![Status Pages](/Home/Static/img/readme/statuspages.png?raw=true)

**Gestione degli Incidenti**
![Incident Management](/Home/Static/img/readme/incident-management.png?raw=true)

**Reperibilità e Notifiche**
![On Call and Alerts](/Home/Static/img/readme/on-call.png?raw=true)

**Gestione dei Log**
![Logs Management](/Home/Static/img/readme/logs-management.png?raw=true)

**Application Performance Monitoring**
![APM](/Home/Static/img/readme/apm.png?raw=true)

**Workflow**
![Workflows](/Home/Static/img/readme/workflows.png?raw=true)

</details>

---

## 💼 Community vs. Enterprise

| | **Community** | **Enterprise** |
|---|---|---|
| **Ideale per** | Chi ospita autonomamente e piccoli team | Team regolamentati che necessitano di supporto premium |
| **Costo** | Gratuito e open source | [Contatta il team commerciale](mailto:sales@oneuptime.com) |
| **Funzionalità** | Set completo di funzionalità | Set completo di funzionalità + immagini rafforzate, supporto prioritario, funzionalità personalizzate e residenza dei dati |

---

## 💡 Perché OneUptime?

La nostra missione è semplice: **ridurre i tempi di inattività e aiutare più prodotti ad avere successo.** Invece di tenere insieme con lo scotch sette fornitori diversi, ottieni un'unica piattaforma che ti aiuta a capire *perché* le cose si rompono, a rispondere rapidamente agli incidenti e a ridurre il lavoro operativo ripetitivo — completamente open source, così sei tu il proprietario dei tuoi dati e del tuo stack.

---

<a name="contributing"></a>

## 🤝 Contribuire

Accogliamo con favore contributi di ogni dimensione. Inizia da qui:

- 🐛 **[Issue aperte](https://github.com/OneUptime/oneuptime/issues)** — prendine una in carico, oppure [aprine una nuova](https://github.com/OneUptime/oneuptime/issues/new)
- ✅ **[Aiuta a scrivere i test](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)** per il codice
- 🧑‍💻 **[Guida allo sviluppo locale](/App/FeatureSet/Docs/Content/en/installation/local-development.md)** per configurare l'ambiente
- 📖 Leggi le **[linee guida per contribuire](CONTRIBUTING.md)**
- 💬 Fai due chiacchiere con noi sullo **[Slack per sviluppatori](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** o sullo **[Slack della community](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)**

## ❤️ Sostieni il progetto

Se OneUptime ti è utile:

- ⭐ **Metti una stella a questo repo** — aiuta davvero gli altri a trovarci
- 💵 **[Sponsorizzaci](https://github.com/sponsors/OneUptime)** — ogni dollaro porta nuove funzionalità
- 🛍️ **[Prendi un po' di merchandising](https://shop.oneuptime.com)** — tutti i proventi finanziano lo sviluppo open-source

---

## 📄 Licenza

OneUptime è rilasciato sotto la [Apache License 2.0](LICENSE).

<div align="center">
  <sub>Fatto con ❤️ dal team di <a href="https://oneuptime.com">OneUptime</a> e dai <a href="https://github.com/OneUptime/oneuptime/graphs/contributors">contributori</a>.</sub>
</div>
