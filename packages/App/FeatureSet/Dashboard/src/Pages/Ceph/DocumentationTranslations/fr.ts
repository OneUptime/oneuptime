import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Ceph setup guide in French (#8341): each piece of the English
 * guide's markdown (Pages/Ceph/Utils/DocumentationMarkdown.ts) and its
 * French. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its French words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach your Ceph mgr daemons on port 9283":
    "Docker Engine 20.10 ou version ultérieure avec le plugin Docker Compose v2, sur une machine qui peut joindre vos démons mgr Ceph sur le port 9283",
  "A shell on a Ceph admin node, where the `ceph` CLI works with admin rights":
    "Un shell sur un nœud d'administration Ceph, où la CLI `ceph` fonctionne avec les droits d'administration",
  "Then list your mgr daemons — the agent needs **all** of them, active and standbys:":
    "Listez ensuite vos démons mgr : l'agent a besoin de **tous**, l'actif comme les standbys :",
  "Only the **active** mgr returns metrics — standbys answer with an empty response — so scraping every mgr keeps metrics flowing when the active one fails over.":
    "Seul le mgr **actif** renvoie des métriques (les standbys répondent par une réponse vide) ; interroger chaque mgr maintient donc le flux de métriques quand l'actif bascule.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Le script demande votre URL OneUptime et votre clé d'ingestion, toutes deux affichées à l'étape 1 (choisissez-y une clé pour qu'elles soient remplies ici), puis :",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **Nom du cluster** : la façon dont le cluster apparaît dans OneUptime. Donnez à chaque cluster le sien et gardez-le stable : un nouveau nom enregistre un nouveau cluster.",
  "- **Mgr endpoints** — every mgr from the previous step as comma-separated `host:port`, e.g. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. The script adds the square brackets.":
    "- **Points de terminaison mgr** : chaque mgr de l'étape précédente, sous la forme `host:port` séparés par des virgules, par ex. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. Le script ajoute les crochets.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only. Where `ceph` works with admin rights, the script also offers to create the AI agent's own Ceph client.":
    "- **Agent IA de OneUptime** : s'il peut appliquer des correctifs ; répondez **N** pour le garder en lecture seule. Là où `ceph` fonctionne avec les droits d'administration, le script propose aussi de créer le client Ceph propre à l'agent IA.",
  "It installs to `/opt/oneuptime-ceph-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Il s'installe dans `/opt/oneuptime-ceph-agent`, écrit un fichier `.env` en `0600` et démarre l'agent avec Docker Compose. Relancer le script réutilise tout ce qui se trouve dans ce `.env` au lieu de redemander : c'est aussi ainsi que vous mettez à niveau.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The cluster then appears automatically in the **Ceph** section, usually within a minute or so.":
    "Cherchez `Everything is ready. Begin running and processing data.` dans les journaux. Le cluster apparaît ensuite automatiquement dans la section **Ceph**, généralement en une minute environ.",
  "Docker Compose also runs **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. If the install script created its Ceph client it is already working; otherwise it waits for one — see **OneUptime AI agent** under Advanced.":
    "Docker Compose exécute aussi **`oneuptime-ceph-ai-agent`**, l'agent IA OneUptime. Si le script d'installation a créé son client Ceph, il fonctionne déjà ; sinon il en attend un — voir **Agent IA de OneUptime** sous Avancé.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: once it has its Ceph client, it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `ceph` commands, and changes nothing unless you allow fixes.":
    "**Agent IA OneUptime (activé par défaut, en lecture seule).** Les enquêtes IA sont activées : dès qu'il a son client Ceph, il permet à OneUptime AI d'enquêter sur les incidents et les alertes de ce cluster avec des commandes `ceph` en lecture seule, et ne modifie rien tant que vous n'autorisez pas de correctifs.",
  "The install script writes these to `/opt/oneuptime-ceph-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent`.":
    "Le script d'installation les écrit dans `/opt/oneuptime-ceph-agent/.env`. Après en avoir modifié une, appliquez-la avec `docker compose up -d` dans `/opt/oneuptime-ceph-agent`.",
  "| Variable | Required | Description |":
    "| Variable | Obligatoire | Description |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Oui | L'URL de votre instance OneUptime (par ex. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Oui | La clé d'ingestion de télémétrie, celle choisie à l'étape 1 |",
  "| `CEPH_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `ceph.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `ceph`) |":
    "| `CEPH_CLUSTER_NAME` | Oui | L'identifiant du cluster affiché dans OneUptime. Apposé sur chaque métrique comme attribut de ressource `ceph.cluster.name`. Gardez-le stable : le changer enregistre un nouveau cluster (par défaut : `ceph`) |",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]`. The install script adds the brackets for you |":
    "| `CEPH_MGR_ENDPOINTS` | Oui | Liste `host:port` séparée par des virgules de **tous** les démons mgr, entre crochets, par ex. `[ceph-mon-1:9283,ceph-mon-2:9283]`. Le script d'installation ajoute les crochets pour vous |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "Les paramètres propres à l'agent IA OneUptime se trouvent sous **Agent IA de OneUptime**.",
  "- **All mgrs are scraped** (active and standbys), so metrics survive an active-mgr failover.":
    "- **Tous les mgr sont interrogés** (l'actif et les standbys) : les métriques survivent donc à une bascule du mgr actif.",
  "- **Every 30 seconds.** The mgr prometheus module caches a scrape for `mgr/prometheus/scrape_interval` (15 seconds by default) — never scrape more often than that, you would only re-read the cache.":
    "- **Toutes les 30 secondes.** Le module prometheus du mgr met une collecte en cache pendant `mgr/prometheus/scrape_interval` (15 secondes par défaut) : n'interrogez jamais plus souvent, vous ne feriez que relire le cache.",
  "- **`honor_labels: true`** keeps the labels Ceph exports (`ceph_daemon`, `pool_id`) as they are, so series stay continuous across mgr failovers.":
    "- **`honor_labels: true`** garde tels quels les labels qu'exporte Ceph (`ceph_daemon`, `pool_id`), si bien que les séries restent continues à travers les bascules de mgr.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "Voici le `otel-collector-config.yaml` complet qu'exécute l'agent ; le fichier `.env` fournit les valeurs `${env:...}` :",
  "The agent can tail `/var/log/ceph/ceph.log` and ship it to OneUptime, which fills the **Cluster Log** page. It is off by default because the agent must run on a host that has the cluster log — a mon host by default.":
    "L'agent peut suivre `/var/log/ceph/ceph.log` et l'envoyer à OneUptime, ce qui remplit la page **Journal du cluster**. C'est désactivé par défaut, car l'agent doit tourner sur un hôte qui a le journal du cluster, un hôte mon par défaut.",
  "1. In `otel-collector-config.yaml`, uncomment the `filelog` receiver and the `logs` pipeline.":
    "1. Dans `otel-collector-config.yaml`, décommentez le récepteur `filelog` et le pipeline `logs`.",
  "2. In `docker-compose.yml`, uncomment the `/var/log/ceph:/var/log/ceph:ro` volume.":
    "2. Dans `docker-compose.yml`, décommentez le volume `/var/log/ceph:/var/log/ceph:ro`.",
  "3. Apply both:": "3. Appliquez les deux :",
  "Lines ship verbatim; OneUptime parses the ceph.log format (timestamp, daemon, INF/WRN/ERR level, message) when it reads them, and the `resource` processor stamps `ceph.cluster.name` so the log lands on this cluster.":
    "Les lignes sont envoyées telles quelles ; OneUptime analyse le format de ceph.log (horodatage, démon, niveau INF/WRN/ERR, message) à leur lecture, et le processeur `resource` appose `ceph.cluster.name` pour que le journal arrive sur ce cluster.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `ceph.cluster.name`:":
    "Tout attribut de ressource préfixé par `oneuptime.label.` devient un label de projet sur le cluster : `oneuptime.label.<dimension>=<value>` est le label `<dimension>:<value>`. Ajoutez-les au processeur `resource` dans `otel-collector-config.yaml`, à côté de `ceph.cluster.name` :",
  "Then restart the collector so it reads the new config:":
    "Redémarrez ensuite le collecteur pour qu'il lise la nouvelle configuration :",
  "The cluster shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Le cluster apparaît avec les labels `team:storage` et `env:production`. Les labels sont comparés sans tenir compte de la casse : un label `Production` existant est donc réutilisé ; les labels ajoutés dans l'interface OneUptime ne sont jamais supprimés par l'agent.",
  "The agent ships everything the mgr prometheus module exports. OneUptime's Ceph pages, metric catalog and alert templates are built on:":
    "L'agent envoie tout ce qu'exporte le module prometheus du mgr. Les pages Ceph, le catalogue de métriques et les modèles d'alerte de OneUptime reposent sur :",
  "| Category | Data |": "| Catégorie | Données |",
  "| **Cluster Health** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), monitor quorum, total and used raw capacity |":
    "| **Santé du cluster** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), quorum des moniteurs, capacité brute totale et utilisée |",
  "| **OSD** | Up / in state for every OSD (per `ceph_daemon` label, e.g. `osd.3`) |":
    "| **OSD** | État up / in de chaque OSD (par label `ceph_daemon`, par ex. `osd.3`) |",
  "| **Pool** | Stored bytes, max available, object counts, read/write operations and throughput per pool |":
    "| **Pool** | Octets stockés, maximum disponible, nombre d'objets, opérations et débit de lecture/écriture par pool |",
  "| **Placement Groups** | Active, degraded, and undersized PG counts |":
    "| **Placement Groups** | Nombre de PG actifs, dégradés et sous-dimensionnés |",
  "`docker-compose.yml` also runs **`oneuptime-ceph-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs `ceph` commands through it — `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. It registers as the cluster named `CEPH_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` exécute aussi **`oneuptime-ceph-ai-agent`**. Pendant que OneUptime AI enquête sur un incident ou une alerte de ce cluster, il exécute des commandes `ceph` par son intermédiaire : `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. Il s'enregistre comme le cluster nommé `CEPH_CLUSTER_NAME` et apparaît sur la page **IA → Agent IA** du cluster.",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. The install script offers to create them on a fresh install, when `ceph` works with admin rights on the machine you run it on. Otherwise, or to add them later, on a Ceph admin node:":
    "Il se connecte comme son propre client Ceph, `client.oneuptime-ai`, avec le `ceph.conf` minimal du cluster et le keyring de ce client dans un dossier `ceph/` à côté de `docker-compose.yml`. Le script d'installation propose de les créer lors d'une nouvelle installation, quand `ceph` fonctionne avec les droits d'administration sur la machine où vous l'exécutez. Sinon, ou pour les ajouter plus tard, sur un nœud d'administration Ceph :",
  "If the agent runs on another machine, copy the two files into its `ceph/` folder the same way. **Never put the admin keyring there.**":
    "Si l'agent tourne sur une autre machine, copiez les deux fichiers de la même façon dans son dossier `ceph/`. **N'y mettez jamais le keyring d'administration.**",
  "- **The client's caps are the hard limit.** With these read caps nothing it runs can change the cluster. Fixes — marking an OSD back in, clearing `noout` — also need `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` and the fixes caps from the agent's README.":
    "- **Les caps du client sont la limite stricte.** Avec ces caps de lecture, rien de ce qu'il exécute ne peut modifier le cluster. Les correctifs (remettre un OSD à « in », lever `noout`) demandent aussi `ONEUPTIME_AI_ALLOW_WRITES=true` dans `.env` et les caps de correctifs du README de l'agent.",
  "- Check it: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- Vérifiez-le : `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-ceph-ai-agent` service from `docker-compose.yml`.":
    "- Vous n'utilisez pas OneUptime AI ? Supprimez le service `oneuptime-ceph-ai-agent` de `docker-compose.yml`.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#ceph-clusters).":
    "Ce qu'il peut exécuter, et le fonctionnement des correctifs : [Agents IA d'infrastructure](/docs/ai/infrastructure-ai-agents#ceph-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them. The AI agent's `ceph/` folder stays as it is:":
    "**Mise à niveau** : l'image du collecteur est figée dans `docker-compose.yml` et sa configuration est un fichier à côté ; récupérer l'image ne suffit donc pas à faire avancer l'agent. Relancez le script d'installation. Il réutilise chaque valeur de votre `.env` existant (rien n'est redemandé), télécharge les derniers `docker-compose.yml` et `otel-collector-config.yaml` (un fichier que vous avez modifié est gardé à côté du nouveau sous le nom `<file>.bak.<timestamp>`), récupère les images et recrée l'agent avec elles. Le dossier `ceph/` de l'agent IA reste tel quel :",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "La configuration rapporte la version du collecteur qu'elle fige comme **Version de l'agent** du cluster. Quand ce OneUptime en fige une plus récente, un signe d'avertissement à côté ouvre ces commandes.",
  "**Uninstall** the agent:": "**Désinstallez** l'agent :",
  "If you created the AI agent's Ceph client, remove it on an admin node: `ceph auth del client.oneuptime-ai`.":
    "Si vous avez créé le client Ceph de l'agent IA, supprimez-le sur un nœud d'administration : `ceph auth del client.oneuptime-ai`.",
  "`troubleshoot.sh` checks the whole chain — container runtime, every mgr endpoint (including the active-vs-standby trap), cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` vérifie toute la chaîne (environnement d'exécution des conteneurs, chaque point de terminaison mgr y compris le piège actif contre standby, l'apposition du nom du cluster, la forme du jeton, les métriques propres du collecteur) et demande directement à OneUptime s'il accepte votre clé d'ingestion. Ce dernier contrôle est le plus important : les points de terminaison OTLP de OneUptime refusent une mauvaise clé avec `401` ou `422`, ce que le collecteur journalise en une seule ligne `Exporting failed` par lot, facile à manquer ; le script interroge donc `GET /otlp/v1/validate` pour un verdict direct 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Il se termine par un verdict qui nomme la cause la plus probable.",
  "1. Check the collector logs: `docker logs oneuptime-ceph-agent` — look for export errors (`401` means a bad ingestion key, connection refused means a wrong `ONEUPTIME_URL`).":
    "1. Vérifiez les journaux du collecteur : `docker logs oneuptime-ceph-agent` ; cherchez des erreurs d'export (`401` signifie une mauvaise clé d'ingestion, connection refused une mauvaise `ONEUPTIME_URL`).",
  "2. Verify a mgr endpoint serves metrics: `curl http://<active-mgr>:9283/metrics | head` — you should see `ceph_*` metric lines. If not, enable the module: `ceph mgr module enable prometheus`.":
    "2. Vérifiez qu'un point de terminaison mgr sert des métriques : `curl http://<active-mgr>:9283/metrics | head` ; vous devriez voir des lignes de métriques `ceph_*`. Sinon, activez le module : `ceph mgr module enable prometheus`.",
  "3. Make sure `CEPH_MGR_ENDPOINTS` is wrapped in square brackets — without them the collector treats the whole comma-separated string as a single (invalid) target.":
    "3. Assurez-vous que `CEPH_MGR_ENDPOINTS` est entre crochets : sans eux, le collecteur traite toute la chaîne séparée par des virgules comme une seule cible (invalide).",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-ceph-agent`":
    "1. Vérifiez que l'agent tourne : `docker ps --filter name=oneuptime-ceph-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`":
    "2. Cherchez des erreurs dans les journaux de l'agent : `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Vérifiez que votre URL OneUptime et votre clé d'ingestion sont correctes.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Assurez-vous que la machine de l'agent peut joindre l'instance OneUptime par le réseau.",
  "You are probably scraping only the (previously) active mgr. List **every** mgr daemon in `CEPH_MGR_ENDPOINTS` — scrapes of standby mgrs are cheap and return empty responses.":
    "Vous n'interrogez probablement que le mgr (anciennement) actif. Listez **chaque** démon mgr dans `CEPH_MGR_ENDPOINTS` : interroger les mgr standby coûte peu et renvoie des réponses vides.",
  "Expected if `mgr/prometheus/standby_behaviour` is set to `error` on your cluster — standbys then answer with HTTP 500. The active mgr's scrape still succeeds, so the errors are noise; switch the behaviour back to `default` to silence them.":
    "C'est attendu si `mgr/prometheus/standby_behaviour` vaut `error` sur votre cluster : les standbys répondent alors par HTTP 500. La collecte du mgr actif réussit quand même ; les erreurs ne sont donc que du bruit ; remettez le comportement à `default` pour les faire taire.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "L'identité du cluster vient de `CEPH_CLUSTER_NAME`, apposé sur chaque métrique comme `ceph.cluster.name`. Corrigez-le dans `.env` et appliquez-le avec `docker compose up -d` dans `/opt/oneuptime-ceph-agent` ; notez qu'un nouveau nom enregistre un nouveau cluster.",
  "- **Cluster name** — enter **`ceph-1`** exactly; a different name registers a new cluster.":
    "- **Nom du cluster** : saisissez exactement **`ceph-1`** ; un autre nom enregistre un nouveau cluster.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "L'identité du cluster vient de `CEPH_CLUSTER_NAME`, apposé sur chaque métrique comme `ceph.cluster.name`. Ce cluster est **`ceph-1`**. Corrigez-le dans `.env` et appliquez-le avec `docker compose up -d` dans `/opt/oneuptime-ceph-agent` ; notez qu'un nouveau nom enregistre un nouveau cluster.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "La commande contient déjà votre URL OneUptime et votre clé d'ingestion. Le script demande le reste :",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Téléchargez `docker-compose.yml` et `otel-collector-config.yaml` depuis ce OneUptime dans un nouveau dossier :",
  "Create a `.env` file next to them:":
    "Créez un fichier `.env` à côté d'eux :",
  "- Replace `my-ceph-cluster` with a name for this cluster, such as `ceph-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- Remplacez `my-ceph-cluster` par un nom pour ce cluster, par exemple `ceph-prod`. C'est sous ce nom que le cluster apparaît dans OneUptime, gardez-le donc stable : un nouveau nom enregistre un nouveau cluster.",
  "- List **every** mgr daemon in `CEPH_MGR_ENDPOINTS`, comma-separated and wrapped in square brackets — without the brackets the collector reads the whole list as one invalid target.":
    "- Listez **chaque** démon mgr dans `CEPH_MGR_ENDPOINTS`, séparés par des virgules et entre crochets : sans les crochets, le collecteur lit toute la liste comme une seule cible invalide.",
  "Start the agent:": "Démarrez l'agent :",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Choisissez une clé d'ingestion à l'étape 1 pour remplir `<YOUR_API_KEY>`.",
  "Docker Compose also starts **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. It waits for a Ceph client of its own — see **OneUptime AI agent** under Advanced, or delete its service from `docker-compose.yml` if you do not use OneUptime AI.":
    "Docker Compose démarre aussi **`oneuptime-ceph-ai-agent`**, l'agent IA OneUptime. Il attend un client Ceph à lui — voir **Agent IA de OneUptime** sous Avancé, ou supprimez son service de `docker-compose.yml` si vous n'utilisez pas OneUptime AI.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "L'agent les lit dans le fichier `.env` à côté de `docker-compose.yml`. Après en avoir modifié une, appliquez-la avec `docker compose up -d` dans le dossier qui contient `docker-compose.yml`.",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]` |":
    "| `CEPH_MGR_ENDPOINTS` | Oui | Liste `host:port` séparée par des virgules de **tous** les démons mgr, entre crochets, par ex. `[ceph-mon-1:9283,ceph-mon-2:9283]` |",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. On a Ceph admin node, in the agent's folder:":
    "Il se connecte comme son propre client Ceph, `client.oneuptime-ai`, avec le `ceph.conf` minimal du cluster et le keyring de ce client dans un dossier `ceph/` à côté de `docker-compose.yml`. Sur un nœud d'administration Ceph, dans le dossier de l'agent :",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Exécutez-les dans le dossier de l'agent, celui qui contient `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**Mise à niveau** : l'image du collecteur est figée dans `docker-compose.yml` et sa configuration est un fichier à côté ; récupérer l'image ne suffit donc pas à faire avancer l'agent. Téléchargez de nouveau les deux fichiers ; votre `.env` reste, et une modification faite à l'un des fichiers doit être refaite :",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Récupérez ensuite les images et recréez l'agent, pour que le collecteur lise sa nouvelle configuration :",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "L'identité du cluster vient de `CEPH_CLUSTER_NAME`, apposé sur chaque métrique comme `ceph.cluster.name`. Corrigez-le dans `.env` et appliquez-le avec `docker compose up -d` dans le dossier qui contient `docker-compose.yml` ; notez qu'un nouveau nom enregistre un nouveau cluster.",
  "- This installs the agent for **`ceph-1`** — keep `CEPH_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- Ceci installe l'agent pour **`ceph-1`** : gardez `CEPH_CLUSTER_NAME` exactement tel quel, sinon les données s'enregistrent comme un nouveau cluster.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "L'identité du cluster vient de `CEPH_CLUSTER_NAME`, apposé sur chaque métrique comme `ceph.cluster.name`. Ce cluster est **`ceph-1`**. Corrigez-le dans `.env` et appliquez-le avec `docker compose up -d` dans le dossier qui contient `docker-compose.yml` ; notez qu'un nouveau nom enregistre un nouveau cluster.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `CEPH_AGENT_CONTAINER_NAME` | Non | Le nom du conteneur du collecteur (par défaut : `oneuptime-ceph-agent`). L'agent d'un second cluster sur la même machine a besoin de ses propres noms : le script d'installation nomme les conteneurs d'un nouvel agent d'après son dossier, sauf si vous les définissez, et les conserve quand vous relancez le script |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-ceph-ai-agent-cluster2` beside `oneuptime-ceph-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | Non | Le nom du conteneur de l'agent IA (par défaut : `oneuptime-ceph-ai-agent`). Le script d'installation nomme l'agent IA d'un second cluster d'après son collecteur (`oneuptime-ceph-ai-agent-cluster2` à côté de `oneuptime-ceph-agent-cluster2`), sauf si vous le définissez, et le conserve quand vous relancez le script |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "Un agent lit un cluster. Pour un second cluster, installez un second agent dans un dossier à lui, avec des noms de conteneur à lui, car deux conteneurs ne peuvent pas porter le même nom :",
  "The script names the containers after the folder, such as `oneuptime-ceph-agent-cluster2`, unless you set their variables, such as `CEPH_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "Le script nomme les conteneurs d'après le dossier, par exemple `oneuptime-ceph-agent-cluster2`, sauf si vous définissez leurs variables, par exemple `CEPH_AGENT_CONTAINER_NAME`. Il enregistre les noms dans le `.env` de cet agent, de sorte qu'ils sont conservés quand vous relancez le script avec le même `INSTALL_DIR` pour mettre à niveau l'agent, et qu'un agent dont vous avez un jour modifié le `container_name` dans `docker-compose.yml` garde ce nom.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "Donnez à chaque dossier un nom qui lui est propre : Docker Compose nomme un projet d'après son seul dossier, si bien que le script refuse un dossier nommé comme un autre qui exécute déjà un agent ailleurs. Passez le dossier au script de diagnostic avec `-d`.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AGENT_CONTAINER_NAME` | Non | Le nom du conteneur du collecteur (par défaut : `oneuptime-ceph-agent`). L'agent d'un second cluster sur la même machine a besoin du sien |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | Non | Le nom du conteneur de l'agent IA (par défaut : `oneuptime-ceph-ai-agent`). L'agent d'un second cluster sur la même machine a besoin du sien |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "Un agent lit un cluster. Pour un second cluster, mettez en place un second agent dans un dossier à lui, avec des noms de conteneur à lui, car deux conteneurs ne peuvent pas porter le même nom. Définissez-les dans le `.env` de cet agent :",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "Donnez à chaque dossier un nom qui lui est propre : Docker Compose nomme un projet d'après son seul dossier, si bien qu'un second dossier du même nom remplacerait les conteneurs du premier agent. Ne mettez pas les noms dans `docker-compose.yml`, qu'une mise à niveau remplace.",
};

export default TRANSLATION;
