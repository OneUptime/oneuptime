# Architettura

Un'installazione self-hosted di OneUptime è una manciata di container: un ingress da cui entra ogni richiesta, un'immagine dell'applicazione che fa il lavoro, le sonde che eseguono i controlli dei tuoi monitor e tre archivi di dati. Questa pagina mostra come si incastrano, che cosa fa ciascuno e quali connessioni attraversano la tua rete.

```mermaid title="Un'installazione self-hosted di OneUptime"
flowchart TB
    People["Persone<br/>e browser"]
    Senders["Mittenti di<br/>telemetria:<br/>OpenTelemetry,<br/>Fluent Bit,<br/>syslog, agenti"]
    Targets["Ciò che<br/>monitori:<br/>interno e<br/>pubblico"]
    subgraph Install["La tua rete"]
        direction TB
        Ingress["Ingress<br/>(Nginx, TLS)"]
        App["Applicazione<br/>dashboard,<br/>pagine di stato,<br/>API, ingestione,<br/>job in<br/>background"]
        Runner["Runner globale"]
        Probe["Sonde"]
        subgraph Data["Archivi di dati"]
            direction LR
            Postgres[("PostgreSQL<br/>configurazione<br/>e stato")]
            ClickHouse[("ClickHouse<br/>log, metriche,<br/>tracce")]
            Valkey[("Valkey<br/>cache e<br/>code")]
        end
    end
    People -->|"HTTPS"| Ingress
    Senders -->|"OTLP, HTTPS"| Ingress
    Ingress --> App
    Runner -->|"prendere<br/>i job,<br/>inviare i<br/>risultati"| App
    Probe -->|"prendere<br/>il lavoro,<br/>inviare i<br/>risultati"| App
    Probe -->|"HTTP, TCP, ping,<br/>DNS, SNMP"| Targets
    App --> Postgres
    App --> ClickHouse
    App --> Valkey
    Targets ~~~ Probe
```

## Cosa mostra

- Le persone raggiungono OneUptime attraverso l'**ingress**, che termina TLS e instrada ogni richiesta all'applicazione: la Dashboard, le pagine di stato, l'API e ogni endpoint di ingestione a cui viene inviata la telemetria.
- L'**applicazione** legge e scrive il proprio stato in PostgreSQL, conserva la telemetria in ClickHouse e usa Valkey (il fork con licenza BSD di Redis 7.2) come cache e per le code su cui lavorano i suoi job in background.
- Le **sonde** possono girare dentro il tuo cluster (consigliato) e/o altrove nella tua rete. Possono monitorare:
  - Servizi interni/privati dietro il tuo firewall.
  - Risorse esterne/pubbliche su internet.
- I risultati delle sonde vengono inviati all'applicazione, accodati in Valkey ed elaborati dai job in background nei tuoi archivi di dati. Una sonda che si trova altrove nella tua rete raggiunge l'applicazione attraverso l'ingress, al tuo URL di OneUptime.
- La telemetria (metriche, tracce, log e altro) viene acquisita dalla stessa applicazione e memorizzata in ClickHouse.

> [!NOTE]
> Se usi PostgreSQL, Valkey (o Redis) o ClickHouse esterni invece di quelli inclusi, l'applicazione si collega invece ai tuoi endpoint esterni. Il flusso logico resta lo stesso.

## I componenti

| Componente | Servizio Docker Compose | Chart Helm | Che cosa fa |
| --- | --- | --- | --- |
| Ingress | `ingress` | `nginx` | Termina TLS, serve il tuo nome host e i domini delle tue pagine di stato e instrada ogni richiesta all'applicazione. |
| Applicazione | `app` | `app` | La Dashboard, le pagine di stato, gli endpoint di API e di ingestione e, a meno che non li separi, i job in background. |
| Worker | Parte di `app` | `worker` (disattivato per impostazione predefinita) | I job in background, in pod propri, così che l'elaborazione pesante delle code non entri mai in competizione con le richieste API. |
| Telemetry writer | Parte di `app` | `telemetryWriter` (disattivato per impostazione predefinita) | Un livello di dimensione fissa che esegue ogni inserimento in ClickHouse, così che gli inserimenti restino limitati per quanto scalino i worker. |
| Sonda | `probe-1` | `probes` | Esegue i controlli dei monitor e invia indietro i risultati. Ogni sonda inclusa è una sonda globale che tutti i progetti possono usare. |
| Runner globale | `global-runner` | `globalRunner` | Un [Runner globale](/docs/runbooks/agents#runner-globali): esegue i passaggi JavaScript di ogni progetto che non sceglie un Runner proprio, ciascuno in una sandbox che raggiunge solo internet, e le correzioni del codice di OneUptime AI in ogni repository di codice che non ne sceglie nessuno. Ha una propria chiave e nient'altro del server. I passaggi Bash, SSH e kubectl vengono eseguiti sui [Runner](/docs/runbooks/agents) che installi dove devono essere eseguiti. |
| PostgreSQL | `postgres` | `postgresql`, oppure `postgresOperator.cnpg` | Progetti, monitor, incidenti, utenti e ogni altra impostazione e stato. |
| ClickHouse | `clickhouse` | `clickhouse`, oppure `clickhouseOperator.altinity` | Log, metriche, tracce, eccezioni, profili e log dei monitor. |
| Valkey | `valkey` | `valkey` | La cache, le code dei job e lo stato di breve durata, come le ricevute push in attesa. |

Tutti i ruoli dell'applicazione sono la stessa immagine: Docker Compose li esegue in un unico container `app`, e il chart Helm può eseguire il worker e il telemetry writer come deployment propri. Per dimensionare ogni livello, consulta [Dimensionamento e pianificazione della capacità](/docs/installation/sizing).

## Connessioni in uscita dalla tua rete

Si stabiliscono quattro connessioni, a meno che tu non cambi un'impostazione:

- Una volta al giorno, l'applicazione chiede all'API di GitHub (`api.github.com`) se è uscita una versione più recente. Legge anche gli avvisi di sicurezza pubblicati da OneUptime, così i tuoi amministratori principali vengono informati quando uno di essi riguarda la versione che esegui ([Controlli di aggiornamento e sicurezza](/docs/self-hosted/update-checks)). Per disattivarlo, imposta `updateCheck.disabled: true` nel chart Helm, oppure `DISABLE_UPDATE_CHECK=true` in `config.env` con Docker Compose.
- Una volta al giorno, l'applicazione comunica a `oneuptime.com` l'indirizzo della tua installazione e la versione che esegue, così OneUptime sa quali installazioni eseguono ancora una versione con un problema di sicurezza. Non viene inviato nulla sui tuoi utenti, progetti o dati di monitoraggio. Per disattivarlo, imposta `instanceCheckIn.disabled: true` nel chart Helm, oppure `DISABLE_INSTANCE_CHECK_IN=true` in `config.env` con Docker Compose.
- Registrarsi con «Avvisami delle patch di sicurezza e delle nuove versioni» selezionato, come lo è all'inizio, invia a `oneuptime.com` il nome e l'email della persona, l'azienda e il numero di telefono indicati, e l'indirizzo e la versione della tua installazione. Deselezionalo su una rete senza accesso a internet.
- Su Kubernetes, le sonde ricorrono ai resolver pubblici `8.8.8.8` e `1.1.1.1` dopo il DNS del tuo cluster. Imposta `dnsConfig.nameservers` su `[]` per tenere ogni risoluzione sul tuo DNS.

Tutto il resto si collega all'esterno solo quando lo attivi, e ognuno ha una pagina che indica gli indirizzi esatti da consentire:

| Connessione in uscita | Usata per | Dove approfondire |
| --- | --- | --- |
| Email (SMTP, oppure l'API di SendGrid) | Notifiche e inviti | [SMTP](/docs/emails/smtp) |
| Twilio | SMS e chiamate telefoniche | [Integrazione Twilio](/docs/self-hosted/twilio-integration) |
| Il relay push di OneUptime, oppure Expo | Notifiche push mobili | [Notifiche push](/docs/self-hosted/push-notifications) |
| Slack e Microsoft Teams | Notifiche e azioni nello spazio di lavoro | [Integrazione Slack](/docs/self-hosted/slack-integration) |
| Un provider di LLM, come OpenAI, Anthropic, Microsoft Foundry o un modello che esegui tu stesso | OneUptime AI | [Provider di LLM](/docs/ai/llm-provider) |
| `oneuptime.com` | Attivare online una licenza Enterprise | [Edizione Enterprise](/docs/self-hosted/enterprise) |

Le connessioni nell'altra direzione – SendGrid che consegna le email in arrivo, Slack e Microsoft Teams che richiamano – richiedono che l'ingress sia raggiungibile da internet. Quali indirizzi privati possano raggiungere l'applicazione e le sonde lo decidi tu: vedi [Accesso alla rete privata](/docs/self-hosted/private-network-access).

Il logo di OneUptime viaggia dentro ogni email che OneUptime invia, quindi si vede anche su una rete senza accesso a internet, e aprire un'email non chiede nulla a nessun altro host. Un logo che carichi tu, come il tuo o quello di una pagina di stato, viaggia anch'esso dentro l'email quando è un PNG, un JPEG o una GIF di 512 KB al massimo. Ogni altra immagine che carichi viene mostrata dal tuo URL di OneUptime, che chi legge quelle email deve poter raggiungere.

## Passaggi successivi

:::cards
- [Docker Compose](/docs/installation/docker-compose): Installa tutti i componenti su una sola macchina.
- [Dimensionamento e pianificazione della capacità](/docs/installation/sizing): Quanta CPU, memoria e disco serve a ogni livello.
- [Sonde personalizzate](/docs/probe/custom-probe): Esegui una sonda dentro un'altra rete.
- [Edizione Enterprise](/docs/self-hosted/enterprise): Che cosa aggiungono le immagini Enterprise e come funzionano le licenze.
:::
