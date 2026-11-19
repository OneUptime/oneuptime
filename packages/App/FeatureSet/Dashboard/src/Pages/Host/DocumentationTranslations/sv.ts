import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Host setup guide in Swedish (#8341): each piece of the English
 * guide's markdown (Pages/Host/Utils/DocumentationMarkdown.ts) and its
 * Swedish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Swedish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker installed on the host you want to monitor":
    "Docker installerat på den värd som du vill övervaka",
  "Network access from the host to your OneUptime instance":
    "Nätverksåtkomst från värden till din OneUptime-instans",
  "Save this as `config.yaml` in the directory you will run `docker run` from — step 3 mounts it into the container.":
    "Spara detta som `config.yaml` i den katalog som du kör `docker run` från — steg 3 monterar den i containern.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Välj en intagningsnyckel i steg 1 för att fylla i `<YOUR_API_KEY>`.",
  "`--network host`, `--pid host`, and the `/hostfs` bind mount let the `hostmetrics` and `process` scrapers read CPU, memory, disk, and per-process information from the host kernel rather than the container. Without these, you'd only see metrics for the collector container itself.":
    "`--network host`, `--pid host` och bindmonteringen `/hostfs` låter skraporna `hostmetrics` och `process` läsa CPU-, minnes-, disk- och processdata från värdens kärna i stället för containerns. Utan dem skulle du bara se mätvärden för själva insamlarens container.",
  "Open the **Hosts** list in OneUptime — your host appears automatically once the first metric batch lands (usually within 30 seconds). Not there? Check the collector:":
    "Öppna listan **Värdar** i OneUptime — din värd visas automatiskt så snart den första omgången mätvärden kommer in (oftast inom 30 sekunder). Inte där? Kontrollera insamlaren:",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer, so add it on Linux hosts only; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**AI-utredningar är på som standard** för varje värd: så snart värdens AI-agent körs på den utreder OneUptime AI incidenter och larm där med skrivskyddade kommandon som `systemctl status`, `df -h`, `free -m` och `ps aux`, och ändrar ingenting om du inte tillåter korrigeringar. Den är en Linux-container med ett eget installationsprogram, så lägg bara till den på Linux-värdar; den kräver Docker (systemmotorn, inte rootless Docker) med Compose-pluginet:",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. It asks for your OneUptime URL, the ingestion key and the host's name — leave the name empty to use the hostname, which is what this collector reports. Once it connects, it shows as Connected on the host's **AI → AI agent** page and at the bottom of its **Overview**. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#hosts).":
    "Den första raden laddar ned skriptet som `install.sh`, så att du kan läsa det innan du kör det. Det frågar efter din OneUptime-URL, intagningsnyckeln och värdens namn — lämna namnet tomt för att använda värdnamnet, som är det som den här insamlaren rapporterar. När den har anslutit visas den som ansluten på värdens sida **AI → AI-agent** och längst ned i dess **Översikt**. Vad den får köra och hur korrigeringar fungerar: [AI-agenter för infrastruktur](/docs/ai/infrastructure-ai-agents#hosts).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to the `config.yaml` you mounted into the container and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Konfigurationen fyller redan i maskinens IP-adresser, MAC-adresser, arkitektur, maskin-id, OS-beskrivning och OS-version på dess objekt under **Inventarie**, vilket är det en CMDB-export läser. Serienummer, tillverkare, modell och firmwareversion (BIOS / UEFI) är annorlunda: **ingen resursdetektor kan ta fram dem.** De kommer från maskinens firmware via DMI. Läs av dem en gång vid provisioneringen och skriv fast dem på resursen — lägg till den här processorn i den `config.yaml` som du monterade i containern och nämn den i mätvärdespipelinen. Slå ihop den med de avsnitt som din konfiguration redan har — lägg inte till en andra `processors:`- eller `service:`-nyckel.",
  "Then recreate the container so it reads the edited file — remove it, and run the `docker run` command from step 3 again:":
    "Återskapa sedan containern så att den läser den redigerade filen — ta bort den och kör `docker run`-kommandot från steg 3 igen:",
  "The values are the machine's own, so they are written once by whatever provisions it. On Linux, read them as root (`bios_version` is readable by anyone):":
    "Värdena tillhör själva maskinen, så de skrivs en gång av det som provisionerar den. På Linux läser du dem som root (`bios_version` kan läsas av alla):",
  "Within a few minutes the values show on the machine's **Inventory** item under **Details**. They are stamped, not detected, so run this again after a motherboard swap or a firmware update.":
    "Inom några minuter visas värdena på maskinens objekt under **Inventarie** under **Detaljer**. De är fastskrivna, inte identifierade, så kör detta igen efter ett moderkortsbyte eller en firmwareuppdatering.",
  "`host.manufacturer`, `host.model.name`, `host.firmware.version` and `host.bios.version` are accepted as alternative spellings and stored under the `device.*` keys above (and `device.serial_number` under `host.serial_number`), so a config written either way ends up in one place.":
    "`host.manufacturer`, `host.model.name`, `host.firmware.version` och `host.bios.version` godtas som alternativa stavningar och sparas under `device.*`-nycklarna ovan (och `device.serial_number` under `host.serial_number`), så en konfiguration som skrivits på det ena eller andra sättet hamnar på ett ställe.",
  "> **Don't set `device.manufacturer` on a mobile app's resource and a host's from the same config.** On a resource that carries no `host.name` or `host.id`, `device.manufacturer` still marks the batch as mobile Real User Monitoring.":
    "> **Sätt inte `device.manufacturer` på en mobilapps resurs och på en värds från samma konfiguration.** På en resurs utan `host.name` eller `host.id` markerar `device.manufacturer` fortfarande omgången som mobil Real User Monitoring.",
  "Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the host (and to the telemetry service emitted from this collector). Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.":
    "Varje resursattribut med prefixet `oneuptime.label.` blir en projektetikett som kopplas till värden (och till den telemetritjänst som den här insamlaren skickar ut). Mönster: `oneuptime.label.<dimension>=<value>` blir en etikett med namnet `<dimension>:<value>`.",
  "Add a `resource` processor to the `config.yaml` you mounted into the container and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Lägg till en `resource`-processor i den `config.yaml` som du monterade i containern och hänvisa till den från mätvärdespipelinen. Slå ihop den med de avsnitt som din konfiguration redan har — lägg inte till en andra `processors:`- eller `service:`-nyckel.",
  "The host shows up tagged `team:payments`, `env:production`, and `region:us-east-1`. Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated. Labels added manually in the OneUptime UI are never removed by the collector.":
    "Värden visas med etiketterna `team:payments`, `env:production` och `region:us-east-1`. Etiketter jämförs utan hänsyn till skiftläge, så en befintlig, manuellt skapad etikett `Production` återanvänds i stället för att dubbleras. Etiketter som lagts till manuellt i OneUptimes gränssnitt tas aldrig bort av insamlaren.",
  "Hosts are auto-discovered from the OTel `host.name` resource attribute, which the `resourcedetection` processor sets. OneUptime registers the host once a batch that carries `host.name` also carries any of:":
    "Värdar upptäcks automatiskt från OTel-resursattributet `host.name`, som `resourcedetection`-processorn sätter. OneUptime registrerar värden så snart en omgång med `host.name` också innehåller något av följande:",
  "- `hostmetrics` receiver metrics (CPU, memory, disk, filesystem, network, load, processes), OR":
    "- mätvärden från `hostmetrics`-mottagaren (CPU, minne, disk, filsystem, nätverk, belastning, processer), ELLER",
  "- `process` scraper metrics (per-process CPU/memory/threads), OR":
    "- mätvärden från `process`-skrapan (CPU/minne/trådar per process), ELLER",
  "- an `os.type` or `container.runtime` resource attribute, on metrics, logs or traces":
    "- ett resursattribut `os.type` eller `container.runtime`, på mätvärden, loggar eller spårningar",
  "…and starts populating the Overview, Metrics, Processes, and Logs tabs. `host.id` or `host.arch` alone do not register a host, and telemetry that carries a Kubernetes identity (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) is filed under its Kubernetes cluster instead.":
    "…och börjar fylla flikarna Översikt, Mätvärden, Processer och Loggar. `host.id` eller `host.arch` ensamma registrerar ingen värd, och telemetri med en Kubernetes-identitet (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) arkiveras i stället under sitt Kubernetes-kluster.",
  "**Running on OpenStack?** Use `detectors: [nova, system, env]`, so `host.id` is the instance's UUID and OneUptime links this host to its instance, and set `host.name` to `enabled: false` under `nova: resource_attributes:` so its name stays the one `system` reports.":
    "**Körs den på OpenStack?** Använd `detectors: [nova, system, env]`, så att `host.id` blir instansens UUID och OneUptime kopplar den här värden till sin instans, och sätt `host.name` till `enabled: false` under `nova: resource_attributes:` så att namnet förblir det som `system` rapporterar.",
  "The same resource attributes become the machine's **Inventory** item, which is what a CMDB export reads. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` and `os.version` all come from the `resourcedetection` processor; serial number, make, model and firmware version have no detector and are stamped on separately (see **Record the serial number, make, model and firmware version**).":
    "Samma resursattribut blir maskinens objekt under **Inventarie**, vilket är det en CMDB-export läser. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` och `os.version` kommer alla från `resourcedetection`-processorn; serienummer, tillverkare, modell och firmwareversion har ingen detektor och skrivs fast separat (se **Registrera serienummer, tillverkare, modell och firmwareversion**).",
  "Once the host is reporting:": "När värden rapporterar:",
  "- The **Metrics** tab visualizes `system.*` time-series.":
    "- Fliken **Mätvärden** visar `system.*`-tidsserier.",
  "- The **Processes** tab lists processes ordered by CPU once the `process` scraper is enabled.":
    "- Fliken **Processer** listar processer sorterade efter CPU så snart `process`-skrapan är aktiverad.",
  "- The **Logs** tab streams any logs whose resource attributes include `host.name`.":
    "- Fliken **Loggar** visar löpande alla loggar vars resursattribut innehåller `host.name`.",
  "The config reports the collector release it is for (`oneuptime.agent.version`) as the host's **Agent Version**. When this OneUptime pins a newer release, a warning sign beside it opens these steps.":
    "Konfigurationen rapporterar den insamlarversion den är skriven för (`oneuptime.agent.version`) som värdens **Agentversion**. När den här OneUptime låser till en nyare version öppnar en varningssymbol bredvid den de här stegen.",
  "1. Save the config from step 2 again, with the same ingestion key: it reports the new version. Copy across any change you made to yours.":
    "1. Spara konfigurationen från steg 2 igen, med samma intagningsnyckel: den rapporterar den nya versionen. För över alla ändringar som du gjort i din.",
  "2. In the folder that holds it, install the new release and restart the collector:":
    "2. Installera den nya versionen i mappen som innehåller den och starta om insamlaren:",
  "1. Read the collector's logs for export errors: `docker logs -f otel-collector`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in the `config.yaml` you mounted into the container.":
    "1. Läs insamlarens loggar efter exportfel: `docker logs -f otel-collector`. En HTTP-`401` betyder att nyckeln saknas, är fel eller har gått ut; `422` att den har inaktiverats (eller är en webbläsarnyckel, som inte kan skicka värdtelemetri). Välj en fungerande nyckel i steg 1 och uppdatera `x-oneuptime-token` i den `config.yaml` som du monterade i containern.",
  "2. Check the host can reach OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` from the same machine.":
    "2. Kontrollera att värden når OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` från samma maskin.",
  "3. Keep `resourcedetection` in the metrics pipeline — it sets `host.name`, which is how OneUptime recognises the host.":
    "3. Behåll `resourcedetection` i mätvärdespipelinen — den sätter `host.name`, som är det som OneUptime känner igen värden på.",
  "The collector is reading its own container's kernel view. Run it with `--network host`, `--pid host`, the `/:/hostfs` bind mount and the `HOST_*` variables exactly as step 3 shows — without them the `hostmetrics` and `process` scrapers only see the collector container itself.":
    "Insamlaren läser sin egen containers kärnvy. Kör den med `--network host`, `--pid host`, bindmonteringen `/:/hostfs` och `HOST_*`-variablerna exakt som steg 3 visar — utan dem ser skraporna `hostmetrics` och `process` bara själva insamlarens container.",
  "A Debian or Ubuntu host (amd64 or arm64) with `sudo`":
    "En Debian- eller Ubuntu-värd (amd64 eller arm64) med `sudo`",
  "Save this as `config.yaml` in your current directory — step 3 installs it.":
    "Spara detta som `config.yaml` i din aktuella katalog — steg 3 installerar den.",
  "> **Note for native installs:** Unlike Docker, the package install reads `/proc` and `/sys` directly — no `HOST_PROC` env vars or `/hostfs` mount required. The systemd unit shipped with the package runs as the unprivileged `otelcol-contrib` user; if you want the `process` scraper to see processes owned by other users, grant it `CAP_SYS_PTRACE` or run it as root.":
    "> **Anmärkning om inbyggda installationer:** till skillnad från Docker läser paketinstallationen `/proc` och `/sys` direkt — inga `HOST_PROC`-miljövariabler eller `/hostfs`-montering behövs. systemd-enheten som följer med paketet körs som den oprivilegierade användaren `otelcol-contrib`; om du vill att `process`-skrapan ska se andra användares processer ger du den `CAP_SYS_PTRACE` eller kör den som root.",
  "`otelcol-contrib` has bundled the `systemd` receiver since **v0.142.0**; run **v0.143.0 or newer**, which is where its CPU metric settled on its current name and stopped probing non-service units. Turn it on by adding it to `/etc/otelcol-contrib/config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "`otelcol-contrib` har haft `systemd`-mottagaren med sedan **v0.142.0**; kör **v0.143.0 eller senare**, där dess CPU-mätvärde fick sitt nuvarande namn och den slutade fråga enheter som inte är tjänster. Aktivera den genom att lägga till den i `/etc/otelcol-contrib/config.yaml` och i mätvärdespipelinen. Slå ihop den med de avsnitt som din konfiguration redan har — lägg inte till en andra `processors:`- eller `service:`-nyckel.",
  "Then restart the service:": "Starta sedan om tjänsten:",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so the packaged service — which runs as the `otelcol-contrib` user — needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "Mottagaren är **endast för Linux** och **alfa**. Den läser enheternas läge över system-D-Bus med samma skrivskyddade anrop som `systemctl list-units`, som systemd tillåter utan behörigheter, så paketets tjänst — som körs som användaren `otelcol-contrib` — behöver inga extra behörigheter. En insamlare i en container når inte värdens buss, så använd en inbyggd installation. Så snart mätvärden kommer in fylls värdens flik **Systemd-enheter** med varje insamlad enhet och dess aktuella läge (`active`, `failed`, `inactive`, ...).",
  "Each unit costs eight datapoints per scrape for the state set, plus two more if you leave the CPU metric on, so on a host with hundreds of units narrow `units:` or raise `collection_interval` rather than scraping everything.":
    "Varje enhet kostar åtta datapunkter per insamling för lägesuppsättningen, plus två till om du låter CPU-mätvärdet vara på, så på en värd med hundratals enheter bör du snäva in `units:` eller höja `collection_interval` i stället för att samla in allt.",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**AI-utredningar är på som standard** för varje värd: så snart värdens AI-agent körs på den utreder OneUptime AI incidenter och larm där med skrivskyddade kommandon som `systemctl status`, `df -h`, `free -m` och `ps aux`, och ändrar ingenting om du inte tillåter korrigeringar. Den är en Linux-container med ett eget installationsprogram; den kräver Docker (systemmotorn, inte rootless Docker) med Compose-pluginet:",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI, and the packaged collector runs unprivileged, so it cannot read them itself. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Konfigurationen fyller redan i maskinens IP-adresser, MAC-adresser, arkitektur, maskin-id, OS-beskrivning och OS-version på dess objekt under **Inventarie**, vilket är det en CMDB-export läser. Serienummer, tillverkare, modell och firmwareversion (BIOS / UEFI) är annorlunda: **ingen resursdetektor kan ta fram dem.** De kommer från maskinens firmware via DMI, och paketets insamlare körs utan behörigheter, så den kan inte läsa dem själv. Läs av dem en gång vid provisioneringen och skriv fast dem på resursen — lägg till den här processorn i `/etc/otelcol-contrib/config.yaml` och nämn den i mätvärdespipelinen. Slå ihop den med de avsnitt som din konfiguration redan har — lägg inte till en andra `processors:`- eller `service:`-nyckel.",
  "Add a `resource` processor to `/etc/otelcol-contrib/config.yaml` and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Lägg till en `resource`-processor i `/etc/otelcol-contrib/config.yaml` och hänvisa till den från mätvärdespipelinen. Slå ihop den med de avsnitt som din konfiguration redan har — lägg inte till en andra `processors:`- eller `service:`-nyckel.",
  "- The **Systemd Units** tab lists unit state once the `systemd` receiver is enabled (see **Enable the Systemd Units tab**).":
    "- Fliken **Systemd-enheter** listar enheternas läge så snart `systemd`-mottagaren är aktiverad (se **Aktivera fliken Systemd-enheter**).",
  "1. Read the collector's logs for export errors: `sudo journalctl -u otelcol-contrib -f`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `/etc/otelcol-contrib/config.yaml`.":
    "1. Läs insamlarens loggar efter exportfel: `sudo journalctl -u otelcol-contrib -f`. En HTTP-`401` betyder att nyckeln saknas, är fel eller har gått ut; `422` att den har inaktiverats (eller är en webbläsarnyckel, som inte kan skicka värdtelemetri). Välj en fungerande nyckel i steg 1 och uppdatera `x-oneuptime-token` i `/etc/otelcol-contrib/config.yaml`.",
  "1. Keep `resourcedetection` in the same metrics pipeline as the `systemd` receiver — the receiver attaches only `systemd.unit.name` to each unit, so without `host.name` the samples never attach to the host.":
    "1. Behåll `resourcedetection` i samma mätvärdespipeline som `systemd`-mottagaren — mottagaren kopplar bara `systemd.unit.name` till varje enhet, så utan `host.name` kopplas proverna aldrig till värden.",
  "2. Run `otelcol-contrib` v0.143.0 or newer: older builds stop at startup with `'receivers' unknown type: \"systemd\"`, or name the CPU metric differently (see **Enable the Systemd Units tab**).":
    "2. Kör `otelcol-contrib` v0.143.0 eller senare: äldre byggen stannar vid start med `'receivers' unknown type: \"systemd\"` eller namnger CPU-mätvärdet annorlunda (se **Aktivera fliken Systemd-enheter**).",
  "3. Check the collector can reach the system D-Bus: `/run/dbus/system_bus_socket` must exist, and `systemctl list-units` run as the collector's user is the quickest test. Root is not required.":
    "3. Kontrollera att insamlaren når system-D-Bus: `/run/dbus/system_bus_socket` måste finnas, och `systemctl list-units` kört som insamlarens användare är det snabbaste testet. Root behövs inte.",
  "A RHEL, CentOS, Fedora or Amazon Linux host (x86_64 or aarch64) with `sudo`":
    "En RHEL-, CentOS-, Fedora- eller Amazon Linux-värd (x86_64 eller aarch64) med `sudo`",
  "A Linux host (x86_64 or aarch64) that runs systemd, with `sudo`":
    "En Linux-värd (x86_64 eller aarch64) som kör systemd, med `sudo`",
  "Drop a systemd unit at `/etc/systemd/system/otelcol-contrib.service`:":
    "Lägg en systemd-enhet i `/etc/systemd/system/otelcol-contrib.service`:",
  "Then enable and start it:": "Aktivera och starta den sedan:",
  "Use this when packages aren't available — locked-down servers, or container base images you want to instrument from outside. No `HOST_PROC` env vars or `/hostfs` mount are needed: the collector reads kernel state directly, and `User=root` lets the `process` scraper see processes owned by other users (granting `CAP_SYS_PTRACE` instead works too).":
    "Använd detta när det inte finns några paket — låsta servrar eller basavbildningar för containrar som du vill instrumentera utifrån. Inga `HOST_PROC`-miljövariabler eller `/hostfs`-montering behövs: insamlaren läser kärnans läge direkt, och `User=root` låter `process`-skrapan se andra användares processer (att ge den `CAP_SYS_PTRACE` fungerar också).",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so it needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "Mottagaren är **endast för Linux** och **alfa**. Den läser enheternas läge över system-D-Bus med samma skrivskyddade anrop som `systemctl list-units`, som systemd tillåter utan behörigheter, så den behöver inga extra behörigheter. En insamlare i en container når inte värdens buss, så använd en inbyggd installation. Så snart mätvärden kommer in fylls värdens flik **Systemd-enheter** med varje insamlad enhet och dess aktuella läge (`active`, `failed`, `inactive`, ...).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to `/opt/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Konfigurationen fyller redan i maskinens IP-adresser, MAC-adresser, arkitektur, maskin-id, OS-beskrivning och OS-version på dess objekt under **Inventarie**, vilket är det en CMDB-export läser. Serienummer, tillverkare, modell och firmwareversion (BIOS / UEFI) är annorlunda: **ingen resursdetektor kan ta fram dem.** De kommer från maskinens firmware via DMI. Läs av dem en gång vid provisioneringen och skriv fast dem på resursen — lägg till den här processorn i `/opt/otelcol-contrib/config.yaml` och nämn den i mätvärdespipelinen. Slå ihop den med de avsnitt som din konfiguration redan har — lägg inte till en andra `processors:`- eller `service:`-nyckel.",
  "A Mac (Apple silicon or Intel) and an administrator account for `sudo`":
    "En Mac (Apple silicon eller Intel) och ett administratörskonto för `sudo`",
  "Create `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:":
    "Skapa `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:",
  "Load it:": "Läs in den:",
  "> **Install the contrib build, as above.** The core `otelcol` build has no `resourcedetection` processor, so it refuses to start with this config.":
    "> **Installera contrib-bygget, som ovan.** Core-bygget `otelcol` har ingen `resourcedetection`-processor, så det vägrar starta med den här konfigurationen.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Konfigurationen fyller redan i maskinens IP-adresser, MAC-adresser, arkitektur, maskin-id, OS-beskrivning och OS-version på dess objekt under **Inventarie**, vilket är det en CMDB-export läser. Serienummer, tillverkare, modell och firmwareversion (BIOS / UEFI) är annorlunda: **ingen resursdetektor kan ta fram dem.** De kommer från maskinens firmware. Läs av dem en gång vid provisioneringen och skriv fast dem på resursen — lägg till den här processorn i `/etc/otelcol-contrib/config.yaml` och nämn den i mätvärdespipelinen. Slå ihop den med de avsnitt som din konfiguration redan har — lägg inte till en andra `processors:`- eller `service:`-nyckel.",
  "Then restart the collector:": "Starta sedan om insamlaren:",
  "The values are the machine's own, so they are written once by whatever provisions it. On a Mac, read them like this — the manufacturer is `Apple Inc.`:":
    "Värdena tillhör själva maskinen, så de skrivs en gång av det som provisionerar den. På en Mac läser du dem så här — tillverkaren är `Apple Inc.`:",
  "`hw.model` is the model *identifier* (`MacBookPro18,3`), not the marketing name. Put it in `device.model.name` anyway — `device.model.identifier` marks a batch as a mobile app.":
    "`hw.model` är modell-*identifieraren* (`MacBookPro18,3`), inte försäljningsnamnet. Lägg den ändå i `device.model.name` — `device.model.identifier` markerar en omgång som en mobilapp.",
  "Windows 10 1803+ or Windows Server 2019+ (for the built-in `tar.exe`)":
    "Windows 10 1803+ eller Windows Server 2019+ (för den inbyggda `tar.exe`)",
  "An elevated PowerShell prompt (Run as administrator)":
    "En PowerShell-prompt med utökade behörigheter (Kör som administratör)",
  "Save this as `config.yaml` in the folder you will run the PowerShell commands from — step 3 copies it into place.":
    "Spara detta som `config.yaml` i den mapp som du kör PowerShell-kommandona från — steg 3 kopierar den på plats.",
  "On Windows, install the upstream **`otelcol-contrib`** collector — from **v0.155.0** it bundles the `windows_service` receiver that powers the host **Services** tab. Run from an elevated PowerShell prompt:":
    "På Windows installerar du upstream-insamlaren **`otelcol-contrib`** — från **v0.155.0** har den med `windows_service`-mottagaren som driver värdens flik **Tjänster**. Kör från en PowerShell-prompt med utökade behörigheter:",
  "> **Note:** The service runs as `LocalSystem` so it can read every Windows service. On Windows the `load` scraper only emulates a load average from the *Processor Queue Length* counter (it starts at 0); if it can't read the counter it is logged and skipped, so the rest of the `hostmetrics` config runs unchanged. The [Host OpenTelemetry Collector docs](/docs/telemetry/host-otel-collector) also cover the signed `.msi` installer.":
    "> **Obs!** Tjänsten körs som `LocalSystem` så att den kan läsa alla Windows-tjänster. På Windows emulerar `load`-skrapan bara ett belastningsgenomsnitt utifrån räknaren *Processor Queue Length* (den börjar på 0); kan den inte läsa räknaren loggas det och hoppas över, och resten av `hostmetrics`-konfigurationen körs oförändrad. [Dokumentationen för OpenTelemetry Collector för värdar](/docs/telemetry/host-otel-collector) tar också upp det signerade `.msi`-installationsprogrammet.",
  "Logs are written to the Windows Application event log; view them in **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`).":
    "Loggar skrivs till Windows händelselogg Program; visa dem i **Event Viewer → Windows Logs → Application** (källa `otelcol-contrib`).",
  "From **v0.155.0** `otelcol-contrib` includes the `windows_service` receiver — turn it on by adding it to `C:\\Program Files\\otelcol-contrib\\config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Från **v0.155.0** har `otelcol-contrib` med `windows_service`-mottagaren — aktivera den genom att lägga till den i `C:\\Program Files\\otelcol-contrib\\config.yaml` och i mätvärdespipelinen. Slå ihop den med de avsnitt som din konfiguration redan har — lägg inte till en andra `processors:`- eller `service:`-nyckel.",
  "The receiver is **Windows-only** and **alpha**. Once metrics arrive, the host **Services** tab populates automatically with each service's running state and startup type.":
    "Mottagaren är **endast för Windows** och **alfa**. Så snart mätvärden kommer in fylls värdens flik **Tjänster** automatiskt med varje tjänsts körläge och starttyp.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through WMI.":
    "Konfigurationen fyller redan i maskinens IP-adresser, MAC-adresser, arkitektur, maskin-id, OS-beskrivning och OS-version på dess objekt under **Inventarie**, vilket är det en CMDB-export läser. Serienummer, tillverkare, modell och firmwareversion (BIOS / UEFI) är annorlunda: **ingen resursdetektor kan ta fram dem.** De kommer från maskinens firmware via WMI.",
  "Run this from an elevated PowerShell prompt on the machine — it queries WMI and prints the exact YAML for *this* machine:":
    "Kör detta från en PowerShell-prompt med utökade behörigheter på maskinen — det frågar WMI och skriver ut exakt YAML för *den här* maskinen:",
  "It prints one processor entry, already indented. Add it inside the `processors:` block your `config.yaml` already has — alongside `resourcedetection:`, `resource:` and `batch:`, not as a second `processors:` key — then name it in the metrics pipeline:":
    "Det skriver ut en processorpost, redan indragen. Lägg till den i `processors:`-blocket som din `config.yaml` redan har — bredvid `resourcedetection:`, `resource:` och `batch:`, inte som en andra `processors:`-nyckel — och nämn den sedan i mätvärdespipelinen:",
  "Use `Get-CimInstance`, not the deprecated `Get-WmiObject` — it is absent from PowerShell 7 and later. Values are emitted in single quotes with any embedded quote doubled, so a serial or model containing punctuation stays valid YAML. A field the firmware leaves empty prints as `''`; drop that attribute rather than shipping a blank one.":
    "Använd `Get-CimInstance`, inte det föråldrade `Get-WmiObject` — det saknas i PowerShell 7 och senare. Värdena skrivs ut inom enkla citattecken med inbäddade citattecken dubblerade, så att ett serienummer eller en modell med skiljetecken förblir giltig YAML. Ett fält som firmwaren lämnar tomt skrivs ut som `''`; utelämna det attributet i stället för att skicka ett tomt.",
  "Within a few minutes the machine's **Inventory** item shows `host.serial_number`, `device.manufacturer`, `device.model.name` and `device.firmware.version` under **Details**, alongside the IP and MAC addresses and machine id the detector already supplies. Run this again after a motherboard swap or a BIOS update — the values are stamped, not detected, so they do not update themselves.":
    "Inom några minuter visar maskinens objekt under **Inventarie** under **Detaljer** `host.serial_number`, `device.manufacturer`, `device.model.name` och `device.firmware.version`, bredvid IP- och MAC-adresserna och maskin-id:t som detektorn redan levererar. Kör detta igen efter ett moderkortsbyte eller en BIOS-uppdatering — värdena är fastskrivna, inte identifierade, så de uppdateras inte av sig själva.",
  "- The **Services** tab lists each service's state once the `windows_service` receiver is enabled (see **Enable the Windows Services tab**).":
    "- Fliken **Tjänster** listar varje tjänsts läge så snart `windows_service`-mottagaren är aktiverad (se **Aktivera fliken Windows-tjänster**).",
  "1. Read the collector's logs for export errors: **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`). An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `C:\\Program Files\\otelcol-contrib\\config.yaml`.":
    "1. Läs insamlarens loggar efter exportfel: **Event Viewer → Windows Logs → Application** (källa `otelcol-contrib`). En HTTP-`401` betyder att nyckeln saknas, är fel eller har gått ut; `422` att den har inaktiverats (eller är en webbläsarnyckel, som inte kan skicka värdtelemetri). Välj en fungerande nyckel i steg 1 och uppdatera `x-oneuptime-token` i `C:\\Program Files\\otelcol-contrib\\config.yaml`.",
  "1. Run the collector in the foreground to see the real error instead of the generic `Error 1064`:":
    "1. Kör insamlaren i förgrunden för att se det verkliga felet i stället för det allmänna `Error 1064`:",
  '2. `Error 2: The system cannot find the file specified` means the service points at a file that is not there — compare `BINARY_PATH_NAME` from `sc.exe qc "otelcol-contrib"` with the contents of `C:\\Program Files\\otelcol-contrib`. The archive must be the `otelcol-contrib_` one, which unpacks `otelcol-contrib.exe`.':
    '2. `Error 2: The system cannot find the file specified` betyder att tjänsten pekar på en fil som inte finns — jämför `BINARY_PATH_NAME` från `sc.exe qc "otelcol-contrib"` med innehållet i `C:\\Program Files\\otelcol-contrib`. Arkivet måste vara `otelcol-contrib_`-arkivet, som packar upp `otelcol-contrib.exe`.',
  "3. **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`) records the startup error the service manager swallowed.":
    "3. **Event Viewer → Windows Logs → Application** (källa `otelcol-contrib`) registrerar startfelet som tjänsthanteraren svalde.",
  "If you set `include_services` but still see every service, the collector hasn't picked up the edit — restart the service (`Restart-Service otelcol-contrib`) and give the Services tab a few minutes to refresh its rolling window.":
    "Om du sätter `include_services` men ändå ser alla tjänster har insamlaren inte tagit in ändringen — starta om tjänsten (`Restart-Service otelcol-contrib`) och ge fliken Tjänster några minuter att uppdatera sitt glidande fönster.",
  "Kubernetes nodes are monitored by the **OneUptime Kubernetes agent** rather than a host collector: each node appears under **Kubernetes** → your cluster → **Nodes**, next to its pods and workloads, not in the **Hosts** list. The steps below install the agent on a standard cluster; the install guide in the **Kubernetes** section has the steps for Amazon EKS, Google GKE, Azure AKS, GKE Autopilot and EKS Fargate.":
    "Kubernetes-noder övervakas av **OneUptime Kubernetes-agenten** i stället för av en värdinsamlare: varje nod visas under **Kubernetes** → ditt kluster → **Noder**, bredvid sina poddar och arbetslaster, inte i listan **Värdar**. Stegen nedan installerar agenten på ett standardkluster; installationsguiden i avsnittet **Kubernetes** har stegen för Amazon EKS, Google GKE, Azure AKS, GKE Autopilot och EKS Fargate.",
  "A Kubernetes cluster running v1.23 or later":
    "Ett Kubernetes-kluster med v1.23 eller senare",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` och `helm` (v3) installerade på din dator",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "Fel kluster? Byt med `kubectl config use-context <context-name>`.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "Ersätt `my-cluster` med ett namn på det här klustret, till exempel `prod-us-east-1`. Det är så klustret visas i OneUptime, så håll det stabilt: ett nytt namn registrerar ett nytt kluster.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` slår på **AI-utredningar**, som chartet gör som standard: OneUptime AI utreder incidenter och larm på det här klustret med skrivskyddad kubectl, via Kubernetes-AI-agenten.",
  "You should see:": "Du bör se:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Insamlaren och Kubernetes-AI-agenten, plus en `-logs`- och en `-ebpf`-pod på varje nod. När de är `Running` visas klustret automatiskt i avsnittet **Kubernetes**, oftast inom en eller ett par minuter.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Kubernetes-AI-agent (på som standard, skrivskyddad).** Podden `kubernetes-agent-ai-agent` låter OneUptime AI utreda incidenter och larm på det här klustret med skrivskyddad kubectl (`get`, `describe`, `logs`, `events`, `top`) med samma API-nyckel, och den kan inte ändra något om du inte senare ger den skrivbehörighet. Öppna klustret och gå till **AI → Agent** för att se den. Vill du inte ha den? Installera med `--set aiAgent.enabled=false` i stället för `--set aiAgent.enabled=true`.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "Namespace-regler avgör vad agenten samlar in från varje namespace. För att samla in poddloggar och eBPF-data bara från `default`, `production` och `staging`:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "För att behålla allt men stoppa loggarna från stökiga namespaces undantar du dem bara från `podLogs`:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **Omfattningar:** `podLogs` (containrarnas stdout/stderr), `ebpfDiscovery` (eBPF-spår och -mätvärden), `metrics` (mätvärden med namespace) och `traces` (varje span).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **Mönster** matchar hela namespace-namnet och godtar `*`, som i `team-*`. En `exclude`-regel vinner alltid över en `include`-regel.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **Egna regler ersätter standardregeln**, som undantar `kube-system` från `podLogs` och `ebpfDiscovery`. Behåll den i din lista, som i det andra exemplet, om du fortfarande vill det.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- Nod- och klustermätvärden har inget namespace, så de behålls alltid.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` kräver Helm 3.10 eller senare.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**Skicka bara viktiga rader.** Kasta poddloggrader under en allvarlighetsnivå innan de lämnar klustret:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    'Godtar `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` och `FATAL`: `WARN` behåller varningar, fel och fatala rader. Allvarlighetsnivån läses från själva loggraden (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes-händelser kastas aldrig av detta.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Stäng av poddloggar.** Mätvärden påverkas inte: nodinsamlaren fortsätter köra för kubelet- och cAdvisor-mätvärden och slutar bara läsa poddloggar:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**Ändra hur loggar läses.** Presetet väljer det åt dig; ett uttryckligt `logs.mode` vinner alltid:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: läser `/var/log/pods` på varje nod via hostPath (lägst overhead; kräver hostPath).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: ett Deployment följer poddloggar via Kubernetes-API:t (fungerar på alla kluster).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: inga poddloggar.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "Det läser API-servern, där den svarar inne i klustret. etcd, schemaläggaren och controller manager svarar på control plane-noderna, som agentens podd inte kan gissa, så den läser dem så snart du anger varje nods adress:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **Schemaläggaren och controller manager** levererar HTTPS och godtar agentens token, men kubeadm binder dem till `127.0.0.1`: ge dem en `--bind-address` som agentens podd kan nå.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** levererar sina mätvärden över vanlig HTTP på kubeadms `--listen-metrics-urls` (port 2381, bunden till `127.0.0.1` tills du lägger till nodens adress), som ovan. Eller läs av dess HTTPS-klientport, 2379, med det klientcertifikat den begär: lägg `ca.crt`, `tls.crt` och `tls.key` i en Secret i `oneuptime-agent` och ange den i `controlPlane.etcd.clientCertSecret`.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "Bara för självhanterade kluster: hanterade tjänster (EKS, GKE, AKS) exponerar inte mätvärden från sitt control plane.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "Kostnadsövervakning är på som standard: agenten har med sig open source-motorn OpenCost (plus den lilla Prometheus den behöver), prissätter dina noder och volymer efter molnleverantörens offentliga listpriser, utan inloggningsuppgifter, och skickar vad varje namespace och workload kostar. De första data visas på klustrets översikt och sida Kostnader efter den första hela timmen.",
  "On an agent installed before it was on by default, upgrade it:":
    "Uppgradera en agent som installerades innan det var på som standard:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **Stäng av det:** lägg till `--set cost.enabled=false` i samma uppgradering.",
  "- **Already running Kubecost or OpenCost?** Point the agent at it instead, and nothing is bundled: add `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` (or your Kubecost service).":
    "- **Kör du redan Kubecost eller OpenCost?** Peka i stället agenten mot den, så följer ingenting med: lägg till `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` (eller din Kubecost-tjänst).",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **Lokalt eller bare metal?** Ange en prislista med `--set cost.opencost.customPricing.enabled=true` (USD per resurstimme; se chartets `values.yaml`).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "Fullständig guide: [Kostnadsövervakning för Kubernetes](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "Agenten kör [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) på varje nod. Den fångar HTTP/HTTPS-, gRPC- och SQL/Redis-trafik från tjänster i Go, .NET, Java, Node.js, Python, Ruby och Rust, utan SDK och utan sidecar, och skickar spår, förfrågningsmätvärden (RED) och data för tjänstegrafen via insamlaren.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**Krav:** Linux-kärna **5.8+** med BTF (standard på Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). eBPF-poddarna körs **privilegierade**, vilket de behöver för att läsa in eBPF-program.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "**Stäng av det** om dina noder kör en äldre kärna, om privilegierade poddar inte är tillåtna, eller om dina tjänster redan skickar spår med OpenTelemetry-SDK:er och du inte vill ha dubbletter:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**Välj signalerna.** Varje familj slås på eller av med `--set ebpf.features.<name>=false` (eller `=true`):",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | Standard | Vad den lägger till |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | på | HTTP/gRPC-förfrågningsfrekvens, fel och latens per tjänst |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | på | Antal anrop och varaktighet för spans (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | på | Kanter från anropare → anropad; driver tjänstekartan |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | på | Räknare för TCP/UDP-flöden från podd till podd |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | av | Nätverksmätvärden mellan zoner (fördubblar deras kardinalitet) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | på | TCP-RTT och räknare för misslyckade anslutningar och omsändningar per nod |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**Spårspridning mellan tjänster** (att knyta en förfrågan som går från podd A → podd B till ett enda spår, även på en annan nod) är **på som standard**. Den fungerar genom att skriva om trafik som redan är på väg (den breddar HTTP-förfrågningar i klartext i kärnan och lägger till ett TCP-alternativ i TLS och rå TCP), och ett fel i den byteräkningen får dataströmmen ur takt: det rapporterade symptomet är överföringar genom en L7-proxy som nginx som hänger sig så snart ett svar passerar ~64KB. Om du ser det, eller om ett service mesh börjar få poddar att fallera, stänger du av den med `--set ebpf.contextPropagation=false`; ett OpenTelemetry-SDK sprider `traceparent` i userspace utan något av detta.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Varje `oneuptime.labels.<key>=<value>` blir etiketten `<key>:<value>` på klustret och på de tjänster och värdar det rapporterar. Etiketter jämförs utan hänsyn till skiftläge, så en befintlig etikett `Production` återanvänds; etiketter som lagts till i OneUptimes gränssnitt tas aldrig bort av agenten.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**Uppgradera** till det senaste chartet. `--reset-then-reuse-values` (Helm 3.14+) behåller de värden du har satt (preset, klusternamn, filter) och tar allt annat från det nya chartet; lägg till eventuella nya `--set`-flaggor ovanpå:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "Med Helm 3.13 och äldre uppgraderar du i stället med de värden du har satt:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "Använd inte `--reuse-values`: det behåller också standardvärdena från det chart du uppgraderar från, så ett nyare charts standardvärden (bland dem dess eBPF-image) börjar aldrig gälla.",
  "**Uninstall** the agent and its namespace:":
    "**Avinstallera** agenten och dess namespace:",
  "| Category | Data |": "| Kategori | Data |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **Nodmätvärden** | Användning av CPU, minne, filsystem och nätverk |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Podd- och containermätvärden** | CPU, minne, nätverks-I/O och omstarter |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **Klustermätvärden** | Nodtillstånd, allokerbara resurser, antal poddar och workloads |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Kubernetes-händelser** | Varningar, fel och schemaläggningshändelser |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Poddloggar** | stdout/stderr för varje container, lästa på varje nod |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **Applikationsspår** *(eBPF)* | HTTP-, gRPC- och SQL/Redis-spans från varje podd, utan SDK eller kodändringar |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **Förfrågningsmätvärden och tjänstegraf** *(eBPF)* | Förfrågningsfrekvens, fel och latens per tjänst, och kanter från anropare → anropad för tjänstekartan |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **Nätverksflöden** *(eBPF)* | Räknare för TCP/UDP-byte och -paket från podd till podd |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **Workloadkostnader** *(på som standard)* | Kostnad per namespace, workload och podd, med outnyttjad kapacitet och effektivitet, även som mätvärden att larma på |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "Ditt kluster blockerar `hostPath`-volymer eller privilegierade poddar. Det är normalt på **GKE Autopilot** och **EKS Fargate**: välj den plattformen högst upp i den här guiden och följ dess steg. På **OpenShift** lyckas installationen däremot, men agentens nodpoddar startar aldrig: välj **Red Hat OpenShift**.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "På alla andra kluster med en restriktiv Pod Security-princip tar du bort den misslyckade releasen:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "Kör sedan installationskommandot igen med `--set preset=gke-autopilot` tillagt. Det presetet läser poddloggar via Kubernetes-API:t i stället för hostPath, tillämpar en härdad säkerhetskontext och utelämnar de privilegierade eBPF- och profileringspoddarna.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. Kontrollera att agentens poddar körs: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. Kontrollera insamlarens loggar: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. Bekräfta att OneUptime-URL:en och intagningsnyckeln i installationskommandot är korrekta.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. Se till att klustret når din OneUptime-instans över nätverket.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. Kontrollera AI-agentens podd: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. Kontrollera dess loggar: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. Ingen podd? Uppgradera chartet (se **Uppgradera eller avinstallera agenten** under Avancerad) och lägg till `--set aiAgent.enabled=true`.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. Kontrollera att klusternamnet stämmer: den här guiden installerar **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. Bekräfta agentens RBAC-behörigheter: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Leta efter exportfel i insamlarens loggar: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **Kärnan är för gammal eller saknar BTF.** eBPF kräver Linux 5.8+ med BTF; kontrollera med `uname -r` på en nod. Om du inte kan uppgradera stänger du av eBPF med `--set ebpf.enabled=false`.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **Privilegierade poddar blockeras.** Vissa låsta kluster avvisar dem. Stäng av eBPF.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` finns inte på värden.** Stäng bara av familjen med TCP-statistik: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. Kontrollera att eBPF-poddarna är friska: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. Slå på OBI:s felsökningsutdata för att bekräfta att den ser trafik: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, och läs sedan `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Om spans dyker upp där men inte i OneUptime letar du efter exportfel i insamlarens loggar: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
};

export default TRANSLATION;
