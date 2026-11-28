import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The XcpNg setup guide in Italian (#8341): each piece of the English
 * guide's markdown (Pages/XcpNg/Utils/DocumentationMarkdown.ts) and its
 * Italian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Italian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Xen Orchestra 6.9 or later, connected to the pools you want to monitor. Its OpenMetrics plugin needs a Premium licence on an XOA; Xen Orchestra built from sources includes it":
    "Xen Orchestra 6.9 o successivo, connesso ai pool che vuoi monitorare. Il suo plugin OpenMetrics richiede una licenza Premium su una XOA; Xen Orchestra compilato dai sorgenti lo include",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach Xen Orchestra over HTTPS":
    "Docker Engine 20.10 o successivo con il plugin Docker Compose v2, su una macchina che raggiunga Xen Orchestra via HTTPS",
  "A certificate on Xen Orchestra that names the address the agent connects to. The self-signed certificate Xen Orchestra makes for itself names none, so no current TLS client can check it — see **Xen Orchestra's certificate** under Advanced":
    "Un certificato su Xen Orchestra che nomini l'indirizzo a cui si connette l'agente. Il certificato autofirmato che Xen Orchestra crea per sé non ne nomina nessuno, quindi nessun client TLS attuale può verificarlo — vedi **Certificato di Xen Orchestra** in Avanzato",
  "1. In Xen Orchestra, open *Settings → Plugins* and find **openmetrics**.":
    "1. In Xen Orchestra, apri *Settings → Plugins* e trova **openmetrics**.",
  "2. Turn it on. The first time it starts, it makes a secret and keeps it, and Xen Orchestra keeps it across restarts.":
    "2. Attivalo. La prima volta che si avvia, crea un segreto e lo conserva, e Xen Orchestra lo mantiene tra un riavvio e l'altro.",
  "3. Open the plugin's settings and copy its **Prometheus secret** — you give it to the agent in the next step. You can also type a secret of your own there and save it.":
    "3. Apri le impostazioni del plugin e copia il suo **Prometheus secret**: lo darai all'agente nel passaggio successivo. Puoi anche digitare lì un segreto tuo e salvarlo.",
  "The plugin answers on Xen Orchestra's own address and certificate, at `/openmetrics/metrics`, and only to a request that carries its secret. It serves every pool Xen Orchestra is connected to, so one agent covers them all.":
    "Il plugin risponde sull'indirizzo e con il certificato di Xen Orchestra stesso, su `/openmetrics/metrics`, e solo a una richiesta che porti il suo segreto. Serve ogni pool a cui Xen Orchestra è connesso, quindi un solo agente li copre tutti.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Lo script chiede l'URL di OneUptime e la chiave di acquisizione, entrambi mostrati nel passaggio 1 (scegli lì una chiave perché vengano compilati qui), e poi:",
  "- **Xen Orchestra's address** — as you open it in a browser, e.g. `https://xo.example.com` or `https://10.0.0.5:8443`.":
    "- **Indirizzo di Xen Orchestra**: come lo apri nel browser, ad es. `https://xo.example.com` o `https://10.0.0.5:8443`.",
  "- **The OpenMetrics plugin's secret** — from the previous step. It is not shown as you type it.":
    "- **Segreto del plugin OpenMetrics**: quello del passaggio precedente. Non viene mostrato mentre lo digiti.",
  "- **What to call this Xen Orchestra** — the name each of its pools shows on its Settings. Press Enter to use its address.":
    "- **Come chiamare questo Xen Orchestra**: il nome che ognuno dei suoi pool mostra nelle sue Impostazioni. Premi Invio per usare il suo indirizzo.",
  "The script then reads Xen Orchestra's certificate. When this machine already trusts it, the agent trusts the same CA bundle. When it does not, the script shows the certificate's SHA-256 fingerprint: compare it with the one on Xen Orchestra's machine and answer **y** to trust that certificate and nothing else. It never turns the check off. It then asks the plugin for its metrics with the secret and says which pools Xen Orchestra reports, before it installs anything.":
    "Lo script legge poi il certificato di Xen Orchestra. Se questa macchina se ne fida già, l'agente si fida dello stesso bundle di CA. Altrimenti lo script mostra l'impronta SHA-256 del certificato: confrontala con quella sulla macchina di Xen Orchestra e rispondi **y** per fidarti di quel certificato e di nient'altro. Non disattiva mai la verifica. Poi chiede al plugin le sue metriche con il segreto e dice quali pool riporta Xen Orchestra, prima di installare qualsiasi cosa.",
  "It installs to `/opt/oneuptime-xcp-ng-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Si installa in `/opt/oneuptime-xcp-ng-agent`, scrive un file `.env` con `0600` e avvia l'agente con Docker Compose. Eseguire di nuovo lo script riusa tutto ciò che c'è in quel `.env` invece di chiedere di nuovo, ed è anche il modo di aggiornare.",
  "`docker compose ps` lists `oneuptime-xcp-ng-agent`. In its logs, look for `Everything is ready. Begin running and processing data.` The agent reads Xen Orchestra every minute, and each pool it reports then appears in the **XCP-ng** section under the name Xen Orchestra gives it, with its hosts, VMs and storage.":
    "`docker compose ps` elenca `oneuptime-xcp-ng-agent`. Nei suoi log, cerca `Everything is ready. Begin running and processing data.` L'agente legge Xen Orchestra ogni minuto, e ogni pool che riporta compare poi nella sezione **XCP-ng** con il nome che gli dà Xen Orchestra, con i suoi host, le sue VM e il suo storage.",
  "The install script writes these to `/opt/oneuptime-xcp-ng-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`.":
    "Lo script di installazione le scrive in `/opt/oneuptime-xcp-ng-agent/.env`. Dopo averne cambiata una, applicala con `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`.",
  "| Variable | Required | Description |":
    "| Variabile | Obbligatoria | Descrizione |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Sì | L'URL della tua istanza OneUptime (ad es. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Sì | La chiave di acquisizione della telemetria, quella scelta nel passaggio 1 |",
  "| `XO_ADDRESS` | Yes | Xen Orchestra's `host` or `host:port`, without a scheme |":
    "| `XO_ADDRESS` | Sì | L'`host` o l'`host:port` di Xen Orchestra, senza schema |",
  "| `XO_SCHEME` | No | `https` (default). `http` only in a lab: the secret then crosses the network in clear |":
    "| `XO_SCHEME` | No | `https` (predefinito). `http` solo in laboratorio: il segreto attraversa allora la rete in chiaro |",
  "| `XO_OPENMETRICS_SECRET` | Yes | The OpenMetrics plugin's secret, sent as a Bearer token. Every `$` in it is written as `$$` |":
    "| `XO_OPENMETRICS_SECRET` | Sì | Il segreto del plugin OpenMetrics, inviato come token Bearer. Ogni `$` che contiene va scritto come `$$` |",
  "| `XO_NAME` | No | What to call this Xen Orchestra in OneUptime, shown on each of its pools' Settings (default: its address) |":
    "| `XO_NAME` | No | Come chiamare questo Xen Orchestra in OneUptime, mostrato nelle Impostazioni di ognuno dei suoi pool (predefinito: il suo indirizzo) |",
  "| `XO_TLS_SERVER_NAME` | No | The name Xen Orchestra's certificate is checked against, when `XO_ADDRESS` is an address the certificate does not list |":
    "| `XO_TLS_SERVER_NAME` | No | Il nome con cui viene verificato il certificato di Xen Orchestra, quando `XO_ADDRESS` è un indirizzo che il certificato non elenca |",
  "| `XCP_NG_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-xcp-ng-agent`). A second Xen Orchestra's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `XCP_NG_AGENT_CONTAINER_NAME` | No | Il nome del container dell'agente (predefinito: `oneuptime-xcp-ng-agent`). L'agente di un secondo Xen Orchestra sulla stessa macchina ne ha bisogno di uno proprio: lo script di installazione dà a un nuovo agente il nome della sua cartella, a meno che tu non lo imposti, e lo mantiene quando esegui di nuovo lo script |",
  "| `XO_URL` | Install script | Xen Orchestra's address as typed; the script derives `XO_SCHEME` and `XO_ADDRESS` from it |":
    "| `XO_URL` | Script di installazione | L'indirizzo di Xen Orchestra così come digitato; lo script ne ricava `XO_SCHEME` e `XO_ADDRESS` |",
  "| `XO_TLS_FINGERPRINT` | Install script | The SHA-256 fingerprint of Xen Orchestra's own certificate, when the agent trusts that certificate and nothing else |":
    "| `XO_TLS_FINGERPRINT` | Script di installazione | L'impronta SHA-256 del certificato di Xen Orchestra stesso, quando l'agente si fida di quel certificato e di nient'altro |",
  "| `XO_CA_FILE` | Install script | A CA bundle that issued Xen Orchestra's certificate, which the script copies to `xo-ca.pem` |":
    "| `XO_CA_FILE` | Script di installazione | Un bundle di CA che ha emesso il certificato di Xen Orchestra, che lo script copia in `xo-ca.pem` |",
  "| `ONEUPTIME_AI_XO_READ_TOKEN` | No | A token of a Xen Orchestra user holding a copy of the built-in **Read only** role and nothing else: the XCP-ng AI agent runs when it is set, and reads with it |":
    "| `ONEUPTIME_AI_XO_READ_TOKEN` | No | Un token di un utente Xen Orchestra con una copia del ruolo integrato **Read only** e nient'altro: l'agente IA XCP-ng viene eseguito quando è impostato, e legge con esso |",
  "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | No | Only for fixes: a token of another user, whose role allows them. The AI agent changes nothing without it |":
    "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | No | Solo per le correzioni: un token di un altro utente, il cui ruolo le consente. Senza di esso, l'agente IA non modifica nulla |",
  "| `XCP_NG_POOL_ID` | No | The XAPI UUID of the pool the AI agent serves (default: the one pool its read token can see) |":
    "| `XCP_NG_POOL_ID` | No | L'UUID XAPI del pool servito dall'agente IA (predefinito: l'unico pool che il suo token di lettura può vedere) |",
  "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | No | Overrides `XCP_NG_POOL_ID` as the pool the AI agent registers as |":
    "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | No | Sostituisce `XCP_NG_POOL_ID` come pool con cui si registra l'agente IA |",
  "| `ONEUPTIME_AI_INVESTIGATION` | No | `true` or `false`: whether OneUptime AI may run the AI agent's read-only commands while it investigates (default: on) |":
    "| `ONEUPTIME_AI_INVESTIGATION` | No | `true` o `false`: se OneUptime AI può eseguire i comandi in sola lettura dell'agente IA mentre indaga (predefinito: attivo) |",
  "| `ONEUPTIME_AI_FIXES` | No | `off`, `ask-for-approval`, `automatic` or `bypass-approval`: how OneUptime AI may apply a fix |":
    "| `ONEUPTIME_AI_FIXES` | No | `off`, `ask-for-approval`, `automatic` o `bypass-approval`: come OneUptime AI può applicare una correzione |",
  "| `ONEUPTIME_AI_ALLOW_WRITES` | No | `true` lets the AI agent apply fixes, with the token for changes. Anything else keeps it read-only |":
    "| `ONEUPTIME_AI_ALLOW_WRITES` | No | `true` consente all'agente IA di applicare correzioni, con il token per le modifiche. Qualsiasi altro valore lo lascia in sola lettura |",
  "| `ONEUPTIME_AI_WRITE_TARGETS` | No | The `vm/<uuid>`, `host/<uuid>`, `pbd/<uuid>` or `schedule/<uuid>` a fix may touch, comma-separated (default: all) |":
    "| `ONEUPTIME_AI_WRITE_TARGETS` | No | I `vm/<uuid>`, `host/<uuid>`, `pbd/<uuid>` o `schedule/<uuid>` che una correzione può toccare, separati da virgole (predefinito: tutti) |",
  "| `ONEUPTIME_AI_PROTECTED_TARGETS` | No | The same, for what OneUptime AI must never change: the VM the AI agent runs in, and Xen Orchestra's own |":
    "| `ONEUPTIME_AI_PROTECTED_TARGETS` | No | Lo stesso, per ciò che OneUptime AI non deve mai modificare: la VM in cui gira l'agente IA, e quella di Xen Orchestra |",
  "| `LOG_LEVEL` | No | The AI agent's log level: `debug`, `info` (default), `warn` or `error` |":
    "| `LOG_LEVEL` | No | Il livello di log dell'agente IA: `debug`, `info` (predefinito), `warn` o `error` |",
  "| `COMPOSE_PROFILES` | No | `xcp-ng-ai-agent` starts the AI agent; the install script writes it when the read token is set |":
    "| `COMPOSE_PROFILES` | No | `xcp-ng-ai-agent` avvia l'agente IA; lo script di installazione lo scrive quando il token di lettura è impostato |",
  "| `XCP_NG_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-xcp-ng-ai-agent`). The install script names a second Xen Orchestra's AI agent after its collector (`oneuptime-xcp-ng-ai-agent-lab` beside `oneuptime-xcp-ng-agent-lab`) unless you set it, and keeps it when you run the script again |":
    "| `XCP_NG_AI_AGENT_CONTAINER_NAME` | No | Il nome del container dell'agente IA (predefinito: `oneuptime-xcp-ng-ai-agent`). Lo script di installazione dà all'agente IA di un secondo Xen Orchestra un nome ricavato da quello del suo collector (`oneuptime-xcp-ng-ai-agent-lab` accanto a `oneuptime-xcp-ng-agent-lab`), a meno che tu non lo imposti, e lo mantiene quando esegui di nuovo lo script |",
  "The agent checks Xen Orchestra's certificate against `xo-ca.pem`, next to `docker-compose.yml`.":
    "L'agente verifica il certificato di Xen Orchestra con `xo-ca.pem`, accanto a `docker-compose.yml`.",
  "The agent checks Xen Orchestra's certificate on every read, against `xo-ca.pem` and nothing else. That file holds one of three things:":
    "L'agente verifica il certificato di Xen Orchestra a ogni lettura, con `xo-ca.pem` e nient'altro. Quel file contiene una di tre cose:",
  "- **Xen Orchestra's own certificate**, pinned by its SHA-256 fingerprint (`XO_TLS_FINGERPRINT`): the agent trusts that certificate and no other.":
    "- **Il certificato di Xen Orchestra stesso**, fissato tramite la sua impronta SHA-256 (`XO_TLS_FINGERPRINT`): l'agente si fida di quel certificato e di nessun altro.",
  "- **The CA that issued it** (`XO_CA_FILE`), for a certificate from a CA of your own.":
    "- **La CA che lo ha emesso** (`XO_CA_FILE`), per un certificato di una tua CA.",
  "- **This machine's CA bundle**, for a certificate this machine already trusts.":
    "- **Il bundle di CA di questa macchina**, per un certificato di cui questa macchina si fida già.",
  "Either way, the certificate must name the address the agent connects to: the agent checks the names a certificate is issued to, as every current TLS client does, and not its subject. The self-signed certificate Xen Orchestra makes for itself names none, so the agent cannot trust it, pinned or not, and fails with `x509: certificate is not valid for any names`. Give Xen Orchestra a certificate that names its address — from your CA, or a self-signed one with a subject alternative name — as [Xen Orchestra's certificate](/docs/telemetry/xcp-ng#xen-orchestras-certificate) shows.":
    "In ogni caso, il certificato deve nominare l'indirizzo a cui si connette l'agente: l'agente verifica i nomi per cui un certificato è emesso, come fa ogni client TLS attuale, e non il suo soggetto. Il certificato autofirmato che Xen Orchestra crea per sé non ne nomina nessuno, quindi l'agente non può fidarsene, fissato o no, e fallisce con `x509: certificate is not valid for any names`. Dai a Xen Orchestra un certificato che nomini il suo indirizzo (dalla tua CA, o uno autofirmato con un nome alternativo del soggetto, subject alternative name), come mostra [Il certificato di Xen Orchestra](/docs/telemetry/xcp-ng#xen-orchestras-certificate).",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When a pinned certificate is renewed, the agent stops reading Xen Orchestra until it trusts the new one. Run the install script again: it shows the new fingerprint and stops, changing nothing. Check that fingerprint on Xen Orchestra's machine, then run the script once more with it: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.":
    "Quando il certificato nomina Xen Orchestra con un nome diverso dall'indirizzo in `XO_ADDRESS`, imposta `XO_TLS_SERVER_NAME` su quel nome. Quando un certificato fissato viene rinnovato, l'agente smette di leggere Xen Orchestra finché non si fida del nuovo. Esegui di nuovo lo script di installazione: mostra la nuova impronta e si ferma, senza cambiare nulla. Verifica quell'impronta sulla macchina di Xen Orchestra, poi esegui lo script ancora una volta con essa: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.",
  "Every minute the agent reads the plugin, which reads each host's XAPI round-robin databases at 60-second resolution. It keeps the `xcp_*` series, and moves each series' pool to the batch it sends, as `xcp_ng.pool.id` (the pool's UUID, which never changes) and `xcp_ng.pool.name`:":
    "Ogni minuto l'agente legge il plugin, che legge tramite XAPI i database round-robin di ogni host con una risoluzione di 60 secondi. Tiene le serie `xcp_*` e sposta il pool di ogni serie sul batch che invia, come `xcp_ng.pool.id` (l'UUID del pool, che non cambia mai) e `xcp_ng.pool.name`:",
  "| Category | Series |": "| Categoria | Serie |",
  "| **Pool** | `xcp_pool_connected` — present while Xen Orchestra is connected to the pool |":
    "| **Pool** | `xcp_pool_connected`: presente finché Xen Orchestra è connesso al pool |",
  "| **Hosts** | `xcp_host_status` (power state and whether it is enabled), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` per interface, `xcp_host_disk_*` per storage repository |":
    "| **Host** | `xcp_host_status` (stato di alimentazione e se è abilitato), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` per interfaccia, `xcp_host_disk_*` per repository di storage |",
  "| **VMs** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU contention), `xcp_vm_memory_*`, `xcp_vm_network_*` per interface, `xcp_vm_disk_*` per disk, `xcp_vm_power_consumption_watts` |":
    "| **VM** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (contesa della CPU), `xcp_vm_memory_*`, `xcp_vm_network_*` per interfaccia, `xcp_vm_disk_*` per disco, `xcp_vm_power_consumption_watts` |",
  "| **Storage** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |":
    "| **Archiviazione** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |",
  "| **XOSTOR** | `xcp_xostor_*`, on pools that run XOSTOR |":
    "| **XOSTOR** | `xcp_xostor_*`, sui pool che eseguono XOSTOR |",
  'Control domains report as VMs with `is_control_domain="true"`; the pages hide them unless you ask for them.':
    'I domini di controllo si presentano come VM con `is_control_domain="true"`; le pagine li nascondono a meno che tu non li chieda.',
  "Xen Orchestra types eight throughput series as counters, though each holds XAPI's per-second rate: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, and the VM network, network error and disk read and write series. The agent turns them into gauges with their values untouched, so OneUptime stores them as the rates they are, in bytes or errors per second.":
    "Xen Orchestra tipizza otto serie di throughput come contatori, anche se ognuna contiene il tasso al secondo di XAPI: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, e le serie di rete, errori di rete e lettura e scrittura su disco delle VM. L'agente le trasforma in gauge con i valori invariati, così OneUptime le memorizza come i tassi che sono, in byte o errori al secondo.",
  "OneUptime adds four 0/1 series for each pool, which the alert templates read: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` and `xcp_ng.vm.stopped_after_running` (a VM halted or paused that ran in the last day). It also stamps every point with `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` or `xostor`) and `xcp_ng.id` (that object's UUID), which monitors and dashboards filter on.":
    "OneUptime aggiunge quattro serie 0/1 per ogni pool, che i modelli di avviso leggono: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` e `xcp_ng.vm.stopped_after_running` (una VM arrestata o in pausa che ha girato nell'ultimo giorno). Appone inoltre su ogni punto `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` o `xostor`) e `xcp_ng.id` (l'UUID di quell'oggetto), su cui filtrano monitor e dashboard.",
  "Not kept: Xen Orchestra's own process series (`xo_*`), which belong to no pool, and a host's power read over IPMI, which the plugin sends without its pool. Each VM's estimated share of it is kept.":
    "Non vengono tenute: le serie di processo di Xen Orchestra stesso (`xo_*`), che non appartengono a nessun pool, e la potenza di un host letta via IPMI, che il plugin invia senza il suo pool. La quota stimata di ogni VM viene tenuta.",
  "One agent reads one Xen Orchestra and every pool it manages. For a second Xen Orchestra, install a second agent in a folder of its own, with a container name of its own — two containers cannot share one:":
    "Un agente legge un Xen Orchestra e ogni pool che gestisce. Per un secondo Xen Orchestra, installa un secondo agente in una cartella sua, con un nome di container suo, perché due container non possono condividere un nome:",
  "Without `XCP_NG_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `XCP_NG_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "Senza `XCP_NG_AGENT_CONTAINER_NAME`, lo script dà al container il nome della cartella. Salva il nome nel `.env` di quell'agente, quindi il nome resta quando esegui di nuovo lo script per aggiornare l'agente, e un agente di cui hai modificato una volta il `container_name` in `docker-compose.yml` mantiene quel nome. Con Docker Compose, imposta invece `XCP_NG_AGENT_CONTAINER_NAME` nel `.env` di ciascun agente.",
  "Don't let two Xen Orchestras that manage the same pool both be read: the pool is one pool in OneUptime, by its UUID, and would be reported twice.":
    "Non lasciare che vengano letti due Xen Orchestra che gestiscono lo stesso pool: il pool è un solo pool in OneUptime, tramite il suo UUID, e verrebbe riportato due volte.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on each pool the agent reads: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `oneuptime.agent.version`:":
    "Ogni attributo di risorsa con prefisso `oneuptime.label.` diventa un'etichetta di progetto su ogni pool che l'agente legge: `oneuptime.label.<dimension>=<value>` è l'etichetta `<dimension>:<value>`. Aggiungili al processor `resource` in `otel-collector-config.yaml`, accanto a `oneuptime.agent.version`:",
  "Then restart the collector so it reads the new config:":
    "Poi riavvia il collector perché legga la nuova configurazione:",
  "The pools show up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent. Running the install script again replaces an edited `otel-collector-config.yaml` and keeps yours next to it as `otel-collector-config.yaml.bak.<timestamp>`.":
    "I pool compaiono con le etichette `team:platform` e `env:production`. Le etichette si confrontano senza distinguere maiuscole e minuscole, quindi un'etichetta `Production` esistente viene riusata; l'agente non rimuove mai le etichette aggiunte nell'interfaccia di OneUptime. Eseguire di nuovo lo script di installazione sostituisce un `otel-collector-config.yaml` modificato e tiene il tuo accanto come `otel-collector-config.yaml.bak.<timestamp>`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), checks Xen Orchestra's certificate the same way, downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the image and recreates the agent with it:":
    "**Aggiornamento**: l'immagine del collector è fissata in `docker-compose.yml` e la sua configurazione è un file accanto, quindi scaricare l'immagine non basta a far avanzare l'agente. Esegui di nuovo lo script di installazione. Riusa ogni valore del tuo `.env` esistente (non viene chiesto nulla di nuovo), verifica il certificato di Xen Orchestra allo stesso modo, scarica gli ultimi `docker-compose.yml` e `otel-collector-config.yaml` (un file che hai modificato viene tenuto accanto al nuovo come `<file>.bak.<timestamp>`), scarica l'immagine e ricrea l'agente con essa:",
  "The config reports the collector version it pins as each pool's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "La configurazione riporta la versione del collector che fissa come **Versione dell'agente** di ogni pool. Quando questo OneUptime ne fissa una più recente, un segnale di avviso accanto apre questi comandi.",
  "**Uninstall** the agent:": "**Disinstalla** l'agente:",
  "Then turn off the OpenMetrics plugin in Xen Orchestra if nothing else reads it.":
    "Poi disattiva il plugin OpenMetrics in Xen Orchestra se nient'altro lo legge.",
  "`troubleshoot.sh` checks the whole chain — the container, Xen Orchestra's certificate against `xo-ca.pem`, the plugin and its secret, the pools it reports — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss.":
    "`troubleshoot.sh` controlla l'intera catena — il container, il certificato di Xen Orchestra con `xo-ca.pem`, il plugin e il suo segreto, i pool che riporta — e chiede direttamente a OneUptime se accetta la tua chiave di acquisizione. Quest'ultimo controllo è il più importante: gli endpoint OTLP di OneUptime rifiutano una chiave errata con `401` o `422`, che il collector scrive nel log come una sola riga `Exporting failed` per batch, facile da non notare.",
  "It ends with a verdict naming the most likely cause. It never prints the secret.":
    "Termina con un verdetto che nomina la causa più probabile. Non stampa mai il segreto.",
  "OneUptime marks a pool Disconnected when nothing has been read for it for 15 minutes.":
    "OneUptime segna un pool come Disconnesso quando per 15 minuti non è stato letto nulla per esso.",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. Se tutti i pool di questo Xen Orchestra sono Disconnessi, controlla l'agente (in `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` e `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "2. If only one is, Xen Orchestra stopped reporting it: under *Settings → Servers* in Xen Orchestra, the pool's server must be connected. The pool's hosts, VMs and storage stay as Xen Orchestra last reported them.":
    "2. Se lo è solo uno, Xen Orchestra ha smesso di riportarlo: in *Settings → Servers* di Xen Orchestra, il server del pool deve essere connesso. Gli host, le VM e lo storage del pool restano come Xen Orchestra li ha riportati l'ultima volta.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "Il collector scrive nel log `server returned HTTP status 401 Unauthorized`. Copia di nuovo il segreto da *Settings → Plugins → openmetrics*, imposta `XO_OPENMETRICS_SECRET` su di esso in `.env` (tra apici singoli, ogni `$` scritto come `$$`) e applicalo con `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`. Prima della 6.8, Xen Orchestra creava un nuovo segreto a ogni riavvio.",
  'Xen Orchestra answers, but its OpenMetrics plugin does not. Turn the plugin on under *Settings → Plugins → openmetrics* (an XOA needs a Premium licence for it), and check that Xen Orchestra is 6.9 or later. `/openmetrics/health` answers `{"status":"ok"}` without a secret while the plugin runs.':
    'Xen Orchestra risponde, ma il suo plugin OpenMetrics no. Attiva il plugin in *Settings → Plugins → openmetrics* (una XOA ha bisogno di una licenza Premium per farlo) e verifica che Xen Orchestra sia la 6.9 o successiva. `/openmetrics/health` risponde `{"status":"ok"}` senza segreto mentre il plugin è in esecuzione.',
  "- `x509: certificate is not valid for any names` — the certificate names no address, as Xen Orchestra's own self-signed one does. Give Xen Orchestra a certificate that names its address.":
    "- `x509: certificate is not valid for any names`: il certificato non nomina alcun indirizzo, come quello autofirmato di Xen Orchestra stesso. Dai a Xen Orchestra un certificato che nomini il suo indirizzo.",
  "- `x509: certificate is valid for <names>, not <address>` — connect to one of those names, or set `XO_TLS_SERVER_NAME` to one.":
    "- `x509: certificate is valid for <names>, not <address>`: connettiti a uno di quei nomi, oppure imposta `XO_TLS_SERVER_NAME` su uno di essi.",
  "- `x509: certificate signed by unknown authority` — `xo-ca.pem` does not hold this certificate or the CA that issued it. The certificate was renewed, or the file holds the wrong one: write it again, as **Xen Orchestra's certificate** under Advanced says.":
    "- `x509: certificate signed by unknown authority`: `xo-ca.pem` non contiene questo certificato né la CA che lo ha emesso. Il certificato è stato rinnovato, oppure il file contiene quello sbagliato: riscrivilo, come spiega **Certificato di Xen Orchestra** in Avanzato.",
  "Xen Orchestra reports only the pools it is connected to, and the agent reads only that Xen Orchestra. Connect the pool's server under *Settings → Servers* in Xen Orchestra; the pool appears in OneUptime with the next read. A pool read by another Xen Orchestra needs an agent beside that one.":
    "Xen Orchestra riporta solo i pool a cui è connesso, e l'agente legge solo quel Xen Orchestra. Connetti il server del pool in *Settings → Servers* di Xen Orchestra; il pool compare in OneUptime alla lettura successiva. Un pool letto da un altro Xen Orchestra ha bisogno di un suo agente, accanto a quell'altro Xen Orchestra.",
  "- **What to call this Xen Orchestra** — the command already names it **`xo-paris`**, as this pool's Settings show it.":
    "- **Come chiamare questo Xen Orchestra**: il comando lo nomina già **`xo-paris`**, come lo mostrano le Impostazioni di questo pool.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "Il comando contiene già l'URL di OneUptime e la chiave di acquisizione. Il resto lo chiede lo script:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Scarica `docker-compose.yml` e `otel-collector-config.yaml` da questo OneUptime in una nuova cartella:",
  "Create a `.env` file next to them — it holds the plugin's secret, so keep it private with `chmod 600 .env`:":
    "Crea un file `.env` accanto a essi: contiene il segreto del plugin, quindi tienilo privato con `chmod 600 .env`:",
  "- Set `XO_ADDRESS` to Xen Orchestra's `host` or `host:port`, without `https://`.":
    "- Imposta `XO_ADDRESS` sull'`host` o sull'`host:port` di Xen Orchestra, senza `https://`.",
  "- Put the plugin's secret between single quotes. If it holds a `$`, write each one as `$$`: the collector reads the value once more.":
    "- Metti il segreto del plugin tra apici singoli. Se contiene un `$`, scrivi ognuno come `$$`: il collector legge il valore un'altra volta.",
  "- `XO_NAME` is what each pool's Settings call this Xen Orchestra.":
    "- `XO_NAME` è il nome con cui le Impostazioni di ogni pool chiamano questo Xen Orchestra.",
  "Then give the agent Xen Orchestra's certificate, as `xo-ca.pem` next to `docker-compose.yml` — the agent checks Xen Orchestra against this file and nothing else. To trust Xen Orchestra's own certificate, read it and check its fingerprint against the one on Xen Orchestra's machine:":
    "Poi dai all'agente il certificato di Xen Orchestra, come `xo-ca.pem` accanto a `docker-compose.yml`: l'agente verifica Xen Orchestra con questo file e nient'altro. Per fidarti del certificato di Xen Orchestra stesso, leggilo e verifica la sua impronta con quella sulla macchina di Xen Orchestra:",
  "When a CA of your own issued it, copy that CA's certificate to `xo-ca.pem` instead; when a public CA did, copy this machine's CA bundle (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).":
    "Se l'ha emesso una tua CA, copia invece il certificato di quella CA in `xo-ca.pem`; se l'ha emesso una CA pubblica, copia il bundle di CA di questa macchina (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).",
  "Start the agent:": "Avvia l'agente:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Scegli una chiave di acquisizione nel passaggio 1 per compilare `<YOUR_API_KEY>`.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "L'agente le legge dal file `.env` accanto a `docker-compose.yml`. Dopo averne cambiata una, applicala con `docker compose up -d` nella cartella con `docker-compose.yml`.",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When the certificate in `xo-ca.pem` is renewed, read it again as in step 3, then run `docker compose up -d --force-recreate`.":
    "Quando il certificato nomina Xen Orchestra con un nome diverso dall'indirizzo in `XO_ADDRESS`, imposta `XO_TLS_SERVER_NAME` su quel nome. Quando il certificato in `xo-ca.pem` viene rinnovato, leggilo di nuovo come nel passaggio 3, poi esegui `docker compose up -d --force-recreate`.",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Eseguili nella cartella dell'agente, quella con `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `xo-ca.pem` stay, and a change you made to either file has to be made again:":
    "**Aggiornamento**: l'immagine del collector è fissata in `docker-compose.yml` e la sua configurazione è un file accanto, quindi scaricare l'immagine non basta a far avanzare l'agente. Scarica di nuovo entrambi i file; il tuo `.env` e `xo-ca.pem` restano, e una modifica che avevi fatto a uno dei file va rifatta:",
  "Then pull the image and recreate the agent, so the collector reads its new config:":
    "Poi scarica l'immagine e ricrea l'agente, perché il collector legga la sua nuova configurazione:",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in the agent's folder): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. Se tutti i pool di questo Xen Orchestra sono Disconnessi, controlla l'agente (nella cartella dell'agente): `docker compose ps` e `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "Il collector scrive nel log `server returned HTTP status 401 Unauthorized`. Copia di nuovo il segreto da *Settings → Plugins → openmetrics*, imposta `XO_OPENMETRICS_SECRET` su di esso in `.env` (tra apici singoli, ogni `$` scritto come `$$`) e applicalo con `docker compose up -d` nella cartella con `docker-compose.yml`. Prima della 6.8, Xen Orchestra creava un nuovo segreto a ogni riavvio.",
};

export default TRANSLATION;
