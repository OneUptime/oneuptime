import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Podman setup guide in Italian (#8341): each piece of the English
 * guide's markdown (Pages/Podman/Utils/DocumentationMarkdown.ts) and its
 * Italian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Italian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Podman 4.0+": "Podman 4.0 o successivo",
  "Podman's Docker-compatible API socket at `/run/podman/podman.sock` — turn it on with `sudo systemctl enable --now podman.socket`":
    "Il socket API compatibile con Docker di Podman in `/run/podman/podman.sock`: attivalo con `sudo systemctl enable --now podman.socket`",
  "Containers whose logs you want must use the `k8s-file` log driver — rootful Podman defaults to `journald`, which the agent cannot read":
    "I container di cui vuoi i log devono usare il driver di log `k8s-file`: Podman rootful usa per impostazione predefinita `journald`, che l'agente non può leggere",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "Poi avvia accanto l'agente IA di OneUptime, con lo stesso URL, la stessa chiave e lo stesso nome host. **Le indagini IA sono attive per impostazione predefinita**: mentre OneUptime AI indaga su un incidente o un avviso di questo host, esegue comandi `docker` in sola lettura tramite l'agente IA, sul socket compatibile con Docker di Podman, e non cambia nulla finché non consenti le correzioni; vedi **L'agente IA di OneUptime** in Avanzato. Salta questo comando per eseguire il collector senza indagini IA.",
  "Replace `my-podman-host` with a name for this host, such as `prod-podman-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "Sostituisci `my-podman-host` con un nome per questo host, ad esempio `prod-podman-01`. È il nome con cui l'host appare in OneUptime, quindi mantienilo stabile: un nome nuovo registra un host nuovo.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Scegli una chiave di acquisizione nel passaggio 1 per compilare `<YOUR_API_KEY>`.",
  "Look for this line in the logs:": "Cerca questa riga nei log:",
  "Once the agent connects, the host appears automatically in the **Podman** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "Quando l'agente si connette, l'host appare automaticamente nella sezione **Podman**, di solito entro un minuto circa. L'agente IA di OneUptime risulta Connesso nella pagina **IA → Agente IA** dell'host e in fondo alla sua **Panoramica**.",
  "**Metrics but no logs?** Rootful Podman writes container logs to `journald` by default, which the agent cannot read. Run your containers with `--log-driver k8s-file` — see **Collect logs from every container (k8s-file log driver)** under Advanced.":
    "**Metriche ma nessun log?** Podman rootful scrive i log dei container in `journald` per impostazione predefinita, che l'agente non può leggere. Esegui i tuoi container con `--log-driver k8s-file`; vedi **Raccogli i log di tutti i container (driver di log k8s-file)** in Avanzato.",
  "| Variable | Required | Description |":
    "| Variabile | Obbligatoria | Descrizione |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Sì | L'URL della tua istanza OneUptime (ad es. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | Sì | La chiave di acquisizione della telemetria del passaggio 1 |",
  "| `PODMAN_HOST_NAME` | No | Friendly name for this host. Defaults to `podman-host` |":
    "| `PODMAN_HOST_NAME` | No | Un nome descrittivo per questo host. Predefinito: `podman-host` |",
  "| `DOCKER_API_VERSION` | No | Docker API version the agent speaks to the Podman socket. Empty by default: the agent negotiates it with the socket. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | No | La versione dell'API Docker che l'agente parla con il socket di Podman. Vuota per impostazione predefinita: l'agente la negozia con il socket. Impostala solo per fissare una versione (vedi Risoluzione dei problemi) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| da `ONEUPTIME_LOG_OPERATOR_1` a `ONEUPTIME_LOG_OPERATOR_5` | No | I tuoi operatori per il collector, ognuno in JSON, per un formato di log che l'agente non legge |",
  "Pass each one to `podman run` as `-e NAME=value`. To change one later, remove the agent with `podman rm -f oneuptime-podman-agent` and run the command again with the new value.":
    "Passa ciascuna a `podman run` come `-e NAME=value`. Per cambiarne una in seguito, rimuovi l'agente con `podman rm -f oneuptime-podman-agent` ed esegui di nuovo il comando con il nuovo valore.",
  "The agent reads the files Podman's **`k8s-file`** log driver writes — `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` — so it only sees logs from containers that use it (or `json-file`, which Podman treats as the same file-based driver). Rootful Podman's default is **`journald`**, which it cannot read, and neither can it read a remote driver such as `syslog`.":
    "L'agente legge i file scritti dal driver di log **`k8s-file`** di Podman (`/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log`), quindi vede solo i log dei container che lo usano (o `json-file`, che Podman tratta come lo stesso driver basato su file). Il predefinito di Podman rootful è **`journald`**, che non può leggere, così come non può leggere un driver remoto come `syslog`.",
  "Check a container's log driver, and Podman's default:":
    "Controlla il driver di log di un container e quello predefinito di Podman:",
  "Run a single container with `k8s-file`:":
    "Esegui un singolo container con `k8s-file`:",
  "Switch a Compose service to `k8s-file`, with rotation:":
    "Passa un servizio Compose a `k8s-file`, con rotazione:",
  "Or change the default for every container created afterwards, in `containers.conf` (`/etc/containers/containers.conf` rootful, `~/.config/containers/containers.conf` rootless):":
    "Oppure cambia il driver predefinito per ogni container creato in seguito, in `containers.conf` (`/etc/containers/containers.conf` in modalità rootful, `~/.config/containers/containers.conf` in modalità rootless):",
  "Then **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with. Must keep `journald`? The agent still collects metrics through the socket; only container logs need the file-based driver.":
    "Poi **ricrea** (non basta riavviarli) i container interessati: un container mantiene il driver di log con cui è stato creato. Devi tenere `journald`? L'agente raccoglie comunque le metriche tramite il socket; solo i log dei container richiedono il driver basato su file.",
  "`oneuptime-podman-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `podman rm -f oneuptime-podman-ai-agent`.":
    "`oneuptime-podman-ai-agent`, il secondo container avviato dal passaggio 2, esegue i comandi `docker` che OneUptime AI richiede (tramite il socket compatibile con Docker di Podman) mentre indaga su un incidente o un avviso di questo host. **Le indagini IA sono attive per impostazione predefinita**: appena si connette, OneUptime AI indaga con esso, e la pagina **IA → Agente IA** dell'host e la sua **Panoramica** ne mostrano lo stato. Per disattivare le indagini, usa **Cosa può fare l'IA** in quella pagina; per eseguire il collector senza l'agente IA, rimuovilo con `podman rm -f oneuptime-podman-ai-agent`.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **In sola lettura per impostazione predefinita.** Esegue comandi come `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` e `docker stats --no-stream`, mai `exec`, `run`, `rm` o `prune`. I valori d'ambiente nell'output di `docker inspect` vengono mascherati prima che qualsiasi cosa lasci l'host.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Le correzioni vanno attivate.** Aggiungi `-e ONEUPTIME_AI_ALLOW_WRITES=true` al comando per permettergli di riavviare, avviare, arrestare, mettere in pausa, terminare un container con nome o cambiarne i limiti. `ONEUPTIME_AI_FIXES` accanto indica se ogni correzione richiede l'approvazione (`ask-for-approval`, `automatic` o `bypass-approval`), e la pagina **IA → Agente IA** dell'host lo mostra. `ONEUPTIME_AI_WRITE_TARGETS` (glob separati da virgole, come `web-*,api-*`) limita i container interessati; `ONEUPTIME_AI_PROTECTED_TARGETS` aggiunge container che non deve mai cambiare. Non cambia mai sé stesso né il collector.",
  "- It needs the same socket as the collector, and runs as root because the socket is root-owned. The socket's `:ro` mount does not make the API read-only — the agent's command policy is the limit.":
    "- Ha bisogno dello stesso socket del collector e viene eseguito come root perché il socket appartiene a root. Il montaggio `:ro` del socket non rende l'API di sola lettura: il limite è la policy dei comandi dell'agente.",
  "- Its logs: `podman logs -f oneuptime-podman-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- I suoi log: `podman logs -f oneuptime-podman-ai-agent`. Cosa può eseguire e come funzionano le correzioni: [Agenti IA per l'infrastruttura](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| Tag | Descrizione |",
  "| `oneuptime/podman-agent:release` | Latest stable release (community) |":
    "| `oneuptime/podman-agent:release` | Ultima versione stabile (community) |",
  "| `oneuptime/podman-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/podman-agent:enterprise-release` | Ultima versione stabile (enterprise) |",
  "| `oneuptime/podman-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/podman-agent:<version>` | Una versione fissata, ad es. `10.0.31` |",
  "| `ghcr.io/oneuptime/podman-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/podman-agent:release` | La stessa immagine, replicata su GHCR |",
  "Use one in place of `oneuptime/podman-agent:release` at the end of the `podman run` command.":
    "Usane uno al posto di `oneuptime/podman-agent:release` alla fine del comando `podman run`.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**Aggiornamento**: scarica l'immagine più recente e rimuovi l'agente in esecuzione:",
  "Then run both `podman run` commands from step 2 again.":
    "Poi esegui di nuovo entrambi i comandi `podman run` del passaggio 2.",
  "**Uninstall:**": "**Disinstallazione:**",
  "| Category | Data |": "| Categoria | Dati |",
  "| **CPU Metrics** | Usage total, usage percentage, throttling time (per container) |":
    "| **Metriche CPU** | Utilizzo totale, percentuale di utilizzo, tempo di throttling (per container) |",
  "| **Memory Metrics** | Usage, limit, percentage, RSS, cache (per container) |":
    "| **Metriche di memoria** | Utilizzo, limite, percentuale, RSS, cache (per container) |",
  "| **Network Metrics** | Bytes and packets received/transmitted (per container) |":
    "| **Metriche di rete** | Byte e pacchetti ricevuti/trasmessi (per container) |",
  "| **Block I/O Metrics** | Read/write bytes and operations (per container) |":
    "| **Metriche di I/O a blocchi** | Byte e operazioni di lettura/scrittura (per container) |",
  "| **Container Info** | Uptime, restart count, process count |":
    "| **Informazioni sul container** | Tempo di attività, numero di riavvii, numero di processi |",
  "| **Container Logs** | stdout/stderr logs from all containers that use the `k8s-file` log driver |":
    "| **Log dei contenitori** | Log stdout/stderr di tutti i container che usano il driver di log `k8s-file` |",
  'The metrics come from the collector\'s `docker_stats` receiver, through Podman\'s Docker-compatible socket, so their names are the same as the Docker agent\'s. Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'Le metriche provengono dal receiver `docker_stats` del collector, tramite il socket compatibile con Docker di Podman, quindi hanno gli stessi nomi di quelle dell\'agente Docker. Ogni riga di log riceve una gravità dal livello che indica (`[ERROR]`, `level=warn`, `{"level":"info"}`); una riga senza livello ricade sul suo flusso: stderr è `ERROR`, stdout è `INFO`.',
  "The agent must run as root to read `/run/podman/podman.sock`. Make sure the `--user 0:0` flag is in your `podman run` command, and that the socket is on:":
    "L'agente deve essere eseguito come root per leggere `/run/podman/podman.sock`. Assicurati che l'opzione `--user 0:0` sia nel tuo comando `podman run` e che il socket sia attivo:",
  "That is rootful Podman's socket, the one the agent reads. Running Podman rootless? Its socket is `/run/user/<uid>/podman/podman.sock` (turn it on with `systemctl --user enable --now podman.socket`) and its storage `~/.local/share/containers/storage`: mount those at `/run/podman/podman.sock` and `/var/lib/containers/storage` in the agent's container instead — see the Podman agent documentation.":
    "Questo è il socket di Podman rootful, quello che l'agente legge. Usi Podman in modalità rootless? Il suo socket è `/run/user/<uid>/podman/podman.sock` (attivalo con `systemctl --user enable --now podman.socket`) e il suo storage `~/.local/share/containers/storage`: montali invece su `/run/podman/podman.sock` e `/var/lib/containers/storage` nel container dell'agente; vedi la documentazione dell'agente Podman.",
  "The agent's logs show:": "I log dell'agente mostrano:",
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Remove the agent (`podman rm -f oneuptime-podman-agent`), pull the latest image (`podman pull oneuptime/podman-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the socket.":
    "Un server che impone un massimo rifiuta un client più recente, il collector esce di conseguenza e il container si riavvia in loop. L'agente fissa una versione dell'API Docker solo quando `DOCKER_API_VERSION` ne indica una, e una vecchia immagine dell'agente fissava `1.44`. Rimuovi l'agente (`podman rm -f oneuptime-podman-agent`), scarica l'immagine più recente (`podman pull oneuptime/podman-agent:release`) ed esegui di nuovo il comando del passaggio 2, senza `-e DOCKER_API_VERSION`. L'agente allora negozia la versione con il socket.",
  "To pin a version anyway, use no more than the version the socket reports:":
    "Per fissare comunque una versione, non superare la versione che riporta il socket:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "Aggiungila al comando, ad es. `-e DOCKER_API_VERSION=1.41`. I server più recenti servono ancora le versioni precedenti dell'API, quindi una versione fissata continua a funzionare dopo un aggiornamento.",
  "1. Check that the agent is running: `podman ps --filter name=oneuptime-podman-agent`":
    "1. Verifica che l'agente sia in esecuzione: `podman ps --filter name=oneuptime-podman-agent`",
  "2. Check the agent's logs for errors: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`":
    "2. Cerca errori nei log dell'agente: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `podman run` command are correct.":
    "3. Verifica che l'URL di OneUptime e la chiave di acquisizione nel comando `podman run` siano corretti.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. Assicurati che l'host possa raggiungere la tua istanza OneUptime in rete.",
  "Check that the Podman socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "Verifica che il socket Podman sia montato nell'agente. La sua immagine non ha una shell, quindi controlla da un container usa e getta che ne condivida i montaggi:",
  "Then look for export errors in the agent's logs — `podman logs oneuptime-podman-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "Poi cerca errori di esportazione nei log dell'agente (`podman logs oneuptime-podman-agent 2>&1 | grep -i error`) e assicurati che la chiave di acquisizione sia valida e non sia scaduta.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using a file-based log driver (`k8s-file` or `json-file`) — rootful Podman defaults to `journald`, which the agent cannot read.":
    "Le metriche arrivano, ma la scheda **Log** è vuota o mostra solo i log dell'agente stesso? Molto probabilmente i tuoi container non usano un driver di log basato su file (`k8s-file` o `json-file`): Podman rootful usa per impostazione predefinita `journald`, che l'agente non può leggere.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `k8s-file`. Switch them (see **Collect logs from every container (k8s-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "Se il passaggio 1 mostra `no files match the configured criteria`, o il passaggio 3 non elenca file per i tuoi container, vuol dire che non usano `k8s-file`. Cambiali (vedi **Raccogli i log di tutti i container (driver di log k8s-file)** in Avanzato), poi ricreali uno per uno: un container mantiene il driver di log con cui è stato creato:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `PODMAN_HOST_NAME`. Change `PODMAN_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "La pagina di un host mostra i dati il cui nome host è l'identificatore di quell'host, che l'agente prende da `PODMAN_HOST_NAME`. Se cambi `PODMAN_HOST_NAME` dopo la registrazione dell'host, OneUptime registra un secondo host con il nuovo nome, e i log sono su quello. Controlla il nome che l'agente riporta:",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and recreate the agent — `podman rm -f oneuptime-podman-agent`, then run the command from step 2 with the new name.":
    "Il nome dell'host viene da `PODMAN_HOST_NAME`. Un agente avviato senza di esso riporta `podman-host`, quindi tutti gli host configurati così sembrano lo stesso host. Imposta `PODMAN_HOST_NAME` su un nome proprio per ogni host e ricrea l'agente: `podman rm -f oneuptime-podman-agent`, poi esegui il comando del passaggio 2 con il nuovo nome.",
  "This installs the agent for **`web-1`** — keep `PODMAN_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "Questo installa l'agente per **`web-1`**: lascia `PODMAN_HOST_NAME` esattamente com'è, altrimenti i dati vengono registrati come un host nuovo.",
  "A compose provider for `podman compose`: `podman-compose` or Docker Compose":
    "Un provider Compose per `podman compose`: `podman-compose` o Docker Compose",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-podman-ai-agent` service to run the collector without AI investigations.":
    "Il secondo servizio è l'agente IA di OneUptime, con lo stesso URL, la stessa chiave e lo stesso nome host. **Le indagini IA sono attive per impostazione predefinita**: mentre OneUptime AI indaga su un incidente o un avviso di questo host, esegue comandi `docker` in sola lettura tramite l'agente IA, sul socket compatibile con Docker di Podman, e non cambia nulla finché non consenti le correzioni; vedi **L'agente IA di OneUptime** in Avanzato. Elimina il servizio `oneuptime-podman-ai-agent` per eseguire il collector senza indagini IA.",
  "Set each one in the agent's `environment:` list, then run `podman compose up -d` to recreate it with the new values.":
    "Imposta ciascuna nell'elenco `environment:` dell'agente, poi esegui `podman compose up -d` per ricrearlo con i nuovi valori.",
  "`oneuptime-podman-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `podman compose up -d --remove-orphans`.":
    "`oneuptime-podman-ai-agent`, il secondo servizio in docker-compose.yml, esegue i comandi `docker` che OneUptime AI richiede (tramite il socket compatibile con Docker di Podman) mentre indaga su un incidente o un avviso di questo host. **Le indagini IA sono attive per impostazione predefinita**: appena si connette, OneUptime AI indaga con esso, e la pagina **IA → Agente IA** dell'host e la sua **Panoramica** ne mostrano lo stato. Per disattivare le indagini, usa **Cosa può fare l'IA** in quella pagina; per eseguire il collector senza l'agente IA, elimina il suo servizio ed esegui `podman compose up -d --remove-orphans`.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Le correzioni vanno attivate.** Aggiungi `- ONEUPTIME_AI_ALLOW_WRITES=true` al suo elenco `environment:` per permettergli di riavviare, avviare, arrestare, mettere in pausa, terminare un container con nome o cambiarne i limiti. `ONEUPTIME_AI_FIXES` accanto indica se ogni correzione richiede l'approvazione (`ask-for-approval`, `automatic` o `bypass-approval`), e la pagina **IA → Agente IA** dell'host lo mostra. `ONEUPTIME_AI_WRITE_TARGETS` (glob separati da virgole, come `web-*,api-*`) limita i container interessati; `ONEUPTIME_AI_PROTECTED_TARGETS` aggiunge container che non deve mai cambiare. Non cambia mai sé stesso né il collector.",
  "Use one in place of `oneuptime/podman-agent:release` on the agent's `image:` line.":
    "Usane uno al posto di `oneuptime/podman-agent:release` nella riga `image:` dell'agente.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**Aggiornamento**: nella cartella che contiene docker-compose.yml, scarica le immagini più recenti e ricrea i container:",
  "**Uninstall** — stop and remove everything the file started:":
    "**Disinstallazione**: arresta e rimuovi tutto ciò che il file ha avviato:",
  'The agent must run as root to read `/run/podman/podman.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml, and that the socket is on:':
    "L'agente deve essere eseguito come root per leggere `/run/podman/podman.sock`. Assicurati che il servizio dell'agente abbia `user: \"0:0\"` in docker-compose.yml e che il socket sia attivo:",
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `podman compose pull` and `podman compose up -d`. The agent then negotiates the version with the socket.":
    "Un server che impone un massimo rifiuta un client più recente, il collector esce di conseguenza e il container si riavvia in loop. L'agente fissa una versione dell'API Docker solo quando `DOCKER_API_VERSION` ne indica una, e una vecchia immagine dell'agente fissava `1.44`. Togli `DOCKER_API_VERSION` dall'elenco `environment:` dell'agente, poi esegui `podman compose pull` e `podman compose up -d`. L'agente allora negozia la versione con il socket.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `podman compose up -d`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "Aggiungila all'elenco `environment:` dell'agente, ad es. `- DOCKER_API_VERSION=1.41`, ed esegui `podman compose up -d`. I server più recenti servono ancora le versioni precedenti dell'API, quindi una versione fissata continua a funzionare dopo un aggiornamento.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. Verifica che l'URL di OneUptime e la chiave di acquisizione in docker-compose.yml siano corretti.",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and run `podman compose up -d` to recreate the agent with it.":
    "Il nome dell'host viene da `PODMAN_HOST_NAME`. Un agente avviato senza di esso riporta `podman-host`, quindi tutti gli host configurati così sembrano lo stesso host. Imposta `PODMAN_HOST_NAME` su un nome proprio per ogni host ed esegui `podman compose up -d` per ricreare l'agente con esso.",
};

export default TRANSLATION;
