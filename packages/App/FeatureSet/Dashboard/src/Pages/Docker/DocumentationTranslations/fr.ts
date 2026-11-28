import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Docker setup guide in French (#8341): each piece of the English
 * guide's markdown (Pages/Docker/Utils/DocumentationMarkdown.ts) and its
 * French. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its French words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+": "Docker Engine 20.10 ou version ultérieure",
  "Access to `/var/run/docker.sock` on the host":
    "Un accès à `/var/run/docker.sock` sur l'hôte",
  "Containers whose logs you want must use the `json-file` log driver — Docker's default":
    "Les conteneurs dont vous voulez les journaux doivent utiliser le pilote de journalisation `json-file`, celui de Docker par défaut",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "Démarrez ensuite l'agent IA OneUptime à côté, avec la même URL, la même clé et le même nom d'hôte. **Les enquêtes IA sont activées par défaut** : pendant que OneUptime AI enquête sur un incident ou une alerte de cet hôte, il exécute des commandes `docker` en lecture seule via l'agent IA, et ne modifie rien tant que vous n'autorisez pas de correctifs — voir **L'agent IA OneUptime** sous Avancé. Omettez cette commande pour exécuter le collecteur sans enquêtes IA.",
  "Replace `my-docker-host` with a name for this host, such as `prod-docker-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "Remplacez `my-docker-host` par un nom pour cet hôte, par exemple `prod-docker-01`. C'est sous ce nom que l'hôte apparaît dans OneUptime, gardez-le donc stable : un nouveau nom enregistre un nouvel hôte.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Choisissez une clé d'ingestion à l'étape 1 pour remplir `<YOUR_API_KEY>`.",
  "Look for this line in the logs:": "Cherchez cette ligne dans les journaux :",
  "Once the agent connects, the host appears automatically in the **Docker** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "Une fois l'agent connecté, l'hôte apparaît automatiquement dans la section **Docker**, généralement en une minute environ. L'agent IA OneUptime apparaît comme Connecté sur la page **IA → Agent IA** de l'hôte, et en bas de sa **Vue d'ensemble**.",
  "| Variable | Required | Description |":
    "| Variable | Obligatoire | Description |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Oui | L'URL de votre instance OneUptime (par ex. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | Oui | La clé d'ingestion de télémétrie de l'étape 1 |",
  "| `DOCKER_HOST_NAME` | No | Friendly name for this host. Defaults to `docker-host` |":
    "| `DOCKER_HOST_NAME` | Non | Un nom lisible pour cet hôte. Par défaut `docker-host` |",
  "| `DOCKER_API_VERSION` | No | Docker Engine API version the agent speaks. Empty by default: the agent negotiates it with the daemon, so any Docker Engine from 20.10 on works. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | Non | La version de l'API Docker Engine que parle l'agent. Vide par défaut : l'agent la négocie avec le démon, si bien que tout Docker Engine à partir de 20.10 fonctionne. Ne la définissez que pour figer une version (voir Dépannage) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` à `ONEUPTIME_LOG_OPERATOR_5` | Non | Vos propres opérateurs du collecteur, chacun en JSON, pour un format de journal que l'agent ne lit pas |",
  "Pass each one to `docker run` as `-e NAME=value`. To change one later, remove the agent with `docker rm -f oneuptime-docker-agent` and run the command again with the new value.":
    "Passez chacune à `docker run` sous la forme `-e NAME=value`. Pour en modifier une plus tard, supprimez l'agent avec `docker rm -f oneuptime-docker-agent` et relancez la commande avec la nouvelle valeur.",
  "The agent tails `/var/lib/docker/containers/*/*-json.log`, so it only sees logs from containers that use Docker's **`json-file`** log driver. That is Docker's default, but some hosts switch to `local` (binary files the agent cannot parse) or to a remote driver (`journald`, `syslog`, `fluentd`, `gelf`, …), which leave no files to read.":
    "L'agent suit `/var/lib/docker/containers/*/*-json.log` ; il ne voit donc que les journaux des conteneurs qui utilisent le pilote de journalisation **`json-file`** de Docker. C'est celui de Docker par défaut, mais certains hôtes passent à `local` (des fichiers binaires que l'agent ne sait pas lire) ou à un pilote distant (`journald`, `syslog`, `fluentd`, `gelf`, …), qui ne laissent aucun fichier à lire.",
  "Check a container's log driver, and the daemon's default:":
    "Vérifiez le pilote de journalisation d'un conteneur, et celui du démon par défaut :",
  "Switch a Compose service to `json-file`, with rotation:":
    "Passez un service Compose à `json-file`, avec rotation :",
  "Or change the daemon's default for every container created afterwards, in `/etc/docker/daemon.json`:":
    "Ou changez le pilote par défaut du démon pour chaque conteneur créé ensuite, dans `/etc/docker/daemon.json` :",
  "Then restart Docker and **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with.":
    "Redémarrez ensuite Docker et **recréez** (pas seulement redémarrer) les conteneurs concernés : un conteneur garde le pilote de journalisation avec lequel il a été créé.",
  "`oneuptime-docker-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `docker rm -f oneuptime-docker-ai-agent`.":
    "`oneuptime-docker-ai-agent`, le second conteneur que démarre l'étape 2, exécute les commandes `docker` que demande OneUptime AI pendant qu'il enquête sur un incident ou une alerte de cet hôte. **Les enquêtes IA sont activées par défaut** : dès qu'il est connecté, OneUptime AI enquête avec lui, et la page **IA → Agent IA** de l'hôte ainsi que sa **Vue d'ensemble** affichent son état. Pour désactiver les enquêtes, utilisez **Ce que l'IA peut faire** sur cette page ; pour exécuter le collecteur sans l'agent IA, supprimez-le avec `docker rm -f oneuptime-docker-ai-agent`.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **En lecture seule par défaut.** Il exécute des commandes comme `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` et `docker stats --no-stream`, jamais `exec`, `run`, `rm` ni `prune`. Les valeurs d'environnement dans la sortie de `docker inspect` sont masquées avant que quoi que ce soit ne quitte l'hôte.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Les correctifs sont à activer.** Ajoutez `-e ONEUPTIME_AI_ALLOW_WRITES=true` à la commande pour lui permettre de redémarrer, démarrer, arrêter, mettre en pause, tuer un conteneur nommé ou en changer les limites. `ONEUPTIME_AI_FIXES` à côté indique si chaque correctif demande une approbation (`ask-for-approval`, `automatic` ou `bypass-approval`), et la page **IA → Agent IA** de l'hôte l'affiche. `ONEUPTIME_AI_WRITE_TARGETS` (des globs séparés par des virgules, comme `web-*,api-*`) limite les conteneurs concernés ; `ONEUPTIME_AI_PROTECTED_TARGETS` ajoute des conteneurs qu'il ne doit jamais modifier. Il ne se modifie jamais lui-même, ni le collecteur.",
  "- It runs as root because the Docker socket is root-owned. The socket's `:ro` mount does not make the Docker API read-only — the agent's command policy is the limit.":
    "- Il s'exécute en root parce que le socket Docker appartient à root. Le montage `:ro` du socket ne rend pas l'API Docker en lecture seule : la limite, c'est la politique de commandes de l'agent.",
  "- Its logs: `docker logs -f oneuptime-docker-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- Ses journaux : `docker logs -f oneuptime-docker-ai-agent`. Ce qu'il peut exécuter, et le fonctionnement des correctifs : [Agents IA d'infrastructure](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| Tag d'image | Description |",
  "| `oneuptime/docker-agent:release` | Latest stable release (community) |":
    "| `oneuptime/docker-agent:release` | Dernière version stable (community) |",
  "| `oneuptime/docker-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/docker-agent:enterprise-release` | Dernière version stable (enterprise) |",
  "| `oneuptime/docker-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/docker-agent:<version>` | Une version figée, par ex. `10.0.31` |",
  "| `ghcr.io/oneuptime/docker-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/docker-agent:release` | La même image, en miroir sur GHCR |",
  "Use one in place of `oneuptime/docker-agent:release` at the end of the `docker run` command.":
    "Utilisez-en une à la place de `oneuptime/docker-agent:release` à la fin de la commande `docker run`.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**Mise à niveau** : récupérez la dernière image et supprimez l'agent en cours d'exécution :",
  "Then run both `docker run` commands from step 2 again.":
    "Relancez ensuite les deux commandes `docker run` de l'étape 2.",
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
  "| **Container Logs** | stdout/stderr logs from all containers |":
    "| **Journaux de conteneurs** | Journaux stdout/stderr de tous les conteneurs |",
  'Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'Chaque ligne de journal reçoit une gravité d\'après le niveau qu\'elle indique (`[ERROR]`, `level=warn`, `{"level":"info"}`) ; une ligne sans niveau se rabat sur son flux : stderr vaut `ERROR`, stdout vaut `INFO`.',
  "The agent must run as root to read `/var/run/docker.sock`. Make sure the `--user 0:0` flag is in your `docker run` command.":
    "L'agent doit s'exécuter en root pour lire `/var/run/docker.sock`. Vérifiez que l'option `--user 0:0` figure dans votre commande `docker run`.",
  "The agent's logs show:": "Les journaux de l'agent affichent :",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Remove the agent (`docker rm -f oneuptime-docker-agent`), pull the latest image (`docker pull oneuptime/docker-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the daemon.":
    "Le démon refuse un client plus récent que son propre maximum, le collecteur s'arrête avec lui, et le conteneur redémarre en boucle. L'agent ne fige une version que si `DOCKER_API_VERSION` en indique une, et une ancienne image de l'agent figeait `1.44`, que Docker Engine 20.10 à 24 refusent. Supprimez l'agent (`docker rm -f oneuptime-docker-agent`), récupérez la dernière image (`docker pull oneuptime/docker-agent:release`) et relancez la commande de l'étape 2, sans `-e DOCKER_API_VERSION`. L'agent négocie alors la version avec le démon.",
  "To pin a version anyway, use no more than the daemon's maximum:":
    "Pour figer une version malgré tout, ne dépassez pas le maximum du démon :",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "Ajoutez-la à la commande, par ex. `-e DOCKER_API_VERSION=1.41`. Les démons plus récents servent toujours les anciennes versions de l'API ; une version figée continue donc de fonctionner après une mise à niveau de Docker.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-docker-agent`":
    "1. Vérifiez que l'agent tourne : `docker ps --filter name=oneuptime-docker-agent`",
  "2. Check the agent's logs for errors: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`":
    "2. Cherchez des erreurs dans les journaux de l'agent : `docker logs oneuptime-docker-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `docker run` command are correct.":
    "3. Vérifiez que l'URL OneUptime et la clé d'ingestion de la commande `docker run` sont correctes.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. Assurez-vous que l'hôte peut joindre votre instance OneUptime par le réseau.",
  "Check that the Docker socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "Vérifiez que le socket Docker est monté dans l'agent. Son image n'a pas de shell : regardez depuis un conteneur jetable qui partage ses montages :",
  "Then look for export errors in the agent's logs — `docker logs oneuptime-docker-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "Cherchez ensuite des erreurs d'export dans les journaux de l'agent (`docker logs oneuptime-docker-agent 2>&1 | grep -i error`) et vérifiez que la clé d'ingestion est valide et n'a pas expiré.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using the `json-file` log driver.":
    "Les métriques arrivent, mais l'onglet **Journaux** est vide, ou n'affiche que les journaux de l'agent lui-même ? Vos conteneurs n'utilisent très probablement pas le pilote de journalisation `json-file`.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `json-file`. Switch them (see **Collect logs from every container (json-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "Si l'étape 1 affiche `no files match the configured criteria`, ou si l'étape 3 ne liste aucun fichier pour vos conteneurs, c'est qu'ils n'utilisent pas `json-file`. Changez-les (voir **Collecter les journaux de tous les conteneurs (pilote de journalisation json-file)** sous Avancé), puis recréez chacun d'eux : un conteneur garde le pilote de journalisation avec lequel il a été créé :",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `DOCKER_HOST_NAME`. Change `DOCKER_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "La page d'un hôte affiche les données dont le nom d'hôte est l'identifiant de cet hôte, que l'agent tire de `DOCKER_HOST_NAME`. Changez `DOCKER_HOST_NAME` après l'enregistrement de l'hôte, et OneUptime enregistre un second hôte sous le nouveau nom : les journaux sont sur celui-là. Vérifiez le nom que l'agent rapporte :",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and recreate the agent — `docker rm -f oneuptime-docker-agent`, then run the command from step 2 with the new name.":
    "Le nom de l'hôte vient de `DOCKER_HOST_NAME`. Un agent démarré sans lui rapporte `docker-host` ; tous les hôtes configurés ainsi ressemblent donc au même hôte. Donnez à `DOCKER_HOST_NAME` un nom propre à chaque hôte et recréez l'agent : `docker rm -f oneuptime-docker-agent`, puis relancez la commande de l'étape 2 avec le nouveau nom.",
  "This installs the agent for **`web-1`** — keep `DOCKER_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "Ceci installe l'agent pour **`web-1`** : gardez `DOCKER_HOST_NAME` exactement tel quel, sinon les données s'enregistrent comme un nouvel hôte.",
  "Docker Compose v2 (the `docker compose` command)":
    "Docker Compose v2 (la commande `docker compose`)",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-docker-ai-agent` service to run the collector without AI investigations.":
    "Le second service est l'agent IA OneUptime, avec la même URL, la même clé et le même nom d'hôte. **Les enquêtes IA sont activées par défaut** : pendant que OneUptime AI enquête sur un incident ou une alerte de cet hôte, il exécute des commandes `docker` en lecture seule via l'agent IA, et ne modifie rien tant que vous n'autorisez pas de correctifs — voir **L'agent IA OneUptime** sous Avancé. Supprimez le service `oneuptime-docker-ai-agent` pour exécuter le collecteur sans enquêtes IA.",
  "Set each one in the agent's `environment:` list, then run `docker compose up -d` to recreate it with the new values.":
    "Définissez chacune dans la liste `environment:` de l'agent, puis lancez `docker compose up -d` pour le recréer avec les nouvelles valeurs.",
  "`oneuptime-docker-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `docker compose up -d --remove-orphans`.":
    "`oneuptime-docker-ai-agent`, le second service de docker-compose.yml, exécute les commandes `docker` que demande OneUptime AI pendant qu'il enquête sur un incident ou une alerte de cet hôte. **Les enquêtes IA sont activées par défaut** : dès qu'il est connecté, OneUptime AI enquête avec lui, et la page **IA → Agent IA** de l'hôte ainsi que sa **Vue d'ensemble** affichent son état. Pour désactiver les enquêtes, utilisez **Ce que l'IA peut faire** sur cette page ; pour exécuter le collecteur sans l'agent IA, supprimez son service et lancez `docker compose up -d --remove-orphans`.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Les correctifs sont à activer.** Ajoutez `- ONEUPTIME_AI_ALLOW_WRITES=true` à sa liste `environment:` pour lui permettre de redémarrer, démarrer, arrêter, mettre en pause, tuer un conteneur nommé ou en changer les limites. `ONEUPTIME_AI_FIXES` à côté indique si chaque correctif demande une approbation (`ask-for-approval`, `automatic` ou `bypass-approval`), et la page **IA → Agent IA** de l'hôte l'affiche. `ONEUPTIME_AI_WRITE_TARGETS` (des globs séparés par des virgules, comme `web-*,api-*`) limite les conteneurs concernés ; `ONEUPTIME_AI_PROTECTED_TARGETS` ajoute des conteneurs qu'il ne doit jamais modifier. Il ne se modifie jamais lui-même, ni le collecteur.",
  "Use one in place of `oneuptime/docker-agent:release` on the agent's `image:` line.":
    "Utilisez-en une à la place de `oneuptime/docker-agent:release` sur la ligne `image:` de l'agent.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**Mise à niveau** : dans le dossier qui contient docker-compose.yml, récupérez les dernières images et recréez les conteneurs :",
  "**Uninstall** — stop and remove everything the file started:":
    "**Désinstallation** : arrêtez et supprimez tout ce que le fichier a démarré :",
  'The agent must run as root to read `/var/run/docker.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml.':
    "L'agent doit s'exécuter en root pour lire `/var/run/docker.sock`. Vérifiez que le service de l'agent a `user: \"0:0\"` dans docker-compose.yml.",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `docker compose pull` and `docker compose up -d`. The agent then negotiates the version with the daemon.":
    "Le démon refuse un client plus récent que son propre maximum, le collecteur s'arrête avec lui, et le conteneur redémarre en boucle. L'agent ne fige une version que si `DOCKER_API_VERSION` en indique une, et une ancienne image de l'agent figeait `1.44`, que Docker Engine 20.10 à 24 refusent. Retirez `DOCKER_API_VERSION` de la liste `environment:` de l'agent, puis lancez `docker compose pull` et `docker compose up -d`. L'agent négocie alors la version avec le démon.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `docker compose up -d`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "Ajoutez-la à la liste `environment:` de l'agent, par ex. `- DOCKER_API_VERSION=1.41`, et lancez `docker compose up -d`. Les démons plus récents servent toujours les anciennes versions de l'API ; une version figée continue donc de fonctionner après une mise à niveau de Docker.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. Vérifiez que l'URL OneUptime et la clé d'ingestion de docker-compose.yml sont correctes.",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and run `docker compose up -d` to recreate the agent with it.":
    "Le nom de l'hôte vient de `DOCKER_HOST_NAME`. Un agent démarré sans lui rapporte `docker-host` ; tous les hôtes configurés ainsi ressemblent donc au même hôte. Donnez à `DOCKER_HOST_NAME` un nom propre à chaque hôte et lancez `docker compose up -d` pour recréer l'agent avec.",
};

export default TRANSLATION;
