import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Proxmox setup guide in French (#8341): each piece of the English
 * guide's markdown (Pages/Proxmox/Utils/DocumentationMarkdown.ts) and its
 * French. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its French words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach every node's Proxmox VE API on port 8006":
    "Docker Engine 20.10 ou version ultérieure avec le plugin Docker Compose v2, sur une machine qui peut joindre l'API Proxmox VE de chaque nœud sur le port 8006",
  "A root shell on any PVE node, or the Proxmox web UI, to create a read-only API token":
    "Un shell root sur n'importe quel nœud PVE, ou l'interface web de Proxmox, pour créer un jeton d'API en lecture seule",
  "Ideally a machine outside the cluster, or a VM that Proxmox HA restarts on another node — the agent reads the cluster from another node when one goes down, but not when its own machine does":
    "Idéalement une machine hors du cluster, ou une VM que Proxmox HA redémarre sur un autre nœud — l'agent lit le cluster depuis un autre nœud quand l'un d'eux tombe, mais pas quand c'est sa propre machine qui tombe",
  "As root on any PVE node:": "En root sur n'importe quel nœud PVE :",
  "- The first line only fails, harmlessly, if `monitoring@pam` already exists. API tokens carry their own secret, so the user needs no password or system account.":
    "- La première ligne n'échoue, sans conséquence, que si `monitoring@pam` existe déjà. Les jetons d'API portent leur propre secret, l'utilisateur n'a donc besoin ni de mot de passe ni de compte système.",
  "- `pveum user token add` prints the token secret — copy it now, it is shown only once. The token id is `monitoring@pam!oneuptime`.":
    "- `pveum user token add` affiche le secret du jeton — copiez-le maintenant, il n'est affiché qu'une fois. L'ID du jeton est `monitoring@pam!oneuptime`.",
  "- The role goes on the user as well as the token because a privilege-separated token only gets the permissions its user also has. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "- Le rôle est attribué à l'utilisateur comme au jeton, car un jeton à privilèges séparés n'obtient que les permissions que son utilisateur a aussi. Il doit être placé sur le chemin racine `/` : pve-exporter lit l'état de tout le cluster, et un jeton limité à un sous-chemin échoue avec `Permission check failed (/, Sys.Audit)`.",
  "1. Go to *Datacenter → Permissions → API Tokens* and click **Add**.":
    "1. Allez dans *Datacenter → Permissions → API Tokens* et cliquez sur **Add**.",
  "2. Pick (or create) a user, give the token an ID like `oneuptime`, make sure **Privilege Separation** is checked, and click **Add**.":
    "2. Choisissez (ou créez) un utilisateur, donnez au jeton un ID comme `oneuptime`, vérifiez que **Privilege Separation** est coché, puis cliquez sur **Add**.",
  "3. Copy the token id (`user@realm!tokenname`) and the secret — the secret is shown only once.":
    "3. Copiez l'ID du jeton (`user@realm!tokenname`) et le secret — le secret n'est affiché qu'une fois.",
  "4. Under *Datacenter → Permissions*, click **Add** twice to give path `/` the **PVEAuditor** role: once as an **API Token Permission** for the token, once as a **User Permission** for its user.":
    "4. Sous *Datacenter → Permissions*, cliquez deux fois sur **Add** pour donner au chemin `/` le rôle **PVEAuditor** : une fois comme **API Token Permission** pour le jeton, une fois comme **User Permission** pour son utilisateur.",
  "A privilege-separated token only gets the permissions its user also has, so both need the role. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "Un jeton à privilèges séparés n'obtient que les permissions que son utilisateur a aussi, les deux ont donc besoin du rôle. Il doit être placé sur le chemin racine `/` : pve-exporter lit l'état de tout le cluster, et un jeton limité à un sous-chemin échoue avec `Permission check failed (/, Sys.Audit)`.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Le script demande votre URL OneUptime et votre clé d'ingestion, toutes deux affichées à l'étape 1 (choisissez-y une clé pour qu'elles soient remplies ici), puis :",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **Nom du cluster** : la façon dont le cluster apparaît dans OneUptime. Donnez à chaque cluster le sien et gardez-le stable : un nouveau nom enregistre un nouveau cluster.",
  "- **Proxmox VE API host** — any node, e.g. `192.168.1.10`. While its API does not answer, the agent reads the cluster from the next node in the list below.":
    "- **Hôte de l'API Proxmox VE** — n'importe quel nœud, par ex. `192.168.1.10`. Tant que son API ne répond pas, l'agent lit le cluster depuis le nœud suivant de la liste ci-dessous.",
  "- **Bundled prometheus-pve-exporter** — answer **Y** unless you already run one.":
    "- **prometheus-pve-exporter intégré** — répondez **Y**, sauf si vous en exécutez déjà un.",
  "- **API token** — the token id and secret from the previous step.":
    "- **Jeton d'API** — l'ID et le secret du jeton de l'étape précédente.",
  "- **Every node's address** — each node's own address, comma-separated, never a virtual IP. With the token, the script offers the cluster's own list: press Enter to take it. The agent also reads the cluster from these when the first node is down.":
    "- **Adresse de chaque nœud** — l'adresse propre de chaque nœud, séparées par des virgules, jamais une IP virtuelle. Avec le jeton, le script propose la liste du cluster lui-même : appuyez sur Entrée pour la prendre. L'agent lit aussi le cluster depuis ces nœuds quand le premier est hors service.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only.":
    "- **Agent IA de OneUptime** — s'il peut appliquer des correctifs ; répondez **N** pour le garder en lecture seule.",
  "It installs to `/opt/oneuptime-proxmox-agent`, writes a `0600` `.env` file and starts everything with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Il s'installe dans `/opt/oneuptime-proxmox-agent`, écrit un fichier `.env` en `0600` et démarre le tout avec Docker Compose. Relancer le script réutilise tout ce que contient ce `.env` au lieu de redemander ; c'est aussi ainsi que vous le mettez à niveau.",
  "`docker compose ps` lists the collector (`oneuptime-proxmox-agent`), the node failover (`oneuptime-pve-api-failover`), the bundled exporter (`oneuptime-pve-exporter`, unless you use your own) and the OneUptime AI agent (`oneuptime-proxmox-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cluster then appears automatically in the **Proxmox** section.":
    "`docker compose ps` liste le collecteur (`oneuptime-proxmox-agent`), la bascule entre nœuds (`oneuptime-pve-api-failover`), l'exportateur intégré (`oneuptime-pve-exporter`, sauf si vous utilisez le vôtre) et l'agent IA de OneUptime (`oneuptime-proxmox-ai-agent`). Dans les journaux du collecteur, cherchez `Everything is ready. Begin running and processing data.` Le cluster apparaît ensuite automatiquement dans la section **Proxmox**.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `pvesh` requests, and changes nothing unless you allow fixes — see **OneUptime AI agent** under Advanced.":
    "**Agent IA de OneUptime (actif par défaut, en lecture seule).** Les investigations IA sont activées : il permet à OneUptime AI d'enquêter sur les incidents et les alertes de ce cluster avec des requêtes `pvesh` en lecture seule, et ne modifie rien tant que vous n'autorisez pas les correctifs — voir **Agent IA de OneUptime** sous Avancé.",
  "Needs Proxmox VE 8.3 or later. Pick an ingestion key in step 1 to show the two commands: they carry the key, which Proxmox VE keeps in the webhook target they add.":
    "Nécessite Proxmox VE 8.3 ou version ultérieure. Choisissez une clé d'ingestion à l'étape 1 pour afficher les deux commandes : elles contiennent la clé, que Proxmox VE conserve dans la cible webhook qu'elles ajoutent.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts.":
    "La page de chaque invité affiche alors sa dernière sauvegarde, et les **Recommandations** du cluster proposent les alertes **Backup Job Failed** et **Node Fenced**.",
  "The install script writes these to `/opt/oneuptime-proxmox-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`.":
    "Le script d'installation les écrit dans `/opt/oneuptime-proxmox-agent/.env`. Après en avoir modifié une, appliquez-la avec `docker compose up -d` dans `/opt/oneuptime-proxmox-agent`.",
  "| Variable | Required | Description |":
    "| Variable | Obligatoire | Description |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Oui | L'URL de votre instance OneUptime (par ex. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Oui | La clé d'ingestion de télémétrie, celle choisie à l'étape 1 |",
  "| `PROXMOX_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `proxmox.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `proxmox-cluster`) |":
    "| `PROXMOX_CLUSTER_NAME` | Oui | L'identifiant du cluster affiché dans OneUptime. Apposé sur chaque métrique comme attribut de ressource `proxmox.cluster.name`. Gardez-le stable : le changer enregistre un nouveau cluster (par défaut : `proxmox-cluster`) |",
  "| `PVE_HOST` | Yes | The node whose Proxmox VE API the exporter reads the cluster from and the AI agent queries, e.g. `192.168.1.10`. While its API does not answer, both use the next node in `PVE_NODES` that does |":
    "| `PVE_HOST` | Oui | Le nœud dont l'exportateur lit l'API Proxmox VE pour lire le cluster et que l'agent IA interroge, par ex. `192.168.1.10`. Tant que son API ne répond pas, tous deux utilisent le nœud suivant de `PVE_NODES` qui répond |",
  "| `PVE_NODES` | On a cluster | Every node's own API address, comma-separated in square brackets, e.g. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Defaults to `PVE_HOST` alone, which is enough for a single node. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen. The agent also reads the cluster from the next of them when `PVE_HOST` goes down. |":
    "| `PVE_NODES` | Sur un cluster | L'adresse d'API propre de chaque nœud, séparées par des virgules entre crochets, par ex. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Par défaut, `PVE_HOST` seul, ce qui suffit pour un nœud unique. L'exportateur ne lit le démarrage au boot (Guest Down), la réplication et l'abonnement que pour le nœud qu'il interroge, chaque nœud est donc interrogé à tour de rôle ; un nœud omis reste invisible. L'agent lit aussi le cluster depuis le suivant d'entre eux quand `PVE_HOST` tombe. |",
  "| `PVE_EXPORTER_URL` | No | Address (`host:port`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (`pve-exporter:9221`) |":
    "| `PVE_EXPORTER_URL` | Non | Adresse (`host:port`, sans schéma) de prometheus-pve-exporter. Par défaut, l'exportateur intégré (`pve-exporter:9221`) |",
  "| `PVE_API_TOKEN_ID` | Bundled exporter and AI agent | Full Proxmox API token id, e.g. `monitoring@pam!oneuptime` (PVEAuditor, read-only) |":
    "| `PVE_API_TOKEN_ID` | Exportateur intégré et agent IA | ID complet du jeton d'API Proxmox, par ex. `monitoring@pam!oneuptime` (PVEAuditor, lecture seule) |",
  "| `PVE_API_TOKEN_SECRET` | Bundled exporter and AI agent | Proxmox API token secret |":
    "| `PVE_API_TOKEN_SECRET` | Exportateur intégré et agent IA | Secret du jeton d'API Proxmox |",
  "| `PVE_VERIFY_SSL` | No | Verify the Proxmox API TLS certificate (default: `false` — PVE ships self-signed certificates) |":
    "| `PVE_VERIFY_SSL` | Non | Vérifier le certificat TLS de l'API Proxmox (par défaut : `false` — PVE est livré avec des certificats autosignés) |",
  "| `COMPOSE_PROFILES` | No | Set to `pve-exporter` to start the bundled exporter container |":
    "| `COMPOSE_PROFILES` | Non | Définir à `pve-exporter` pour démarrer le conteneur de l'exportateur intégré |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "Les paramètres propres à l'agent IA OneUptime se trouvent sous **Agent IA de OneUptime**.",
  "When the install script asks **Run the bundled prometheus-pve-exporter?**, answer **n** and give your exporter's address (`host:port`, no scheme).":
    "Quand le script d'installation demande **Run the bundled prometheus-pve-exporter?**, répondez **n** et donnez l'adresse de votre exportateur (`host:port`, sans schéma).",
  "Use an address the agent's container can reach — the host's LAN IP or DNS name: `localhost` inside the container is the container itself. Keep `PVE_API_TOKEN_ID` and `PVE_API_TOKEN_SECRET` in `.env` if you use the OneUptime AI agent, which reads the API with that token.":
    "Utilisez une adresse que le conteneur de l'agent peut joindre — l'IP LAN ou le nom DNS de l'hôte : dans le conteneur, `localhost` désigne le conteneur lui-même. Gardez `PVE_API_TOKEN_ID` et `PVE_API_TOKEN_SECRET` dans `.env` si vous utilisez l'agent IA de OneUptime, qui lit l'API avec ce jeton.",
  "The agent scrapes the exporter every 30 seconds: its cluster collectors once, at `PVE_HOST` (or the node it reads the cluster from while `PVE_HOST` is down), and its node collectors once for each node in `PVE_NODES`. Every series carries an `id` label identifying the resource — `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>`, or `storage/<node>/<storage>`:":
    "L'agent interroge l'exportateur toutes les 30 secondes : ses collecteurs de cluster une fois, sur `PVE_HOST` (ou sur le nœud depuis lequel il lit le cluster tant que `PVE_HOST` est hors service), et ses collecteurs de nœud une fois pour chaque nœud de `PVE_NODES`. Chaque série porte une étiquette `id` qui identifie la ressource — `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>` ou `storage/<node>/<storage>` :",
  "| Category | Metrics |": "| Catégorie | Métriques |",
  "| **Availability** | `pve_up`, `pve_uptime_seconds` |":
    "| **Disponibilité** | `pve_up`, `pve_uptime_seconds` |",
  "| **Node** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |":
    "| **Nœud** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |",
  "| **Guest (VM / LXC)** | `pve_guest_info`, plus CPU / memory / network series on `qemu/*` and `lxc/*` ids |":
    "| **Invité (VM / LXC)** | `pve_guest_info`, ainsi que des séries CPU, mémoire et réseau sur les ID `qemu/*` et `lxc/*` |",
  "| **Storage** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |":
    "| **Stockage** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |",
  "| **HA** | `pve_ha_state` |":
    "| **HA** (haute disponibilité) | `pve_ha_state` |",
  "| **Backup coverage** | `pve_not_backed_up_total`, `pve_not_backed_up_info` — guests no backup job selects (whether backups ran or succeeded is not exposed) |":
    "| **Couverture des sauvegardes** | `pve_not_backed_up_total`, `pve_not_backed_up_info` — les invités qu'aucune tâche de sauvegarde ne sélectionne (on ne sait pas si les sauvegardes ont tourné ni si elles ont réussi) |",
  "| **Start-on-boot** | `pve_onboot_status` per guest, which **Guest Down** reads |":
    "| **Démarrage au boot** | `pve_onboot_status` par invité, que lit **Guest Down** |",
  "| **Replication** | `pve_replication_*` series per storage replication job — their `id` label is the job id (e.g. `100-0`), not a resource |":
    "| **Réplication** | Séries `pve_replication_*` par tâche de réplication du stockage — leur étiquette `id` est l'ID de la tâche (par ex. `100-0`), pas une ressource |",
  "Start-on-boot and replication come from the exporter's node collectors, which read only the node the exporter asks: a node missing from `PVE_NODES` has neither.":
    "Le démarrage au boot et la réplication viennent des collecteurs de nœud de l'exportateur, qui ne lisent que le nœud que l'exportateur interroge : un nœud absent de `PVE_NODES` n'a ni l'un ni l'autre.",
  "The collector also splits the `id` label into three equality-filterable datapoint attributes (the `transform/pve-identity` processor) — monitor criteria and dashboard filters match on these:":
    "Le collecteur découpe aussi l'étiquette `id` en trois attributs de point de données filtrables par égalité (le processeur `transform/pve-identity`) — les critères des moniteurs et les filtres des tableaux de bord s'appuient sur eux :",
  "| Attribute | Values | Example for `qemu/100` |":
    "| Attribut | Valeurs | Exemple pour `qemu/100` |",
  "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` and `lxc` both map to `guest`) | `guest` |":
    "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` et `lxc` deviennent tous deux `guest`) | `guest` |",
  "| `pve.id` | Everything after the first `/` of `id` (`pve1`, `100`, `pve1/local`) | `100` |":
    "| `pve.id` | Tout ce qui suit le premier `/` de `id` (`pve1`, `100`, `pve1/local`) | `100` |",
  "The original `id` label is kept untouched.":
    "L'étiquette `id` d'origine est conservée telle quelle.",
  "The agent reads the whole cluster through one node's API: `PVE_HOST`'s while it answers. Every 15 seconds the `oneuptime-pve-api-failover` container checks that node, and when its API stops answering the collector reads the cluster from the next node in `PVE_NODES` that answers, until `PVE_HOST` answers again. With the API token in `.env` it also passes over a node that answers but is cut off from the quorate part of the cluster, whose view would report every other node down. The OneUptime AI agent does the same for each of its calls. So when a node fails, **Node Offline** fires for it and the rest of the cluster keeps reporting.":
    "L'agent lit tout le cluster via l'API d'un seul nœud : celle de `PVE_HOST` tant qu'il répond. Toutes les 15 secondes, le conteneur `oneuptime-pve-api-failover` vérifie ce nœud, et quand son API ne répond plus, le collecteur lit le cluster depuis le nœud suivant de `PVE_NODES` qui répond, jusqu'à ce que `PVE_HOST` réponde de nouveau. Avec le jeton d'API dans `.env`, il passe aussi un nœud qui répond mais qui est coupé de la partie du cluster qui a le quorum, et dont la vue montrerait tous les autres nœuds hors service. L'agent IA de OneUptime fait de même pour chacun de ses appels. Ainsi, quand un nœud tombe, **Node Offline** se déclenche pour lui et le reste du cluster continue de remonter des données.",
  "Its logs say which node the cluster is read from, and why.":
    "Ses journaux indiquent depuis quel nœud le cluster est lu, et pourquoi.",
  "What it cannot cover is the machine the agent runs on: if that goes down, the whole cluster goes quiet and **Cluster Stopped Reporting** fires. Run the agent off the cluster, or in a VM that Proxmox HA restarts on another node (`ha-manager add vm:<vmid>`, on shared storage), and run one agent per cluster: each agent reads the whole cluster, so a second one reports every resource twice. See [When a node goes down](/docs/telemetry/proxmox#when-a-node-goes-down).":
    "Ce qu'il ne peut pas couvrir, c'est la machine sur laquelle tourne l'agent : si elle tombe, tout le cluster se tait et **Cluster Stopped Reporting** se déclenche. Exécutez l'agent hors du cluster, ou dans une VM que Proxmox HA redémarre sur un autre nœud (`ha-manager add vm:<vmid>`, sur un stockage partagé), et exécutez un seul agent par cluster : chaque agent lit tout le cluster, un second remonterait donc chaque ressource deux fois. Voir [Quand un nœud tombe](/docs/telemetry/proxmox#when-a-node-goes-down).",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values. The `transform/pve-identity` processor derives the `pve.scope` / `pve.type` / `pve.id` attributes that the built-in Proxmox alert templates and dashboard filters rely on — keep it in place if you customize the config:":
    "Voici le fichier `otel-collector-config.yaml` complet qu'exécute l'agent ; le fichier `.env` fournit les valeurs `${env:...}`. Le processeur `transform/pve-identity` dérive les attributs `pve.scope` / `pve.type` / `pve.id` sur lesquels s'appuient les modèles d'alerte Proxmox intégrés et les filtres des tableaux de bord — gardez-le si vous personnalisez la configuration :",
  "By default the agent ships metrics only, so the cluster's **Logs** tab stays empty. The PVE services log to the systemd journal, and the shipped config has a commented-out `journald` receiver for `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` and `qmeventd`.":
    "Par défaut, l'agent n'envoie que des métriques, l'onglet **Journaux** du cluster reste donc vide. Les services PVE journalisent dans le journal systemd, et la configuration fournie contient un récepteur `journald` commenté pour `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` et `qmeventd`.",
  "1. **Run the agent on a PVE node.** The journal is per host, so a remote agent cannot read it, and each node ships only its own. To keep the metrics agent off the cluster, run a second, log-only collector on each node instead.":
    "1. **Exécutez l'agent sur un nœud PVE.** Le journal est propre à chaque hôte : un agent distant ne peut pas le lire, et chaque nœud n'envoie que le sien. Pour garder l'agent de métriques hors du cluster, exécutez plutôt un second collecteur, dédié aux journaux, sur chaque nœud.",
  "2. Uncomment the `journald` receiver and the `logs` pipeline in `otel-collector-config.yaml`, and the two journal volumes in `docker-compose.yml`.":
    "2. Décommentez le récepteur `journald` et le pipeline `logs` dans `otel-collector-config.yaml`, ainsi que les deux volumes du journal dans `docker-compose.yml`.",
  "3. **Swap the collector image.** The stock image has no `journalctl` and runs as a user that cannot read the journal. Build this wrapper and point `image:` in `docker-compose.yml` at it:":
    "3. **Remplacez l'image du collecteur.** L'image standard n'a pas `journalctl` et s'exécute avec un utilisateur qui ne peut pas lire le journal. Construisez cette image enveloppe et faites pointer `image:` dans `docker-compose.yml` vers elle :",
  "4. Apply it:": "4. Appliquez-le :",
  "Rather keep the stock image? The documentation has a `filelog` fallback that tails `/var/log/syslog`: [Ship Proxmox service logs](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).":
    "Vous préférez garder l'image standard ? La documentation propose une solution de repli avec `filelog` qui suit `/var/log/syslog` : [Envoyer les journaux des services Proxmox](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `proxmox.cluster.name`:":
    "Tout attribut de ressource préfixé par `oneuptime.label.` devient un label de projet sur le cluster : `oneuptime.label.<dimension>=<value>` est le label `<dimension>:<value>`. Ajoutez-les au processeur `resource` dans `otel-collector-config.yaml`, à côté de `proxmox.cluster.name` :",
  "Then restart the collector so it reads the new config:":
    "Redémarrez ensuite le collecteur pour qu'il lise la nouvelle configuration :",
  "The cluster shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Le cluster apparaît avec les labels `team:platform` et `env:production`. Les labels sont comparés sans tenir compte de la casse : un label `Production` existant est donc réutilisé ; les labels ajoutés dans l'interface OneUptime ne sont jamais supprimés par l'agent.",
  "`docker-compose.yml` also runs **`oneuptime-proxmox-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs read-only `pvesh` commands through it — `pvesh get /cluster/status`, a guest's current status, a node's failed tasks. There is no `pvesh` binary in it: each command becomes one call to the Proxmox VE API at `PVE_HOST`. It registers as the cluster named `PROXMOX_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` exécute aussi **`oneuptime-proxmox-ai-agent`**. Pendant que OneUptime AI enquête sur un incident ou une alerte de ce cluster, il exécute par son biais des commandes `pvesh` en lecture seule — `pvesh get /cluster/status`, l'état actuel d'un invité, les tâches en échec d'un nœud. Il ne contient aucun binaire `pvesh` : chaque commande devient un appel à l'API Proxmox VE sur `PVE_HOST`. Il s'enregistre comme le cluster nommé `PROXMOX_CLUSTER_NAME` et apparaît sur la page **IA → Agent IA** du cluster.",
  "- **The API token is the hard limit.** It reads with the collector's PVEAuditor token (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), which can read and nothing else. If you run your own exporter and have no token in `.env`, add one.":
    "- **Le jeton d'API est la limite stricte.** Il lit avec le jeton PVEAuditor du collecteur (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), qui peut lire et rien d'autre. Si vous exécutez votre propre exportateur et n'avez pas de jeton dans `.env`, ajoutez-en un.",
  "- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`. Fixes — starting or rebooting a guest — also need a token of its own that may power guests, set as `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; the agent's README has the `pveum` commands. If the agent runs in a guest of this cluster, put that guest's VMID in `ONEUPTIME_AI_PROTECTED_TARGETS`.":
    "- Il est en **lecture seule** tant que vous ne définissez pas `ONEUPTIME_AI_ALLOW_WRITES=true`. Les correctifs — démarrer ou redémarrer un invité — demandent aussi un jeton à lui, autorisé à allumer et éteindre les invités, défini avec `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET` ; le README de l'agent donne les commandes `pveum`. Si l'agent tourne dans un invité de ce cluster, mettez le VMID de cet invité dans `ONEUPTIME_AI_PROTECTED_TARGETS`.",
  "- Check it: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- Vérifiez-le : `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-proxmox-ai-agent` service from `docker-compose.yml`.":
    "- Vous n'utilisez pas OneUptime AI ? Supprimez le service `oneuptime-proxmox-ai-agent` de `docker-compose.yml`.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#proxmox-clusters).":
    "Ce qu'il peut exécuter, et le fonctionnement des correctifs : [Agents IA d'infrastructure](/docs/ai/infrastructure-ai-agents#proxmox-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them:":
    "**Mise à niveau** — l'image du collecteur est figée dans `docker-compose.yml` et sa configuration est un fichier à côté, si bien qu'un simple pull ne fait pas avancer l'agent. Relancez le script d'installation. Il réutilise chaque valeur de votre `.env` existant (rien n'est redemandé), télécharge les derniers `docker-compose.yml` et `otel-collector-config.yaml` — un fichier que vous avez modifié est conservé à côté du nouveau sous le nom `<file>.bak.<timestamp>` —, récupère les images et recrée l'agent avec elles :",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "La configuration rapporte la version du collecteur qu'elle fige comme **Version de l'agent** du cluster. Quand ce OneUptime en fige une plus récente, un signe d'avertissement à côté ouvre ces commandes.",
  "**Uninstall** the agent:": "**Désinstallez** l'agent :",
  "Then delete the API token under *Datacenter → Permissions → API Tokens* if you no longer need it.":
    "Supprimez ensuite le jeton d'API sous *Datacenter → Permissions → API Tokens* si vous n'en avez plus besoin.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the exporter scrape, cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` vérifie toute la chaîne (environnement d'exécution des conteneurs, interrogation de l'exportateur, apposition du nom du cluster, forme du jeton, métriques propres du collecteur) et demande directement à OneUptime s'il accepte votre clé d'ingestion. Ce dernier contrôle est le plus important : les points de terminaison OTLP de OneUptime refusent une mauvaise clé avec `401` ou `422`, ce que le collecteur journalise en une seule ligne `Exporting failed` par lot, facile à manquer ; le script interroge donc `GET /otlp/v1/validate` pour un verdict direct 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Il se termine par un verdict qui nomme la cause la plus probable.",
  "1. Check that the agent is running (in `/opt/oneuptime-proxmox-agent`): `docker compose ps`":
    "1. Vérifiez que l'agent tourne (dans `/opt/oneuptime-proxmox-agent`) : `docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-proxmox-agent | grep -i error`":
    "2. Cherchez des erreurs dans les journaux de l'agent : `docker compose logs oneuptime-proxmox-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Vérifiez que votre URL OneUptime et votre clé d'ingestion sont correctes.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Assurez-vous que la machine de l'agent peut joindre l'instance OneUptime par le réseau.",
  "1. Check the exporter answers. The bundled exporter does not publish its port on the host, so run curl inside its network namespace — you should see `pve_*` metric lines (for your own exporter, curl its `host:9221` directly):":
    "1. Vérifiez que l'exportateur répond. L'exportateur intégré ne publie pas son port sur l'hôte, exécutez donc curl dans son espace de noms réseau — vous devriez voir des lignes de métriques `pve_*` (pour votre propre exportateur, interrogez directement son `host:9221` avec curl) :",
  "2. Verify the API token has the **PVEAuditor** role on path `/`, on the token and on its user.":
    "2. Vérifiez que le jeton d'API a le rôle **PVEAuditor** sur le chemin `/`, sur le jeton et sur son utilisateur.",
  "3. Check the collector logs for scrape or export errors (in `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`":
    "3. Consultez les journaux du collecteur pour y trouver des erreurs d'interrogation ou d'export (dans `/opt/oneuptime-proxmox-agent`) : `docker compose logs oneuptime-proxmox-agent`",
  "The API token is wrong or lacks permissions. Re-check the token id format (`user@realm!tokenname`), the secret, and that the **PVEAuditor** role is granted on path `/` to the token and to its user. The exporter's own logs show the API's answer: `docker logs oneuptime-pve-exporter`":
    "Le jeton d'API est erroné ou n'a pas les permissions requises. Revérifiez le format de l'ID du jeton (`user@realm!tokenname`), le secret, et que le rôle **PVEAuditor** est accordé sur le chemin `/` au jeton et à son utilisateur. Les journaux de l'exportateur lui-même montrent la réponse de l'API : `docker logs oneuptime-pve-exporter`",
  'Guest series (`qemu/*`, `lxc/*` ids) come from the exporter\'s cluster collector. The shipped config enables it (the `cluster=1` scrape parameter) — if you customized the config, restore the `cluster: ["1"]` param.':
    "Les séries des invités (ID `qemu/*`, `lxc/*`) viennent du collecteur de cluster de l'exportateur. La configuration fournie l'active (le paramètre d'interrogation `cluster=1`) — si vous avez personnalisé la configuration, rétablissez le paramètre `cluster: [\"1\"]`.",
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "Leurs indicateurs de démarrage au boot et leurs tâches de réplication viennent du nœud sur lequel ils tournent, et l'agent ne lit que les nœuds de `PVE_NODES`. Indiquez-y l'adresse propre de chaque nœud, comme `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, et appliquez-la avec `docker compose up -d` dans `/opt/oneuptime-proxmox-agent`. Si le collecteur ne démarre plus après une modification, la liste a perdu ses crochets. `troubleshoot.sh` vérifie chaque nœud de la liste.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "L'identité du cluster vient de `PROXMOX_CLUSTER_NAME`, apposé sur chaque métrique comme `proxmox.cluster.name`. Corrigez-le dans `.env` et appliquez-le avec `docker compose up -d` dans `/opt/oneuptime-proxmox-agent` ; notez qu'un nouveau nom enregistre un nouveau cluster.",
  "- **Cluster name** — enter **`pve-1`** exactly; a different name registers a new cluster.":
    "- **Nom du cluster** : saisissez exactement **`pve-1`** ; un autre nom enregistre un nouveau cluster.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "L'identité du cluster vient de `PROXMOX_CLUSTER_NAME`, apposé sur chaque métrique comme `proxmox.cluster.name`. Ce cluster est **`pve-1`**. Corrigez-le dans `.env` et appliquez-le avec `docker compose up -d` dans `/opt/oneuptime-proxmox-agent` ; notez qu'un nouveau nom enregistre un nouveau cluster.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "La commande contient déjà votre URL OneUptime et votre clé d'ingestion. Le script demande le reste :",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the cluster name you gave the agent, so the notifications reach the same cluster.":
    "Nécessite Proxmox VE 8.3 ou version ultérieure. La première commande ajoute une cible webhook nommée `oneuptime`, qui envoie chaque notification à OneUptime comme un journal de ce cluster et garde la clé et le nom du cluster dans ses secrets. La seconde lui envoie toutes les notifications. Remplacez `my-proxmox-cluster` par le nom de cluster que vous avez donné à l'agent, pour que les notifications atteignent le même cluster.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts. To stop sending them:":
    "La page de chaque invité affiche alors sa dernière sauvegarde, et les **Recommandations** du cluster proposent les alertes **Backup Job Failed** et **Node Fenced**. Pour arrêter de les envoyer :",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. The command already names **`pve-1`**, so the notifications reach this cluster.":
    "Nécessite Proxmox VE 8.3 ou version ultérieure. La première commande ajoute une cible webhook nommée `oneuptime`, qui envoie chaque notification à OneUptime comme un journal de ce cluster et garde la clé et le nom du cluster dans ses secrets. La seconde lui envoie toutes les notifications. La commande nomme déjà **`pve-1`**, les notifications atteignent donc ce cluster.",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Téléchargez `docker-compose.yml` et `otel-collector-config.yaml` depuis ce OneUptime dans un nouveau dossier :",
  "Create a `.env` file next to them — it holds the token secret, so keep it private with `chmod 600 .env`:":
    "Créez un fichier `.env` à côté d'eux — il contient le secret du jeton, gardez-le donc privé avec `chmod 600 .env` :",
  "- Replace `my-proxmox-cluster` with a name for this cluster, such as `pve-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- Remplacez `my-proxmox-cluster` par un nom pour ce cluster, par exemple `pve-prod`. C'est sous ce nom que le cluster apparaît dans OneUptime, gardez-le donc stable : un nouveau nom enregistre un nouveau cluster.",
  "- Set `PVE_HOST` to any node of the cluster: while its API does not answer, the agent reads the cluster from the next node in `PVE_NODES`, so it needs no virtual IP.":
    "- Définissez `PVE_HOST` sur n'importe quel nœud du cluster : tant que son API ne répond pas, l'agent lit le cluster depuis le nœud suivant de `PVE_NODES`, il n'a donc besoin d'aucune IP virtuelle.",
  "- Set `PVE_NODES` to every node's own address, in square brackets, never a virtual IP. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen.":
    "- Définissez `PVE_NODES` sur l'adresse propre de chaque nœud, entre crochets, jamais une IP virtuelle. L'exportateur ne lit le démarrage au boot (Guest Down), la réplication et l'abonnement que pour le nœud qu'il interroge, chaque nœud est donc interrogé à tour de rôle ; un nœud omis reste invisible.",
  "- Fill in the token from the previous step. `COMPOSE_PROFILES=pve-exporter` also starts the bundled prometheus-pve-exporter, which reads the API with it.":
    "- Renseignez le jeton de l'étape précédente. `COMPOSE_PROFILES=pve-exporter` démarre aussi le prometheus-pve-exporter intégré, qui lit l'API avec lui.",
  "Start the agent:": "Démarrez l'agent :",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Choisissez une clé d'ingestion à l'étape 1 pour remplir `<YOUR_API_KEY>`.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "L'agent les lit dans le fichier `.env` à côté de `docker-compose.yml`. Après en avoir modifié une, appliquez-la avec `docker compose up -d` dans le dossier qui contient `docker-compose.yml`.",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter instead (`host:port`, no scheme):":
    "Laissez `COMPOSE_PROFILES` hors de `.env` et pointez plutôt l'agent vers votre exportateur (`host:port`, sans schéma) :",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Exécutez-les dans le dossier de l'agent, celui qui contient `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**Mise à niveau** : l'image du collecteur est figée dans `docker-compose.yml` et sa configuration est un fichier à côté ; récupérer l'image ne suffit donc pas à faire avancer l'agent. Téléchargez de nouveau les deux fichiers ; votre `.env` reste, et une modification faite à l'un des fichiers doit être refaite :",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Récupérez ensuite les images et recréez l'agent, pour que le collecteur lise sa nouvelle configuration :",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. Vérifiez que l'agent tourne (dans le dossier de l'agent) : `docker compose ps`",
  "3. Check the collector logs for scrape or export errors (in the agent's folder): `docker compose logs oneuptime-proxmox-agent`":
    "3. Consultez les journaux du collecteur pour y trouver des erreurs d'interrogation ou d'export (dans le dossier de l'agent) : `docker compose logs oneuptime-proxmox-agent`",
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "Leurs indicateurs de démarrage au boot et leurs tâches de réplication viennent du nœud sur lequel ils tournent, et l'agent ne lit que les nœuds de `PVE_NODES`. Indiquez-y l'adresse propre de chaque nœud, comme `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, et appliquez-la avec `docker compose up -d` dans le dossier qui contient `docker-compose.yml`. Si le collecteur ne démarre plus après une modification, la liste a perdu ses crochets. `troubleshoot.sh` vérifie chaque nœud de la liste.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "L'identité du cluster vient de `PROXMOX_CLUSTER_NAME`, apposé sur chaque métrique comme `proxmox.cluster.name`. Corrigez-le dans `.env` et appliquez-le avec `docker compose up -d` dans le dossier qui contient `docker-compose.yml` ; notez qu'un nouveau nom enregistre un nouveau cluster.",
  "- This installs the agent for **`pve-1`** — keep `PROXMOX_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- Ceci installe l'agent pour **`pve-1`** : gardez `PROXMOX_CLUSTER_NAME` exactement tel quel, sinon les données s'enregistrent comme un nouveau cluster.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "L'identité du cluster vient de `PROXMOX_CLUSTER_NAME`, apposé sur chaque métrique comme `proxmox.cluster.name`. Ce cluster est **`pve-1`**. Corrigez-le dans `.env` et appliquez-le avec `docker compose up -d` dans le dossier qui contient `docker-compose.yml` ; notez qu'un nouveau nom enregistre un nouveau cluster.",
  "**No agent, but less data.** Proxmox VE 9.0 and later push each node's metrics to OneUptime themselves. HA state, start-on-boot (used by **Guest Down**), backup coverage and replication are not pushed — use the install script or Docker Compose if you need them. Use one or the other for a cluster: running both reports every resource twice.":
    "**Pas d'agent, mais moins de données.** Proxmox VE 9.0 et versions ultérieures envoient eux-mêmes les métriques de chaque nœud à OneUptime. L'état HA, le démarrage au boot (utilisé par **Guest Down**), la couverture des sauvegardes et la réplication ne sont pas envoyés — utilisez le script d'installation ou Docker Compose si vous en avez besoin. Utilisez l'un ou l'autre pour un cluster : avec les deux, chaque ressource est remontée deux fois.",
  "Proxmox VE **9.0 or later**": "Proxmox VE **9.0 ou version ultérieure**",
  "The Proxmox web UI, to add a metric server under *Datacenter → Metric Server*":
    "L'interface web de Proxmox, pour ajouter un serveur de métriques sous *Datacenter → Metric Server*",
  "Every node can reach `<YOUR_ONEUPTIME_HOST>` on port `443`":
    "Chaque nœud peut joindre `<YOUR_ONEUPTIME_HOST>` sur le port `443`",
  "| Field | Value |": "| Champ | Valeur |",
  "| **Server** | `<YOUR_ONEUPTIME_HOST>` |":
    "| **Server** (serveur) | `<YOUR_ONEUPTIME_HOST>` |",
  "| **Port** | `443` |": "| **Port** (numéro de port) | `443` |",
  "| **Protocol** | `https` |": "| **Protocol** (protocole) | `https` |",
  "| **Path** | `/otlp/v1/metrics` |":
    "| **Path** (chemin) | `/otlp/v1/metrics` |",
  "| **Headers** | The JSON below |":
    "| **Headers** (en-têtes) | Le JSON ci-dessous |",
  "Add it once for the datacenter — every node of the cluster then pushes its own metrics.":
    "Ajoutez-le une seule fois pour le datacenter — chaque nœud du cluster envoie alors ses propres métriques.",
  "OneUptime translates the push into the same `pve_*` series the agent sends. The cluster registers itself under your Proxmox cluster name — a standalone node under its node name — and appears in the **Proxmox** section, where the Nodes, Guests and Storage pages, the overview charts, the metric catalog and the CPU / memory / storage alert templates work as they do with the agent.":
    "OneUptime traduit le push en séries `pve_*` identiques à celles qu'envoie l'agent. Le cluster s'enregistre sous le nom de votre cluster Proxmox — un nœud autonome sous son nom de nœud — et apparaît dans la section **Proxmox**, où les pages Nœuds, Invités et Stockage, les graphiques de la vue d'ensemble, le catalogue de métriques et les modèles d'alerte CPU, mémoire et stockage fonctionnent comme avec l'agent.",
  "Each node pushes only its own status, so a node that goes down cannot report itself down — the nodes still alive report it for it:":
    "Chaque nœud n'envoie que son propre état, si bien qu'un nœud qui tombe ne peut pas signaler lui-même sa panne — les nœuds encore en vie la signalent pour lui :",
  "- It shows **Offline** on the Proxmox pages about 2 minutes after its last report, and **Node Offline** fires after about 5 minutes.":
    "- Il apparaît **Hors ligne** sur les pages Proxmox environ 2 minutes après son dernier rapport, et **Node Offline** se déclenche après environ 5 minutes.",
  "- **Cluster Quorum at Risk** counts it as offline too; it fires about 7–9 minutes after the node went quiet, once its whole 5-minute window has reports.":
    "- **Cluster Quorum at Risk** le compte aussi comme hors ligne ; l'alerte se déclenche environ 7 à 9 minutes après que le nœud s'est tu, une fois que toute sa fenêtre de 5 minutes contient des rapports.",
  "- Its next report brings it back.": "- Son rapport suivant le fait revenir.",
  'Offline means "stopped reporting": a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. A standalone host or a whole cluster going silent has nobody left to report it, so the cluster turns **Disconnected** instead. A node silent for more than 7 days is no longer reported. The reports are marked `oneuptime.proxmox.inferred=not-reporting` in Metrics Explorer.':
    "Hors ligne signifie « ne remonte plus de données » : un `pvestatd` bloqué, un `pmxcfs` arrêté ou une coupure réseau vers OneUptime se présentent de la même façon. Quand un hôte autonome ou un cluster entier se tait, plus personne ne peut le signaler, le cluster passe donc plutôt à **Déconnecté**. Un nœud silencieux depuis plus de 7 jours n'est plus signalé. Ces rapports sont marqués `oneuptime.proxmox.inferred=not-reporting` dans l'explorateur de métriques.",
  "The cluster registers under its Proxmox cluster name; a standalone node registers under its node name. A `proxmox.cluster.name` resource attribute set under the metric server's *Resource Attributes* keeps being used instead.":
    "Le cluster s'enregistre sous le nom de son cluster Proxmox ; un nœud autonome s'enregistre sous son nom de nœud. Un attribut de ressource `proxmox.cluster.name` défini sous *Resource Attributes* du serveur de métriques reste utilisé à la place.",
  "OneUptime translates the push into the `pve_*` series the agent sends, so the Proxmox pages and the CPU / memory / storage alert templates work unchanged. The original `proxmox_*` series stay available in Metrics Explorer for anything else Proxmox VE reports.":
    "OneUptime traduit le push en séries `pve_*` qu'envoie l'agent, si bien que les pages Proxmox et les modèles d'alerte CPU, mémoire et stockage fonctionnent sans changement. Les séries `proxmox_*` d'origine restent disponibles dans l'explorateur de métriques pour tout ce que Proxmox VE rapporte d'autre.",
  "Some alert templates need data only the agent collects:":
    "Certains modèles d'alerte ont besoin de données que seul l'agent collecte :",
  "| Needs the agent | Why |": "| Nécessite l'agent | Pourquoi |",
  "| HA state | Not pushed — the **HA Resource in Error State** template needs the agent |":
    "| État HA | Non envoyé — le modèle **HA Resource in Error State** nécessite l'agent |",
  "| Start-on-boot flag | Not pushed — **Guest Down**, which only pages for guests set to start on boot, needs the agent |":
    "| Indicateur de démarrage au boot | Non envoyé — **Guest Down**, qui n'alerte que pour les invités configurés pour démarrer au boot, nécessite l'agent |",
  "| Backup coverage and replication | Not pushed — **Guest Not Backed Up** and **Replication Failing** need the agent |":
    "| Couverture des sauvegardes et réplication | Non envoyées — **Guest Not Backed Up** et **Replication Failing** nécessitent l'agent |",
  "Every node has stopped reporting, or never started.":
    "Plus aucun nœud ne remonte de données, ou aucun n'a jamais commencé.",
  "1. Under *Datacenter → Metric Server*, check the OpenTelemetry entry: server `<YOUR_ONEUPTIME_HOST>`, port `443`, protocol `https`, path `/otlp/v1/metrics`, and the `x-oneuptime-token` header with a key from step 1.":
    "1. Sous *Datacenter → Metric Server*, vérifiez l'entrée OpenTelemetry : serveur `<YOUR_ONEUPTIME_HOST>`, port `443`, protocole `https`, chemin `/otlp/v1/metrics`, et l'en-tête `x-oneuptime-token` avec une clé de l'étape 1.",
  "2. Check that the nodes can reach `<YOUR_ONEUPTIME_HOST>` over the network.":
    "2. Vérifiez que les nœuds peuvent joindre `<YOUR_ONEUPTIME_HOST>` par le réseau.",
  "It stopped reporting: a node that is down, a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. Its next report brings it back. If you took the node out of the cluster, use **Remove Node** on its page — otherwise it stays Offline for up to 7 days.":
    "Il ne remonte plus de données : un nœud hors service, un `pvestatd` bloqué, un `pmxcfs` arrêté ou une coupure réseau vers OneUptime se présentent de la même façon. Son rapport suivant le fait revenir. Si vous avez retiré le nœud du cluster, utilisez **Retirer le nœud** sur sa page — sinon il reste Hors ligne jusqu'à 7 jours.",
  "The native push does not send HA state, start-on-boot, backup coverage or replication. Pick **Install script** or **Docker Compose** at the top of this guide to run the agent instead — and remove the metric server, since running both reports every resource twice.":
    "Le push natif n'envoie ni l'état HA, ni le démarrage au boot, ni la couverture des sauvegardes, ni la réplication. Choisissez **Script d'installation** ou **Docker Compose** en haut de ce guide pour exécuter plutôt l'agent — et supprimez le serveur de métriques, car avec les deux, chaque ressource est remontée deux fois.",
  "This cluster is **`pve-1`** in OneUptime. If that is not the Proxmox cluster's own name, set `proxmox.cluster.name` to `pve-1` under the metric server's *Resource Attributes*, or the push registers a new cluster.":
    "Ce cluster est **`pve-1`** dans OneUptime. Si ce n'est pas le nom propre du cluster Proxmox, définissez `proxmox.cluster.name` à `pve-1` sous *Resource Attributes* du serveur de métriques, sinon le push enregistre un nouveau cluster.",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the name the cluster appears under in OneUptime: its Proxmox cluster name, or a standalone node's own name.":
    "Nécessite Proxmox VE 8.3 ou version ultérieure. La première commande ajoute une cible webhook nommée `oneuptime`, qui envoie chaque notification à OneUptime comme un journal de ce cluster et garde la clé et le nom du cluster dans ses secrets. La seconde lui envoie toutes les notifications. Remplacez `my-proxmox-cluster` par le nom sous lequel le cluster apparaît dans OneUptime : le nom de son cluster Proxmox, ou le nom propre d'un nœud autonome.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | Non | Le nom du conteneur du collecteur (par défaut : `oneuptime-proxmox-agent`). L'agent d'un second cluster sur la même machine a besoin de ses propres noms : le script d'installation nomme les conteneurs d'un nouvel agent d'après son dossier, sauf si vous les définissez, et les conserve quand vous relancez le script |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). The install script names a second cluster's API failover sidecar after its collector (`oneuptime-pve-api-failover-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | Non | Le nom du conteneur du sidecar de basculement d'API (par défaut : `oneuptime-pve-api-failover`). Le script d'installation nomme le sidecar de basculement d'API d'un second cluster d'après son collecteur (`oneuptime-pve-api-failover-cluster2` à côté de `oneuptime-proxmox-agent-cluster2`), sauf si vous le définissez, et le conserve quand vous relancez le script |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). The install script names a second cluster's bundled exporter after its collector (`oneuptime-pve-exporter-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | Non | Le nom du conteneur de l'exportateur intégré (par défaut : `oneuptime-pve-exporter`). Le script d'installation nomme l'exportateur intégré d'un second cluster d'après son collecteur (`oneuptime-pve-exporter-cluster2` à côté de `oneuptime-proxmox-agent-cluster2`), sauf si vous le définissez, et le conserve quand vous relancez le script |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-proxmox-ai-agent-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | Non | Le nom du conteneur de l'agent IA (par défaut : `oneuptime-proxmox-ai-agent`). Le script d'installation nomme l'agent IA d'un second cluster d'après son collecteur (`oneuptime-proxmox-ai-agent-cluster2` à côté de `oneuptime-proxmox-agent-cluster2`), sauf si vous le définissez, et le conserve quand vous relancez le script |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "Un agent lit un cluster. Pour un second cluster, installez un second agent dans un dossier à lui, avec des noms de conteneur à lui, car deux conteneurs ne peuvent pas porter le même nom :",
  "The script names the containers after the folder, such as `oneuptime-proxmox-agent-cluster2`, unless you set their variables, such as `PROXMOX_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "Le script nomme les conteneurs d'après le dossier, par exemple `oneuptime-proxmox-agent-cluster2`, sauf si vous définissez leurs variables, par exemple `PROXMOX_AGENT_CONTAINER_NAME`. Il enregistre les noms dans le `.env` de cet agent, de sorte qu'ils sont conservés quand vous relancez le script avec le même `INSTALL_DIR` pour mettre à niveau l'agent, et qu'un agent dont vous avez un jour modifié le `container_name` dans `docker-compose.yml` garde ce nom.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "Donnez à chaque dossier un nom qui lui est propre : Docker Compose nomme un projet d'après son seul dossier, si bien que le script refuse un dossier nommé comme un autre qui exécute déjà un agent ailleurs. Passez le dossier au script de diagnostic avec `-d`.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | Non | Le nom du conteneur du collecteur (par défaut : `oneuptime-proxmox-agent`). L'agent d'un second cluster sur la même machine a besoin du sien |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | Non | Le nom du conteneur du sidecar de basculement d'API (par défaut : `oneuptime-pve-api-failover`). L'agent d'un second cluster sur la même machine a besoin du sien |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | Non | Le nom du conteneur de l'exportateur intégré (par défaut : `oneuptime-pve-exporter`). L'agent d'un second cluster sur la même machine a besoin du sien |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | Non | Le nom du conteneur de l'agent IA (par défaut : `oneuptime-proxmox-ai-agent`). L'agent d'un second cluster sur la même machine a besoin du sien |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "Un agent lit un cluster. Pour un second cluster, mettez en place un second agent dans un dossier à lui, avec des noms de conteneur à lui, car deux conteneurs ne peuvent pas porter le même nom. Définissez-les dans le `.env` de cet agent :",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "Donnez à chaque dossier un nom qui lui est propre : Docker Compose nomme un projet d'après son seul dossier, si bien qu'un second dossier du même nom remplacerait les conteneurs du premier agent. Ne mettez pas les noms dans `docker-compose.yml`, qu'une mise à niveau remplace.",
};

export default TRANSLATION;
