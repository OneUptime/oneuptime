# Per iniziare

OneUptime è una piattaforma di osservabilità open source. Controlla che i tuoi siti web, le tue API e i tuoi server funzionino, raccoglie i log, le metriche e le tracce che le tue applicazioni inviano, avvisa chi è reperibile quando qualcosa si guasta e informa i tuoi clienti su una pagina di stato. Tutto avviene in un solo prodotto: lo strumento che nota un problema è lo stesso che avvisa il tuo team. Usalo su OneUptime Cloud oppure eseguilo sui tuoi server.

## Cosa vuoi fare?

:::cards
- [Sapere quando il tuo sito web o la tua API smette di funzionare](/docs/guides/website-down): Controllalo da sonde in tutto il mondo e ricevi un'email o un avviso quando si guasta.
- [Essere avvisati per chiamata, SMS o push, ed eseguire l'escalation](/docs/guides/paging): Avvisa chi è reperibile, e la persona successiva se nessuno risponde.
- [Pubblicare una pagina di stato sul tuo dominio](/docs/guides/status-page): Racconta ai tuoi clienti cosa succede, a un indirizzo tutto tuo.
- [Inviare log, metriche e tracce](/docs/telemetry/open-telemetry): Invia la telemetria delle tue applicazioni con OpenTelemetry, cercala e ricevi avvisi su di essa.
- [Monitorare un server](/docs/telemetry/hosts): Aggiungi un host con un comando e tieni d'occhio CPU, memoria e dischi.
- [Monitorare un cluster Kubernetes](/docs/telemetry/kubernetes-agent): Installa l'agent con Helm e tieni d'occhio ogni nodo e ogni pod.
- [Coinvolgere il tuo team](/docs/permissions/index): Invita persone, organizzale in team e decidi chi può fare cosa.
- [Gestire un incidente dal primo avviso al post-mortem](/docs/incidents/index): Dichiaralo, lavoraci con il tuo team, tieni informati i clienti e impara da esso.
:::

## Nuovo su OneUptime?

:::cards
- [Guida rapida](/docs/introduction/quickstart): Monitorare un sito web, essere avvisati quando si guasta e pubblicare una pagina di stato.
- [Concetti fondamentali](/docs/introduction/core-concepts): Le poche idee su cui si basa tutto il resto, e come si collegano.
- [Glossario](/docs/introduction/glossary): Ogni parola che OneUptime usa, in una o due frasi, con i suoi altri nomi.
- [Quale usare?](/docs/introduction/which-one): Incidente o avviso, workflow o runbook, e gli altri elementi simili fianco a fianco.
:::

Esegui OneUptime sui tuoi server? Segui prima la [Guida al self-hosting](/docs/installation/self-hosting-guide): ti porta da un server vuoto a uno che invia email e avvisa le persone.

## Se arrivi da un altro strumento

**Impostazioni del progetto → Avanzato → Importa da un altro strumento** legge la tua configurazione in un altro strumento, con una chiave API oppure, per Uptime Kuma, un file. Ti mostra cosa ha trovato e crea ciò che selezioni. Nell'altro strumento non cambia nulla, e ripetere l'importazione non crea mai nulla due volte.

Invii già telemetria con Prometheus, un client Loki, un forwarder Splunk, il Datadog Agent o un SDK Sentry? Tienilo e puntalo su OneUptime con una chiave di acquisizione: [Prometheus, Loki, Splunk, Datadog & Sentry](/docs/telemetry/compatible-endpoints) spiega come.

:::details Gli undici strumenti da cui importa
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
:::

:::details Cosa sostituisce OneUptime
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

:::details Monitoraggio
:::cards
- [Monitor](/docs/monitor/create-monitor): Controllare siti web, API, porte, DNS, server NTP, certificati e altro ancora da sonde in tutto il mondo.
- [Monitor dell'infrastruttura](/docs/monitor/host-monitor): Tenere sotto controllo server, Kubernetes, Docker, VMware, dispositivi di rete e storage.
- [Monitor di telemetria](/docs/monitor/logs-monitor): Ricevere avvisi su log, metriche, tracce, eccezioni e profili che invii.
- [SLO](/docs/slo/introduction): Seguire obiettivi di affidabilità, error budget e burn rate.
- [Sonde](/docs/probe/custom-probe): Eseguire controlli dall'interno della tua rete.
- [Quando OneUptime non riceve dati](/docs/monitor/when-oneuptime-is-not-receiving): Perché un'interruzione dal lato di OneUptime non conta mai come tuo downtime.
:::
:::

:::details Risposta agli incidenti
:::cards
- [Incidenti](/docs/incidents/index): Dichiarare, coordinare e risolvere gli incidenti, con una cronologia completa.
- [Avvisi](/docs/alerts/index): Esaminare i problemi prima che gli utenti se ne accorgano, e raggruppare il rumore in episodi.
- [Reperibilità](/docs/on-call/index): Policy, regole di escalation, turni e chi viene avvisato quando.
- [Notifiche](/docs/notifications/index): Come OneUptime vi raggiunge: i vostri metodi, le regole di reperibilità e le impostazioni delle notifiche.
- [Pagine di stato](/docs/status-pages/index): Tenere informati i clienti su pagine di stato pubbliche o private.
- [Manutenzione programmata](/docs/scheduled-maintenance/index): Annunciare i lavori pianificati e mettere in pausa i monitor coinvolti.
- [Connessioni agli spazi di lavoro](/docs/workspace-connections/slack): Gestire gli incidenti da Slack e Microsoft Teams.
:::
:::

:::details Osservabilità
:::cards
- [Telemetria](/docs/telemetry/open-telemetry): Inviare log, metriche e tracce con OpenTelemetry, e cercarli.
- [Agenti di infrastruttura](/docs/telemetry/hosts): Aggiungere un host con un comando e installare gli agenti per Kubernetes, Docker, Proxmox, VMware e altro.
- [Piattaforme applicative](/docs/telemetry/cloud-environments): Monitorare le app che esegui su ECS e Fargate, Cloud Run, App Service e altre piattaforme gestite.
- [Cloud](/docs/telemetry/cloud-accounts): Collegare i tuoi account AWS, Azure e Google Cloud e monitorare ogni risorsa al loro interno.
- [Osservabilità dell'IA](/docs/telemetry/ai-llm-observability): Seguire le conversazioni della tua IA, ed essere avvisati quando risponde male.
- [Sicurezza](/docs/telemetry/security-events): Raccogliere eventi di sicurezza e threat intelligence.
- [Sicurezza dei dati](/docs/data-security/index): Trovare i dati sensibili nei tuoi bucket, database e telemetria, e correggere il modo in cui sono conservati.
- [Osservabilità dei dati](/docs/data-observability/index): Sapere quando i dati dei tuoi database e data warehouse sono in ritardo, errati o danneggiati, e quale esecuzione, deploy o tabella ne è la causa.
- [Real User Monitoring](/docs/rum/index): Misurare l'esperienza degli utenti reali, con Core Web Vitals e session replay.
- [Dashboard](/docs/dashboards/index): Creare dashboard dalle tue metriche, dai log e dai monitor.
- [Inventario](/docs/inventory/overview): Vedere ogni servizio, host e dispositivo che OneUptime conosce.
:::
:::

:::details Automazione e IA
:::cards
- [Runbook](/docs/runbooks/index): Trasformare le procedure di intervento in passaggi che il tuo team può eseguire.
- [Moduli](/docs/forms/index): Permettere a chiunque di segnalare un problema con un modulo che apre un incidente.
- [Workflow](/docs/workflows/index): Automatizzare azioni quando succede qualcosa in OneUptime.
- [IA](/docs/ai/ai-sre): Lasciare che OneUptime AI indaghi su incidenti e avvisi, e interrogarla sui tuoi sistemi.
:::
:::

:::details Integrazioni
:::cards
- [Integrazioni](/docs/integrations/index): Collegare Jira, ServiceNow, Grafana, Datadog, Huntress, strumenti SIEM, Discord, Telegram, IRC e altro.
:::
:::

:::details Sviluppatori
:::cards
- [Riferimento API](/docs/api-reference/api-reference): Automatizzare OneUptime con la sua API REST.
- [CLI](/docs/cli/index): Gestire OneUptime dal terminale e dalla CI.
- [Provider Terraform](/docs/terraform/index): Gestire monitor, pagine di stato e reperibilità come codice.
- [Provider Crossplane](/docs/crossplane/index): Gestire il progetto da Kubernetes con Crossplane.
:::
:::

:::details Amministrazione
:::cards
- [Utenti e autorizzazioni](/docs/permissions/index): Invitare persone, organizzare team e controllare cosa possono fare.
- [Identità](/docs/identity/sso): Accedere con il single sign-on SAML o OIDC, e fornire gli utenti con SCIM.
- [Configurazione](/docs/configuration/label-and-owner-rules): Etichettare le risorse e assegnare proprietari automaticamente.
- [E-mail](/docs/emails/smtp): Inviare le e-mail di OneUptime tramite il tuo server SMTP.
- [App mobili e desktop](/docs/mobile-desktop-apps/index): Ricevere avvisi e rispondere su iOS, Android, macOS, Windows e Linux.
:::
:::

:::details Self-hosting
:::cards
- [Installazione](/docs/installation/self-hosting-guide): Installare, dimensionare e aggiornare il tuo OneUptime.
- [Configurazione self-hosted](/docs/self-hosted/architecture): Architettura, integrazioni e funzionalità Enterprise per la tua installazione.
:::
:::

## Passaggi successivi

:::cards
- [Guida rapida](/docs/introduction/quickstart): Configurare il tuo primo monitor, la prima policy di reperibilità e la prima pagina di stato.
- [Concetti fondamentali](/docs/introduction/core-concepts): Imparare le parole che usano tutte le altre pagine.
- [Home page e scorciatoie](/docs/introduction/home): Trovare qualsiasi pagina, impostazione o azione nella dashboard.
- [Docker Compose](/docs/installation/docker-compose): Eseguire OneUptime sul tuo server.
:::
