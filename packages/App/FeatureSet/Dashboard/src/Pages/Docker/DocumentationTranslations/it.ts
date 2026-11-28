import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Docker setup guide in Italian (#8341): each piece of the English
 * guide's markdown (Pages/Docker/Utils/DocumentationMarkdown.ts) and its
 * Italian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Italian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+": "Docker Engine 20.10 o successivo",
  "Access to `/var/run/docker.sock` on the host":
    "Accesso a `/var/run/docker.sock` sull'host",
  "Containers whose logs you want must use the `json-file` log driver — Docker's default":
    "I container di cui vuoi i log devono usare il driver di log `json-file`, quello predefinito di Docker",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "Poi avvia accanto l'agente IA di OneUptime, con lo stesso URL, la stessa chiave e lo stesso nome host. **Le indagini IA sono attive per impostazione predefinita**: mentre OneUptime AI indaga su un incidente o un avviso di questo host, esegue comandi `docker` in sola lettura tramite l'agente IA e non cambia nulla finché non consenti le correzioni; vedi **L'agente IA di OneUptime** in Avanzato. Salta questo comando per eseguire il collector senza indagini IA.",
  "Replace `my-docker-host` with a name for this host, such as `prod-docker-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "Sostituisci `my-docker-host` con un nome per questo host, ad esempio `prod-docker-01`. È il nome con cui l'host appare in OneUptime, quindi mantienilo stabile: un nome nuovo registra un host nuovo.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Scegli una chiave di acquisizione nel passaggio 1 per compilare `<YOUR_API_KEY>`.",
  "Look for this line in the logs:": "Cerca questa riga nei log:",
  "Once the agent connects, the host appears automatically in the **Docker** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "Quando l'agente si connette, l'host appare automaticamente nella sezione **Docker**, di solito entro un minuto circa. L'agente IA di OneUptime risulta Connesso nella pagina **IA → Agente IA** dell'host e in fondo alla sua **Panoramica**.",
  "| Variable | Required | Description |":
    "| Variabile | Obbligatoria | Descrizione |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Sì | L'URL della tua istanza OneUptime (ad es. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | Sì | La chiave di acquisizione della telemetria del passaggio 1 |",
  "| `DOCKER_HOST_NAME` | No | Friendly name for this host. Defaults to `docker-host` |":
    "| `DOCKER_HOST_NAME` | No | Un nome descrittivo per questo host. Predefinito: `docker-host` |",
  "| `DOCKER_API_VERSION` | No | Docker Engine API version the agent speaks. Empty by default: the agent negotiates it with the daemon, so any Docker Engine from 20.10 on works. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | No | La versione dell'API di Docker Engine che parla l'agente. Vuota per impostazione predefinita: l'agente la negozia con il daemon, quindi funziona qualsiasi Docker Engine dalla 20.10 in poi. Impostala solo per fissare una versione (vedi Risoluzione dei problemi) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| da `ONEUPTIME_LOG_OPERATOR_1` a `ONEUPTIME_LOG_OPERATOR_5` | No | I tuoi operatori per il collector, ognuno in JSON, per un formato di log che l'agente non legge |",
  "Pass each one to `docker run` as `-e NAME=value`. To change one later, remove the agent with `docker rm -f oneuptime-docker-agent` and run the command again with the new value.":
    "Passa ciascuna a `docker run` come `-e NAME=value`. Per cambiarne una in seguito, rimuovi l'agente con `docker rm -f oneuptime-docker-agent` ed esegui di nuovo il comando con il nuovo valore.",
  "The agent tails `/var/lib/docker/containers/*/*-json.log`, so it only sees logs from containers that use Docker's **`json-file`** log driver. That is Docker's default, but some hosts switch to `local` (binary files the agent cannot parse) or to a remote driver (`journald`, `syslog`, `fluentd`, `gelf`, …), which leave no files to read.":
    "L'agente segue `/var/lib/docker/containers/*/*-json.log`, quindi vede solo i log dei container che usano il driver di log **`json-file`** di Docker. È quello predefinito di Docker, ma alcuni host passano a `local` (file binari che l'agente non sa leggere) o a un driver remoto (`journald`, `syslog`, `fluentd`, `gelf`, …), che non lasciano file da leggere.",
  "Check a container's log driver, and the daemon's default:":
    "Controlla il driver di log di un container e quello predefinito del daemon:",
  "Switch a Compose service to `json-file`, with rotation:":
    "Passa un servizio Compose a `json-file`, con rotazione:",
  "Or change the daemon's default for every container created afterwards, in `/etc/docker/daemon.json`:":
    "Oppure cambia il driver predefinito del daemon per ogni container creato in seguito, in `/etc/docker/daemon.json`:",
  "Then restart Docker and **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with.":
    "Poi riavvia Docker e **ricrea** (non basta riavviarli) i container interessati: un container mantiene il driver di log con cui è stato creato.",
  "`oneuptime-docker-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `docker rm -f oneuptime-docker-ai-agent`.":
    "`oneuptime-docker-ai-agent`, il secondo container avviato dal passaggio 2, esegue i comandi `docker` che OneUptime AI richiede mentre indaga su un incidente o un avviso di questo host. **Le indagini IA sono attive per impostazione predefinita**: appena si connette, OneUptime AI indaga con esso, e la pagina **IA → Agente IA** dell'host e la sua **Panoramica** ne mostrano lo stato. Per disattivare le indagini, usa **Cosa può fare l'IA** in quella pagina; per eseguire il collector senza l'agente IA, rimuovilo con `docker rm -f oneuptime-docker-ai-agent`.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **In sola lettura per impostazione predefinita.** Esegue comandi come `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` e `docker stats --no-stream`, mai `exec`, `run`, `rm` o `prune`. I valori d'ambiente nell'output di `docker inspect` vengono mascherati prima che qualsiasi cosa lasci l'host.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Le correzioni vanno attivate.** Aggiungi `-e ONEUPTIME_AI_ALLOW_WRITES=true` al comando per permettergli di riavviare, avviare, arrestare, mettere in pausa, terminare un container con nome o cambiarne i limiti. `ONEUPTIME_AI_FIXES` accanto indica se ogni correzione richiede l'approvazione (`ask-for-approval`, `automatic` o `bypass-approval`), e la pagina **IA → Agente IA** dell'host lo mostra. `ONEUPTIME_AI_WRITE_TARGETS` (glob separati da virgole, come `web-*,api-*`) limita i container interessati; `ONEUPTIME_AI_PROTECTED_TARGETS` aggiunge container che non deve mai cambiare. Non cambia mai sé stesso né il collector.",
  "- It runs as root because the Docker socket is root-owned. The socket's `:ro` mount does not make the Docker API read-only — the agent's command policy is the limit.":
    "- Viene eseguito come root perché il socket Docker appartiene a root. Il montaggio `:ro` del socket non rende l'API Docker di sola lettura: il limite è la policy dei comandi dell'agente.",
  "- Its logs: `docker logs -f oneuptime-docker-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- I suoi log: `docker logs -f oneuptime-docker-ai-agent`. Cosa può eseguire e come funzionano le correzioni: [Agenti IA per l'infrastruttura](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| Tag | Descrizione |",
  "| `oneuptime/docker-agent:release` | Latest stable release (community) |":
    "| `oneuptime/docker-agent:release` | Ultima versione stabile (community) |",
  "| `oneuptime/docker-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/docker-agent:enterprise-release` | Ultima versione stabile (enterprise) |",
  "| `oneuptime/docker-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/docker-agent:<version>` | Una versione fissata, ad es. `10.0.31` |",
  "| `ghcr.io/oneuptime/docker-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/docker-agent:release` | La stessa immagine, replicata su GHCR |",
  "Use one in place of `oneuptime/docker-agent:release` at the end of the `docker run` command.":
    "Usane uno al posto di `oneuptime/docker-agent:release` alla fine del comando `docker run`.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**Aggiornamento**: scarica l'immagine più recente e rimuovi l'agente in esecuzione:",
  "Then run both `docker run` commands from step 2 again.":
    "Poi esegui di nuovo entrambi i comandi `docker run` del passaggio 2.",
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
  "| **Container Logs** | stdout/stderr logs from all containers |":
    "| **Log dei contenitori** | Log stdout/stderr di tutti i container |",
  'Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'Ogni riga di log riceve una gravità dal livello che indica (`[ERROR]`, `level=warn`, `{"level":"info"}`); una riga senza livello ricade sul suo flusso: stderr è `ERROR`, stdout è `INFO`.',
  "The agent must run as root to read `/var/run/docker.sock`. Make sure the `--user 0:0` flag is in your `docker run` command.":
    "L'agente deve essere eseguito come root per leggere `/var/run/docker.sock`. Assicurati che l'opzione `--user 0:0` sia nel tuo comando `docker run`.",
  "The agent's logs show:": "I log dell'agente mostrano:",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Remove the agent (`docker rm -f oneuptime-docker-agent`), pull the latest image (`docker pull oneuptime/docker-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the daemon.":
    "Il daemon rifiuta un client più recente del proprio massimo, il collector esce di conseguenza e il container si riavvia in loop. L'agente fissa una versione solo quando `DOCKER_API_VERSION` ne indica una, e una vecchia immagine dell'agente fissava `1.44`, che Docker Engine dalla 20.10 alla 24 rifiuta. Rimuovi l'agente (`docker rm -f oneuptime-docker-agent`), scarica l'immagine più recente (`docker pull oneuptime/docker-agent:release`) ed esegui di nuovo il comando del passaggio 2, senza `-e DOCKER_API_VERSION`. L'agente allora negozia la versione con il daemon.",
  "To pin a version anyway, use no more than the daemon's maximum:":
    "Per fissare comunque una versione, non superare il massimo del daemon:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "Aggiungila al comando, ad es. `-e DOCKER_API_VERSION=1.41`. I daemon più recenti servono ancora le versioni precedenti dell'API, quindi una versione fissata continua a funzionare dopo l'aggiornamento di Docker.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-docker-agent`":
    "1. Verifica che l'agente sia in esecuzione: `docker ps --filter name=oneuptime-docker-agent`",
  "2. Check the agent's logs for errors: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`":
    "2. Cerca errori nei log dell'agente: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `docker run` command are correct.":
    "3. Verifica che l'URL di OneUptime e la chiave di acquisizione nel comando `docker run` siano corretti.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. Assicurati che l'host possa raggiungere la tua istanza OneUptime in rete.",
  "Check that the Docker socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "Verifica che il socket Docker sia montato nell'agente. La sua immagine non ha una shell, quindi controlla da un container usa e getta che ne condivida i montaggi:",
  "Then look for export errors in the agent's logs — `docker logs oneuptime-docker-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "Poi cerca errori di esportazione nei log dell'agente (`docker logs oneuptime-docker-agent 2>&1 | grep -i error`) e assicurati che la chiave di acquisizione sia valida e non sia scaduta.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using the `json-file` log driver.":
    "Le metriche arrivano, ma la scheda **Log** è vuota o mostra solo i log dell'agente stesso? Molto probabilmente i tuoi container non usano il driver di log `json-file`.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `json-file`. Switch them (see **Collect logs from every container (json-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "Se il passaggio 1 mostra `no files match the configured criteria`, o il passaggio 3 non elenca file per i tuoi container, vuol dire che non usano `json-file`. Cambiali (vedi **Raccogli i log di tutti i container (driver di log json-file)** in Avanzato), poi ricreali uno per uno: un container mantiene il driver di log con cui è stato creato:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `DOCKER_HOST_NAME`. Change `DOCKER_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "La pagina di un host mostra i dati il cui nome host è l'identificatore di quell'host, che l'agente prende da `DOCKER_HOST_NAME`. Se cambi `DOCKER_HOST_NAME` dopo la registrazione dell'host, OneUptime registra un secondo host con il nuovo nome, e i log sono su quello. Controlla il nome che l'agente riporta:",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and recreate the agent — `docker rm -f oneuptime-docker-agent`, then run the command from step 2 with the new name.":
    "Il nome dell'host viene da `DOCKER_HOST_NAME`. Un agente avviato senza di esso riporta `docker-host`, quindi tutti gli host configurati così sembrano lo stesso host. Imposta `DOCKER_HOST_NAME` su un nome proprio per ogni host e ricrea l'agente: `docker rm -f oneuptime-docker-agent`, poi esegui il comando del passaggio 2 con il nuovo nome.",
  "This installs the agent for **`web-1`** — keep `DOCKER_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "Questo installa l'agente per **`web-1`**: lascia `DOCKER_HOST_NAME` esattamente com'è, altrimenti i dati vengono registrati come un host nuovo.",
  "Docker Compose v2 (the `docker compose` command)":
    "Docker Compose v2 (il comando `docker compose`)",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-docker-ai-agent` service to run the collector without AI investigations.":
    "Il secondo servizio è l'agente IA di OneUptime, con lo stesso URL, la stessa chiave e lo stesso nome host. **Le indagini IA sono attive per impostazione predefinita**: mentre OneUptime AI indaga su un incidente o un avviso di questo host, esegue comandi `docker` in sola lettura tramite l'agente IA e non cambia nulla finché non consenti le correzioni; vedi **L'agente IA di OneUptime** in Avanzato. Elimina il servizio `oneuptime-docker-ai-agent` per eseguire il collector senza indagini IA.",
  "Set each one in the agent's `environment:` list, then run `docker compose up -d` to recreate it with the new values.":
    "Imposta ciascuna nell'elenco `environment:` dell'agente, poi esegui `docker compose up -d` per ricrearlo con i nuovi valori.",
  "`oneuptime-docker-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `docker compose up -d --remove-orphans`.":
    "`oneuptime-docker-ai-agent`, il secondo servizio in docker-compose.yml, esegue i comandi `docker` che OneUptime AI richiede mentre indaga su un incidente o un avviso di questo host. **Le indagini IA sono attive per impostazione predefinita**: appena si connette, OneUptime AI indaga con esso, e la pagina **IA → Agente IA** dell'host e la sua **Panoramica** ne mostrano lo stato. Per disattivare le indagini, usa **Cosa può fare l'IA** in quella pagina; per eseguire il collector senza l'agente IA, elimina il suo servizio ed esegui `docker compose up -d --remove-orphans`.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Le correzioni vanno attivate.** Aggiungi `- ONEUPTIME_AI_ALLOW_WRITES=true` al suo elenco `environment:` per permettergli di riavviare, avviare, arrestare, mettere in pausa, terminare un container con nome o cambiarne i limiti. `ONEUPTIME_AI_FIXES` accanto indica se ogni correzione richiede l'approvazione (`ask-for-approval`, `automatic` o `bypass-approval`), e la pagina **IA → Agente IA** dell'host lo mostra. `ONEUPTIME_AI_WRITE_TARGETS` (glob separati da virgole, come `web-*,api-*`) limita i container interessati; `ONEUPTIME_AI_PROTECTED_TARGETS` aggiunge container che non deve mai cambiare. Non cambia mai sé stesso né il collector.",
  "Use one in place of `oneuptime/docker-agent:release` on the agent's `image:` line.":
    "Usane uno al posto di `oneuptime/docker-agent:release` nella riga `image:` dell'agente.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**Aggiornamento**: nella cartella che contiene docker-compose.yml, scarica le immagini più recenti e ricrea i container:",
  "**Uninstall** — stop and remove everything the file started:":
    "**Disinstallazione**: arresta e rimuovi tutto ciò che il file ha avviato:",
  'The agent must run as root to read `/var/run/docker.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml.':
    "L'agente deve essere eseguito come root per leggere `/var/run/docker.sock`. Assicurati che il servizio dell'agente abbia `user: \"0:0\"` in docker-compose.yml.",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `docker compose pull` and `docker compose up -d`. The agent then negotiates the version with the daemon.":
    "Il daemon rifiuta un client più recente del proprio massimo, il collector esce di conseguenza e il container si riavvia in loop. L'agente fissa una versione solo quando `DOCKER_API_VERSION` ne indica una, e una vecchia immagine dell'agente fissava `1.44`, che Docker Engine dalla 20.10 alla 24 rifiuta. Togli `DOCKER_API_VERSION` dall'elenco `environment:` dell'agente, poi esegui `docker compose pull` e `docker compose up -d`. L'agente allora negozia la versione con il daemon.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `docker compose up -d`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "Aggiungila all'elenco `environment:` dell'agente, ad es. `- DOCKER_API_VERSION=1.41`, ed esegui `docker compose up -d`. I daemon più recenti servono ancora le versioni precedenti dell'API, quindi una versione fissata continua a funzionare dopo l'aggiornamento di Docker.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. Verifica che l'URL di OneUptime e la chiave di acquisizione in docker-compose.yml siano corretti.",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and run `docker compose up -d` to recreate the agent with it.":
    "Il nome dell'host viene da `DOCKER_HOST_NAME`. Un agente avviato senza di esso riporta `docker-host`, quindi tutti gli host configurati così sembrano lo stesso host. Imposta `DOCKER_HOST_NAME` su un nome proprio per ogni host ed esegui `docker compose up -d` per ricreare l'agente con esso.",
};

export default TRANSLATION;
