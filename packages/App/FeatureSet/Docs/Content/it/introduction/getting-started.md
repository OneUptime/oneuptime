# Per iniziare

OneUptime è una piattaforma di osservabilità open source. Controlla che i tuoi siti web, le tue API e i tuoi server funzionino, raccoglie i log, le metriche e le tracce che le tue applicazioni inviano, avvisa chi è reperibile quando qualcosa si guasta e informa i tuoi clienti su una pagina di stato. Tutto avviene in un solo prodotto: lo strumento che nota un problema è lo stesso che avvisa il tuo team. Usalo su OneUptime Cloud oppure eseguilo sui tuoi server.

Inizia da qui:

:::cards
- [Guida rapida](/docs/introduction/quickstart): Monitorare un sito web, essere avvisati quando si guasta e pubblicare una pagina di stato.
- [Concetti fondamentali](/docs/introduction/core-concepts): Le poche idee su cui si basa tutto il resto, e come si collegano.
- [Home page e scorciatoie](/docs/introduction/home): Orientarsi nella dashboard, e i tasti che ti risparmiano clic.
- [Il tuo account](/docs/introduction/your-account): Il tuo profilo, la password, le passkey e l'autenticazione a due fattori.
:::

## Come si collega tutto in OneUptime

Tutto comincia da qualcosa che tieni sotto controllo. Un monitor lo verifica secondo una pianificazione, oppure legge la telemetria che invia. Quando i criteri del monitor sono soddisfatti, OneUptime dichiara un incidente o crea un avviso, avvisa chi è reperibile e mostra l'incidente sulla tua pagina di stato, se lo desideri.

```mermaid title="Da un controllo fallito a un team avvisato e a una pagina di stato aggiornata"
flowchart TB
    probes["Le sonde controllano<br/>i tuoi siti e le API"] --> monitors["Monitor"]
    telemetry["Applicazioni e agenti<br/>inviano telemetria"] --> monitors
    monitors -->|"criteri soddisfatti"| problems["Incidenti e avvisi"]
    problems --> oncall["Le policy di reperibilità<br/>avvisano il tuo team"]
    problems --> status["Le pagine di stato<br/>informano i clienti"]
```

- Un **incidente** è un problema che riguarda i tuoi utenti. Può avvisare chi è reperibile e comparire sulla tua pagina di stato.
- Un **avviso** è un problema che il tuo team deve esaminare prima che gli utenti se ne accorgano. Anch'esso può avvisare chi è reperibile, ma non compare mai su una pagina di stato.

[Concetti fondamentali](/docs/introduction/core-concepts) spiega ogni elemento in poche frasi.

## Esplorare la documentazione

La documentazione è organizzata come la barra laterale, in nove sezioni. Scegli la parte che ti serve.

### Monitoraggio

:::cards
- [Monitor](/docs/monitor/create-monitor): Controllare siti web, API, porte, DNS, server NTP, certificati e altro ancora da sonde in tutto il mondo.
- [Monitor dell'infrastruttura](/docs/monitor/server-monitor): Tenere sotto controllo server, Kubernetes, Docker, VMware, dispositivi di rete e storage.
- [Monitor di telemetria](/docs/monitor/logs-monitor): Ricevere avvisi su log, metriche, tracce, eccezioni e profili che invii.
- [SLO](/docs/slo/introduction): Seguire obiettivi di affidabilità, error budget e burn rate.
- [Sonde](/docs/probe/custom-probe): Eseguire controlli dall'interno della tua rete.
- [Quando OneUptime non riceve dati](/docs/monitor/when-oneuptime-is-not-receiving): Perché un'interruzione dal lato di OneUptime non conta mai come tuo downtime.
:::

### Risposta agli incidenti

:::cards
- [Incidenti](/docs/incidents/index): Dichiarare, coordinare e risolvere gli incidenti, con una cronologia completa.
- [Reperibilità](/docs/on-call/schedules): Turni, regole di escalation e chi viene avvisato quando.
- [Pagine di stato](/docs/status-pages/index): Tenere informati i clienti su pagine di stato pubbliche o private.
- [Connessioni agli spazi di lavoro](/docs/workspace-connections/slack): Gestire gli incidenti da Slack e Microsoft Teams.
:::

### Osservabilità

:::cards
- [Telemetria](/docs/telemetry/open-telemetry): Inviare log, metriche e tracce con OpenTelemetry, e cercarli.
- [Agenti di infrastruttura](/docs/telemetry/kubernetes-agent): Installare gli agenti per Kubernetes, host, Docker, Proxmox, VMware e altro.
- [Cloud](/docs/telemetry/cloud-environments): Osservare ECS, Cloud Run, Azure Container Apps e altre piattaforme gestite.
- [Osservabilità dell'IA](/docs/telemetry/ai-llm-observability): Seguire le conversazioni della tua IA, ed essere avvisati quando risponde male.
- [Sicurezza](/docs/telemetry/security-events): Raccogliere eventi di sicurezza e threat intelligence.
- [Real User Monitoring](/docs/rum/index): Misurare l'esperienza degli utenti reali, con Core Web Vitals e session replay.
- [Dashboard](/docs/dashboards/index): Creare dashboard dalle tue metriche, dai log e dai monitor.
- [Inventario](/docs/inventory/overview): Vedere ogni servizio, host e dispositivo che OneUptime conosce.
:::

### Automazione e IA

:::cards
- [Runbook](/docs/runbooks/index): Trasformare le procedure di intervento in passaggi che il tuo team può eseguire.
- [Moduli](/docs/forms/index): Permettere a chiunque di segnalare un problema con un modulo che apre un incidente.
- [Workflow](/docs/workflows/index): Automatizzare azioni quando succede qualcosa in OneUptime.
- [IA](/docs/ai/ai-sre): Lasciare che OneUptime AI indaghi su incidenti e avvisi, e interrogarla sui tuoi sistemi.
:::

### Integrazioni

:::cards
- [Integrazioni](/docs/integrations/index): Collegare Jira, ServiceNow, Grafana, Datadog, Huntress, strumenti SIEM, Discord, Telegram, IRC e altro.
:::

### Sviluppatori

:::cards
- [Riferimento API](/docs/api-reference/api-reference): Automatizzare OneUptime con la sua API REST.
- [CLI](/docs/cli/index): Gestire OneUptime dal terminale e dalla CI.
- [Provider Terraform](/docs/terraform/index): Gestire monitor, pagine di stato e reperibilità come codice.
:::

### Amministrazione

:::cards
- [Utenti e autorizzazioni](/docs/permissions/index): Invitare persone, organizzare team e controllare cosa possono fare.
- [Identità](/docs/identity/sso): Accedere con il single sign-on SAML o OIDC, e fornire gli utenti con SCIM.
- [Configurazione](/docs/configuration/label-and-owner-rules): Etichettare le risorse e assegnare proprietari automaticamente.
- [E-mail](/docs/emails/smtp): Inviare le e-mail di OneUptime tramite il tuo server SMTP.
- [App mobili e desktop](/docs/mobile-desktop-apps/index): Ricevere avvisi e rispondere su iOS, Android, macOS, Windows e Linux.
:::

### Self-hosting

:::cards
- [Installazione](/docs/installation/docker-compose): Installare, dimensionare e aggiornare il tuo OneUptime.
- [Configurazione self-hosted](/docs/self-hosted/architecture): Architettura, integrazioni e funzionalità Enterprise per la tua installazione.
:::

## Se arrivi da un altro strumento

### Porta con te la tua configurazione

**Impostazioni del progetto → Importa da un altro strumento** legge la tua configurazione in un altro strumento, con una chiave API oppure, per Uptime Kuma, un file. Ti mostra cosa ha trovato e crea ciò che selezioni. Nell'altro strumento non cambia nulla, e ripetere l'importazione non crea mai nulla due volte.

| Arrivi da | Cosa legge OneUptime |
| --- | --- |
| [Opsgenie](/docs/moving-to-oneuptime/opsgenie) | Utenti, team, pianificazioni, escalation e servizi |
| [PagerDuty](/docs/moving-to-oneuptime/pagerduty) | Utenti, team, pianificazioni, policy di escalation e servizi |
| [incident.io](/docs/moving-to-oneuptime/incident-io) | Utenti, team, pianificazioni, percorsi di escalation, servizi e impostazioni degli incidenti |
| [Splunk On-Call](/docs/moving-to-oneuptime/splunk-on-call) | Utenti, team, turni e policy di escalation |
| [Grafana OnCall](/docs/moving-to-oneuptime/grafana-oncall) | Utenti, team, pianificazioni e catene di escalation |
| [UptimeRobot](/docs/moving-to-oneuptime/uptimerobot) | Monitor e pagine di stato pubbliche |
| [Atlassian Statuspage](/docs/moving-to-oneuptime/atlassian-statuspage) | Pagine, i loro componenti e gruppi, e iscritti via e-mail |
| [Better Stack](/docs/moving-to-oneuptime/better-stack) | Monitor, heartbeat, pagine di stato e iscritti via e-mail |
| [Pingdom](/docs/moving-to-oneuptime/pingdom) | Controlli di uptime |
| [StatusCake](/docs/moving-to-oneuptime/statuscake) | Controlli di uptime, SSL e heartbeat |
| [Uptime Kuma](/docs/moving-to-oneuptime/uptime-kuma) | Monitor, da un backup o dalla pagina delle metriche |

### Cosa sostituisce OneUptime

| Funzionalità | Cosa fa | Sostituisce strumenti come |
| --- | --- | --- |
| Monitoraggio dell'uptime | Controlla disponibilità e tempo di risposta da località in tutto il mondo. | Pingdom, UptimeRobot |
| Pagine di stato | Mostra ai clienti lo stato attuale e la cronologia dei tuoi servizi. | Atlassian Statuspage |
| Gestione degli incidenti | Segue gli incidenti dall'inizio alla fine, con note, proprietari e una cronologia. | incident.io |
| Reperibilità e avvisi | Pianifica i turni di reperibilità ed esegue l'escalation finché qualcuno risponde. | PagerDuty, Opsgenie |
| Gestione dei log | Raccoglie, cerca e visualizza i log. | Loggly |
| Workflow | Automatizza azioni e collega OneUptime agli strumenti che usi già. | Zapier |
| Monitoraggio delle prestazioni delle applicazioni | Segue tracce, tempi di risposta, throughput e tassi di errore. | New Relic, Datadog |
| Tracciamento degli errori | Raggruppa le eccezioni con stack trace e contesto. | Sentry |

## Passaggi successivi

:::cards
- [Guida rapida](/docs/introduction/quickstart): Configurare il tuo primo monitor, la prima policy di reperibilità e la prima pagina di stato.
- [Concetti fondamentali](/docs/introduction/core-concepts): Imparare le parole che usano tutte le altre pagine.
- [Home page e scorciatoie](/docs/introduction/home): Trovare qualsiasi pagina, impostazione o azione nella dashboard.
- [Docker Compose](/docs/installation/docker-compose): Eseguire OneUptime sul tuo server.
:::
