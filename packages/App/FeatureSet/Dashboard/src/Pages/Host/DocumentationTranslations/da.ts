import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Host setup guide in Danish (#8341): each piece of the English
 * guide's markdown (Pages/Host/Utils/DocumentationMarkdown.ts) and its
 * Danish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Danish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker installed on the host you want to monitor":
    "Docker installeret på den vært, du vil overvåge",
  "Network access from the host to your OneUptime instance":
    "Netværksadgang fra værten til din OneUptime-instans",
  "Save this as `config.yaml` in the directory you will run `docker run` from — step 3 mounts it into the container.":
    "Gem dette som `config.yaml` i den mappe, du kører `docker run` fra — trin 3 monterer den i containeren.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Vælg en indtagelsesnøgle i trin 1 for at udfylde `<YOUR_API_KEY>`.",
  "`--network host`, `--pid host`, and the `/hostfs` bind mount let the `hostmetrics` and `process` scrapers read CPU, memory, disk, and per-process information from the host kernel rather than the container. Without these, you'd only see metrics for the collector container itself.":
    "`--network host`, `--pid host` og bind-monteringen `/hostfs` lader scraperne `hostmetrics` og `process` læse CPU-, hukommelses-, disk- og procesdata fra værtens kerne i stedet for containerens. Uden dem ville du kun se metrikker for selve collector-containeren.",
  "Open the **Hosts** list in OneUptime — your host appears automatically once the first metric batch lands (usually within 30 seconds). Not there? Check the collector:":
    "Åbn listen **Værter** i OneUptime — din vært dukker automatisk op, så snart den første batch metrikker lander (normalt inden for 30 sekunder). Ikke dér? Tjek collectoren:",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer, so add it on Linux hosts only; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**AI-undersøgelser er slået til som standard** for hver vært: Så snart værtens AI-agent kører på den, undersøger OneUptime AI hændelser og alarmer dér med skrivebeskyttede kommandoer som `systemctl status`, `df -h`, `free -m` og `ps aux` og ændrer intet, medmindre du tillader rettelser. Den er en Linux-container med sit eget installationsprogram, så tilføj den kun på Linux-værter; den kræver Docker (systemmotoren, ikke rootless Docker) med Compose-plugin'et:",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. It asks for your OneUptime URL, the ingestion key and the host's name — leave the name empty to use the hostname, which is what this collector reports. Once it connects, it shows as Connected on the host's **AI → AI agent** page and at the bottom of its **Overview**. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#hosts).":
    "Den første linje henter scriptet som `install.sh`, så du kan læse det, før du kører det. Det spørger efter din OneUptime-URL, indtagelsesnøglen og værtens navn — lad navnet stå tomt for at bruge værtsnavnet, som er det, denne collector rapporterer. Når den er forbundet, vises den som forbundet på værtens side **AI → AI-agent** og nederst i dens **Oversigt**. Hvad den må køre, og hvordan rettelser virker: [AI-agenter til infrastruktur](/docs/ai/infrastructure-ai-agents#hosts).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to the `config.yaml` you mounted into the container and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Konfigurationen udfylder allerede maskinens IP-adresser, MAC-adresser, arkitektur, maskin-id, OS-beskrivelse og OS-version på dens element under **Inventar**, som er det, en CMDB-eksport læser. Serienummer, producent, model og firmwareversion (BIOS / UEFI) er anderledes: **ingen ressourcedetektor kan levere dem.** De kommer fra maskinens firmware via DMI. Læs dem én gang ved klargøringen, og skriv dem fast på ressourcen — tilføj denne processor til den `config.yaml`, du har monteret i containeren, og nævn den i metrik-pipelinen. Flet den ind i de sektioner, din konfiguration allerede har — tilføj ikke en ekstra `processors:`- eller `service:`-nøgle.",
  "Then recreate the container so it reads the edited file — remove it, and run the `docker run` command from step 3 again:":
    "Genopret derefter containeren, så den læser den redigerede fil — fjern den, og kør `docker run`-kommandoen fra trin 3 igen:",
  "The values are the machine's own, so they are written once by whatever provisions it. On Linux, read them as root (`bios_version` is readable by anyone):":
    "Værdierne hører til selve maskinen, så de skrives én gang af det, der klargør den. På Linux læser du dem som root (`bios_version` kan læses af alle):",
  "Within a few minutes the values show on the machine's **Inventory** item under **Details**. They are stamped, not detected, so run this again after a motherboard swap or a firmware update.":
    "Inden for få minutter vises værdierne på maskinens element under **Inventar** under **Detaljer**. De er skrevet fast, ikke registreret, så kør dette igen efter et bundkortskift eller en firmwareopdatering.",
  "`host.manufacturer`, `host.model.name`, `host.firmware.version` and `host.bios.version` are accepted as alternative spellings and stored under the `device.*` keys above (and `device.serial_number` under `host.serial_number`), so a config written either way ends up in one place.":
    "`host.manufacturer`, `host.model.name`, `host.firmware.version` og `host.bios.version` accepteres som alternative stavemåder og gemmes under `device.*`-nøglerne ovenfor (og `device.serial_number` under `host.serial_number`), så en konfiguration skrevet på den ene eller den anden måde ender ét sted.",
  "> **Don't set `device.manufacturer` on a mobile app's resource and a host's from the same config.** On a resource that carries no `host.name` or `host.id`, `device.manufacturer` still marks the batch as mobile Real User Monitoring.":
    "> **Sæt ikke `device.manufacturer` på en mobilapps ressource og på en værts fra den samme konfiguration.** På en ressource uden `host.name` eller `host.id` markerer `device.manufacturer` stadig batchen som mobil Real User Monitoring.",
  "Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the host (and to the telemetry service emitted from this collector). Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.":
    "Enhver ressourceattribut med præfikset `oneuptime.label.` bliver til en projektetiket, der knyttes til værten (og til den telemetritjeneste, som denne collector udsender). Mønster: `oneuptime.label.<dimension>=<value>` bliver til en etiket med navnet `<dimension>:<value>`.",
  "Add a `resource` processor to the `config.yaml` you mounted into the container and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Tilføj en `resource`-processor til den `config.yaml`, du har monteret i containeren, og henvis til den fra metrik-pipelinen. Flet den ind i de sektioner, din konfiguration allerede har — tilføj ikke en ekstra `processors:`- eller `service:`-nøgle.",
  "The host shows up tagged `team:payments`, `env:production`, and `region:us-east-1`. Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated. Labels added manually in the OneUptime UI are never removed by the collector.":
    "Værten vises med etiketterne `team:payments`, `env:production` og `region:us-east-1`. Etiketter sammenlignes uden hensyn til store og små bogstaver, så en eksisterende, manuelt oprettet etiket `Production` genbruges i stedet for at blive dubleret. Etiketter, der er tilføjet manuelt i OneUptime-brugerfladen, fjernes aldrig af collectoren.",
  "Hosts are auto-discovered from the OTel `host.name` resource attribute, which the `resourcedetection` processor sets. OneUptime registers the host once a batch that carries `host.name` also carries any of:":
    "Værter opdages automatisk ud fra OTel-ressourceattributten `host.name`, som `resourcedetection`-processoren sætter. OneUptime registrerer værten, så snart en batch med `host.name` også indeholder et af følgende:",
  "- `hostmetrics` receiver metrics (CPU, memory, disk, filesystem, network, load, processes), OR":
    "- metrikker fra `hostmetrics`-receiveren (CPU, hukommelse, disk, filsystem, netværk, belastning, processer), ELLER",
  "- `process` scraper metrics (per-process CPU/memory/threads), OR":
    "- metrikker fra `process`-scraperen (CPU/hukommelse/tråde pr. proces), ELLER",
  "- an `os.type` or `container.runtime` resource attribute, on metrics, logs or traces":
    "- en ressourceattribut `os.type` eller `container.runtime`, på metrikker, logs eller traces",
  "…and starts populating the Overview, Metrics, Processes, and Logs tabs. `host.id` or `host.arch` alone do not register a host, and telemetry that carries a Kubernetes identity (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) is filed under its Kubernetes cluster instead.":
    "…og begynder at udfylde fanerne Oversigt, Metrikker, Processer og Protokoller. `host.id` eller `host.arch` alene registrerer ikke en vært, og telemetri med en Kubernetes-identitet (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) arkiveres i stedet under sin Kubernetes-klynge.",
  "**Running on OpenStack?** Use `detectors: [nova, system, env]`, so `host.id` is the instance's UUID and OneUptime links this host to its instance, and set `host.name` to `enabled: false` under `nova: resource_attributes:` so its name stays the one `system` reports.":
    "**Kører den på OpenStack?** Brug `detectors: [nova, system, env]`, så `host.id` er instansens UUID, og OneUptime knytter denne vært til sin instans, og sæt `host.name` til `enabled: false` under `nova: resource_attributes:`, så dens navn forbliver det, `system` rapporterer.",
  "The same resource attributes become the machine's **Inventory** item, which is what a CMDB export reads. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` and `os.version` all come from the `resourcedetection` processor; serial number, make, model and firmware version have no detector and are stamped on separately (see **Record the serial number, make, model and firmware version**).":
    "De samme ressourceattributter bliver maskinens element under **Inventar**, som er det, en CMDB-eksport læser. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` og `os.version` kommer alle fra `resourcedetection`-processoren; serienummer, producent, model og firmwareversion har ingen detektor og skrives fast separat (se **Registrér serienummer, producent, model og firmwareversion**).",
  "Once the host is reporting:": "Når værten rapporterer:",
  "- The **Metrics** tab visualizes `system.*` time-series.":
    "- Fanen **Metrikker** viser `system.*`-tidsserier.",
  "- The **Processes** tab lists processes ordered by CPU once the `process` scraper is enabled.":
    "- Fanen **Processer** viser processer sorteret efter CPU, så snart `process`-scraperen er slået til.",
  "- The **Logs** tab streams any logs whose resource attributes include `host.name`.":
    "- Fanen **Protokoller** viser løbende alle logs, hvis ressourceattributter indeholder `host.name`.",
  "The config reports the collector release it is for (`oneuptime.agent.version`) as the host's **Agent Version**. When this OneUptime pins a newer release, a warning sign beside it opens these steps.":
    "Konfigurationen rapporterer den collector-udgivelse, den er skrevet til (`oneuptime.agent.version`), som værtens **Agentversion**. Når denne OneUptime fastlåser en nyere udgivelse, åbner et advarselstegn ved siden af disse trin.",
  "1. Save the config from step 2 again, with the same ingestion key: it reports the new version. Copy across any change you made to yours.":
    "1. Gem konfigurationen fra trin 2 igen med den samme indtagelsesnøgle: Den rapporterer den nye version. Overfør enhver ændring, du har lavet i din.",
  "2. In the folder that holds it, install the new release and restart the collector:":
    "2. Installér den nye udgivelse i mappen, der indeholder den, og genstart collectoren:",
  "1. Read the collector's logs for export errors: `docker logs -f otel-collector`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in the `config.yaml` you mounted into the container.":
    "1. Læs collectorens logs for eksportfejl: `docker logs -f otel-collector`. En HTTP-`401` betyder, at nøglen mangler, er forkert eller er udløbet; `422`, at den er deaktiveret (eller er en browsernøgle, som ikke kan sende værtstelemetri). Vælg en nøgle, der virker, i trin 1, og opdatér `x-oneuptime-token` i den `config.yaml`, du har monteret i containeren.",
  "2. Check the host can reach OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` from the same machine.":
    "2. Tjek, at værten kan nå OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` fra samme maskine.",
  "3. Keep `resourcedetection` in the metrics pipeline — it sets `host.name`, which is how OneUptime recognises the host.":
    "3. Behold `resourcedetection` i metrik-pipelinen — den sætter `host.name`, som er det, OneUptime genkender værten på.",
  "The collector is reading its own container's kernel view. Run it with `--network host`, `--pid host`, the `/:/hostfs` bind mount and the `HOST_*` variables exactly as step 3 shows — without them the `hostmetrics` and `process` scrapers only see the collector container itself.":
    "Collectoren læser sin egen containers kernevisning. Kør den med `--network host`, `--pid host`, bind-monteringen `/:/hostfs` og `HOST_*`-variablerne præcis som i trin 3 — uden dem ser scraperne `hostmetrics` og `process` kun selve collector-containeren.",
  "A Debian or Ubuntu host (amd64 or arm64) with `sudo`":
    "En Debian- eller Ubuntu-vært (amd64 eller arm64) med `sudo`",
  "Save this as `config.yaml` in your current directory — step 3 installs it.":
    "Gem dette som `config.yaml` i din aktuelle mappe — trin 3 installerer den.",
  "> **Note for native installs:** Unlike Docker, the package install reads `/proc` and `/sys` directly — no `HOST_PROC` env vars or `/hostfs` mount required. The systemd unit shipped with the package runs as the unprivileged `otelcol-contrib` user; if you want the `process` scraper to see processes owned by other users, grant it `CAP_SYS_PTRACE` or run it as root.":
    "> **Bemærkning til native installationer:** I modsætning til Docker læser pakkeinstallationen `/proc` og `/sys` direkte — ingen `HOST_PROC`-miljøvariabler eller `/hostfs`-montering kræves. Den systemd-enhed, der følger med pakken, kører som den uprivilegerede bruger `otelcol-contrib`; hvis `process`-scraperen skal se andre brugeres processer, så giv den `CAP_SYS_PTRACE`, eller kør den som root.",
  "`otelcol-contrib` has bundled the `systemd` receiver since **v0.142.0**; run **v0.143.0 or newer**, which is where its CPU metric settled on its current name and stopped probing non-service units. Turn it on by adding it to `/etc/otelcol-contrib/config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "`otelcol-contrib` har haft `systemd`-receiveren med siden **v0.142.0**; kør **v0.143.0 eller nyere**, hvor dens CPU-metrik fik sit nuværende navn, og den holdt op med at forespørge enheder, der ikke er tjenester. Slå den til ved at tilføje den til `/etc/otelcol-contrib/config.yaml` og metrik-pipelinen. Flet den ind i de sektioner, din konfiguration allerede har — tilføj ikke en ekstra `processors:`- eller `service:`-nøgle.",
  "Then restart the service:": "Genstart derefter tjenesten:",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so the packaged service — which runs as the `otelcol-contrib` user — needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "Receiveren er **kun til Linux** og **alfa**. Den læser enhedernes tilstand over system-D-Bus med de samme skrivebeskyttede kald som `systemctl list-units`, som systemd tillader uden privilegier, så pakketjenesten — som kører som brugeren `otelcol-contrib` — ikke har brug for ekstra rettigheder. En collector i en container kan ikke nå værtens bus, så brug en native installation. Så snart metrikker ankommer, udfyldes værtens fane **Systemd-enheder** med hver indsamlet enhed og dens aktuelle tilstand (`active`, `failed`, `inactive`, ...).",
  "Each unit costs eight datapoints per scrape for the state set, plus two more if you leave the CPU metric on, so on a host with hundreds of units narrow `units:` or raise `collection_interval` rather than scraping everything.":
    "Hver enhed koster otte datapunkter pr. indsamling til tilstandssættet plus to mere, hvis du lader CPU-metrikken være slået til, så på en vært med hundredvis af enheder bør du indsnævre `units:` eller hæve `collection_interval` i stedet for at indsamle alt.",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**AI-undersøgelser er slået til som standard** for hver vært: Så snart værtens AI-agent kører på den, undersøger OneUptime AI hændelser og alarmer dér med skrivebeskyttede kommandoer som `systemctl status`, `df -h`, `free -m` og `ps aux` og ændrer intet, medmindre du tillader rettelser. Den er en Linux-container med sit eget installationsprogram; den kræver Docker (systemmotoren, ikke rootless Docker) med Compose-plugin'et:",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI, and the packaged collector runs unprivileged, so it cannot read them itself. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Konfigurationen udfylder allerede maskinens IP-adresser, MAC-adresser, arkitektur, maskin-id, OS-beskrivelse og OS-version på dens element under **Inventar**, som er det, en CMDB-eksport læser. Serienummer, producent, model og firmwareversion (BIOS / UEFI) er anderledes: **ingen ressourcedetektor kan levere dem.** De kommer fra maskinens firmware via DMI, og pakke-collectoren kører uden privilegier, så den kan ikke selv læse dem. Læs dem én gang ved klargøringen, og skriv dem fast på ressourcen — tilføj denne processor til `/etc/otelcol-contrib/config.yaml`, og nævn den i metrik-pipelinen. Flet den ind i de sektioner, din konfiguration allerede har — tilføj ikke en ekstra `processors:`- eller `service:`-nøgle.",
  "Add a `resource` processor to `/etc/otelcol-contrib/config.yaml` and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Tilføj en `resource`-processor til `/etc/otelcol-contrib/config.yaml`, og henvis til den fra metrik-pipelinen. Flet den ind i de sektioner, din konfiguration allerede har — tilføj ikke en ekstra `processors:`- eller `service:`-nøgle.",
  "- The **Systemd Units** tab lists unit state once the `systemd` receiver is enabled (see **Enable the Systemd Units tab**).":
    "- Fanen **Systemd-enheder** viser enhedernes tilstand, så snart `systemd`-receiveren er slået til (se **Aktivér fanen Systemd-enheder**).",
  "1. Read the collector's logs for export errors: `sudo journalctl -u otelcol-contrib -f`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `/etc/otelcol-contrib/config.yaml`.":
    "1. Læs collectorens logs for eksportfejl: `sudo journalctl -u otelcol-contrib -f`. En HTTP-`401` betyder, at nøglen mangler, er forkert eller er udløbet; `422`, at den er deaktiveret (eller er en browsernøgle, som ikke kan sende værtstelemetri). Vælg en nøgle, der virker, i trin 1, og opdatér `x-oneuptime-token` i `/etc/otelcol-contrib/config.yaml`.",
  "1. Keep `resourcedetection` in the same metrics pipeline as the `systemd` receiver — the receiver attaches only `systemd.unit.name` to each unit, so without `host.name` the samples never attach to the host.":
    "1. Behold `resourcedetection` i samme metrik-pipeline som `systemd`-receiveren — receiveren knytter kun `systemd.unit.name` til hver enhed, så uden `host.name` bliver målepunkterne aldrig knyttet til værten.",
  "2. Run `otelcol-contrib` v0.143.0 or newer: older builds stop at startup with `'receivers' unknown type: \"systemd\"`, or name the CPU metric differently (see **Enable the Systemd Units tab**).":
    "2. Kør `otelcol-contrib` v0.143.0 eller nyere: Ældre builds stopper ved opstart med `'receivers' unknown type: \"systemd\"` eller navngiver CPU-metrikken anderledes (se **Aktivér fanen Systemd-enheder**).",
  "3. Check the collector can reach the system D-Bus: `/run/dbus/system_bus_socket` must exist, and `systemctl list-units` run as the collector's user is the quickest test. Root is not required.":
    "3. Tjek, at collectoren kan nå system-D-Bus: `/run/dbus/system_bus_socket` skal findes, og `systemctl list-units` kørt som collectorens bruger er den hurtigste test. Root er ikke nødvendig.",
  "A RHEL, CentOS, Fedora or Amazon Linux host (x86_64 or aarch64) with `sudo`":
    "En RHEL-, CentOS-, Fedora- eller Amazon Linux-vært (x86_64 eller aarch64) med `sudo`",
  "A Linux host (x86_64 or aarch64) that runs systemd, with `sudo`":
    "En Linux-vært (x86_64 eller aarch64), der kører systemd, med `sudo`",
  "Drop a systemd unit at `/etc/systemd/system/otelcol-contrib.service`:":
    "Læg en systemd-enhed i `/etc/systemd/system/otelcol-contrib.service`:",
  "Then enable and start it:": "Aktivér og start den derefter:",
  "Use this when packages aren't available — locked-down servers, or container base images you want to instrument from outside. No `HOST_PROC` env vars or `/hostfs` mount are needed: the collector reads kernel state directly, and `User=root` lets the `process` scraper see processes owned by other users (granting `CAP_SYS_PTRACE` instead works too).":
    "Brug dette, når der ikke findes pakker — låste servere eller basisimages til containere, som du vil instrumentere udefra. Der kræves ingen `HOST_PROC`-miljøvariabler eller `/hostfs`-montering: Collectoren læser kernens tilstand direkte, og `User=root` lader `process`-scraperen se andre brugeres processer (at give den `CAP_SYS_PTRACE` virker også).",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so it needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "Receiveren er **kun til Linux** og **alfa**. Den læser enhedernes tilstand over system-D-Bus med de samme skrivebeskyttede kald som `systemctl list-units`, som systemd tillader uden privilegier, så den ikke har brug for ekstra rettigheder. En collector i en container kan ikke nå værtens bus, så brug en native installation. Så snart metrikker ankommer, udfyldes værtens fane **Systemd-enheder** med hver indsamlet enhed og dens aktuelle tilstand (`active`, `failed`, `inactive`, ...).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to `/opt/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Konfigurationen udfylder allerede maskinens IP-adresser, MAC-adresser, arkitektur, maskin-id, OS-beskrivelse og OS-version på dens element under **Inventar**, som er det, en CMDB-eksport læser. Serienummer, producent, model og firmwareversion (BIOS / UEFI) er anderledes: **ingen ressourcedetektor kan levere dem.** De kommer fra maskinens firmware via DMI. Læs dem én gang ved klargøringen, og skriv dem fast på ressourcen — tilføj denne processor til `/opt/otelcol-contrib/config.yaml`, og nævn den i metrik-pipelinen. Flet den ind i de sektioner, din konfiguration allerede har — tilføj ikke en ekstra `processors:`- eller `service:`-nøgle.",
  "A Mac (Apple silicon or Intel) and an administrator account for `sudo`":
    "En Mac (Apple silicon eller Intel) og en administratorkonto til `sudo`",
  "Create `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:":
    "Opret `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:",
  "Load it:": "Indlæs den:",
  "> **Install the contrib build, as above.** The core `otelcol` build has no `resourcedetection` processor, so it refuses to start with this config.":
    "> **Installér contrib-buildet som ovenfor.** Core-buildet `otelcol` har ingen `resourcedetection`-processor, så det nægter at starte med denne konfiguration.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Konfigurationen udfylder allerede maskinens IP-adresser, MAC-adresser, arkitektur, maskin-id, OS-beskrivelse og OS-version på dens element under **Inventar**, som er det, en CMDB-eksport læser. Serienummer, producent, model og firmwareversion (BIOS / UEFI) er anderledes: **ingen ressourcedetektor kan levere dem.** De kommer fra maskinens firmware. Læs dem én gang ved klargøringen, og skriv dem fast på ressourcen — tilføj denne processor til `/etc/otelcol-contrib/config.yaml`, og nævn den i metrik-pipelinen. Flet den ind i de sektioner, din konfiguration allerede har — tilføj ikke en ekstra `processors:`- eller `service:`-nøgle.",
  "Then restart the collector:": "Genstart derefter collectoren:",
  "The values are the machine's own, so they are written once by whatever provisions it. On a Mac, read them like this — the manufacturer is `Apple Inc.`:":
    "Værdierne hører til selve maskinen, så de skrives én gang af det, der klargør den. På en Mac læser du dem sådan — producenten er `Apple Inc.`:",
  "`hw.model` is the model *identifier* (`MacBookPro18,3`), not the marketing name. Put it in `device.model.name` anyway — `device.model.identifier` marks a batch as a mobile app.":
    "`hw.model` er model-*id'et* (`MacBookPro18,3`), ikke salgsnavnet. Sæt det alligevel i `device.model.name` — `device.model.identifier` markerer en batch som en mobilapp.",
  "Windows 10 1803+ or Windows Server 2019+ (for the built-in `tar.exe`)":
    "Windows 10 1803+ eller Windows Server 2019+ (for den indbyggede `tar.exe`)",
  "An elevated PowerShell prompt (Run as administrator)":
    "En PowerShell-prompt med administratorrettigheder (Kør som administrator)",
  "Save this as `config.yaml` in the folder you will run the PowerShell commands from — step 3 copies it into place.":
    "Gem dette som `config.yaml` i den mappe, du kører PowerShell-kommandoerne fra — trin 3 kopierer den på plads.",
  "On Windows, install the upstream **`otelcol-contrib`** collector — from **v0.155.0** it bundles the `windows_service` receiver that powers the host **Services** tab. Run from an elevated PowerShell prompt:":
    "Installér på Windows upstream-collectoren **`otelcol-contrib`** — fra **v0.155.0** har den `windows_service`-receiveren med, som driver værtens fane **Tjenester**. Kør fra en PowerShell-prompt med administratorrettigheder:",
  "> **Note:** The service runs as `LocalSystem` so it can read every Windows service. On Windows the `load` scraper only emulates a load average from the *Processor Queue Length* counter (it starts at 0); if it can't read the counter it is logged and skipped, so the rest of the `hostmetrics` config runs unchanged. The [Host OpenTelemetry Collector docs](/docs/telemetry/host-otel-collector) also cover the signed `.msi` installer.":
    "> **Bemærk:** Tjenesten kører som `LocalSystem`, så den kan læse alle Windows-tjenester. På Windows emulerer `load`-scraperen kun et belastningsgennemsnit ud fra tælleren *Processor Queue Length* (den starter ved 0); kan den ikke læse tælleren, logges det og springes over, og resten af `hostmetrics`-konfigurationen kører uændret. [Dokumentationen for OpenTelemetry Collector til værter](/docs/telemetry/host-otel-collector) dækker også det signerede `.msi`-installationsprogram.",
  "Logs are written to the Windows Application event log; view them in **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`).":
    "Logs skrives i Windows' hændelseslog Program; se dem i **Event Viewer → Windows Logs → Application** (kilde `otelcol-contrib`).",
  "From **v0.155.0** `otelcol-contrib` includes the `windows_service` receiver — turn it on by adding it to `C:\\Program Files\\otelcol-contrib\\config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Fra **v0.155.0** indeholder `otelcol-contrib` `windows_service`-receiveren — slå den til ved at tilføje den til `C:\\Program Files\\otelcol-contrib\\config.yaml` og metrik-pipelinen. Flet den ind i de sektioner, din konfiguration allerede har — tilføj ikke en ekstra `processors:`- eller `service:`-nøgle.",
  "The receiver is **Windows-only** and **alpha**. Once metrics arrive, the host **Services** tab populates automatically with each service's running state and startup type.":
    "Receiveren er **kun til Windows** og **alfa**. Så snart metrikker ankommer, udfyldes værtens fane **Tjenester** automatisk med hver tjenestes kørselstilstand og starttype.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through WMI.":
    "Konfigurationen udfylder allerede maskinens IP-adresser, MAC-adresser, arkitektur, maskin-id, OS-beskrivelse og OS-version på dens element under **Inventar**, som er det, en CMDB-eksport læser. Serienummer, producent, model og firmwareversion (BIOS / UEFI) er anderledes: **ingen ressourcedetektor kan levere dem.** De kommer fra maskinens firmware via WMI.",
  "Run this from an elevated PowerShell prompt on the machine — it queries WMI and prints the exact YAML for *this* machine:":
    "Kør dette fra en PowerShell-prompt med administratorrettigheder på maskinen — det forespørger WMI og udskriver den præcise YAML for *denne* maskine:",
  "It prints one processor entry, already indented. Add it inside the `processors:` block your `config.yaml` already has — alongside `resourcedetection:`, `resource:` and `batch:`, not as a second `processors:` key — then name it in the metrics pipeline:":
    "Det udskriver én processorpost, der allerede er indrykket. Tilføj den i den `processors:`-blok, din `config.yaml` allerede har — ved siden af `resourcedetection:`, `resource:` og `batch:`, ikke som en ekstra `processors:`-nøgle — og nævn den derefter i metrik-pipelinen:",
  "Use `Get-CimInstance`, not the deprecated `Get-WmiObject` — it is absent from PowerShell 7 and later. Values are emitted in single quotes with any embedded quote doubled, so a serial or model containing punctuation stays valid YAML. A field the firmware leaves empty prints as `''`; drop that attribute rather than shipping a blank one.":
    "Brug `Get-CimInstance`, ikke det forældede `Get-WmiObject` — det findes ikke i PowerShell 7 og nyere. Værdierne udskrives i enkelte anførselstegn med indlejrede anførselstegn fordoblet, så et serienummer eller en model med tegnsætning forbliver gyldig YAML. Et felt, som firmwaren efterlader tomt, udskrives som `''`; udelad den attribut i stedet for at sende en tom.",
  "Within a few minutes the machine's **Inventory** item shows `host.serial_number`, `device.manufacturer`, `device.model.name` and `device.firmware.version` under **Details**, alongside the IP and MAC addresses and machine id the detector already supplies. Run this again after a motherboard swap or a BIOS update — the values are stamped, not detected, so they do not update themselves.":
    "Inden for få minutter viser maskinens element under **Inventar** under **Detaljer** `host.serial_number`, `device.manufacturer`, `device.model.name` og `device.firmware.version` sammen med IP- og MAC-adresserne og maskin-id'et, som detektoren allerede leverer. Kør dette igen efter et bundkortskift eller en BIOS-opdatering — værdierne er skrevet fast, ikke registreret, så de opdaterer ikke sig selv.",
  "- The **Services** tab lists each service's state once the `windows_service` receiver is enabled (see **Enable the Windows Services tab**).":
    "- Fanen **Tjenester** viser hver tjenestes tilstand, så snart `windows_service`-receiveren er slået til (se **Aktivér fanen Windows-tjenester**).",
  "1. Read the collector's logs for export errors: **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`). An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `C:\\Program Files\\otelcol-contrib\\config.yaml`.":
    "1. Læs collectorens logs for eksportfejl: **Event Viewer → Windows Logs → Application** (kilde `otelcol-contrib`). En HTTP-`401` betyder, at nøglen mangler, er forkert eller er udløbet; `422`, at den er deaktiveret (eller er en browsernøgle, som ikke kan sende værtstelemetri). Vælg en nøgle, der virker, i trin 1, og opdatér `x-oneuptime-token` i `C:\\Program Files\\otelcol-contrib\\config.yaml`.",
  "1. Run the collector in the foreground to see the real error instead of the generic `Error 1064`:":
    "1. Kør collectoren i forgrunden for at se den egentlige fejl i stedet for den generiske `Error 1064`:",
  '2. `Error 2: The system cannot find the file specified` means the service points at a file that is not there — compare `BINARY_PATH_NAME` from `sc.exe qc "otelcol-contrib"` with the contents of `C:\\Program Files\\otelcol-contrib`. The archive must be the `otelcol-contrib_` one, which unpacks `otelcol-contrib.exe`.':
    '2. `Error 2: The system cannot find the file specified` betyder, at tjenesten peger på en fil, der ikke findes — sammenlign `BINARY_PATH_NAME` fra `sc.exe qc "otelcol-contrib"` med indholdet af `C:\\Program Files\\otelcol-contrib`. Arkivet skal være `otelcol-contrib_`-arkivet, som pakker `otelcol-contrib.exe` ud.',
  "3. **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`) records the startup error the service manager swallowed.":
    "3. **Event Viewer → Windows Logs → Application** (kilde `otelcol-contrib`) registrerer den opstartsfejl, som tjenestestyringen slugte.",
  "If you set `include_services` but still see every service, the collector hasn't picked up the edit — restart the service (`Restart-Service otelcol-contrib`) and give the Services tab a few minutes to refresh its rolling window.":
    "Hvis du sætter `include_services`, men stadig ser alle tjenester, har collectoren ikke fået ændringen med — genstart tjenesten (`Restart-Service otelcol-contrib`), og giv fanen Tjenester et par minutter til at opdatere sit glidende vindue.",
  "Kubernetes nodes are monitored by the **OneUptime Kubernetes agent** rather than a host collector: each node appears under **Kubernetes** → your cluster → **Nodes**, next to its pods and workloads, not in the **Hosts** list. The steps below install the agent on a standard cluster; the install guide in the **Kubernetes** section has the steps for Amazon EKS, Google GKE, Azure AKS, GKE Autopilot and EKS Fargate.":
    "Kubernetes-noder overvåges af **OneUptime Kubernetes-agenten** i stedet for en værts-collector: Hver node vises under **Kubernetes** → din klynge → **Noder**, ved siden af dens pods og workloads, ikke på listen **Værter**. Trinene nedenfor installerer agenten på en standardklynge; installationsvejledningen i sektionen **Kubernetes** har trinene til Amazon EKS, Google GKE, Azure AKS, GKE Autopilot og EKS Fargate.",
  "A Kubernetes cluster running v1.23 or later":
    "En Kubernetes-klynge med v1.23 eller nyere",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` og `helm` (v3) installeret på din maskine",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "Forkert klynge? Skift med `kubectl config use-context <context-name>`.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "Erstat `my-cluster` med et navn til denne klynge, for eksempel `prod-us-east-1`. Det er sådan, klyngen vises i OneUptime, så hold det stabilt: et nyt navn registrerer en ny klynge.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` slår **AI-undersøgelser** til, som chartet gør som standard: OneUptime AI undersøger hændelser og advarsler på denne klynge med skrivebeskyttet kubectl via Kubernetes-AI-agenten.",
  "You should see:": "Du burde se:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Collectoren og Kubernetes-AI-agenten plus én `-logs`- og én `-ebpf`-pod på hver node. Når de er `Running`, vises klyngen automatisk i afsnittet **Kubernetes**, som regel inden for et minut eller to.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Kubernetes-AI-agent (slået til som standard, skrivebeskyttet).** Poden `kubernetes-agent-ai-agent` lader OneUptime AI undersøge hændelser og advarsler på denne klynge med skrivebeskyttet kubectl (`get`, `describe`, `logs`, `events`, `top`) med den samme API-nøgle, og den kan intet ændre, medmindre du senere giver den skriveadgang. Åbn klyngen, og gå til **AI → Agent** for at se den. Vil du ikke have den? Installér med `--set aiAgent.enabled=false` i stedet for `--set aiAgent.enabled=true`.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "Namespace-regler afgør, hvad agenten indsamler fra hvert namespace. For kun at indsamle podlogs og eBPF-data fra `default`, `production` og `staging`:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "For at beholde alt, men stoppe logs fra støjende namespaces, skal du kun udelukke dem fra `podLogs`:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **Omfang:** `podLogs` (containeres stdout/stderr), `ebpfDiscovery` (eBPF-spor og -metrikker), `metrics` (metrikker med namespace) og `traces` (hvert span).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **Mønstre** matcher hele namespace-navnet og accepterer `*`, som i `team-*`. En `exclude`-regel vinder altid over en `include`-regel.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **Egne regler erstatter standardreglen**, som udelukker `kube-system` fra `podLogs` og `ebpfDiscovery`. Behold den på din liste, som i det andet eksempel, hvis du stadig vil have det.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- Node- og klyngemetrikker har intet namespace, så de beholdes altid.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` kræver Helm 3.10 eller nyere.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**Send kun vigtige linjer.** Kassér podloglinjer under en alvorlighed, før de forlader klyngen:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    'Accepterer `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` og `FATAL`: `WARN` beholder advarsler, fejl og fatale linjer. Alvorligheden læses fra selve loglinjen (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes-hændelser kasseres aldrig af dette.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Slå podlogs fra.** Metrikker påvirkes ikke: nodecollectoren kører videre for kubelet- og cAdvisor-metrikker og holder kun op med at læse podlogs:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**Skift, hvordan logs læses.** Presettet vælger det for dig; en udtrykkelig `logs.mode` vinder altid:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: læser `/var/log/pods` på hver node via hostPath (laveste overhead; kræver hostPath).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: et Deployment følger podlogs via Kubernetes-API'et (virker på enhver klynge).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: ingen podlogs.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "Det læser API-serveren, hvor den svarer inde i klyngen. etcd, scheduleren og controller manageren svarer på control plane-noderne, som agentens pod ikke kan gætte, så den læser dem, så snart du angiver hver nodes adresse:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **Scheduleren og controller manageren** leverer HTTPS og accepterer agentens token, men kubeadm binder dem til `127.0.0.1`: giv dem en `--bind-address`, som agentens pod kan nå.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** leverer sine metrikker over almindelig HTTP på kubeadms `--listen-metrics-urls` (port 2381, bundet til `127.0.0.1`, indtil du tilføjer nodens adresse), som ovenfor. Eller aflæs dens HTTPS-klientport, 2379, med det klientcertifikat, den beder om: læg `ca.crt`, `tls.crt` og `tls.key` i en Secret i `oneuptime-agent`, og angiv den i `controlPlane.etcd.clientCertSecret`.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "Kun til selvadministrerede klynger: administrerede tjenester (EKS, GKE, AKS) udstiller ikke deres control plane-metrikker.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "Omkostningsovervågning er slået til som standard: agenten medbringer open source-motoren OpenCost (plus den lille Prometheus, den skal bruge), prissætter dine noder og volumes ud fra din cloududbyders offentlige listepriser, uden legitimationsoplysninger, og sender, hvad hvert namespace og hver workload koster. De første data vises på klyngens oversigt og siden Omkostninger efter den første hele time.",
  "On an agent installed before it was on by default, upgrade it:":
    "Er agenten installeret, før det blev slået til som standard, så opgrader den:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **Slå det fra:** tilføj `--set cost.enabled=false` til samme opgradering.",
  "- **Already running Kubecost or OpenCost?** The agent finds it and reads it instead of the bundled engine, and the cluster's overview says so: add `--set cost.engine.url=auto` to stop bundling a second one.":
    "- **Kører du allerede Kubecost eller OpenCost?** Agenten finder den og læser den i stedet for den medfølgende motor, og klyngens oversigt viser det: tilføj `--set cost.engine.url=auto` for ikke at medbringe en ekstra motor.",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **On-premises eller bare metal?** Angiv en prisliste med `--set cost.opencost.customPricing.enabled=true` (USD pr. ressourcetime; se chartets `values.yaml`).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "Fuld vejledning: [Omkostningsovervågning af Kubernetes](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "Agenten kører [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) på hver node. Den opfanger HTTP/HTTPS-, gRPC- og SQL/Redis-trafik fra tjenester i Go, .NET, Java, Node.js, Python, Ruby og Rust, uden SDK og uden sidecar, og sender spor, anmodningsmetrikker (RED) og data til tjenestegrafen gennem collectoren.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**Krav:** Linux-kerne **5.8+** med BTF (standard på Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). eBPF-poderne kører **privilegeret**, hvilket de har brug for til at indlæse eBPF-programmer.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "**Slå det fra**, hvis dine noder kører en ældre kerne, hvis privilegerede pods ikke er tilladt, eller hvis dine tjenester allerede sender spor med OpenTelemetry-SDK'er, og du ikke vil have dubletter:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**Vælg signalerne.** Hver familie slås til eller fra med `--set ebpf.features.<name>=false` (eller `=true`):",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | Standard | Hvad den tilføjer |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | til | HTTP/gRPC-anmodningsrate, fejl og latens pr. tjeneste |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | til | Antal kald og varighed for spans (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | til | Kanter fra kalder → kaldt; driver tjenestekortet |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | til | Tællere for TCP/UDP-flows fra pod til pod |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | fra | Netværksmetrikker mellem zoner (fordobler deres kardinalitet) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | til | TCP-RTT samt tællere for mislykkede forbindelser og genudsendelser pr. node |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**Sporpropagering på tværs af tjenester** (at samle en anmodning, der går fra pod A → pod B, til ét enkelt spor, også på en anden node) er **slået til som standard**. Den virker ved at omskrive trafik, der allerede er undervejs (den udvider HTTP-anmodninger i klartekst i kernen og føjer en TCP-option til TLS og rå TCP), og en fejl i den byteoptælling bringer datastrømmen ud af takt: Det rapporterede symptom er overførsler gennem en L7-proxy som nginx, der hænger, så snart et svar passerer ~64KB. Hvis du ser det, eller hvis et service mesh begynder at få pods til at fejle, så slå den fra med `--set ebpf.contextPropagation=false`; et OpenTelemetry-SDK propagerer `traceparent` i userspace uden noget af det.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Hver `oneuptime.labels.<key>=<value>` bliver til labelen `<key>:<value>` på klyngen og på de tjenester og værter, den rapporterer. Labels sammenlignes uden hensyn til store og små bogstaver, så en eksisterende label `Production` genbruges; labels, der er tilføjet i OneUptime-brugerfladen, fjernes aldrig af agenten.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**Opgrader** til det nyeste chart. `--reset-then-reuse-values` (Helm 3.14+) beholder de værdier, du har sat (preset, klyngenavn, filtre), og tager alt andet fra det nye chart; tilføj eventuelle nye `--set`-flag oven på det:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "Med Helm 3.13 og ældre skal du i stedet opgradere med de værdier, du har sat:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "Brug ikke `--reuse-values`: det beholder også standardværdierne fra det chart, du opgraderer fra, så et nyere charts standardværdier (blandt andet dets eBPF-image) aldrig træder i kraft.",
  "**Uninstall** the agent and its namespace:":
    "**Afinstallér** agenten og dens namespace:",
  "| Category | Data |": "| Kategori | Data |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **Nodemetrikker** | Brug af CPU, hukommelse, filsystem og netværk |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Pod- og containermetrikker** | CPU, hukommelse, netværks-I/O og genstarter |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **Klyngemetrikker** | Nodetilstande, allokerbare ressourcer, antal pods og workloads |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Kubernetes-hændelser** | Advarsler, fejl og planlægningshændelser |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Podlogs** | stdout/stderr for hver container, læst på hver node |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **Applikationsspor** *(eBPF)* | HTTP-, gRPC- og SQL/Redis-spans fra hver pod, uden SDK eller kodeændringer |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **Anmodningsmetrikker og tjenestegraf** *(eBPF)* | Anmodningsrate, fejl og latens pr. tjeneste samt kanter fra kalder → kaldt til tjenestekortet |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **Netværksflows** *(eBPF)* | Tællere for TCP/UDP-bytes og -pakker fra pod til pod |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **Workloadomkostninger** *(slået til som standard)* | Forbrug pr. namespace, workload og pod med ubrugt kapacitet og effektivitet, også som metrikker at advare på |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "Din klynge blokerer `hostPath`-volumes eller privilegerede pods. Det er normalt på **GKE Autopilot** og **EKS Fargate**: vælg den platform øverst i denne vejledning, og følg dens trin. På **OpenShift** lykkes installationen derimod, men agentens nodepods starter aldrig: vælg **Red Hat OpenShift**.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "På enhver anden klynge med en restriktiv Pod Security-politik skal du fjerne den mislykkede release:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "Kør derefter installationskommandoen igen med `--set preset=gke-autopilot` tilføjet. Det preset læser podlogs via Kubernetes-API'et i stedet for hostPath, anvender en skærpet sikkerhedskontekst og udelader de privilegerede eBPF- og profilerings-pods.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. Tjek, at agentens pods kører: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. Tjek collectorens logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. Bekræft, at OneUptime-URL'en og indtagelsesnøglen i installationskommandoen er korrekte.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. Sørg for, at klyngen kan nå din OneUptime-instans over netværket.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. Tjek AI-agentens pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. Tjek dens logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. Ingen pod? Opgrader chartet (se **Opgrader eller afinstaller agenten** under Avanceret), og tilføj `--set aiAgent.enabled=true`.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. Tjek, at klyngenavnet passer: denne vejledning installerer **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. Bekræft agentens RBAC-tilladelser: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Kig efter eksportfejl i collectorens logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **Kernen er for gammel eller uden BTF.** eBPF kræver Linux 5.8+ med BTF; tjek det med `uname -r` på en node. Kan du ikke opgradere, så slå eBPF fra med `--set ebpf.enabled=false`.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **Privilegerede pods blokeret.** Nogle aflåste klynger afviser dem. Slå eBPF fra.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` er ikke tilgængelige på værten.** Slå kun familien med TCP-statistik fra: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. Tjek, at eBPF-poderne er sunde: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. Slå OBI's debugoutput til for at bekræfte, at den ser trafik: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, og læs derefter `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Hvis spans dukker op dér, men ikke i OneUptime, så kig efter eksportfejl i collectorens logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
};

export default TRANSLATION;
