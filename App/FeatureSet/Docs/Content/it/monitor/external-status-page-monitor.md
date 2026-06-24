# Monitor Pagina di Stato Esterna

Il monitoraggio delle pagine di stato esterne consente di monitorare le pagine di stato di terze parti e ricevere avvisi quando i servizi da cui si dipende subiscono interruzioni o degradazioni delle prestazioni. OneUptime controlla periodicamente le pagine di stato esterne (come AWS, GCP, Azure, GitHub, OpenAI, Anthropic e altre) e ne valuta lo stato.

## Panoramica

I monitor per le pagine di stato esterne verificano la salute dei servizi su cui si fa affidamento interrogando le relative pagine di stato pubbliche. Questo consente di:

- Monitorare la disponibilità dei servizi di terze parti da cui dipende la propria applicazione
- Ricevere avvisi quando i provider upstream subiscono interruzioni
- Tracciare lo stato dei singoli componenti (ad es. "AWS EC2 us-east-1")
- Limitare il monitoraggio a un singolo gruppo di componenti (ad es. solo le "APIs" di OpenAI), in modo che incidenti non correlati altrove nella pagina non facciano scattare il monitor
- Rilevare degradazioni delle prestazioni prima che impattino gli utenti
- Correlare i propri incidenti con i problemi dei provider upstream

## Provider Supportati

OneUptime supporta il monitoraggio delle pagine di stato tramite i seguenti metodi:

| Tipo di Provider         | Descrizione                                                       |
| ------------------------ | ----------------------------------------------------------------- |
| **Auto** (predefinito)   | Rileva automaticamente il formato della pagina di stato           |
| **Atlassian Statuspage** | Pagine di stato basate su Atlassian Statuspage (API JSON)         |
| **incident.io**          | Pagine di stato basate su incident.io (ad es. `https://status.openai.com`) |
| **RSS**                  | Pagine di stato che forniscono un feed RSS                        |
| **Atom**                 | Pagine di stato che forniscono un feed Atom                       |

### Rilevamento Automatico

Quando è impostato su **Auto**, OneUptime tenta di rilevare automaticamente il formato della pagina di stato, in questo ordine:

1. Successivamente prova l'API delle pagine di stato di incident.io (`/proxy/<host>`)
2. Prima tenta l'API JSON di Atlassian Statuspage (`/api/v2/status.json`, `/api/v2/components.json` e `/api/v2/incidents/unresolved.json`)
3. Se questi falliscono, prova ad analizzare la pagina come feed RSS o Atom
4. Come ultima opzione, esegue un controllo di raggiungibilità HTTP di base

> **Nota:** incident.io viene controllato per primo perché alcune pagine di stato basate su incident.io (come `https://status.openai.com`) espongono anche un endpoint limitato compatibile con Atlassian che omette i gruppi di componenti e gli incidenti attivi. Controllare prima incident.io garantisce l'utilizzo dei dati più ricchi e consapevoli dei gruppi.

## Creazione di un Monitor per Pagina di Stato Esterna

1. Accedere a **Monitor** nel Dashboard di OneUptime
2. Fare clic su **Crea Monitor**
3. Selezionare **Pagina di Stato Esterna** come tipo di monitor
4. Inserire l'URL della pagina di stato da monitorare
5. Selezionare opzionalmente un tipo di provider specifico (o lasciare su **Auto**)
6. Inserire opzionalmente un **gruppo di componenti** per limitare il monitoraggio a un gruppo come "APIs"
7. Inserire opzionalmente il nome di un **componente** per filtrare su un singolo componente (all'interno del gruppo, se è impostato un gruppo)
8. Configurare i criteri di monitoraggio secondo necessità

## Opzioni di Configurazione

### URL della Pagina di Stato

Inserire l'URL della pagina di stato esterna da monitorare. Per i siti basati su Atlassian Statuspage e incident.io, si tratta generalmente dell'URL radice (ad es. `https://status.example.com`). Per feed RSS/Atom, inserire direttamente l'URL del feed.

### Tipo di Provider

Selezionare il tipo di provider per la pagina di stato. Usare **Auto** (predefinito) per permettere a OneUptime di rilevare automaticamente il formato, oppure specificare **Atlassian Statuspage**, **incident.io**, **RSS** o **Atom** se lo si conosce.

### Filtro per Gruppo di Componenti

Se la pagina di stato organizza i propri componenti in gruppi, è possibile limitare il monitor a un singolo gruppo. Ad esempio, su `https://status.openai.com`, inserendo `APIs` si limita il monitor ai servizi API di OpenAI.

Quando è impostato un gruppo di componenti, il **numero di incidenti attivi** e lo **stato complessivo** vengono calcolati utilizzando solo i componenti di quel gruppo — un incidente che riguarda un gruppo non correlato (ad esempio, ChatGPT) non farà scattare un monitor limitato al gruppo "APIs".

Il filtro per gruppo di componenti è supportato per i provider **Atlassian Statuspage** e **incident.io**. (I feed RSS/Atom non espongono gruppi di componenti.)

### Filtro per Nome Componente

Se la pagina di stato riporta più componenti, è possibile specificare opzionalmente il nome di un componente da monitorare solo quel componente specifico. Ad esempio, per monitorare solo AWS EC2 in us-east-1, si inserirà `EC2 us-east-1` (il nome esatto del componente come mostrato nella pagina di stato).

Quando è impostato anche un gruppo di componenti, il filtro per nome componente viene applicato **all'interno** di quel gruppo, permettendo di puntare a un singolo componente all'interno di un gruppo più ampio. Quando non è specificato alcun filtro, vengono monitorati tutti i componenti in ambito.

### Opzioni Avanzate

#### Timeout

Il tempo massimo (in millisecondi) di attesa per una risposta dalla pagina di stato. Il valore predefinito è 10000 ms (10 secondi).

#### Tentativi

Il numero di volte in cui ripetere la richiesta in caso di errore. Il valore predefinito è 3 tentativi.

## Criteri di Monitoraggio

È possibile configurare criteri per determinare quando il servizio esterno è considerato online o offline in base a:

- **È Online** – Se la pagina di stato è raggiungibile e restituisce dati sullo stato
- **Stato Complessivo** – L'indicatore di stato generale della pagina (ad es. `operational`, `degraded_performance`, `partial_outage`, `major_outage`)
- **Stato del Componente** – Lo stato dei componenti in ambito (rispettando i filtri per gruppo di componenti / nome componente)
- **Incidenti Attivi** – Il numero di incidenti attualmente attivi segnalati nella pagina di stato (limitati al gruppo di componenti / componente quando è impostato un filtro)
- **Tempo di Risposta** – Il tempo necessario per ottenere i dati dalla pagina di stato

### Criteri Predefiniti

Per impostazione predefinita, OneUptime imposta i criteri in base a ciò che conta realmente per una pagina di stato — i suoi incidenti attivi e la salute dei componenti, anziché la semplice raggiungibilità:

- Il monitor viene contrassegnato come **Operativo** quando non ci sono incidenti attivi in ambito.
- Il monitor viene contrassegnato come **Offline** (e viene creato un incidente) quando c'è almeno un incidente attivo in ambito, oppure quando un componente in ambito riporta `degraded_performance`, `partial_outage`, `major_outage` o `full_outage`.

Poiché il numero di incidenti attivi e gli stati dei componenti rispettano i filtri per gruppo di componenti / nome componente, questi criteri predefiniti puntano automaticamente solo ai componenti di interesse.

## URL Popolari di Pagine di Stato

Di seguito un elenco curato di URL di pagine di stato di servizi popolari che è possibile monitorare:

| Servizio                     | URL Pagina di Stato                           |
| ---------------------------- | --------------------------------------------- |
| AWS                          | `https://health.aws.amazon.com/health/status` |
| Google Cloud Platform        | `https://status.cloud.google.com`             |
| Microsoft Azure              | `https://status.azure.com`                    |
| GitHub                       | `https://www.githubstatus.com`                |
| OpenAI                       | `https://status.openai.com`                   |
| Anthropic                    | `https://status.anthropic.com`                |
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

> **Nota:** Molti di questi usano Atlassian Statuspage o incident.io, quindi il tipo di provider **Auto** li rileverà automaticamente.

## Modelli per Incidenti e Avvisi

Quando si creano incidenti o avvisi dai monitor per pagine di stato esterne, è possibile usare le seguenti variabili template:

| Variabile                 | Descrizione                                                  |
| ------------------------- | ------------------------------------------------------------ |
| `{{isOnline}}`            | Se la pagina di stato è online (true/false)                  |
| `{{responseTimeInMs}}`    | Tempo di risposta in millisecondi                            |
| `{{failureCause}}`        | Causa del fallimento, se presente                            |
| `{{overallStatus}}`       | Il valore dell'indicatore di stato complessivo               |
| `{{activeIncidentCount}}` | Numero di incidenti attivi (limitato al filtro, se presente) |
| `{{componentStatuses}}`   | Array JSON degli stati dei componenti (`name`, `status`, `description`, `groupName`) |
| `{{provider}}`            | Provider rilevato (Atlassian Statuspage, incident.io, RSS, Atom) |
| `{{componentGroup}}`      | Gruppo di componenti a cui è limitato il monitor, se presente |
| `{{componentName}}`       | Componente a cui è limitato il monitor, se presente          |

## Buone Pratiche

- **Usare il tipo di provider Auto** a meno che non si conosca il formato esatto — il rilevamento automatico funziona bene per la maggior parte delle pagine di stato
- **Limitare a un gruppo di componenti** se si dipende solo da una parte di un provider (ad es. solo le "APIs" di OpenAI), in modo che incidenti non correlati non creino rumore
- **Monitorare componenti specifici** se si dipende solo da determinati servizi (ad es. una specifica regione AWS)
- **Impostare la correlazione degli incidenti** — quando i propri monitor rilevano problemi e la pagina di stato upstream mostra anch'essa problemi, questo aiuta a identificare le cause radice più velocemente
- **Combinare con altri monitor** — affiancare monitor per pagine di stato esterne ai propri monitor API/Sito Web per una visibilità completa
