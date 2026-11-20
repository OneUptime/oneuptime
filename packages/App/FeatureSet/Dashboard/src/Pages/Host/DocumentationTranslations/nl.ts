import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Host setup guide in Dutch (#8341): each piece of the English
 * guide's markdown (Pages/Host/Utils/DocumentationMarkdown.ts) and its
 * Dutch. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Dutch words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker installed on the host you want to monitor":
    "Docker geïnstalleerd op de host die je wilt bewaken",
  "Network access from the host to your OneUptime instance":
    "Netwerktoegang van de host naar je OneUptime-instantie",
  "Save this as `config.yaml` in the directory you will run `docker run` from — step 3 mounts it into the container.":
    "Sla dit op als `config.yaml` in de map waaruit je `docker run` uitvoert — stap 3 koppelt het in de container.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Kies in stap 1 een ingestiesleutel om `<YOUR_API_KEY>` in te vullen.",
  "`--network host`, `--pid host`, and the `/hostfs` bind mount let the `hostmetrics` and `process` scrapers read CPU, memory, disk, and per-process information from the host kernel rather than the container. Without these, you'd only see metrics for the collector container itself.":
    "Met `--network host`, `--pid host` en de bind-mount `/hostfs` lezen de scrapers `hostmetrics` en `process` CPU-, geheugen-, schijf- en procesgegevens uit de kernel van de host in plaats van uit de container. Zonder deze opties zou je alleen metrieken van de collectorcontainer zelf zien.",
  "Open the **Hosts** list in OneUptime — your host appears automatically once the first metric batch lands (usually within 30 seconds). Not there? Check the collector:":
    "Open de lijst **Hosts** in OneUptime — je host verschijnt automatisch zodra de eerste batch metrieken binnenkomt (meestal binnen 30 seconden). Niet te zien? Controleer de collector:",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer, so add it on Linux hosts only; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**AI-onderzoeken staan standaard aan** voor elke host: zodra de Host AI-agent erop draait, onderzoekt OneUptime AI daar incidenten en waarschuwingen met alleen-lezen opdrachten zoals `systemctl status`, `df -h`, `free -m` en `ps aux`, en verandert niets tenzij je oplossingen toestaat. Het is een Linux-container met een eigen installatieprogramma, voeg het dus alleen toe op Linux-hosts; het heeft Docker nodig (de systeem-engine, niet rootless Docker) met de Compose-plugin:",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. It asks for your OneUptime URL, the ingestion key and the host's name — leave the name empty to use the hostname, which is what this collector reports. Once it connects, it shows as Connected on the host's **AI → AI agent** page and at the bottom of its **Overview**. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#hosts).":
    "De eerste regel downloadt het script als `install.sh`, zodat je het kunt lezen voordat je het uitvoert. Het vraagt om je OneUptime-URL, de ingestiesleutel en de naam van de host — laat de naam leeg om de hostnaam te gebruiken, die deze collector meldt. Zodra het verbonden is, staat het als verbonden op de pagina **AI → AI-agent** van de host en onderaan het **Overzicht**. Wat het mag uitvoeren en hoe oplossingen werken: [AI-agents voor infrastructuur](/docs/ai/infrastructure-ai-agents#hosts).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to the `config.yaml` you mounted into the container and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "De configuratie vult de IP-adressen, MAC-adressen, architectuur, machine-ID, OS-beschrijving en OS-versie van de machine al in op haar item in **Inventaris**, dat is wat een CMDB-export leest. Serienummer, fabrikant, model en firmwareversie (BIOS / UEFI) zijn anders: **geen enkele resourcedetector kan ze leveren.** Ze komen uit de firmware van de machine, via DMI. Lees ze eenmalig uit bij het inrichten en zet ze vast op de resource — voeg deze processor toe aan de `config.yaml` die je in de container hebt gekoppeld en noem hem in de metriekpipeline. Voeg hem samen met de secties die je configuratie al heeft — voeg geen tweede `processors:`- of `service:`-sleutel toe.",
  "Then recreate the container so it reads the edited file — remove it, and run the `docker run` command from step 3 again:":
    "Maak de container daarna opnieuw aan zodat hij het bewerkte bestand leest — verwijder hem en voer de `docker run`-opdracht uit stap 3 opnieuw uit:",
  "The values are the machine's own, so they are written once by whatever provisions it. On Linux, read them as root (`bios_version` is readable by anyone):":
    "De waarden horen bij de machine zelf en worden dus eenmalig geschreven door wat haar inricht. Lees ze op Linux als root (`bios_version` is voor iedereen leesbaar):",
  "Within a few minutes the values show on the machine's **Inventory** item under **Details**. They are stamped, not detected, so run this again after a motherboard swap or a firmware update.":
    "Binnen een paar minuten staan de waarden op het item van de machine in **Inventaris** onder **Details**. Ze zijn vastgezet, niet gedetecteerd, dus voer dit opnieuw uit na een moederbordwissel of een firmware-update.",
  "`host.manufacturer`, `host.model.name`, `host.firmware.version` and `host.bios.version` are accepted as alternative spellings and stored under the `device.*` keys above (and `device.serial_number` under `host.serial_number`), so a config written either way ends up in one place.":
    "`host.manufacturer`, `host.model.name`, `host.firmware.version` en `host.bios.version` worden als alternatieve schrijfwijzen geaccepteerd en opgeslagen onder de `device.*`-sleutels hierboven (en `device.serial_number` onder `host.serial_number`), zodat een configuratie die op de ene of de andere manier is geschreven op één plek uitkomt.",
  "> **Don't set `device.manufacturer` on a mobile app's resource and a host's from the same config.** On a resource that carries no `host.name` or `host.id`, `device.manufacturer` still marks the batch as mobile Real User Monitoring.":
    "> **Stel `device.manufacturer` niet vanuit dezelfde configuratie in op de resource van een mobiele app en op die van een host.** Op een resource zonder `host.name` of `host.id` markeert `device.manufacturer` de batch nog steeds als mobiele Real User Monitoring.",
  "Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the host (and to the telemetry service emitted from this collector). Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.":
    "Elk resource-attribuut met het voorvoegsel `oneuptime.label.` wordt een projectlabel dat aan de host wordt gekoppeld (en aan de telemetrieservice die deze collector uitzendt). Patroon: `oneuptime.label.<dimension>=<value>` wordt een label met de naam `<dimension>:<value>`.",
  "Add a `resource` processor to the `config.yaml` you mounted into the container and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Voeg een `resource`-processor toe aan de `config.yaml` die je in de container hebt gekoppeld en verwijs ernaar vanuit de metriekpipeline. Voeg hem samen met de secties die je configuratie al heeft — voeg geen tweede `processors:`- of `service:`-sleutel toe.",
  "The host shows up tagged `team:payments`, `env:production`, and `region:us-east-1`. Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated. Labels added manually in the OneUptime UI are never removed by the collector.":
    "De host verschijnt met de labels `team:payments`, `env:production` en `region:us-east-1`. Labels worden hoofdletterongevoelig vergeleken, dus een bestaand, handmatig aangemaakt label `Production` wordt hergebruikt in plaats van verdubbeld. Labels die handmatig in de OneUptime-interface zijn toegevoegd, verwijdert de collector nooit.",
  "Hosts are auto-discovered from the OTel `host.name` resource attribute, which the `resourcedetection` processor sets. OneUptime registers the host once a batch that carries `host.name` also carries any of:":
    "Hosts worden automatisch ontdekt aan de hand van het OTel-resource-attribuut `host.name`, dat de `resourcedetection`-processor instelt. OneUptime registreert de host zodra een batch met `host.name` ook een van deze bevat:",
  "- `hostmetrics` receiver metrics (CPU, memory, disk, filesystem, network, load, processes), OR":
    "- metrieken van de `hostmetrics`-receiver (CPU, geheugen, schijf, bestandssysteem, netwerk, belasting, processen), OF",
  "- `process` scraper metrics (per-process CPU/memory/threads), OR":
    "- metrieken van de `process`-scraper (CPU/geheugen/threads per proces), OF",
  "- an `os.type` or `container.runtime` resource attribute, on metrics, logs or traces":
    "- een resource-attribuut `os.type` of `container.runtime`, op metrieken, logs of traces",
  "…and starts populating the Overview, Metrics, Processes, and Logs tabs. `host.id` or `host.arch` alone do not register a host, and telemetry that carries a Kubernetes identity (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) is filed under its Kubernetes cluster instead.":
    "…en begint de tabbladen Overzicht, Metrieken, Processen en Logboeken te vullen. `host.id` of `host.arch` alleen registreren geen host, en telemetrie met een Kubernetes-identiteit (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) komt in plaats daarvan onder zijn Kubernetes-cluster terecht.",
  "**Running on OpenStack?** Use `detectors: [nova, system, env]`, so `host.id` is the instance's UUID and OneUptime links this host to its instance, and set `host.name` to `enabled: false` under `nova: resource_attributes:` so its name stays the one `system` reports.":
    "**Draai je op OpenStack?** Gebruik `detectors: [nova, system, env]`, zodat `host.id` de UUID van de instantie is en OneUptime deze host aan zijn instantie koppelt, en zet `host.name` op `enabled: false` onder `nova: resource_attributes:`, zodat de naam blijft wat `system` meldt.",
  "The same resource attributes become the machine's **Inventory** item, which is what a CMDB export reads. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` and `os.version` all come from the `resourcedetection` processor; serial number, make, model and firmware version have no detector and are stamped on separately (see **Record the serial number, make, model and firmware version**).":
    "Dezelfde resource-attributen vormen het item van de machine in **Inventaris**, dat is wat een CMDB-export leest. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` en `os.version` komen allemaal van de `resourcedetection`-processor; serienummer, fabrikant, model en firmwareversie hebben geen detector en worden apart vastgezet (zie **Serienummer, fabrikant, model en firmwareversie vastleggen**).",
  "Once the host is reporting:": "Zodra de host gegevens meldt:",
  "- The **Metrics** tab visualizes `system.*` time-series.":
    "- Het tabblad **Metrieken** toont `system.*`-tijdreeksen.",
  "- The **Processes** tab lists processes ordered by CPU once the `process` scraper is enabled.":
    "- Het tabblad **Processen** toont processen gesorteerd op CPU zodra de `process`-scraper is ingeschakeld.",
  "- The **Logs** tab streams any logs whose resource attributes include `host.name`.":
    "- Het tabblad **Logboeken** toont live alle logs waarvan de resource-attributen `host.name` bevatten.",
  "The config reports the collector release it is for (`oneuptime.agent.version`) as the host's **Agent Version**. When this OneUptime pins a newer release, a warning sign beside it opens these steps.":
    "De configuratie meldt de collectorrelease waarvoor ze bedoeld is (`oneuptime.agent.version`) als de **Agentversie** van de host. Zet deze OneUptime een nieuwere release vast, dan opent een waarschuwingsteken ernaast deze stappen.",
  "1. Save the config from step 2 again, with the same ingestion key: it reports the new version. Copy across any change you made to yours.":
    "1. Sla de configuratie uit stap 2 opnieuw op, met dezelfde ingestiesleutel: ze meldt de nieuwe versie. Neem elke wijziging over die je in de jouwe had gemaakt.",
  "2. In the folder that holds it, install the new release and restart the collector:":
    "2. Installeer in de map waarin ze staat de nieuwe release en herstart de collector:",
  "1. Read the collector's logs for export errors: `docker logs -f otel-collector`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in the `config.yaml` you mounted into the container.":
    "1. Bekijk de logs van de collector op exportfouten: `docker logs -f otel-collector`. Een HTTP-`401` betekent dat de sleutel ontbreekt, verkeerd of verlopen is; `422` dat hij is uitgeschakeld (of een browsersleutel is, die geen hosttelemetrie kan versturen). Kies in stap 1 een werkende sleutel en werk `x-oneuptime-token` bij in de `config.yaml` die je in de container hebt gekoppeld.",
  "2. Check the host can reach OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` from the same machine.":
    "2. Controleer of de host OneUptime kan bereiken: `curl -v <YOUR_ONEUPTIME_URL>/otlp` vanaf dezelfde machine.",
  "3. Keep `resourcedetection` in the metrics pipeline — it sets `host.name`, which is how OneUptime recognises the host.":
    "3. Houd `resourcedetection` in de metriekpipeline — die stelt `host.name` in, waaraan OneUptime de host herkent.",
  "The collector is reading its own container's kernel view. Run it with `--network host`, `--pid host`, the `/:/hostfs` bind mount and the `HOST_*` variables exactly as step 3 shows — without them the `hostmetrics` and `process` scrapers only see the collector container itself.":
    "De collector leest de kernelweergave van zijn eigen container. Voer hem uit met `--network host`, `--pid host`, de bind-mount `/:/hostfs` en de `HOST_*`-variabelen precies zoals stap 3 laat zien — zonder die opties zien de scrapers `hostmetrics` en `process` alleen de collectorcontainer zelf.",
  "A Debian or Ubuntu host (amd64 or arm64) with `sudo`":
    "Een Debian- of Ubuntu-host (amd64 of arm64) met `sudo`",
  "Save this as `config.yaml` in your current directory — step 3 installs it.":
    "Sla dit op als `config.yaml` in je huidige map — stap 3 installeert het.",
  "> **Note for native installs:** Unlike Docker, the package install reads `/proc` and `/sys` directly — no `HOST_PROC` env vars or `/hostfs` mount required. The systemd unit shipped with the package runs as the unprivileged `otelcol-contrib` user; if you want the `process` scraper to see processes owned by other users, grant it `CAP_SYS_PTRACE` or run it as root.":
    "> **Opmerking voor native installaties:** anders dan bij Docker leest de pakketinstallatie `/proc` en `/sys` rechtstreeks — geen `HOST_PROC`-omgevingsvariabelen of `/hostfs`-mount nodig. De systemd-unit die met het pakket wordt meegeleverd, draait als de gebruiker `otelcol-contrib` zonder rechten; wil je dat de `process`-scraper processen van andere gebruikers ziet, geef hem dan `CAP_SYS_PTRACE` of voer hem uit als root.",
  "`otelcol-contrib` has bundled the `systemd` receiver since **v0.142.0**; run **v0.143.0 or newer**, which is where its CPU metric settled on its current name and stopped probing non-service units. Turn it on by adding it to `/etc/otelcol-contrib/config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "`otelcol-contrib` bevat de `systemd`-receiver sinds **v0.142.0**; gebruik **v0.143.0 of nieuwer**, waarin zijn CPU-metriek zijn huidige naam kreeg en hij stopte met het opvragen van units die geen service zijn. Schakel hem in door hem toe te voegen aan `/etc/otelcol-contrib/config.yaml` en aan de metriekpipeline. Voeg hem samen met de secties die je configuratie al heeft — voeg geen tweede `processors:`- of `service:`-sleutel toe.",
  "Then restart the service:": "Herstart daarna de service:",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so the packaged service — which runs as the `otelcol-contrib` user — needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "De receiver is **alleen voor Linux** en **alfa**. Hij leest de status van units via de systeem-D-Bus met dezelfde alleen-lezen aanroepen als `systemctl list-units`, die systemd zonder rechten toestaat, zodat de pakketservice — die als de gebruiker `otelcol-contrib` draait — geen extra rechten nodig heeft. Een collector in een container kan de bus van de host niet bereiken, gebruik dus een native installatie. Zodra er metrieken binnenkomen, vult het tabblad **Systemd-units** van de host zich met elke verzamelde unit en zijn huidige status (`active`, `failed`, `inactive`, ...).",
  "Each unit costs eight datapoints per scrape for the state set, plus two more if you leave the CPU metric on, so on a host with hundreds of units narrow `units:` or raise `collection_interval` rather than scraping everything.":
    "Elke unit kost per verzameling acht datapunten voor de statusset, plus twee als je de CPU-metriek aan laat; beperk op een host met honderden units dus `units:` of verhoog `collection_interval` in plaats van alles te verzamelen.",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**AI-onderzoeken staan standaard aan** voor elke host: zodra de Host AI-agent erop draait, onderzoekt OneUptime AI daar incidenten en waarschuwingen met alleen-lezen opdrachten zoals `systemctl status`, `df -h`, `free -m` en `ps aux`, en verandert niets tenzij je oplossingen toestaat. Het is een Linux-container met een eigen installatieprogramma; het heeft Docker nodig (de systeem-engine, niet rootless Docker) met de Compose-plugin:",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI, and the packaged collector runs unprivileged, so it cannot read them itself. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "De configuratie vult de IP-adressen, MAC-adressen, architectuur, machine-ID, OS-beschrijving en OS-versie van de machine al in op haar item in **Inventaris**, dat is wat een CMDB-export leest. Serienummer, fabrikant, model en firmwareversie (BIOS / UEFI) zijn anders: **geen enkele resourcedetector kan ze leveren.** Ze komen uit de firmware van de machine, via DMI, en de pakketcollector draait zonder rechten, dus hij kan ze niet zelf lezen. Lees ze eenmalig uit bij het inrichten en zet ze vast op de resource — voeg deze processor toe aan `/etc/otelcol-contrib/config.yaml` en noem hem in de metriekpipeline. Voeg hem samen met de secties die je configuratie al heeft — voeg geen tweede `processors:`- of `service:`-sleutel toe.",
  "Add a `resource` processor to `/etc/otelcol-contrib/config.yaml` and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Voeg een `resource`-processor toe aan `/etc/otelcol-contrib/config.yaml` en verwijs ernaar vanuit de metriekpipeline. Voeg hem samen met de secties die je configuratie al heeft — voeg geen tweede `processors:`- of `service:`-sleutel toe.",
  "- The **Systemd Units** tab lists unit state once the `systemd` receiver is enabled (see **Enable the Systemd Units tab**).":
    "- Het tabblad **Systemd-units** toont de status van units zodra de `systemd`-receiver is ingeschakeld (zie **Het tabblad Systemd-units inschakelen**).",
  "1. Read the collector's logs for export errors: `sudo journalctl -u otelcol-contrib -f`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `/etc/otelcol-contrib/config.yaml`.":
    "1. Bekijk de logs van de collector op exportfouten: `sudo journalctl -u otelcol-contrib -f`. Een HTTP-`401` betekent dat de sleutel ontbreekt, verkeerd of verlopen is; `422` dat hij is uitgeschakeld (of een browsersleutel is, die geen hosttelemetrie kan versturen). Kies in stap 1 een werkende sleutel en werk `x-oneuptime-token` bij in `/etc/otelcol-contrib/config.yaml`.",
  "1. Keep `resourcedetection` in the same metrics pipeline as the `systemd` receiver — the receiver attaches only `systemd.unit.name` to each unit, so without `host.name` the samples never attach to the host.":
    "1. Houd `resourcedetection` in dezelfde metriekpipeline als de `systemd`-receiver — de receiver hangt aan elke unit alleen `systemd.unit.name`, dus zonder `host.name` komen de samples nooit bij de host terecht.",
  "2. Run `otelcol-contrib` v0.143.0 or newer: older builds stop at startup with `'receivers' unknown type: \"systemd\"`, or name the CPU metric differently (see **Enable the Systemd Units tab**).":
    "2. Gebruik `otelcol-contrib` v0.143.0 of nieuwer: oudere builds stoppen bij het opstarten met `'receivers' unknown type: \"systemd\"` of geven de CPU-metriek een andere naam (zie **Het tabblad Systemd-units inschakelen**).",
  "3. Check the collector can reach the system D-Bus: `/run/dbus/system_bus_socket` must exist, and `systemctl list-units` run as the collector's user is the quickest test. Root is not required.":
    "3. Controleer of de collector de systeem-D-Bus kan bereiken: `/run/dbus/system_bus_socket` moet bestaan, en `systemctl list-units` uitgevoerd als de gebruiker van de collector is de snelste test. Root is niet nodig.",
  "A RHEL, CentOS, Fedora or Amazon Linux host (x86_64 or aarch64) with `sudo`":
    "Een RHEL-, CentOS-, Fedora- of Amazon Linux-host (x86_64 of aarch64) met `sudo`",
  "A Linux host (x86_64 or aarch64) that runs systemd, with `sudo`":
    "Een Linux-host (x86_64 of aarch64) met systemd en `sudo`",
  "Drop a systemd unit at `/etc/systemd/system/otelcol-contrib.service`:":
    "Plaats een systemd-unit in `/etc/systemd/system/otelcol-contrib.service`:",
  "Then enable and start it:": "Schakel hem daarna in en start hem:",
  "Use this when packages aren't available — locked-down servers, or container base images you want to instrument from outside. No `HOST_PROC` env vars or `/hostfs` mount are needed: the collector reads kernel state directly, and `User=root` lets the `process` scraper see processes owned by other users (granting `CAP_SYS_PTRACE` instead works too).":
    "Gebruik dit als er geen pakketten beschikbaar zijn — afgeschermde servers, of container-basisimages die je van buitenaf wilt instrumenteren. Er zijn geen `HOST_PROC`-omgevingsvariabelen of `/hostfs`-mount nodig: de collector leest de kernelstatus rechtstreeks, en met `User=root` ziet de `process`-scraper processen van andere gebruikers (`CAP_SYS_PTRACE` toekennen werkt ook).",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so it needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "De receiver is **alleen voor Linux** en **alfa**. Hij leest de status van units via de systeem-D-Bus met dezelfde alleen-lezen aanroepen als `systemctl list-units`, die systemd zonder rechten toestaat, dus hij heeft geen extra rechten nodig. Een collector in een container kan de bus van de host niet bereiken, gebruik dus een native installatie. Zodra er metrieken binnenkomen, vult het tabblad **Systemd-units** van de host zich met elke verzamelde unit en zijn huidige status (`active`, `failed`, `inactive`, ...).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to `/opt/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "De configuratie vult de IP-adressen, MAC-adressen, architectuur, machine-ID, OS-beschrijving en OS-versie van de machine al in op haar item in **Inventaris**, dat is wat een CMDB-export leest. Serienummer, fabrikant, model en firmwareversie (BIOS / UEFI) zijn anders: **geen enkele resourcedetector kan ze leveren.** Ze komen uit de firmware van de machine, via DMI. Lees ze eenmalig uit bij het inrichten en zet ze vast op de resource — voeg deze processor toe aan `/opt/otelcol-contrib/config.yaml` en noem hem in de metriekpipeline. Voeg hem samen met de secties die je configuratie al heeft — voeg geen tweede `processors:`- of `service:`-sleutel toe.",
  "A Mac (Apple silicon or Intel) and an administrator account for `sudo`":
    "Een Mac (Apple silicon of Intel) en een beheerdersaccount voor `sudo`",
  "Create `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:":
    "Maak `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist` aan:",
  "Load it:": "Laad hem:",
  "> **Install the contrib build, as above.** The core `otelcol` build has no `resourcedetection` processor, so it refuses to start with this config.":
    "> **Installeer de contrib-build, zoals hierboven.** De core-build `otelcol` heeft geen `resourcedetection`-processor en weigert daarom met deze configuratie te starten.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "De configuratie vult de IP-adressen, MAC-adressen, architectuur, machine-ID, OS-beschrijving en OS-versie van de machine al in op haar item in **Inventaris**, dat is wat een CMDB-export leest. Serienummer, fabrikant, model en firmwareversie (BIOS / UEFI) zijn anders: **geen enkele resourcedetector kan ze leveren.** Ze komen uit de firmware van de machine. Lees ze eenmalig uit bij het inrichten en zet ze vast op de resource — voeg deze processor toe aan `/etc/otelcol-contrib/config.yaml` en noem hem in de metriekpipeline. Voeg hem samen met de secties die je configuratie al heeft — voeg geen tweede `processors:`- of `service:`-sleutel toe.",
  "Then restart the collector:": "Herstart daarna de collector:",
  "The values are the machine's own, so they are written once by whatever provisions it. On a Mac, read them like this — the manufacturer is `Apple Inc.`:":
    "De waarden horen bij de machine zelf en worden dus eenmalig geschreven door wat haar inricht. Lees ze op een Mac zo — de fabrikant is `Apple Inc.`:",
  "`hw.model` is the model *identifier* (`MacBookPro18,3`), not the marketing name. Put it in `device.model.name` anyway — `device.model.identifier` marks a batch as a mobile app.":
    "`hw.model` is de *modelaanduiding* (`MacBookPro18,3`), niet de verkoopnaam. Zet hem toch in `device.model.name` — `device.model.identifier` markeert een batch als mobiele app.",
  "Windows 10 1803+ or Windows Server 2019+ (for the built-in `tar.exe`)":
    "Windows 10 1803+ of Windows Server 2019+ (voor de ingebouwde `tar.exe`)",
  "An elevated PowerShell prompt (Run as administrator)":
    "Een PowerShell-prompt met verhoogde rechten (Als administrator uitvoeren)",
  "Save this as `config.yaml` in the folder you will run the PowerShell commands from — step 3 copies it into place.":
    "Sla dit op als `config.yaml` in de map waaruit je de PowerShell-opdrachten uitvoert — stap 3 kopieert het naar zijn plek.",
  "On Windows, install the upstream **`otelcol-contrib`** collector — from **v0.155.0** it bundles the `windows_service` receiver that powers the host **Services** tab. Run from an elevated PowerShell prompt:":
    "Installeer op Windows de upstream-collector **`otelcol-contrib`** — vanaf **v0.155.0** bevat hij de `windows_service`-receiver die het tabblad **Services** van de host vult. Voer uit vanaf een PowerShell-prompt met verhoogde rechten:",
  "> **Note:** The service runs as `LocalSystem` so it can read every Windows service. On Windows the `load` scraper only emulates a load average from the *Processor Queue Length* counter (it starts at 0); if it can't read the counter it is logged and skipped, so the rest of the `hostmetrics` config runs unchanged. The [Host OpenTelemetry Collector docs](/docs/telemetry/host-otel-collector) also cover the signed `.msi` installer.":
    "> **Opmerking:** de service draait als `LocalSystem`, zodat hij elke Windows-service kan lezen. Op Windows emuleert de `load`-scraper alleen een gemiddelde belasting op basis van de teller *Processor Queue Length* (die begint bij 0); kan hij de teller niet lezen, dan wordt dat gelogd en overgeslagen, en de rest van de `hostmetrics`-configuratie draait ongewijzigd. De [documentatie van de OpenTelemetry Collector voor hosts](/docs/telemetry/host-otel-collector) behandelt ook het ondertekende `.msi`-installatieprogramma.",
  "Logs are written to the Windows Application event log; view them in **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`).":
    "Logs worden naar het Windows-gebeurtenislogboek Toepassing geschreven; bekijk ze in **Event Viewer → Windows Logs → Application** (bron `otelcol-contrib`).",
  "From **v0.155.0** `otelcol-contrib` includes the `windows_service` receiver — turn it on by adding it to `C:\\Program Files\\otelcol-contrib\\config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Vanaf **v0.155.0** bevat `otelcol-contrib` de `windows_service`-receiver — schakel hem in door hem toe te voegen aan `C:\\Program Files\\otelcol-contrib\\config.yaml` en aan de metriekpipeline. Voeg hem samen met de secties die je configuratie al heeft — voeg geen tweede `processors:`- of `service:`-sleutel toe.",
  "The receiver is **Windows-only** and **alpha**. Once metrics arrive, the host **Services** tab populates automatically with each service's running state and startup type.":
    "De receiver is **alleen voor Windows** en **alfa**. Zodra er metrieken binnenkomen, vult het tabblad **Services** van de host zich automatisch met de actieve status en het opstarttype van elke service.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through WMI.":
    "De configuratie vult de IP-adressen, MAC-adressen, architectuur, machine-ID, OS-beschrijving en OS-versie van de machine al in op haar item in **Inventaris**, dat is wat een CMDB-export leest. Serienummer, fabrikant, model en firmwareversie (BIOS / UEFI) zijn anders: **geen enkele resourcedetector kan ze leveren.** Ze komen uit de firmware van de machine, via WMI.",
  "Run this from an elevated PowerShell prompt on the machine — it queries WMI and prints the exact YAML for *this* machine:":
    "Voer dit uit vanaf een PowerShell-prompt met verhoogde rechten op de machine — het bevraagt WMI en drukt de exacte YAML voor *deze* machine af:",
  "It prints one processor entry, already indented. Add it inside the `processors:` block your `config.yaml` already has — alongside `resourcedetection:`, `resource:` and `batch:`, not as a second `processors:` key — then name it in the metrics pipeline:":
    "Het drukt één processoritem af, al ingesprongen. Voeg het toe binnen het `processors:`-blok dat je `config.yaml` al heeft — naast `resourcedetection:`, `resource:` en `batch:`, niet als tweede `processors:`-sleutel — en noem het daarna in de metriekpipeline:",
  "Use `Get-CimInstance`, not the deprecated `Get-WmiObject` — it is absent from PowerShell 7 and later. Values are emitted in single quotes with any embedded quote doubled, so a serial or model containing punctuation stays valid YAML. A field the firmware leaves empty prints as `''`; drop that attribute rather than shipping a blank one.":
    "Gebruik `Get-CimInstance`, niet het verouderde `Get-WmiObject` — dat ontbreekt in PowerShell 7 en later. De waarden worden tussen enkele aanhalingstekens uitgevoerd, met elk ingesloten aanhalingsteken verdubbeld, zodat een serienummer of model met leestekens geldige YAML blijft. Een veld dat de firmware leeg laat, verschijnt als `''`; laat dat attribuut weg in plaats van een leeg attribuut te versturen.",
  "Within a few minutes the machine's **Inventory** item shows `host.serial_number`, `device.manufacturer`, `device.model.name` and `device.firmware.version` under **Details**, alongside the IP and MAC addresses and machine id the detector already supplies. Run this again after a motherboard swap or a BIOS update — the values are stamped, not detected, so they do not update themselves.":
    "Binnen een paar minuten toont het item van de machine in **Inventaris** onder **Details** `host.serial_number`, `device.manufacturer`, `device.model.name` en `device.firmware.version`, naast de IP- en MAC-adressen en de machine-ID die de detector al levert. Voer dit opnieuw uit na een moederbordwissel of een BIOS-update — de waarden zijn vastgezet, niet gedetecteerd, dus ze werken zichzelf niet bij.",
  "- The **Services** tab lists each service's state once the `windows_service` receiver is enabled (see **Enable the Windows Services tab**).":
    "- Het tabblad **Services** toont de status van elke service zodra de `windows_service`-receiver is ingeschakeld (zie **Het tabblad Windows-services inschakelen**).",
  "1. Read the collector's logs for export errors: **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`). An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `C:\\Program Files\\otelcol-contrib\\config.yaml`.":
    "1. Bekijk de logs van de collector op exportfouten: **Event Viewer → Windows Logs → Application** (bron `otelcol-contrib`). Een HTTP-`401` betekent dat de sleutel ontbreekt, verkeerd of verlopen is; `422` dat hij is uitgeschakeld (of een browsersleutel is, die geen hosttelemetrie kan versturen). Kies in stap 1 een werkende sleutel en werk `x-oneuptime-token` bij in `C:\\Program Files\\otelcol-contrib\\config.yaml`.",
  "1. Run the collector in the foreground to see the real error instead of the generic `Error 1064`:":
    "1. Voer de collector op de voorgrond uit om de echte fout te zien in plaats van de algemene `Error 1064`:",
  '2. `Error 2: The system cannot find the file specified` means the service points at a file that is not there — compare `BINARY_PATH_NAME` from `sc.exe qc "otelcol-contrib"` with the contents of `C:\\Program Files\\otelcol-contrib`. The archive must be the `otelcol-contrib_` one, which unpacks `otelcol-contrib.exe`.':
    '2. `Error 2: The system cannot find the file specified` betekent dat de service naar een bestand wijst dat er niet is — vergelijk `BINARY_PATH_NAME` uit `sc.exe qc "otelcol-contrib"` met de inhoud van `C:\\Program Files\\otelcol-contrib`. Het archief moet het `otelcol-contrib_`-archief zijn, dat `otelcol-contrib.exe` uitpakt.',
  "3. **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`) records the startup error the service manager swallowed.":
    "3. **Event Viewer → Windows Logs → Application** (bron `otelcol-contrib`) legt de opstartfout vast die de servicebeheerder heeft ingeslikt.",
  "If you set `include_services` but still see every service, the collector hasn't picked up the edit — restart the service (`Restart-Service otelcol-contrib`) and give the Services tab a few minutes to refresh its rolling window.":
    "Stel je `include_services` in maar zie je nog steeds elke service, dan heeft de collector de wijziging niet opgepikt — herstart de service (`Restart-Service otelcol-contrib`) en geef het tabblad Services een paar minuten om zijn glijdende venster te verversen.",
  "Kubernetes nodes are monitored by the **OneUptime Kubernetes agent** rather than a host collector: each node appears under **Kubernetes** → your cluster → **Nodes**, next to its pods and workloads, not in the **Hosts** list. The steps below install the agent on a standard cluster; the install guide in the **Kubernetes** section has the steps for Amazon EKS, Google GKE, Azure AKS, GKE Autopilot and EKS Fargate.":
    "Kubernetes-nodes worden bewaakt door de **OneUptime Kubernetes-agent** in plaats van door een hostcollector: elke node verschijnt onder **Kubernetes** → je cluster → **Knooppunten**, naast zijn pods en workloads, niet in de lijst **Hosts**. De stappen hieronder installeren de agent op een standaardcluster; de installatiegids in het onderdeel **Kubernetes** bevat de stappen voor Amazon EKS, Google GKE, Azure AKS, GKE Autopilot en EKS Fargate.",
  "A Kubernetes cluster running v1.23 or later":
    "Een Kubernetes-cluster met v1.23 of nieuwer",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` en `helm` (v3) geïnstalleerd op je computer",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "Verkeerd cluster? Wissel met `kubectl config use-context <context-name>`.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "Vervang `my-cluster` door een naam voor dit cluster, zoals `prod-us-east-1`. Onder die naam verschijnt het cluster in OneUptime, dus houd hem stabiel: een nieuwe naam registreert een nieuw cluster.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` zet **AI-onderzoeken** aan, zoals de chart standaard doet: OneUptime AI onderzoekt incidenten en waarschuwingen op dit cluster met alleen-lezen kubectl, via de Kubernetes-AI-agent.",
  "You should see:": "Je zou dit moeten zien:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "De collector en de Kubernetes-AI-agent, plus één `-logs`- en één `-ebpf`-pod op elke node. Zodra ze `Running` zijn, verschijnt het cluster automatisch in het onderdeel **Kubernetes**, meestal binnen een minuut of twee.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Kubernetes-AI-agent (standaard aan, alleen-lezen).** Met de pod `kubernetes-agent-ai-agent` kan OneUptime AI incidenten en waarschuwingen op dit cluster onderzoeken met alleen-lezen kubectl (`get`, `describe`, `logs`, `events`, `top`), met dezelfde API-sleutel, en hij kan niets wijzigen tenzij je hem later schrijftoegang geeft. Open het cluster en ga naar **AI → Agent** om hem te zien. Wil je hem niet? Installeer met `--set aiAgent.enabled=false` in plaats van `--set aiAgent.enabled=true`.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "Namespace-regels bepalen wat de agent uit elke namespace verzamelt. Om podlogs en eBPF-gegevens alleen uit `default`, `production` en `staging` te verzamelen:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "Om alles te houden maar de logs van luidruchtige namespaces te stoppen, sluit je ze alleen uit van `podLogs`:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **Bereiken:** `podLogs` (stdout/stderr van containers), `ebpfDiscovery` (eBPF-traces en -metrieken), `metrics` (metrieken met namespace) en `traces` (elke span).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **Patronen** passen op de hele namespacenaam en accepteren `*`, zoals in `team-*`. Een `exclude`-regel wint altijd van een `include`-regel.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **Eigen regels vervangen de standaardregel**, die `kube-system` uitsluit van `podLogs` en `ebpfDiscovery`. Houd hem in je lijst, zoals in het tweede voorbeeld, als je dat nog wilt.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- Node- en clustermetrieken hebben geen namespace en worden dus altijd behouden.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` vereist Helm 3.10 of nieuwer.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**Stuur alleen belangrijke regels.** Laat podlogregels onder een ernstniveau vallen voordat ze het cluster verlaten:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    'Accepteert `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` en `FATAL`: `WARN` houdt waarschuwingen, fouten en fatale regels. Het ernstniveau wordt uit de logregel zelf gelezen (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes-gebeurtenissen worden hierdoor nooit verworpen.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Zet podlogs uit.** Metrieken worden niet geraakt: de nodecollector blijft draaien voor kubelet- en cAdvisor-metrieken en stopt alleen met het lezen van podlogs:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**Verander hoe logs worden gelezen.** De preset kiest dit voor je; een expliciete `logs.mode` gaat altijd voor:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: leest `/var/log/pods` op elke node via hostPath (laagste overhead; vereist hostPath).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: een Deployment volgt podlogs via de Kubernetes-API (werkt op elk cluster).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: geen podlogs.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "Daarmee wordt de API-server gelezen, waar hij binnen het cluster antwoordt. etcd, de scheduler en de controller manager antwoorden op de control-plane-nodes, die de pod van de agent niet kan raden; hij leest ze dus zodra je het adres van elke node opgeeft:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **De scheduler en de controller manager** serveren HTTPS en accepteren het token van de agent, maar kubeadm bindt ze aan `127.0.0.1`: geef ze een `--bind-address` die de pod van de agent kan bereiken.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** serveert zijn metrieken via gewoon HTTP op de `--listen-metrics-urls` van kubeadm (poort 2381, gebonden aan `127.0.0.1` tot je het adres van de node toevoegt), zoals hierboven. Of lees zijn HTTPS-clientpoort 2379 uit met het clientcertificaat dat hij vraagt: zet `ca.crt`, `tls.crt` en `tls.key` in een Secret in `oneuptime-agent` en noem dat in `controlPlane.etcd.clientCertSecret`.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "Alleen voor zelfbeheerde clusters: beheerde diensten (EKS, GKE, AKS) stellen hun control-plane-metrieken niet beschikbaar.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "Kostenmonitoring staat standaard aan: de agent levert de opensource-engine OpenCost mee (plus de kleine Prometheus die hij nodig heeft), prijst je nodes en volumes op basis van de openbare catalogusprijzen van je cloudprovider, zonder inloggegevens, en stuurt wat elke namespace en workload kost. De eerste gegevens verschijnen na het eerste volle uur op het overzicht en de pagina Kosten van het cluster.",
  "On an agent installed before it was on by default, upgrade it:":
    "Is de agent geïnstalleerd voordat dit standaard aan stond, upgrade hem dan:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **Uitzetten:** voeg `--set cost.enabled=false` toe aan dezelfde upgrade.",
  "- **Already running Kubecost or OpenCost?** The agent finds it and reads it instead of the bundled engine, and the cluster's overview says so: add `--set cost.engine.url=auto` to stop bundling a second one.":
    "- **Draai je al Kubecost of OpenCost?** De agent vindt je engine en leest die uit in plaats van de meegeleverde engine, en het overzicht van het cluster meldt dat: voeg `--set cost.engine.url=auto` toe, dan wordt er geen tweede engine meer meegeleverd.",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **On-premises of bare metal?** Stel een tarieflijst in met `--set cost.opencost.customPricing.enabled=true` (USD per resource-uur; zie de `values.yaml` van de chart).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "Volledige handleiding: [Kostenobservatie voor Kubernetes](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "De agent draait [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) op elke node. Die vangt HTTP/HTTPS-, gRPC- en SQL/Redis-verkeer op van services in Go, .NET, Java, Node.js, Python, Ruby en Rust, zonder SDK en zonder sidecar, en stuurt traces, aanvraagmetrieken (RED) en servicegrafiekgegevens via de collector.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**Vereisten:** Linux-kernel **5.8+** met BTF (de standaard op Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). De eBPF-pods draaien **geprivilegieerd**, wat ze nodig hebben om eBPF-programma's te laden.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "**Zet het uit** als je nodes een oudere kernel draaien, als geprivilegieerde pods niet zijn toegestaan of als je services al traces sturen met OpenTelemetry-SDK's en je geen duplicaten wilt:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**Kies de signalen.** Elke familie zet je aan of uit met `--set ebpf.features.<name>=false` (of `=true`):",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | Standaard | Wat het toevoegt |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | aan | HTTP/gRPC-aanvraagsnelheid, fouten en latentie per service |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | aan | Aantal aanroepen en duur van spans (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | aan | Randen van aanroeper → aangeroepene; voedt de servicekaart |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | aan | Tellers voor TCP/UDP-flows van pod naar pod |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | uit | Netwerkmetrieken tussen zones (verdubbelt hun kardinaliteit) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | aan | TCP-RTT en tellers voor mislukte verbindingen en hertransmissies per node |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**Trace-propagatie tussen services** (een aanvraag die van pod A → pod B gaat, ook op een andere node, tot één trace koppelen) staat **standaard aan**. Het werkt door verkeer te herschrijven dat al onderweg is (HTTP-aanvragen in platte tekst in de kernel verbreden, en een TCP-optie toevoegen aan TLS en kale TCP), en een fout in die bytetelling brengt de stroom uit de pas: het gemelde symptoom zijn overdrachten via een L7-proxy zoals nginx die blijven hangen zodra een antwoord ~64KB passeert. Zie je dat, of laat een service mesh pods falen, zet het dan uit met `--set ebpf.contextPropagation=false`; een OpenTelemetry-SDK propageert `traceparent` in de userspace zonder dat alles.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Elke `oneuptime.labels.<key>=<value>` wordt het label `<key>:<value>` op het cluster en op de services en hosts die het meldt. Labels worden hoofdletterongevoelig vergeleken, dus een bestaand label `Production` wordt hergebruikt; labels die in de OneUptime-interface zijn toegevoegd, verwijdert de agent nooit.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**Upgrade** naar de nieuwste chart. `--reset-then-reuse-values` (Helm 3.14+) behoudt de waarden die je hebt ingesteld (preset, clusternaam, filters) en neemt al het andere over uit de nieuwe chart; voeg eventuele nieuwe `--set`-flags erbovenop toe:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "Met Helm 3.13 en ouder upgrade je in plaats daarvan met de waarden die je hebt ingesteld:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "Gebruik geen `--reuse-values`: dat behoudt ook de standaardwaarden van de chart waarvan je upgradet, zodat de standaardwaarden van een nieuwere chart (waaronder zijn eBPF-image) nooit gelden.",
  "**Uninstall** the agent and its namespace:":
    "**Verwijder** de agent en zijn namespace:",
  "| Category | Data |": "| Categorie | Gegevens |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **Nodemetrieken** | Gebruik van CPU, geheugen, bestandssysteem en netwerk |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Pod- en containermetrieken** | CPU, geheugen, netwerk-I/O en herstarts |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **Clustermetrieken** | Nodecondities, toewijsbare resources, aantal pods en workloads |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Kubernetes-gebeurtenissen** | Waarschuwingen, fouten en planningsgebeurtenissen |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Podlogs** | stdout/stderr van elke container, op elke node gelezen |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **Applicatietraces** *(eBPF)* | HTTP-, gRPC- en SQL/Redis-spans van elke pod, zonder SDK of codewijzigingen |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **Aanvraagmetrieken en servicegrafiek** *(eBPF)* | Aanvraagsnelheid, fouten en latentie per service, en randen van aanroeper → aangeroepene voor de servicekaart |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **Netwerkflows** *(eBPF)* | Tellers voor TCP/UDP-bytes en -pakketten van pod naar pod |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **Workloadkosten** *(standaard aan)* | Uitgaven per namespace, workload en pod, met ongebruikte capaciteit en efficiëntie, ook als metrieken om op te waarschuwen |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "Je cluster blokkeert `hostPath`-volumes of geprivilegieerde pods. Dat is normaal op **GKE Autopilot** en **EKS Fargate**: kies dat platform bovenaan deze handleiding en volg de stappen ervan. Op **OpenShift** slaagt de installatie juist, maar starten de nodepods van de agent nooit: kies **Red Hat OpenShift**.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "Verwijder op elk ander cluster met een restrictief Pod Security-beleid de mislukte release:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "Voer daarna het installatiecommando opnieuw uit met `--set preset=gke-autopilot` erbij. Die preset leest podlogs via de Kubernetes-API in plaats van hostPath, past een geharde beveiligingscontext toe en laat de geprivilegieerde eBPF- en profilingpods weg.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. Controleer of de pods van de agent draaien: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. Bekijk de logs van de collector: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. Controleer of de OneUptime-URL en de ingestiesleutel in het installatiecommando kloppen.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. Zorg dat het cluster je OneUptime-instantie via het netwerk kan bereiken.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. Controleer de pod van de AI-agent: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. Bekijk zijn logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. Geen pod? Upgrade de chart (zie **De agent upgraden of verwijderen** onder Geavanceerd) en voeg `--set aiAgent.enabled=true` toe.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. Controleer of de clusternaam klopt: deze handleiding installeert **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. Controleer de RBAC-rechten van de agent: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Zoek in de logs van de collector naar exportfouten: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **Kernel te oud of geen BTF.** eBPF heeft Linux 5.8+ met BTF nodig; controleer het met `uname -r` op een node. Kun je niet upgraden, zet eBPF dan uit met `--set ebpf.enabled=false`.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **Geprivilegieerde pods geblokkeerd.** Sommige dichtgetimmerde clusters weigeren ze. Zet eBPF uit.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` niet beschikbaar op de host.** Zet alleen de familie van TCP-statistieken uit: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. Controleer of de eBPF-pods gezond zijn: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. Zet de debuguitvoer van OBI aan om te bevestigen dat hij verkeer ziet: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, en lees daarna `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Verschijnen er daar spans maar niet in OneUptime, zoek dan in de logs van de collector naar exportfouten: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
};

export default TRANSLATION;
