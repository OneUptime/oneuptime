import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Podman setup guide in French (#8341): each piece of the English
 * guide's markdown (Pages/Podman/Utils/DocumentationMarkdown.ts) and its
 * French. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its French words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Podman 4.0+": "Podman 4.0 ou version ultérieure",
  "Podman's Docker-compatible API socket at `/run/podman/podman.sock` — turn it on with `sudo systemctl enable --now podman.socket`":
    "Le socket d'API compatible Docker de Podman, à `/run/podman/podman.sock` : activez-le avec `sudo systemctl enable --now podman.socket`",
  "Containers whose logs you want must use the `k8s-file` log driver — rootful Podman defaults to `journald`, which the agent cannot read":
    "Les conteneurs dont vous voulez les journaux doivent utiliser le pilote de journalisation `k8s-file` : Podman rootful utilise par défaut `journald`, que l'agent ne sait pas lire",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "Démarrez ensuite l'agent IA OneUptime à côté, avec la même URL, la même clé et le même nom d'hôte. **Les enquêtes IA sont activées par défaut** : pendant que OneUptime AI enquête sur un incident ou une alerte de cet hôte, il exécute des commandes `docker` en lecture seule via l'agent IA, sur le socket compatible Docker de Podman, et ne modifie rien tant que vous n'autorisez pas de correctifs — voir **L'agent IA OneUptime** sous Avancé. Omettez cette commande pour exécuter le collecteur sans enquêtes IA.",
  "Replace `my-podman-host` with a name for this host, such as `prod-podman-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "Remplacez `my-podman-host` par un nom pour cet hôte, par exemple `prod-podman-01`. C'est sous ce nom que l'hôte apparaît dans OneUptime, gardez-le donc stable : un nouveau nom enregistre un nouvel hôte.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Choisissez une clé d'ingestion à l'étape 1 pour remplir `<YOUR_API_KEY>`.",
  "Look for this line in the logs:": "Cherchez cette ligne dans les journaux :",
  "Once the agent connects, the host appears automatically in the **Podman** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "Une fois l'agent connecté, l'hôte apparaît automatiquement dans la section **Podman**, généralement en une minute environ. L'agent IA OneUptime apparaît comme Connecté sur la page **IA → Agent IA** de l'hôte, et en bas de sa **Vue d'ensemble**.",
  "**Metrics but no logs?** Rootful Podman writes container logs to `journald` by default, which the agent cannot read. Run your containers with `--log-driver k8s-file` — see **Collect logs from every container (k8s-file log driver)** under Advanced.":
    "**Des métriques, mais pas de journaux ?** Podman rootful écrit par défaut les journaux des conteneurs dans `journald`, que l'agent ne sait pas lire. Lancez vos conteneurs avec `--log-driver k8s-file` — voir **Collecter les journaux de tous les conteneurs (pilote de journalisation k8s-file)** sous Avancé.",
  "| Variable | Required | Description |":
    "| Variable | Obligatoire | Description |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Oui | L'URL de votre instance OneUptime (par ex. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | Oui | La clé d'ingestion de télémétrie de l'étape 1 |",
  "| `PODMAN_HOST_NAME` | No | Friendly name for this host. Defaults to `podman-host` |":
    "| `PODMAN_HOST_NAME` | Non | Un nom lisible pour cet hôte. Par défaut `podman-host` |",
  "| `DOCKER_API_VERSION` | No | Docker API version the agent speaks to the Podman socket. Empty by default: the agent negotiates it with the socket. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | Non | La version de l'API Docker que l'agent parle au socket Podman. Vide par défaut : l'agent la négocie avec le socket. Ne la définissez que pour figer une version (voir Dépannage) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` à `ONEUPTIME_LOG_OPERATOR_5` | Non | Vos propres opérateurs du collecteur, chacun en JSON, pour un format de journal que l'agent ne lit pas |",
  "Pass each one to `podman run` as `-e NAME=value`. To change one later, remove the agent with `podman rm -f oneuptime-podman-agent` and run the command again with the new value.":
    "Passez chacune à `podman run` sous la forme `-e NAME=value`. Pour en modifier une plus tard, supprimez l'agent avec `podman rm -f oneuptime-podman-agent` et relancez la commande avec la nouvelle valeur.",
  "The agent reads the files Podman's **`k8s-file`** log driver writes — `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` — so it only sees logs from containers that use it (or `json-file`, which Podman treats as the same file-based driver). Rootful Podman's default is **`journald`**, which it cannot read, and neither can it read a remote driver such as `syslog`.":
    "L'agent lit les fichiers qu'écrit le pilote de journalisation **`k8s-file`** de Podman (`/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log`) ; il ne voit donc que les journaux des conteneurs qui l'utilisent (ou `json-file`, que Podman traite comme le même pilote à fichiers). Le pilote par défaut de Podman rootful est **`journald`**, qu'il ne sait pas lire, pas plus qu'un pilote distant comme `syslog`.",
  "Check a container's log driver, and Podman's default:":
    "Vérifiez le pilote de journalisation d'un conteneur, et celui de Podman par défaut :",
  "Run a single container with `k8s-file`:":
    "Lancez un seul conteneur avec `k8s-file` :",
  "Switch a Compose service to `k8s-file`, with rotation:":
    "Passez un service Compose à `k8s-file`, avec rotation :",
  "Or change the default for every container created afterwards, in `containers.conf` (`/etc/containers/containers.conf` rootful, `~/.config/containers/containers.conf` rootless):":
    "Ou changez le pilote par défaut pour chaque conteneur créé ensuite, dans `containers.conf` (`/etc/containers/containers.conf` en rootful, `~/.config/containers/containers.conf` en rootless) :",
  "Then **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with. Must keep `journald`? The agent still collects metrics through the socket; only container logs need the file-based driver.":
    "**Recréez** ensuite (pas seulement redémarrer) les conteneurs concernés : un conteneur garde le pilote de journalisation avec lequel il a été créé. Vous devez garder `journald` ? L'agent collecte toujours les métriques via le socket ; seuls les journaux des conteneurs ont besoin du pilote à fichiers.",
  "`oneuptime-podman-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `podman rm -f oneuptime-podman-ai-agent`.":
    "`oneuptime-podman-ai-agent`, le second conteneur que démarre l'étape 2, exécute les commandes `docker` que demande OneUptime AI (via le socket compatible Docker de Podman) pendant qu'il enquête sur un incident ou une alerte de cet hôte. **Les enquêtes IA sont activées par défaut** : dès qu'il est connecté, OneUptime AI enquête avec lui, et la page **IA → Agent IA** de l'hôte ainsi que sa **Vue d'ensemble** affichent son état. Pour désactiver les enquêtes, utilisez **Ce que l'IA peut faire** sur cette page ; pour exécuter le collecteur sans l'agent IA, supprimez-le avec `podman rm -f oneuptime-podman-ai-agent`.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **En lecture seule par défaut.** Il exécute des commandes comme `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` et `docker stats --no-stream`, jamais `exec`, `run`, `rm` ni `prune`. Les valeurs d'environnement dans la sortie de `docker inspect` sont masquées avant que quoi que ce soit ne quitte l'hôte.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Les correctifs sont à activer.** Ajoutez `-e ONEUPTIME_AI_ALLOW_WRITES=true` à la commande pour lui permettre de redémarrer, démarrer, arrêter, mettre en pause, tuer un conteneur nommé ou en changer les limites. `ONEUPTIME_AI_FIXES` à côté indique si chaque correctif demande une approbation (`ask-for-approval`, `automatic` ou `bypass-approval`), et la page **IA → Agent IA** de l'hôte l'affiche. `ONEUPTIME_AI_WRITE_TARGETS` (des globs séparés par des virgules, comme `web-*,api-*`) limite les conteneurs concernés ; `ONEUPTIME_AI_PROTECTED_TARGETS` ajoute des conteneurs qu'il ne doit jamais modifier. Il ne se modifie jamais lui-même, ni le collecteur.",
  "- It needs the same socket as the collector, and runs as root because the socket is root-owned. The socket's `:ro` mount does not make the API read-only — the agent's command policy is the limit.":
    "- Il a besoin du même socket que le collecteur, et s'exécute en root parce que le socket appartient à root. Le montage `:ro` du socket ne rend pas l'API en lecture seule : la limite, c'est la politique de commandes de l'agent.",
  "- Its logs: `podman logs -f oneuptime-podman-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- Ses journaux : `podman logs -f oneuptime-podman-ai-agent`. Ce qu'il peut exécuter, et le fonctionnement des correctifs : [Agents IA d'infrastructure](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| Tag d'image | Description |",
  "| `oneuptime/podman-agent:release` | Latest stable release (community) |":
    "| `oneuptime/podman-agent:release` | Dernière version stable (community) |",
  "| `oneuptime/podman-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/podman-agent:enterprise-release` | Dernière version stable (enterprise) |",
  "| `oneuptime/podman-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/podman-agent:<version>` | Une version figée, par ex. `10.0.31` |",
  "| `ghcr.io/oneuptime/podman-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/podman-agent:release` | La même image, en miroir sur GHCR |",
  "Use one in place of `oneuptime/podman-agent:release` at the end of the `podman run` command.":
    "Utilisez-en une à la place de `oneuptime/podman-agent:release` à la fin de la commande `podman run`.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**Mise à niveau** : récupérez la dernière image et supprimez l'agent en cours d'exécution :",
  "Then run both `podman run` commands from step 2 again.":
    "Relancez ensuite les deux commandes `podman run` de l'étape 2.",
  "**Uninstall:**": "**Désinstallation :**",
  "| Category | Data |": "| Catégorie | Données |",
  "| **CPU Metrics** | Usage total, usage percentage, throttling time (per container) |":
    "| **Métriques CPU** | Utilisation totale, pourcentage d'utilisation, temps de bridage (par conteneur) |",
  "| **Memory Metrics** | Usage, limit, percentage, RSS, cache (per container) |":
    "| **Métriques mémoire** | Utilisation, limite, pourcentage, RSS, cache (par conteneur) |",
  "| **Network Metrics** | Bytes and packets received/transmitted (per container) |":
    "| **Métriques réseau** | Octets et paquets reçus/transmis (par conteneur) |",
  "| **Block I/O Metrics** | Read/write bytes and operations (per container) |":
    "| **Métriques d'E/S bloc** | Octets et opérations de lecture/écriture (par conteneur) |",
  "| **Container Info** | Uptime, restart count, process count |":
    "| **Infos conteneur** | Durée de fonctionnement, nombre de redémarrages, nombre de processus |",
  "| **Container Logs** | stdout/stderr logs from all containers that use the `k8s-file` log driver |":
    "| **Journaux de conteneurs** | Journaux stdout/stderr de tous les conteneurs qui utilisent le pilote de journalisation `k8s-file` |",
  'The metrics come from the collector\'s `docker_stats` receiver, through Podman\'s Docker-compatible socket, so their names are the same as the Docker agent\'s. Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'Les métriques viennent du récepteur `docker_stats` du collecteur, via le socket compatible Docker de Podman ; leurs noms sont donc ceux de l\'agent Docker. Chaque ligne de journal reçoit une gravité d\'après le niveau qu\'elle indique (`[ERROR]`, `level=warn`, `{"level":"info"}`) ; une ligne sans niveau se rabat sur son flux : stderr vaut `ERROR`, stdout vaut `INFO`.',
  "The agent must run as root to read `/run/podman/podman.sock`. Make sure the `--user 0:0` flag is in your `podman run` command, and that the socket is on:":
    "L'agent doit s'exécuter en root pour lire `/run/podman/podman.sock`. Vérifiez que l'option `--user 0:0` figure dans votre commande `podman run`, et que le socket est activé :",
  "That is rootful Podman's socket, the one the agent reads. Running Podman rootless? Its socket is `/run/user/<uid>/podman/podman.sock` (turn it on with `systemctl --user enable --now podman.socket`) and its storage `~/.local/share/containers/storage`: mount those at `/run/podman/podman.sock` and `/var/lib/containers/storage` in the agent's container instead — see the Podman agent documentation.":
    "C'est le socket de Podman rootful, celui que lit l'agent. Vous utilisez Podman en rootless ? Son socket est `/run/user/<uid>/podman/podman.sock` (activez-le avec `systemctl --user enable --now podman.socket`) et son stockage `~/.local/share/containers/storage` : montez-les plutôt sur `/run/podman/podman.sock` et `/var/lib/containers/storage` dans le conteneur de l'agent — voir la documentation de l'agent Podman.",
  "The agent's logs show:": "Les journaux de l'agent affichent :",
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Remove the agent (`podman rm -f oneuptime-podman-agent`), pull the latest image (`podman pull oneuptime/podman-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the socket.":
    "Un serveur qui impose un maximum refuse un client plus récent, le collecteur s'arrête avec lui, et le conteneur redémarre en boucle. L'agent ne fige une version de l'API Docker que si `DOCKER_API_VERSION` en indique une, et une ancienne image de l'agent figeait `1.44`. Supprimez l'agent (`podman rm -f oneuptime-podman-agent`), récupérez la dernière image (`podman pull oneuptime/podman-agent:release`) et relancez la commande de l'étape 2, sans `-e DOCKER_API_VERSION`. L'agent négocie alors la version avec le socket.",
  "To pin a version anyway, use no more than the version the socket reports:":
    "Pour figer une version malgré tout, ne dépassez pas la version que rapporte le socket :",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "Ajoutez-la à la commande, par ex. `-e DOCKER_API_VERSION=1.41`. Les serveurs plus récents servent toujours les anciennes versions de l'API ; une version figée continue donc de fonctionner après une mise à niveau.",
  "1. Check that the agent is running: `podman ps --filter name=oneuptime-podman-agent`":
    "1. Vérifiez que l'agent tourne : `podman ps --filter name=oneuptime-podman-agent`",
  "2. Check the agent's logs for errors: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`":
    "2. Cherchez des erreurs dans les journaux de l'agent : `podman logs oneuptime-podman-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `podman run` command are correct.":
    "3. Vérifiez que l'URL OneUptime et la clé d'ingestion de la commande `podman run` sont correctes.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. Assurez-vous que l'hôte peut joindre votre instance OneUptime par le réseau.",
  "Check that the Podman socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "Vérifiez que le socket Podman est monté dans l'agent. Son image n'a pas de shell : regardez depuis un conteneur jetable qui partage ses montages :",
  "Then look for export errors in the agent's logs — `podman logs oneuptime-podman-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "Cherchez ensuite des erreurs d'export dans les journaux de l'agent (`podman logs oneuptime-podman-agent 2>&1 | grep -i error`) et vérifiez que la clé d'ingestion est valide et n'a pas expiré.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using a file-based log driver (`k8s-file` or `json-file`) — rootful Podman defaults to `journald`, which the agent cannot read.":
    "Les métriques arrivent, mais l'onglet **Journaux** est vide, ou n'affiche que les journaux de l'agent lui-même ? Vos conteneurs n'utilisent très probablement pas de pilote de journalisation à fichiers (`k8s-file` ou `json-file`) : Podman rootful utilise par défaut `journald`, que l'agent ne sait pas lire.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `k8s-file`. Switch them (see **Collect logs from every container (k8s-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "Si l'étape 1 affiche `no files match the configured criteria`, ou si l'étape 3 ne liste aucun fichier pour vos conteneurs, c'est qu'ils n'utilisent pas `k8s-file`. Changez-les (voir **Collecter les journaux de tous les conteneurs (pilote de journalisation k8s-file)** sous Avancé), puis recréez chacun d'eux : un conteneur garde le pilote de journalisation avec lequel il a été créé :",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `PODMAN_HOST_NAME`. Change `PODMAN_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "La page d'un hôte affiche les données dont le nom d'hôte est l'identifiant de cet hôte, que l'agent tire de `PODMAN_HOST_NAME`. Changez `PODMAN_HOST_NAME` après l'enregistrement de l'hôte, et OneUptime enregistre un second hôte sous le nouveau nom : les journaux sont sur celui-là. Vérifiez le nom que l'agent rapporte :",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and recreate the agent — `podman rm -f oneuptime-podman-agent`, then run the command from step 2 with the new name.":
    "Le nom de l'hôte vient de `PODMAN_HOST_NAME`. Un agent démarré sans lui rapporte `podman-host` ; tous les hôtes configurés ainsi ressemblent donc au même hôte. Donnez à `PODMAN_HOST_NAME` un nom propre à chaque hôte et recréez l'agent : `podman rm -f oneuptime-podman-agent`, puis relancez la commande de l'étape 2 avec le nouveau nom.",
  "This installs the agent for **`web-1`** — keep `PODMAN_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "Ceci installe l'agent pour **`web-1`** : gardez `PODMAN_HOST_NAME` exactement tel quel, sinon les données s'enregistrent comme un nouvel hôte.",
  "A compose provider for `podman compose`: `podman-compose` or Docker Compose":
    "Un fournisseur Compose pour `podman compose` : `podman-compose` ou Docker Compose",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-podman-ai-agent` service to run the collector without AI investigations.":
    "Le second service est l'agent IA OneUptime, avec la même URL, la même clé et le même nom d'hôte. **Les enquêtes IA sont activées par défaut** : pendant que OneUptime AI enquête sur un incident ou une alerte de cet hôte, il exécute des commandes `docker` en lecture seule via l'agent IA, sur le socket compatible Docker de Podman, et ne modifie rien tant que vous n'autorisez pas de correctifs — voir **L'agent IA OneUptime** sous Avancé. Supprimez le service `oneuptime-podman-ai-agent` pour exécuter le collecteur sans enquêtes IA.",
  "Set each one in the agent's `environment:` list, then run `podman compose up -d` to recreate it with the new values.":
    "Définissez chacune dans la liste `environment:` de l'agent, puis lancez `podman compose up -d` pour le recréer avec les nouvelles valeurs.",
  "`oneuptime-podman-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `podman compose up -d --remove-orphans`.":
    "`oneuptime-podman-ai-agent`, le second service de docker-compose.yml, exécute les commandes `docker` que demande OneUptime AI (via le socket compatible Docker de Podman) pendant qu'il enquête sur un incident ou une alerte de cet hôte. **Les enquêtes IA sont activées par défaut** : dès qu'il est connecté, OneUptime AI enquête avec lui, et la page **IA → Agent IA** de l'hôte ainsi que sa **Vue d'ensemble** affichent son état. Pour désactiver les enquêtes, utilisez **Ce que l'IA peut faire** sur cette page ; pour exécuter le collecteur sans l'agent IA, supprimez son service et lancez `podman compose up -d --remove-orphans`.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Les correctifs sont à activer.** Ajoutez `- ONEUPTIME_AI_ALLOW_WRITES=true` à sa liste `environment:` pour lui permettre de redémarrer, démarrer, arrêter, mettre en pause, tuer un conteneur nommé ou en changer les limites. `ONEUPTIME_AI_FIXES` à côté indique si chaque correctif demande une approbation (`ask-for-approval`, `automatic` ou `bypass-approval`), et la page **IA → Agent IA** de l'hôte l'affiche. `ONEUPTIME_AI_WRITE_TARGETS` (des globs séparés par des virgules, comme `web-*,api-*`) limite les conteneurs concernés ; `ONEUPTIME_AI_PROTECTED_TARGETS` ajoute des conteneurs qu'il ne doit jamais modifier. Il ne se modifie jamais lui-même, ni le collecteur.",
  "Use one in place of `oneuptime/podman-agent:release` on the agent's `image:` line.":
    "Utilisez-en une à la place de `oneuptime/podman-agent:release` sur la ligne `image:` de l'agent.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**Mise à niveau** : dans le dossier qui contient docker-compose.yml, récupérez les dernières images et recréez les conteneurs :",
  "**Uninstall** — stop and remove everything the file started:":
    "**Désinstallation** : arrêtez et supprimez tout ce que le fichier a démarré :",
  'The agent must run as root to read `/run/podman/podman.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml, and that the socket is on:':
    "L'agent doit s'exécuter en root pour lire `/run/podman/podman.sock`. Vérifiez que le service de l'agent a `user: \"0:0\"` dans docker-compose.yml, et que le socket est activé :",
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `podman compose pull` and `podman compose up -d`. The agent then negotiates the version with the socket.":
    "Un serveur qui impose un maximum refuse un client plus récent, le collecteur s'arrête avec lui, et le conteneur redémarre en boucle. L'agent ne fige une version de l'API Docker que si `DOCKER_API_VERSION` en indique une, et une ancienne image de l'agent figeait `1.44`. Retirez `DOCKER_API_VERSION` de la liste `environment:` de l'agent, puis lancez `podman compose pull` et `podman compose up -d`. L'agent négocie alors la version avec le socket.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `podman compose up -d`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "Ajoutez-la à la liste `environment:` de l'agent, par ex. `- DOCKER_API_VERSION=1.41`, et lancez `podman compose up -d`. Les serveurs plus récents servent toujours les anciennes versions de l'API ; une version figée continue donc de fonctionner après une mise à niveau.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. Vérifiez que l'URL OneUptime et la clé d'ingestion de docker-compose.yml sont correctes.",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and run `podman compose up -d` to recreate the agent with it.":
    "Le nom de l'hôte vient de `PODMAN_HOST_NAME`. Un agent démarré sans lui rapporte `podman-host` ; tous les hôtes configurés ainsi ressemblent donc au même hôte. Donnez à `PODMAN_HOST_NAME` un nom propre à chaque hôte et lancez `podman compose up -d` pour recréer l'agent avec.",
};

export default TRANSLATION;
