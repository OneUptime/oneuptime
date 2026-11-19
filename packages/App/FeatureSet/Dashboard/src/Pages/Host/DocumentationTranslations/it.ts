import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Host setup guide in Italian (#8341): each piece of the English
 * guide's markdown (Pages/Host/Utils/DocumentationMarkdown.ts) and its
 * Italian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Italian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker installed on the host you want to monitor":
    "Docker installato sull'host da monitorare",
  "Network access from the host to your OneUptime instance":
    "Accesso di rete dall'host alla tua istanza OneUptime",
  "Save this as `config.yaml` in the directory you will run `docker run` from — step 3 mounts it into the container.":
    "Salva questo file come `config.yaml` nella directory da cui eseguirai `docker run`: il passaggio 3 lo monta nel container.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Scegli una chiave di acquisizione nel passaggio 1 per compilare `<YOUR_API_KEY>`.",
  "`--network host`, `--pid host`, and the `/hostfs` bind mount let the `hostmetrics` and `process` scrapers read CPU, memory, disk, and per-process information from the host kernel rather than the container. Without these, you'd only see metrics for the collector container itself.":
    "`--network host`, `--pid host` e il bind mount `/hostfs` permettono agli scraper `hostmetrics` e `process` di leggere i dati di CPU, memoria, disco e dei singoli processi dal kernel dell'host invece che dal container. Senza di essi vedresti solo le metriche del container del collector stesso.",
  "Open the **Hosts** list in OneUptime — your host appears automatically once the first metric batch lands (usually within 30 seconds). Not there? Check the collector:":
    "Apri l'elenco **Host** in OneUptime: il tuo host compare automaticamente appena arriva il primo batch di metriche (di solito entro 30 secondi). Non c'è? Controlla il collector:",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer, so add it on Linux hosts only; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**Le indagini IA sono attive per impostazione predefinita** per ogni host: quando l'agente IA dell'host gira su di esso, OneUptime AI vi indaga su incidenti e avvisi con comandi in sola lettura come `systemctl status`, `df -h`, `free -m` e `ps aux`, e non cambia nulla finché non consenti le correzioni. È un container Linux con un proprio installer, quindi aggiungilo solo sugli host Linux; richiede Docker (il motore di sistema, non Docker rootless) con il plugin Compose:",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. It asks for your OneUptime URL, the ingestion key and the host's name — leave the name empty to use the hostname, which is what this collector reports. Once it connects, it shows as Connected on the host's **AI → AI agent** page and at the bottom of its **Overview**. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#hosts).":
    "La prima riga scarica lo script come `install.sh`, così puoi leggerlo prima di eseguirlo. Chiede l'URL di OneUptime, la chiave di acquisizione e il nome dell'host: lascia vuoto il nome per usare il nome host, che è quello che riporta questo collector. Una volta connesso, risulta connesso nella pagina **IA → Agente IA** dell'host e in fondo alla sua **Panoramica**. Cosa può eseguire e come funzionano le correzioni: [Agenti IA per l'infrastruttura](/docs/ai/infrastructure-ai-agents#hosts).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to the `config.yaml` you mounted into the container and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "La configurazione inserisce già indirizzi IP, indirizzi MAC, architettura, ID della macchina, descrizione e versione del sistema operativo nell'elemento della macchina in **Inventario**, quello che legge un'esportazione CMDB. Numero di serie, produttore, modello e versione del firmware (BIOS / UEFI) sono diversi: **nessun rilevatore di risorse può fornirli.** Provengono dal firmware della macchina, tramite DMI. Leggili una volta al provisioning e apponili sulla risorsa: aggiungi questo processore a il `config.yaml` che hai montato nel container e indicalo nella pipeline delle metriche. Uniscilo alle sezioni che la tua configurazione ha già: non aggiungere una seconda chiave `processors:` o `service:`.",
  "Then recreate the container so it reads the edited file — remove it, and run the `docker run` command from step 3 again:":
    "Poi ricrea il container perché legga il file modificato: rimuovilo ed esegui di nuovo il comando `docker run` del passaggio 3:",
  "The values are the machine's own, so they are written once by whatever provisions it. On Linux, read them as root (`bios_version` is readable by anyone):":
    "I valori sono propri della macchina, quindi li scrive una volta chi la predispone. Su Linux, leggili come root (`bios_version` è leggibile da chiunque):",
  "Within a few minutes the values show on the machine's **Inventory** item under **Details**. They are stamped, not detected, so run this again after a motherboard swap or a firmware update.":
    "Entro pochi minuti i valori compaiono nell'elemento della macchina in **Inventario**, sotto **Dettagli**. Sono apposti, non rilevati, quindi riesegui questo dopo una sostituzione della scheda madre o un aggiornamento del firmware.",
  "`host.manufacturer`, `host.model.name`, `host.firmware.version` and `host.bios.version` are accepted as alternative spellings and stored under the `device.*` keys above (and `device.serial_number` under `host.serial_number`), so a config written either way ends up in one place.":
    "`host.manufacturer`, `host.model.name`, `host.firmware.version` e `host.bios.version` sono accettati come grafie alternative e salvati sotto le chiavi `device.*` qui sopra (e `device.serial_number` sotto `host.serial_number`), così una configurazione scritta nell'uno o nell'altro modo finisce nello stesso posto.",
  "> **Don't set `device.manufacturer` on a mobile app's resource and a host's from the same config.** On a resource that carries no `host.name` or `host.id`, `device.manufacturer` still marks the batch as mobile Real User Monitoring.":
    "> **Non impostare `device.manufacturer` sulla risorsa di un'app mobile e su quella di un host dalla stessa configurazione.** Su una risorsa senza `host.name` né `host.id`, `device.manufacturer` contrassegna comunque il batch come Real User Monitoring mobile.",
  "Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the host (and to the telemetry service emitted from this collector). Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.":
    "Ogni attributo di risorsa con il prefisso `oneuptime.label.` diventa un'etichetta di progetto associata all'host (e al servizio di telemetria emesso da questo collector). Schema: `oneuptime.label.<dimension>=<value>` diventa un'etichetta chiamata `<dimension>:<value>`.",
  "Add a `resource` processor to the `config.yaml` you mounted into the container and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Aggiungi un processore `resource` a il `config.yaml` che hai montato nel container e richiamalo dalla pipeline delle metriche. Uniscilo alle sezioni che la tua configurazione ha già: non aggiungere una seconda chiave `processors:` o `service:`.",
  "The host shows up tagged `team:payments`, `env:production`, and `region:us-east-1`. Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated. Labels added manually in the OneUptime UI are never removed by the collector.":
    "L'host compare con le etichette `team:payments`, `env:production` e `region:us-east-1`. Le etichette vengono confrontate senza distinguere maiuscole e minuscole, quindi un'etichetta `Production` già creata a mano viene riusata invece che duplicata. Il collector non rimuove mai le etichette aggiunte a mano nell'interfaccia di OneUptime.",
  "Hosts are auto-discovered from the OTel `host.name` resource attribute, which the `resourcedetection` processor sets. OneUptime registers the host once a batch that carries `host.name` also carries any of:":
    "Gli host vengono rilevati automaticamente dall'attributo di risorsa OTel `host.name`, che imposta il processore `resourcedetection`. OneUptime registra l'host appena un batch che contiene `host.name` contiene anche uno di questi:",
  "- `hostmetrics` receiver metrics (CPU, memory, disk, filesystem, network, load, processes), OR":
    "- metriche del receiver `hostmetrics` (CPU, memoria, disco, file system, rete, carico, processi), OPPURE",
  "- `process` scraper metrics (per-process CPU/memory/threads), OR":
    "- metriche dello scraper `process` (CPU/memoria/thread per processo), OPPURE",
  "- an `os.type` or `container.runtime` resource attribute, on metrics, logs or traces":
    "- un attributo di risorsa `os.type` o `container.runtime`, su metriche, log o tracce",
  "…and starts populating the Overview, Metrics, Processes, and Logs tabs. `host.id` or `host.arch` alone do not register a host, and telemetry that carries a Kubernetes identity (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) is filed under its Kubernetes cluster instead.":
    "…e inizia a riempire le schede Panoramica, Metriche, Processi e Log. `host.id` o `host.arch` da soli non registrano un host, e la telemetria che porta un'identità Kubernetes (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) viene archiviata invece sotto il suo cluster Kubernetes.",
  "**Running on OpenStack?** Use `detectors: [nova, system, env]`, so `host.id` is the instance's UUID and OneUptime links this host to its instance, and set `host.name` to `enabled: false` under `nova: resource_attributes:` so its name stays the one `system` reports.":
    "**Gira su OpenStack?** Usa `detectors: [nova, system, env]`, così `host.id` è l'UUID dell'istanza e OneUptime collega questo host alla sua istanza, e imposta `host.name` su `enabled: false` sotto `nova: resource_attributes:` perché il suo nome resti quello che riporta `system`.",
  "The same resource attributes become the machine's **Inventory** item, which is what a CMDB export reads. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` and `os.version` all come from the `resourcedetection` processor; serial number, make, model and firmware version have no detector and are stamped on separately (see **Record the serial number, make, model and firmware version**).":
    "Gli stessi attributi di risorsa diventano l'elemento della macchina in **Inventario**, quello che legge un'esportazione CMDB. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` e `os.version` vengono tutti dal processore `resourcedetection`; numero di serie, produttore, modello e versione del firmware non hanno un rilevatore e vengono apposti a parte (vedi **Registra numero di serie, produttore, modello e versione del firmware**).",
  "Once the host is reporting:": "Quando l'host invia dati:",
  "- The **Metrics** tab visualizes `system.*` time-series.":
    "- La scheda **Metriche** mostra le serie temporali `system.*`.",
  "- The **Processes** tab lists processes ordered by CPU once the `process` scraper is enabled.":
    "- La scheda **Processi** elenca i processi ordinati per CPU appena lo scraper `process` è attivo.",
  "- The **Logs** tab streams any logs whose resource attributes include `host.name`.":
    "- La scheda **Log** mostra in diretta tutti i log i cui attributi di risorsa includono `host.name`.",
  "The config reports the collector release it is for (`oneuptime.agent.version`) as the host's **Agent Version**. When this OneUptime pins a newer release, a warning sign beside it opens these steps.":
    "La configurazione riporta la release del collector per cui è scritta (`oneuptime.agent.version`) come **Versione dell'agente** dell'host. Quando questo OneUptime fissa una release più recente, un segnale di avviso accanto apre questi passaggi.",
  "1. Save the config from step 2 again, with the same ingestion key: it reports the new version. Copy across any change you made to yours.":
    "1. Salva di nuovo la configurazione del passaggio 2, con la stessa chiave di acquisizione: riporta la nuova versione. Riporta nella tua ogni modifica che avevi fatto.",
  "2. In the folder that holds it, install the new release and restart the collector:":
    "2. Nella cartella che la contiene, installa la nuova release e riavvia il collector:",
  "1. Read the collector's logs for export errors: `docker logs -f otel-collector`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in the `config.yaml` you mounted into the container.":
    "1. Leggi i log del collector per trovare errori di esportazione: `docker logs -f otel-collector`. Un HTTP `401` indica che la chiave manca, è errata o è scaduta; `422` che è stata disattivata (o che è una chiave del browser, che non può inviare telemetria degli host). Scegli una chiave funzionante nel passaggio 1 e aggiorna `x-oneuptime-token` in il `config.yaml` che hai montato nel container.",
  "2. Check the host can reach OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` from the same machine.":
    "2. Verifica che l'host raggiunga OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` dalla stessa macchina.",
  "3. Keep `resourcedetection` in the metrics pipeline — it sets `host.name`, which is how OneUptime recognises the host.":
    "3. Mantieni `resourcedetection` nella pipeline delle metriche: imposta `host.name`, che è il modo in cui OneUptime riconosce l'host.",
  "The collector is reading its own container's kernel view. Run it with `--network host`, `--pid host`, the `/:/hostfs` bind mount and the `HOST_*` variables exactly as step 3 shows — without them the `hostmetrics` and `process` scrapers only see the collector container itself.":
    "Il collector sta leggendo la vista del kernel del proprio container. Eseguilo con `--network host`, `--pid host`, il bind mount `/:/hostfs` e le variabili `HOST_*` esattamente come mostra il passaggio 3: senza di essi gli scraper `hostmetrics` e `process` vedono solo il container del collector.",
  "A Debian or Ubuntu host (amd64 or arm64) with `sudo`":
    "Un host Debian o Ubuntu (amd64 o arm64) con `sudo`",
  "Save this as `config.yaml` in your current directory — step 3 installs it.":
    "Salva questo file come `config.yaml` nella directory corrente: il passaggio 3 lo installa.",
  "> **Note for native installs:** Unlike Docker, the package install reads `/proc` and `/sys` directly — no `HOST_PROC` env vars or `/hostfs` mount required. The systemd unit shipped with the package runs as the unprivileged `otelcol-contrib` user; if you want the `process` scraper to see processes owned by other users, grant it `CAP_SYS_PTRACE` or run it as root.":
    "> **Nota per le installazioni native:** a differenza di Docker, l'installazione da pacchetto legge `/proc` e `/sys` direttamente, senza variabili d'ambiente `HOST_PROC` né mount `/hostfs`. L'unità systemd fornita con il pacchetto gira come utente non privilegiato `otelcol-contrib`; se vuoi che lo scraper `process` veda i processi di altri utenti, concedigli `CAP_SYS_PTRACE` o eseguilo come root.",
  "`otelcol-contrib` has bundled the `systemd` receiver since **v0.142.0**; run **v0.143.0 or newer**, which is where its CPU metric settled on its current name and stopped probing non-service units. Turn it on by adding it to `/etc/otelcol-contrib/config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "`otelcol-contrib` include il receiver `systemd` dalla **v0.142.0**; usa la **v0.143.0 o successiva**, in cui la sua metrica CPU ha preso il nome attuale e ha smesso di interrogare le unità che non sono servizi. Attivalo aggiungendolo a `/etc/otelcol-contrib/config.yaml` e alla pipeline delle metriche. Uniscilo alle sezioni che la tua configurazione ha già: non aggiungere una seconda chiave `processors:` o `service:`.",
  "Then restart the service:": "Poi riavvia il servizio:",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so the packaged service — which runs as the `otelcol-contrib` user — needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "Il receiver è **solo per Linux** e in **alpha**. Legge lo stato delle unità tramite il D-Bus di sistema con le stesse chiamate in sola lettura di `systemctl list-units`, che systemd consente senza privilegi, quindi il servizio del pacchetto, che gira come utente `otelcol-contrib`, non ha bisogno di permessi aggiuntivi. Un collector in container non raggiunge il bus dell'host, quindi usa un'installazione nativa. Appena arrivano le metriche, la scheda **Unità systemd** dell'host si riempie con ogni unità raccolta e il suo stato attuale (`active`, `failed`, `inactive`, ...).",
  "Each unit costs eight datapoints per scrape for the state set, plus two more if you leave the CPU metric on, so on a host with hundreds of units narrow `units:` or raise `collection_interval` rather than scraping everything.":
    "Ogni unità costa otto punti dati per raccolta per l'insieme degli stati, più due se lasci attiva la metrica CPU, quindi su un host con centinaia di unità restringi `units:` o aumenta `collection_interval` invece di raccogliere tutto.",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**Le indagini IA sono attive per impostazione predefinita** per ogni host: quando l'agente IA dell'host gira su di esso, OneUptime AI vi indaga su incidenti e avvisi con comandi in sola lettura come `systemctl status`, `df -h`, `free -m` e `ps aux`, e non cambia nulla finché non consenti le correzioni. È un container Linux con un proprio installer; richiede Docker (il motore di sistema, non Docker rootless) con il plugin Compose:",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI, and the packaged collector runs unprivileged, so it cannot read them itself. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "La configurazione inserisce già indirizzi IP, indirizzi MAC, architettura, ID della macchina, descrizione e versione del sistema operativo nell'elemento della macchina in **Inventario**, quello che legge un'esportazione CMDB. Numero di serie, produttore, modello e versione del firmware (BIOS / UEFI) sono diversi: **nessun rilevatore di risorse può fornirli.** Provengono dal firmware della macchina, tramite DMI, e il collector del pacchetto gira senza privilegi, quindi non può leggerli da solo. Leggili una volta al provisioning e apponili sulla risorsa: aggiungi questo processore a `/etc/otelcol-contrib/config.yaml` e indicalo nella pipeline delle metriche. Uniscilo alle sezioni che la tua configurazione ha già: non aggiungere una seconda chiave `processors:` o `service:`.",
  "Add a `resource` processor to `/etc/otelcol-contrib/config.yaml` and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Aggiungi un processore `resource` a `/etc/otelcol-contrib/config.yaml` e richiamalo dalla pipeline delle metriche. Uniscilo alle sezioni che la tua configurazione ha già: non aggiungere una seconda chiave `processors:` o `service:`.",
  "- The **Systemd Units** tab lists unit state once the `systemd` receiver is enabled (see **Enable the Systemd Units tab**).":
    "- La scheda **Unità systemd** elenca lo stato delle unità appena il receiver `systemd` è attivo (vedi **Attiva la scheda Unità systemd**).",
  "1. Read the collector's logs for export errors: `sudo journalctl -u otelcol-contrib -f`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `/etc/otelcol-contrib/config.yaml`.":
    "1. Leggi i log del collector per trovare errori di esportazione: `sudo journalctl -u otelcol-contrib -f`. Un HTTP `401` indica che la chiave manca, è errata o è scaduta; `422` che è stata disattivata (o che è una chiave del browser, che non può inviare telemetria degli host). Scegli una chiave funzionante nel passaggio 1 e aggiorna `x-oneuptime-token` in `/etc/otelcol-contrib/config.yaml`.",
  "1. Keep `resourcedetection` in the same metrics pipeline as the `systemd` receiver — the receiver attaches only `systemd.unit.name` to each unit, so without `host.name` the samples never attach to the host.":
    "1. Mantieni `resourcedetection` nella stessa pipeline delle metriche del receiver `systemd`: il receiver associa a ogni unità solo `systemd.unit.name`, quindi senza `host.name` i campioni non vengono mai collegati all'host.",
  "2. Run `otelcol-contrib` v0.143.0 or newer: older builds stop at startup with `'receivers' unknown type: \"systemd\"`, or name the CPU metric differently (see **Enable the Systemd Units tab**).":
    "2. Usa `otelcol-contrib` v0.143.0 o successivo: le build precedenti si fermano all'avvio con `'receivers' unknown type: \"systemd\"`, oppure chiamano diversamente la metrica CPU (vedi **Attiva la scheda Unità systemd**).",
  "3. Check the collector can reach the system D-Bus: `/run/dbus/system_bus_socket` must exist, and `systemctl list-units` run as the collector's user is the quickest test. Root is not required.":
    "3. Verifica che il collector raggiunga il D-Bus di sistema: `/run/dbus/system_bus_socket` deve esistere, e `systemctl list-units` eseguito con l'utente del collector è il test più rapido. Root non è necessario.",
  "A RHEL, CentOS, Fedora or Amazon Linux host (x86_64 or aarch64) with `sudo`":
    "Un host RHEL, CentOS, Fedora o Amazon Linux (x86_64 o aarch64) con `sudo`",
  "A Linux host (x86_64 or aarch64) that runs systemd, with `sudo`":
    "Un host Linux (x86_64 o aarch64) con systemd e `sudo`",
  "Drop a systemd unit at `/etc/systemd/system/otelcol-contrib.service`:":
    "Crea un'unità systemd in `/etc/systemd/system/otelcol-contrib.service`:",
  "Then enable and start it:": "Poi abilitala e avviala:",
  "Use this when packages aren't available — locked-down servers, or container base images you want to instrument from outside. No `HOST_PROC` env vars or `/hostfs` mount are needed: the collector reads kernel state directly, and `User=root` lets the `process` scraper see processes owned by other users (granting `CAP_SYS_PTRACE` instead works too).":
    "Usa questo metodo quando i pacchetti non sono disponibili: server blindati o immagini base di container che vuoi strumentare dall'esterno. Non servono variabili d'ambiente `HOST_PROC` né il mount `/hostfs`: il collector legge direttamente lo stato del kernel, e `User=root` permette allo scraper `process` di vedere i processi di altri utenti (funziona anche concedere `CAP_SYS_PTRACE`).",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so it needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "Il receiver è **solo per Linux** e in **alpha**. Legge lo stato delle unità tramite il D-Bus di sistema con le stesse chiamate in sola lettura di `systemctl list-units`, che systemd consente senza privilegi, quindi non ha bisogno di permessi aggiuntivi. Un collector in container non raggiunge il bus dell'host, quindi usa un'installazione nativa. Appena arrivano le metriche, la scheda **Unità systemd** dell'host si riempie con ogni unità raccolta e il suo stato attuale (`active`, `failed`, `inactive`, ...).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to `/opt/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "La configurazione inserisce già indirizzi IP, indirizzi MAC, architettura, ID della macchina, descrizione e versione del sistema operativo nell'elemento della macchina in **Inventario**, quello che legge un'esportazione CMDB. Numero di serie, produttore, modello e versione del firmware (BIOS / UEFI) sono diversi: **nessun rilevatore di risorse può fornirli.** Provengono dal firmware della macchina, tramite DMI. Leggili una volta al provisioning e apponili sulla risorsa: aggiungi questo processore a `/opt/otelcol-contrib/config.yaml` e indicalo nella pipeline delle metriche. Uniscilo alle sezioni che la tua configurazione ha già: non aggiungere una seconda chiave `processors:` o `service:`.",
  "A Mac (Apple silicon or Intel) and an administrator account for `sudo`":
    "Un Mac (Apple silicon o Intel) e un account amministratore per `sudo`",
  "Create `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:":
    "Crea `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:",
  "Load it:": "Caricalo:",
  "> **Install the contrib build, as above.** The core `otelcol` build has no `resourcedetection` processor, so it refuses to start with this config.":
    "> **Installa la build contrib, come sopra.** La build core `otelcol` non ha il processore `resourcedetection`, quindi si rifiuta di avviarsi con questa configurazione.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "La configurazione inserisce già indirizzi IP, indirizzi MAC, architettura, ID della macchina, descrizione e versione del sistema operativo nell'elemento della macchina in **Inventario**, quello che legge un'esportazione CMDB. Numero di serie, produttore, modello e versione del firmware (BIOS / UEFI) sono diversi: **nessun rilevatore di risorse può fornirli.** Provengono dal firmware della macchina. Leggili una volta al provisioning e apponili sulla risorsa: aggiungi questo processore a `/etc/otelcol-contrib/config.yaml` e indicalo nella pipeline delle metriche. Uniscilo alle sezioni che la tua configurazione ha già: non aggiungere una seconda chiave `processors:` o `service:`.",
  "Then restart the collector:": "Poi riavvia il collector:",
  "The values are the machine's own, so they are written once by whatever provisions it. On a Mac, read them like this — the manufacturer is `Apple Inc.`:":
    "I valori sono propri della macchina, quindi li scrive una volta chi la predispone. Su un Mac, leggili così (il produttore è `Apple Inc.`):",
  "`hw.model` is the model *identifier* (`MacBookPro18,3`), not the marketing name. Put it in `device.model.name` anyway — `device.model.identifier` marks a batch as a mobile app.":
    "`hw.model` è l'*identificativo* del modello (`MacBookPro18,3`), non il nome commerciale. Mettilo comunque in `device.model.name`: `device.model.identifier` contrassegna un batch come app mobile.",
  "Windows 10 1803+ or Windows Server 2019+ (for the built-in `tar.exe`)":
    "Windows 10 1803+ o Windows Server 2019+ (per il `tar.exe` integrato)",
  "An elevated PowerShell prompt (Run as administrator)":
    "Un prompt di PowerShell con privilegi elevati (Esegui come amministratore)",
  "Save this as `config.yaml` in the folder you will run the PowerShell commands from — step 3 copies it into place.":
    "Salva questo file come `config.yaml` nella cartella da cui eseguirai i comandi PowerShell: il passaggio 3 lo copia al suo posto.",
  "On Windows, install the upstream **`otelcol-contrib`** collector — from **v0.155.0** it bundles the `windows_service` receiver that powers the host **Services** tab. Run from an elevated PowerShell prompt:":
    "Su Windows, installa il collector upstream **`otelcol-contrib`**: dalla **v0.155.0** include il receiver `windows_service` che alimenta la scheda **Servizi** dell'host. Esegui da un prompt di PowerShell con privilegi elevati:",
  "> **Note:** The service runs as `LocalSystem` so it can read every Windows service. On Windows the `load` scraper only emulates a load average from the *Processor Queue Length* counter (it starts at 0); if it can't read the counter it is logged and skipped, so the rest of the `hostmetrics` config runs unchanged. The [Host OpenTelemetry Collector docs](/docs/telemetry/host-otel-collector) also cover the signed `.msi` installer.":
    "> **Nota:** il servizio gira come `LocalSystem` per poter leggere ogni servizio Windows. Su Windows lo scraper `load` si limita a emulare un carico medio dal contatore *Processor Queue Length* (parte da 0); se non riesce a leggere il contatore lo registra nel log e lo salta, e il resto della configurazione `hostmetrics` funziona senza cambiamenti. La [documentazione dell'OpenTelemetry Collector per host](/docs/telemetry/host-otel-collector) tratta anche l'installer `.msi` firmato.",
  "Logs are written to the Windows Application event log; view them in **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`).":
    "I log vengono scritti nel log degli eventi Applicazione di Windows; consultali in **Event Viewer → Windows Logs → Application** (origine `otelcol-contrib`).",
  "From **v0.155.0** `otelcol-contrib` includes the `windows_service` receiver — turn it on by adding it to `C:\\Program Files\\otelcol-contrib\\config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Dalla **v0.155.0** `otelcol-contrib` include il receiver `windows_service`: attivalo aggiungendolo a `C:\\Program Files\\otelcol-contrib\\config.yaml` e alla pipeline delle metriche. Uniscilo alle sezioni che la tua configurazione ha già: non aggiungere una seconda chiave `processors:` o `service:`.",
  "The receiver is **Windows-only** and **alpha**. Once metrics arrive, the host **Services** tab populates automatically with each service's running state and startup type.":
    "Il receiver è **solo per Windows** e in **alpha**. Appena arrivano le metriche, la scheda **Servizi** dell'host si riempie automaticamente con lo stato di esecuzione e il tipo di avvio di ogni servizio.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through WMI.":
    "La configurazione inserisce già indirizzi IP, indirizzi MAC, architettura, ID della macchina, descrizione e versione del sistema operativo nell'elemento della macchina in **Inventario**, quello che legge un'esportazione CMDB. Numero di serie, produttore, modello e versione del firmware (BIOS / UEFI) sono diversi: **nessun rilevatore di risorse può fornirli.** Provengono dal firmware della macchina, tramite WMI.",
  "Run this from an elevated PowerShell prompt on the machine — it queries WMI and prints the exact YAML for *this* machine:":
    "Esegui questo da un prompt di PowerShell con privilegi elevati sulla macchina: interroga WMI e stampa lo YAML esatto per *questa* macchina:",
  "It prints one processor entry, already indented. Add it inside the `processors:` block your `config.yaml` already has — alongside `resourcedetection:`, `resource:` and `batch:`, not as a second `processors:` key — then name it in the metrics pipeline:":
    "Stampa una voce di processore, già indentata. Aggiungila dentro il blocco `processors:` che il tuo `config.yaml` ha già, accanto a `resourcedetection:`, `resource:` e `batch:`, non come seconda chiave `processors:`, poi indicala nella pipeline delle metriche:",
  "Use `Get-CimInstance`, not the deprecated `Get-WmiObject` — it is absent from PowerShell 7 and later. Values are emitted in single quotes with any embedded quote doubled, so a serial or model containing punctuation stays valid YAML. A field the firmware leaves empty prints as `''`; drop that attribute rather than shipping a blank one.":
    "Usa `Get-CimInstance`, non il deprecato `Get-WmiObject`, assente da PowerShell 7 in poi. I valori sono emessi tra virgolette singole, con ogni virgoletta interna raddoppiata, così un numero di serie o un modello con segni di punteggiatura resta YAML valido. Un campo che il firmware lascia vuoto viene stampato come `''`; togli quell'attributo invece di inviarne uno vuoto.",
  "Within a few minutes the machine's **Inventory** item shows `host.serial_number`, `device.manufacturer`, `device.model.name` and `device.firmware.version` under **Details**, alongside the IP and MAC addresses and machine id the detector already supplies. Run this again after a motherboard swap or a BIOS update — the values are stamped, not detected, so they do not update themselves.":
    "Entro pochi minuti l'elemento della macchina in **Inventario** mostra sotto **Dettagli** `host.serial_number`, `device.manufacturer`, `device.model.name` e `device.firmware.version`, accanto agli indirizzi IP e MAC e all'ID della macchina che il rilevatore fornisce già. Riesegui questo dopo una sostituzione della scheda madre o un aggiornamento del BIOS: i valori sono apposti, non rilevati, quindi non si aggiornano da soli.",
  "- The **Services** tab lists each service's state once the `windows_service` receiver is enabled (see **Enable the Windows Services tab**).":
    "- La scheda **Servizi** elenca lo stato di ogni servizio appena il receiver `windows_service` è attivo (vedi **Attiva la scheda Servizi Windows**).",
  "1. Read the collector's logs for export errors: **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`). An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `C:\\Program Files\\otelcol-contrib\\config.yaml`.":
    "1. Leggi i log del collector per trovare errori di esportazione: **Event Viewer → Windows Logs → Application** (origine `otelcol-contrib`). Un HTTP `401` indica che la chiave manca, è errata o è scaduta; `422` che è stata disattivata (o che è una chiave del browser, che non può inviare telemetria degli host). Scegli una chiave funzionante nel passaggio 1 e aggiorna `x-oneuptime-token` in `C:\\Program Files\\otelcol-contrib\\config.yaml`.",
  "1. Run the collector in the foreground to see the real error instead of the generic `Error 1064`:":
    "1. Esegui il collector in primo piano per vedere l'errore reale invece del generico `Error 1064`:",
  '2. `Error 2: The system cannot find the file specified` means the service points at a file that is not there — compare `BINARY_PATH_NAME` from `sc.exe qc "otelcol-contrib"` with the contents of `C:\\Program Files\\otelcol-contrib`. The archive must be the `otelcol-contrib_` one, which unpacks `otelcol-contrib.exe`.':
    '2. `Error 2: The system cannot find the file specified` indica che il servizio punta a un file che non esiste: confronta `BINARY_PATH_NAME` di `sc.exe qc "otelcol-contrib"` con il contenuto di `C:\\Program Files\\otelcol-contrib`. L\'archivio deve essere quello `otelcol-contrib_`, che estrae `otelcol-contrib.exe`.',
  "3. **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`) records the startup error the service manager swallowed.":
    "3. **Event Viewer → Windows Logs → Application** (origine `otelcol-contrib`) registra l'errore di avvio che il gestore dei servizi ha inghiottito.",
  "If you set `include_services` but still see every service, the collector hasn't picked up the edit — restart the service (`Restart-Service otelcol-contrib`) and give the Services tab a few minutes to refresh its rolling window.":
    "Se imposti `include_services` ma vedi ancora tutti i servizi, il collector non ha recepito la modifica: riavvia il servizio (`Restart-Service otelcol-contrib`) e lascia alla scheda Servizi qualche minuto per aggiornare la sua finestra mobile.",
  "Kubernetes nodes are monitored by the **OneUptime Kubernetes agent** rather than a host collector: each node appears under **Kubernetes** → your cluster → **Nodes**, next to its pods and workloads, not in the **Hosts** list. The steps below install the agent on a standard cluster; the install guide in the **Kubernetes** section has the steps for Amazon EKS, Google GKE, Azure AKS, GKE Autopilot and EKS Fargate.":
    "I nodi Kubernetes sono monitorati dall'**agente Kubernetes di OneUptime** invece che da un collector per host: ogni nodo compare in **Kubernetes** → il tuo cluster → **Nodi**, accanto ai suoi pod e workload, non nell'elenco **Host**. I passaggi qui sotto installano l'agente su un cluster standard; la guida di installazione nella sezione **Kubernetes** ha i passaggi per Amazon EKS, Google GKE, Azure AKS, GKE Autopilot ed EKS Fargate.",
  "A Kubernetes cluster running v1.23 or later":
    "Un cluster Kubernetes con v1.23 o successiva",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` e `helm` (v3) installati sul tuo computer",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "Cluster sbagliato? Cambia con `kubectl config use-context <context-name>`.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "Sostituisci `my-cluster` con un nome per questo cluster, ad esempio `prod-us-east-1`. È così che il cluster compare in OneUptime, quindi mantienilo stabile: un nuovo nome registra un nuovo cluster.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` attiva le **indagini IA**, come fa il chart per impostazione predefinita: OneUptime AI indaga su incidenti e avvisi di questo cluster con kubectl in sola lettura, tramite l'agente IA di Kubernetes.",
  "You should see:": "Dovresti vedere:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Il collector e l'agente IA di Kubernetes, più un pod `-logs` e un pod `-ebpf` su ogni nodo. Quando sono `Running`, il cluster compare automaticamente nella sezione **Kubernetes**, di solito entro un paio di minuti.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Agente IA di Kubernetes (attivo per impostazione predefinita, in sola lettura).** Il pod `kubernetes-agent-ai-agent` permette a OneUptime AI di indagare su incidenti e avvisi di questo cluster con kubectl in sola lettura (`get`, `describe`, `logs`, `events`, `top`), con la stessa chiave API, e non può cambiare nulla a meno che in seguito tu non gli dia accesso in scrittura. Apri il cluster e vai in **IA → Agente** per vederlo. Non lo vuoi? Installa con `--set aiAgent.enabled=false` invece di `--set aiAgent.enabled=true`.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "Le regole dei namespace decidono cosa raccoglie l'agente da ogni namespace. Per raccogliere log dei pod e dati eBPF solo da `default`, `production` e `staging`:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "Per tenere tutto ma fermare i log dei namespace rumorosi, escludili solo da `podLogs`:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **Ambiti:** `podLogs` (stdout/stderr dei container), `ebpfDiscovery` (tracce e metriche eBPF), `metrics` (metriche dei namespace) e `traces` (ogni span).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- I **pattern** corrispondono all'intero nome del namespace e accettano `*`, come in `team-*`. Una regola `exclude` prevale sempre su una regola `include`.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **Impostare le regole sostituisce quella predefinita**, che esclude `kube-system` da `podLogs` ed `ebpfDiscovery`. Tienila nel tuo elenco, come nel secondo esempio, se la vuoi ancora.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- Le metriche di nodo e di cluster non hanno namespace, quindi vengono sempre mantenute.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` richiede Helm 3.10 o successivo.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**Invia solo le righe importanti.** Scarta le righe di log dei pod sotto una certa gravità prima che lascino il cluster:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    'Accetta `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` e `FATAL`: `WARN` tiene avvisi, errori e righe fatali. La gravità viene letta dalla riga di log stessa (`[ERROR]`, `level=warn`, `"level":"info"`). Gli eventi di Kubernetes non vengono mai scartati da questa impostazione.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Disattiva i log dei pod.** Le metriche non ne risentono: il collector dei nodi continua a funzionare per le metriche di kubelet e cAdvisor, smette solo di leggere i log dei pod:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**Cambia il modo in cui vengono letti i log.** Il preset lo sceglie per te; un `logs.mode` esplicito prevale sempre:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: legge `/var/log/pods` su ogni nodo tramite hostPath (il minor overhead; richiede hostPath).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: un Deployment segue i log dei pod tramite l'API di Kubernetes (funziona su qualsiasi cluster).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: nessun log dei pod.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "Così viene letto l'API server, dove risponde all'interno del cluster. etcd, lo scheduler e il controller manager rispondono sui nodi del control plane, che il pod dell'agente non può indovinare, quindi li legge appena indichi l'indirizzo di ogni nodo:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **Lo scheduler e il controller manager** servono HTTPS e accettano il token dell'agente, ma kubeadm li associa a `127.0.0.1`: dai loro un `--bind-address` raggiungibile dal pod dell'agente.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** serve le sue metriche in HTTP semplice sulle `--listen-metrics-urls` di kubeadm (porta 2381, associata a `127.0.0.1` finché non aggiungi l'indirizzo del nodo), come sopra. Oppure interroga la sua porta client HTTPS, 2379, con il certificato client che richiede: metti `ca.crt`, `tls.crt` e `tls.key` in un Secret in `oneuptime-agent` e indicalo in `controlPlane.etcd.clientCertSecret`.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "Solo per i cluster autogestiti: i servizi gestiti (EKS, GKE, AKS) non espongono le metriche del loro control plane.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "Il monitoraggio dei costi è attivo per impostazione predefinita: l'agente include il motore open source OpenCost (più il piccolo Prometheus di cui ha bisogno), assegna un prezzo a nodi e volumi in base ai listini pubblici del tuo provider cloud, senza credenziali, e invia quanto costa ogni namespace e ogni workload. I primi dati compaiono nella panoramica del cluster e nella sua pagina Costi dopo la prima ora completa.",
  "On an agent installed before it was on by default, upgrade it:":
    "Se il tuo agente è stato installato prima che fosse attivo per impostazione predefinita, aggiornalo:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **Per disattivarlo:** aggiungi `--set cost.enabled=false` allo stesso aggiornamento.",
  "- **Already running Kubecost or OpenCost?** The agent finds it and reads it instead of the bundled engine, and the cluster's overview says so: add `--set cost.engine.url=auto` to stop bundling a second one.":
    "- **Usi già Kubecost o OpenCost?** L'agente lo trova e lo legge al posto del motore incluso, e la panoramica del cluster lo indica: aggiungi `--set cost.engine.url=auto` per non includerne più un secondo.",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **On-premise o bare metal?** Imposta un listino con `--set cost.opencost.customPricing.enabled=true` (USD per ora di risorsa; vedi il `values.yaml` del chart).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "Guida completa: [Osservabilità dei costi di Kubernetes](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "L'agente esegue [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) su ogni nodo. Cattura il traffico HTTP/HTTPS, gRPC e SQL/Redis dei servizi Go, .NET, Java, Node.js, Python, Ruby e Rust, senza SDK né sidecar, e invia tracce, metriche delle richieste (RED) e dati del grafo dei servizi tramite il collector.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**Requisiti:** kernel Linux **5.8+** con BTF (il predefinito su Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). I pod eBPF girano in modalità **privilegiata**, che serve loro per caricare programmi eBPF.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "**Disattivalo** se i tuoi nodi hanno un kernel più vecchio, se i pod privilegiati non sono consentiti o se i tuoi servizi inviano già tracce con gli SDK di OpenTelemetry e non vuoi duplicati:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**Scegli i segnali.** Ogni famiglia si attiva o disattiva con `--set ebpf.features.<name>=false` (o `=true`):",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | Predefinito | Cosa aggiunge |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | attivo | Frequenza delle richieste HTTP/gRPC, errori e latenza per servizio |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | attivo | Numero di chiamate e durata degli span (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | attivo | Archi chiamante → chiamato; alimenta la mappa dei servizi |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | attivo | Contatori dei flussi TCP/UDP da pod a pod |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | disattivo | Metriche di rete tra zone (ne raddoppia la cardinalità) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | attivo | RTT TCP e contatori di connessioni non riuscite e ritrasmissioni per nodo |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "La **propagazione delle tracce tra servizi** (collegare in un'unica traccia una richiesta che va dal pod A → pod B, anche su un altro nodo) è **attiva per impostazione predefinita**. Funziona riscrivendo il traffico già in transito (ampliando nel kernel le richieste HTTP in chiaro e aggiungendo un'opzione TCP a TLS e al TCP grezzo), e un errore in questo conteggio dei byte desincronizza il flusso: il sintomo segnalato sono trasferimenti attraverso un proxy L7 come nginx che si bloccano appena una risposta supera ~64KB. Se lo vedi, o se una service mesh inizia a far fallire i pod, disattivala con `--set ebpf.contextPropagation=false`; un SDK di OpenTelemetry propaga `traceparent` nello spazio utente senza nulla di tutto ciò.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Ogni `oneuptime.labels.<key>=<value>` diventa l'etichetta `<key>:<value>` sul cluster e sui servizi e host che riporta. Le etichette vengono confrontate senza distinguere maiuscole e minuscole, quindi un'etichetta `Production` esistente viene riutilizzata; l'agente non rimuove mai le etichette aggiunte nell'interfaccia di OneUptime.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**Aggiorna** al chart più recente. `--reset-then-reuse-values` (Helm 3.14+) mantiene i valori che hai impostato (preset, nome del cluster, filtri) e prende tutto il resto dal nuovo chart; aggiungi sopra eventuali nuovi flag `--set`:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "Con Helm 3.13 e precedenti, aggiorna invece con i valori che hai impostato:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "Non usare `--reuse-values`: mantiene anche i valori predefiniti del chart da cui aggiorni, così i valori predefiniti di un chart più recente (tra cui la sua immagine eBPF) non si applicano mai.",
  "**Uninstall** the agent and its namespace:":
    "**Disinstalla** l'agente e il suo namespace:",
  "| Category | Data |": "| Categoria | Dati |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **Metriche dei nodi** | Uso di CPU, memoria, filesystem e rete |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Metriche di pod e container** | CPU, memoria, I/O di rete e riavvii |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **Metriche del cluster** | Condizioni dei nodi, risorse allocabili, numero di pod e workload |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Eventi di Kubernetes** | Avvisi, errori ed eventi di pianificazione |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Log dei pod** | stdout/stderr di ogni container, letti su ogni nodo |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **Tracce delle applicazioni** *(eBPF)* | Span HTTP, gRPC e SQL/Redis da ogni pod, senza SDK né modifiche al codice |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **Metriche delle richieste e grafo dei servizi** *(eBPF)* | Frequenza delle richieste, errori e latenza per servizio, e archi chiamante → chiamato per la mappa dei servizi |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **Flussi di rete** *(eBPF)* | Contatori di byte e pacchetti TCP/UDP da pod a pod |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **Costi dei workload** *(attivi per impostazione predefinita)* | Spesa per namespace, workload e pod, con capacità inutilizzata ed efficienza, anche come metriche su cui generare avvisi |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "Il tuo cluster blocca i volumi `hostPath` o i pod privilegiati. È normale su **GKE Autopilot** ed **EKS Fargate**: scegli quella piattaforma in cima a questa guida e segui i suoi passaggi. Su **OpenShift** invece l'installazione riesce, ma i pod di nodo dell'agente non si avviano mai: scegli **Red Hat OpenShift**.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "Su qualsiasi altro cluster con una policy Pod Security restrittiva, rimuovi la release non riuscita:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "Poi esegui di nuovo il comando di installazione aggiungendo `--set preset=gke-autopilot`. Quel preset legge i log dei pod tramite l'API di Kubernetes invece di hostPath, applica un contesto di sicurezza rafforzato e lascia fuori i pod privilegiati di eBPF e di profiling.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. Verifica che i pod dell'agente siano in esecuzione: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. Controlla i log del collector: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. Verifica che l'URL di OneUptime e la chiave di acquisizione nel comando di installazione siano corretti.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. Assicurati che il cluster possa raggiungere la tua istanza di OneUptime attraverso la rete.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. Controlla il pod dell'agente IA: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. Controlla i suoi log: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. Nessun pod? Aggiorna il chart (vedi **Aggiorna o disinstalla l'agente** in Avanzato) e aggiungi `--set aiAgent.enabled=true`.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. Verifica che il nome del cluster corrisponda: questa guida installa **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. Verifica i permessi RBAC dell'agente: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Cerca errori di esportazione nei log del collector: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **Kernel troppo vecchio o senza BTF.** eBPF richiede Linux 5.8+ con BTF; verificalo con `uname -r` su un nodo. Se non puoi aggiornare, disattiva eBPF con `--set ebpf.enabled=false`.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **Pod privilegiati bloccati.** Alcuni cluster blindati li rifiutano. Disattiva eBPF.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` non disponibili sull'host.** Disattiva solo la famiglia delle statistiche TCP: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. Verifica che i pod eBPF siano integri: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. Attiva l'output di debug di OBI per confermare che veda traffico: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, poi leggi `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Se gli span compaiono lì ma non in OneUptime, cerca errori di esportazione nei log del collector: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
};

export default TRANSLATION;
