import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The StorageArray setup guide in Italian (#8341): each piece of the English
 * guide's markdown (Pages/StorageArray/Utils/DocumentationMarkdown.ts) and its
 * Italian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Italian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashArray's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 o successivo con il plugin Docker Compose v2, su una macchina che raggiunga l'indirizzo di gestione del FlashArray via HTTPS (TCP 443)",
  "An administrator account on the FlashArray, to create the agent's read-only user":
    "Un account amministratore sul FlashArray, per creare l'utente di sola lettura dell'agente",
  "Create the token **without an expiry**, or the agent stops the day it expires.":
    "Crea il token **senza scadenza**, altrimenti l'agente si ferma il giorno in cui scade.",
  "SSH to the FlashArray as an administrator. The first command asks for the new user's password; the second prints its API token:":
    "Collegati via SSH al FlashArray come amministratore. Il primo comando chiede la password del nuovo utente; il secondo stampa il suo token API:",
  "1. Open **Settings → Users and Policies** (**Settings → Access** on older releases).":
    "1. Apri **Settings → Users and Policies** (**Settings → Access** nelle release meno recenti).",
  "2. From the ⋮ menu of the **Users** panel choose **Create User…**, name it `oneuptime` and give it the **readonly** role.":
    "2. Dal menu ⋮ del pannello **Users** scegli **Create User…**, chiama l'utente `oneuptime` e assegnagli il ruolo **readonly**.",
  "3. From the new user's ⋮ menu choose **Create API Token…**, leave **Expires In** empty, and copy the token.":
    "3. Dal menu ⋮ del nuovo utente scegli **Create API Token…**, lascia vuoto **Expires In** e copia il token.",
  "A `purefa_info{...} 1` line means the array serves its metrics natively: carry on. A **404** means its Purity//FA is older (Pure documents the native endpoint for 6.7.0 and later; its exporter's deprecation notice says 6.6.11 and later) — pick **FlashArray, older Purity** at the top of this guide instead.":
    "Una riga `purefa_info{...} 1` significa che l'array espone le sue metriche in modo nativo: prosegui. Un **404** significa che il suo Purity//FA è meno recente (Pure documenta l'endpoint nativo per la 6.7.0 e successive; l'avviso di deprecazione del suo exporter indica la 6.6.11 e successive): scegli invece **FlashArray, Purity precedente** in cima a questa guida.",
  "The first line downloads the script as `install.sh`, so you can read it before you run it.":
    "La prima riga scarica lo script come `install.sh`, così puoi leggerlo prima di eseguirlo.",
  "The command carries the platform you picked above. The script asks for:":
    "Il comando contiene la piattaforma che hai scelto sopra. Lo script chiede:",
  "- your **OneUptime URL** and **ingestion key**, both shown in step 1 (pick a key there to have them filled in here)":
    "- l'**URL di OneUptime** e la **chiave di acquisizione**, entrambi mostrati nel passaggio 1 (scegli lì una chiave perché vengano compilati qui)",
  "- an **array name** — how the array appears in OneUptime. Give every array its own and keep it stable: a new name registers a new storage array":
    "- un **nome dell'array**: come l'array appare in OneUptime. Dai a ogni array il suo e mantienilo stabile: un nome nuovo registra un nuovo array di storage",
  "- the FlashArray's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- l'**indirizzo di gestione** del FlashArray (nome host o IP, senza `https://`) e il **token API** dell'utente di sola lettura, che legge senza mostrarlo",
  "- whether to verify the array's certificate — answer **N** unless the array carries a certificate from a CA you trust (arrays ship a self-signed one)":
    "- se verificare il certificato dell'array: rispondi **N** a meno che l'array non abbia un certificato di una CA di cui ti fidi (gli array escono di fabbrica con uno autofirmato)",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the API token) and starts the agent with Docker Compose.":
    "Si installa in `/opt/oneuptime-storage-array-agent`, scrive un file `.env` che solo tu puoi leggere (contiene il token API) e avvia l'agente con Docker Compose.",
  "Download the compose file and the collector configs from this OneUptime into a new folder:":
    "Scarica il file compose e le configurazioni del collector da questo OneUptime in una nuova cartella:",
  "Create a `.env` file next to them:": "Crea un file `.env` accanto a essi:",
  "- Replace `my-storage-array` with a name for this array, such as `fa-prod-01`. It is how the array appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- Sostituisci `my-storage-array` con un nome per questo array, ad esempio `fa-prod-01`. È il nome con cui l'array appare in OneUptime, quindi mantienilo stabile: un nome nuovo registra un nuovo array di storage.",
  "- Set `PURE_FA_ENDPOINT` to the FlashArray's management address — host name or IP, no `https://` — and `PURE_FA_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- Imposta `PURE_FA_ENDPOINT` sull'indirizzo di gestione del FlashArray (nome host o IP, senza `https://`) e `PURE_FA_API_TOKEN` sul token API dell'utente di sola lettura. Esegui `chmod 600 .env`: contiene il token.",
  "Start the agent:": "Avvia l'agente:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Scegli una chiave di acquisizione nel passaggio 1 per compilare `<YOUR_API_KEY>`.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The array then appears automatically in the **Storage Arrays** section after its first scrape, usually within a minute or two.":
    "Cerca `Everything is ready. Begin running and processing data.` nei log. Poi l'array appare automaticamente nella sezione **Array di storage** dopo la sua prima raccolta, di solito entro un paio di minuti.",
  "The install script writes these to `/opt/oneuptime-storage-array-agent/.env`; a Docker Compose install reads them from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the agent's folder.":
    "Lo script di installazione le scrive in `/opt/oneuptime-storage-array-agent/.env`; un'installazione con Docker Compose le legge dal file `.env` accanto a `docker-compose.yml`. Dopo averne cambiata una, applicala con `docker compose up -d` nella cartella dell'agente.",
  "| Variable | Required | Description |":
    "| Variabile | Obbligatoria | Descrizione |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Sì | L'URL della tua istanza OneUptime (ad es. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Sì | La chiave di acquisizione della telemetria, quella scelta nel passaggio 1 |",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this array registers under in OneUptime. Stamped on every metric as the `storage.array.name` resource attribute. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | Sì | Il nome con cui questo array si registra in OneUptime. Apposto su ogni metrica come attributo di risorsa `storage.array.name`. Mantienilo stabile: cambiarlo registra un nuovo array di storage |",
  "| `STORAGE_SYSTEM` | No | The platform, stamped as the `storage.system` resource attribute: `purestorage.flasharray` or `purestorage.flashblade` (default: `purestorage.flasharray`) |":
    "| `STORAGE_SYSTEM` | No | La piattaforma, apposta come attributo di risorsa `storage.system`: `purestorage.flasharray` o `purestorage.flashblade` (predefinito: `purestorage.flasharray`) |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | No | Which shipped config runs: `otel-collector-config.yaml` (FlashArray, native — the default), `otel-collector-config.flasharray-exporter.yaml` (older FlashArray) or `otel-collector-config.flashblade.yaml` (FlashBlade) |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | No | Quale configurazione fornita viene eseguita: `otel-collector-config.yaml` (FlashArray, nativa; la predefinita), `otel-collector-config.flasharray-exporter.yaml` (FlashArray meno recente) o `otel-collector-config.flashblade.yaml` (FlashBlade) |",
  "| `COMPOSE_PROFILES` | No | Starts the exporter the config needs: empty for the native FlashArray config, `flasharray-exporter` or `flashblade` for the others |":
    "| `COMPOSE_PROFILES` | No | Avvia l'exporter di cui la configurazione ha bisogno: vuoto per la configurazione FlashArray nativa, `flasharray-exporter` o `flashblade` per le altre |",
  "| `PURE_FA_ENDPOINT` | FlashArray | The FlashArray's management address — host name or IP, no `https://` |":
    "| `PURE_FA_ENDPOINT` | FlashArray | L'indirizzo di gestione del FlashArray: nome host o IP, senza `https://` |",
  "| `PURE_FA_API_TOKEN` | FlashArray | API token of the FlashArray user with the readonly role |":
    "| `PURE_FA_API_TOKEN` | FlashArray | Il token API dell'utente FlashArray con il ruolo readonly |",
  "| `PURE_FB_ENDPOINT` | FlashBlade | The FlashBlade's management address — host name or IP, no `https://` |":
    "| `PURE_FB_ENDPOINT` | FlashBlade | L'indirizzo di gestione del FlashBlade: nome host o IP, senza `https://` |",
  "| `PURE_FB_API_TOKEN` | FlashBlade | API token of the FlashBlade user with the readonly role |":
    "| `PURE_FB_API_TOKEN` | FlashBlade | Il token API dell'utente FlashBlade con il ruolo readonly |",
  "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No | `true` accepts the array's self-signed certificate on the native endpoint; `false` verifies it (default: `true`). Pure's exporters never verify the array's certificate, so it does not apply to them |":
    "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No | `true` accetta il certificato autofirmato dell'array sull'endpoint nativo; `false` lo verifica (predefinito: `true`). Gli exporter di Pure non verificano mai il certificato dell'array, quindi per loro non vale |",
  "- The collector reads the FlashArray's own OpenMetrics endpoint over HTTPS with the token as a Bearer credential — no exporter runs.":
    "- Il collector legge l'endpoint OpenMetrics del FlashArray stesso via HTTPS, con il token come credenziale Bearer: non gira alcun exporter.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/volumes`, `/metrics/hosts` and `/metrics/pods` every 2 minutes; `/metrics/directories` every 30 minutes — directory space is expensive for the array to compute.":
    "- **Un job di raccolta per endpoint**, ognuno letto con la frequenza che merita: `/metrics/array` ogni 60 secondi; `/metrics/volumes`, `/metrics/hosts` e `/metrics/pods` ogni 2 minuti; `/metrics/directories` ogni 30 minuti, perché calcolare lo spazio delle directory è oneroso per l'array.",
  "- **Every job labels its series `scrape_endpoint: <endpoint>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted object leaves the inventory. Keep the labels as shipped.":
    "- **Ogni job etichetta le sue serie con `scrape_endpoint: <endpoint>`**, così OneUptime sa di quali oggetti un batch è l'elenco completo: è così che un oggetto eliminato esce dall'inventario. Lascia le etichette come sono fornite.",
  "- **Per-volume and per-host latency keeps three dimensions** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); a `metric_relabel_configs` rule drops the QoS, queue, SAN and service-time breakdown, which multiplies the series count of a large array. The array-wide breakdown is kept.":
    "- **La latenza per volume e per host mantiene tre dimensioni** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); una regola di `metric_relabel_configs` scarta la ripartizione per QoS, coda, SAN e tempo di servizio, che moltiplica il numero di serie di un array grande. La ripartizione per l'intero array viene mantenuta.",
  "- **No `send_batch_max_size`.** OneUptime rebuilds the inventory from one whole scrape, so the `batch` processor never splits one.":
    "- **Nessun `send_batch_max_size`.** OneUptime ricostruisce l'inventario da un'intera raccolta, quindi il processor `batch` non ne divide mai una.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "Questo è l'`otel-collector-config.yaml` completo che l'agente esegue; il file `.env` fornisce i valori `${env:...}`:",
  "The agent ships metrics only until you turn on its syslog receivers. Arrays forward their alerts and audit events as syslog; the agent stamps `storage.array.name` on every line, so they land on this array's **Logs** page.":
    "L'agente invia solo metriche finché non attivi i suoi receiver syslog. Gli array inoltrano i loro avvisi ed eventi di audit come syslog; l'agente appone `storage.array.name` su ogni riga, così finiscono nella pagina **Log** di questo array.",
  "1. In `otel-collector-config.yaml`, uncomment the `syslog/tcp` and `syslog/udp` receivers and the `logs` pipeline. Classic BSD syslog timestamps carry no time zone: set `location` to the array's time zone unless its clock runs on UTC.":
    "1. In `otel-collector-config.yaml`, togli il commento ai receiver `syslog/tcp` e `syslog/udp` e alla pipeline `logs`. I timestamp syslog BSD classici non hanno fuso orario: imposta `location` sul fuso orario dell'array, a meno che il suo orologio non sia in UTC.",
  "2. In `docker-compose.yml`, uncomment the `ports:` block that publishes `5514/tcp` and `5514/udp`, and open the port on the machine's firewall for the array's management network.":
    "2. In `docker-compose.yml`, togli il commento al blocco `ports:` che pubblica `5514/tcp` e `5514/udp`, e apri la porta nel firewall della macchina per la rete di gestione dell'array.",
  "3. Apply both:": "3. Applica entrambi:",
  "4. On the FlashArray, as an administrator, open **Settings → System → Syslog Servers**, add `udp://<agent-host>:5514` (or `tcp://<agent-host>:5514`) and send a test message.":
    "4. Sul FlashArray, come amministratore, apri **Settings → System → Syslog Servers**, aggiungi `udp://<agent-host>:5514` (o `tcp://<agent-host>:5514`) e invia un messaggio di prova.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the array: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor of the collector config you use, next to `storage.array.name`:":
    "Ogni attributo di risorsa con prefisso `oneuptime.label.` diventa un'etichetta di progetto sull'array: `oneuptime.label.<dimension>=<value>` è l'etichetta `<dimension>:<value>`. Aggiungili al processor `resource` della configurazione del collector che usi, accanto a `storage.array.name`:",
  "Then restart the collector so it reads the new config:":
    "Poi riavvia il collector perché legga la nuova configurazione:",
  "The array shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "L'array compare con le etichette `team:storage` e `env:production`. Le etichette si confrontano senza distinguere maiuscole e minuscole, quindi un'etichetta `Production` esistente viene riusata; l'agente non rimuove mai le etichette aggiunte nell'interfaccia di OneUptime.",
  "Every value is a gauge the FlashArray computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "Ogni valore è un gauge che il FlashArray calcola da sé: latenza per operazione in microsecondi, throughput al secondo. Le pagine Array di storage di OneUptime, il suo catalogo di metriche e i suoi modelli di avviso si basano su:",
  "| Endpoint | Data |": "| Endpoint | Dati |",
  "| **Array** (`/metrics/array`) | `purefa_info`, capacity and data reduction (`purefa_array_space_*`), performance, open alerts (`purefa_alerts_open`), hardware components, drives, controllers and network interfaces |":
    "| **Array** (`/metrics/array`) | `purefa_info`, capacità e riduzione dei dati (`purefa_array_space_*`), prestazioni, avvisi aperti (`purefa_alerts_open`), componenti hardware, unità, controller e interfacce di rete |",
  "| **Volumes** (`/metrics/volumes`) | Latency, IOPS, bandwidth, space and data reduction per volume |":
    "| **Volumi** (`/metrics/volumes`) | Latenza, IOPS, larghezza di banda, spazio e riduzione dei dati per volume |",
  "| **Hosts** (`/metrics/hosts`) | Connectivity, connected volumes, latency, IOPS and space per host |":
    "| **Host** (`/metrics/hosts`) | Connettività, volumi connessi, latenza, IOPS e spazio per host |",
  "| **Pods** (`/metrics/pods`) | ActiveCluster and ActiveDR replica link lag, mediator status, performance and space |":
    "| **Pod** (`/metrics/pods`) | Ritardo del collegamento di replica di ActiveCluster e ActiveDR, stato del mediatore, prestazioni e spazio |",
  "| **Directories** (`/metrics/directories`) | Space and performance of FlashArray file services' managed directories |":
    "| **Directory** (`/metrics/directories`) | Spazio e prestazioni delle directory gestite dei servizi file di FlashArray |",
  "One agent reads one array. To monitor several from the same machine, install each into its own folder with its own `.env`, and give each its own `container_name` in its `docker-compose.yml` (for example `oneuptime-storage-array-agent-fa02`) — two containers cannot share a name:":
    "Un agente legge un array. Per monitorarne diversi dalla stessa macchina, installa ciascuno nella propria cartella con il proprio `.env` e assegna a ciascuno il proprio `container_name` nel suo `docker-compose.yml` (ad esempio `oneuptime-storage-array-agent-fa02`), perché due container non possono condividere un nome:",
  "The agent ships a systemd unit that assumes the install script's folder, `/opt/oneuptime-storage-array-agent`. The install script does not download it, so fetch it:":
    "L'agente include un'unità systemd che presuppone la cartella dello script di installazione, `/opt/oneuptime-storage-array-agent`. Lo script di installazione non la scarica, quindi scaricala tu:",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its configs are files beside it, so pulling alone does not move the agent forward. Re-run the install script. It reuses every value in your existing `.env` (nothing is prompted for again), downloads the latest `docker-compose.yml` and collector configs — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — and recreates the agent with them:":
    "**Aggiornamento**: l'immagine del collector è fissata in `docker-compose.yml` e le sue configurazioni sono file accanto, quindi scaricare l'immagine non basta a far avanzare l'agente. Esegui di nuovo lo script di installazione. Riusa ogni valore del tuo `.env` esistente (non viene chiesto nulla di nuovo), scarica gli ultimi `docker-compose.yml` e configurazioni del collector (un file che hai modificato viene tenuto accanto al nuovo come `<file>.bak.<timestamp>`) e ricrea l'agente con essi:",
  "An agent installed outside `/opt/oneuptime-storage-array-agent` (a second array's, say) needs its folder: `INSTALL_DIR=<folder> bash install.sh`.":
    "Un agente installato fuori da `/opt/oneuptime-storage-array-agent` (quello di un secondo array, per esempio) ha bisogno della sua cartella: `INSTALL_DIR=<folder> bash install.sh`.",
  "Installed it with Docker Compose instead? In the agent's folder, download the compose file and the collector configs again; your `.env` stays, and a change you made to any of them has to be made again:":
    "L'hai installato invece con Docker Compose? Nella cartella dell'agente scarica di nuovo il file compose e le configurazioni del collector; il tuo `.env` resta, e una modifica che hai fatto a uno di essi va rifatta:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Poi scarica le immagini e ricrea l'agente, perché il collector legga la sua nuova configurazione:",
  "The config reports the collector version it pins as the array's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "La configurazione riporta la versione del collector che fissa come **Versione dell'agente** dell'array. Quando questo OneUptime ne fissa una più recente, un segnale di avviso accanto apre questi comandi.",
  "**Uninstall** the agent:": "**Disinstalla** l'agente:",
  "Then delete the read-only user and its API token on the array if you no longer need them.":
    "Poi elimina sull'array l'utente di sola lettura e il suo token API, se non ti servono più.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the array endpoint exactly as the collector reaches it (the native endpoint or Pure's exporter, DNS, TLS, the API token), array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` controlla tutta la catena (runtime dei container, l'endpoint dell'array esattamente come lo raggiunge il collector, cioè l'endpoint nativo o l'exporter di Pure, con DNS, TLS e token API, l'apposizione del nome dell'array, le metriche proprie del collector) e chiede direttamente a OneUptime se accetta la tua chiave di acquisizione. Quest'ultimo controllo è il più importante: gli endpoint OTLP di OneUptime rifiutano una chiave errata con `401` o `422`, che il collector registra come una sola riga `Exporting failed` per batch, facile da non notare, quindi lo script interroga `GET /otlp/v1/validate` per un verdetto diretto 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Termina con un verdetto che nomina la causa più probabile.",
  "1. Check the collector logs: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` means the array refused the API token, `404` means the FlashArray has no native endpoint, `x509` means TLS verification is on against the array's self-signed certificate, `no such host` or `connection refused` means a wrong `PURE_FA_ENDPOINT`, and an export `401` means a bad ingestion key.":
    "1. Controlla i log del collector: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` significa che l'array ha rifiutato il token API, `404` che il FlashArray non ha un endpoint nativo, `x509` che la verifica TLS è attiva contro il certificato autofirmato dell'array, `no such host` o `connection refused` un `PURE_FA_ENDPOINT` errato, e un `401` in esportazione una chiave di acquisizione errata.",
  "2. Make sure `STORAGE_ARRAY_NAME` is set — discovery keys on the `storage.array.name` resource attribute, and the collector refuses to start without it.":
    "2. Assicurati che `STORAGE_ARRAY_NAME` sia impostato: il rilevamento si basa sull'attributo di risorsa `storage.array.name`, e senza di esso il collector si rifiuta di avviarsi.",
  "3. Make sure `STORAGE_ARRAY_COLLECTOR_CONFIG` and `COMPOSE_PROFILES` name the same platform.":
    "3. Assicurati che `STORAGE_ARRAY_COLLECTOR_CONFIG` e `COMPOSE_PROFILES` indichino la stessa piattaforma.",
  "Its Purity//FA has no native OpenMetrics endpoint. Set `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` and `COMPOSE_PROFILES=flasharray-exporter` in `.env` and run `docker compose up -d` — or re-run `install.sh` with the older-Purity choice. After upgrading the array to Purity//FA 6.7 or later, switch back to the native config and drop the profile.":
    "Il suo Purity//FA non ha un endpoint OpenMetrics nativo. Imposta `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` e `COMPOSE_PROFILES=flasharray-exporter` in `.env` ed esegui `docker compose up -d`, oppure esegui di nuovo `install.sh` con la scelta per Purity precedente. Dopo aver aggiornato l'array a Purity//FA 6.7 o successivo, torna alla configurazione nativa e togli il profilo.",
  "Check that you pasted the token, not the user's password; that the user still exists and holds the readonly role; and that the token has not expired. Create a new token (`pureadmin create --api-token oneuptime` on a FlashArray), put it in `.env` as `PURE_FA_API_TOKEN` and run `docker compose up -d`.":
    "Verifica di aver incollato il token e non la password dell'utente, che l'utente esista ancora e abbia il ruolo readonly, e che il token non sia scaduto. Crea un nuovo token (`pureadmin create --api-token oneuptime` su un FlashArray), mettilo in `.env` come `PURE_FA_API_TOKEN` ed esegui `docker compose up -d`.",
  "Arrays present a self-signed certificate by default, which no Docker image trusts. Set `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network), or install a certificate on the array from a CA the collector image trusts.":
    "Gli array presentano per impostazione predefinita un certificato autofirmato, di cui nessuna immagine Docker si fida. Imposta `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (la scelta pragmatica su una rete di gestione privata) oppure installa sull'array un certificato di una CA di cui l'immagine del collector si fida.",
  "`pure-fa-exporter` or `pure-fb-exporter` is not running: `COMPOSE_PROFILES` must match `STORAGE_ARRAY_COLLECTOR_CONFIG` — `flasharray-exporter` for the FlashArray exporter config, `flashblade` for the FlashBlade config. Fix `.env` and run `docker compose up -d`; `docker compose ps` then lists the exporter.":
    "`pure-fa-exporter` o `pure-fb-exporter` non è in esecuzione: `COMPOSE_PROFILES` deve corrispondere a `STORAGE_ARRAY_COLLECTOR_CONFIG`, cioè `flasharray-exporter` per la configurazione dell'exporter FlashArray e `flashblade` per la configurazione FlashBlade. Correggi `.env` ed esegui `docker compose up -d`; poi `docker compose ps` elenca l'exporter.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-storage-array-agent`":
    "1. Verifica che l'agente sia in esecuzione: `docker ps --filter name=oneuptime-storage-array-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`":
    "2. Cerca errori nei log dell'agente: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Verifica che l'URL di OneUptime e la chiave di acquisizione siano corretti.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Assicurati che la macchina dell'agente possa raggiungere l'istanza OneUptime in rete.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "L'identità dell'array viene da `STORAGE_ARRAY_NAME`, apposto su ogni metrica come `storage.array.name`. Correggilo in `.env` e applicalo con `docker compose up -d` nella cartella dell'agente; tieni presente che un nome nuovo registra un nuovo array di storage.",
  "It registers the array as **`array-1`** — the name this array already has in OneUptime.":
    "Registra l'array come **`array-1`**, il nome che questo array ha già in OneUptime.",
  "- This installs the agent for **`array-1`** — keep `STORAGE_ARRAY_NAME` exactly as it is, or the data registers as a new storage array.":
    "- Questo installa l'agente per **`array-1`**: lascia `STORAGE_ARRAY_NAME` esattamente com'è, altrimenti i dati vengono registrati come un nuovo array di storage.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. This array is **`array-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "L'identità dell'array viene da `STORAGE_ARRAY_NAME`, apposto su ogni metrica come `storage.array.name`. Questo array è **`array-1`**. Correggilo in `.env` e applicalo con `docker compose up -d` nella cartella dell'agente; tieni presente che un nome nuovo registra un nuovo array di storage.",
  "The command already carries your OneUptime URL, ingestion key and the platform you picked above. The script asks for:":
    "Il comando contiene già l'URL di OneUptime, la chiave di acquisizione e la piattaforma che hai scelto sopra. Lo script chiede:",
  "Access from that machine to `quay.io`, where Docker pulls Pure's exporter image":
    "Accesso da quella macchina a `quay.io`, da cui Docker scarica l'immagine dell'exporter di Pure",
  "- `COMPOSE_PROFILES=flasharray-exporter` starts `pure-fa-exporter`, Pure's exporter, next to the collector; the two must match.":
    "- `COMPOSE_PROFILES=flasharray-exporter` avvia `pure-fa-exporter`, l'exporter di Pure, accanto al collector; i due devono corrispondere.",
  "`docker compose ps` in the agent's folder also lists **`pure-fa-exporter`**, Pure's exporter, which the collector reads the FlashArray through.":
    "`docker compose ps` nella cartella dell'agente elenca anche **`pure-fa-exporter`**, l'exporter di Pure, tramite cui il collector legge il FlashArray.",
  "- The collector reads the FlashArray through `pure-fa-exporter`, Pure's exporter, which logs in to the FlashArray's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- Il collector legge il FlashArray tramite `pure-fa-exporter`, l'exporter di Pure, che accede all'API REST del FlashArray con il token che il collector invia a ogni raccolta. La porta dell'exporter resta sulla rete di compose.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashBlade's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 o successivo con il plugin Docker Compose v2, su una macchina che raggiunga l'indirizzo di gestione del FlashBlade via HTTPS (TCP 443)",
  "An administrator account on the FlashBlade, to create the agent's read-only user":
    "Un account amministratore sul FlashBlade, per creare l'utente di sola lettura dell'agente",
  "On the FlashBlade, as an administrator, create a user named `oneuptime` with the **readonly** role — in the FlashBlade GUI's user settings, or with `pureadmin` in the Purity//FB CLI — and create an **API token** for it. Create the token **without an expiry**, or the agent stops the day it expires.":
    "Sul FlashBlade, come amministratore, crea un utente chiamato `oneuptime` con il ruolo **readonly** (nelle impostazioni utente della GUI del FlashBlade o con `pureadmin` nella CLI di Purity//FB) e crea un **token API** per lui. Crea il token **senza scadenza**, altrimenti l'agente si ferma il giorno in cui scade.",
  "FlashBlade API tokens start with `T-`. A Purity//FB release without local users takes a directory service (LDAP or Active Directory) account whose group maps to the readonly role instead.":
    "I token API del FlashBlade iniziano con `T-`. Una release di Purity//FB senza utenti locali usa invece un account di un servizio di directory (LDAP o Active Directory) il cui gruppo corrisponde al ruolo readonly.",
  "- the FlashBlade's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- l'**indirizzo di gestione** del FlashBlade (nome host o IP, senza `https://`) e il **token API** dell'utente di sola lettura, che legge senza mostrarlo",
  "- Set `PURE_FB_ENDPOINT` to the FlashBlade's management address — host name or IP, no `https://` — and `PURE_FB_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- Imposta `PURE_FB_ENDPOINT` sull'indirizzo di gestione del FlashBlade (nome host o IP, senza `https://`) e `PURE_FB_API_TOKEN` sul token API dell'utente di sola lettura. Esegui `chmod 600 .env`: contiene il token.",
  "`docker compose ps` in the agent's folder also lists **`pure-fb-exporter`**, Pure's exporter, which the collector reads the FlashBlade through.":
    "`docker compose ps` nella cartella dell'agente elenca anche **`pure-fb-exporter`**, l'exporter di Pure, tramite cui il collector legge il FlashBlade.",
  "- The collector reads the FlashBlade through `pure-fb-exporter`, Pure's exporter, which logs in to the FlashBlade's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- Il collector legge il FlashBlade tramite `pure-fb-exporter`, l'exporter di Pure, che accede all'API REST del FlashBlade con il token che il collector invia a ogni raccolta. La porta dell'exporter resta sulla rete di compose.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/filesystems` and `/metrics/objectstore` every 5 minutes — the FlashBlade REST API is not built to report every file system and bucket quickly.":
    "- **Un job di raccolta per endpoint**, ognuno letto con la frequenza che merita: `/metrics/array` ogni 60 secondi; `/metrics/filesystems` e `/metrics/objectstore` ogni 5 minuti, perché l'API REST del FlashBlade non è fatta per riportare rapidamente ogni file system e ogni bucket.",
  "4. On the FlashBlade, as an administrator, add a syslog server `udp://<agent-host>:5514` (or `tcp://`) in its syslog settings.":
    "4. Sul FlashBlade, come amministratore, aggiungi un server syslog `udp://<agent-host>:5514` (o `tcp://`) nelle sue impostazioni syslog.",
  "Every value is a gauge the FlashBlade computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "Ogni valore è un gauge che il FlashBlade calcola da sé: latenza per operazione in microsecondi, throughput al secondo. Le pagine Array di storage di OneUptime, il suo catalogo di metriche e i suoi modelli di avviso si basano su:",
  "| **Array** (`/metrics/array`) | `purefb_info`, capacity and data reduction (`purefb_array_space_*`), performance per protocol, open alerts (`purefb_alerts_open`), hardware health (`purefb_hardware_health`) |":
    "| **Array** (`/metrics/array`) | `purefb_info`, capacità e riduzione dei dati (`purefb_array_space_*`), prestazioni per protocollo, avvisi aperti (`purefb_alerts_open`), stato dell'hardware (`purefb_hardware_health`) |",
  "| **File systems** (`/metrics/filesystems`) | Space, data reduction and performance per file system |":
    "| **File system** (`/metrics/filesystems`) | Spazio, riduzione dei dati e prestazioni per file system |",
  "| **Object store** (`/metrics/objectstore`) | Space, quota, object counts and performance per bucket |":
    "| **Archivio a oggetti** (`/metrics/objectstore`) | Spazio, quota, numero di oggetti e prestazioni per bucket |",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that reaches every node of the cluster on UDP 161 (SNMP)":
    "Docker Engine 20.10 o successivo con il plugin Docker Compose v2, su una macchina che raggiunga ogni nodo del cluster su UDP 161 (SNMP)",
  "An administrator account on the cluster, to turn on SNMP and set the agent's read-only community or SNMPv3 user":
    "Un account amministratore sul cluster, per attivare SNMP e impostare la community di sola lettura o l'utente SNMPv3 dell'agente",
  "SSH to any node as an administrator: OneFS applies SNMP settings to the whole cluster. If the cluster already answers SNMP for another tool, give the agent the same community or user and skip this step. Otherwise, turn on SNMP v2c with a read-only community of your own, not OneFS's default `I$ilonpublic`:":
    "Collegati via SSH a un nodo qualsiasi come amministratore: OneFS applica le impostazioni SNMP all'intero cluster. Se il cluster risponde già a SNMP per un altro strumento, dai all'agente la stessa community o lo stesso utente e salta questo passaggio. Altrimenti attiva SNMP v2c con una community di sola lettura tutta tua, non quella predefinita di OneFS, `I$ilonpublic`:",
  "Or turn on SNMPv3, which authenticates and encrypts every poll. OneFS has one SNMPv3 read-only user, `general` until you rename it: give it passwords of at least eight characters, without spaces:":
    "Oppure attiva SNMPv3, che autentica e cifra ogni interrogazione. OneFS ha un solo utente SNMPv3 di sola lettura, `general` finché non lo rinomini: dagli password di almeno otto caratteri, senza spazi:",
  "`isi snmp settings view` shows the settings, with the user's authentication and privacy protocols. Allow UDP 161 from the agent's machine to every node, and list the nodes' addresses with `isi network interfaces list`.":
    "`isi snmp settings view` mostra le impostazioni, con i protocolli di autenticazione e di privacy dell'utente. Consenti UDP 161 dalla macchina dell'agente verso ogni nodo ed elenca gli indirizzi dei nodi con `isi network interfaces list`.",
  "- **every node's address**, separated by commas: each node's own address, never the SmartConnect zone name, since a node answers only for its own drives, sensors and ports":
    "- gli **indirizzi di tutti i nodi**, separati da virgole: l'indirizzo proprio di ogni nodo, mai il nome della zona SmartConnect, perché un nodo risponde solo per le proprie unità, i propri sensori e le proprie porte",
  "- the **SNMP version**, then the read-only **community**, or the SNMPv3 **user** and its two passwords, each read without echo":
    "- la **versione SNMP**, poi la **community** di sola lettura, oppure l'**utente** SNMPv3 e le sue due password, ognuna letta senza mostrarla",
  "A user whose protocols are not SHA and AES needs `POWERSCALE_SNMP_AUTH_PROTOCOL` and `POWERSCALE_SNMP_PRIVACY_PROTOCOL` in front of `bash install.sh`, and a user without privacy `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`.":
    "Un utente i cui protocolli non sono SHA e AES ha bisogno di `POWERSCALE_SNMP_AUTH_PROTOCOL` e `POWERSCALE_SNMP_PRIVACY_PROTOCOL` davanti a `bash install.sh`, e un utente senza privacy di `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`.",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the community or the SNMPv3 passwords), with one poll per node, and starts the agent with Docker Compose. When the cluster gains a node, add its address to `POWERSCALE_NODES` in that file and run `bash install.sh` again.":
    "Si installa in `/opt/oneuptime-storage-array-agent`, scrive un file `.env` che solo tu puoi leggere (contiene la community o le password SNMPv3), con un'interrogazione per nodo, e avvia l'agente con Docker Compose. Quando il cluster acquisisce un nodo, aggiungi il suo indirizzo a `POWERSCALE_NODES` in quel file ed esegui di nuovo `bash install.sh`.",
  "- Replace `my-storage-array` with a name for this cluster, such as `ps-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- Sostituisci `my-storage-array` con un nome per questo cluster, ad esempio `ps-prod`. È il nome con cui il cluster appare in OneUptime, quindi mantienilo stabile: un nome nuovo registra un nuovo array di storage.",
  "- List every node in `POWERSCALE_NODES` and give each its own `POWERSCALE_NODE_<n>` and `snmp/node-<n>` in `POWERSCALE_SNMP_RECEIVERS`, up to 252, after `snmp/cluster` and `snmp/quotas`. An IPv6 address goes in brackets, such as `[fd00::11]`.":
    "- Elenca ogni nodo in `POWERSCALE_NODES` e dai a ognuno il proprio `POWERSCALE_NODE_<n>` e il proprio `snmp/node-<n>` in `POWERSCALE_SNMP_RECEIVERS`, fino a 252, dopo `snmp/cluster` e `snmp/quotas`. Un indirizzo IPv6 va tra parentesi quadre, ad esempio `[fd00::11]`.",
  "- For SNMPv3, set `POWERSCALE_SNMP_VERSION=v3`, `POWERSCALE_SNMP_USER`, `POWERSCALE_SNMP_AUTH_PASSWORD` and `POWERSCALE_SNMP_PRIVACY_PASSWORD` instead of the community. Run `chmod 600 .env`: it holds the community or the passwords.":
    "- Per SNMPv3, imposta `POWERSCALE_SNMP_VERSION=v3`, `POWERSCALE_SNMP_USER`, `POWERSCALE_SNMP_AUTH_PASSWORD` e `POWERSCALE_SNMP_PRIVACY_PASSWORD` al posto della community. Esegui `chmod 600 .env`: contiene la community o le password.",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this cluster registers under in OneUptime, stamped on every metric as `storage.array.name`. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | Sì | Il nome con cui questo cluster si registra in OneUptime, apposto su ogni metrica come `storage.array.name`. Mantienilo stabile: cambiarlo registra un nuovo array di storage |",
  "| `STORAGE_SYSTEM` | Yes | `dell.powerscale` |":
    "| `STORAGE_SYSTEM` | Sì | `dell.powerscale` |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Yes | `otel-collector-config.powerscale.yaml` |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Sì | `otel-collector-config.powerscale.yaml` |",
  "| `POWERSCALE_NODES` | Yes | Every node's address, separated by commas. The install script writes the polls below from it |":
    "| `POWERSCALE_NODES` | Sì | Gli indirizzi di tutti i nodi, separati da virgole. Lo script di installazione ne ricava le interrogazioni qui sotto |",
  "| `POWERSCALE_ENDPOINT` | Yes | The node the cluster's own health, capacity and quotas are read through: the first in `POWERSCALE_NODES` |":
    "| `POWERSCALE_ENDPOINT` | Sì | Il nodo tramite cui si leggono la salute, la capacità e le quote del cluster stesso: il primo di `POWERSCALE_NODES` |",
  "| `POWERSCALE_SNMP_RECEIVERS` | Yes | The polls the collector runs: `snmp/cluster`, `snmp/quotas`, then `snmp/node-<n>` for each node |":
    "| `POWERSCALE_SNMP_RECEIVERS` | Sì | Le interrogazioni che il collector esegue: `snmp/cluster`, `snmp/quotas`, poi `snmp/node-<n>` per ogni nodo |",
  "| `POWERSCALE_NODE_<n>` | Yes | Node `<n>`'s address, from 1 to 252 |":
    "| `POWERSCALE_NODE_<n>` | Sì | L'indirizzo del nodo `<n>`, da 1 a 252 |",
  "| `POWERSCALE_SNMP_VERSION` | No | `v2c` (default) or `v3` |":
    "| `POWERSCALE_SNMP_VERSION` | No | `v2c` (predefinito) o `v3` |",
  "| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | The cluster's read-only community |":
    "| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | La community di sola lettura del cluster |",
  "| `POWERSCALE_SNMP_USER` | SNMPv3 | The cluster's SNMPv3 read-only user |":
    "| `POWERSCALE_SNMP_USER` | SNMPv3 | L'utente SNMPv3 di sola lettura del cluster |",
  "| `POWERSCALE_SNMP_SECURITY_LEVEL` | No | `auth_priv` (default), `auth_no_priv` or `no_auth_no_priv` |":
    "| `POWERSCALE_SNMP_SECURITY_LEVEL` | No | `auth_priv` (predefinito), `auth_no_priv` o `no_auth_no_priv` |",
  "| `POWERSCALE_SNMP_AUTH_PROTOCOL` | No | `SHA` (default), `MD5`, `SHA224`, `SHA256`, `SHA384` or `SHA512` |":
    "| `POWERSCALE_SNMP_AUTH_PROTOCOL` | No | `SHA` (predefinito), `MD5`, `SHA224`, `SHA256`, `SHA384` o `SHA512` |",
  "| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | The SNMPv3 user's authentication password |":
    "| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | La password di autenticazione dell'utente SNMPv3 |",
  "| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | No | `AES` (default), `DES`, `AES192`, `AES256`, `AES192C` or `AES256C` |":
    "| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | No | `AES` (predefinito), `DES`, `AES192`, `AES256`, `AES192C` o `AES256C` |",
  "| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | The SNMPv3 user's privacy password |":
    "| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | La password di privacy dell'utente SNMPv3 |",
  "- **One collector, no exporter.** The collector's own SNMP receiver reads Dell's ISILON-MIB; nothing else runs beside it.":
    "- **Un collector, nessun exporter.** Il ricevitore SNMP del collector stesso legge l'ISILON-MIB di Dell; accanto non gira nient'altro.",
  "- **The cluster's objects once, through `POWERSCALE_ENDPOINT`:** its health, capacity, throughput and node counts every 60 seconds (`snmp/cluster`), and its SmartQuotas every 5 minutes (`snmp/quotas`).":
    "- **Gli oggetti del cluster una sola volta, tramite `POWERSCALE_ENDPOINT`:** la sua salute, capacità, throughput e i conteggi dei nodi ogni 60 secondi (`snmp/cluster`), e le sue SmartQuotas ogni 5 minuti (`snmp/quotas`).",
  "- **Each node's from the node:** its health, CPU, protocol performance, drives, sensors and ports every 60 seconds (`snmp/node-<n>`).":
    "- **Quelli di ogni nodo, dal nodo stesso:** la sua salute, CPU, prestazioni dei protocolli, unità, sensori e porte ogni 60 secondi (`snmp/node-<n>`).",
  "- **Every poll labels its series `scrape_endpoint: <poll>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted quota leaves the inventory. Keep the labels as shipped.":
    "- **Ogni interrogazione etichetta le sue serie con `scrape_endpoint: <poll>`**, così OneUptime sa di quali oggetti un batch è l'elenco completo: è così che una quota eliminata esce dall'inventario. Lascia le etichette come sono fornite.",
  "The full config, one SNMP receiver per node slot, is `otel-collector-config.powerscale.yaml` in the agent's folder:":
    "La configurazione completa, un ricevitore SNMP per ogni slot di nodo, è `otel-collector-config.powerscale.yaml` nella cartella dell'agente:",
  "Then turn SNMP off on the cluster, or change the agent's community or SNMPv3 passwords, if nothing else polls it.":
    "Poi disattiva SNMP sul cluster, oppure cambia la community o le password SNMPv3 dell'agente, se nient'altro lo interroga.",
  "`troubleshoot.sh` checks the whole chain — the container runtime, the node addresses and the community or SNMPv3 user in `.env`, each node with `snmpget` when the machine has it, array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key.":
    "`troubleshoot.sh` controlla tutta la catena (runtime dei container, gli indirizzi dei nodi e la community o l'utente SNMPv3 in `.env`, ogni nodo con `snmpget` quando la macchina lo ha, l'apposizione del nome dell'array, le metriche proprie del collector) e chiede direttamente a OneUptime se accetta la tua chiave di acquisizione.",
  "`Error scraping metrics` with `request timeout` in `docker logs oneuptime-storage-array-agent` names a node that does not answer SNMP from this machine: SNMP is off for the version the agent uses, the community or SNMPv3 user is not the cluster's, or UDP 161 is blocked on the way. A node that answers but is missing from the cluster's nodes is not in `POWERSCALE_NODES`: add it and run `bash install.sh` again.":
    "`Error scraping metrics` con `request timeout` in `docker logs oneuptime-storage-array-agent` indica un nodo che non risponde a SNMP da questa macchina: SNMP è disattivato per la versione usata dall'agente, la community o l'utente SNMPv3 non sono quelli del cluster, oppure UDP 161 è bloccato lungo il percorso. Un nodo che risponde ma manca tra i nodi del cluster non è in `POWERSCALE_NODES`: aggiungilo ed esegui di nuovo `bash install.sh`.",
};

export default TRANSLATION;
