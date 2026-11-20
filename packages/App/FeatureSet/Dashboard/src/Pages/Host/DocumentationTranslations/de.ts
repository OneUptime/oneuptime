import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Host setup guide in German (#8341): each piece of the English
 * guide's markdown (Pages/Host/Utils/DocumentationMarkdown.ts) and its
 * German. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its German words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker installed on the host you want to monitor":
    "Docker ist auf dem Host installiert, den Sie überwachen möchten",
  "Network access from the host to your OneUptime instance":
    "Netzwerkzugriff vom Host auf Ihre OneUptime-Instanz",
  "Save this as `config.yaml` in the directory you will run `docker run` from — step 3 mounts it into the container.":
    "Speichern Sie dies als `config.yaml` in dem Verzeichnis, aus dem Sie `docker run` ausführen — Schritt 3 bindet die Datei in den Container ein.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Wählen Sie in Schritt 1 einen Ingestion-Schlüssel, um `<YOUR_API_KEY>` auszufüllen.",
  "`--network host`, `--pid host`, and the `/hostfs` bind mount let the `hostmetrics` and `process` scrapers read CPU, memory, disk, and per-process information from the host kernel rather than the container. Without these, you'd only see metrics for the collector container itself.":
    "`--network host`, `--pid host` und die Bind-Einbindung `/hostfs` lassen die Scraper `hostmetrics` und `process` CPU-, Speicher-, Datenträger- und Prozessdaten aus dem Kernel des Hosts statt des Containers lesen. Ohne sie sähen Sie nur Metriken des Collector-Containers selbst.",
  "Open the **Hosts** list in OneUptime — your host appears automatically once the first metric batch lands (usually within 30 seconds). Not there? Check the collector:":
    "Öffnen Sie in OneUptime die Liste **Hosts** — Ihr Host erscheint automatisch, sobald der erste Metrik-Batch eintrifft (meist innerhalb von 30 Sekunden). Nicht da? Prüfen Sie den Collector:",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer, so add it on Linux hosts only; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**KI-Untersuchungen sind standardmäßig aktiv** für jeden Host: Sobald der Host-KI-Agent darauf läuft, untersucht OneUptime AI dort Incidents und Warnungen mit schreibgeschützten Befehlen wie `systemctl status`, `df -h`, `free -m` und `ps aux` und ändert nichts, solange Sie keine Korrekturen erlauben. Er ist ein Linux-Container mit eigenem Installer, fügen Sie ihn also nur auf Linux-Hosts hinzu; er braucht Docker (die System-Engine, nicht rootless Docker) mit dem Compose-Plugin:",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. It asks for your OneUptime URL, the ingestion key and the host's name — leave the name empty to use the hostname, which is what this collector reports. Once it connects, it shows as Connected on the host's **AI → AI agent** page and at the bottom of its **Overview**. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#hosts).":
    "Die erste Zeile lädt das Skript als `install.sh` herunter, damit Sie es vor dem Ausführen lesen können. Es fragt nach Ihrer OneUptime-URL, dem Ingestion-Schlüssel und dem Namen des Hosts — lassen Sie den Namen leer, um den Hostnamen zu verwenden, den dieser Collector meldet. Sobald er verbunden ist, erscheint er als verbunden auf der Seite **KI → KI-Agent** des Hosts und unten in seiner **Übersicht**. Was er ausführen darf und wie Korrekturen funktionieren: [Infrastruktur-KI-Agenten](/docs/ai/infrastructure-ai-agents#hosts).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to the `config.yaml` you mounted into the container and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Die Konfiguration trägt bereits die IP-Adressen, MAC-Adressen, Architektur, Maschinen-ID, Betriebssystembeschreibung und -version der Maschine in ihr Element im **Inventar** ein, das ein CMDB-Export liest. Seriennummer, Hersteller, Modell und Firmware-Version (BIOS / UEFI) sind anders: **Kein Ressourcendetektor kann sie liefern.** Sie stammen aus der Firmware der Maschine, über DMI. Lesen Sie sie einmal bei der Bereitstellung aus und schreiben Sie sie fest auf die Ressource — fügen Sie diesen Prozessor der `config.yaml`, die Sie in den Container eingebunden haben, hinzu und nennen Sie ihn in der Metrik-Pipeline. Fügen Sie ihn in die Abschnitte ein, die Ihre Konfiguration schon hat — legen Sie keinen zweiten `processors:`- oder `service:`-Schlüssel an.",
  "Then recreate the container so it reads the edited file — remove it, and run the `docker run` command from step 3 again:":
    "Erstellen Sie den Container dann neu, damit er die bearbeitete Datei liest — entfernen Sie ihn und führen Sie den `docker run`-Befehl aus Schritt 3 erneut aus:",
  "The values are the machine's own, so they are written once by whatever provisions it. On Linux, read them as root (`bios_version` is readable by anyone):":
    "Die Werte gehören zur Maschine selbst, werden also einmal von dem geschrieben, was sie bereitstellt. Unter Linux lesen Sie sie als root (`bios_version` darf jeder lesen):",
  "Within a few minutes the values show on the machine's **Inventory** item under **Details**. They are stamped, not detected, so run this again after a motherboard swap or a firmware update.":
    "Innerhalb weniger Minuten erscheinen die Werte im Element der Maschine im **Inventar** unter **Details**. Sie sind fest geschrieben, nicht erkannt, führen Sie dies also nach einem Mainboard-Tausch oder einem Firmware-Update erneut aus.",
  "`host.manufacturer`, `host.model.name`, `host.firmware.version` and `host.bios.version` are accepted as alternative spellings and stored under the `device.*` keys above (and `device.serial_number` under `host.serial_number`), so a config written either way ends up in one place.":
    "`host.manufacturer`, `host.model.name`, `host.firmware.version` und `host.bios.version` werden als alternative Schreibweisen akzeptiert und unter den `device.*`-Schlüsseln oben gespeichert (und `device.serial_number` unter `host.serial_number`), sodass eine Konfiguration, die so oder so geschrieben ist, an einer Stelle landet.",
  "> **Don't set `device.manufacturer` on a mobile app's resource and a host's from the same config.** On a resource that carries no `host.name` or `host.id`, `device.manufacturer` still marks the batch as mobile Real User Monitoring.":
    "> **Setzen Sie `device.manufacturer` nicht aus derselben Konfiguration auf die Ressource einer mobilen App und auf die eines Hosts.** Auf einer Ressource ohne `host.name` oder `host.id` kennzeichnet `device.manufacturer` den Batch weiterhin als mobiles Real User Monitoring.",
  "Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the host (and to the telemetry service emitted from this collector). Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.":
    "Jedes Ressourcenattribut mit dem Präfix `oneuptime.label.` wird zu einem Projekt-Label und an den Host angehängt (und an den Telemetriedienst, den dieser Collector ausgibt). Muster: Aus `oneuptime.label.<dimension>=<value>` wird ein Label namens `<dimension>:<value>`.",
  "Add a `resource` processor to the `config.yaml` you mounted into the container and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Fügen Sie einen `resource`-Prozessor der `config.yaml`, die Sie in den Container eingebunden haben, hinzu und verweisen Sie in der Metrik-Pipeline darauf. Fügen Sie ihn in die Abschnitte ein, die Ihre Konfiguration schon hat — legen Sie keinen zweiten `processors:`- oder `service:`-Schlüssel an.",
  "The host shows up tagged `team:payments`, `env:production`, and `region:us-east-1`. Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated. Labels added manually in the OneUptime UI are never removed by the collector.":
    "Der Host erscheint mit den Labels `team:payments`, `env:production` und `region:us-east-1`. Labels werden ohne Beachtung der Groß-/Kleinschreibung abgeglichen, ein vorhandenes, von Hand angelegtes Label `Production` wird also wiederverwendet statt verdoppelt. Labels, die in der OneUptime-Oberfläche von Hand hinzugefügt wurden, entfernt der Collector nie.",
  "Hosts are auto-discovered from the OTel `host.name` resource attribute, which the `resourcedetection` processor sets. OneUptime registers the host once a batch that carries `host.name` also carries any of:":
    "Hosts werden anhand des OTel-Ressourcenattributs `host.name` automatisch erkannt, das der `resourcedetection`-Prozessor setzt. OneUptime registriert den Host, sobald ein Batch mit `host.name` außerdem eines der Folgenden enthält:",
  "- `hostmetrics` receiver metrics (CPU, memory, disk, filesystem, network, load, processes), OR":
    "- Metriken des `hostmetrics`-Receivers (CPU, Speicher, Datenträger, Dateisystem, Netzwerk, Last, Prozesse), ODER",
  "- `process` scraper metrics (per-process CPU/memory/threads), OR":
    "- Metriken des `process`-Scrapers (CPU/Speicher/Threads pro Prozess), ODER",
  "- an `os.type` or `container.runtime` resource attribute, on metrics, logs or traces":
    "- ein Ressourcenattribut `os.type` oder `container.runtime`, auf Metriken, Logs oder Traces",
  "…and starts populating the Overview, Metrics, Processes, and Logs tabs. `host.id` or `host.arch` alone do not register a host, and telemetry that carries a Kubernetes identity (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) is filed under its Kubernetes cluster instead.":
    "…und beginnt, die Tabs Übersicht, Metriken, Prozesse und Protokolle zu füllen. `host.id` oder `host.arch` allein registrieren keinen Host, und Telemetrie mit einer Kubernetes-Identität (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) wird stattdessen unter ihrem Kubernetes-Cluster abgelegt.",
  "**Running on OpenStack?** Use `detectors: [nova, system, env]`, so `host.id` is the instance's UUID and OneUptime links this host to its instance, and set `host.name` to `enabled: false` under `nova: resource_attributes:` so its name stays the one `system` reports.":
    "**Läuft er auf OpenStack?** Verwenden Sie `detectors: [nova, system, env]`, damit `host.id` die UUID der Instanz ist und OneUptime diesen Host mit seiner Instanz verknüpft, und setzen Sie `host.name` unter `nova: resource_attributes:` auf `enabled: false`, damit sein Name der bleibt, den `system` meldet.",
  "The same resource attributes become the machine's **Inventory** item, which is what a CMDB export reads. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` and `os.version` all come from the `resourcedetection` processor; serial number, make, model and firmware version have no detector and are stamped on separately (see **Record the serial number, make, model and firmware version**).":
    "Dieselben Ressourcenattribute werden zum Element der Maschine im **Inventar**, das ein CMDB-Export liest. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` und `os.version` kommen alle vom `resourcedetection`-Prozessor; Seriennummer, Hersteller, Modell und Firmware-Version haben keinen Detektor und werden separat fest geschrieben (siehe **Seriennummer, Hersteller, Modell und Firmware-Version erfassen**).",
  "Once the host is reporting:": "Sobald der Host meldet:",
  "- The **Metrics** tab visualizes `system.*` time-series.":
    "- Der Tab **Metriken** zeigt `system.*`-Zeitreihen an.",
  "- The **Processes** tab lists processes ordered by CPU once the `process` scraper is enabled.":
    "- Der Tab **Prozesse** listet Prozesse nach CPU sortiert, sobald der `process`-Scraper aktiviert ist.",
  "- The **Logs** tab streams any logs whose resource attributes include `host.name`.":
    "- Der Tab **Protokolle** zeigt alle Logs, deren Ressourcenattribute `host.name` enthalten.",
  "The config reports the collector release it is for (`oneuptime.agent.version`) as the host's **Agent Version**. When this OneUptime pins a newer release, a warning sign beside it opens these steps.":
    "Die Konfiguration meldet das Collector-Release, für das sie gedacht ist (`oneuptime.agent.version`), als **Agent-Version** des Hosts. Wenn dieses OneUptime ein neueres Release festlegt, öffnet ein Warnzeichen daneben diese Schritte.",
  "1. Save the config from step 2 again, with the same ingestion key: it reports the new version. Copy across any change you made to yours.":
    "1. Speichern Sie die Konfiguration aus Schritt 2 erneut, mit demselben Ingestion-Schlüssel: Sie meldet die neue Version. Übernehmen Sie jede Änderung, die Sie an Ihrer vorgenommen haben.",
  "2. In the folder that holds it, install the new release and restart the collector:":
    "2. Installieren Sie in dem Ordner, der sie enthält, das neue Release und starten Sie den Collector neu:",
  "1. Read the collector's logs for export errors: `docker logs -f otel-collector`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in the `config.yaml` you mounted into the container.":
    "1. Lesen Sie die Logs des Collectors auf Exportfehler: `docker logs -f otel-collector`. Ein HTTP-`401` bedeutet, dass der Schlüssel fehlt, falsch oder abgelaufen ist; `422`, dass er deaktiviert wurde (oder ein Browser-Schlüssel ist, der keine Host-Telemetrie senden kann). Wählen Sie in Schritt 1 einen funktionierenden Schlüssel und aktualisieren Sie `x-oneuptime-token` in der `config.yaml`, die Sie in den Container eingebunden haben.",
  "2. Check the host can reach OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` from the same machine.":
    "2. Prüfen Sie, ob der Host OneUptime erreicht: `curl -v <YOUR_ONEUPTIME_URL>/otlp` von derselben Maschine.",
  "3. Keep `resourcedetection` in the metrics pipeline — it sets `host.name`, which is how OneUptime recognises the host.":
    "3. Behalten Sie `resourcedetection` in der Metrik-Pipeline — er setzt `host.name`, woran OneUptime den Host erkennt.",
  "The collector is reading its own container's kernel view. Run it with `--network host`, `--pid host`, the `/:/hostfs` bind mount and the `HOST_*` variables exactly as step 3 shows — without them the `hostmetrics` and `process` scrapers only see the collector container itself.":
    "Der Collector liest die Kernel-Sicht seines eigenen Containers. Führen Sie ihn mit `--network host`, `--pid host`, der Bind-Einbindung `/:/hostfs` und den `HOST_*`-Variablen genau wie in Schritt 3 aus — ohne sie sehen die Scraper `hostmetrics` und `process` nur den Collector-Container selbst.",
  "A Debian or Ubuntu host (amd64 or arm64) with `sudo`":
    "Ein Debian- oder Ubuntu-Host (amd64 oder arm64) mit `sudo`",
  "Save this as `config.yaml` in your current directory — step 3 installs it.":
    "Speichern Sie dies als `config.yaml` im aktuellen Verzeichnis — Schritt 3 installiert die Datei.",
  "> **Note for native installs:** Unlike Docker, the package install reads `/proc` and `/sys` directly — no `HOST_PROC` env vars or `/hostfs` mount required. The systemd unit shipped with the package runs as the unprivileged `otelcol-contrib` user; if you want the `process` scraper to see processes owned by other users, grant it `CAP_SYS_PTRACE` or run it as root.":
    "> **Hinweis zu nativen Installationen:** Anders als Docker liest die Paketinstallation `/proc` und `/sys` direkt — keine `HOST_PROC`-Umgebungsvariablen und keine `/hostfs`-Einbindung nötig. Die mit dem Paket gelieferte systemd-Unit läuft als unprivilegierter Benutzer `otelcol-contrib`; soll der `process`-Scraper Prozesse anderer Benutzer sehen, gewähren Sie ihm `CAP_SYS_PTRACE` oder führen Sie ihn als root aus.",
  "`otelcol-contrib` has bundled the `systemd` receiver since **v0.142.0**; run **v0.143.0 or newer**, which is where its CPU metric settled on its current name and stopped probing non-service units. Turn it on by adding it to `/etc/otelcol-contrib/config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "`otelcol-contrib` enthält den `systemd`-Receiver seit **v0.142.0**; verwenden Sie **v0.143.0 oder neuer**, ab der seine CPU-Metrik ihren heutigen Namen trägt und er keine Units mehr abfragt, die keine Dienste sind. Aktivieren Sie ihn, indem Sie ihn zu `/etc/otelcol-contrib/config.yaml` und zur Metrik-Pipeline hinzufügen. Fügen Sie ihn in die Abschnitte ein, die Ihre Konfiguration schon hat — legen Sie keinen zweiten `processors:`- oder `service:`-Schlüssel an.",
  "Then restart the service:": "Starten Sie den Dienst dann neu:",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so the packaged service — which runs as the `otelcol-contrib` user — needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "Der Receiver ist **nur für Linux** und **Alpha**. Er liest den Unit-Status über den System-D-Bus mit denselben schreibgeschützten Aufrufen wie `systemctl list-units`, die systemd ohne Privilegien erlaubt, sodass der Paketdienst — der als Benutzer `otelcol-contrib` läuft — keine zusätzlichen Rechte braucht. Ein containerisierter Collector erreicht den Bus des Hosts nicht, verwenden Sie also eine native Installation. Sobald Metriken eintreffen, füllt sich der Tab **Systemd-Units** des Hosts mit jeder erfassten Unit und ihrem aktuellen Zustand (`active`, `failed`, `inactive`, ...).",
  "Each unit costs eight datapoints per scrape for the state set, plus two more if you leave the CPU metric on, so on a host with hundreds of units narrow `units:` or raise `collection_interval` rather than scraping everything.":
    "Jede Unit kostet pro Abfrage acht Datenpunkte für den Zustandssatz, plus zwei, wenn Sie die CPU-Metrik eingeschaltet lassen; grenzen Sie auf einem Host mit Hunderten Units also `units:` ein oder erhöhen Sie `collection_interval`, statt alles abzufragen.",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**KI-Untersuchungen sind standardmäßig aktiv** für jeden Host: Sobald der Host-KI-Agent darauf läuft, untersucht OneUptime AI dort Incidents und Warnungen mit schreibgeschützten Befehlen wie `systemctl status`, `df -h`, `free -m` und `ps aux` und ändert nichts, solange Sie keine Korrekturen erlauben. Er ist ein Linux-Container mit eigenem Installer; er braucht Docker (die System-Engine, nicht rootless Docker) mit dem Compose-Plugin:",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI, and the packaged collector runs unprivileged, so it cannot read them itself. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Die Konfiguration trägt bereits die IP-Adressen, MAC-Adressen, Architektur, Maschinen-ID, Betriebssystembeschreibung und -version der Maschine in ihr Element im **Inventar** ein, das ein CMDB-Export liest. Seriennummer, Hersteller, Modell und Firmware-Version (BIOS / UEFI) sind anders: **Kein Ressourcendetektor kann sie liefern.** Sie stammen aus der Firmware der Maschine, über DMI, und der Paket-Collector läuft ohne Privilegien, kann sie also nicht selbst lesen. Lesen Sie sie einmal bei der Bereitstellung aus und schreiben Sie sie fest auf die Ressource — fügen Sie diesen Prozessor zu `/etc/otelcol-contrib/config.yaml` hinzu und nennen Sie ihn in der Metrik-Pipeline. Fügen Sie ihn in die Abschnitte ein, die Ihre Konfiguration schon hat — legen Sie keinen zweiten `processors:`- oder `service:`-Schlüssel an.",
  "Add a `resource` processor to `/etc/otelcol-contrib/config.yaml` and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Fügen Sie einen `resource`-Prozessor zu `/etc/otelcol-contrib/config.yaml` hinzu und verweisen Sie in der Metrik-Pipeline darauf. Fügen Sie ihn in die Abschnitte ein, die Ihre Konfiguration schon hat — legen Sie keinen zweiten `processors:`- oder `service:`-Schlüssel an.",
  "- The **Systemd Units** tab lists unit state once the `systemd` receiver is enabled (see **Enable the Systemd Units tab**).":
    "- Der Tab **Systemd-Units** listet den Unit-Status, sobald der `systemd`-Receiver aktiviert ist (siehe **Tab „Systemd-Units“ aktivieren**).",
  "1. Read the collector's logs for export errors: `sudo journalctl -u otelcol-contrib -f`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `/etc/otelcol-contrib/config.yaml`.":
    "1. Lesen Sie die Logs des Collectors auf Exportfehler: `sudo journalctl -u otelcol-contrib -f`. Ein HTTP-`401` bedeutet, dass der Schlüssel fehlt, falsch oder abgelaufen ist; `422`, dass er deaktiviert wurde (oder ein Browser-Schlüssel ist, der keine Host-Telemetrie senden kann). Wählen Sie in Schritt 1 einen funktionierenden Schlüssel und aktualisieren Sie `x-oneuptime-token` in `/etc/otelcol-contrib/config.yaml`.",
  "1. Keep `resourcedetection` in the same metrics pipeline as the `systemd` receiver — the receiver attaches only `systemd.unit.name` to each unit, so without `host.name` the samples never attach to the host.":
    "1. Behalten Sie `resourcedetection` in derselben Metrik-Pipeline wie den `systemd`-Receiver — der Receiver hängt an jede Unit nur `systemd.unit.name` an, ohne `host.name` werden die Werte also nie dem Host zugeordnet.",
  "2. Run `otelcol-contrib` v0.143.0 or newer: older builds stop at startup with `'receivers' unknown type: \"systemd\"`, or name the CPU metric differently (see **Enable the Systemd Units tab**).":
    "2. Verwenden Sie `otelcol-contrib` v0.143.0 oder neuer: Ältere Builds brechen beim Start mit `'receivers' unknown type: \"systemd\"` ab oder benennen die CPU-Metrik anders (siehe **Tab „Systemd-Units“ aktivieren**).",
  "3. Check the collector can reach the system D-Bus: `/run/dbus/system_bus_socket` must exist, and `systemctl list-units` run as the collector's user is the quickest test. Root is not required.":
    "3. Prüfen Sie, ob der Collector den System-D-Bus erreicht: `/run/dbus/system_bus_socket` muss existieren, und `systemctl list-units`, ausgeführt als Benutzer des Collectors, ist der schnellste Test. Root ist nicht nötig.",
  "A RHEL, CentOS, Fedora or Amazon Linux host (x86_64 or aarch64) with `sudo`":
    "Ein RHEL-, CentOS-, Fedora- oder Amazon-Linux-Host (x86_64 oder aarch64) mit `sudo`",
  "A Linux host (x86_64 or aarch64) that runs systemd, with `sudo`":
    "Ein Linux-Host (x86_64 oder aarch64) mit systemd und `sudo`",
  "Drop a systemd unit at `/etc/systemd/system/otelcol-contrib.service`:":
    "Legen Sie eine systemd-Unit unter `/etc/systemd/system/otelcol-contrib.service` an:",
  "Then enable and start it:": "Aktivieren und starten Sie sie dann:",
  "Use this when packages aren't available — locked-down servers, or container base images you want to instrument from outside. No `HOST_PROC` env vars or `/hostfs` mount are needed: the collector reads kernel state directly, and `User=root` lets the `process` scraper see processes owned by other users (granting `CAP_SYS_PTRACE` instead works too).":
    "Verwenden Sie dies, wenn keine Pakete verfügbar sind — abgeschottete Server oder Container-Basis-Images, die Sie von außen instrumentieren möchten. Es sind keine `HOST_PROC`-Umgebungsvariablen und keine `/hostfs`-Einbindung nötig: Der Collector liest den Kernel-Zustand direkt, und `User=root` lässt den `process`-Scraper Prozesse anderer Benutzer sehen (`CAP_SYS_PTRACE` zu gewähren funktioniert ebenfalls).",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so it needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "Der Receiver ist **nur für Linux** und **Alpha**. Er liest den Unit-Status über den System-D-Bus mit denselben schreibgeschützten Aufrufen wie `systemctl list-units`, die systemd ohne Privilegien erlaubt, er braucht also keine zusätzlichen Rechte. Ein containerisierter Collector erreicht den Bus des Hosts nicht, verwenden Sie also eine native Installation. Sobald Metriken eintreffen, füllt sich der Tab **Systemd-Units** des Hosts mit jeder erfassten Unit und ihrem aktuellen Zustand (`active`, `failed`, `inactive`, ...).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to `/opt/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Die Konfiguration trägt bereits die IP-Adressen, MAC-Adressen, Architektur, Maschinen-ID, Betriebssystembeschreibung und -version der Maschine in ihr Element im **Inventar** ein, das ein CMDB-Export liest. Seriennummer, Hersteller, Modell und Firmware-Version (BIOS / UEFI) sind anders: **Kein Ressourcendetektor kann sie liefern.** Sie stammen aus der Firmware der Maschine, über DMI. Lesen Sie sie einmal bei der Bereitstellung aus und schreiben Sie sie fest auf die Ressource — fügen Sie diesen Prozessor zu `/opt/otelcol-contrib/config.yaml` hinzu und nennen Sie ihn in der Metrik-Pipeline. Fügen Sie ihn in die Abschnitte ein, die Ihre Konfiguration schon hat — legen Sie keinen zweiten `processors:`- oder `service:`-Schlüssel an.",
  "A Mac (Apple silicon or Intel) and an administrator account for `sudo`":
    "Ein Mac (Apple Silicon oder Intel) und ein Administratorkonto für `sudo`",
  "Create `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:":
    "Legen Sie `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist` an:",
  "Load it:": "Laden Sie sie:",
  "> **Install the contrib build, as above.** The core `otelcol` build has no `resourcedetection` processor, so it refuses to start with this config.":
    "> **Installieren Sie wie oben den Contrib-Build.** Der Core-Build `otelcol` hat keinen `resourcedetection`-Prozessor und startet mit dieser Konfiguration deshalb nicht.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Die Konfiguration trägt bereits die IP-Adressen, MAC-Adressen, Architektur, Maschinen-ID, Betriebssystembeschreibung und -version der Maschine in ihr Element im **Inventar** ein, das ein CMDB-Export liest. Seriennummer, Hersteller, Modell und Firmware-Version (BIOS / UEFI) sind anders: **Kein Ressourcendetektor kann sie liefern.** Sie stammen aus der Firmware der Maschine. Lesen Sie sie einmal bei der Bereitstellung aus und schreiben Sie sie fest auf die Ressource — fügen Sie diesen Prozessor zu `/etc/otelcol-contrib/config.yaml` hinzu und nennen Sie ihn in der Metrik-Pipeline. Fügen Sie ihn in die Abschnitte ein, die Ihre Konfiguration schon hat — legen Sie keinen zweiten `processors:`- oder `service:`-Schlüssel an.",
  "Then restart the collector:": "Starten Sie den Collector dann neu:",
  "The values are the machine's own, so they are written once by whatever provisions it. On a Mac, read them like this — the manufacturer is `Apple Inc.`:":
    "Die Werte gehören zur Maschine selbst, werden also einmal von dem geschrieben, was sie bereitstellt. Auf einem Mac lesen Sie sie so — der Hersteller ist `Apple Inc.`:",
  "`hw.model` is the model *identifier* (`MacBookPro18,3`), not the marketing name. Put it in `device.model.name` anyway — `device.model.identifier` marks a batch as a mobile app.":
    "`hw.model` ist die Modell-*Kennung* (`MacBookPro18,3`), nicht der Verkaufsname. Tragen Sie sie trotzdem in `device.model.name` ein — `device.model.identifier` kennzeichnet einen Batch als mobile App.",
  "Windows 10 1803+ or Windows Server 2019+ (for the built-in `tar.exe`)":
    "Windows 10 1803+ oder Windows Server 2019+ (für das integrierte `tar.exe`)",
  "An elevated PowerShell prompt (Run as administrator)":
    "Eine PowerShell-Eingabeaufforderung mit erhöhten Rechten (Als Administrator ausführen)",
  "Save this as `config.yaml` in the folder you will run the PowerShell commands from — step 3 copies it into place.":
    "Speichern Sie dies als `config.yaml` in dem Ordner, aus dem Sie die PowerShell-Befehle ausführen — Schritt 3 kopiert die Datei an ihren Platz.",
  "On Windows, install the upstream **`otelcol-contrib`** collector — from **v0.155.0** it bundles the `windows_service` receiver that powers the host **Services** tab. Run from an elevated PowerShell prompt:":
    "Installieren Sie unter Windows den Upstream-Collector **`otelcol-contrib`** — ab **v0.155.0** enthält er den `windows_service`-Receiver, der den Tab **Dienste** des Hosts speist. Führen Sie dies in einer PowerShell-Eingabeaufforderung mit erhöhten Rechten aus:",
  "> **Note:** The service runs as `LocalSystem` so it can read every Windows service. On Windows the `load` scraper only emulates a load average from the *Processor Queue Length* counter (it starts at 0); if it can't read the counter it is logged and skipped, so the rest of the `hostmetrics` config runs unchanged. The [Host OpenTelemetry Collector docs](/docs/telemetry/host-otel-collector) also cover the signed `.msi` installer.":
    "> **Hinweis:** Der Dienst läuft als `LocalSystem`, damit er jeden Windows-Dienst lesen kann. Unter Windows emuliert der `load`-Scraper einen Lastdurchschnitt nur aus dem Leistungsindikator *Processor Queue Length* (er beginnt bei 0); kann er den Indikator nicht lesen, wird das protokolliert und übersprungen, und der Rest der `hostmetrics`-Konfiguration läuft unverändert. Die [Dokumentation zum Host-OpenTelemetry-Collector](/docs/telemetry/host-otel-collector) behandelt auch das signierte `.msi`-Installationsprogramm.",
  "Logs are written to the Windows Application event log; view them in **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`).":
    "Logs werden in das Windows-Anwendungsereignisprotokoll geschrieben; Sie sehen sie in **Event Viewer → Windows Logs → Application** (Quelle `otelcol-contrib`).",
  "From **v0.155.0** `otelcol-contrib` includes the `windows_service` receiver — turn it on by adding it to `C:\\Program Files\\otelcol-contrib\\config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Ab **v0.155.0** enthält `otelcol-contrib` den `windows_service`-Receiver — aktivieren Sie ihn, indem Sie ihn zu `C:\\Program Files\\otelcol-contrib\\config.yaml` und zur Metrik-Pipeline hinzufügen. Fügen Sie ihn in die Abschnitte ein, die Ihre Konfiguration schon hat — legen Sie keinen zweiten `processors:`- oder `service:`-Schlüssel an.",
  "The receiver is **Windows-only** and **alpha**. Once metrics arrive, the host **Services** tab populates automatically with each service's running state and startup type.":
    "Der Receiver ist **nur für Windows** und **Alpha**. Sobald Metriken eintreffen, füllt sich der Tab **Dienste** des Hosts automatisch mit dem Laufstatus und Starttyp jedes Dienstes.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through WMI.":
    "Die Konfiguration trägt bereits die IP-Adressen, MAC-Adressen, Architektur, Maschinen-ID, Betriebssystembeschreibung und -version der Maschine in ihr Element im **Inventar** ein, das ein CMDB-Export liest. Seriennummer, Hersteller, Modell und Firmware-Version (BIOS / UEFI) sind anders: **Kein Ressourcendetektor kann sie liefern.** Sie stammen aus der Firmware der Maschine, über WMI.",
  "Run this from an elevated PowerShell prompt on the machine — it queries WMI and prints the exact YAML for *this* machine:":
    "Führen Sie dies in einer PowerShell-Eingabeaufforderung mit erhöhten Rechten auf der Maschine aus — es fragt WMI ab und gibt das genaue YAML für *diese* Maschine aus:",
  "It prints one processor entry, already indented. Add it inside the `processors:` block your `config.yaml` already has — alongside `resourcedetection:`, `resource:` and `batch:`, not as a second `processors:` key — then name it in the metrics pipeline:":
    "Es gibt einen Prozessoreintrag aus, bereits eingerückt. Fügen Sie ihn in den `processors:`-Block ein, den Ihre `config.yaml` schon hat — neben `resourcedetection:`, `resource:` und `batch:`, nicht als zweiten `processors:`-Schlüssel — und nennen Sie ihn dann in der Metrik-Pipeline:",
  "Use `Get-CimInstance`, not the deprecated `Get-WmiObject` — it is absent from PowerShell 7 and later. Values are emitted in single quotes with any embedded quote doubled, so a serial or model containing punctuation stays valid YAML. A field the firmware leaves empty prints as `''`; drop that attribute rather than shipping a blank one.":
    "Verwenden Sie `Get-CimInstance`, nicht das veraltete `Get-WmiObject` — es fehlt ab PowerShell 7. Die Werte werden in einfachen Anführungszeichen ausgegeben, eingebettete Anführungszeichen verdoppelt, sodass eine Seriennummer oder ein Modell mit Satzzeichen gültiges YAML bleibt. Ein Feld, das die Firmware leer lässt, erscheint als `''`; lassen Sie dieses Attribut weg, statt ein leeres zu senden.",
  "Within a few minutes the machine's **Inventory** item shows `host.serial_number`, `device.manufacturer`, `device.model.name` and `device.firmware.version` under **Details**, alongside the IP and MAC addresses and machine id the detector already supplies. Run this again after a motherboard swap or a BIOS update — the values are stamped, not detected, so they do not update themselves.":
    "Innerhalb weniger Minuten zeigt das Element der Maschine im **Inventar** unter **Details** `host.serial_number`, `device.manufacturer`, `device.model.name` und `device.firmware.version`, neben den IP- und MAC-Adressen und der Maschinen-ID, die der Detektor bereits liefert. Führen Sie dies nach einem Mainboard-Tausch oder einem BIOS-Update erneut aus — die Werte sind fest geschrieben, nicht erkannt, sie aktualisieren sich also nicht selbst.",
  "- The **Services** tab lists each service's state once the `windows_service` receiver is enabled (see **Enable the Windows Services tab**).":
    "- Der Tab **Dienste** listet den Zustand jedes Dienstes, sobald der `windows_service`-Receiver aktiviert ist (siehe **Tab „Windows-Dienste“ aktivieren**).",
  "1. Read the collector's logs for export errors: **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`). An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `C:\\Program Files\\otelcol-contrib\\config.yaml`.":
    "1. Lesen Sie die Logs des Collectors auf Exportfehler: **Event Viewer → Windows Logs → Application** (Quelle `otelcol-contrib`). Ein HTTP-`401` bedeutet, dass der Schlüssel fehlt, falsch oder abgelaufen ist; `422`, dass er deaktiviert wurde (oder ein Browser-Schlüssel ist, der keine Host-Telemetrie senden kann). Wählen Sie in Schritt 1 einen funktionierenden Schlüssel und aktualisieren Sie `x-oneuptime-token` in `C:\\Program Files\\otelcol-contrib\\config.yaml`.",
  "1. Run the collector in the foreground to see the real error instead of the generic `Error 1064`:":
    "1. Führen Sie den Collector im Vordergrund aus, um statt des allgemeinen `Error 1064` den eigentlichen Fehler zu sehen:",
  '2. `Error 2: The system cannot find the file specified` means the service points at a file that is not there — compare `BINARY_PATH_NAME` from `sc.exe qc "otelcol-contrib"` with the contents of `C:\\Program Files\\otelcol-contrib`. The archive must be the `otelcol-contrib_` one, which unpacks `otelcol-contrib.exe`.':
    '2. `Error 2: The system cannot find the file specified` bedeutet, dass der Dienst auf eine Datei zeigt, die es nicht gibt — vergleichen Sie `BINARY_PATH_NAME` aus `sc.exe qc "otelcol-contrib"` mit dem Inhalt von `C:\\Program Files\\otelcol-contrib`. Das Archiv muss das `otelcol-contrib_`-Archiv sein, das `otelcol-contrib.exe` entpackt.',
  "3. **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`) records the startup error the service manager swallowed.":
    "3. **Event Viewer → Windows Logs → Application** (Quelle `otelcol-contrib`) verzeichnet den Startfehler, den der Dienststeuerungs-Manager verschluckt hat.",
  "If you set `include_services` but still see every service, the collector hasn't picked up the edit — restart the service (`Restart-Service otelcol-contrib`) and give the Services tab a few minutes to refresh its rolling window.":
    "Wenn Sie `include_services` setzen, aber weiterhin jeden Dienst sehen, hat der Collector die Änderung nicht übernommen — starten Sie den Dienst neu (`Restart-Service otelcol-contrib`) und geben Sie dem Tab „Dienste“ ein paar Minuten, um sein gleitendes Zeitfenster zu aktualisieren.",
  "Kubernetes nodes are monitored by the **OneUptime Kubernetes agent** rather than a host collector: each node appears under **Kubernetes** → your cluster → **Nodes**, next to its pods and workloads, not in the **Hosts** list. The steps below install the agent on a standard cluster; the install guide in the **Kubernetes** section has the steps for Amazon EKS, Google GKE, Azure AKS, GKE Autopilot and EKS Fargate.":
    "Kubernetes-Nodes überwacht der **OneUptime-Kubernetes-Agent** statt eines Host-Collectors: Jeder Node erscheint unter **Kubernetes** → Ihr Cluster → **Knoten**, neben seinen Pods und Workloads, nicht in der Liste **Hosts**. Die Schritte unten installieren den Agenten auf einem Standard-Cluster; die Installationsanleitung im Bereich **Kubernetes** enthält die Schritte für Amazon EKS, Google GKE, Azure AKS, GKE Autopilot und EKS Fargate.",
  "A Kubernetes cluster running v1.23 or later":
    "Ein Kubernetes-Cluster mit v1.23 oder neuer",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` und `helm` (v3), auf Ihrem Rechner installiert",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "Falscher Cluster? Wechseln Sie mit `kubectl config use-context <context-name>`.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "Ersetzen Sie `my-cluster` durch einen Namen für diesen Cluster, etwa `prod-us-east-1`. Unter diesem Namen erscheint der Cluster in OneUptime, halten Sie ihn also stabil: Ein neuer Name registriert einen neuen Cluster.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` schaltet **KI-Untersuchungen** ein, wie es das Chart standardmäßig tut: OneUptime AI untersucht Vorfälle und Warnungen in diesem Cluster mit schreibgeschütztem kubectl, über den Kubernetes-KI-Agenten.",
  "You should see:": "Sie sollten Folgendes sehen:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Den Collector und den Kubernetes-KI-Agenten, dazu je einen `-logs`- und einen `-ebpf`-Pod auf jedem Knoten. Sobald sie `Running` sind, erscheint der Cluster automatisch im Bereich **Kubernetes**, meist innerhalb von ein, zwei Minuten.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Kubernetes-KI-Agent (standardmäßig an, schreibgeschützt).** Der Pod `kubernetes-agent-ai-agent` lässt OneUptime AI Vorfälle und Warnungen in diesem Cluster mit schreibgeschütztem kubectl untersuchen (`get`, `describe`, `logs`, `events`, `top`), mit demselben API-Schlüssel, und er kann nichts ändern, solange Sie ihm später keinen Schreibzugriff geben. Öffnen Sie den Cluster und gehen Sie zu **KI → Agent**, um ihn zu sehen. Sie möchten ihn nicht? Installieren Sie mit `--set aiAgent.enabled=false` statt `--set aiAgent.enabled=true`.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "Namespace-Regeln legen fest, was der Agent aus jedem Namespace sammelt. Um Pod-Logs und eBPF-Daten nur aus `default`, `production` und `staging` zu sammeln:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "Um alles zu behalten, aber die Logs lauter Namespaces zu stoppen, schließen Sie sie nur von `podLogs` aus:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **Geltungsbereiche:** `podLogs` (stdout/stderr der Container), `ebpfDiscovery` (eBPF-Traces und -Metriken), `metrics` (Namespace-Metriken) und `traces` (jeder Span).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **Muster** passen auf den ganzen Namespace-Namen und akzeptieren `*`, wie in `team-*`. Eine `exclude`-Regel gewinnt immer gegen eine `include`-Regel.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **Eigene Regeln ersetzen die Standardregel**, die `kube-system` von `podLogs` und `ebpfDiscovery` ausschließt. Behalten Sie sie in Ihrer Liste, wie im zweiten Beispiel, wenn Sie das weiterhin möchten.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- Knoten- und Cluster-Metriken haben keinen Namespace und werden daher immer behalten.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` erfordert Helm 3.10 oder neuer.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**Nur wichtige Zeilen senden.** Verwerfen Sie Pod-Logzeilen unterhalb eines Schweregrads, bevor sie den Cluster verlassen:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    'Akzeptiert `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` und `FATAL`: `WARN` behält Warnungen, Fehler und fatale Zeilen. Der Schweregrad wird aus der Logzeile selbst gelesen (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes-Ereignisse werden dadurch nie verworfen.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Pod-Logs abschalten.** Metriken sind nicht betroffen: Der Knoten-Collector läuft für kubelet- und cAdvisor-Metriken weiter und liest nur keine Pod-Logs mehr:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**Ändern, wie Logs gelesen werden.** Das Preset wählt dies für Sie; ein ausdrückliches `logs.mode` hat immer Vorrang:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: liest `/var/log/pods` auf jedem Knoten über hostPath (geringster Aufwand; benötigt hostPath).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: Ein Deployment verfolgt Pod-Logs über die Kubernetes-API (funktioniert in jedem Cluster).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: keine Pod-Logs.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "Damit wird der API-Server gelesen, dort, wo er innerhalb des Clusters antwortet. etcd, der Scheduler und der Controller-Manager antworten auf den Control-Plane-Knoten, die der Pod des Agenten nicht erraten kann; er liest sie daher, sobald Sie die Adresse jedes Knotens angeben:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **Der Scheduler und der Controller-Manager** liefern HTTPS und akzeptieren das Token des Agenten, aber kubeadm bindet sie an `127.0.0.1`: Geben Sie ihnen eine `--bind-address`, die der Pod des Agenten erreichen kann.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** liefert seine Metriken per einfachem HTTP auf kubeadms `--listen-metrics-urls` (Port 2381, an `127.0.0.1` gebunden, bis Sie die Adresse des Knotens hinzufügen), wie oben. Oder fragen Sie seinen HTTPS-Client-Port 2379 mit dem Client-Zertifikat ab, das er verlangt: Legen Sie `ca.crt`, `tls.crt` und `tls.key` in ein Secret in `oneuptime-agent` und nennen Sie es in `controlPlane.etcd.clientCertSecret`.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "Nur für selbst verwaltete Cluster: Verwaltete Dienste (EKS, GKE, AKS) stellen ihre Control-Plane-Metriken nicht bereit.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "Die Kostenüberwachung ist standardmäßig eingeschaltet: Der Agent bringt die Open-Source-Engine OpenCost mit (plus das kleine Prometheus, das sie braucht), bepreist Ihre Knoten und Volumes nach den öffentlichen Listenpreisen Ihres Cloud-Anbieters, ganz ohne Zugangsdaten, und sendet, was jeder Namespace und jeder Workload kostet. Die ersten Daten erscheinen nach der ersten vollen Stunde in der Übersicht des Clusters und auf seiner Seite „Kosten“.",
  "On an agent installed before it was on by default, upgrade it:":
    "Wurde Ihr Agent installiert, bevor sie standardmäßig eingeschaltet war, upgraden Sie ihn:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **Ausschalten:** Fügen Sie demselben Upgrade `--set cost.enabled=false` hinzu.",
  "- **Already running Kubecost or OpenCost?** The agent finds it and reads it instead of the bundled engine, and the cluster's overview says so: add `--set cost.engine.url=auto` to stop bundling a second one.":
    "- **Läuft bereits Kubecost oder OpenCost?** Der Agent findet es und liest es anstelle der mitgelieferten Engine, und die Übersicht des Clusters zeigt das an: Fügen Sie `--set cost.engine.url=auto` hinzu, damit keine zweite mitgeliefert wird.",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **On-Premises oder Bare Metal?** Legen Sie mit `--set cost.opencost.customPricing.enabled=true` eine Preisliste fest (USD pro Ressourcenstunde, siehe `values.yaml` des Charts).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "Vollständige Anleitung: [Kubernetes-Kostenbeobachtung](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "Der Agent führt [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) auf jedem Knoten aus. Sie erfasst HTTP/HTTPS-, gRPC- und SQL/Redis-Verkehr von Go-, .NET-, Java-, Node.js-, Python-, Ruby- und Rust-Diensten, ohne SDK und ohne Sidecar, und liefert Traces, Anfrage-Metriken (RED) und Daten für den Service-Graphen über den Collector.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**Anforderungen:** Linux-Kernel **5.8+** mit BTF (Standard bei Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). Die eBPF-Pods laufen **privilegiert**, was sie zum Laden von eBPF-Programmen brauchen.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "**Schalten Sie sie ab**, wenn Ihre Knoten einen älteren Kernel haben, wenn privilegierte Pods nicht erlaubt sind oder wenn Ihre Dienste bereits Traces mit OpenTelemetry-SDKs senden und Sie keine Duplikate möchten:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**Signale auswählen.** Jede Familie wird mit `--set ebpf.features.<name>=false` (oder `=true`) geschaltet:",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | Standard | Was es hinzufügt |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | an | HTTP/gRPC-Anfragerate, Fehler und Latenz pro Dienst |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | an | Anzahl und Dauer der Span-Aufrufe (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | an | Kanten von Aufrufer → Aufgerufenem; speist die Service-Map |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | an | Pod-zu-Pod-Zähler für TCP/UDP-Flows |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | aus | Netzwerkmetriken zwischen Zonen (verdoppelt ihre Kardinalität) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | an | TCP-RTT sowie Zähler für fehlgeschlagene Verbindungen und Neuübertragungen pro Knoten |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**Dienstübergreifende Trace-Propagation** (eine Anfrage, die von Pod A → Pod B geht, zu einem einzigen Trace verbinden, auch auf einem anderen Knoten) ist **standardmäßig an**. Sie funktioniert, indem sie bereits laufenden Verkehr umschreibt (Klartext-HTTP-Anfragen im Kernel erweitert und an TLS und rohes TCP eine TCP-Option anhängt), und ein Fehler in dieser Byte-Buchhaltung bringt den Datenstrom aus dem Takt: Das gemeldete Symptom sind Übertragungen über einen L7-Proxy wie nginx, die hängen, sobald eine Antwort ~64KB überschreitet. Wenn Sie das sehen oder ein Service-Mesh Pods ausfallen lässt, schalten Sie sie mit `--set ebpf.contextPropagation=false` ab; ein OpenTelemetry-SDK propagiert `traceparent` im Userspace ohne all das.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Jedes `oneuptime.labels.<key>=<value>` wird zum Label `<key>:<value>` auf dem Cluster und auf den Diensten und Hosts, die er meldet. Labels werden ohne Berücksichtigung der Groß-/Kleinschreibung abgeglichen, daher wird ein bestehendes Label `Production` wiederverwendet; in der OneUptime-Oberfläche hinzugefügte Labels entfernt der Agent nie.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**Upgraden** Sie auf das neueste Chart. `--reset-then-reuse-values` (Helm 3.14+) behält die Werte, die Sie gesetzt haben (Preset, Clustername, Filter), und übernimmt alles andere aus dem neuen Chart; fügen Sie neue `--set`-Flags obendrauf hinzu:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "Mit Helm 3.13 und älter upgraden Sie stattdessen mit den Werten, die Sie gesetzt haben:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "Verwenden Sie nicht `--reuse-values`: Es behält auch die Standardwerte des Charts, von dem Sie upgraden, sodass die Standardwerte eines neueren Charts (darunter sein eBPF-Image) nie greifen.",
  "**Uninstall** the agent and its namespace:":
    "**Deinstallieren** Sie den Agenten und seinen Namespace:",
  "| Category | Data |": "| Kategorie | Daten |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **Knotenmetriken** | CPU-, Speicher-, Dateisystem- und Netzwerknutzung |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Pod- und Container-Metriken** | CPU, Speicher, Netzwerk-I/O und Neustarts |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **Cluster-Metriken** | Knotenzustände, zuweisbare Ressourcen, Anzahl der Pods und Workloads |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Kubernetes-Ereignisse** | Warnungen, Fehler und Scheduling-Ereignisse |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Pod-Logs** | stdout/stderr jedes Containers, von jedem Knoten gelesen |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **Anwendungs-Traces** *(eBPF)* | HTTP-, gRPC- und SQL/Redis-Spans von jedem Pod, ohne SDK oder Codeänderungen |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **Anfrage-Metriken und Service-Graph** *(eBPF)* | Anfragerate, Fehler und Latenz pro Dienst sowie Kanten von Aufrufer → Aufgerufenem für die Service-Map |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **Netzwerk-Flows** *(eBPF)* | Pod-zu-Pod-Zähler für TCP/UDP-Bytes und -Pakete |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **Workload-Kosten** *(standardmäßig an)* | Ausgaben pro Namespace, Workload und Pod, mit ungenutzter Kapazität und Effizienz, auch als Metriken für Warnungen |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "Ihr Cluster blockiert `hostPath`-Volumes oder privilegierte Pods. Das ist bei **GKE Autopilot** und **EKS Fargate** normal: Wählen Sie diese Plattform oben in dieser Anleitung und folgen Sie ihren Schritten. Auf **OpenShift** gelingt die Installation dagegen, aber die Knoten-Pods des Agenten starten nie: Wählen Sie **Red Hat OpenShift**.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "Entfernen Sie in jedem anderen Cluster mit einer restriktiven Pod-Security-Richtlinie das fehlgeschlagene Release:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "Führen Sie dann den Installationsbefehl erneut aus, ergänzt um `--set preset=gke-autopilot`. Dieses Preset liest Pod-Logs über die Kubernetes-API statt über hostPath, wendet einen gehärteten Sicherheitskontext an und lässt die privilegierten eBPF- und Profiling-Pods weg.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. Prüfen Sie, ob die Pods des Agenten laufen: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. Prüfen Sie die Logs des Collectors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. Prüfen Sie, ob die OneUptime-URL und der Ingestion-Schlüssel im Installationsbefehl stimmen.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. Stellen Sie sicher, dass der Cluster Ihre OneUptime-Instanz über das Netzwerk erreicht.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. Prüfen Sie den Pod des KI-Agenten: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. Prüfen Sie seine Logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. Kein Pod? Upgraden Sie das Chart (siehe **Agent aktualisieren oder deinstallieren** unter Erweitert) und fügen Sie `--set aiAgent.enabled=true` hinzu.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. Prüfen Sie, ob der Clustername passt: Diese Anleitung installiert **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. Prüfen Sie die RBAC-Berechtigungen des Agenten: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Suchen Sie in den Logs des Collectors nach Exportfehlern: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **Kernel zu alt oder kein BTF.** eBPF braucht Linux 5.8+ mit BTF; prüfen Sie es mit `uname -r` auf einem Knoten. Wenn Sie nicht upgraden können, schalten Sie eBPF mit `--set ebpf.enabled=false` ab.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **Privilegierte Pods blockiert.** Manche abgeriegelten Cluster lehnen sie ab. Schalten Sie eBPF ab.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` auf dem Host nicht verfügbar.** Schalten Sie nur die Familie der TCP-Statistiken ab: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. Prüfen Sie, ob die eBPF-Pods gesund sind: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. Schalten Sie die Debug-Ausgabe von OBI ein, um zu bestätigen, dass sie Verkehr sieht: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, und lesen Sie dann `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Wenn Spans dort erscheinen, aber nicht in OneUptime, prüfen Sie die Logs des Collectors auf Exportfehler: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
};

export default TRANSLATION;
