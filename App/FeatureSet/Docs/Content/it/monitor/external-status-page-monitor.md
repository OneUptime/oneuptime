# Monitor Pagina di Stato Esterna

Il monitoraggio delle pagine di stato esterne consente di monitorare le pagine di stato di terze parti e ricevere avvisi quando i servizi da cui si dipende subiscono interruzioni o degradazioni delle prestazioni. OneUptime controlla periodicamente le pagine di stato esterne (come AWS, GCP, Azure, GitHub e altre) e ne valuta lo stato.

## Panoramica

I monitor per le pagine di stato esterne verificano la salute dei servizi su cui si fa affidamento interrogando le relative pagine di stato pubbliche. Questo consente di:

- Monitorare la disponibilità dei servizi di terze parti da cui dipende la propria applicazione
- Ricevere avvisi quando i provider upstream subiscono interruzioni
- Tracciare lo stato dei singoli componenti (ad es. "AWS EC2 us-east-1")
- Rilevare degradazioni delle prestazioni prima che impattino gli utenti
- Correlare i propri incidenti con i problemi dei provider upstream

## Provider Supportati

OneUptime supporta il monitoraggio delle pagine di stato tramite i seguenti metodi:

| Tipo di Provider         | Descrizione                                               |
| ------------------------ | --------------------------------------------------------- |
| **Auto** (predefinito)   | Rileva automaticamente il formato della pagina di stato   |
| **Atlassian Statuspage** | Pagine di stato basate su Atlassian Statuspage (API JSON) |
| **RSS**                  | Pagine di stato che forniscono un feed RSS                |
| **Atom**                 | Pagine di stato che forniscono un feed Atom               |

### Rilevamento Automatico

Quando è impostato su **Auto**, OneUptime tenta di rilevare automaticamente il formato della pagina di stato:

1. Prima tenta l'API JSON di Atlassian Statuspage (`/api/v2/status.json` e `/api/v2/components.json`)
2. Se fallisce, prova ad analizzare la pagina come feed RSS o Atom
3. Come ultima opzione, esegue un controllo di raggiungibilità HTTP di base

## Creazione di un Monitor per Pagina di Stato Esterna

1. Accedere a **Monitor** nel Dashboard di OneUptime
2. Fare clic su **Crea Monitor**
3. Selezionare **Pagina di Stato Esterna** come tipo di monitor
4. Inserire l'URL della pagina di stato da monitorare
5. Selezionare opzionalmente un tipo di provider specifico (o lasciare su Auto)
6. Inserire opzionalmente il nome di un componente per limitare il monitoraggio a un componente specifico
7. Configurare i criteri di monitoraggio secondo necessità

## Opzioni di Configurazione

### URL della Pagina di Stato

Inserire l'URL della pagina di stato esterna da monitorare. Per i siti basati su Atlassian Statuspage, si tratta generalmente dell'URL radice (ad es. `https://status.example.com`). Per feed RSS/Atom, inserire direttamente l'URL del feed.

### Tipo di Provider

Selezionare il tipo di provider per la pagina di stato. Usare **Auto** (predefinito) per permettere a OneUptime di rilevare automaticamente il formato, oppure specificare un tipo di provider specifico se lo si conosce.

### Filtro per Nome Componente

Se la pagina di stato riporta più componenti, è possibile specificare opzionalmente il nome di un componente da monitorare. Ad esempio, per monitorare solo AWS EC2 in us-east-1, si inserirà `EC2 us-east-1` (il nome esatto del componente come mostrato nella pagina di stato).

Quando non è specificato alcun nome di componente, viene monitorato lo stato complessivo della pagina di stato.

### Opzioni Avanzate

#### Timeout

Il tempo massimo (in millisecondi) di attesa per una risposta dalla pagina di stato. Il valore predefinito è 10000 ms (10 secondi).

#### Tentativi

Il numero di volte in cui ripetere la richiesta in caso di errore. Il valore predefinito è 3 tentativi.

## Criteri di Monitoraggio

È possibile configurare criteri per determinare quando il servizio esterno è considerato online, degradato o offline in base a:

- **È Online** – Se la pagina di stato è raggiungibile e restituisce dati sullo stato
- **Stato Complessivo** – L'indicatore di stato generale della pagina (ad es. "operational", "major_outage")
- **Stato del Componente** – Lo stato di un componente specifico (quando si usa il filtro per nome componente)
- **Incidenti Attivi** – Il numero di incidenti attualmente segnalati nella pagina di stato
- **Tempo di Risposta** – Il tempo necessario per ottenere i dati dalla pagina di stato

## URL Popolari di Pagine di Stato

Di seguito un elenco curato di URL di pagine di stato di servizi popolari che è possibile monitorare:

| Servizio                     | URL Pagina di Stato                           |
| ---------------------------- | --------------------------------------------- |
| AWS                          | `https://health.aws.amazon.com/health/status` |
| Google Cloud Platform        | `https://status.cloud.google.com`             |
| Microsoft Azure              | `https://status.azure.com`                    |
| GitHub                       | `https://www.githubstatus.com`                |
| Cloudflare                   | `https://www.cloudflarestatus.com`            |
| Datadog                      | `https://status.datadoghq.com`                |
| PagerDuty                    | `https://status.pagerduty.com`                |
| Twilio                       | `https://status.twilio.com`                   |
| Stripe                       | `https://status.stripe.com`                   |
| Slack                        | `https://status.slack.com`                    |
| Atlassian (Jira, Confluence) | `https://status.atlassian.com`                |
| Vercel                       | `https://www.vercel-status.com`               |
| Netlify                      | `https://www.netlifystatus.com`               |
| DigitalOcean                 | `https://status.digitalocean.com`             |
| Heroku                       | `https://status.heroku.com`                   |
| MongoDB Atlas                | `https://status.cloud.mongodb.com`            |
| Fastly                       | `https://status.fastly.com`                   |
| New Relic                    | `https://status.newrelic.com`                 |
| Sentry                       | `https://status.sentry.io`                    |
| CircleCI                     | `https://status.circleci.com`                 |

> **Nota:** Molti di questi usano Atlassian Statuspage, quindi il tipo di provider **Auto** li rileverà automaticamente.

## Modelli per Incidenti e Avvisi

Quando si creano incidenti o avvisi dai monitor per pagine di stato esterne, è possibile usare le seguenti variabili template:

| Variabile                 | Descrizione                                    |
| ------------------------- | ---------------------------------------------- |
| `{{isOnline}}`            | Se la pagina di stato è online (true/false)    |
| `{{responseTimeInMs}}`    | Tempo di risposta in millisecondi              |
| `{{failureCause}}`        | Causa del fallimento, se presente              |
| `{{overallStatus}}`       | Il valore dell'indicatore di stato complessivo |
| `{{activeIncidentCount}}` | Numero di incidenti attivi                     |
| `{{componentStatuses}}`   | Array JSON degli stati dei componenti          |

## Buone Pratiche

- **Usare il tipo di provider Auto** a meno che non si conosca il formato esatto — il rilevamento automatico funziona bene per la maggior parte delle pagine di stato
- **Monitorare componenti specifici** se si dipende solo da determinati servizi (ad es. una specifica regione AWS)
- **Impostare la correlazione degli incidenti** — quando i propri monitor rilevano problemi e la pagina di stato upstream mostra anch'essa problemi, questo aiuta a identificare le cause radice più velocemente
- **Combinare con altri monitor** — affiancare monitor per pagine di stato esterne ai propri monitor API/Sito Web per una visibilità completa
