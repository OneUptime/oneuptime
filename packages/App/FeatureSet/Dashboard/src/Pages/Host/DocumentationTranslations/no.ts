import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Host setup guide in Norwegian (#8341): each piece of the English
 * guide's markdown (Pages/Host/Utils/DocumentationMarkdown.ts) and its
 * Norwegian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Norwegian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker installed on the host you want to monitor":
    "Docker installert på verten du vil overvåke",
  "Network access from the host to your OneUptime instance":
    "Nettverkstilgang fra verten til OneUptime-instansen din",
  "Save this as `config.yaml` in the directory you will run `docker run` from — step 3 mounts it into the container.":
    "Lagre dette som `config.yaml` i mappen du kjører `docker run` fra — trinn 3 monterer den i containeren.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Velg en inntaksnøkkel i trinn 1 for å fylle inn `<YOUR_API_KEY>`.",
  "`--network host`, `--pid host`, and the `/hostfs` bind mount let the `hostmetrics` and `process` scrapers read CPU, memory, disk, and per-process information from the host kernel rather than the container. Without these, you'd only see metrics for the collector container itself.":
    "`--network host`, `--pid host` og bind-monteringen `/hostfs` lar skraperne `hostmetrics` og `process` lese CPU-, minne-, disk- og prosessdata fra vertens kjerne i stedet for containerens. Uten dem ville du bare se målinger for selve innsamlercontaineren.",
  "Open the **Hosts** list in OneUptime — your host appears automatically once the first metric batch lands (usually within 30 seconds). Not there? Check the collector:":
    "Åpne listen **Verter** i OneUptime — verten dukker opp automatisk så snart den første batchen med målinger kommer (vanligvis innen 30 sekunder). Ikke der? Sjekk innsamleren:",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer, so add it on Linux hosts only; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**KI-undersøkelser er på som standard** for alle verter: Så snart vertens AI-agent kjører på den, undersøker OneUptime AI hendelser og varsler der med skrivebeskyttede kommandoer som `systemctl status`, `df -h`, `free -m` og `ps aux`, og endrer ingenting med mindre du tillater rettelser. Den er en Linux-container med eget installasjonsprogram, så legg den bare til på Linux-verter; den trenger Docker (systemmotoren, ikke rootless Docker) med Compose-pluginen:",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. It asks for your OneUptime URL, the ingestion key and the host's name — leave the name empty to use the hostname, which is what this collector reports. Once it connects, it shows as Connected on the host's **AI → AI agent** page and at the bottom of its **Overview**. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#hosts).":
    "Den første linjen laster ned skriptet som `install.sh`, så du kan lese det før du kjører det. Det spør etter OneUptime-URL-en, inntaksnøkkelen og vertens navn — la navnet stå tomt for å bruke vertsnavnet, som er det denne innsamleren rapporterer. Når den er tilkoblet, vises den som tilkoblet på vertens side **KI → AI-agent** og nederst i **Oversikt**. Hva den kan kjøre, og hvordan rettelser virker: [KI-agenter for infrastruktur](/docs/ai/infrastructure-ai-agents#hosts).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to the `config.yaml` you mounted into the container and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Konfigurasjonen fyller allerede inn maskinens IP-adresser, MAC-adresser, arkitektur, maskin-ID, OS-beskrivelse og OS-versjon på elementet dens under **Inventar**, som er det en CMDB-eksport leser. Serienummer, produsent, modell og fastvareversjon (BIOS / UEFI) er annerledes: **ingen ressursdetektor kan levere dem.** De kommer fra maskinens fastvare via DMI. Les dem én gang ved klargjøringen og skriv dem fast på ressursen — legg til denne prosessoren i `config.yaml`-filen du monterte i containeren og nevn den i målingspipelinen. Flett den inn i seksjonene konfigurasjonen din allerede har — ikke legg til en ekstra `processors:`- eller `service:`-nøkkel.",
  "Then recreate the container so it reads the edited file — remove it, and run the `docker run` command from step 3 again:":
    "Gjenopprett deretter containeren så den leser den redigerte filen — fjern den og kjør `docker run`-kommandoen fra trinn 3 på nytt:",
  "The values are the machine's own, so they are written once by whatever provisions it. On Linux, read them as root (`bios_version` is readable by anyone):":
    "Verdiene hører til selve maskinen, så de skrives én gang av det som klargjør den. På Linux leser du dem som root (`bios_version` kan leses av alle):",
  "Within a few minutes the values show on the machine's **Inventory** item under **Details**. They are stamped, not detected, so run this again after a motherboard swap or a firmware update.":
    "Innen noen minutter vises verdiene på maskinens element under **Inventar** under **Detaljer**. De er skrevet fast, ikke oppdaget, så kjør dette på nytt etter et hovedkortbytte eller en fastvareoppdatering.",
  "`host.manufacturer`, `host.model.name`, `host.firmware.version` and `host.bios.version` are accepted as alternative spellings and stored under the `device.*` keys above (and `device.serial_number` under `host.serial_number`), so a config written either way ends up in one place.":
    "`host.manufacturer`, `host.model.name`, `host.firmware.version` og `host.bios.version` godtas som alternative stavemåter og lagres under `device.*`-nøklene ovenfor (og `device.serial_number` under `host.serial_number`), så en konfigurasjon skrevet på den ene eller andre måten havner på ett sted.",
  "> **Don't set `device.manufacturer` on a mobile app's resource and a host's from the same config.** On a resource that carries no `host.name` or `host.id`, `device.manufacturer` still marks the batch as mobile Real User Monitoring.":
    "> **Ikke sett `device.manufacturer` på ressursen til en mobilapp og på en verts ressurs fra samme konfigurasjon.** På en ressurs uten `host.name` eller `host.id` markerer `device.manufacturer` fortsatt batchen som mobil Real User Monitoring.",
  "Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the host (and to the telemetry service emitted from this collector). Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.":
    "Ethvert ressursattributt med prefikset `oneuptime.label.` blir en prosjektetikett knyttet til verten (og til telemetritjenesten denne innsamleren sender ut). Mønster: `oneuptime.label.<dimension>=<value>` blir en etikett med navnet `<dimension>:<value>`.",
  "Add a `resource` processor to the `config.yaml` you mounted into the container and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Legg til en `resource`-prosessor i `config.yaml`-filen du monterte i containeren og henvis til den fra målingspipelinen. Flett den inn i seksjonene konfigurasjonen din allerede har — ikke legg til en ekstra `processors:`- eller `service:`-nøkkel.",
  "The host shows up tagged `team:payments`, `env:production`, and `region:us-east-1`. Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated. Labels added manually in the OneUptime UI are never removed by the collector.":
    "Verten vises med etikettene `team:payments`, `env:production` og `region:us-east-1`. Etiketter sammenlignes uten hensyn til store og små bokstaver, så en eksisterende, manuelt opprettet etikett `Production` gjenbrukes i stedet for å dupliseres. Etiketter som er lagt til manuelt i OneUptime-grensesnittet, fjernes aldri av innsamleren.",
  "Hosts are auto-discovered from the OTel `host.name` resource attribute, which the `resourcedetection` processor sets. OneUptime registers the host once a batch that carries `host.name` also carries any of:":
    "Verter oppdages automatisk ut fra OTel-ressursattributtet `host.name`, som `resourcedetection`-prosessoren setter. OneUptime registrerer verten så snart en batch med `host.name` også inneholder ett av disse:",
  "- `hostmetrics` receiver metrics (CPU, memory, disk, filesystem, network, load, processes), OR":
    "- målinger fra `hostmetrics`-mottakeren (CPU, minne, disk, filsystem, nettverk, last, prosesser), ELLER",
  "- `process` scraper metrics (per-process CPU/memory/threads), OR":
    "- målinger fra `process`-skraperen (CPU/minne/tråder per prosess), ELLER",
  "- an `os.type` or `container.runtime` resource attribute, on metrics, logs or traces":
    "- et ressursattributt `os.type` eller `container.runtime`, på målinger, logger eller sporinger",
  "…and starts populating the Overview, Metrics, Processes, and Logs tabs. `host.id` or `host.arch` alone do not register a host, and telemetry that carries a Kubernetes identity (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) is filed under its Kubernetes cluster instead.":
    "…og begynner å fylle fanene Oversikt, Målinger, Prosesser og Logger. `host.id` eller `host.arch` alene registrerer ikke en vert, og telemetri med en Kubernetes-identitet (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) arkiveres i stedet under sin Kubernetes-klynge.",
  "**Running on OpenStack?** Use `detectors: [nova, system, env]`, so `host.id` is the instance's UUID and OneUptime links this host to its instance, and set `host.name` to `enabled: false` under `nova: resource_attributes:` so its name stays the one `system` reports.":
    "**Kjører den på OpenStack?** Bruk `detectors: [nova, system, env]`, så `host.id` blir instansens UUID og OneUptime knytter denne verten til instansen sin, og sett `host.name` til `enabled: false` under `nova: resource_attributes:`, så navnet forblir det `system` rapporterer.",
  "The same resource attributes become the machine's **Inventory** item, which is what a CMDB export reads. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` and `os.version` all come from the `resourcedetection` processor; serial number, make, model and firmware version have no detector and are stamped on separately (see **Record the serial number, make, model and firmware version**).":
    "De samme ressursattributtene blir maskinens element under **Inventar**, som er det en CMDB-eksport leser. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` og `os.version` kommer alle fra `resourcedetection`-prosessoren; serienummer, produsent, modell og fastvareversjon har ingen detektor og skrives fast separat (se **Registrer serienummer, produsent, modell og fastvareversjon**).",
  "Once the host is reporting:": "Når verten rapporterer:",
  "- The **Metrics** tab visualizes `system.*` time-series.":
    "- Fanen **Målinger** viser `system.*`-tidsserier.",
  "- The **Processes** tab lists processes ordered by CPU once the `process` scraper is enabled.":
    "- Fanen **Prosesser** viser prosesser sortert etter CPU så snart `process`-skraperen er slått på.",
  "- The **Logs** tab streams any logs whose resource attributes include `host.name`.":
    "- Fanen **Logger** viser fortløpende alle logger med ressursattributter som inneholder `host.name`.",
  "The config reports the collector release it is for (`oneuptime.agent.version`) as the host's **Agent Version**. When this OneUptime pins a newer release, a warning sign beside it opens these steps.":
    "Konfigurasjonen rapporterer innsamlerutgivelsen den er skrevet for (`oneuptime.agent.version`), som vertens **Agentversjon**. Når denne OneUptime låser til en nyere utgivelse, åpner et varseltegn ved siden av disse trinnene.",
  "1. Save the config from step 2 again, with the same ingestion key: it reports the new version. Copy across any change you made to yours.":
    "1. Lagre konfigurasjonen fra trinn 2 på nytt med samme inntaksnøkkel: Den rapporterer den nye versjonen. Ta med deg enhver endring du gjorde i din.",
  "2. In the folder that holds it, install the new release and restart the collector:":
    "2. Installer den nye utgivelsen i mappen som inneholder den, og start innsamleren på nytt:",
  "1. Read the collector's logs for export errors: `docker logs -f otel-collector`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in the `config.yaml` you mounted into the container.":
    "1. Les innsamlerens logger for eksportfeil: `docker logs -f otel-collector`. En HTTP-`401` betyr at nøkkelen mangler, er feil eller er utløpt; `422` at den er deaktivert (eller er en nettlesernøkkel, som ikke kan sende vertstelemetri). Velg en nøkkel som virker i trinn 1, og oppdater `x-oneuptime-token` i `config.yaml`-filen du monterte i containeren.",
  "2. Check the host can reach OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` from the same machine.":
    "2. Sjekk at verten når OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` fra samme maskin.",
  "3. Keep `resourcedetection` in the metrics pipeline — it sets `host.name`, which is how OneUptime recognises the host.":
    "3. Behold `resourcedetection` i målingspipelinen — den setter `host.name`, som er det OneUptime kjenner igjen verten på.",
  "The collector is reading its own container's kernel view. Run it with `--network host`, `--pid host`, the `/:/hostfs` bind mount and the `HOST_*` variables exactly as step 3 shows — without them the `hostmetrics` and `process` scrapers only see the collector container itself.":
    "Innsamleren leser kjernevisningen til sin egen container. Kjør den med `--network host`, `--pid host`, bind-monteringen `/:/hostfs` og `HOST_*`-variablene nøyaktig slik trinn 3 viser — uten dem ser skraperne `hostmetrics` og `process` bare selve innsamlercontaineren.",
  "A Debian or Ubuntu host (amd64 or arm64) with `sudo`":
    "En Debian- eller Ubuntu-vert (amd64 eller arm64) med `sudo`",
  "Save this as `config.yaml` in your current directory — step 3 installs it.":
    "Lagre dette som `config.yaml` i gjeldende mappe — trinn 3 installerer den.",
  "> **Note for native installs:** Unlike Docker, the package install reads `/proc` and `/sys` directly — no `HOST_PROC` env vars or `/hostfs` mount required. The systemd unit shipped with the package runs as the unprivileged `otelcol-contrib` user; if you want the `process` scraper to see processes owned by other users, grant it `CAP_SYS_PTRACE` or run it as root.":
    "> **Merknad om native installasjoner:** I motsetning til Docker leser pakkeinstallasjonen `/proc` og `/sys` direkte — ingen `HOST_PROC`-miljøvariabler eller `/hostfs`-montering trengs. systemd-enheten som følger med pakken, kjører som den upriviligerte brukeren `otelcol-contrib`; skal `process`-skraperen se andre brukeres prosesser, gir du den `CAP_SYS_PTRACE` eller kjører den som root.",
  "`otelcol-contrib` has bundled the `systemd` receiver since **v0.142.0**; run **v0.143.0 or newer**, which is where its CPU metric settled on its current name and stopped probing non-service units. Turn it on by adding it to `/etc/otelcol-contrib/config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "`otelcol-contrib` har hatt `systemd`-mottakeren med siden **v0.142.0**; kjør **v0.143.0 eller nyere**, der CPU-målingen fikk sitt nåværende navn og den sluttet å spørre enheter som ikke er tjenester. Slå den på ved å legge den til i `/etc/otelcol-contrib/config.yaml` og målingspipelinen. Flett den inn i seksjonene konfigurasjonen din allerede har — ikke legg til en ekstra `processors:`- eller `service:`-nøkkel.",
  "Then restart the service:": "Start deretter tjenesten på nytt:",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so the packaged service — which runs as the `otelcol-contrib` user — needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "Mottakeren er **bare for Linux** og **alfa**. Den leser enhetenes tilstand over system-D-Bus med de samme skrivebeskyttede kallene som `systemctl list-units`, som systemd tillater uten rettigheter, så pakketjenesten — som kjører som brukeren `otelcol-contrib` — trenger ingen ekstra rettigheter. En innsamler i en container når ikke vertens buss, så bruk en native installasjon. Så snart målingene kommer, fylles vertens fane **Systemd-enheter** med hver innsamlede enhet og dens nåværende tilstand (`active`, `failed`, `inactive`, ...).",
  "Each unit costs eight datapoints per scrape for the state set, plus two more if you leave the CPU metric on, so on a host with hundreds of units narrow `units:` or raise `collection_interval` rather than scraping everything.":
    "Hver enhet koster åtte datapunkter per innsamling for tilstandssettet, pluss to til hvis du lar CPU-målingen stå på, så på en vert med hundrevis av enheter bør du snevre inn `units:` eller øke `collection_interval` i stedet for å samle inn alt.",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**KI-undersøkelser er på som standard** for alle verter: Så snart vertens AI-agent kjører på den, undersøker OneUptime AI hendelser og varsler der med skrivebeskyttede kommandoer som `systemctl status`, `df -h`, `free -m` og `ps aux`, og endrer ingenting med mindre du tillater rettelser. Den er en Linux-container med eget installasjonsprogram; den trenger Docker (systemmotoren, ikke rootless Docker) med Compose-pluginen:",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI, and the packaged collector runs unprivileged, so it cannot read them itself. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Konfigurasjonen fyller allerede inn maskinens IP-adresser, MAC-adresser, arkitektur, maskin-ID, OS-beskrivelse og OS-versjon på elementet dens under **Inventar**, som er det en CMDB-eksport leser. Serienummer, produsent, modell og fastvareversjon (BIOS / UEFI) er annerledes: **ingen ressursdetektor kan levere dem.** De kommer fra maskinens fastvare via DMI, og pakke-innsamleren kjører uten rettigheter, så den kan ikke lese dem selv. Les dem én gang ved klargjøringen og skriv dem fast på ressursen — legg til denne prosessoren i `/etc/otelcol-contrib/config.yaml` og nevn den i målingspipelinen. Flett den inn i seksjonene konfigurasjonen din allerede har — ikke legg til en ekstra `processors:`- eller `service:`-nøkkel.",
  "Add a `resource` processor to `/etc/otelcol-contrib/config.yaml` and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Legg til en `resource`-prosessor i `/etc/otelcol-contrib/config.yaml` og henvis til den fra målingspipelinen. Flett den inn i seksjonene konfigurasjonen din allerede har — ikke legg til en ekstra `processors:`- eller `service:`-nøkkel.",
  "- The **Systemd Units** tab lists unit state once the `systemd` receiver is enabled (see **Enable the Systemd Units tab**).":
    "- Fanen **Systemd-enheter** viser enhetenes tilstand så snart `systemd`-mottakeren er slått på (se **Slå på fanen Systemd-enheter**).",
  "1. Read the collector's logs for export errors: `sudo journalctl -u otelcol-contrib -f`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `/etc/otelcol-contrib/config.yaml`.":
    "1. Les innsamlerens logger for eksportfeil: `sudo journalctl -u otelcol-contrib -f`. En HTTP-`401` betyr at nøkkelen mangler, er feil eller er utløpt; `422` at den er deaktivert (eller er en nettlesernøkkel, som ikke kan sende vertstelemetri). Velg en nøkkel som virker i trinn 1, og oppdater `x-oneuptime-token` i `/etc/otelcol-contrib/config.yaml`.",
  "1. Keep `resourcedetection` in the same metrics pipeline as the `systemd` receiver — the receiver attaches only `systemd.unit.name` to each unit, so without `host.name` the samples never attach to the host.":
    "1. Behold `resourcedetection` i samme målingspipeline som `systemd`-mottakeren — mottakeren knytter bare `systemd.unit.name` til hver enhet, så uten `host.name` blir prøvene aldri knyttet til verten.",
  "2. Run `otelcol-contrib` v0.143.0 or newer: older builds stop at startup with `'receivers' unknown type: \"systemd\"`, or name the CPU metric differently (see **Enable the Systemd Units tab**).":
    "2. Kjør `otelcol-contrib` v0.143.0 eller nyere: Eldre bygg stopper ved oppstart med `'receivers' unknown type: \"systemd\"` eller gir CPU-målingen et annet navn (se **Slå på fanen Systemd-enheter**).",
  "3. Check the collector can reach the system D-Bus: `/run/dbus/system_bus_socket` must exist, and `systemctl list-units` run as the collector's user is the quickest test. Root is not required.":
    "3. Sjekk at innsamleren når system-D-Bus: `/run/dbus/system_bus_socket` må finnes, og `systemctl list-units` kjørt som innsamlerens bruker er den raskeste testen. Root trengs ikke.",
  "A RHEL, CentOS, Fedora or Amazon Linux host (x86_64 or aarch64) with `sudo`":
    "En RHEL-, CentOS-, Fedora- eller Amazon Linux-vert (x86_64 eller aarch64) med `sudo`",
  "A Linux host (x86_64 or aarch64) that runs systemd, with `sudo`":
    "En Linux-vert (x86_64 eller aarch64) som kjører systemd, med `sudo`",
  "Drop a systemd unit at `/etc/systemd/system/otelcol-contrib.service`:":
    "Legg en systemd-enhet i `/etc/systemd/system/otelcol-contrib.service`:",
  "Then enable and start it:": "Aktiver og start den deretter:",
  "Use this when packages aren't available — locked-down servers, or container base images you want to instrument from outside. No `HOST_PROC` env vars or `/hostfs` mount are needed: the collector reads kernel state directly, and `User=root` lets the `process` scraper see processes owned by other users (granting `CAP_SYS_PTRACE` instead works too).":
    "Bruk dette når det ikke finnes pakker — låste servere, eller basisbilder for containere du vil instrumentere utenfra. Det trengs ingen `HOST_PROC`-miljøvariabler eller `/hostfs`-montering: Innsamleren leser kjernens tilstand direkte, og `User=root` lar `process`-skraperen se andre brukeres prosesser (å gi `CAP_SYS_PTRACE` virker også).",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so it needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "Mottakeren er **bare for Linux** og **alfa**. Den leser enhetenes tilstand over system-D-Bus med de samme skrivebeskyttede kallene som `systemctl list-units`, som systemd tillater uten rettigheter, så den trenger ingen ekstra rettigheter. En innsamler i en container når ikke vertens buss, så bruk en native installasjon. Så snart målingene kommer, fylles vertens fane **Systemd-enheter** med hver innsamlede enhet og dens nåværende tilstand (`active`, `failed`, `inactive`, ...).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to `/opt/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Konfigurasjonen fyller allerede inn maskinens IP-adresser, MAC-adresser, arkitektur, maskin-ID, OS-beskrivelse og OS-versjon på elementet dens under **Inventar**, som er det en CMDB-eksport leser. Serienummer, produsent, modell og fastvareversjon (BIOS / UEFI) er annerledes: **ingen ressursdetektor kan levere dem.** De kommer fra maskinens fastvare via DMI. Les dem én gang ved klargjøringen og skriv dem fast på ressursen — legg til denne prosessoren i `/opt/otelcol-contrib/config.yaml` og nevn den i målingspipelinen. Flett den inn i seksjonene konfigurasjonen din allerede har — ikke legg til en ekstra `processors:`- eller `service:`-nøkkel.",
  "A Mac (Apple silicon or Intel) and an administrator account for `sudo`":
    "En Mac (Apple silicon eller Intel) og en administratorkonto for `sudo`",
  "Create `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:":
    "Opprett `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:",
  "Load it:": "Last den inn:",
  "> **Install the contrib build, as above.** The core `otelcol` build has no `resourcedetection` processor, so it refuses to start with this config.":
    "> **Installer contrib-bygget, som ovenfor.** Core-bygget `otelcol` har ingen `resourcedetection`-prosessor, så det nekter å starte med denne konfigurasjonen.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Konfigurasjonen fyller allerede inn maskinens IP-adresser, MAC-adresser, arkitektur, maskin-ID, OS-beskrivelse og OS-versjon på elementet dens under **Inventar**, som er det en CMDB-eksport leser. Serienummer, produsent, modell og fastvareversjon (BIOS / UEFI) er annerledes: **ingen ressursdetektor kan levere dem.** De kommer fra maskinens fastvare. Les dem én gang ved klargjøringen og skriv dem fast på ressursen — legg til denne prosessoren i `/etc/otelcol-contrib/config.yaml` og nevn den i målingspipelinen. Flett den inn i seksjonene konfigurasjonen din allerede har — ikke legg til en ekstra `processors:`- eller `service:`-nøkkel.",
  "Then restart the collector:": "Start deretter innsamleren på nytt:",
  "The values are the machine's own, so they are written once by whatever provisions it. On a Mac, read them like this — the manufacturer is `Apple Inc.`:":
    "Verdiene hører til selve maskinen, så de skrives én gang av det som klargjør den. På en Mac leser du dem slik — produsenten er `Apple Inc.`:",
  "`hw.model` is the model *identifier* (`MacBookPro18,3`), not the marketing name. Put it in `device.model.name` anyway — `device.model.identifier` marks a batch as a mobile app.":
    "`hw.model` er modell-*ID-en* (`MacBookPro18,3`), ikke salgsnavnet. Sett den likevel i `device.model.name` — `device.model.identifier` markerer en batch som en mobilapp.",
  "Windows 10 1803+ or Windows Server 2019+ (for the built-in `tar.exe`)":
    "Windows 10 1803+ eller Windows Server 2019+ (for den innebygde `tar.exe`)",
  "An elevated PowerShell prompt (Run as administrator)":
    "En PowerShell-ledetekst med forhøyede rettigheter (Kjør som administrator)",
  "Save this as `config.yaml` in the folder you will run the PowerShell commands from — step 3 copies it into place.":
    "Lagre dette som `config.yaml` i mappen du kjører PowerShell-kommandoene fra — trinn 3 kopierer den på plass.",
  "On Windows, install the upstream **`otelcol-contrib`** collector — from **v0.155.0** it bundles the `windows_service` receiver that powers the host **Services** tab. Run from an elevated PowerShell prompt:":
    "På Windows installerer du upstream-innsamleren **`otelcol-contrib`** — fra **v0.155.0** har den med `windows_service`-mottakeren som driver vertens fane **Tjenester**. Kjør fra en PowerShell-ledetekst med forhøyede rettigheter:",
  "> **Note:** The service runs as `LocalSystem` so it can read every Windows service. On Windows the `load` scraper only emulates a load average from the *Processor Queue Length* counter (it starts at 0); if it can't read the counter it is logged and skipped, so the rest of the `hostmetrics` config runs unchanged. The [Host OpenTelemetry Collector docs](/docs/telemetry/host-otel-collector) also cover the signed `.msi` installer.":
    "> **Merk:** Tjenesten kjører som `LocalSystem` så den kan lese alle Windows-tjenester. På Windows emulerer `load`-skraperen bare et lastgjennomsnitt ut fra telleren *Processor Queue Length* (den starter på 0); kan den ikke lese telleren, logges det og hoppes over, og resten av `hostmetrics`-konfigurasjonen kjører uendret. [Dokumentasjonen for OpenTelemetry Collector for verter](/docs/telemetry/host-otel-collector) dekker også det signerte `.msi`-installasjonsprogrammet.",
  "Logs are written to the Windows Application event log; view them in **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`).":
    "Logger skrives til Windows' hendelseslogg Program; se dem i **Event Viewer → Windows Logs → Application** (kilde `otelcol-contrib`).",
  "From **v0.155.0** `otelcol-contrib` includes the `windows_service` receiver — turn it on by adding it to `C:\\Program Files\\otelcol-contrib\\config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Fra **v0.155.0** har `otelcol-contrib` med `windows_service`-mottakeren — slå den på ved å legge den til i `C:\\Program Files\\otelcol-contrib\\config.yaml` og målingspipelinen. Flett den inn i seksjonene konfigurasjonen din allerede har — ikke legg til en ekstra `processors:`- eller `service:`-nøkkel.",
  "The receiver is **Windows-only** and **alpha**. Once metrics arrive, the host **Services** tab populates automatically with each service's running state and startup type.":
    "Mottakeren er **bare for Windows** og **alfa**. Så snart målingene kommer, fylles vertens fane **Tjenester** automatisk med hver tjenestes kjøretilstand og oppstartstype.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through WMI.":
    "Konfigurasjonen fyller allerede inn maskinens IP-adresser, MAC-adresser, arkitektur, maskin-ID, OS-beskrivelse og OS-versjon på elementet dens under **Inventar**, som er det en CMDB-eksport leser. Serienummer, produsent, modell og fastvareversjon (BIOS / UEFI) er annerledes: **ingen ressursdetektor kan levere dem.** De kommer fra maskinens fastvare via WMI.",
  "Run this from an elevated PowerShell prompt on the machine — it queries WMI and prints the exact YAML for *this* machine:":
    "Kjør dette fra en PowerShell-ledetekst med forhøyede rettigheter på maskinen — det spør WMI og skriver ut nøyaktig YAML for *denne* maskinen:",
  "It prints one processor entry, already indented. Add it inside the `processors:` block your `config.yaml` already has — alongside `resourcedetection:`, `resource:` and `batch:`, not as a second `processors:` key — then name it in the metrics pipeline:":
    "Det skriver ut én prosessoroppføring, allerede innrykket. Legg den til i `processors:`-blokken `config.yaml` allerede har — ved siden av `resourcedetection:`, `resource:` og `batch:`, ikke som en ekstra `processors:`-nøkkel — og nevn den deretter i målingspipelinen:",
  "Use `Get-CimInstance`, not the deprecated `Get-WmiObject` — it is absent from PowerShell 7 and later. Values are emitted in single quotes with any embedded quote doubled, so a serial or model containing punctuation stays valid YAML. A field the firmware leaves empty prints as `''`; drop that attribute rather than shipping a blank one.":
    "Bruk `Get-CimInstance`, ikke den utdaterte `Get-WmiObject` — den finnes ikke i PowerShell 7 og nyere. Verdiene skrives ut i enkle anførselstegn med innebygde anførselstegn doblet, så et serienummer eller en modell med tegnsetting forblir gyldig YAML. Et felt fastvaren lar stå tomt, skrives ut som `''`; utelat det attributtet i stedet for å sende et tomt.",
  "Within a few minutes the machine's **Inventory** item shows `host.serial_number`, `device.manufacturer`, `device.model.name` and `device.firmware.version` under **Details**, alongside the IP and MAC addresses and machine id the detector already supplies. Run this again after a motherboard swap or a BIOS update — the values are stamped, not detected, so they do not update themselves.":
    "Innen noen minutter viser maskinens element under **Inventar** under **Detaljer** `host.serial_number`, `device.manufacturer`, `device.model.name` og `device.firmware.version`, ved siden av IP- og MAC-adressene og maskin-ID-en detektoren allerede leverer. Kjør dette på nytt etter et hovedkortbytte eller en BIOS-oppdatering — verdiene er skrevet fast, ikke oppdaget, så de oppdaterer seg ikke selv.",
  "- The **Services** tab lists each service's state once the `windows_service` receiver is enabled (see **Enable the Windows Services tab**).":
    "- Fanen **Tjenester** viser hver tjenestes tilstand så snart `windows_service`-mottakeren er slått på (se **Slå på fanen Windows-tjenester**).",
  "1. Read the collector's logs for export errors: **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`). An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `C:\\Program Files\\otelcol-contrib\\config.yaml`.":
    "1. Les innsamlerens logger for eksportfeil: **Event Viewer → Windows Logs → Application** (kilde `otelcol-contrib`). En HTTP-`401` betyr at nøkkelen mangler, er feil eller er utløpt; `422` at den er deaktivert (eller er en nettlesernøkkel, som ikke kan sende vertstelemetri). Velg en nøkkel som virker i trinn 1, og oppdater `x-oneuptime-token` i `C:\\Program Files\\otelcol-contrib\\config.yaml`.",
  "1. Run the collector in the foreground to see the real error instead of the generic `Error 1064`:":
    "1. Kjør innsamleren i forgrunnen for å se den egentlige feilen i stedet for den generelle `Error 1064`:",
  '2. `Error 2: The system cannot find the file specified` means the service points at a file that is not there — compare `BINARY_PATH_NAME` from `sc.exe qc "otelcol-contrib"` with the contents of `C:\\Program Files\\otelcol-contrib`. The archive must be the `otelcol-contrib_` one, which unpacks `otelcol-contrib.exe`.':
    '2. `Error 2: The system cannot find the file specified` betyr at tjenesten peker på en fil som ikke finnes — sammenlign `BINARY_PATH_NAME` fra `sc.exe qc "otelcol-contrib"` med innholdet i `C:\\Program Files\\otelcol-contrib`. Arkivet må være `otelcol-contrib_`-arkivet, som pakker ut `otelcol-contrib.exe`.',
  "3. **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`) records the startup error the service manager swallowed.":
    "3. **Event Viewer → Windows Logs → Application** (kilde `otelcol-contrib`) registrerer oppstartsfeilen som tjenestebehandleren svelget.",
  "If you set `include_services` but still see every service, the collector hasn't picked up the edit — restart the service (`Restart-Service otelcol-contrib`) and give the Services tab a few minutes to refresh its rolling window.":
    "Hvis du setter `include_services`, men fortsatt ser alle tjenester, har innsamleren ikke fått med seg endringen — start tjenesten på nytt (`Restart-Service otelcol-contrib`) og gi fanen Tjenester noen minutter til å oppdatere det glidende vinduet sitt.",
  "Kubernetes nodes are monitored by the **OneUptime Kubernetes agent** rather than a host collector: each node appears under **Kubernetes** → your cluster → **Nodes**, next to its pods and workloads, not in the **Hosts** list. The steps below install the agent on a standard cluster; the install guide in the **Kubernetes** section has the steps for Amazon EKS, Google GKE, Azure AKS, GKE Autopilot and EKS Fargate.":
    "Kubernetes-noder overvåkes av **OneUptime Kubernetes-agenten** i stedet for en vertsinnsamler: Hver node vises under **Kubernetes** → klyngen din → **Noder**, ved siden av podene og arbeidslastene sine, ikke i listen **Verter**. Trinnene nedenfor installerer agenten på en standardklynge; installasjonsveiledningen i delen **Kubernetes** har trinnene for Amazon EKS, Google GKE, Azure AKS, GKE Autopilot og EKS Fargate.",
  "A Kubernetes cluster running v1.23 or later":
    "En Kubernetes-klynge med v1.23 eller nyere",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` og `helm` (v3) installert på maskinen din",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "Feil klynge? Bytt med `kubectl config use-context <context-name>`.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "Erstatt `my-cluster` med et navn på denne klyngen, for eksempel `prod-us-east-1`. Det er slik klyngen vises i OneUptime, så hold det stabilt: et nytt navn registrerer en ny klynge.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` slår på **KI-undersøkelser**, slik chartet gjør som standard: OneUptime AI undersøker hendelser og varsler på denne klyngen med skrivebeskyttet kubectl, gjennom Kubernetes-AI-agenten.",
  "You should see:": "Du bør se:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Innsamleren og Kubernetes-AI-agenten, pluss én `-logs`- og én `-ebpf`-pod på hver node. Når de er `Running`, vises klyngen automatisk i delen **Kubernetes**, vanligvis innen et minutt eller to.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Kubernetes-AI-agent (på som standard, skrivebeskyttet).** Poden `kubernetes-agent-ai-agent` lar OneUptime AI undersøke hendelser og varsler på denne klyngen med skrivebeskyttet kubectl (`get`, `describe`, `logs`, `events`, `top`) med den samme API-nøkkelen, og den kan ikke endre noe med mindre du senere gir den skrivetilgang. Åpne klyngen og gå til **KI → Agent** for å se den. Vil du ikke ha den? Installer med `--set aiAgent.enabled=false` i stedet for `--set aiAgent.enabled=true`.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "Namespace-regler avgjør hva agenten samler inn fra hvert namespace. For å samle podlogger og eBPF-data bare fra `default`, `production` og `staging`:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "For å beholde alt, men stoppe loggene fra støyende namespaces, utelukker du dem bare fra `podLogs`:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **Omfang:** `podLogs` (containernes stdout/stderr), `ebpfDiscovery` (eBPF-spor og -målinger), `metrics` (målinger med namespace) og `traces` (hvert span).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **Mønstre** samsvarer med hele namespace-navnet og godtar `*`, som i `team-*`. En `exclude`-regel vinner alltid over en `include`-regel.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **Egne regler erstatter standardregelen**, som utelukker `kube-system` fra `podLogs` og `ebpfDiscovery`. Behold den i listen din, som i det andre eksemplet, hvis du fortsatt vil ha det.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- Node- og klyngemålinger har ikke noe namespace, så de beholdes alltid.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` krever Helm 3.10 eller nyere.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**Send bare viktige linjer.** Forkast podlogglinjer under et alvorlighetsnivå før de forlater klyngen:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    'Godtar `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` og `FATAL`: `WARN` beholder advarsler, feil og fatale linjer. Alvorlighetsnivået leses fra selve logglinjen (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes-hendelser forkastes aldri av dette.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Slå av podlogger.** Målingene påvirkes ikke: nodeinnsamleren fortsetter å kjøre for kubelet- og cAdvisor-målinger og slutter bare å lese podlogger:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**Endre hvordan logger leses.** Presettet velger dette for deg; en eksplisitt `logs.mode` vinner alltid:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: leser `/var/log/pods` på hver node via hostPath (lavest overhead; krever hostPath).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: et Deployment følger podlogger via Kubernetes-API-et (virker på alle klynger).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: ingen podlogger.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "Det leser API-serveren, der den svarer inne i klyngen. etcd, scheduleren og controller manageren svarer på control plane-nodene, som agentens pod ikke kan gjette, så den leser dem så snart du oppgir adressen til hver node:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **Scheduleren og controller manageren** leverer HTTPS og godtar agentens token, men kubeadm binder dem til `127.0.0.1`: gi dem en `--bind-address` som agentens pod kan nå.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** leverer målingene sine over vanlig HTTP på kubeadms `--listen-metrics-urls` (port 2381, bundet til `127.0.0.1` til du legger til nodens adresse), som over. Eller les av HTTPS-klientporten, 2379, med klientsertifikatet den ber om: legg `ca.crt`, `tls.crt` og `tls.key` i en Secret i `oneuptime-agent` og oppgi den i `controlPlane.etcd.clientCertSecret`.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "Bare for selvadministrerte klynger: administrerte tjenester (EKS, GKE, AKS) eksponerer ikke målingene for sitt control plane.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "Kostnadsovervåking er på som standard: agenten har med open source-motoren OpenCost (pluss den lille Prometheus-en den trenger), priser nodene og volumene dine etter skyleverandørens offentlige listepriser, uten påloggingsinformasjon, og sender hva hvert namespace og hver workload koster. De første dataene vises på klyngens oversikt og siden Kostnader etter den første hele timen.",
  "On an agent installed before it was on by default, upgrade it:":
    "Ble agenten installert før dette var på som standard, oppgraderer du den:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **Slå det av:** legg til `--set cost.enabled=false` i den samme oppgraderingen.",
  "- **Already running Kubecost or OpenCost?** Point the agent at it instead, and nothing is bundled: add `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` (or your Kubecost service).":
    "- **Kjører du allerede Kubecost eller OpenCost?** Pek heller agenten mot den, så tas ingenting med: legg til `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` (eller Kubecost-tjenesten din).",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **Lokalt eller bare metal?** Sett en prisliste med `--set cost.opencost.customPricing.enabled=true` (USD per ressurstime; se chartets `values.yaml`).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "Full veiledning: [Kostnadsovervåking for Kubernetes](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "Agenten kjører [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) på hver node. Den fanger opp HTTP/HTTPS-, gRPC- og SQL/Redis-trafikk fra tjenester i Go, .NET, Java, Node.js, Python, Ruby og Rust, uten SDK og uten sidecar, og sender spor, forespørselsmålinger (RED) og tjenestegrafdata gjennom innsamleren.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**Krav:** Linux-kjerne **5.8+** med BTF (standard på Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). eBPF-podene kjører **privilegert**, noe de trenger for å laste eBPF-programmer.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "**Slå det av** hvis nodene dine kjører en eldre kjerne, hvis privilegerte pods ikke er tillatt, eller hvis tjenestene dine allerede sender spor med OpenTelemetry-SDK-er og du ikke vil ha duplikater:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**Velg signalene.** Hver familie slås av eller på med `--set ebpf.features.<name>=false` (eller `=true`):",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | Standard | Hva den legger til |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | på | HTTP/gRPC-forespørselsrate, feil og latens per tjeneste |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | på | Antall kall og varighet for spans (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | på | Kanter fra kaller → kalt; driver tjenestekartet |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | på | Tellere for TCP/UDP-flyt fra pod til pod |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | av | Nettverksmålinger mellom soner (dobler kardinaliteten) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | på | TCP-RTT og tellere for mislykkede tilkoblinger og retransmisjoner per node |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**Sporpropagering på tvers av tjenester** (å knytte en forespørsel som går fra pod A → pod B til ett enkelt spor, også på en annen node) er **på som standard**. Den virker ved å skrive om trafikk som allerede er underveis (den utvider HTTP-forespørsler i klartekst i kjernen og legger en TCP-opsjon til TLS og rå TCP), og en feil i denne bytetellingen bringer datastrømmen ut av takt: Det rapporterte symptomet er overføringer gjennom en L7-proxy som nginx som henger så snart et svar passerer ~64KB. Hvis du ser det, eller hvis et service mesh begynner å få pods til å feile, slår du den av med `--set ebpf.contextPropagation=false`; et OpenTelemetry-SDK propagerer `traceparent` i userspace uten noe av dette.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Hver `oneuptime.labels.<key>=<value>` blir etiketten `<key>:<value>` på klyngen og på tjenestene og vertene den rapporterer. Etiketter sammenlignes uten hensyn til store og små bokstaver, så en eksisterende etikett `Production` gjenbrukes; etiketter som er lagt til i OneUptime-grensesnittet, fjernes aldri av agenten.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**Oppgrader** til det nyeste chartet. `--reset-then-reuse-values` (Helm 3.14+) beholder verdiene du har satt (preset, klyngenavn, filtre), og tar alt annet fra det nye chartet; legg eventuelle nye `--set`-flagg oppå:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "Med Helm 3.13 og eldre oppgraderer du i stedet med verdiene du har satt:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "Ikke bruk `--reuse-values`: det beholder også standardverdiene fra chartet du oppgraderer fra, så standardverdiene i et nyere chart (blant annet eBPF-imaget) aldri tas i bruk.",
  "**Uninstall** the agent and its namespace:":
    "**Avinstaller** agenten og namespacet dens:",
  "| Category | Data |": "| Kategori | Data |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **Nodemålinger** | Bruk av CPU, minne, filsystem og nettverk |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Pod- og containermålinger** | CPU, minne, nettverks-I/O og omstarter |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **Klyngemålinger** | Nodetilstander, allokerbare ressurser, antall pods og workloads |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Kubernetes-hendelser** | Advarsler, feil og planleggingshendelser |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Podlogger** | stdout/stderr for hver container, lest på hver node |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **Applikasjonsspor** *(eBPF)* | HTTP-, gRPC- og SQL/Redis-spans fra hver pod, uten SDK eller kodeendringer |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **Forespørselsmålinger og tjenestegraf** *(eBPF)* | Forespørselsrate, feil og latens per tjeneste, og kanter fra kaller → kalt til tjenestekartet |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **Nettverksflyt** *(eBPF)* | Tellere for TCP/UDP-byte og -pakker fra pod til pod |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **Workloadkostnader** *(på som standard)* | Forbruk per namespace, workload og pod, med ubrukt kapasitet og effektivitet, også som målinger å varsle på |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "Klyngen din blokkerer `hostPath`-volumer eller privilegerte pods. Det er normalt på **GKE Autopilot** og **EKS Fargate**: velg den plattformen øverst i denne veiledningen og følg trinnene dens. På **OpenShift** lykkes installasjonen derimot, men agentens nodepods starter aldri: velg **Red Hat OpenShift**.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "På alle andre klynger med en restriktiv Pod Security-policy fjerner du den mislykkede releasen:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "Kjør deretter installasjonskommandoen på nytt med `--set preset=gke-autopilot` lagt til. Det presettet leser podlogger via Kubernetes-API-et i stedet for hostPath, bruker en herdet sikkerhetskontekst og utelater de privilegerte eBPF- og profileringspodene.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. Sjekk at agentens pods kjører: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. Sjekk innsamlerens logger: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. Bekreft at OneUptime-URL-en og inntaksnøkkelen i installasjonskommandoen er riktige.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. Sørg for at klyngen kan nå OneUptime-instansen din over nettverket.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. Sjekk AI-agentens pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. Sjekk loggene dens: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. Ingen pod? Oppgrader chartet (se **Oppgrader eller avinstaller agenten** under Avansert) og legg til `--set aiAgent.enabled=true`.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. Sjekk at klyngenavnet stemmer: denne veiledningen installerer **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. Bekreft agentens RBAC-tillatelser: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Se etter eksportfeil i innsamlerens logger: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **Kjernen er for gammel eller uten BTF.** eBPF krever Linux 5.8+ med BTF; sjekk med `uname -r` på en node. Kan du ikke oppgradere, slår du av eBPF med `--set ebpf.enabled=false`.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **Privilegerte pods blokkert.** Noen låste klynger avviser dem. Slå av eBPF.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` er ikke tilgjengelige på verten.** Slå bare av familien med TCP-statistikk: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. Sjekk at eBPF-podene er friske: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. Slå på OBIs feilsøkingsutdata for å bekrefte at den ser trafikk: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, og les deretter `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Hvis spans dukker opp der, men ikke i OneUptime, ser du etter eksportfeil i innsamlerens logger: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
};

export default TRANSLATION;
