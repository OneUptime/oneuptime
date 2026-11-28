import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Proxmox setup guide in German (#8341): each piece of the English
 * guide's markdown (Pages/Proxmox/Utils/DocumentationMarkdown.ts) and its
 * German. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its German words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach every node's Proxmox VE API on port 8006":
    "Docker Engine 20.10 oder neuer mit dem Docker-Compose-v2-Plugin, auf einem Rechner, der die Proxmox-VE-API jedes Knotens auf Port 8006 erreicht",
  "A root shell on any PVE node, or the Proxmox web UI, to create a read-only API token":
    "Eine Root-Shell auf einem beliebigen PVE-Knoten oder die Proxmox-Weboberfläche, um ein schreibgeschütztes API-Token zu erstellen",
  "Ideally a machine outside the cluster, or a VM that Proxmox HA restarts on another node — the agent reads the cluster from another node when one goes down, but not when its own machine does":
    "Idealerweise ein Rechner außerhalb des Clusters oder eine VM, die Proxmox HA auf einem anderen Knoten neu startet — der Agent liest den Cluster von einem anderen Knoten, wenn einer ausfällt, aber nicht, wenn sein eigener Rechner ausfällt",
  "As root on any PVE node:": "Als root auf einem beliebigen PVE-Knoten:",
  "- The first line only fails, harmlessly, if `monitoring@pam` already exists. API tokens carry their own secret, so the user needs no password or system account.":
    "- Die erste Zeile schlägt nur fehl, und zwar harmlos, wenn `monitoring@pam` bereits existiert. API-Tokens haben ihr eigenes Geheimnis, daher braucht der Benutzer weder Passwort noch Systemkonto.",
  "- `pveum user token add` prints the token secret — copy it now, it is shown only once. The token id is `monitoring@pam!oneuptime`.":
    "- `pveum user token add` gibt das Token-Geheimnis aus — kopieren Sie es jetzt, es wird nur einmal angezeigt. Die Token-ID ist `monitoring@pam!oneuptime`.",
  "- The role goes on the user as well as the token because a privilege-separated token only gets the permissions its user also has. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "- Die Rolle kommt auf den Benutzer und auf das Token, weil ein Token mit Privilegientrennung nur die Berechtigungen erhält, die auch sein Benutzer hat. Sie muss auf dem Wurzelpfad `/` liegen: pve-exporter liest den Status des ganzen Clusters, und ein auf einen Unterpfad beschränktes Token scheitert mit `Permission check failed (/, Sys.Audit)`.",
  "1. Go to *Datacenter → Permissions → API Tokens* and click **Add**.":
    "1. Gehen Sie zu *Datacenter → Permissions → API Tokens* und klicken Sie auf **Add**.",
  "2. Pick (or create) a user, give the token an ID like `oneuptime`, make sure **Privilege Separation** is checked, and click **Add**.":
    "2. Wählen Sie einen Benutzer (oder legen Sie einen an), geben Sie dem Token eine ID wie `oneuptime`, achten Sie darauf, dass **Privilege Separation** aktiviert ist, und klicken Sie auf **Add**.",
  "3. Copy the token id (`user@realm!tokenname`) and the secret — the secret is shown only once.":
    "3. Kopieren Sie die Token-ID (`user@realm!tokenname`) und das Geheimnis — das Geheimnis wird nur einmal angezeigt.",
  "4. Under *Datacenter → Permissions*, click **Add** twice to give path `/` the **PVEAuditor** role: once as an **API Token Permission** for the token, once as a **User Permission** for its user.":
    "4. Klicken Sie unter *Datacenter → Permissions* zweimal auf **Add**, um dem Pfad `/` die Rolle **PVEAuditor** zu geben: einmal als **API Token Permission** für das Token, einmal als **User Permission** für seinen Benutzer.",
  "A privilege-separated token only gets the permissions its user also has, so both need the role. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "Ein Token mit Privilegientrennung erhält nur die Berechtigungen, die auch sein Benutzer hat, daher brauchen beide die Rolle. Sie muss auf dem Wurzelpfad `/` liegen: pve-exporter liest den Status des ganzen Clusters, und ein auf einen Unterpfad beschränktes Token scheitert mit `Permission check failed (/, Sys.Audit)`.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Das Skript fragt nach Ihrer OneUptime-URL und Ihrem Ingestion-Schlüssel, beide in Schritt 1 angezeigt (wählen Sie dort einen Schlüssel, damit sie hier ausgefüllt werden), und danach nach:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **Clustername** — wie der Cluster in OneUptime erscheint. Geben Sie jedem Cluster einen eigenen und halten Sie ihn stabil: Ein neuer Name registriert einen neuen Cluster.",
  "- **Proxmox VE API host** — any node, e.g. `192.168.1.10`. While its API does not answer, the agent reads the cluster from the next node in the list below.":
    "- **Proxmox-VE-API-Host** — ein beliebiger Knoten, z. B. `192.168.1.10`. Solange seine API nicht antwortet, liest der Agent den Cluster vom nächsten Knoten der Liste unten.",
  "- **Bundled prometheus-pve-exporter** — answer **Y** unless you already run one.":
    "- **Mitgelieferter prometheus-pve-exporter** — antworten Sie **Y**, sofern Sie nicht bereits einen betreiben.",
  "- **API token** — the token id and secret from the previous step.":
    "- **API-Token** — die Token-ID und das Geheimnis aus dem vorigen Schritt.",
  "- **Every node's address** — each node's own address, comma-separated, never a virtual IP. With the token, the script offers the cluster's own list: press Enter to take it. The agent also reads the cluster from these when the first node is down.":
    "- **Adresse jedes Knotens** — die eigene Adresse jedes Knotens, durch Kommas getrennt, nie eine virtuelle IP. Mit dem Token bietet das Skript die Liste des Clusters selbst an: Drücken Sie Enter, um sie zu übernehmen. Von diesen Knoten liest der Agent den Cluster auch, wenn der erste ausgefallen ist.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only.":
    "- **OneUptime-KI-Agent** — ob er Korrekturen anwenden darf; antworten Sie **N**, damit er schreibgeschützt bleibt.",
  "It installs to `/opt/oneuptime-proxmox-agent`, writes a `0600` `.env` file and starts everything with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Es installiert nach `/opt/oneuptime-proxmox-agent`, schreibt eine `.env`-Datei mit `0600` und startet alles mit Docker Compose. Ein erneuter Aufruf des Skripts übernimmt alles aus dieser `.env`, statt erneut zu fragen; so führen Sie auch ein Upgrade durch.",
  "`docker compose ps` lists the collector (`oneuptime-proxmox-agent`), the node failover (`oneuptime-pve-api-failover`), the bundled exporter (`oneuptime-pve-exporter`, unless you use your own) and the OneUptime AI agent (`oneuptime-proxmox-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cluster then appears automatically in the **Proxmox** section.":
    "`docker compose ps` listet den Collector (`oneuptime-proxmox-agent`), das Knoten-Failover (`oneuptime-pve-api-failover`), den mitgelieferten Exporter (`oneuptime-pve-exporter`, sofern Sie keinen eigenen verwenden) und den KI-Agenten von OneUptime (`oneuptime-proxmox-ai-agent`). Suchen Sie in den Protokollen des Collectors nach `Everything is ready. Begin running and processing data.` Der Cluster erscheint dann automatisch im Bereich **Proxmox**.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `pvesh` requests, and changes nothing unless you allow fixes — see **OneUptime AI agent** under Advanced.":
    "**KI-Agent von OneUptime (standardmäßig aktiv, schreibgeschützt).** KI-Untersuchungen sind aktiviert: Mit ihm untersucht OneUptime AI Vorfälle und Warnungen auf diesem Cluster mit schreibgeschützten `pvesh`-Anfragen und ändert nichts, solange Sie keine Korrekturen erlauben — siehe **OneUptime-KI-Agent** unter Erweitert.",
  "Needs Proxmox VE 8.3 or later. Pick an ingestion key in step 1 to show the two commands: they carry the key, which Proxmox VE keeps in the webhook target they add.":
    "Erfordert Proxmox VE 8.3 oder neuer. Wählen Sie in Schritt 1 einen Ingestion-Schlüssel, um die beiden Befehle anzuzeigen: Sie enthalten den Schlüssel, den Proxmox VE in dem Webhook-Ziel aufbewahrt, das sie hinzufügen.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts.":
    "Die Seite jedes Gasts zeigt dann sein letztes Backup, und die **Empfehlungen** des Clusters bieten die Warnungen **Backup Job Failed** und **Node Fenced** an.",
  "The install script writes these to `/opt/oneuptime-proxmox-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`.":
    "Das Installationsskript schreibt diese in `/opt/oneuptime-proxmox-agent/.env`. Nachdem Sie eine geändert haben, übernehmen Sie sie mit `docker compose up -d` in `/opt/oneuptime-proxmox-agent`.",
  "| Variable | Required | Description |":
    "| Variable | Erforderlich | Beschreibung |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | Die URL Ihrer OneUptime-Instanz (z. B. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | Telemetrie-Ingestion-Schlüssel — der in Schritt 1 gewählte |",
  "| `PROXMOX_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `proxmox.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `proxmox-cluster`) |":
    "| `PROXMOX_CLUSTER_NAME` | Ja | Die Kennung des Clusters in OneUptime. An jeder Metrik als Ressourcenattribut `proxmox.cluster.name` vermerkt. Halten Sie sie stabil — eine Änderung registriert einen neuen Cluster (Standard: `proxmox-cluster`) |",
  "| `PVE_HOST` | Yes | The node whose Proxmox VE API the exporter reads the cluster from and the AI agent queries, e.g. `192.168.1.10`. While its API does not answer, both use the next node in `PVE_NODES` that does |":
    "| `PVE_HOST` | Ja | Der Knoten, über dessen Proxmox-VE-API der Exporter den Cluster liest und den der KI-Agent abfragt, z. B. `192.168.1.10`. Solange seine API nicht antwortet, verwenden beide den nächsten Knoten in `PVE_NODES`, der antwortet |",
  "| `PVE_NODES` | On a cluster | Every node's own API address, comma-separated in square brackets, e.g. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Defaults to `PVE_HOST` alone, which is enough for a single node. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen. The agent also reads the cluster from the next of them when `PVE_HOST` goes down. |":
    "| `PVE_NODES` | In einem Cluster | Die eigene API-Adresse jedes Knotens, durch Kommas getrennt in eckigen Klammern, z. B. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Standardmäßig nur `PVE_HOST`, was für einen einzelnen Knoten genügt. Der Exporter liest den Start beim Hochfahren (Guest Down), die Replikation und das Abonnement nur für den Knoten, den er fragt, daher wird jeder Knoten der Reihe nach gefragt; ein ausgelassener Knoten bleibt unsichtbar. Der Agent liest den Cluster auch vom nächsten dieser Knoten, wenn `PVE_HOST` ausfällt. |",
  "| `PVE_EXPORTER_URL` | No | Address (`host:port`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (`pve-exporter:9221`) |":
    "| `PVE_EXPORTER_URL` | Nein | Adresse (`host:port`, ohne Schema) des prometheus-pve-exporter. Standardmäßig der mitgelieferte Exporter (`pve-exporter:9221`) |",
  "| `PVE_API_TOKEN_ID` | Bundled exporter and AI agent | Full Proxmox API token id, e.g. `monitoring@pam!oneuptime` (PVEAuditor, read-only) |":
    "| `PVE_API_TOKEN_ID` | Mitgelieferter Exporter und KI-Agent | Vollständige ID des Proxmox-API-Tokens, z. B. `monitoring@pam!oneuptime` (PVEAuditor, schreibgeschützt) |",
  "| `PVE_API_TOKEN_SECRET` | Bundled exporter and AI agent | Proxmox API token secret |":
    "| `PVE_API_TOKEN_SECRET` | Mitgelieferter Exporter und KI-Agent | Geheimnis des Proxmox-API-Tokens |",
  "| `PVE_VERIFY_SSL` | No | Verify the Proxmox API TLS certificate (default: `false` — PVE ships self-signed certificates) |":
    "| `PVE_VERIFY_SSL` | Nein | Das TLS-Zertifikat der Proxmox-API prüfen (Standard: `false` — PVE wird mit selbstsignierten Zertifikaten ausgeliefert) |",
  "| `COMPOSE_PROFILES` | No | Set to `pve-exporter` to start the bundled exporter container |":
    "| `COMPOSE_PROFILES` | Nein | Auf `pve-exporter` setzen, um den Container des mitgelieferten Exporters zu starten |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "Die eigenen Einstellungen des KI-Agenten von OneUptime stehen unter **OneUptime-KI-Agent**.",
  "When the install script asks **Run the bundled prometheus-pve-exporter?**, answer **n** and give your exporter's address (`host:port`, no scheme).":
    "Wenn das Installationsskript **Run the bundled prometheus-pve-exporter?** fragt, antworten Sie **n** und geben Sie die Adresse Ihres Exporters an (`host:port`, ohne Schema).",
  "Use an address the agent's container can reach — the host's LAN IP or DNS name: `localhost` inside the container is the container itself. Keep `PVE_API_TOKEN_ID` and `PVE_API_TOKEN_SECRET` in `.env` if you use the OneUptime AI agent, which reads the API with that token.":
    "Verwenden Sie eine Adresse, die der Container des Agenten erreicht — die LAN-IP oder den DNS-Namen des Hosts: `localhost` ist im Container der Container selbst. Behalten Sie `PVE_API_TOKEN_ID` und `PVE_API_TOKEN_SECRET` in `.env`, wenn Sie den KI-Agenten von OneUptime verwenden, der die API mit diesem Token liest.",
  "The agent scrapes the exporter every 30 seconds: its cluster collectors once, at `PVE_HOST` (or the node it reads the cluster from while `PVE_HOST` is down), and its node collectors once for each node in `PVE_NODES`. Every series carries an `id` label identifying the resource — `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>`, or `storage/<node>/<storage>`:":
    "Der Agent scrapt den Exporter alle 30 Sekunden: seine Cluster-Collectors einmal, bei `PVE_HOST` (oder dem Knoten, von dem er den Cluster liest, solange `PVE_HOST` ausgefallen ist), und seine Knoten-Collectors einmal für jeden Knoten in `PVE_NODES`. Jede Serie trägt ein Label `id`, das die Ressource bezeichnet — `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>` oder `storage/<node>/<storage>`:",
  "| Category | Metrics |": "| Kategorie | Metriken |",
  "| **Availability** | `pve_up`, `pve_uptime_seconds` |":
    "| **Verfügbarkeit** | `pve_up`, `pve_uptime_seconds` |",
  "| **Node** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |":
    "| **Knoten** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |",
  "| **Guest (VM / LXC)** | `pve_guest_info`, plus CPU / memory / network series on `qemu/*` and `lxc/*` ids |":
    "| **Gast (VM / LXC)** | `pve_guest_info` sowie CPU-, Arbeitsspeicher- und Netzwerkserien auf den IDs `qemu/*` und `lxc/*` |",
  "| **Storage** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |":
    "| **Speicher** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |",
  "| **HA** | `pve_ha_state` |":
    "| **HA** (Hochverfügbarkeit) | `pve_ha_state` |",
  "| **Backup coverage** | `pve_not_backed_up_total`, `pve_not_backed_up_info` — guests no backup job selects (whether backups ran or succeeded is not exposed) |":
    "| **Backup-Abdeckung** | `pve_not_backed_up_total`, `pve_not_backed_up_info` — Gäste, die kein Backup-Job auswählt (ob Backups liefen oder erfolgreich waren, wird nicht gemeldet) |",
  "| **Start-on-boot** | `pve_onboot_status` per guest, which **Guest Down** reads |":
    "| **Start beim Hochfahren** | `pve_onboot_status` pro Gast, den **Guest Down** liest |",
  "| **Replication** | `pve_replication_*` series per storage replication job — their `id` label is the job id (e.g. `100-0`), not a resource |":
    "| **Replikation** | `pve_replication_*`-Serien pro Speicher-Replikationsjob — ihr Label `id` ist die Job-ID (z. B. `100-0`), keine Ressource |",
  "Start-on-boot and replication come from the exporter's node collectors, which read only the node the exporter asks: a node missing from `PVE_NODES` has neither.":
    "Start beim Hochfahren und Replikation kommen von den Knoten-Collectors des Exporters, die nur den Knoten lesen, den der Exporter fragt: Ein Knoten, der in `PVE_NODES` fehlt, hat beides nicht.",
  "The collector also splits the `id` label into three equality-filterable datapoint attributes (the `transform/pve-identity` processor) — monitor criteria and dashboard filters match on these:":
    "Der Collector zerlegt das Label `id` außerdem in drei auf Gleichheit filterbare Datenpunktattribute (der Prozessor `transform/pve-identity`) — Monitorkriterien und Dashboard-Filter gleichen auf diese ab:",
  "| Attribute | Values | Example for `qemu/100` |":
    "| Attribut | Werte | Beispiel für `qemu/100` |",
  "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` and `lxc` both map to `guest`) | `guest` |":
    "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` und `lxc` werden beide zu `guest`) | `guest` |",
  "| `pve.id` | Everything after the first `/` of `id` (`pve1`, `100`, `pve1/local`) | `100` |":
    "| `pve.id` | Alles nach dem ersten `/` von `id` (`pve1`, `100`, `pve1/local`) | `100` |",
  "The original `id` label is kept untouched.":
    "Das ursprüngliche Label `id` bleibt unverändert erhalten.",
  "The agent reads the whole cluster through one node's API: `PVE_HOST`'s while it answers. Every 15 seconds the `oneuptime-pve-api-failover` container checks that node, and when its API stops answering the collector reads the cluster from the next node in `PVE_NODES` that answers, until `PVE_HOST` answers again. With the API token in `.env` it also passes over a node that answers but is cut off from the quorate part of the cluster, whose view would report every other node down. The OneUptime AI agent does the same for each of its calls. So when a node fails, **Node Offline** fires for it and the rest of the cluster keeps reporting.":
    "Der Agent liest den ganzen Cluster über die API eines Knotens: die von `PVE_HOST`, solange er antwortet. Alle 15 Sekunden prüft der Container `oneuptime-pve-api-failover` diesen Knoten, und wenn seine API nicht mehr antwortet, liest der Collector den Cluster vom nächsten Knoten in `PVE_NODES`, der antwortet, bis `PVE_HOST` wieder antwortet. Mit dem API-Token in `.env` überspringt er auch einen Knoten, der zwar antwortet, aber vom Teil des Clusters mit Quorum abgeschnitten ist: Aus dessen Sicht wären alle anderen Knoten ausgefallen. Der KI-Agent von OneUptime tut bei jedem seiner Aufrufe dasselbe. Fällt also ein Knoten aus, wird **Node Offline** für ihn ausgelöst, und der Rest des Clusters meldet weiter.",
  "Its logs say which node the cluster is read from, and why.":
    "Seine Protokolle zeigen, von welchem Knoten der Cluster gelesen wird und warum.",
  "What it cannot cover is the machine the agent runs on: if that goes down, the whole cluster goes quiet and **Cluster Stopped Reporting** fires. Run the agent off the cluster, or in a VM that Proxmox HA restarts on another node (`ha-manager add vm:<vmid>`, on shared storage), and run one agent per cluster: each agent reads the whole cluster, so a second one reports every resource twice. See [When a node goes down](/docs/telemetry/proxmox#when-a-node-goes-down).":
    "Nicht abdecken kann es den Rechner, auf dem der Agent läuft: Fällt dieser aus, verstummt der ganze Cluster, und **Cluster Stopped Reporting** wird ausgelöst. Betreiben Sie den Agenten außerhalb des Clusters oder in einer VM, die Proxmox HA auf einem anderen Knoten neu startet (`ha-manager add vm:<vmid>`, auf gemeinsamem Speicher), und betreiben Sie einen Agenten pro Cluster: Jeder Agent liest den ganzen Cluster, daher meldet ein zweiter jede Ressource doppelt. Siehe [Wenn ein Knoten ausfällt](/docs/telemetry/proxmox#when-a-node-goes-down).",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values. The `transform/pve-identity` processor derives the `pve.scope` / `pve.type` / `pve.id` attributes that the built-in Proxmox alert templates and dashboard filters rely on — keep it in place if you customize the config:":
    "Dies ist die vollständige `otel-collector-config.yaml`, die der Agent ausführt; die `.env`-Datei liefert die Werte `${env:...}`. Der Prozessor `transform/pve-identity` leitet die Attribute `pve.scope` / `pve.type` / `pve.id` ab, auf die sich die integrierten Proxmox-Warnungsvorlagen und Dashboard-Filter stützen — behalten Sie ihn bei, wenn Sie die Konfiguration anpassen:",
  "By default the agent ships metrics only, so the cluster's **Logs** tab stays empty. The PVE services log to the systemd journal, and the shipped config has a commented-out `journald` receiver for `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` and `qmeventd`.":
    "Standardmäßig sendet der Agent nur Metriken, daher bleibt der Tab **Protokolle** des Clusters leer. Die PVE-Dienste protokollieren in das systemd-Journal, und die mitgelieferte Konfiguration hat einen auskommentierten Receiver `journald` für `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` und `qmeventd`.",
  "1. **Run the agent on a PVE node.** The journal is per host, so a remote agent cannot read it, and each node ships only its own. To keep the metrics agent off the cluster, run a second, log-only collector on each node instead.":
    "1. **Betreiben Sie den Agenten auf einem PVE-Knoten.** Das Journal gibt es pro Host, daher kann ein entfernter Agent es nicht lesen, und jeder Knoten sendet nur sein eigenes. Um den Metrik-Agenten außerhalb des Clusters zu halten, betreiben Sie stattdessen auf jedem Knoten einen zweiten Collector nur für Protokolle.",
  "2. Uncomment the `journald` receiver and the `logs` pipeline in `otel-collector-config.yaml`, and the two journal volumes in `docker-compose.yml`.":
    "2. Kommentieren Sie den Receiver `journald` und die Pipeline `logs` in `otel-collector-config.yaml` ein, ebenso die beiden Journal-Volumes in `docker-compose.yml`.",
  "3. **Swap the collector image.** The stock image has no `journalctl` and runs as a user that cannot read the journal. Build this wrapper and point `image:` in `docker-compose.yml` at it:":
    "3. **Tauschen Sie das Collector-Image aus.** Das Standard-Image hat kein `journalctl` und läuft als Benutzer, der das Journal nicht lesen kann. Bauen Sie diesen Wrapper und lassen Sie `image:` in `docker-compose.yml` auf ihn zeigen:",
  "4. Apply it:": "4. Übernehmen Sie es:",
  "Rather keep the stock image? The documentation has a `filelog` fallback that tails `/var/log/syslog`: [Ship Proxmox service logs](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).":
    "Möchten Sie lieber das Standard-Image behalten? Die Dokumentation hat eine Ausweichlösung mit `filelog`, die `/var/log/syslog` mitliest: [Proxmox-Dienstprotokolle weiterleiten](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `proxmox.cluster.name`:":
    "Jedes Ressourcenattribut mit dem Präfix `oneuptime.label.` wird zu einem Projekt-Label am Cluster: `oneuptime.label.<dimension>=<value>` ist das Label `<dimension>:<value>`. Fügen Sie sie dem Prozessor `resource` in `otel-collector-config.yaml` hinzu, neben `proxmox.cluster.name`:",
  "Then restart the collector so it reads the new config:":
    "Starten Sie dann den Collector neu, damit er die neue Konfiguration liest:",
  "The cluster shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Der Cluster erscheint mit den Labels `team:platform` und `env:production`. Labels werden ohne Beachtung der Groß- und Kleinschreibung abgeglichen, sodass ein vorhandenes Label `Production` wiederverwendet wird; in der OneUptime-Oberfläche hinzugefügte Labels entfernt der Agent nie.",
  "`docker-compose.yml` also runs **`oneuptime-proxmox-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs read-only `pvesh` commands through it — `pvesh get /cluster/status`, a guest's current status, a node's failed tasks. There is no `pvesh` binary in it: each command becomes one call to the Proxmox VE API at `PVE_HOST`. It registers as the cluster named `PROXMOX_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` führt außerdem **`oneuptime-proxmox-ai-agent`** aus. Während OneUptime AI einen Vorfall oder eine Warnung auf diesem Cluster untersucht, führt es darüber schreibgeschützte `pvesh`-Befehle aus — `pvesh get /cluster/status`, den aktuellen Status eines Gasts, die fehlgeschlagenen Aufgaben eines Knotens. Ein `pvesh`-Programm enthält er nicht: Jeder Befehl wird zu einem Aufruf der Proxmox-VE-API bei `PVE_HOST`. Er meldet sich als der Cluster namens `PROXMOX_CLUSTER_NAME` an und erscheint auf der Seite **KI → KI-Agent** des Clusters.",
  "- **The API token is the hard limit.** It reads with the collector's PVEAuditor token (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), which can read and nothing else. If you run your own exporter and have no token in `.env`, add one.":
    "- **Das API-Token ist die feste Grenze.** Er liest mit dem PVEAuditor-Token des Collectors (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), das lesen kann und sonst nichts. Wenn Sie Ihren eigenen Exporter betreiben und kein Token in `.env` haben, fügen Sie eines hinzu.",
  "- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`. Fixes — starting or rebooting a guest — also need a token of its own that may power guests, set as `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; the agent's README has the `pveum` commands. If the agent runs in a guest of this cluster, put that guest's VMID in `ONEUPTIME_AI_PROTECTED_TARGETS`.":
    "- Er ist **schreibgeschützt**, solange Sie nicht `ONEUPTIME_AI_ALLOW_WRITES=true` setzen. Korrekturen — einen Gast starten oder neu starten — brauchen außerdem ein eigenes Token, das Gäste ein- und ausschalten darf, gesetzt als `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; die README des Agenten enthält die `pveum`-Befehle. Läuft der Agent in einem Gast dieses Clusters, tragen Sie die VMID dieses Gasts in `ONEUPTIME_AI_PROTECTED_TARGETS` ein.",
  "- Check it: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- Prüfen Sie ihn: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-proxmox-ai-agent` service from `docker-compose.yml`.":
    "- Sie nutzen OneUptime AI nicht? Löschen Sie den Dienst `oneuptime-proxmox-ai-agent` aus `docker-compose.yml`.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#proxmox-clusters).":
    "Was er ausführen darf und wie Korrekturen funktionieren: [KI-Agenten für die Infrastruktur](/docs/ai/infrastructure-ai-agents#proxmox-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them:":
    "**Upgrade** — das Collector-Image ist in `docker-compose.yml` festgelegt und seine Konfiguration ist eine Datei daneben, daher bringt Ziehen allein den Agenten nicht voran. Führen Sie das Installationsskript erneut aus. Es übernimmt jeden Wert aus Ihrer vorhandenen `.env` (es wird nichts erneut gefragt), lädt die neueste `docker-compose.yml` und `otel-collector-config.yaml` herunter — eine von Ihnen bearbeitete Datei bleibt als `<file>.bak.<timestamp>` neben der neuen erhalten —, zieht die Images und erstellt den Agenten damit neu:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "Die Konfiguration meldet die Collector-Version, die sie festlegt, als **Agent-Version** des Clusters. Legt dieses OneUptime eine neuere fest, öffnet ein Warnzeichen daneben diese Befehle.",
  "**Uninstall** the agent:": "**Deinstallieren** Sie den Agenten:",
  "Then delete the API token under *Datacenter → Permissions → API Tokens* if you no longer need it.":
    "Löschen Sie dann das API-Token unter *Datacenter → Permissions → API Tokens*, wenn Sie es nicht mehr brauchen.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the exporter scrape, cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` prüft die ganze Kette — Container-Laufzeit, das Scrapen des Exporters, das Vermerken des Clusternamens, die Form des Tokens, die Selbstmetriken des Collectors — und fragt OneUptime direkt, ob es Ihren Ingestion-Schlüssel akzeptiert. Diese letzte Prüfung ist die wichtigste: Die OTLP-Endpunkte von OneUptime lehnen einen falschen Schlüssel mit `401` oder `422` ab, was der Collector pro Batch als eine einzige, leicht zu übersehende Zeile `Exporting failed` protokolliert; daher fragt das Skript `GET /otlp/v1/validate` nach einem direkten Urteil 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Es endet mit einem Urteil, das die wahrscheinlichste Ursache nennt.",
  "1. Check that the agent is running (in `/opt/oneuptime-proxmox-agent`): `docker compose ps`":
    "1. Prüfen Sie, ob der Agent läuft (in `/opt/oneuptime-proxmox-agent`): `docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-proxmox-agent | grep -i error`":
    "2. Prüfen Sie die Protokolle des Agenten auf Fehler: `docker compose logs oneuptime-proxmox-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Prüfen Sie, ob Ihre OneUptime-URL und Ihr Ingestion-Schlüssel stimmen.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Stellen Sie sicher, dass der Rechner des Agenten die OneUptime-Instanz über das Netzwerk erreicht.",
  "1. Check the exporter answers. The bundled exporter does not publish its port on the host, so run curl inside its network namespace — you should see `pve_*` metric lines (for your own exporter, curl its `host:9221` directly):":
    "1. Prüfen Sie, ob der Exporter antwortet. Der mitgelieferte Exporter veröffentlicht seinen Port nicht auf dem Host, führen Sie curl daher in seinem Netzwerk-Namespace aus — Sie sollten Metrikzeilen `pve_*` sehen (bei Ihrem eigenen Exporter rufen Sie dessen `host:9221` direkt mit curl ab):",
  "2. Verify the API token has the **PVEAuditor** role on path `/`, on the token and on its user.":
    "2. Prüfen Sie, ob das API-Token die Rolle **PVEAuditor** auf dem Pfad `/` hat, auf dem Token und auf seinem Benutzer.",
  "3. Check the collector logs for scrape or export errors (in `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`":
    "3. Prüfen Sie die Protokolle des Collectors auf Scrape- oder Exportfehler (in `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`",
  "The API token is wrong or lacks permissions. Re-check the token id format (`user@realm!tokenname`), the secret, and that the **PVEAuditor** role is granted on path `/` to the token and to its user. The exporter's own logs show the API's answer: `docker logs oneuptime-pve-exporter`":
    "Das API-Token ist falsch oder hat nicht die nötigen Berechtigungen. Prüfen Sie erneut das Format der Token-ID (`user@realm!tokenname`), das Geheimnis und ob die Rolle **PVEAuditor** auf dem Pfad `/` dem Token und seinem Benutzer erteilt ist. Die eigenen Protokolle des Exporters zeigen die Antwort der API: `docker logs oneuptime-pve-exporter`",
  'Guest series (`qemu/*`, `lxc/*` ids) come from the exporter\'s cluster collector. The shipped config enables it (the `cluster=1` scrape parameter) — if you customized the config, restore the `cluster: ["1"]` param.':
    'Gastserien (IDs `qemu/*`, `lxc/*`) kommen vom Cluster-Collector des Exporters. Die mitgelieferte Konfiguration aktiviert ihn (der Scrape-Parameter `cluster=1`) — wenn Sie die Konfiguration angepasst haben, stellen Sie den Parameter `cluster: ["1"]` wieder her.',
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "Ihre Flags für den Start beim Hochfahren und ihre Replikationsjobs kommen von dem Knoten, auf dem sie laufen, und der Agent liest nur die Knoten in `PVE_NODES`. Tragen Sie dort die eigene Adresse jedes Knotens ein, etwa `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, und übernehmen Sie sie mit `docker compose up -d` in `/opt/oneuptime-proxmox-agent`. Startet der Collector nach einer Änderung nicht mehr, hat die Liste ihre eckigen Klammern verloren. `troubleshoot.sh` prüft jeden Knoten der Liste.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "Die Identität des Clusters kommt aus `PROXMOX_CLUSTER_NAME`, an jeder Metrik als `proxmox.cluster.name` vermerkt. Korrigieren Sie sie in `.env` und übernehmen Sie sie mit `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — beachten Sie, dass ein neuer Name einen neuen Cluster registriert.",
  "- **Cluster name** — enter **`pve-1`** exactly; a different name registers a new cluster.":
    "- **Clustername** — geben Sie genau **`pve-1`** ein; ein anderer Name registriert einen neuen Cluster.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "Die Identität des Clusters kommt aus `PROXMOX_CLUSTER_NAME`, an jeder Metrik als `proxmox.cluster.name` vermerkt. Dieser Cluster ist **`pve-1`**. Korrigieren Sie sie in `.env` und übernehmen Sie sie mit `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — beachten Sie, dass ein neuer Name einen neuen Cluster registriert.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "Der Befehl enthält bereits Ihre OneUptime-URL und Ihren Ingestion-Schlüssel. Nach dem Rest fragt das Skript:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the cluster name you gave the agent, so the notifications reach the same cluster.":
    "Erfordert Proxmox VE 8.3 oder neuer. Der erste Befehl fügt ein Webhook-Ziel namens `oneuptime` hinzu, das jede Benachrichtigung als Protokolleintrag dieses Clusters an OneUptime sendet und den Schlüssel und den Namen des Clusters in seinen Secrets aufbewahrt. Der zweite sendet jede Benachrichtigung dorthin. Ersetzen Sie `my-proxmox-cluster` durch den Clusternamen, den Sie dem Agenten gegeben haben, damit die Benachrichtigungen denselben Cluster erreichen.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts. To stop sending them:":
    "Die Seite jedes Gasts zeigt dann sein letztes Backup, und die **Empfehlungen** des Clusters bieten die Warnungen **Backup Job Failed** und **Node Fenced** an. Um das Senden zu beenden:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. The command already names **`pve-1`**, so the notifications reach this cluster.":
    "Erfordert Proxmox VE 8.3 oder neuer. Der erste Befehl fügt ein Webhook-Ziel namens `oneuptime` hinzu, das jede Benachrichtigung als Protokolleintrag dieses Clusters an OneUptime sendet und den Schlüssel und den Namen des Clusters in seinen Secrets aufbewahrt. Der zweite sendet jede Benachrichtigung dorthin. Der Befehl nennt bereits **`pve-1`**, daher erreichen die Benachrichtigungen diesen Cluster.",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Laden Sie `docker-compose.yml` und `otel-collector-config.yaml` von diesem OneUptime in einen neuen Ordner herunter:",
  "Create a `.env` file next to them — it holds the token secret, so keep it private with `chmod 600 .env`:":
    "Legen Sie daneben eine `.env`-Datei an — sie enthält das Token-Geheimnis, schützen Sie sie also mit `chmod 600 .env`:",
  "- Replace `my-proxmox-cluster` with a name for this cluster, such as `pve-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- Ersetzen Sie `my-proxmox-cluster` durch einen Namen für diesen Cluster, etwa `pve-prod`. Unter diesem Namen erscheint der Cluster in OneUptime, halten Sie ihn also stabil: Ein neuer Name registriert einen neuen Cluster.",
  "- Set `PVE_HOST` to any node of the cluster: while its API does not answer, the agent reads the cluster from the next node in `PVE_NODES`, so it needs no virtual IP.":
    "- Setzen Sie `PVE_HOST` auf einen beliebigen Knoten des Clusters: Solange seine API nicht antwortet, liest der Agent den Cluster vom nächsten Knoten in `PVE_NODES`, daher braucht er keine virtuelle IP.",
  "- Set `PVE_NODES` to every node's own address, in square brackets, never a virtual IP. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen.":
    "- Setzen Sie `PVE_NODES` auf die eigene Adresse jedes Knotens, in eckigen Klammern, nie eine virtuelle IP. Der Exporter liest den Start beim Hochfahren (Guest Down), die Replikation und das Abonnement nur für den Knoten, den er fragt, daher wird jeder Knoten der Reihe nach gefragt; ein ausgelassener Knoten bleibt unsichtbar.",
  "- Fill in the token from the previous step. `COMPOSE_PROFILES=pve-exporter` also starts the bundled prometheus-pve-exporter, which reads the API with it.":
    "- Tragen Sie das Token aus dem vorigen Schritt ein. `COMPOSE_PROFILES=pve-exporter` startet außerdem den mitgelieferten prometheus-pve-exporter, der die API damit liest.",
  "Start the agent:": "Starten Sie den Agenten:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Wählen Sie in Schritt 1 einen Ingestion-Schlüssel, um `<YOUR_API_KEY>` auszufüllen.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "Der Agent liest diese aus der `.env`-Datei neben `docker-compose.yml`. Nachdem Sie eine geändert haben, übernehmen Sie sie mit `docker compose up -d` im Ordner mit `docker-compose.yml`.",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter instead (`host:port`, no scheme):":
    "Lassen Sie `COMPOSE_PROFILES` in `.env` weg und verweisen Sie den Agenten stattdessen auf Ihren Exporter (`host:port`, ohne Schema):",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Führen Sie diese im Ordner des Agenten aus, dem mit `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**Upgrade** — das Collector-Image ist in `docker-compose.yml` festgelegt und seine Konfiguration ist eine Datei daneben, daher bringt Ziehen allein den Agenten nicht voran. Laden Sie beide Dateien erneut herunter; Ihre `.env` bleibt, und eine Änderung, die Sie an einer der Dateien vorgenommen haben, müssen Sie erneut vornehmen:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Ziehen Sie dann die Images und erstellen Sie den Agenten neu, damit der Collector seine neue Konfiguration liest:",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. Prüfen Sie, ob der Agent läuft (im Ordner des Agenten): `docker compose ps`",
  "3. Check the collector logs for scrape or export errors (in the agent's folder): `docker compose logs oneuptime-proxmox-agent`":
    "3. Prüfen Sie die Protokolle des Collectors auf Scrape- oder Exportfehler (im Ordner des Agenten): `docker compose logs oneuptime-proxmox-agent`",
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "Ihre Flags für den Start beim Hochfahren und ihre Replikationsjobs kommen von dem Knoten, auf dem sie laufen, und der Agent liest nur die Knoten in `PVE_NODES`. Tragen Sie dort die eigene Adresse jedes Knotens ein, etwa `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, und übernehmen Sie sie mit `docker compose up -d` im Ordner mit `docker-compose.yml`. Startet der Collector nach einer Änderung nicht mehr, hat die Liste ihre eckigen Klammern verloren. `troubleshoot.sh` prüft jeden Knoten der Liste.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "Die Identität des Clusters kommt aus `PROXMOX_CLUSTER_NAME`, an jeder Metrik als `proxmox.cluster.name` vermerkt. Korrigieren Sie sie in `.env` und übernehmen Sie sie mit `docker compose up -d` im Ordner mit `docker-compose.yml` — beachten Sie, dass ein neuer Name einen neuen Cluster registriert.",
  "- This installs the agent for **`pve-1`** — keep `PROXMOX_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- Dies installiert den Agenten für **`pve-1`** — lassen Sie `PROXMOX_CLUSTER_NAME` genau so, wie es ist, sonst werden die Daten als neuer Cluster registriert.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "Die Identität des Clusters kommt aus `PROXMOX_CLUSTER_NAME`, an jeder Metrik als `proxmox.cluster.name` vermerkt. Dieser Cluster ist **`pve-1`**. Korrigieren Sie sie in `.env` und übernehmen Sie sie mit `docker compose up -d` im Ordner mit `docker-compose.yml` — beachten Sie, dass ein neuer Name einen neuen Cluster registriert.",
  "**No agent, but less data.** Proxmox VE 9.0 and later push each node's metrics to OneUptime themselves. HA state, start-on-boot (used by **Guest Down**), backup coverage and replication are not pushed — use the install script or Docker Compose if you need them. Use one or the other for a cluster: running both reports every resource twice.":
    "**Kein Agent, aber weniger Daten.** Proxmox VE 9.0 und neuer senden die Metriken jedes Knotens selbst an OneUptime. HA-Status, Start beim Hochfahren (von **Guest Down** verwendet), Backup-Abdeckung und Replikation werden nicht gesendet — verwenden Sie das Installationsskript oder Docker Compose, wenn Sie sie brauchen. Verwenden Sie für einen Cluster das eine oder das andere: Wer beides betreibt, meldet jede Ressource doppelt.",
  "Proxmox VE **9.0 or later**": "Proxmox VE **9.0 oder neuer**",
  "The Proxmox web UI, to add a metric server under *Datacenter → Metric Server*":
    "Die Proxmox-Weboberfläche, um unter *Datacenter → Metric Server* einen Metrikserver hinzuzufügen",
  "Every node can reach `<YOUR_ONEUPTIME_HOST>` on port `443`":
    "Jeder Knoten erreicht `<YOUR_ONEUPTIME_HOST>` auf Port `443`",
  "| Field | Value |": "| Feld | Wert |",
  "| **Server** | `<YOUR_ONEUPTIME_HOST>` |":
    "| **Server** (Hostname) | `<YOUR_ONEUPTIME_HOST>` |",
  "| **Port** | `443` |": "| **Port** (Portnummer) | `443` |",
  "| **Protocol** | `https` |": "| **Protocol** (Protokoll) | `https` |",
  "| **Path** | `/otlp/v1/metrics` |":
    "| **Path** (Pfad) | `/otlp/v1/metrics` |",
  "| **Headers** | The JSON below |": "| **Headers** | Das JSON unten |",
  "Add it once for the datacenter — every node of the cluster then pushes its own metrics.":
    "Fügen Sie ihn einmal für das Datacenter hinzu — jeder Knoten des Clusters sendet dann seine eigenen Metriken.",
  "OneUptime translates the push into the same `pve_*` series the agent sends. The cluster registers itself under your Proxmox cluster name — a standalone node under its node name — and appears in the **Proxmox** section, where the Nodes, Guests and Storage pages, the overview charts, the metric catalog and the CPU / memory / storage alert templates work as they do with the agent.":
    "OneUptime übersetzt den Push in dieselben `pve_*`-Serien, die der Agent sendet. Der Cluster registriert sich unter Ihrem Proxmox-Clusternamen — ein eigenständiger Knoten unter seinem Knotennamen — und erscheint im Bereich **Proxmox**, wo die Seiten Knoten, Gäste und Speicher, die Übersichtsdiagramme, der Metrikkatalog und die Warnungsvorlagen für CPU, Arbeitsspeicher und Speicher so funktionieren wie mit dem Agenten.",
  "Each node pushes only its own status, so a node that goes down cannot report itself down — the nodes still alive report it for it:":
    "Jeder Knoten sendet nur seinen eigenen Status, daher kann ein ausgefallener Knoten seinen Ausfall nicht selbst melden — die noch laufenden Knoten melden ihn für ihn:",
  "- It shows **Offline** on the Proxmox pages about 2 minutes after its last report, and **Node Offline** fires after about 5 minutes.":
    "- Etwa 2 Minuten nach seiner letzten Meldung wird er auf den Proxmox-Seiten als **Offline** angezeigt, und nach etwa 5 Minuten wird **Node Offline** ausgelöst.",
  "- **Cluster Quorum at Risk** counts it as offline too; it fires about 7–9 minutes after the node went quiet, once its whole 5-minute window has reports.":
    "- **Cluster Quorum at Risk** zählt ihn ebenfalls als offline; die Warnung wird etwa 7–9 Minuten, nachdem der Knoten verstummt ist, ausgelöst, sobald ihr ganzes 5-Minuten-Fenster Meldungen enthält.",
  "- Its next report brings it back.":
    "- Seine nächste Meldung bringt ihn zurück.",
  'Offline means "stopped reporting": a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. A standalone host or a whole cluster going silent has nobody left to report it, so the cluster turns **Disconnected** instead. A node silent for more than 7 days is no longer reported. The reports are marked `oneuptime.proxmox.inferred=not-reporting` in Metrics Explorer.':
    "Offline heißt „meldet nicht mehr“: Ein hängender `pvestatd`, ein gestoppter `pmxcfs` oder eine unterbrochene Netzwerkverbindung zu OneUptime sehen gleich aus. Verstummt ein eigenständiger Host oder ein ganzer Cluster, ist niemand mehr da, der es meldet, daher wird der Cluster stattdessen als **Getrennt** angezeigt. Ein Knoten, der länger als 7 Tage schweigt, wird nicht mehr gemeldet. Die Meldungen sind im Metrik-Explorer mit `oneuptime.proxmox.inferred=not-reporting` markiert.",
  "The cluster registers under its Proxmox cluster name; a standalone node registers under its node name. A `proxmox.cluster.name` resource attribute set under the metric server's *Resource Attributes* keeps being used instead.":
    "Der Cluster registriert sich unter seinem Proxmox-Clusternamen; ein eigenständiger Knoten registriert sich unter seinem Knotennamen. Ein Ressourcenattribut `proxmox.cluster.name`, das unter *Resource Attributes* des Metrikservers gesetzt ist, wird stattdessen weiterhin verwendet.",
  "OneUptime translates the push into the `pve_*` series the agent sends, so the Proxmox pages and the CPU / memory / storage alert templates work unchanged. The original `proxmox_*` series stay available in Metrics Explorer for anything else Proxmox VE reports.":
    "OneUptime übersetzt den Push in die `pve_*`-Serien, die der Agent sendet, daher funktionieren die Proxmox-Seiten und die Warnungsvorlagen für CPU, Arbeitsspeicher und Speicher unverändert. Die ursprünglichen `proxmox_*`-Serien bleiben im Metrik-Explorer für alles andere verfügbar, was Proxmox VE meldet.",
  "Some alert templates need data only the agent collects:":
    "Manche Warnungsvorlagen brauchen Daten, die nur der Agent erfasst:",
  "| Needs the agent | Why |": "| Braucht den Agenten | Warum |",
  "| HA state | Not pushed — the **HA Resource in Error State** template needs the agent |":
    "| HA-Status | Nicht gesendet — die Vorlage **HA Resource in Error State** braucht den Agenten |",
  "| Start-on-boot flag | Not pushed — **Guest Down**, which only pages for guests set to start on boot, needs the agent |":
    "| Flag für den Start beim Hochfahren | Nicht gesendet — **Guest Down**, das nur für Gäste auslöst, die beim Hochfahren starten sollen, braucht den Agenten |",
  "| Backup coverage and replication | Not pushed — **Guest Not Backed Up** and **Replication Failing** need the agent |":
    "| Backup-Abdeckung und Replikation | Nicht gesendet — **Guest Not Backed Up** und **Replication Failing** brauchen den Agenten |",
  "Every node has stopped reporting, or never started.":
    "Jeder Knoten hat aufgehört zu melden oder nie damit begonnen.",
  "1. Under *Datacenter → Metric Server*, check the OpenTelemetry entry: server `<YOUR_ONEUPTIME_HOST>`, port `443`, protocol `https`, path `/otlp/v1/metrics`, and the `x-oneuptime-token` header with a key from step 1.":
    "1. Prüfen Sie unter *Datacenter → Metric Server* den OpenTelemetry-Eintrag: Server `<YOUR_ONEUPTIME_HOST>`, Port `443`, Protokoll `https`, Pfad `/otlp/v1/metrics` und den Header `x-oneuptime-token` mit einem Schlüssel aus Schritt 1.",
  "2. Check that the nodes can reach `<YOUR_ONEUPTIME_HOST>` over the network.":
    "2. Prüfen Sie, ob die Knoten `<YOUR_ONEUPTIME_HOST>` über das Netzwerk erreichen.",
  "It stopped reporting: a node that is down, a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. Its next report brings it back. If you took the node out of the cluster, use **Remove Node** on its page — otherwise it stays Offline for up to 7 days.":
    "Er meldet nicht mehr: Ein ausgefallener Knoten, ein hängender `pvestatd`, ein gestoppter `pmxcfs` oder eine unterbrochene Netzwerkverbindung zu OneUptime sehen gleich aus. Seine nächste Meldung bringt ihn zurück. Wenn Sie den Knoten aus dem Cluster genommen haben, verwenden Sie auf seiner Seite **Knoten entfernen** — sonst bleibt er bis zu 7 Tage Offline.",
  "The native push does not send HA state, start-on-boot, backup coverage or replication. Pick **Install script** or **Docker Compose** at the top of this guide to run the agent instead — and remove the metric server, since running both reports every resource twice.":
    "Der native Push sendet weder HA-Status noch Start beim Hochfahren, Backup-Abdeckung oder Replikation. Wählen Sie oben in dieser Anleitung **Installationsskript** oder **Docker Compose**, um stattdessen den Agenten zu betreiben — und entfernen Sie den Metrikserver, denn wer beides betreibt, meldet jede Ressource doppelt.",
  "This cluster is **`pve-1`** in OneUptime. If that is not the Proxmox cluster's own name, set `proxmox.cluster.name` to `pve-1` under the metric server's *Resource Attributes*, or the push registers a new cluster.":
    "Dieser Cluster ist in OneUptime **`pve-1`**. Wenn das nicht der eigene Name des Proxmox-Clusters ist, setzen Sie `proxmox.cluster.name` unter *Resource Attributes* des Metrikservers auf `pve-1`, sonst registriert der Push einen neuen Cluster.",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the name the cluster appears under in OneUptime: its Proxmox cluster name, or a standalone node's own name.":
    "Erfordert Proxmox VE 8.3 oder neuer. Der erste Befehl fügt ein Webhook-Ziel namens `oneuptime` hinzu, das jede Benachrichtigung als Protokolleintrag dieses Clusters an OneUptime sendet und den Schlüssel und den Namen des Clusters in seinen Secrets aufbewahrt. Der zweite sendet jede Benachrichtigung dorthin. Ersetzen Sie `my-proxmox-cluster` durch den Namen, unter dem der Cluster in OneUptime erscheint: seinen Proxmox-Clusternamen oder den eigenen Namen eines eigenständigen Knotens.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | Nein | Der Containername des Collectors (Standard: `oneuptime-proxmox-agent`). Der Agent eines zweiten Clusters auf demselben Rechner braucht eigene Namen: Das Installationsskript benennt die Container eines neuen Agenten nach seinem Ordner, sofern Sie sie nicht setzen, und behält sie bei, wenn Sie das Skript erneut ausführen |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). The install script names a second cluster's API failover sidecar after its collector (`oneuptime-pve-api-failover-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | Nein | Der Containername des API-Failover-Sidecars (Standard: `oneuptime-pve-api-failover`). Den API-Failover-Sidecar eines zweiten Clusters benennt das Installationsskript nach seinem Collector (`oneuptime-pve-api-failover-cluster2` neben `oneuptime-proxmox-agent-cluster2`), sofern Sie den Namen nicht setzen, und behält ihn bei, wenn Sie das Skript erneut ausführen |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). The install script names a second cluster's bundled exporter after its collector (`oneuptime-pve-exporter-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | Nein | Der Containername des mitgelieferten Exporters (Standard: `oneuptime-pve-exporter`). Den mitgelieferten Exporter eines zweiten Clusters benennt das Installationsskript nach seinem Collector (`oneuptime-pve-exporter-cluster2` neben `oneuptime-proxmox-agent-cluster2`), sofern Sie den Namen nicht setzen, und behält ihn bei, wenn Sie das Skript erneut ausführen |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-proxmox-ai-agent-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | Nein | Der Containername des KI-Agenten (Standard: `oneuptime-proxmox-ai-agent`). Den KI-Agenten eines zweiten Clusters benennt das Installationsskript nach seinem Collector (`oneuptime-proxmox-ai-agent-cluster2` neben `oneuptime-proxmox-agent-cluster2`), sofern Sie den Namen nicht setzen, und behält ihn bei, wenn Sie das Skript erneut ausführen |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "Ein Agent liest einen Cluster. Für einen zweiten Cluster installieren Sie einen zweiten Agenten in einem eigenen Ordner, mit eigenen Containernamen — zwei Container können sich keinen Namen teilen:",
  "The script names the containers after the folder, such as `oneuptime-proxmox-agent-cluster2`, unless you set their variables, such as `PROXMOX_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "Das Skript benennt die Container nach dem Ordner, etwa `oneuptime-proxmox-agent-cluster2`, sofern Sie ihre Variablen nicht setzen, etwa `PROXMOX_AGENT_CONTAINER_NAME`. Es hinterlegt die Namen in der `.env` dieses Agenten, sodass sie ein erneuter Aufruf des Skripts mit demselben `INSTALL_DIR` für ein Upgrade des Agenten beibehält, und ein Agent, dessen `container_name` Sie einmal in `docker-compose.yml` bearbeitet haben, behält diesen Namen.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "Geben Sie jedem Ordner einen eigenen Namen: Docker Compose benennt ein Projekt allein nach seinem Ordner, daher lehnt das Skript einen Ordner ab, der so heißt wie einer, in dem bereits anderswo ein Agent läuft. Übergeben Sie den Ordner mit `-d` an das Diagnoseskript.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | Nein | Der Containername des Collectors (Standard: `oneuptime-proxmox-agent`). Der Agent eines zweiten Clusters auf demselben Rechner braucht einen eigenen |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | Nein | Der Containername des API-Failover-Sidecars (Standard: `oneuptime-pve-api-failover`). Der Agent eines zweiten Clusters auf demselben Rechner braucht einen eigenen |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | Nein | Der Containername des mitgelieferten Exporters (Standard: `oneuptime-pve-exporter`). Der Agent eines zweiten Clusters auf demselben Rechner braucht einen eigenen |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | Nein | Der Containername des KI-Agenten (Standard: `oneuptime-proxmox-ai-agent`). Der Agent eines zweiten Clusters auf demselben Rechner braucht einen eigenen |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "Ein Agent liest einen Cluster. Für einen zweiten Cluster richten Sie einen zweiten Agenten in einem eigenen Ordner ein, mit eigenen Containernamen — zwei Container können sich keinen Namen teilen. Setzen Sie sie in der `.env` dieses Agenten:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "Geben Sie jedem Ordner einen eigenen Namen: Docker Compose benennt ein Projekt allein nach seinem Ordner, daher würde ein zweiter Ordner mit demselben Namen die Container des ersten Agenten ersetzen. Halten Sie die Namen aus `docker-compose.yml` heraus, das ein Upgrade ersetzt.",
};

export default TRANSLATION;
