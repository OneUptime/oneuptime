# Agent Docker

L'agent Docker de OneUptime est un conteneur que vous exécutez sur un hôte Docker. Il lit les statistiques et les fichiers de journaux de chaque conteneur de l'hôte et les envoie à OneUptime, où l'hôte apparaît avec ses conteneurs, ses métriques et ses journaux. Un deuxième conteneur, l'agent IA Docker, permet à OneUptime AI d'enquêter sur l'hôte. Les [moniteurs Docker](/docs/monitor/docker-monitor) déclenchent des alertes à partir de ce qu'envoie l'agent.

:::cards
- [Installer l'agent](#installer-lagent): Deux conteneurs, avec `docker run` ou Docker Compose.
- [Ce que collecte l'agent](#ce-que-collecte-lagent): Métriques, journaux et un inventaire de chaque conteneur.
- [Les journaux de conteneurs nécessitent json-file](#les-journaux-de-conteneurs-nécessitent-le-pilote-json-file): Vérifier et changer le pilote de journalisation d'un conteneur.
- [Dépannage](#dépannage): Redémarrages en boucle, métriques manquantes, journaux manquants.
:::

## Fonctionnement

L'agent est un OpenTelemetry Collector avec la configuration de OneUptime intégrée. Via le socket Docker, il lit les statistiques de chaque conteneur toutes les 30 secondes et liste chaque conteneur, image, réseau et volume toutes les 5 minutes. Il suit les fichiers de journaux des conteneurs et envoie le tout à votre URL OneUptime via OTLP, avec la clé d'ingestion que vous lui donnez.

```mermaid title="Deux conteneurs sur votre hôte Docker"
flowchart TB
    containers["Vos conteneurs"] -->|"statistiques, fichiers de journaux,<br/>inventaire"| agent["Agent Docker"]
    agent -->|"OTLP sur HTTPS"| oneuptime["OneUptime"]
    oneuptime -->|"enquête sur un incident<br/>ou une alerte"| ai["Agent IA Docker"]
    ai -->|"commandes docker<br/>en lecture seule"| containers
```

L'hôte s'enregistre avec ses premières données, sous le nom que vous lui donnez dans `DOCKER_HOST_NAME`. L'agent IA est optionnel : sans lui, le collecteur fonctionne de la même façon.

## Avant de commencer

- Docker Engine 20.10 ou ultérieur, et un accès root sur l'hôte : l'agent lit `/var/run/docker.sock`.
- Docker Compose v2 (la commande `docker compose`), si vous installez avec Docker Compose.
- Une clé d'ingestion. Créez-en une sous **Paramètres du projet → Télémétrie & APM → Clés d'ingestion** et copiez sa valeur.
- Du HTTPS sortant de l'hôte vers votre URL OneUptime.
- Pour les journaux de conteneurs, des conteneurs qui utilisent le pilote de journalisation `json-file` de Docker, qui est celui de Docker par défaut. Voir [Les journaux de conteneurs nécessitent le pilote json-file](#les-journaux-de-conteneurs-nécessitent-le-pilote-json-file).

## Installer l'agent

:::steps
### Démarrer l'agent

Remplacez `YOUR_ONEUPTIME_URL` par votre URL OneUptime, `YOUR_TELEMETRY_INGESTION_TOKEN` par la clé d'ingestion, et `my-docker-host` par un nom pour cet hôte, comme `prod-docker-01`. C'est sous ce nom que l'hôte apparaît dans OneUptime : gardez-le donc stable, car un nouveau nom enregistre un nouvel hôte.

:::tabs
@tab Docker CLI
```bash
docker run -d \
  --name oneuptime-docker-agent \
  --user 0:0 \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /var/lib/docker/containers:/var/lib/docker/containers:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e DOCKER_HOST_NAME="my-docker-host" \
  oneuptime/docker-agent:release
```

Démarrez ensuite l'[agent IA](#agent-ia) à côté, avec les mêmes valeurs. **Les enquêtes IA sont activées par défaut** : pendant que OneUptime AI enquête sur un incident ou une alerte sur cet hôte, elle exécute des commandes `docker` en lecture seule via l'agent IA, et ne modifie rien tant que vous n'autorisez pas de corrections. Pour installer sans enquêtes IA, ignorez cette commande.

```bash
docker run -d \
  --name oneuptime-docker-ai-agent \
  --user 0:0 \
  --restart unless-stopped \
  --read-only --tmpfs /tmp \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e ONEUPTIME_AI_AGENT_RESOURCE_TYPE=docker \
  -e DOCKER_HOST_NAME="my-docker-host" \
  oneuptime/resource-ai-agent:release
```
@tab Docker Compose
Enregistrez ceci sous le nom `docker-compose.yml` dans un dossier de l'hôte. Le second service est l'[agent IA](#agent-ia) : retirez-le pour exécuter le collecteur sans enquêtes IA.

```yaml title="docker-compose.yml"
services:
  oneuptime-docker-agent:
    image: oneuptime/docker-agent:release
    container_name: oneuptime-docker-agent
    user: "0:0"
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - DOCKER_HOST_NAME=my-docker-host
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
  oneuptime-docker-ai-agent:
    image: oneuptime/resource-ai-agent:release
    container_name: oneuptime-docker-ai-agent
    user: "0:0"
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - ONEUPTIME_AI_AGENT_RESOURCE_TYPE=docker
      - DOCKER_HOST_NAME=my-docker-host
```

Démarrez-le dans ce dossier :

```bash
docker compose up -d
```
:::

### Vérifier que l'agent s'exécute

```bash
docker ps --filter name=oneuptime-docker-agent
docker logs -f oneuptime-docker-agent
```

Les journaux doivent afficher cette ligne une fois le collecteur démarré :

```text
Everything is ready. Begin running and processing data.
```

### Trouver l'hôte dans OneUptime

Ouvrez **Produits → Infrastructure → Docker → Tous les hôtes**. L'hôte apparaît sous son `DOCKER_HOST_NAME` en une minute environ, avec ses conteneurs, ses métriques et ses journaux. L'agent IA apparaît comme connecté sur la page **Agent IA** de l'hôte, et en bas de sa **Vue d'ensemble**.
:::

## Variables d'environnement

| Variable | Obligatoire | Description |
| --- | --- | --- |
| `ONEUPTIME_URL` | Oui | Votre URL OneUptime, comme `https://oneuptime.com` ou votre instance auto-hébergée. Utilisez `http://` et son port si l'instance ne parle que HTTP. |
| `ONEUPTIME_SERVICE_TOKEN` | Oui | La clé d'ingestion de **Paramètres du projet → Télémétrie & APM → Clés d'ingestion**. |
| `DOCKER_HOST_NAME` | Non | Le nom de l'hôte dans OneUptime. Par défaut `docker-host` : donnez donc le sien à chaque hôte. |
| `DOCKER_API_VERSION` | Non | La version de l'API Docker Engine que parle l'agent. Par défaut `1.44`. Baissez-la pour un daemon plus ancien, ou définissez une valeur vide pour la négocier avec le daemon (voir [Dépannage](#dépannage)). |

Pour modifier une valeur, supprimez l'agent et exécutez de nouveau sa commande (Docker CLI), ou modifiez `docker-compose.yml` et exécutez `docker compose up -d` (Docker Compose).

## Ce que collecte l'agent

| Données | Contenu |
| --- | --- |
| Métriques des conteneurs | CPU (utilisation, pourcentage, bridage), mémoire (utilisation, limite, pourcentage), E/S réseau et bloc, durée de fonctionnement, redémarrages et nombre de processus, par conteneur, toutes les 30 secondes. |
| Journaux des conteneurs | stdout et stderr de chaque conteneur, depuis son fichier de journal `json-file`. |
| Inventaire | Chaque conteneur, quel que soit son état, ainsi que chaque image, réseau et volume, toutes les 5 minutes. |

Les métriques et les journaux de chaque conteneur sont classés sous un service portant le nom du conteneur. Chaque ligne de journal reçoit une gravité d'après le niveau qu'elle mentionne, comme `[ERROR]`, `level=warn` ou `{"level":"info"}` ; une ligne qui n'en mentionne aucun prend celle de son flux : stderr vaut `ERROR`, stdout vaut `INFO`. Les lignes qui commencent par un espace ou un crochet fermant sont rattachées à la ligne précédente : une stack trace arrive donc en un seul enregistrement. Les journaux de l'agent lui-même sont ignorés.

[Surveillance Docker](/docs/monitor/docker-monitor#métriques-collectées) liste chaque métrique et sa signification.

## Les journaux de conteneurs nécessitent le pilote json-file

L'agent suit `/var/lib/docker/containers/*/*-json.log`, les fichiers qu'écrit le pilote de journalisation `json-file` de Docker. Un conteneur qui utilise un autre pilote ne laisse aucun fichier à lire : `local` écrit des fichiers binaires, et `journald`, `syslog`, `fluentd` et `gelf` envoient les journaux ailleurs. Ses métriques arrivent toujours ; ses journaux, non.

Vérifiez le pilote de journalisation d'un conteneur, et celui du daemon par défaut :

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
docker info --format '{{.LoggingDriver}}'
```

Passez un service Compose à `json-file`, avec rotation :

```yaml
services:
  my-app:
    image: my-app:latest
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "5"
```

Ou faites-en la valeur par défaut pour chaque conteneur créé ensuite, dans `/etc/docker/daemon.json` :

```json title="/etc/docker/daemon.json"
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

Redémarrez ensuite Docker et recréez les conteneurs. Un conteneur garde le pilote de journalisation avec lequel il a été créé : le redémarrer ne suffit donc pas.

## Mettre à jour l'agent

Lorsque l'agent est plus ancien que votre OneUptime, un signe d'avertissement apparaît à côté de **Version de l'agent** dans la **Vue d'ensemble** de l'hôte. Sélectionnez-le pour voir ces commandes.

:::tabs
@tab Docker CLI
```bash
docker pull oneuptime/docker-agent:release
docker pull oneuptime/resource-ai-agent:release
docker rm -f oneuptime-docker-agent oneuptime-docker-ai-agent
```

Exécutez ensuite de nouveau les deux commandes `docker run` de [Démarrer l'agent](#démarrer-lagent).
@tab Docker Compose
```bash
docker compose pull
docker compose up -d
```
:::

Le tag `release` pointe toujours vers la version la plus récente. Pour épingler une version, utilisez `oneuptime/docker-agent:<version>`, comme `oneuptime/docker-agent:10.0.31`. La même image se trouve sur GitHub Container Registry sous `ghcr.io/oneuptime/docker-agent:release`.

## Désinstaller l'agent

:::tabs
@tab Docker CLI
```bash
docker rm -f oneuptime-docker-agent
docker rm -f oneuptime-docker-ai-agent
```
@tab Docker Compose
```bash
docker compose down
```
:::

L'hôte reste dans OneUptime avec les données qu'il a envoyées. Si vous n'en avez plus besoin, supprimez-le avec **Supprimer l'hôte** dans son menu.

## Agent IA

Les commandes et le fichier Compose ci-dessus, l'`install.sh` de l'agent Docker et le `docker-compose.yml` de son [répertoire DockerAgent](https://github.com/OneUptime/oneuptime/tree/master/agents/DockerAgent) exécutent tous l'**Agent IA Docker** : un deuxième conteneur, `oneuptime-docker-ai-agent` (image `oneuptime/resource-ai-agent:release`), qui exécute les commandes `docker` en lecture seule que demande OneUptime AI pendant qu'elle enquête sur un incident ou une alerte sur cet hôte — `docker ps -a`, `docker logs --tail 200 web`, `docker container inspect web`, `docker stats --no-stream` — et, uniquement si vous l'autorisez, applique des corrections comme le redémarrage d'un conteneur donné. Il lit les mêmes `ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN` et `DOCKER_HOST_NAME` que le collecteur : il sert donc exactement cet hôte, et apparaît sur la page **Agent IA** de l'hôte dans OneUptime.

- **Les enquêtes IA sont activées par défaut.** Dès que l'agent se connecte, OneUptime AI enquête avec lui sur les incidents et les alertes de cet hôte, et la **Vue d'ensemble** de l'hôte affiche l'état de l'agent. Pour arrêter, définissez `ONEUPTIME_AI_INVESTIGATION=false` là où l'agent s'exécute (**Modifier**, sous **Ce que l'IA peut faire** sur la page de l'agent IA, montre comment), ou ne lancez pas l'agent.
- Il est en lecture seule, sauf si vous le démarrez avec `ONEUPTIME_AI_ALLOW_WRITES=true` ; `ONEUPTIME_AI_WRITE_TARGETS` (par exemple `web-*,api-*`) limite les conteneurs qu'une correction peut toucher. Démarrez-le aussi avec `ONEUPTIME_AI_FIXES` pour indiquer comment les corrections s'exécutent — `ask-for-approval` (une personne approuve chacune), `automatic` ou `bypass-approval` — et la page de l'agent IA l'affiche en lecture seule ([Ce que l'IA peut faire, défini par l'agent](/docs/ai/infrastructure-ai-agents#what-ai-may-do-set-by-the-agent)).
- Il s'exécute en tant que root avec le socket Docker monté, car le socket appartient à root — et quiconque peut utiliser le socket est root sur cet hôte, `:ro` ou non. La limite est la politique de commandes de l'agent : il n'exécute jamais `exec`, `run`, `rm` ni `prune`, et ne modifie jamais lui-même, le collecteur ni quoi que ce soit dans `ONEUPTIME_AI_PROTECTED_TARGETS` (des globs de noms de conteneurs). Les valeurs d'environnement de la sortie de `docker inspect` sont masquées avant que quoi que ce soit ne quitte l'hôte.
- `install.sh --no-ai-agent` l'omet ; `docker rm -f oneuptime-docker-ai-agent` le supprime. Mettez-le à jour comme le collecteur : `docker pull oneuptime/resource-ai-agent:release`, supprimez-le, puis redémarrez-le.

Ce qu'il peut exécuter, comment fonctionnent les corrections et comment le dépanner : [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).

## Dépannage

:::details L'agent redémarre avec "client version is too new"
Les journaux de l'agent affichent :

```text
Error: cannot start pipelines: failed to start "docker_stats" receiver:
Error response from daemon: client version 1.44 is too new.
Maximum supported API version is 1.41
```

Un daemon refuse un client plus récent que son propre maximum : le receiver ne démarre donc jamais, et le collecteur s'arrête avec lui. Trouvez le maximum du daemon :

```bash
docker version --format '{{ .Server.APIVersion }}'
```

Ajoutez ensuite `-e DOCKER_API_VERSION=1.41` (ou la valeur obtenue) à `docker run`, ou définissez `DOCKER_API_VERSION` dans Compose. Les daemons plus récents servent toujours les anciennes versions de l'API : le réglage reste donc valable après une mise à jour.

Vous préférez ne pas chercher le numéro ? Définissez `DOCKER_API_VERSION` sur la chaîne vide. L'agent négocie alors la version avec le daemon (un `HEAD /_ping`, puis le maximum propre au daemon), ce qui fonctionne avec les anciens comme avec les nouveaux daemons :

```bash
docker run -d ... -e DOCKER_API_VERSION= ...
```
:::

:::details Accès refusé au socket Docker
L'agent doit s'exécuter en tant que root pour lire `/var/run/docker.sock`. Vérifiez que `--user 0:0` figure dans votre commande `docker run`, ou `user: "0:0"` dans Compose.
:::

:::details L'hôte apparaît comme déconnecté
1. Vérifiez que l'agent s'exécute : `docker ps --filter name=oneuptime-docker-agent`
2. Recherchez des erreurs dans ses journaux : `docker logs oneuptime-docker-agent 2>&1 | grep -i error`
3. Vérifiez `ONEUPTIME_URL` et `ONEUPTIME_SERVICE_TOKEN` : la clé doit être une clé d'ingestion valide qui n'a pas été désactivée.
4. Vérifiez que l'hôte peut joindre votre URL OneUptime sur le réseau.
:::

:::details Aucune métrique n'apparaît
1. Vérifiez que le socket Docker est monté dans l'agent. Son image n'a pas de shell : regardez donc depuis un conteneur jetable qui partage ses montages : `docker run --rm --volumes-from oneuptime-docker-agent alpine:3.19 ls -la /var/run/docker.sock`
2. Recherchez des erreurs d'export dans ses journaux : `docker logs oneuptime-docker-agent 2>&1 | tail -100`
3. Vérifiez que la clé d'ingestion est valide et n'a pas expiré.
:::

:::details Les métriques arrivent, mais pas les journaux des conteneurs
Vos conteneurs utilisent très probablement un autre pilote de journalisation que `json-file`. Vérifiez quels fichiers l'agent surveille, et quel pilote utilise un conteneur :

```bash
docker logs oneuptime-docker-agent 2>&1 | grep -E "Started watching file|no files match"
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

Si l'agent signale `no files match the configured criteria`, passez les conteneurs à `json-file` et recréez-les, comme le montre [Les journaux de conteneurs nécessitent le pilote json-file](#les-journaux-de-conteneurs-nécessitent-le-pilote-json-file).
:::

:::details Les journaux sont sur un autre hôte, ou l'hôte s'appelle docker-host
Le nom de l'hôte vient de `DOCKER_HOST_NAME`. Un agent démarré sans lui signale `docker-host` : tous les hôtes configurés ainsi semblent donc être le même. Changez le nom plus tard, et OneUptime enregistre un second hôte, qui reçoit alors les nouvelles données. Définissez `DOCKER_HOST_NAME` sur un nom propre à chaque hôte, et recréez l'agent. Pour vérifier le nom que signale l'agent :

```bash
docker inspect oneuptime-docker-agent --format '{{range .Config.Env}}{{println .}}{{end}}' | grep DOCKER_HOST_NAME
```
:::

## Étapes suivantes

:::cards
- [Surveillance Docker](/docs/monitor/docker-monitor): Alerter sur le CPU, la mémoire et les redémarrages des conteneurs.
- [Bases de données](/docs/telemetry/databases): Les conteneurs de bases de données de l'hôte sont détectés et ont leurs propres pages.
- [Agent Kubernetes](/docs/telemetry/kubernetes-agent): Surveiller plutôt un cluster Kubernetes.
- [Collecteur OpenTelemetry sur l'hôte](/docs/telemetry/host-otel-collector): Surveiller la machine elle-même : CPU, disques, processus et journaux.
:::
