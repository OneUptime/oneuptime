import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Ceph setup guide in Italian (#8341): each piece of the English
 * guide's markdown (Pages/Ceph/Utils/DocumentationMarkdown.ts) and its
 * Italian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Italian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach your Ceph mgr daemons on port 9283":
    "Docker Engine 20.10 o successivo con il plugin Docker Compose v2, su una macchina che raggiunga i daemon mgr di Ceph sulla porta 9283",
  "A shell on a Ceph admin node, where the `ceph` CLI works with admin rights":
    "Una shell su un nodo di amministrazione Ceph, dove la CLI `ceph` funzioni con i diritti di amministratore",
  "Then list your mgr daemons — the agent needs **all** of them, active and standbys:":
    "Poi elenca i tuoi daemon mgr: l'agente li vuole **tutti**, l'attivo e gli standby:",
  "Only the **active** mgr returns metrics — standbys answer with an empty response — so scraping every mgr keeps metrics flowing when the active one fails over.":
    "Solo il mgr **attivo** restituisce metriche (gli standby rispondono con una risposta vuota), quindi interrogare ogni mgr mantiene il flusso di metriche quando l'attivo passa a un altro.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Lo script chiede l'URL di OneUptime e la chiave di acquisizione, entrambi mostrati nel passaggio 1 (scegli lì una chiave perché vengano compilati qui), e poi:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **Nome del cluster**: come il cluster appare in OneUptime. Dai a ogni cluster il suo e mantienilo stabile: un nome nuovo registra un cluster nuovo.",
  "- **Mgr endpoints** — every mgr from the previous step as comma-separated `host:port`, e.g. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. The script adds the square brackets.":
    "- **Endpoint mgr**: ogni mgr del passaggio precedente come `host:port` separati da virgole, ad es. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. Lo script aggiunge le parentesi quadre.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only. Where `ceph` works with admin rights, the script also offers to create the AI agent's own Ceph client.":
    "- **Agente IA di OneUptime**: se può applicare correzioni; rispondi **N** per tenerlo in sola lettura. Dove `ceph` funziona con i diritti di amministratore, lo script offre anche di creare il client Ceph proprio dell'agente IA.",
  "It installs to `/opt/oneuptime-ceph-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Si installa in `/opt/oneuptime-ceph-agent`, scrive un file `.env` con `0600` e avvia l'agente con Docker Compose. Eseguire di nuovo lo script riusa tutto ciò che c'è in quel `.env` invece di chiedere di nuovo, ed è anche il modo di aggiornare.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The cluster then appears automatically in the **Ceph** section, usually within a minute or so.":
    "Cerca `Everything is ready. Begin running and processing data.` nei log. Poi il cluster appare automaticamente nella sezione **Ceph**, di solito entro un minuto circa.",
  "Docker Compose also runs **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. If the install script created its Ceph client it is already working; otherwise it waits for one — see **OneUptime AI agent** under Advanced.":
    "Docker Compose esegue anche **`oneuptime-ceph-ai-agent`**, l'agente IA di OneUptime. Se lo script di installazione ha creato il suo client Ceph, funziona già; altrimenti ne attende uno; vedi **Agente IA di OneUptime** in Avanzato.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: once it has its Ceph client, it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `ceph` commands, and changes nothing unless you allow fixes.":
    "**Agente IA di OneUptime (attivo per impostazione predefinita, in sola lettura).** Le indagini IA sono attive: quando ha il suo client Ceph, permette a OneUptime AI di indagare su incidenti e avvisi di questo cluster con comandi `ceph` in sola lettura, e non cambia nulla finché non consenti le correzioni.",
  "The install script writes these to `/opt/oneuptime-ceph-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent`.":
    "Lo script di installazione le scrive in `/opt/oneuptime-ceph-agent/.env`. Dopo averne cambiata una, applicala con `docker compose up -d` in `/opt/oneuptime-ceph-agent`.",
  "| Variable | Required | Description |":
    "| Variabile | Obbligatoria | Descrizione |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Sì | L'URL della tua istanza OneUptime (ad es. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Sì | La chiave di acquisizione della telemetria, quella scelta nel passaggio 1 |",
  "| `CEPH_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `ceph.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `ceph`) |":
    "| `CEPH_CLUSTER_NAME` | Sì | L'identificatore del cluster mostrato in OneUptime. Apposto su ogni metrica come attributo di risorsa `ceph.cluster.name`. Mantienilo stabile: cambiarlo registra un cluster nuovo (predefinito: `ceph`) |",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]`. The install script adds the brackets for you |":
    "| `CEPH_MGR_ENDPOINTS` | Sì | Elenco `host:port` separato da virgole di **tutti** i daemon mgr, tra parentesi quadre, ad es. `[ceph-mon-1:9283,ceph-mon-2:9283]`. Lo script di installazione aggiunge le parentesi per te |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "Le impostazioni proprie dell'agente IA di OneUptime sono in **Agente IA di OneUptime**.",
  "- **All mgrs are scraped** (active and standbys), so metrics survive an active-mgr failover.":
    "- **Vengono interrogati tutti i mgr** (l'attivo e gli standby), così le metriche sopravvivono a un failover del mgr attivo.",
  "- **Every 30 seconds.** The mgr prometheus module caches a scrape for `mgr/prometheus/scrape_interval` (15 seconds by default) — never scrape more often than that, you would only re-read the cache.":
    "- **Ogni 30 secondi.** Il modulo prometheus del mgr tiene in cache una raccolta per `mgr/prometheus/scrape_interval` (15 secondi per impostazione predefinita): non interrogare mai più spesso, rileggeresti solo la cache.",
  "- **`honor_labels: true`** keeps the labels Ceph exports (`ceph_daemon`, `pool_id`) as they are, so series stay continuous across mgr failovers.":
    "- **`honor_labels: true`** mantiene invariate le etichette che Ceph esporta (`ceph_daemon`, `pool_id`), così le serie restano continue attraverso i failover dei mgr.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "Questo è l'`otel-collector-config.yaml` completo che l'agente esegue; il file `.env` fornisce i valori `${env:...}`:",
  "The agent can tail `/var/log/ceph/ceph.log` and ship it to OneUptime, which fills the **Cluster Log** page. It is off by default because the agent must run on a host that has the cluster log — a mon host by default.":
    "L'agente può seguire `/var/log/ceph/ceph.log` e inviarlo a OneUptime, che riempie la pagina **Log del cluster**. È disattivato per impostazione predefinita perché l'agente deve girare su un host che ha il log del cluster, per impostazione predefinita un host mon.",
  "1. In `otel-collector-config.yaml`, uncomment the `filelog` receiver and the `logs` pipeline.":
    "1. In `otel-collector-config.yaml`, togli il commento al receiver `filelog` e alla pipeline `logs`.",
  "2. In `docker-compose.yml`, uncomment the `/var/log/ceph:/var/log/ceph:ro` volume.":
    "2. In `docker-compose.yml`, togli il commento al volume `/var/log/ceph:/var/log/ceph:ro`.",
  "3. Apply both:": "3. Applica entrambi:",
  "Lines ship verbatim; OneUptime parses the ceph.log format (timestamp, daemon, INF/WRN/ERR level, message) when it reads them, and the `resource` processor stamps `ceph.cluster.name` so the log lands on this cluster.":
    "Le righe vengono inviate così come sono; OneUptime analizza il formato di ceph.log (timestamp, daemon, livello INF/WRN/ERR, messaggio) quando le legge, e il processor `resource` appone `ceph.cluster.name` perché il log finisca su questo cluster.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `ceph.cluster.name`:":
    "Ogni attributo di risorsa con prefisso `oneuptime.label.` diventa un'etichetta di progetto sul cluster: `oneuptime.label.<dimension>=<value>` è l'etichetta `<dimension>:<value>`. Aggiungili al processor `resource` in `otel-collector-config.yaml`, accanto a `ceph.cluster.name`:",
  "Then restart the collector so it reads the new config:":
    "Poi riavvia il collector perché legga la nuova configurazione:",
  "The cluster shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Il cluster compare con le etichette `team:storage` e `env:production`. Le etichette si confrontano senza distinguere maiuscole e minuscole, quindi un'etichetta `Production` esistente viene riusata; l'agente non rimuove mai le etichette aggiunte nell'interfaccia di OneUptime.",
  "The agent ships everything the mgr prometheus module exports. OneUptime's Ceph pages, metric catalog and alert templates are built on:":
    "L'agente invia tutto ciò che esporta il modulo prometheus del mgr. Le pagine Ceph, il catalogo delle metriche e i modelli di avviso di OneUptime si basano su:",
  "| Category | Data |": "| Categoria | Dati |",
  "| **Cluster Health** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), monitor quorum, total and used raw capacity |":
    "| **Salute del cluster** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), quorum dei monitor, capacità grezza totale e usata |",
  "| **OSD** | Up / in state for every OSD (per `ceph_daemon` label, e.g. `osd.3`) |":
    "| **OSD** | Stato up / in di ogni OSD (per etichetta `ceph_daemon`, ad es. `osd.3`) |",
  "| **Pool** | Stored bytes, max available, object counts, read/write operations and throughput per pool |":
    "| **Pool** | Byte memorizzati, massimo disponibile, numero di oggetti, operazioni e throughput di lettura/scrittura per pool |",
  "| **Placement Groups** | Active, degraded, and undersized PG counts |":
    "| **Placement Groups** | Numero di PG attivi, degradati e sottodimensionati |",
  "`docker-compose.yml` also runs **`oneuptime-ceph-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs `ceph` commands through it — `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. It registers as the cluster named `CEPH_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` esegue anche **`oneuptime-ceph-ai-agent`**. Mentre OneUptime AI indaga su un incidente o un avviso di questo cluster, esegue tramite esso comandi `ceph`: `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. Si registra come il cluster chiamato `CEPH_CLUSTER_NAME` e appare nella pagina **IA → Agente IA** del cluster.",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. The install script offers to create them on a fresh install, when `ceph` works with admin rights on the machine you run it on. Otherwise, or to add them later, on a Ceph admin node:":
    "Si connette come proprio client Ceph, `client.oneuptime-ai`, con il `ceph.conf` minimo del cluster e il keyring di quel client in una cartella `ceph/` accanto a `docker-compose.yml`. Lo script di installazione offre di crearli in una nuova installazione, quando `ceph` funziona con i diritti di amministratore sulla macchina in cui lo esegui. Altrimenti, o per aggiungerli in seguito, su un nodo di amministrazione Ceph:",
  "If the agent runs on another machine, copy the two files into its `ceph/` folder the same way. **Never put the admin keyring there.**":
    "Se l'agente gira su un'altra macchina, copia i due file nella sua cartella `ceph/` allo stesso modo. **Non mettere mai lì il keyring di amministrazione.**",
  "- **The client's caps are the hard limit.** With these read caps nothing it runs can change the cluster. Fixes — marking an OSD back in, clearing `noout` — also need `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` and the fixes caps from the agent's README.":
    '- **Le caps del client sono il limite rigido.** Con queste caps di lettura nulla di ciò che esegue può cambiare il cluster. Le correzioni (rimettere un OSD in "in", togliere `noout`) richiedono anche `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` e le caps per le correzioni del README dell\'agente.',
  "- Check it: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- Verificalo: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-ceph-ai-agent` service from `docker-compose.yml`.":
    "- Non usi OneUptime AI? Elimina il servizio `oneuptime-ceph-ai-agent` da `docker-compose.yml`.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#ceph-clusters).":
    "Cosa può eseguire e come funzionano le correzioni: [Agenti IA per l'infrastruttura](/docs/ai/infrastructure-ai-agents#ceph-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them. The AI agent's `ceph/` folder stays as it is:":
    "**Aggiornamento**: l'immagine del collector è fissata in `docker-compose.yml` e la sua configurazione è un file accanto, quindi scaricare l'immagine non basta a far avanzare l'agente. Esegui di nuovo lo script di installazione. Riusa ogni valore del tuo `.env` esistente (non viene chiesto nulla di nuovo), scarica gli ultimi `docker-compose.yml` e `otel-collector-config.yaml` (un file che hai modificato viene tenuto accanto al nuovo come `<file>.bak.<timestamp>`), scarica le immagini e ricrea l'agente con esse. La cartella `ceph/` dell'agente IA resta com'è:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "La configurazione riporta la versione del collector che fissa come **Versione dell'agente** del cluster. Quando questo OneUptime ne fissa una più recente, un segnale di avviso accanto apre questi comandi.",
  "**Uninstall** the agent:": "**Disinstalla** l'agente:",
  "If you created the AI agent's Ceph client, remove it on an admin node: `ceph auth del client.oneuptime-ai`.":
    "Se hai creato il client Ceph dell'agente IA, rimuovilo su un nodo di amministrazione: `ceph auth del client.oneuptime-ai`.",
  "`troubleshoot.sh` checks the whole chain — container runtime, every mgr endpoint (including the active-vs-standby trap), cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` controlla tutta la catena (runtime dei container, ogni endpoint mgr compresa la trappola attivo contro standby, l'apposizione del nome del cluster, la forma del token, le metriche proprie del collector) e chiede direttamente a OneUptime se accetta la tua chiave di acquisizione. Quest'ultimo controllo è il più importante: gli endpoint OTLP di OneUptime rifiutano una chiave errata con `401` o `422`, che il collector registra come una sola riga `Exporting failed` per batch, facile da non notare, quindi lo script interroga `GET /otlp/v1/validate` per un verdetto diretto 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Termina con un verdetto che nomina la causa più probabile.",
  "1. Check the collector logs: `docker logs oneuptime-ceph-agent` — look for export errors (`401` means a bad ingestion key, connection refused means a wrong `ONEUPTIME_URL`).":
    "1. Controlla i log del collector: `docker logs oneuptime-ceph-agent`; cerca errori di esportazione (`401` significa una chiave di acquisizione errata, connection refused significa un `ONEUPTIME_URL` errato).",
  "2. Verify a mgr endpoint serves metrics: `curl http://<active-mgr>:9283/metrics | head` — you should see `ceph_*` metric lines. If not, enable the module: `ceph mgr module enable prometheus`.":
    "2. Verifica che un endpoint mgr fornisca metriche: `curl http://<active-mgr>:9283/metrics | head`; dovresti vedere righe di metriche `ceph_*`. Altrimenti, abilita il modulo: `ceph mgr module enable prometheus`.",
  "3. Make sure `CEPH_MGR_ENDPOINTS` is wrapped in square brackets — without them the collector treats the whole comma-separated string as a single (invalid) target.":
    "3. Assicurati che `CEPH_MGR_ENDPOINTS` sia tra parentesi quadre: senza di esse il collector tratta l'intera stringa separata da virgole come un unico obiettivo (non valido).",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-ceph-agent`":
    "1. Verifica che l'agente sia in esecuzione: `docker ps --filter name=oneuptime-ceph-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`":
    "2. Cerca errori nei log dell'agente: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Verifica che l'URL di OneUptime e la chiave di acquisizione siano corretti.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Assicurati che la macchina dell'agente possa raggiungere l'istanza OneUptime in rete.",
  "You are probably scraping only the (previously) active mgr. List **every** mgr daemon in `CEPH_MGR_ENDPOINTS` — scrapes of standby mgrs are cheap and return empty responses.":
    "Probabilmente interroghi solo il mgr (prima) attivo. Elenca **ogni** daemon mgr in `CEPH_MGR_ENDPOINTS`: le interrogazioni dei mgr standby costano poco e restituiscono risposte vuote.",
  "Expected if `mgr/prometheus/standby_behaviour` is set to `error` on your cluster — standbys then answer with HTTP 500. The active mgr's scrape still succeeds, so the errors are noise; switch the behaviour back to `default` to silence them.":
    "È previsto se `mgr/prometheus/standby_behaviour` è impostato su `error` nel tuo cluster: allora gli standby rispondono con HTTP 500. La raccolta del mgr attivo riesce comunque, quindi gli errori sono rumore; riporta il comportamento a `default` per silenziarli.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "L'identità del cluster viene da `CEPH_CLUSTER_NAME`, apposto su ogni metrica come `ceph.cluster.name`. Correggilo in `.env` e applicalo con `docker compose up -d` in `/opt/oneuptime-ceph-agent`; tieni presente che un nome nuovo registra un cluster nuovo.",
  "- **Cluster name** — enter **`ceph-1`** exactly; a different name registers a new cluster.":
    "- **Nome del cluster**: inserisci esattamente **`ceph-1`**; un nome diverso registra un cluster nuovo.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "L'identità del cluster viene da `CEPH_CLUSTER_NAME`, apposto su ogni metrica come `ceph.cluster.name`. Questo cluster è **`ceph-1`**. Correggilo in `.env` e applicalo con `docker compose up -d` in `/opt/oneuptime-ceph-agent`; tieni presente che un nome nuovo registra un cluster nuovo.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "Il comando contiene già l'URL di OneUptime e la chiave di acquisizione. Il resto lo chiede lo script:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Scarica `docker-compose.yml` e `otel-collector-config.yaml` da questo OneUptime in una nuova cartella:",
  "Create a `.env` file next to them:": "Crea un file `.env` accanto a essi:",
  "- Replace `my-ceph-cluster` with a name for this cluster, such as `ceph-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- Sostituisci `my-ceph-cluster` con un nome per questo cluster, ad esempio `ceph-prod`. È il nome con cui il cluster appare in OneUptime, quindi mantienilo stabile: un nome nuovo registra un cluster nuovo.",
  "- List **every** mgr daemon in `CEPH_MGR_ENDPOINTS`, comma-separated and wrapped in square brackets — without the brackets the collector reads the whole list as one invalid target.":
    "- Elenca **ogni** daemon mgr in `CEPH_MGR_ENDPOINTS`, separati da virgole e tra parentesi quadre: senza le parentesi il collector legge l'intero elenco come un unico obiettivo non valido.",
  "Start the agent:": "Avvia l'agente:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Scegli una chiave di acquisizione nel passaggio 1 per compilare `<YOUR_API_KEY>`.",
  "Docker Compose also starts **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. It waits for a Ceph client of its own — see **OneUptime AI agent** under Advanced, or delete its service from `docker-compose.yml` if you do not use OneUptime AI.":
    "Docker Compose avvia anche **`oneuptime-ceph-ai-agent`**, l'agente IA di OneUptime. Attende un client Ceph tutto suo; vedi **Agente IA di OneUptime** in Avanzato, oppure elimina il suo servizio da `docker-compose.yml` se non usi OneUptime AI.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "L'agente le legge dal file `.env` accanto a `docker-compose.yml`. Dopo averne cambiata una, applicala con `docker compose up -d` nella cartella con `docker-compose.yml`.",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]` |":
    "| `CEPH_MGR_ENDPOINTS` | Sì | Elenco `host:port` separato da virgole di **tutti** i daemon mgr, tra parentesi quadre, ad es. `[ceph-mon-1:9283,ceph-mon-2:9283]` |",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. On a Ceph admin node, in the agent's folder:":
    "Si connette come proprio client Ceph, `client.oneuptime-ai`, con il `ceph.conf` minimo del cluster e il keyring di quel client in una cartella `ceph/` accanto a `docker-compose.yml`. Su un nodo di amministrazione Ceph, nella cartella dell'agente:",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Eseguili nella cartella dell'agente, quella con `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**Aggiornamento**: l'immagine del collector è fissata in `docker-compose.yml` e la sua configurazione è un file accanto, quindi scaricare l'immagine non basta a far avanzare l'agente. Scarica di nuovo entrambi i file; il tuo `.env` resta, e una modifica che avevi fatto a uno dei file va rifatta:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Poi scarica le immagini e ricrea l'agente, perché il collector legga la sua nuova configurazione:",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "L'identità del cluster viene da `CEPH_CLUSTER_NAME`, apposto su ogni metrica come `ceph.cluster.name`. Correggilo in `.env` e applicalo con `docker compose up -d` nella cartella con `docker-compose.yml`; tieni presente che un nome nuovo registra un cluster nuovo.",
  "- This installs the agent for **`ceph-1`** — keep `CEPH_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- Questo installa l'agente per **`ceph-1`**: lascia `CEPH_CLUSTER_NAME` esattamente com'è, altrimenti i dati vengono registrati come un cluster nuovo.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "L'identità del cluster viene da `CEPH_CLUSTER_NAME`, apposto su ogni metrica come `ceph.cluster.name`. Questo cluster è **`ceph-1`**. Correggilo in `.env` e applicalo con `docker compose up -d` nella cartella con `docker-compose.yml`; tieni presente che un nome nuovo registra un cluster nuovo.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `CEPH_AGENT_CONTAINER_NAME` | No | Il nome del container del collector (predefinito: `oneuptime-ceph-agent`). L'agente di un secondo cluster sulla stessa macchina ha bisogno di nomi propri: lo script di installazione dà ai container di un nuovo agente il nome della sua cartella, a meno che tu non li imposti, e li mantiene quando esegui di nuovo lo script |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-ceph-ai-agent-cluster2` beside `oneuptime-ceph-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | Il nome del container dell'agente IA (predefinito: `oneuptime-ceph-ai-agent`). Lo script di installazione dà all'agente IA di un secondo cluster un nome ricavato da quello del suo collector (`oneuptime-ceph-ai-agent-cluster2` accanto a `oneuptime-ceph-agent-cluster2`), a meno che tu non lo imposti, e lo mantiene quando esegui di nuovo lo script |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "Un agente legge un cluster. Per un secondo cluster, installa un secondo agente in una cartella sua, con nomi di container suoi, perché due container non possono condividere un nome:",
  "The script names the containers after the folder, such as `oneuptime-ceph-agent-cluster2`, unless you set their variables, such as `CEPH_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "Lo script dà ai container nomi ricavati dalla cartella, come `oneuptime-ceph-agent-cluster2`, a meno che tu non imposti le loro variabili, come `CEPH_AGENT_CONTAINER_NAME`. Salva i nomi nel `.env` di quell'agente, quindi i nomi restano quando esegui di nuovo lo script con lo stesso `INSTALL_DIR` per aggiornare l'agente, e un agente di cui hai modificato una volta il `container_name` in `docker-compose.yml` mantiene quel nome.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "Dai a ogni cartella un nome proprio: Docker Compose dà a un progetto il nome della sua sola cartella, quindi lo script rifiuta una cartella che si chiama come un'altra in cui gira già un agente altrove. Passa la cartella allo script di diagnostica con `-d`.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AGENT_CONTAINER_NAME` | No | Il nome del container del collector (predefinito: `oneuptime-ceph-agent`). L'agente di un secondo cluster sulla stessa macchina ne ha bisogno di uno proprio |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | Il nome del container dell'agente IA (predefinito: `oneuptime-ceph-ai-agent`). L'agente di un secondo cluster sulla stessa macchina ne ha bisogno di uno proprio |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "Un agente legge un cluster. Per un secondo cluster, configura un secondo agente in una cartella sua, con nomi di container suoi, perché due container non possono condividere un nome. Impostali nel `.env` di quell'agente:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "Dai a ogni cartella un nome proprio: Docker Compose dà a un progetto il nome della sua sola cartella, quindi una seconda cartella con lo stesso nome sostituirebbe i container del primo agente. Tieni i nomi fuori da `docker-compose.yml`, che un aggiornamento sostituisce.",
};

export default TRANSLATION;
