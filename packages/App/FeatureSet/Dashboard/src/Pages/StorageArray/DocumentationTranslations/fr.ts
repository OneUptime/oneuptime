import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The StorageArray setup guide in French (#8341): each piece of the English
 * guide's markdown (Pages/StorageArray/Utils/DocumentationMarkdown.ts) and its
 * French. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its French words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashArray's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 ou version ultérieure avec le plugin Docker Compose v2, sur une machine qui peut joindre l'adresse de gestion de la FlashArray en HTTPS (TCP 443)",
  "An administrator account on the FlashArray, to create the agent's read-only user":
    "Un compte administrateur sur la FlashArray, pour créer l'utilisateur en lecture seule de l'agent",
  "Create the token **without an expiry**, or the agent stops the day it expires.":
    "Créez le jeton **sans expiration**, sinon l'agent s'arrête le jour où il expire.",
  "SSH to the FlashArray as an administrator. The first command asks for the new user's password; the second prints its API token:":
    "Connectez-vous en SSH à la FlashArray en tant qu'administrateur. La première commande demande le mot de passe du nouvel utilisateur ; la seconde affiche son jeton d'API :",
  "1. Open **Settings → Users and Policies** (**Settings → Access** on older releases).":
    "1. Ouvrez **Settings → Users and Policies** (**Settings → Access** dans les versions plus anciennes).",
  "2. From the ⋮ menu of the **Users** panel choose **Create User…**, name it `oneuptime` and give it the **readonly** role.":
    "2. Dans le menu ⋮ du panneau **Users**, choisissez **Create User…**, nommez l'utilisateur `oneuptime` et donnez-lui le rôle **readonly**.",
  "3. From the new user's ⋮ menu choose **Create API Token…**, leave **Expires In** empty, and copy the token.":
    "3. Dans le menu ⋮ du nouvel utilisateur, choisissez **Create API Token…**, laissez **Expires In** vide et copiez le jeton.",
  "A `purefa_info{...} 1` line means the array serves its metrics natively: carry on. A **404** means its Purity//FA is older (Pure documents the native endpoint for 6.7.0 and later; its exporter's deprecation notice says 6.6.11 and later) — pick **FlashArray, older Purity** at the top of this guide instead.":
    "Une ligne `purefa_info{...} 1` signifie que la baie sert ses métriques nativement : continuez. Une **404** signifie que son Purity//FA est plus ancien (Pure documente le point de terminaison natif pour 6.7.0 et versions ultérieures ; l'avis d'obsolescence de son exportateur indique 6.6.11 et versions ultérieures) : choisissez plutôt **FlashArray, Purity plus ancien** en haut de ce guide.",
  "The first line downloads the script as `install.sh`, so you can read it before you run it.":
    "La première ligne télécharge le script sous le nom `install.sh`, pour que vous puissiez le lire avant de l'exécuter.",
  "The command carries the platform you picked above. The script asks for:":
    "La commande contient la plateforme choisie plus haut. Le script demande :",
  "- your **OneUptime URL** and **ingestion key**, both shown in step 1 (pick a key there to have them filled in here)":
    "- votre **URL OneUptime** et votre **clé d'ingestion**, toutes deux affichées à l'étape 1 (choisissez-y une clé pour qu'elles soient remplies ici)",
  "- an **array name** — how the array appears in OneUptime. Give every array its own and keep it stable: a new name registers a new storage array":
    "- un **nom de baie** : la façon dont la baie apparaît dans OneUptime. Donnez à chaque baie le sien et gardez-le stable : un nouveau nom enregistre une nouvelle baie de stockage",
  "- the FlashArray's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- l'**adresse de gestion** de la FlashArray (nom d'hôte ou IP, sans `https://`) et le **jeton d'API** de l'utilisateur en lecture seule, qu'il lit sans l'afficher",
  "- whether to verify the array's certificate — answer **N** unless the array carries a certificate from a CA you trust (arrays ship a self-signed one)":
    "- s'il faut vérifier le certificat de la baie : répondez **N**, sauf si la baie porte un certificat d'une autorité de certification à laquelle vous faites confiance (les baies sont livrées avec un certificat auto-signé)",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the API token) and starts the agent with Docker Compose.":
    "Il s'installe dans `/opt/oneuptime-storage-array-agent`, écrit un fichier `.env` que vous seul pouvez lire (il contient le jeton d'API) et démarre l'agent avec Docker Compose.",
  "Download the compose file and the collector configs from this OneUptime into a new folder:":
    "Téléchargez le fichier compose et les configurations du collecteur depuis ce OneUptime dans un nouveau dossier :",
  "Create a `.env` file next to them:":
    "Créez un fichier `.env` à côté d'eux :",
  "- Replace `my-storage-array` with a name for this array, such as `fa-prod-01`. It is how the array appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- Remplacez `my-storage-array` par un nom pour cette baie, par exemple `fa-prod-01`. C'est sous ce nom que la baie apparaît dans OneUptime, gardez-le donc stable : un nouveau nom enregistre une nouvelle baie de stockage.",
  "- Set `PURE_FA_ENDPOINT` to the FlashArray's management address — host name or IP, no `https://` — and `PURE_FA_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- Définissez `PURE_FA_ENDPOINT` sur l'adresse de gestion de la FlashArray (nom d'hôte ou IP, sans `https://`) et `PURE_FA_API_TOKEN` sur le jeton d'API de l'utilisateur en lecture seule. Exécutez `chmod 600 .env` : le fichier contient le jeton.",
  "Start the agent:": "Démarrez l'agent :",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Choisissez une clé d'ingestion à l'étape 1 pour remplir `<YOUR_API_KEY>`.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The array then appears automatically in the **Storage Arrays** section after its first scrape, usually within a minute or two.":
    "Cherchez `Everything is ready. Begin running and processing data.` dans les journaux. La baie apparaît ensuite automatiquement dans la section **Baies de stockage** après sa première collecte, généralement en une ou deux minutes.",
  "The install script writes these to `/opt/oneuptime-storage-array-agent/.env`; a Docker Compose install reads them from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the agent's folder.":
    "Le script d'installation les écrit dans `/opt/oneuptime-storage-array-agent/.env` ; une installation Docker Compose les lit dans le fichier `.env` à côté de `docker-compose.yml`. Après en avoir modifié une, appliquez-la avec `docker compose up -d` dans le dossier de l'agent.",
  "| Variable | Required | Description |":
    "| Variable | Obligatoire | Description |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Oui | L'URL de votre instance OneUptime (par ex. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Oui | La clé d'ingestion de télémétrie, celle choisie à l'étape 1 |",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this array registers under in OneUptime. Stamped on every metric as the `storage.array.name` resource attribute. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | Oui | Le nom sous lequel cette baie s'enregistre dans OneUptime. Apposé sur chaque métrique comme attribut de ressource `storage.array.name`. Gardez-le stable : le changer enregistre une nouvelle baie de stockage |",
  "| `STORAGE_SYSTEM` | No | The platform, stamped as the `storage.system` resource attribute: `purestorage.flasharray` or `purestorage.flashblade` (default: `purestorage.flasharray`) |":
    "| `STORAGE_SYSTEM` | Non | La plateforme, apposée comme attribut de ressource `storage.system` : `purestorage.flasharray` ou `purestorage.flashblade` (par défaut : `purestorage.flasharray`) |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | No | Which shipped config runs: `otel-collector-config.yaml` (FlashArray, native — the default), `otel-collector-config.flasharray-exporter.yaml` (older FlashArray) or `otel-collector-config.flashblade.yaml` (FlashBlade) |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Non | La configuration livrée qui s'exécute : `otel-collector-config.yaml` (FlashArray, native, par défaut), `otel-collector-config.flasharray-exporter.yaml` (FlashArray plus ancienne) ou `otel-collector-config.flashblade.yaml` (FlashBlade) |",
  "| `COMPOSE_PROFILES` | No | Starts the exporter the config needs: empty for the native FlashArray config, `flasharray-exporter` or `flashblade` for the others |":
    "| `COMPOSE_PROFILES` | Non | Démarre l'exportateur dont la configuration a besoin : vide pour la configuration FlashArray native, `flasharray-exporter` ou `flashblade` pour les autres |",
  "| `PURE_FA_ENDPOINT` | FlashArray | The FlashArray's management address — host name or IP, no `https://` |":
    "| `PURE_FA_ENDPOINT` | FlashArray | L'adresse de gestion de la FlashArray : nom d'hôte ou IP, sans `https://` |",
  "| `PURE_FA_API_TOKEN` | FlashArray | API token of the FlashArray user with the readonly role |":
    "| `PURE_FA_API_TOKEN` | FlashArray | Le jeton d'API de l'utilisateur FlashArray qui a le rôle readonly |",
  "| `PURE_FB_ENDPOINT` | FlashBlade | The FlashBlade's management address — host name or IP, no `https://` |":
    "| `PURE_FB_ENDPOINT` | FlashBlade | L'adresse de gestion de la FlashBlade : nom d'hôte ou IP, sans `https://` |",
  "| `PURE_FB_API_TOKEN` | FlashBlade | API token of the FlashBlade user with the readonly role |":
    "| `PURE_FB_API_TOKEN` | FlashBlade | Le jeton d'API de l'utilisateur FlashBlade qui a le rôle readonly |",
  "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No | `true` accepts the array's self-signed certificate on the native endpoint; `false` verifies it (default: `true`). Pure's exporters never verify the array's certificate, so it does not apply to them |":
    "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | Non | `true` accepte le certificat auto-signé de la baie sur le point de terminaison natif ; `false` le vérifie (par défaut : `true`). Les exportateurs de Pure ne vérifient jamais le certificat de la baie, la variable ne les concerne donc pas |",
  "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-storage-array-agent`). A second array's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | Non | Le nom du conteneur de l'agent (par défaut : `oneuptime-storage-array-agent`). L'agent d'une deuxième baie sur la même machine a besoin du sien : le script d'installation nomme un nouvel agent d'après son dossier, sauf si vous le définissez, et le conserve quand vous relancez le script |",
  "- The collector reads the FlashArray's own OpenMetrics endpoint over HTTPS with the token as a Bearer credential — no exporter runs.":
    "- Le collecteur lit le point de terminaison OpenMetrics de la FlashArray elle-même en HTTPS, avec le jeton comme identifiant Bearer : aucun exportateur ne tourne.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/volumes`, `/metrics/hosts` and `/metrics/pods` every 2 minutes; `/metrics/directories` every 30 minutes — directory space is expensive for the array to compute.":
    "- **Une tâche de collecte par point de terminaison**, chacune lue aussi souvent qu'elle le mérite : `/metrics/array` toutes les 60 secondes ; `/metrics/volumes`, `/metrics/hosts` et `/metrics/pods` toutes les 2 minutes ; `/metrics/directories` toutes les 30 minutes, car l'espace des répertoires coûte cher à calculer pour la baie.",
  "- **Every job labels its series `scrape_endpoint: <endpoint>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted object leaves the inventory. Keep the labels as shipped.":
    "- **Chaque tâche étiquette ses séries `scrape_endpoint: <endpoint>`**, pour que OneUptime sache de quels objets un lot est la liste complète : c'est ainsi qu'un objet supprimé quitte l'inventaire. Gardez les labels tels qu'ils sont livrés.",
  "- **Per-volume and per-host latency keeps three dimensions** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); a `metric_relabel_configs` rule drops the QoS, queue, SAN and service-time breakdown, which multiplies the series count of a large array. The array-wide breakdown is kept.":
    "- **La latence par volume et par hôte garde trois dimensions** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`) ; une règle `metric_relabel_configs` écarte la ventilation par QoS, file d'attente, SAN et temps de service, qui multiplie le nombre de séries d'une grande baie. La ventilation à l'échelle de la baie est conservée.",
  "- **No `send_batch_max_size`.** OneUptime rebuilds the inventory from one whole scrape, so the `batch` processor never splits one.":
    "- **Pas de `send_batch_max_size`.** OneUptime reconstruit l'inventaire à partir d'une collecte entière, donc le processeur `batch` n'en découpe jamais une.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "Voici le `otel-collector-config.yaml` complet qu'exécute l'agent ; le fichier `.env` fournit les valeurs `${env:...}` :",
  "The agent ships metrics only until you turn on its syslog receivers. Arrays forward their alerts and audit events as syslog; the agent stamps `storage.array.name` on every line, so they land on this array's **Logs** page.":
    "L'agent n'envoie que des métriques tant que vous n'activez pas ses récepteurs syslog. Les baies transmettent leurs alertes et leurs événements d'audit en syslog ; l'agent appose `storage.array.name` sur chaque ligne, pour qu'ils arrivent sur la page **Journaux** de cette baie.",
  "1. In `otel-collector-config.yaml`, uncomment the `syslog/tcp` and `syslog/udp` receivers and the `logs` pipeline. Classic BSD syslog timestamps carry no time zone: set `location` to the array's time zone unless its clock runs on UTC.":
    "1. Dans `otel-collector-config.yaml`, décommentez les récepteurs `syslog/tcp` et `syslog/udp` et le pipeline `logs`. Les horodatages syslog BSD classiques ne portent pas de fuseau horaire : définissez `location` sur le fuseau horaire de la baie, sauf si son horloge est en UTC.",
  "2. In `docker-compose.yml`, uncomment the `ports:` block that publishes `5514/tcp` and `5514/udp`, and open the port on the machine's firewall for the array's management network.":
    "2. Dans `docker-compose.yml`, décommentez le bloc `ports:` qui publie `5514/tcp` et `5514/udp`, et ouvrez le port dans le pare-feu de la machine pour le réseau de gestion de la baie.",
  "3. Apply both:": "3. Appliquez les deux :",
  "4. On the FlashArray, as an administrator, open **Settings → System → Syslog Servers**, add `udp://<agent-host>:5514` (or `tcp://<agent-host>:5514`) and send a test message.":
    "4. Sur la FlashArray, en tant qu'administrateur, ouvrez **Settings → System → Syslog Servers**, ajoutez `udp://<agent-host>:5514` (ou `tcp://<agent-host>:5514`) et envoyez un message de test.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the array: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor of the collector config you use, next to `storage.array.name`:":
    "Tout attribut de ressource préfixé par `oneuptime.label.` devient un label de projet sur la baie : `oneuptime.label.<dimension>=<value>` est le label `<dimension>:<value>`. Ajoutez-les au processeur `resource` de la configuration du collecteur que vous utilisez, à côté de `storage.array.name` :",
  "Then restart the collector so it reads the new config:":
    "Redémarrez ensuite le collecteur pour qu'il lise la nouvelle configuration :",
  "The array shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "La baie apparaît avec les labels `team:storage` et `env:production`. Les labels sont comparés sans tenir compte de la casse : un label `Production` existant est donc réutilisé ; les labels ajoutés dans l'interface OneUptime ne sont jamais supprimés par l'agent.",
  "Every value is a gauge the FlashArray computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "Chaque valeur est une jauge que la FlashArray calcule elle-même : latence par opération en microsecondes, débit par seconde. Les pages Baies de stockage de OneUptime, son catalogue de métriques et ses modèles d'alerte reposent sur :",
  "| Endpoint | Data |": "| Point de terminaison | Données |",
  "| **Array** (`/metrics/array`) | `purefa_info`, capacity and data reduction (`purefa_array_space_*`), performance, open alerts (`purefa_alerts_open`), hardware components, drives, controllers and network interfaces |":
    "| **Baie** (`/metrics/array`) | `purefa_info`, capacité et réduction des données (`purefa_array_space_*`), performances, alertes ouvertes (`purefa_alerts_open`), composants matériels, disques, contrôleurs et interfaces réseau |",
  "| **Volumes** (`/metrics/volumes`) | Latency, IOPS, bandwidth, space and data reduction per volume |":
    "| **Volumes** (`/metrics/volumes`) | Latence, IOPS, bande passante, espace et réduction des données par volume |",
  "| **Hosts** (`/metrics/hosts`) | Connectivity, connected volumes, latency, IOPS and space per host |":
    "| **Hôtes** (`/metrics/hosts`) | Connectivité, volumes connectés, latence, IOPS et espace par hôte |",
  "| **Pods** (`/metrics/pods`) | ActiveCluster and ActiveDR replica link lag, mediator status, performance and space |":
    "| **Pods** (`/metrics/pods`) | Retard des liens de réplica ActiveCluster et ActiveDR, état du médiateur, performances et espace |",
  "| **Directories** (`/metrics/directories`) | Space and performance of FlashArray file services' managed directories |":
    "| **Répertoires** (`/metrics/directories`) | Espace et performances des répertoires gérés des services de fichiers de la FlashArray |",
  "One agent reads one array. To monitor several from the same machine, install each into its own folder with its own `.env` and its own container name — two containers cannot share one:":
    "Un agent lit une baie. Pour en surveiller plusieurs depuis la même machine, installez chacun dans son propre dossier avec son propre `.env` et son propre nom de conteneur, car deux conteneurs ne peuvent pas porter le même nom :",
  "Without `STORAGE_ARRAY_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `STORAGE_ARRAY_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "Sans `STORAGE_ARRAY_AGENT_CONTAINER_NAME`, le script nomme le conteneur d'après le dossier. Il enregistre le nom dans le `.env` de cet agent, de sorte qu'il est conservé quand vous relancez le script pour mettre à niveau l'agent, et qu'un agent dont vous avez un jour modifié le `container_name` dans `docker-compose.yml` garde ce nom. Avec Docker Compose, définissez plutôt `STORAGE_ARRAY_AGENT_CONTAINER_NAME` dans le `.env` de chaque agent.",
  "The agent ships a systemd unit that assumes the install script's folder, `/opt/oneuptime-storage-array-agent`. The install script does not download it, so fetch it:":
    "L'agent fournit une unité systemd qui suppose le dossier du script d'installation, `/opt/oneuptime-storage-array-agent`. Le script d'installation ne la télécharge pas, récupérez-la donc :",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its configs are files beside it, so pulling alone does not move the agent forward. Re-run the install script. It reuses every value in your existing `.env` (nothing is prompted for again), downloads the latest `docker-compose.yml` and collector configs — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — and recreates the agent with them:":
    "**Mise à niveau** : l'image du collecteur est figée dans `docker-compose.yml` et ses configurations sont des fichiers à côté ; récupérer l'image ne suffit donc pas à faire avancer l'agent. Relancez le script d'installation. Il réutilise chaque valeur de votre `.env` existant (rien n'est redemandé), télécharge les derniers `docker-compose.yml` et configurations du collecteur (un fichier que vous avez modifié est gardé à côté du nouveau sous le nom `<file>.bak.<timestamp>`) et recrée l'agent avec eux :",
  "An agent installed outside `/opt/oneuptime-storage-array-agent` (a second array's, say) needs its folder: `INSTALL_DIR=<folder> bash install.sh`.":
    "Un agent installé ailleurs que dans `/opt/oneuptime-storage-array-agent` (celui d'une deuxième baie, par exemple) a besoin de son dossier : `INSTALL_DIR=<folder> bash install.sh`.",
  "Installed it with Docker Compose instead? In the agent's folder, download the compose file and the collector configs again; your `.env` stays, and a change you made to any of them has to be made again:":
    "Installé plutôt avec Docker Compose ? Dans le dossier de l'agent, téléchargez à nouveau le fichier compose et les configurations du collecteur ; votre `.env` reste, et une modification que vous avez faite à l'un d'eux est à refaire :",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Récupérez ensuite les images et recréez l'agent, pour que le collecteur lise sa nouvelle configuration :",
  "The config reports the collector version it pins as the array's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "La configuration rapporte la version du collecteur qu'elle fige comme **Version de l'agent** de la baie. Quand ce OneUptime en fige une plus récente, un signe d'avertissement à côté ouvre ces commandes.",
  "**Uninstall** the agent:": "**Désinstallez** l'agent :",
  "Then delete the read-only user and its API token on the array if you no longer need them.":
    "Supprimez ensuite l'utilisateur en lecture seule et son jeton d'API sur la baie si vous n'en avez plus besoin.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the array endpoint exactly as the collector reaches it (the native endpoint or Pure's exporter, DNS, TLS, the API token), array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` vérifie toute la chaîne (environnement d'exécution des conteneurs, point de terminaison de la baie exactement tel que le collecteur l'atteint, c'est-à-dire le point de terminaison natif ou l'exportateur de Pure, le DNS, le TLS et le jeton d'API, apposition du nom de la baie, métriques propres du collecteur) et demande directement à OneUptime s'il accepte votre clé d'ingestion. Ce dernier contrôle est le plus important : les points de terminaison OTLP de OneUptime refusent une mauvaise clé avec `401` ou `422`, ce que le collecteur journalise en une seule ligne `Exporting failed` par lot, facile à manquer ; le script interroge donc `GET /otlp/v1/validate` pour un verdict direct 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Il se termine par un verdict qui nomme la cause la plus probable.",
  "1. Check the collector logs: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` means the array refused the API token, `404` means the FlashArray has no native endpoint, `x509` means TLS verification is on against the array's self-signed certificate, `no such host` or `connection refused` means a wrong `PURE_FA_ENDPOINT`, and an export `401` means a bad ingestion key.":
    "1. Consultez les journaux du collecteur : `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` signifie que la baie a refusé le jeton d'API, `404` que la FlashArray n'a pas de point de terminaison natif, `x509` que la vérification TLS est active face au certificat auto-signé de la baie, `no such host` ou `connection refused` un `PURE_FA_ENDPOINT` erroné, et un `401` à l'export une mauvaise clé d'ingestion.",
  "2. Make sure `STORAGE_ARRAY_NAME` is set — discovery keys on the `storage.array.name` resource attribute, and the collector refuses to start without it.":
    "2. Assurez-vous que `STORAGE_ARRAY_NAME` est défini : la découverte s'appuie sur l'attribut de ressource `storage.array.name`, et le collecteur refuse de démarrer sans lui.",
  "3. Make sure `STORAGE_ARRAY_COLLECTOR_CONFIG` and `COMPOSE_PROFILES` name the same platform.":
    "3. Assurez-vous que `STORAGE_ARRAY_COLLECTOR_CONFIG` et `COMPOSE_PROFILES` désignent la même plateforme.",
  "Its Purity//FA has no native OpenMetrics endpoint. Set `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` and `COMPOSE_PROFILES=flasharray-exporter` in `.env` and run `docker compose up -d` — or re-run `install.sh` with the older-Purity choice. After upgrading the array to Purity//FA 6.7 or later, switch back to the native config and drop the profile.":
    "Son Purity//FA n'a pas de point de terminaison OpenMetrics natif. Définissez `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` et `COMPOSE_PROFILES=flasharray-exporter` dans `.env` et exécutez `docker compose up -d`, ou relancez `install.sh` avec le choix Purity plus ancien. Après la mise à niveau de la baie vers Purity//FA 6.7 ou ultérieur, revenez à la configuration native et retirez le profil.",
  "Check that you pasted the token, not the user's password; that the user still exists and holds the readonly role; and that the token has not expired. Create a new token (`pureadmin create --api-token oneuptime` on a FlashArray), put it in `.env` as `PURE_FA_API_TOKEN` and run `docker compose up -d`.":
    "Vérifiez que vous avez collé le jeton et non le mot de passe de l'utilisateur, que l'utilisateur existe toujours et a le rôle readonly, et que le jeton n'a pas expiré. Créez un nouveau jeton (`pureadmin create --api-token oneuptime` sur une FlashArray), placez-le dans `.env` comme `PURE_FA_API_TOKEN` et exécutez `docker compose up -d`.",
  "Arrays present a self-signed certificate by default, which no Docker image trusts. Set `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network), or install a certificate on the array from a CA the collector image trusts.":
    "Les baies présentent par défaut un certificat auto-signé, auquel aucune image Docker ne fait confiance. Définissez `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (le choix pragmatique sur un réseau de gestion privé), ou installez sur la baie un certificat d'une autorité de certification à laquelle l'image du collecteur fait confiance.",
  "`pure-fa-exporter` or `pure-fb-exporter` is not running: `COMPOSE_PROFILES` must match `STORAGE_ARRAY_COLLECTOR_CONFIG` — `flasharray-exporter` for the FlashArray exporter config, `flashblade` for the FlashBlade config. Fix `.env` and run `docker compose up -d`; `docker compose ps` then lists the exporter.":
    "`pure-fa-exporter` ou `pure-fb-exporter` ne tourne pas : `COMPOSE_PROFILES` doit correspondre à `STORAGE_ARRAY_COLLECTOR_CONFIG`, soit `flasharray-exporter` pour la configuration d'exportateur FlashArray et `flashblade` pour la configuration FlashBlade. Corrigez `.env` et exécutez `docker compose up -d` ; `docker compose ps` liste alors l'exportateur.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-storage-array-agent`":
    "1. Vérifiez que l'agent tourne : `docker ps --filter name=oneuptime-storage-array-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`":
    "2. Cherchez des erreurs dans les journaux de l'agent : `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Vérifiez que votre URL OneUptime et votre clé d'ingestion sont correctes.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Assurez-vous que la machine de l'agent peut joindre l'instance OneUptime par le réseau.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "L'identité de la baie vient de `STORAGE_ARRAY_NAME`, apposé sur chaque métrique comme `storage.array.name`. Corrigez-le dans `.env` et appliquez-le avec `docker compose up -d` dans le dossier de l'agent ; notez qu'un nouveau nom enregistre une nouvelle baie de stockage.",
  "It registers the array as **`array-1`** — the name this array already has in OneUptime.":
    "Il enregistre la baie sous **`array-1`**, le nom que cette baie a déjà dans OneUptime.",
  "- This installs the agent for **`array-1`** — keep `STORAGE_ARRAY_NAME` exactly as it is, or the data registers as a new storage array.":
    "- Ceci installe l'agent pour **`array-1`** : gardez `STORAGE_ARRAY_NAME` exactement tel quel, sinon les données s'enregistrent comme une nouvelle baie de stockage.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. This array is **`array-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "L'identité de la baie vient de `STORAGE_ARRAY_NAME`, apposé sur chaque métrique comme `storage.array.name`. Cette baie est **`array-1`**. Corrigez-le dans `.env` et appliquez-le avec `docker compose up -d` dans le dossier de l'agent ; notez qu'un nouveau nom enregistre une nouvelle baie de stockage.",
  "The command already carries your OneUptime URL, ingestion key and the platform you picked above. The script asks for:":
    "La commande contient déjà votre URL OneUptime, votre clé d'ingestion et la plateforme choisie plus haut. Le script demande :",
  "Access from that machine to `quay.io`, where Docker pulls Pure's exporter image":
    "Un accès depuis cette machine à `quay.io`, d'où Docker récupère l'image de l'exportateur de Pure",
  "- `COMPOSE_PROFILES=flasharray-exporter` starts `pure-fa-exporter`, Pure's exporter, next to the collector; the two must match.":
    "- `COMPOSE_PROFILES=flasharray-exporter` démarre `pure-fa-exporter`, l'exportateur de Pure, à côté du collecteur ; les deux doivent correspondre.",
  "`docker compose ps` in the agent's folder also lists **`pure-fa-exporter`**, Pure's exporter, which the collector reads the FlashArray through.":
    "`docker compose ps` dans le dossier de l'agent liste aussi **`pure-fa-exporter`**, l'exportateur de Pure, par lequel le collecteur lit la FlashArray.",
  "- The collector reads the FlashArray through `pure-fa-exporter`, Pure's exporter, which logs in to the FlashArray's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- Le collecteur lit la FlashArray par `pure-fa-exporter`, l'exportateur de Pure, qui se connecte à l'API REST de la FlashArray avec le jeton que le collecteur envoie à chaque collecte. Le port de l'exportateur reste sur le réseau compose.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashBlade's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 ou version ultérieure avec le plugin Docker Compose v2, sur une machine qui peut joindre l'adresse de gestion de la FlashBlade en HTTPS (TCP 443)",
  "An administrator account on the FlashBlade, to create the agent's read-only user":
    "Un compte administrateur sur la FlashBlade, pour créer l'utilisateur en lecture seule de l'agent",
  "On the FlashBlade, as an administrator, create a user named `oneuptime` with the **readonly** role — in the FlashBlade GUI's user settings, or with `pureadmin` in the Purity//FB CLI — and create an **API token** for it. Create the token **without an expiry**, or the agent stops the day it expires.":
    "Sur la FlashBlade, en tant qu'administrateur, créez un utilisateur nommé `oneuptime` avec le rôle **readonly** (dans les paramètres utilisateur de l'interface graphique de la FlashBlade, ou avec `pureadmin` dans la CLI de Purity//FB) et créez un **jeton d'API** pour lui. Créez le jeton **sans expiration**, sinon l'agent s'arrête le jour où il expire.",
  "FlashBlade API tokens start with `T-`. A Purity//FB release without local users takes a directory service (LDAP or Active Directory) account whose group maps to the readonly role instead.":
    "Les jetons d'API de la FlashBlade commencent par `T-`. Une version de Purity//FB sans utilisateurs locaux prend à la place un compte d'annuaire (LDAP ou Active Directory) dont le groupe correspond au rôle readonly.",
  "- the FlashBlade's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- l'**adresse de gestion** de la FlashBlade (nom d'hôte ou IP, sans `https://`) et le **jeton d'API** de l'utilisateur en lecture seule, qu'il lit sans l'afficher",
  "- Set `PURE_FB_ENDPOINT` to the FlashBlade's management address — host name or IP, no `https://` — and `PURE_FB_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- Définissez `PURE_FB_ENDPOINT` sur l'adresse de gestion de la FlashBlade (nom d'hôte ou IP, sans `https://`) et `PURE_FB_API_TOKEN` sur le jeton d'API de l'utilisateur en lecture seule. Exécutez `chmod 600 .env` : le fichier contient le jeton.",
  "`docker compose ps` in the agent's folder also lists **`pure-fb-exporter`**, Pure's exporter, which the collector reads the FlashBlade through.":
    "`docker compose ps` dans le dossier de l'agent liste aussi **`pure-fb-exporter`**, l'exportateur de Pure, par lequel le collecteur lit la FlashBlade.",
  "- The collector reads the FlashBlade through `pure-fb-exporter`, Pure's exporter, which logs in to the FlashBlade's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- Le collecteur lit la FlashBlade par `pure-fb-exporter`, l'exportateur de Pure, qui se connecte à l'API REST de la FlashBlade avec le jeton que le collecteur envoie à chaque collecte. Le port de l'exportateur reste sur le réseau compose.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/filesystems` and `/metrics/objectstore` every 5 minutes — the FlashBlade REST API is not built to report every file system and bucket quickly.":
    "- **Une tâche de collecte par point de terminaison**, chacune lue aussi souvent qu'elle le mérite : `/metrics/array` toutes les 60 secondes ; `/metrics/filesystems` et `/metrics/objectstore` toutes les 5 minutes, car l'API REST de la FlashBlade n'est pas faite pour rendre compte rapidement de chaque système de fichiers et de chaque bucket.",
  "4. On the FlashBlade, as an administrator, add a syslog server `udp://<agent-host>:5514` (or `tcp://`) in its syslog settings.":
    "4. Sur la FlashBlade, en tant qu'administrateur, ajoutez un serveur syslog `udp://<agent-host>:5514` (ou `tcp://`) dans ses paramètres syslog.",
  "Every value is a gauge the FlashBlade computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "Chaque valeur est une jauge que la FlashBlade calcule elle-même : latence par opération en microsecondes, débit par seconde. Les pages Baies de stockage de OneUptime, son catalogue de métriques et ses modèles d'alerte reposent sur :",
  "| **Array** (`/metrics/array`) | `purefb_info`, capacity and data reduction (`purefb_array_space_*`), performance per protocol, open alerts (`purefb_alerts_open`), hardware health (`purefb_hardware_health`) |":
    "| **Baie** (`/metrics/array`) | `purefb_info`, capacité et réduction des données (`purefb_array_space_*`), performances par protocole, alertes ouvertes (`purefb_alerts_open`), état du matériel (`purefb_hardware_health`) |",
  "| **File systems** (`/metrics/filesystems`) | Space, data reduction and performance per file system |":
    "| **Systèmes de fichiers** (`/metrics/filesystems`) | Espace, réduction des données et performances par système de fichiers |",
  "| **Object store** (`/metrics/objectstore`) | Space, quota, object counts and performance per bucket |":
    "| **Magasin d'objets** (`/metrics/objectstore`) | Espace, quota, nombre d'objets et performances par bucket |",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that reaches every node of the cluster on UDP 161 (SNMP)":
    "Docker Engine 20.10 ou version ultérieure avec le plugin Docker Compose v2, sur une machine qui joint chaque nœud du cluster en UDP 161 (SNMP)",
  "An administrator account on the cluster, to turn on SNMP and set the agent's read-only community or SNMPv3 user":
    "Un compte administrateur sur le cluster, pour activer SNMP et définir la communauté en lecture seule ou l'utilisateur SNMPv3 de l'agent",
  "SSH to any node as an administrator: OneFS applies SNMP settings to the whole cluster. If the cluster already answers SNMP for another tool, give the agent the same community or user and skip this step. Otherwise, turn on SNMP v2c with a read-only community of your own, not OneFS's default `I$ilonpublic`:":
    "Connectez-vous en SSH à n'importe quel nœud en tant qu'administrateur : OneFS applique les paramètres SNMP à tout le cluster. Si le cluster répond déjà en SNMP pour un autre outil, donnez à l'agent la même communauté ou le même utilisateur et passez cette étape. Sinon, activez SNMP v2c avec une communauté en lecture seule qui vous est propre, et non la communauté par défaut de OneFS, `I$ilonpublic` :",
  "Or turn on SNMPv3, which authenticates and encrypts every poll. OneFS has one SNMPv3 read-only user, `general` until you rename it: give it passwords of at least eight characters, without spaces:":
    "Ou activez SNMPv3, qui authentifie et chiffre chaque interrogation. OneFS a un seul utilisateur SNMPv3 en lecture seule, `general` tant que vous ne le renommez pas : donnez-lui des mots de passe d'au moins huit caractères, sans espaces :",
  "`isi snmp settings view` shows the settings, with the user's authentication and privacy protocols. Allow UDP 161 from the agent's machine to every node, and list the nodes' addresses with `isi network interfaces list`.":
    "`isi snmp settings view` affiche les paramètres, avec les protocoles d'authentification et de confidentialité de l'utilisateur. Autorisez UDP 161 depuis la machine de l'agent vers chaque nœud, et listez les adresses des nœuds avec `isi network interfaces list`.",
  "- **every node's address**, separated by commas: each node's own address, never the SmartConnect zone name, since a node answers only for its own drives, sensors and ports":
    "- les **adresses de tous les nœuds**, séparées par des virgules : l'adresse propre de chaque nœud, jamais le nom de la zone SmartConnect, car un nœud ne répond que pour ses propres disques, capteurs et ports",
  "- the **SNMP version**, then the read-only **community**, or the SNMPv3 **user** and its two passwords, each read without echo":
    "- la **version SNMP**, puis la **communauté** en lecture seule, ou l'**utilisateur** SNMPv3 et ses deux mots de passe, chacun lu sans être affiché",
  "A user whose protocols are not SHA and AES needs `POWERSCALE_SNMP_AUTH_PROTOCOL` and `POWERSCALE_SNMP_PRIVACY_PROTOCOL` in front of `bash install.sh`, and a user without privacy `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`.":
    "Un utilisateur dont les protocoles ne sont pas SHA et AES a besoin de `POWERSCALE_SNMP_AUTH_PROTOCOL` et `POWERSCALE_SNMP_PRIVACY_PROTOCOL` devant `bash install.sh`, et un utilisateur sans confidentialité, de `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`.",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the community or the SNMPv3 passwords), with one poll per node, and starts the agent with Docker Compose. When the cluster gains a node, add its address to `POWERSCALE_NODES` in that file and run `bash install.sh` again.":
    "Il s'installe dans `/opt/oneuptime-storage-array-agent`, écrit un fichier `.env` que vous seul pouvez lire (il contient la communauté ou les mots de passe SNMPv3), avec une interrogation par nœud, et démarre l'agent avec Docker Compose. Quand le cluster gagne un nœud, ajoutez son adresse à `POWERSCALE_NODES` dans ce fichier et exécutez à nouveau `bash install.sh`.",
  "- Replace `my-storage-array` with a name for this cluster, such as `ps-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- Remplacez `my-storage-array` par un nom pour ce cluster, par exemple `ps-prod`. C'est sous ce nom que le cluster apparaît dans OneUptime, gardez-le donc stable : un nouveau nom enregistre une nouvelle baie de stockage.",
  "- List every node in `POWERSCALE_NODES` and give each its own `POWERSCALE_NODE_<n>` and `snmp/node-<n>` in `POWERSCALE_SNMP_RECEIVERS`, up to 252, after `snmp/cluster` and `snmp/quotas`. An IPv6 address goes in brackets, such as `[fd00::11]`.":
    "- Listez chaque nœud dans `POWERSCALE_NODES` et donnez à chacun son propre `POWERSCALE_NODE_<n>` et son propre `snmp/node-<n>` dans `POWERSCALE_SNMP_RECEIVERS`, jusqu'à 252, après `snmp/cluster` et `snmp/quotas`. Une adresse IPv6 s'écrit entre crochets, par exemple `[fd00::11]`.",
  "- For SNMPv3, set `POWERSCALE_SNMP_VERSION=v3`, `POWERSCALE_SNMP_USER`, `POWERSCALE_SNMP_AUTH_PASSWORD` and `POWERSCALE_SNMP_PRIVACY_PASSWORD` instead of the community. Run `chmod 600 .env`: it holds the community or the passwords.":
    "- Pour SNMPv3, définissez `POWERSCALE_SNMP_VERSION=v3`, `POWERSCALE_SNMP_USER`, `POWERSCALE_SNMP_AUTH_PASSWORD` et `POWERSCALE_SNMP_PRIVACY_PASSWORD` au lieu de la communauté. Exécutez `chmod 600 .env` : le fichier contient la communauté ou les mots de passe.",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this cluster registers under in OneUptime, stamped on every metric as `storage.array.name`. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | Oui | Le nom sous lequel ce cluster s'enregistre dans OneUptime, apposé sur chaque métrique comme `storage.array.name`. Gardez-le stable : le changer enregistre une nouvelle baie de stockage |",
  "| `STORAGE_SYSTEM` | Yes | `dell.powerscale` |":
    "| `STORAGE_SYSTEM` | Oui | `dell.powerscale` |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Yes | `otel-collector-config.powerscale.yaml` |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Oui | `otel-collector-config.powerscale.yaml` |",
  "| `POWERSCALE_NODES` | Yes | Every node's address, separated by commas. The install script writes the polls below from it |":
    "| `POWERSCALE_NODES` | Oui | Les adresses de tous les nœuds, séparées par des virgules. Le script d'installation en tire les interrogations ci-dessous |",
  "| `POWERSCALE_ENDPOINT` | Yes | The node the cluster's own health, capacity and quotas are read through: the first in `POWERSCALE_NODES` |":
    "| `POWERSCALE_ENDPOINT` | Oui | Le nœud par lequel sont lus la santé, la capacité et les quotas du cluster lui-même : le premier de `POWERSCALE_NODES` |",
  "| `POWERSCALE_SNMP_RECEIVERS` | Yes | The polls the collector runs: `snmp/cluster`, `snmp/quotas`, then `snmp/node-<n>` for each node |":
    "| `POWERSCALE_SNMP_RECEIVERS` | Oui | Les interrogations que le collecteur exécute : `snmp/cluster`, `snmp/quotas`, puis `snmp/node-<n>` pour chaque nœud |",
  "| `POWERSCALE_NODE_<n>` | Yes | Node `<n>`'s address, from 1 to 252 |":
    "| `POWERSCALE_NODE_<n>` | Oui | L'adresse du nœud `<n>`, de 1 à 252 |",
  "| `POWERSCALE_SNMP_VERSION` | No | `v2c` (default) or `v3` |":
    "| `POWERSCALE_SNMP_VERSION` | Non | `v2c` (par défaut) ou `v3` |",
  "| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | The cluster's read-only community |":
    "| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | La communauté en lecture seule du cluster |",
  "| `POWERSCALE_SNMP_USER` | SNMPv3 | The cluster's SNMPv3 read-only user |":
    "| `POWERSCALE_SNMP_USER` | SNMPv3 | L'utilisateur SNMPv3 en lecture seule du cluster |",
  "| `POWERSCALE_SNMP_SECURITY_LEVEL` | No | `auth_priv` (default), `auth_no_priv` or `no_auth_no_priv` |":
    "| `POWERSCALE_SNMP_SECURITY_LEVEL` | Non | `auth_priv` (par défaut), `auth_no_priv` ou `no_auth_no_priv` |",
  "| `POWERSCALE_SNMP_AUTH_PROTOCOL` | No | `SHA` (default), `MD5`, `SHA224`, `SHA256`, `SHA384` or `SHA512` |":
    "| `POWERSCALE_SNMP_AUTH_PROTOCOL` | Non | `SHA` (par défaut), `MD5`, `SHA224`, `SHA256`, `SHA384` ou `SHA512` |",
  "| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | The SNMPv3 user's authentication password |":
    "| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | Le mot de passe d'authentification de l'utilisateur SNMPv3 |",
  "| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | No | `AES` (default), `DES`, `AES192`, `AES256`, `AES192C` or `AES256C` |":
    "| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | Non | `AES` (par défaut), `DES`, `AES192`, `AES256`, `AES192C` ou `AES256C` |",
  "| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | The SNMPv3 user's privacy password |":
    "| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | Le mot de passe de confidentialité de l'utilisateur SNMPv3 |",
  "- **One collector, no exporter.** The collector's own SNMP receiver reads Dell's ISILON-MIB; nothing else runs beside it.":
    "- **Un collecteur, aucun exportateur.** Le récepteur SNMP propre au collecteur lit l'ISILON-MIB de Dell ; rien d'autre ne tourne à côté.",
  "- **The cluster's objects once, through `POWERSCALE_ENDPOINT`:** its health, capacity, throughput and node counts every 60 seconds (`snmp/cluster`), and its SmartQuotas every 5 minutes (`snmp/quotas`).":
    "- **Les objets du cluster une seule fois, par `POWERSCALE_ENDPOINT` :** sa santé, sa capacité, son débit et ses nombres de nœuds toutes les 60 secondes (`snmp/cluster`), et ses SmartQuotas toutes les 5 minutes (`snmp/quotas`).",
  "- **Each node's from the node:** its health, CPU, protocol performance, drives, sensors and ports every 60 seconds (`snmp/node-<n>`).":
    "- **Ceux de chaque nœud, par le nœud lui-même :** sa santé, son CPU, les performances de ses protocoles, ses disques, capteurs et ports toutes les 60 secondes (`snmp/node-<n>`).",
  "- **Every poll labels its series `scrape_endpoint: <poll>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted quota leaves the inventory. Keep the labels as shipped.":
    "- **Chaque interrogation étiquette ses séries `scrape_endpoint: <poll>`**, pour que OneUptime sache de quels objets un lot est la liste complète : c'est ainsi qu'un quota supprimé quitte l'inventaire. Gardez les labels tels qu'ils sont livrés.",
  "The full config, one SNMP receiver per node slot, is `otel-collector-config.powerscale.yaml` in the agent's folder:":
    "La configuration complète, un récepteur SNMP par emplacement de nœud, est `otel-collector-config.powerscale.yaml` dans le dossier de l'agent :",
  "Then turn SNMP off on the cluster, or change the agent's community or SNMPv3 passwords, if nothing else polls it.":
    "Désactivez ensuite SNMP sur le cluster, ou changez la communauté ou les mots de passe SNMPv3 de l'agent, si rien d'autre ne l'interroge.",
  "`troubleshoot.sh` checks the whole chain — the container runtime, the node addresses and the community or SNMPv3 user in `.env`, each node with `snmpget` when the machine has it, array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key.":
    "`troubleshoot.sh` vérifie toute la chaîne (environnement d'exécution des conteneurs, adresses des nœuds et communauté ou utilisateur SNMPv3 dans `.env`, chaque nœud avec `snmpget` quand la machine l'a, apposition du nom de la baie, métriques propres du collecteur) et demande directement à OneUptime s'il accepte votre clé d'ingestion.",
  "`Error scraping metrics` with `request timeout` in `docker logs oneuptime-storage-array-agent` names a node that does not answer SNMP from this machine: SNMP is off for the version the agent uses, the community or SNMPv3 user is not the cluster's, or UDP 161 is blocked on the way. A node that answers but is missing from the cluster's nodes is not in `POWERSCALE_NODES`: add it and run `bash install.sh` again.":
    "`Error scraping metrics` avec `request timeout` dans `docker logs oneuptime-storage-array-agent` désigne un nœud qui ne répond pas en SNMP depuis cette machine : SNMP est désactivé pour la version qu'utilise l'agent, la communauté ou l'utilisateur SNMPv3 n'est pas celui du cluster, ou UDP 161 est bloqué en chemin. Un nœud qui répond mais qui manque parmi les nœuds du cluster n'est pas dans `POWERSCALE_NODES` : ajoutez-le et exécutez à nouveau `bash install.sh`.",
};

export default TRANSLATION;
