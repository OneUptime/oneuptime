import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The XcpNg setup guide in German (#8341): each piece of the English
 * guide's markdown (Pages/XcpNg/Utils/DocumentationMarkdown.ts) and its
 * German. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its German words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Xen Orchestra 6.9 or later, connected to the pools you want to monitor. Its OpenMetrics plugin needs a Premium licence on an XOA; Xen Orchestra built from sources includes it":
    "Xen Orchestra 6.9 oder neuer, verbunden mit den Pools, die Sie überwachen möchten. Sein OpenMetrics-Plugin braucht auf einer XOA eine Premium-Lizenz; ein aus den Quellen gebautes Xen Orchestra enthält es",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach Xen Orchestra over HTTPS":
    "Docker Engine 20.10 oder neuer mit dem Docker-Compose-v2-Plugin, auf einem Rechner, der Xen Orchestra über HTTPS erreicht",
  "A certificate on Xen Orchestra that names the address the agent connects to. The self-signed certificate Xen Orchestra makes for itself names none, so no current TLS client can check it — see **Xen Orchestra's certificate** under Advanced":
    "Ein Zertifikat auf Xen Orchestra, das die Adresse nennt, mit der sich der Agent verbindet. Das selbstsignierte Zertifikat, das Xen Orchestra für sich selbst erzeugt, nennt keine, daher kann kein aktueller TLS-Client es prüfen — siehe **Zertifikat von Xen Orchestra** unter Erweitert",
  "1. In Xen Orchestra, open *Settings → Plugins* and find **openmetrics**.":
    "1. Öffnen Sie in Xen Orchestra *Settings → Plugins* und suchen Sie **openmetrics**.",
  "2. Turn it on. The first time it starts, it makes a secret and keeps it, and Xen Orchestra keeps it across restarts.":
    "2. Schalten Sie es ein. Beim ersten Start erzeugt es ein Secret und behält es, und Xen Orchestra bewahrt es über Neustarts hinweg.",
  "3. Open the plugin's settings and copy its **Prometheus secret** — you give it to the agent in the next step. You can also type a secret of your own there and save it.":
    "3. Öffnen Sie die Einstellungen des Plugins und kopieren Sie sein **Prometheus secret** — Sie geben es im nächsten Schritt dem Agenten. Sie können dort auch ein eigenes Secret eingeben und speichern.",
  "The plugin answers on Xen Orchestra's own address and certificate, at `/openmetrics/metrics`, and only to a request that carries its secret. It serves every pool Xen Orchestra is connected to, so one agent covers them all.":
    "Das Plugin antwortet unter der eigenen Adresse von Xen Orchestra und mit dessen eigenem Zertifikat, unter `/openmetrics/metrics`, und nur auf eine Anfrage, die sein Secret mitbringt. Es liefert jeden Pool, mit dem Xen Orchestra verbunden ist, sodass ein Agent sie alle abdeckt.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Das Skript fragt nach Ihrer OneUptime-URL und Ihrem Ingestion-Schlüssel, beide in Schritt 1 angezeigt (wählen Sie dort einen Schlüssel, damit sie hier ausgefüllt werden), und danach nach:",
  "- **Xen Orchestra's address** — as you open it in a browser, e.g. `https://xo.example.com` or `https://10.0.0.5:8443`.":
    "- **Adresse von Xen Orchestra** — so, wie Sie sie im Browser öffnen, z. B. `https://xo.example.com` oder `https://10.0.0.5:8443`.",
  "- **The OpenMetrics plugin's secret** — from the previous step. It is not shown as you type it.":
    "- **Secret des OpenMetrics-Plugins** — aus dem vorigen Schritt. Es wird bei der Eingabe nicht angezeigt.",
  "- **What to call this Xen Orchestra** — the name each of its pools shows on its Settings. Press Enter to use its address.":
    "- **Wie dieses Xen Orchestra heißen soll** — der Name, den jeder seiner Pools in seinen Einstellungen zeigt. Drücken Sie Enter, um seine Adresse zu verwenden.",
  "The script then reads Xen Orchestra's certificate. When this machine already trusts it, the agent trusts the same CA bundle. When it does not, the script shows the certificate's SHA-256 fingerprint: compare it with the one on Xen Orchestra's machine and answer **y** to trust that certificate and nothing else. It never turns the check off. It then asks the plugin for its metrics with the secret and says which pools Xen Orchestra reports, before it installs anything.":
    "Danach liest das Skript das Zertifikat von Xen Orchestra. Vertraut dieser Rechner ihm bereits, vertraut der Agent demselben CA-Bundle. Wenn nicht, zeigt das Skript den SHA-256-Fingerabdruck des Zertifikats: Vergleichen Sie ihn mit dem auf dem Rechner von Xen Orchestra und antworten Sie **y**, um diesem Zertifikat und nichts anderem zu vertrauen. Die Prüfung schaltet es nie ab. Anschließend fragt es das Plugin mit dem Secret nach seinen Metriken und sagt, welche Pools Xen Orchestra meldet, bevor es irgendetwas installiert.",
  "It installs to `/opt/oneuptime-xcp-ng-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Es installiert nach `/opt/oneuptime-xcp-ng-agent`, schreibt eine `.env`-Datei mit `0600` und startet den Agenten mit Docker Compose. Ein erneuter Aufruf des Skripts übernimmt alles aus dieser `.env`, statt erneut zu fragen; so führen Sie auch ein Upgrade durch.",
  "`docker compose ps` lists `oneuptime-xcp-ng-agent`. In its logs, look for `Everything is ready. Begin running and processing data.` The agent reads Xen Orchestra every minute, and each pool it reports then appears in the **XCP-ng** section under the name Xen Orchestra gives it, with its hosts, VMs and storage.":
    "`docker compose ps` listet `oneuptime-xcp-ng-agent`. Suchen Sie in seinen Protokollen nach `Everything is ready. Begin running and processing data.` Der Agent liest Xen Orchestra jede Minute, und jeder Pool, den er meldet, erscheint dann im Bereich **XCP-ng** unter dem Namen, den Xen Orchestra ihm gibt, mit seinen Hosts, VMs und seinem Speicher.",
  "The install script writes these to `/opt/oneuptime-xcp-ng-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`.":
    "Das Installationsskript schreibt diese in `/opt/oneuptime-xcp-ng-agent/.env`. Nachdem Sie eine geändert haben, übernehmen Sie sie mit `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`.",
  "| Variable | Required | Description |":
    "| Variable | Erforderlich | Beschreibung |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | Die URL Ihrer OneUptime-Instanz (z. B. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | Telemetrie-Ingestion-Schlüssel — der in Schritt 1 gewählte |",
  "| `XO_ADDRESS` | Yes | Xen Orchestra's `host` or `host:port`, without a scheme |":
    "| `XO_ADDRESS` | Ja | `host` oder `host:port` von Xen Orchestra, ohne Schema |",
  "| `XO_SCHEME` | No | `https` (default). `http` only in a lab: the secret then crosses the network in clear |":
    "| `XO_SCHEME` | Nein | `https` (Standard). `http` nur im Labor: Das Secret geht dann im Klartext über das Netz |",
  "| `XO_OPENMETRICS_SECRET` | Yes | The OpenMetrics plugin's secret, sent as a Bearer token. Every `$` in it is written as `$$` |":
    "| `XO_OPENMETRICS_SECRET` | Ja | Das Secret des OpenMetrics-Plugins, als Bearer-Token gesendet. Jedes `$` darin wird als `$$` geschrieben |",
  "| `XO_NAME` | No | What to call this Xen Orchestra in OneUptime, shown on each of its pools' Settings (default: its address) |":
    "| `XO_NAME` | Nein | Wie dieses Xen Orchestra in OneUptime heißen soll, angezeigt in den Einstellungen jedes seiner Pools (Standard: seine Adresse) |",
  "| `XO_TLS_SERVER_NAME` | No | The name Xen Orchestra's certificate is checked against, when `XO_ADDRESS` is an address the certificate does not list |":
    "| `XO_TLS_SERVER_NAME` | Nein | Der Name, gegen den das Zertifikat von Xen Orchestra geprüft wird, wenn `XO_ADDRESS` eine Adresse ist, die das Zertifikat nicht aufführt |",
  "| `XO_URL` | Install script | Xen Orchestra's address as typed; the script derives `XO_SCHEME` and `XO_ADDRESS` from it |":
    "| `XO_URL` | Installationsskript | Die Adresse von Xen Orchestra, wie eingegeben; das Skript leitet `XO_SCHEME` und `XO_ADDRESS` daraus ab |",
  "| `XO_TLS_FINGERPRINT` | Install script | The SHA-256 fingerprint of Xen Orchestra's own certificate, when the agent trusts that certificate and nothing else |":
    "| `XO_TLS_FINGERPRINT` | Installationsskript | Der SHA-256-Fingerabdruck des eigenen Zertifikats von Xen Orchestra, wenn der Agent diesem Zertifikat und nichts anderem vertraut |",
  "| `XO_CA_FILE` | Install script | A CA bundle that issued Xen Orchestra's certificate, which the script copies to `xo-ca.pem` |":
    "| `XO_CA_FILE` | Installationsskript | Ein CA-Bundle, das das Zertifikat von Xen Orchestra ausgestellt hat; das Skript kopiert es nach `xo-ca.pem` |",
  "The agent checks Xen Orchestra's certificate against `xo-ca.pem`, next to `docker-compose.yml`.":
    "Der Agent prüft das Zertifikat von Xen Orchestra gegen `xo-ca.pem` neben `docker-compose.yml`.",
  "The agent checks Xen Orchestra's certificate on every read, against `xo-ca.pem` and nothing else. That file holds one of three things:":
    "Der Agent prüft das Zertifikat von Xen Orchestra bei jedem Lesen, gegen `xo-ca.pem` und nichts anderes. Diese Datei enthält eines von drei Dingen:",
  "- **Xen Orchestra's own certificate**, pinned by its SHA-256 fingerprint (`XO_TLS_FINGERPRINT`): the agent trusts that certificate and no other.":
    "- **Das eigene Zertifikat von Xen Orchestra**, festgelegt über seinen SHA-256-Fingerabdruck (`XO_TLS_FINGERPRINT`): Der Agent vertraut diesem Zertifikat und keinem anderen.",
  "- **The CA that issued it** (`XO_CA_FILE`), for a certificate from a CA of your own.":
    "- **Die CA, die es ausgestellt hat** (`XO_CA_FILE`), für ein Zertifikat einer eigenen CA.",
  "- **This machine's CA bundle**, for a certificate this machine already trusts.":
    "- **Das CA-Bundle dieses Rechners**, für ein Zertifikat, dem dieser Rechner bereits vertraut.",
  "Either way, the certificate must name the address the agent connects to: the agent checks the names a certificate is issued to, as every current TLS client does, and not its subject. The self-signed certificate Xen Orchestra makes for itself names none, so the agent cannot trust it, pinned or not, and fails with `x509: certificate is not valid for any names`. Give Xen Orchestra a certificate that names its address — from your CA, or a self-signed one with a subject alternative name — as [Xen Orchestra's certificate](/docs/telemetry/xcp-ng#xen-orchestras-certificate) shows.":
    "In jedem Fall muss das Zertifikat die Adresse nennen, mit der sich der Agent verbindet: Der Agent prüft die Namen, auf die ein Zertifikat ausgestellt ist, wie es jeder aktuelle TLS-Client tut, und nicht seinen Antragsteller. Das selbstsignierte Zertifikat, das Xen Orchestra für sich selbst erzeugt, nennt keine; der Agent kann ihm daher nicht vertrauen, ob festgelegt oder nicht, und scheitert mit `x509: certificate is not valid for any names`. Geben Sie Xen Orchestra ein Zertifikat, das seine Adresse nennt — von Ihrer CA oder ein selbstsigniertes mit einem alternativen Antragstellernamen (Subject Alternative Name) —, wie [Das Zertifikat von Xen Orchestra](/docs/telemetry/xcp-ng#xen-orchestras-certificate) zeigt.",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When a pinned certificate is renewed, the agent stops reading Xen Orchestra until it trusts the new one. Run the install script again: it shows the new fingerprint and stops, changing nothing. Check that fingerprint on Xen Orchestra's machine, then run the script once more with it: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.":
    "Nennt das Zertifikat Xen Orchestra unter einem anderen Namen als der Adresse in `XO_ADDRESS`, setzen Sie `XO_TLS_SERVER_NAME` auf diesen Namen. Wird ein festgelegtes Zertifikat erneuert, hört der Agent auf, Xen Orchestra zu lesen, bis er dem neuen vertraut. Führen Sie das Installationsskript erneut aus: Es zeigt den neuen Fingerabdruck und hält an, ohne etwas zu ändern. Prüfen Sie diesen Fingerabdruck auf dem Rechner von Xen Orchestra, und führen Sie das Skript dann noch einmal damit aus: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.",
  "Every minute the agent reads the plugin, which reads each host's XAPI round-robin databases at 60-second resolution. It keeps the `xcp_*` series, and moves each series' pool to the batch it sends, as `xcp_ng.pool.id` (the pool's UUID, which never changes) and `xcp_ng.pool.name`:":
    "Jede Minute liest der Agent das Plugin, das die Round-Robin-Datenbanken jedes Hosts über XAPI in 60-Sekunden-Auflösung liest. Er behält die Serien `xcp_*` und verschiebt den Pool jeder Serie in den Batch, den er sendet, als `xcp_ng.pool.id` (die UUID des Pools, die sich nie ändert) und `xcp_ng.pool.name`:",
  "| Category | Series |": "| Kategorie | Serien |",
  "| **Pool** | `xcp_pool_connected` — present while Xen Orchestra is connected to the pool |":
    "| **Pool** | `xcp_pool_connected` — vorhanden, solange Xen Orchestra mit dem Pool verbunden ist |",
  "| **Hosts** | `xcp_host_status` (power state and whether it is enabled), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` per interface, `xcp_host_disk_*` per storage repository |":
    "| **Hosts** | `xcp_host_status` (Betriebszustand und ob er aktiviert ist), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` pro Schnittstelle, `xcp_host_disk_*` pro Speicher-Repository |",
  "| **VMs** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU contention), `xcp_vm_memory_*`, `xcp_vm_network_*` per interface, `xcp_vm_disk_*` per disk, `xcp_vm_power_consumption_watts` |":
    "| **VMs** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU-Konkurrenz), `xcp_vm_memory_*`, `xcp_vm_network_*` pro Schnittstelle, `xcp_vm_disk_*` pro Datenträger, `xcp_vm_power_consumption_watts` |",
  "| **Storage** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |":
    "| **Speicher** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |",
  "| **XOSTOR** | `xcp_xostor_*`, on pools that run XOSTOR |":
    "| **XOSTOR** | `xcp_xostor_*`, auf Pools, die XOSTOR betreiben |",
  'Control domains report as VMs with `is_control_domain="true"`; the pages hide them unless you ask for them.':
    'Steuerdomänen melden sich als VMs mit `is_control_domain="true"`; die Seiten blenden sie aus, sofern Sie sie nicht anfordern.',
  "Xen Orchestra types eight throughput series as counters, though each holds XAPI's per-second rate: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, and the VM network, network error and disk read and write series. The agent turns them into gauges with their values untouched, so OneUptime stores them as the rates they are, in bytes or errors per second.":
    "Xen Orchestra typisiert acht Durchsatzserien als Zähler, obwohl jede die Rate pro Sekunde von XAPI enthält: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total` sowie die Serien der VMs für Netzwerk, Netzwerkfehler und das Lesen und Schreiben von Datenträgern. Der Agent macht sie zu Gauges, mit unveränderten Werten, sodass OneUptime sie als die Raten speichert, die sie sind, in Bytes oder Fehlern pro Sekunde.",
  "OneUptime adds four 0/1 series for each pool, which the alert templates read: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` and `xcp_ng.vm.stopped_after_running` (a VM halted or paused that ran in the last day). It also stamps every point with `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` or `xostor`) and `xcp_ng.id` (that object's UUID), which monitors and dashboards filter on.":
    "OneUptime fügt für jeden Pool vier 0/1-Serien hinzu, die die Warnungsvorlagen lesen: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` und `xcp_ng.vm.stopped_after_running` (eine angehaltene oder pausierte VM, die am letzten Tag lief). Außerdem versieht es jeden Messpunkt mit `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` oder `xostor`) und `xcp_ng.id` (der UUID dieses Objekts), nach denen Monitore und Dashboards filtern.",
  "Not kept: Xen Orchestra's own process series (`xo_*`), which belong to no pool, and a host's power read over IPMI, which the plugin sends without its pool. Each VM's estimated share of it is kept.":
    "Nicht behalten werden die eigenen Prozessserien von Xen Orchestra (`xo_*`), die zu keinem Pool gehören, und die über IPMI gelesene Leistungsaufnahme eines Hosts, die das Plugin ohne ihren Pool sendet. Der geschätzte Anteil jeder VM daran wird behalten.",
  "One agent reads one Xen Orchestra and every pool it manages. For a second Xen Orchestra, install a second agent in a folder of its own, with its own `container_name` in its `docker-compose.yml`:":
    "Ein Agent liest ein Xen Orchestra und jeden Pool, den es verwaltet. Für ein zweites Xen Orchestra installieren Sie einen zweiten Agenten in einem eigenen Ordner, mit einem eigenen `container_name` in seiner `docker-compose.yml`:",
  "Don't let two Xen Orchestras that manage the same pool both be read: the pool is one pool in OneUptime, by its UUID, and would be reported twice.":
    "Lassen Sie nicht zwei Xen Orchestras lesen, die denselben Pool verwalten: Der Pool ist in OneUptime über seine UUID ein einziger Pool und würde doppelt gemeldet.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on each pool the agent reads: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `oneuptime.agent.version`:":
    "Jedes Ressourcenattribut mit dem Präfix `oneuptime.label.` wird zu einer Projektbeschriftung an jedem Pool, den der Agent liest: `oneuptime.label.<dimension>=<value>` ist die Beschriftung `<dimension>:<value>`. Fügen Sie sie dem Prozessor `resource` in `otel-collector-config.yaml` hinzu, neben `oneuptime.agent.version`:",
  "Then restart the collector so it reads the new config:":
    "Starten Sie dann den Collector neu, damit er die neue Konfiguration liest:",
  "The pools show up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent. Running the install script again replaces an edited `otel-collector-config.yaml` and keeps yours next to it as `otel-collector-config.yaml.bak.<timestamp>`.":
    "Die Pools erscheinen mit den Beschriftungen `team:platform` und `env:production`. Beschriftungen werden ohne Beachtung der Groß- und Kleinschreibung abgeglichen, sodass eine vorhandene Beschriftung `Production` wiederverwendet wird; in der OneUptime-Oberfläche hinzugefügte Beschriftungen entfernt der Agent nie. Ein erneuter Aufruf des Installationsskripts ersetzt eine bearbeitete `otel-collector-config.yaml` und bewahrt Ihre daneben als `otel-collector-config.yaml.bak.<timestamp>` auf.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), checks Xen Orchestra's certificate the same way, downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the image and recreates the agent with it:":
    "**Upgrade** — das Collector-Image ist in `docker-compose.yml` festgelegt und seine Konfiguration ist eine Datei daneben, daher bringt Ziehen allein den Agenten nicht voran. Führen Sie das Installationsskript erneut aus. Es übernimmt jeden Wert aus Ihrer vorhandenen `.env` (es wird nichts erneut gefragt), prüft das Zertifikat von Xen Orchestra auf dieselbe Weise, lädt die neueste `docker-compose.yml` und `otel-collector-config.yaml` herunter — eine von Ihnen bearbeitete Datei bleibt als `<file>.bak.<timestamp>` neben der neuen erhalten —, zieht das Image und erstellt den Agenten damit neu:",
  "The config reports the collector version it pins as each pool's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "Die Konfiguration meldet die Collector-Version, die sie festlegt, als **Agent-Version** jedes Pools. Legt dieses OneUptime eine neuere fest, öffnet ein Warnzeichen daneben diese Befehle.",
  "**Uninstall** the agent:": "**Deinstallieren** Sie den Agenten:",
  "Then turn off the OpenMetrics plugin in Xen Orchestra if nothing else reads it.":
    "Schalten Sie dann das OpenMetrics-Plugin in Xen Orchestra ab, wenn nichts anderes es liest.",
  "`troubleshoot.sh` checks the whole chain — the container, Xen Orchestra's certificate against `xo-ca.pem`, the plugin and its secret, the pools it reports — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss.":
    "`troubleshoot.sh` prüft die ganze Kette — den Container, das Zertifikat von Xen Orchestra gegen `xo-ca.pem`, das Plugin und sein Secret, die Pools, die es meldet — und fragt OneUptime direkt, ob es Ihren Ingestion-Schlüssel akzeptiert. Diese letzte Prüfung ist die wichtigste: Die OTLP-Endpunkte von OneUptime lehnen einen falschen Schlüssel mit `401` oder `422` ab, was der Collector pro Batch als eine einzige, leicht zu übersehende Zeile `Exporting failed` protokolliert.",
  "It ends with a verdict naming the most likely cause. It never prints the secret.":
    "Es endet mit einem Urteil, das die wahrscheinlichste Ursache nennt. Das Secret gibt es nie aus.",
  "OneUptime marks a pool Disconnected when nothing has been read for it for 15 minutes.":
    "OneUptime markiert einen Pool als Getrennt, wenn 15 Minuten lang nichts für ihn gelesen wurde.",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. Sind alle Pools dieses Xen Orchestra Getrennt, prüfen Sie den Agenten (in `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` und `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "2. If only one is, Xen Orchestra stopped reporting it: under *Settings → Servers* in Xen Orchestra, the pool's server must be connected. The pool's hosts, VMs and storage stay as Xen Orchestra last reported them.":
    "2. Ist es nur einer, hat Xen Orchestra aufgehört, ihn zu melden: Unter *Settings → Servers* in Xen Orchestra muss der Server des Pools verbunden sein. Hosts, VMs und Speicher des Pools bleiben so, wie Xen Orchestra sie zuletzt gemeldet hat.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "Der Collector protokolliert `server returned HTTP status 401 Unauthorized`. Kopieren Sie das Secret erneut aus *Settings → Plugins → openmetrics*, setzen Sie `XO_OPENMETRICS_SECRET` in `.env` darauf — zwischen einfachen Anführungszeichen, jedes `$` als `$$` geschrieben — und übernehmen Sie es mit `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`. Vor 6.8 erzeugte Xen Orchestra bei jedem Neustart ein neues Secret.",
  'Xen Orchestra answers, but its OpenMetrics plugin does not. Turn the plugin on under *Settings → Plugins → openmetrics* (an XOA needs a Premium licence for it), and check that Xen Orchestra is 6.9 or later. `/openmetrics/health` answers `{"status":"ok"}` without a secret while the plugin runs.':
    'Xen Orchestra antwortet, aber sein OpenMetrics-Plugin nicht. Schalten Sie das Plugin unter *Settings → Plugins → openmetrics* ein (eine XOA braucht dafür eine Premium-Lizenz) und prüfen Sie, dass Xen Orchestra 6.9 oder neuer ist. `/openmetrics/health` antwortet ohne Secret mit `{"status":"ok"}`, solange das Plugin läuft.',
  "- `x509: certificate is not valid for any names` — the certificate names no address, as Xen Orchestra's own self-signed one does. Give Xen Orchestra a certificate that names its address.":
    "- `x509: certificate is not valid for any names` — das Zertifikat nennt keine Adresse, wie das eigene selbstsignierte von Xen Orchestra. Geben Sie Xen Orchestra ein Zertifikat, das seine Adresse nennt.",
  "- `x509: certificate is valid for <names>, not <address>` — connect to one of those names, or set `XO_TLS_SERVER_NAME` to one.":
    "- `x509: certificate is valid for <names>, not <address>` — verbinden Sie sich mit einem dieser Namen, oder setzen Sie `XO_TLS_SERVER_NAME` auf einen davon.",
  "- `x509: certificate signed by unknown authority` — `xo-ca.pem` does not hold this certificate or the CA that issued it. The certificate was renewed, or the file holds the wrong one: write it again, as **Xen Orchestra's certificate** under Advanced says.":
    "- `x509: certificate signed by unknown authority` — `xo-ca.pem` enthält weder dieses Zertifikat noch die CA, die es ausgestellt hat. Das Zertifikat wurde erneuert, oder die Datei enthält das falsche: Schreiben Sie sie neu, wie **Zertifikat von Xen Orchestra** unter Erweitert es beschreibt.",
  "Xen Orchestra reports only the pools it is connected to, and the agent reads only that Xen Orchestra. Connect the pool's server under *Settings → Servers* in Xen Orchestra; the pool appears in OneUptime with the next read. A pool read by another Xen Orchestra needs an agent beside that one.":
    "Xen Orchestra meldet nur die Pools, mit denen es verbunden ist, und der Agent liest nur dieses Xen Orchestra. Verbinden Sie den Server des Pools unter *Settings → Servers* in Xen Orchestra; der Pool erscheint mit dem nächsten Lesen in OneUptime. Ein Pool, den ein anderes Xen Orchestra liest, braucht einen Agenten neben jenem Xen Orchestra.",
  "- **What to call this Xen Orchestra** — the command already names it **`xo-paris`**, as this pool's Settings show it.":
    "- **Wie dieses Xen Orchestra heißen soll** — der Befehl nennt es bereits **`xo-paris`**, wie die Einstellungen dieses Pools es zeigen.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "Der Befehl enthält bereits Ihre OneUptime-URL und Ihren Ingestion-Schlüssel. Nach dem Rest fragt das Skript:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Laden Sie `docker-compose.yml` und `otel-collector-config.yaml` von diesem OneUptime in einen neuen Ordner herunter:",
  "Create a `.env` file next to them — it holds the plugin's secret, so keep it private with `chmod 600 .env`:":
    "Legen Sie daneben eine `.env`-Datei an — sie enthält das Secret des Plugins, schützen Sie sie also mit `chmod 600 .env`:",
  "- Set `XO_ADDRESS` to Xen Orchestra's `host` or `host:port`, without `https://`.":
    "- Setzen Sie `XO_ADDRESS` auf `host` oder `host:port` von Xen Orchestra, ohne `https://`.",
  "- Put the plugin's secret between single quotes. If it holds a `$`, write each one as `$$`: the collector reads the value once more.":
    "- Setzen Sie das Secret des Plugins zwischen einfache Anführungszeichen. Enthält es ein `$`, schreiben Sie jedes als `$$`: Der Collector liest den Wert ein weiteres Mal.",
  "- `XO_NAME` is what each pool's Settings call this Xen Orchestra.":
    "- `XO_NAME` ist der Name, mit dem die Einstellungen jedes Pools dieses Xen Orchestra bezeichnen.",
  "Then give the agent Xen Orchestra's certificate, as `xo-ca.pem` next to `docker-compose.yml` — the agent checks Xen Orchestra against this file and nothing else. To trust Xen Orchestra's own certificate, read it and check its fingerprint against the one on Xen Orchestra's machine:":
    "Geben Sie dem Agenten dann das Zertifikat von Xen Orchestra, als `xo-ca.pem` neben `docker-compose.yml` — der Agent prüft Xen Orchestra gegen diese Datei und nichts anderes. Um dem eigenen Zertifikat von Xen Orchestra zu vertrauen, lesen Sie es und prüfen Sie seinen Fingerabdruck gegen den auf dem Rechner von Xen Orchestra:",
  "When a CA of your own issued it, copy that CA's certificate to `xo-ca.pem` instead; when a public CA did, copy this machine's CA bundle (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).":
    "Hat eine eigene CA es ausgestellt, kopieren Sie stattdessen das Zertifikat dieser CA nach `xo-ca.pem`; war es eine öffentliche CA, kopieren Sie das CA-Bundle dieses Rechners (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).",
  "Start the agent:": "Starten Sie den Agenten:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Wählen Sie in Schritt 1 einen Ingestion-Schlüssel, um `<YOUR_API_KEY>` auszufüllen.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "Der Agent liest diese aus der `.env`-Datei neben `docker-compose.yml`. Nachdem Sie eine geändert haben, übernehmen Sie sie mit `docker compose up -d` im Ordner mit `docker-compose.yml`.",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When the certificate in `xo-ca.pem` is renewed, read it again as in step 3, then run `docker compose up -d --force-recreate`.":
    "Nennt das Zertifikat Xen Orchestra unter einem anderen Namen als der Adresse in `XO_ADDRESS`, setzen Sie `XO_TLS_SERVER_NAME` auf diesen Namen. Wird das Zertifikat in `xo-ca.pem` erneuert, lesen Sie es wie in Schritt 3 neu und führen Sie dann `docker compose up -d --force-recreate` aus.",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Führen Sie diese im Ordner des Agenten aus, dem mit `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `xo-ca.pem` stay, and a change you made to either file has to be made again:":
    "**Upgrade** — das Collector-Image ist in `docker-compose.yml` festgelegt und seine Konfiguration ist eine Datei daneben, daher bringt Ziehen allein den Agenten nicht voran. Laden Sie beide Dateien erneut herunter; Ihre `.env` und `xo-ca.pem` bleiben, und eine Änderung, die Sie an einer der Dateien vorgenommen haben, müssen Sie erneut vornehmen:",
  "Then pull the image and recreate the agent, so the collector reads its new config:":
    "Ziehen Sie dann das Image und erstellen Sie den Agenten neu, damit der Collector seine neue Konfiguration liest:",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in the agent's folder): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. Sind alle Pools dieses Xen Orchestra Getrennt, prüfen Sie den Agenten (im Ordner des Agenten): `docker compose ps` und `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "Der Collector protokolliert `server returned HTTP status 401 Unauthorized`. Kopieren Sie das Secret erneut aus *Settings → Plugins → openmetrics*, setzen Sie `XO_OPENMETRICS_SECRET` in `.env` darauf — zwischen einfachen Anführungszeichen, jedes `$` als `$$` geschrieben — und übernehmen Sie es mit `docker compose up -d` im Ordner mit `docker-compose.yml`. Vor 6.8 erzeugte Xen Orchestra bei jedem Neustart ein neues Secret.",
};

export default TRANSLATION;
