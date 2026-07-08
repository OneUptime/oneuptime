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
    <img alt="Logo OneUptime" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>Osservabilità agentica — un'unica piattaforma open source per uptime, incidenti, reperibilità, pagine di stato, log, tracce, metriche e APM.</h3>

  <p><b>Quando qualcosa va storto, sii il primo a saperlo — e il più veloce a risolverlo.</b></p>

  <p>OneUptime sostituisce un intero scaffale di strumenti SaaS con un'unica piattaforma che puoi ospitare tu stesso gratuitamente. Rileva l'interruzione, avvisa la persona giusta, aggiorna la tua pagina di stato, individua la causa principale e apre persino la PR con la correzione.</p>

  <p>
    <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/github/license/OneUptime/oneuptime?color=1a73e8" alt="License"></a>
    <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
    <a href="https://github.com/OneUptime/oneuptime/stargazers"><img src="https://img.shields.io/github/stars/OneUptime/oneuptime?style=flat" alt="Stars"></a>
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
  <img alt="Centro di comando OneUptime durante un incidente in tempo reale" width="92%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/hero-command-center.png"/>
</div>

---

## Sostituisci l'intero stack di osservabilità

OneUptime riunisce monitoraggio, avvisi, gestione degli incidenti e osservabilità in un'unica app open source — così smetti di pagare (e mettere insieme) una dozzina di strumenti separati.

| Invece di… | Usa OneUptime per… |
|---|---|
| Pingdom / UptimeRobot | **Monitoraggio dell'uptime** — controlli di siti web, API, ping, porte, SSL, DNS e sintetici da tutto il mondo |
| StatusPage.io | **Pagine di stato** — pagine di stato pubbliche e private personalizzate con sottoscrittori |
| PagerDuty / Opsgenie | **Reperibilità e avvisi** — turni, policy di escalation, SMS / chiamata / push / Slack |
| Incident.io | **Gestione degli incidenti** — dichiara, valuta, comunica e fai il post-mortem |
| Datadog / New Relic | **APM e metriche** — tracce, dashboard e prestazioni dei servizi |
| Loggly | **Gestione dei log** — raccogli, cerca e ricevi avvisi sui log |
| Sentry | **Tracciamento degli errori** — eccezioni con stack trace completi e contesto |

Tutto è **100% open source (Apache 2.0)** e gratuito da ospitare in autonomia.

---

## 🌙 Un incidente, gestito dall'inizio alla fine

Sono le 2:47 del mattino. Il checkout inizia ad andare in timeout. Ecco cosa fa OneUptime prima ancora che la maggior parte degli strumenti lanci il primo avviso — e cosa mostrano realmente le schermate qui sotto.

### 1 · Rileva — *lo sai in pochi secondi*

Le sonde in più regioni rilevano la latenza del checkout che supera la tua soglia di 5s e aprono automaticamente un incidente — prima ancora che i tuoi clienti premano aggiorna.

![Rileva — il monitoraggio globale rileva il degrado dell'API di checkout](/Home/Static/img/readme/detect.png?raw=true)

### 2 · Rispondi — *la persona giusta, avvisata*

L'ingegnere reperibile per la policy Payments viene chiamato, contattato via SMS e notificato via push, con escalation automatica al backup finché qualcuno non conferma la presa in carico.

![Rispondi — l'incidente viene instradato al reperibile e preso in carico](/Home/Static/img/readme/respond.png?raw=true)

### 3 · Comunica — *i clienti sempre informati*

La tua pagina di stato si aggiorna da sola e ogni sottoscrittore viene notificato via email e SMS — nessuno deve scrivere l'aggiornamento a mano.

![Comunica — la pagina di stato pubblica si aggiorna e notifica i sottoscrittori](/Home/Static/img/readme/communicate.png?raw=true)

### 4 · Diagnostica — *causa principale, trovata*

Tracce, log e metriche vengono correlati fino allo span esatto: una `SELECT … FOR UPDATE` lenta su `orders`, bloccata da un indice mancante.

![Diagnostica — la waterfall delle tracce individua lo span lento del database](/Home/Static/img/readme/diagnose.png?raw=true)

### 5 · Correzione automatica — *la correzione, pronta per te*

L'agente AI apre una pull request con la correzione, collegata all'incidente, con i test verdi — tu revisioni e fai il merge. Come un SRE che non dorme mai.

![Correzione automatica — l'agente AI apre una pull request con la correzione](/Home/Static/img/readme/autofix.png?raw=true)

---

<a name="quick-start"></a>

## ⚡ Avvio rapido

### ☁️ OneUptime Cloud — la via facile

Zero configurazione, sempre aggiornato, e finanzia il progetto open source.

**→ [Registrati gratis su oneuptime.com](https://oneuptime.com)**

### 🐳 Self-hosting con Docker Compose

Tutto ciò di cui hai bisogno su un unico server (Debian / Ubuntu / RHEL, Docker + Docker Compose). Ottimo per homelab e piccoli team — funziona persino su un Raspberry Pi.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config (then edit it — set strong, random secrets!)
cp config.example.env config.env

# 3. Start everything
npm start
```

OneUptime è ora in esecuzione su **http://localhost** — aprilo e crea il tuo primo account.

📖 Guida completa: [Installazione con Docker Compose](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [Dimensionamento e requisiti](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ Kubernetes con Helm — per la produzione

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 Istruzioni complete di installazione e valori su [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **Stai aggiornando un'installazione esistente?** Consulta la [guida all'aggiornamento](/App/FeatureSet/Docs/Content/en/installation/upgrading.md).

---

## ✨ Tutto incluso nella confezione

| | Funzionalità | Cosa fa |
|---|---|---|
| 📊 | **Monitoraggio dell'uptime** | Monitor di siti web, API, IP, porte, SSL, DNS e sintetici da più regioni globali. |
| 📋 | **Pagine di stato** | Splendide pagine di stato personalizzate, cronologia degli incidenti, manutenzioni programmate e notifiche ai sottoscrittori. |
| 🚨 | **Gestione degli incidenti** | Flusso di lavoro completo degli incidenti: dichiara, assegna, comunica, risolvi ed esegui i post-mortem. |
| 📞 | **Reperibilità e avvisi** | Turni di reperibilità e policy di escalation con avvisi via SMS, chiamata telefonica, push, email e Slack. |
| 📝 | **Gestione dei log** | Acquisisci, archivia, cerca e ricevi avvisi sui log tramite OpenTelemetry. |
| 🔍 | **APM e tracce** | Tracce distribuite, span e dashboard delle prestazioni per individuare percorsi lenti e colli di bottiglia. |
| 📈 | **Metriche e dashboard** | Dashboard personalizzate sulla tua telemetria — costruisci le viste di cui il tuo team ha bisogno. |
| 🐛 | **Tracciamento degli errori** | Cattura le eccezioni con stack trace completi, contesto e tracciamento delle release. |
| ⚡ | **Workflow** | Automatizza e integra con Slack, Jira, GitHub, Microsoft Teams e oltre 5.000 app. |
| 🤖 | **AI Copilot** | Un agente sempre attivo che individua anomalie tra log, tracce e metriche, rileva le cause principali e apre PR con le correzioni. |

### ⚡ Automatizza il lavoro ripetitivo

Configura escalation, ticketing e notifiche su un canvas visivo e no-code — oppure inserisci codice personalizzato. L'incidente qui sopra ha avvisato il reperibile, aperto un ticket Jira e pubblicato su Slack senza che nessuno muovesse un dito.

![Workflow — un canvas di automazione no-code per l'escalation degli incidenti](/Home/Static/img/readme/workflows.png?raw=true)

### 🖥️ Monitoraggio dell'infrastruttura

Inserisci agenti **basati su OpenTelemetry** con un copia-incolla per tenere d'occhio tutto ciò su cui girano i tuoi servizi — con modelli di avviso pronti all'uso inclusi:

- **Server e VM** — CPU, memoria, disco, rete, processi e log da Linux, macOS e Windows. [Documentazione →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** — un solo `helm install` fornisce metriche di nodi/pod/container/cluster, eventi, log e tracce eBPF e mappe dei servizi. [Documentazione →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** — un unico agente rileva automaticamente ogni container e invia metriche e log. [Documentazione →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** — lo stesso rilevamento automatico con un solo agente tramite il socket compatibile con Docker di Podman. [Documentazione →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** — nodi, VM, container, storage, stato HA, copertura dei backup e salute della replica. [Documentazione →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** — salute del cluster, previsioni di capacità e visibilità su OSD/pool/PG/monitor. [Documentazione →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

---

## 💼 Community vs. Enterprise

| | **Community** | **Enterprise** |
|---|---|---|
| **Ideale per** | Self-hoster e piccoli team | Team regolamentati che necessitano di supporto premium |
| **Costo** | Gratuito e open source | [Contatta il team vendite](mailto:sales@oneuptime.com) |
| **Funzionalità** | Set completo di funzionalità | Set completo di funzionalità + immagini rafforzate, supporto prioritario, funzionalità personalizzate e residenza dei dati |

---

## 💡 Perché OneUptime?

La nostra missione è semplice: **ridurre i tempi di inattività e aiutare più prodotti ad avere successo.** Invece di tenere insieme sette fornitori con lo scotch, ottieni un'unica piattaforma che ti aiuta a capire *perché* le cose si rompono, a rispondere velocemente agli incidenti e a ridurre la fatica operativa — completamente open source, così possiedi i tuoi dati e il tuo stack.

---

<a name="contributing"></a>

## 🤝 Contribuire

Diamo il benvenuto a contributi di ogni dimensione. Inizia da qui:

- 🐛 **[Issue aperte](https://github.com/OneUptime/oneuptime/issues)** — prendine una in carico, oppure [aprine una nuova](https://github.com/OneUptime/oneuptime/issues/new)
- ✅ **[Aiuta a scrivere i test](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)** per il codebase
- 🧑‍💻 **[Guida allo sviluppo locale](/App/FeatureSet/Docs/Content/en/installation/local-development.md)** per configurare l'ambiente
- 📖 Leggi le **[linee guida per contribuire](/CONTRIBUTING.md)**
- 💬 Chatta con noi nel **[Developer Slack](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** o nel **[Community Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)**

## ❤️ Sostieni il progetto

Se OneUptime ti è utile:

- ⭐ **Metti una stella a questo repo** — aiuta davvero gli altri a trovarci
- 💵 **[Diventa sponsor](https://github.com/sponsors/OneUptime)** — ogni dollaro porta nuove funzionalità
- 🛍️ **[Acquista un po' di merchandising](https://shop.oneuptime.com)** — tutti i proventi finanziano lo sviluppo open source

---

## 📄 Licenza

OneUptime è rilasciato sotto la [Apache License 2.0](/LICENSE).

<div align="center">
  <sub>Realizzato con ❤️ dal team di <a href="https://oneuptime.com">OneUptime</a> e dai <a href="https://github.com/OneUptime/oneuptime/graphs/contributors">contributori</a>.</sub>
</div>
