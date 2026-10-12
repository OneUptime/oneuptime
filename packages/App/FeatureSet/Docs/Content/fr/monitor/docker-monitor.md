# Surveillance Docker

Un moniteur Docker surveille les conteneurs d'un hôte Docker et vous prévient quand un conteneur chauffe, manque de mémoire ou redémarre en boucle. Il lit les métriques que l'agent Docker de OneUptime envoie depuis l'hôte, si bien que rien n'est sondé depuis l'extérieur : installez l'agent, puis créez le moniteur à partir d'un modèle ou de votre propre requête.

:::cards
- [Créer le moniteur](#créer-un-moniteur-docker): Six étapes dans le tableau de bord.
- [Modèles](#modèles-dalerte-prêts-à-lemploi): Six alertes prêtes à l'emploi, un incident par conteneur.
- [Métriques](#métriques-collectées): Ce que collecte l'agent, et ce que signifie chaque métrique.
- [Journaux](#journaux-collectés): Les journaux des conteneurs, et le pilote de journalisation dont ils ont besoin.
:::

## Fonctionnement

L'agent Docker de OneUptime s'exécute comme conteneur sur l'hôte. Toutes les 30 secondes, il lit les statistiques des conteneurs via l'API Docker Engine, suit les fichiers journaux des conteneurs et envoie les deux à OneUptime via OTLP. Les premières données d'un hôte l'enregistrent dans OneUptime.

Un moniteur Docker est lié à un hôte. Chaque minute, il exécute sa requête sur les métriques des conteneurs de cet hôte et compare le résultat à ses critères.

```mermaid title="D'un hôte Docker à l'incident"
flowchart TB
    subgraph host["Votre hôte Docker"]
        direction LR
        containers["Conteneurs"] --> agent["Agent Docker de OneUptime"]
    end
    agent -->|"métriques et journaux via OTLP"| oneuptime["OneUptime"]
    oneuptime -->|"premières données"| registered["Hôte Docker enregistré"]
    oneuptime --> monitor["Moniteur Docker"]
    monitor -->|"chaque minute"| criteria{"Critères remplis ?"}
    criteria -->|"oui"| incident["Incident ou alerte"]
    criteria -->|"non"| online["Moniteur en ligne"]
```

## Avant de commencer

- **Installez l'agent Docker** sur l'hôte. Le [guide de l'agent Docker](/docs/telemetry/docker-host) couvre son installation, sa mise à jour et sa vérification.
- **Vérifiez que l'hôte est enregistré.** Il apparaît sous **Produits → Infrastructure → Docker → Tous les hôtes**, nommé d'après le `DOCKER_HOST_NAME` de l'agent, dès l'arrivée de ses premières données.
- **Pour les journaux des conteneurs**, exécutez les conteneurs avec le pilote de journalisation Docker `json-file`. Voir [Pilote de journalisation requis](#pilote-de-journalisation-requis).

## Créer un moniteur Docker

:::steps
### Commencer un nouveau moniteur

Allez dans **Moniteurs** et cliquez sur **Créer un moniteur**.

### Choisir Docker Container

Sous **Type de moniteur**, cliquez sur **Plus de types de moniteurs** et choisissez **Docker Container** sous **Infrastructure**, ou tapez `docker` dans le champ de recherche. Saisissez un **Nom** – il est utilisé dans les titres des incidents et des alertes – et cliquez sur **Suivant**.

### Choisir l'hôte

Sous **Configuration du moniteur Docker**, choisissez l'hôte dans **Hôte Docker**. Chaque hôte qui a envoyé des données figure dans la liste.

### Choisir ce qu'il faut surveiller

Choisissez l'un des trois onglets :

- **Quick Setup** – cliquez sur un [modèle](#modèles-dalerte-prêts-à-lemploi). Il définit la métrique, l'agrégation, la plage temporelle et les seuils, et remplace les critères plus bas par les siens. Vous pouvez toujours changer la **Plage temporelle**.
- **Custom Metric** – choisissez une métrique dans **Métrique Docker**, puis définissez l'**Agrégation** et la **Plage temporelle**. **Nom du conteneur** et **Image du conteneur** la restreignent à certains conteneurs.
- **Avancé** – construisez vous-même des requêtes et des formules sous **Sélectionner les métriques**. Utilisez **Regrouper par** `resource.container.name` pour juger chaque conteneur séparément.

### Vérifier les critères

Ouvrez chaque critère sous **Critères du moniteur** et vérifiez sa **Métrique**, son **Agrégation**, sa **Condition** et son **Threshold**. Un modèle les remplit. Avec **Custom Metric** ou **Avancé**, le moniteur commence avec les [critères par défaut](#critères-par-défaut), qui ne remarquent qu'une métrique tombant à zéro ; définissez donc votre propre seuil.

### Créer le moniteur

Cliquez sur **Créer un moniteur**. OneUptime ouvre la page du moniteur et l'évalue chaque minute. Les incidents et alertes qu'il déclenche sont aussi listés sur les pages **Incidents** et **Alertes** de l'hôte.
:::

> [!TIP]
> Pour configurer plusieurs modèles à la fois, ouvrez l'hôte depuis **Produits → Infrastructure → Docker** et allez dans **Recommendations**. Choisissez les modèles voulus, choisissez qui est alerté, et OneUptime crée un moniteur par modèle.

## Paramètres du moniteur

| Champ | Onglet | Ce qu'il fait |
| --- | --- | --- |
| **Hôte Docker** | Tous | Obligatoire. Limite chaque requête au `resource.host.name` de l'hôte. OneUptime ajoute aussi `resource.container.runtime = docker` à chaque requête. |
| **Métrique Docker** | Custom Metric | Une métrique du catalogue de l'agent, regroupée en CPU, mémoire, réseau, E/S de bloc et conteneur. |
| **Nom du conteneur** | Custom Metric, Avancé | Facultatif. Correspondance exacte sur `resource.container.name`, par exemple `my-container`. |
| **Image du conteneur** | Custom Metric, Avancé | Facultatif. Correspondance exacte sur `resource.container.image.name`, par exemple `nginx:latest`. |
| **Agrégation** | Custom Metric | Comment les mesures sont combinées : **Moyenne**, **Maximum**, **Minimum**, **Somme** ou **Comptage**. Commence à l'agrégation habituelle de la métrique. |
| **Plage temporelle** | Tous | La fenêtre glissante que lit la requête, de **Past 1 Minute** à **Past 365 Days**. Un nouveau moniteur commence à **Past 1 Minute** ; les modèles définissent la leur. |
| **Sélectionner les métriques** | Avancé | Le constructeur de requêtes : **Métrique**, **Agréger par**, **Filtrer par attributs**, **Regrouper par**, plus **Ajouter une métrique** et **Ajouter une formule** pour combiner des requêtes. |

## Modèles d'alerte prêts à l'emploi

**Quick Setup** propose six modèles. Chacun construit un moniteur complet : une requête regroupée par `resource.container.name`, un critère qui se déclenche et un autre qui rétablit. Chaque conteneur est jugé séparément, si bien qu'un conteneur chargé n'en masque pas un autre, et chaque conteneur qui dépasse le seuil reçoit son propre incident et sa propre alerte. Les seuils sont des points de départ que vous pouvez modifier.

Sauf indication contraire dans le tableau, un critère ne se déclenche que si la condition est remplie à chaque minute de sa fenêtre, et il se rétablit 10 % au-delà du seuil pour qu'une valeur qui oscille autour de la limite ne bascule pas sans cesse.

| Modèle | Gravité | Surveille | Se déclenche quand | Se rétablit quand |
| --- | --- | --- | --- | --- |
| High Container CPU Usage | Warning | `container.cpu.utilization`, Max par conteneur, 5 dernières minutes | Au-dessus de 80 (% d'un cœur) | À 72 ou moins |
| High Container Memory Usage | Warning | `container.memory.percent`, Max par conteneur, 5 dernières minutes | Au-dessus de 85 % | À 76,5 % ou moins |
| Container Restart Loop | Critique | Croissance de `container.restarts` par conteneur, 15 dernières minutes | Plus de 3 redémarrages dans la fenêtre (Somme) | 2,7 ou moins |
| Container CPU Throttling | Warning | Croissance de `container.cpu.throttling_data.throttled_time` en ms par conteneur, 5 dernières minutes | Plus de 1000 ms dans la fenêtre (Somme) | 900 ms ou moins |
| High Container Process Count | Warning | `container.pids.count`, Max par conteneur, 5 dernières minutes | Au-dessus de 2000 | À 1800 ou moins |
| Container Down (Low Uptime) | Critique | `container.uptime`, Min par conteneur, dernière 1 minute | Égal à 0 | Au-dessus de 0 |

**Gravité** est le libellé qu'affiche le sélecteur. L'incident et l'alerte qu'un modèle crée commencent avec la gravité d'incident et d'alerte la plus élevée de votre projet ; changez-les dans les critères.

> [!NOTE]
> `container.cpu.utilization` est le nombre qu'affiche `docker stats` : 100 % correspond à un cœur de CPU complet, et non à l'hôte entier, si bien qu'un conteneur utilisant deux cœurs affiche 200. Sur un hôte multicœur, le seuil de 80 est un budget de CPU, pas une part de la machine.

> [!NOTE]
> `container.memory.percent` divise par la limite de mémoire du conteneur quand elle est définie, et sinon par la mémoire totale **de l'hôte**. Vérifiez si le conteneur a été démarré avec `--memory` avant de traiter un dépassement comme un arrêt imminent pour manque de mémoire.

> [!WARNING]
> `container.restarts` et `container.cpu.throttling_data.throttled_time` ne font que croître, donc ces deux modèles alertent sur leur croissance dans la fenêtre : une requête Maximum et une requête Minimum par minute, soustraites par une formule puis additionnées. Avec la collecte de l'agent toutes les 30 secondes, cela voit environ la moitié de l'activité réelle, et les seuils en tiennent déjà compte. Si vous portez le `collection_interval` de l'agent à 60 secondes ou plus, chaque minute ne contient qu'une mesure et les deux modèles cessent d'alerter.

> [!CAUTION]
> **Container Down (Low Uptime)** ne peut pas détecter un conteneur qui s'arrête et reste arrêté. L'agent ne remonte que les conteneurs en cours d'exécution, donc un conteneur arrêté n'envoie aucune donnée et sa durée de fonctionnement ne vaut jamais 0. Pour un service qui doit rester disponible, surveillez aussi ce qu'il sert – par exemple avec une [surveillance d'API](/docs/monitor/api-monitor).

## Métriques collectées

L'agent utilise le récepteur OpenTelemetry `docker_stats` sur le socket Docker, toutes les 30 secondes. Les métriques de chaque conteneur portent son identité comme attributs de ressource : `resource.container.name`, `resource.container.image.name`, `resource.container.id`, `resource.container.runtime` (`docker`) et `resource.host.name`.

### CPU

| Métrique | Description |
| --- | --- |
| `container.cpu.utilization` | Utilisation du CPU, où 100 % correspond à un cœur de CPU complet (la colonne CPU% de `docker stats`). |
| `container.cpu.usage.total` | Temps CPU utilisé depuis le démarrage du conteneur, en nanosecondes. Un compteur sur toute la durée de vie. |
| `container.cpu.throttling_data.throttled_time` | Nanosecondes pendant lesquelles le conteneur a été bridé par sa limite de CPU depuis son démarrage. Un compteur sur toute la durée de vie. |
| `container.cpu.throttling_data.throttled_periods` | Périodes de bridage depuis le démarrage du conteneur. Un compteur sur toute la durée de vie. |

### Mémoire

| Métrique | Description |
| --- | --- |
| `container.memory.usage.total` | Mémoire utilisée, en octets. |
| `container.memory.usage.limit` | Limite de mémoire, en octets. |
| `container.memory.percent` | Utilisation de la mémoire en pourcentage de la limite du conteneur, ou de la mémoire totale de l'hôte quand le conteneur n'a pas de limite. |

### Réseau

| Métrique | Description |
| --- | --- |
| `container.network.io.usage.rx_bytes` | Octets reçus. Un compteur sur toute la durée de vie. |
| `container.network.io.usage.tx_bytes` | Octets envoyés. Un compteur sur toute la durée de vie. |

### E/S de bloc

| Métrique | Description |
| --- | --- |
| `container.blockio.io_service_bytes_recursive.read` | Octets lus sur les périphériques de bloc. |
| `container.blockio.io_service_bytes_recursive.write` | Octets écrits sur les périphériques de bloc. |

### Conteneur

| Métrique | Description |
| --- | --- |
| `container.uptime` | Secondes écoulées depuis le démarrage du conteneur. Seuls les conteneurs en cours d'exécution la remontent. |
| `container.restarts` | Nombre de redémarrages du conteneur depuis sa création. Un compteur sur toute la durée de vie. |
| `container.pids.count` | Tâches dans le conteneur. Le contrôleur pids du cgroup compte les threads aussi bien que les processus. |

La liste **Métrique Docker** propose aussi `container.cpu.usage.percpu`, `container.memory.rss`, `container.memory.cache` et les compteurs de paquets réseau. La configuration de l'agent fournie ne les active pas ; vérifiez donc la page **Métriques** de l'hôte avant de vous appuyer dessus. `container.cpu.throttling_data.throttled_periods` n'est pas dans la liste ; interrogez-la depuis **Avancé**.

## Critères de surveillance

Un critère compare l'une des requêtes ou formules du moniteur à un seuil. Les critères d'un moniteur Docker n'ont pas de **Type de filtre** : chaque règle vérifie la valeur de la métrique, avec ces champs.

| Champ | Ce qu'il fait |
| --- | --- |
| **Métrique** | La requête ou la formule à vérifier, par son nom de variable. |
| **Agrégation** | Comment les valeurs de la fenêtre deviennent une seule réponse : **Moyenne**, **Somme**, **Maximum Value**, **Minimum Value**, **All Values** (chaque valeur doit correspondre) ou **Any Value** (une seule suffit). |
| **Condition** | **Greater Than**, **Less Than**, **Greater Than Or Equal To**, **Less Than Or Equal To** ou **Equal To** – ou une condition d'anomalie : **Anomalously High**, **Anomalously Low** ou **Anomalous**. |
| **Threshold** | La valeur de comparaison. Une liste d'unités se trouve à côté quand la métrique a une unité. Non affiché pour les conditions d'anomalie. |
| **Sensibilité** | Conditions d'anomalie uniquement. **Faible** (4σ), **Moyen** (3σ, la valeur par défaut) ou **Élevé** (2σ). |
| **Fenêtre de référence** | Conditions d'anomalie uniquement. 14 jours (la valeur par défaut), 28, 60 ou 90 jours d'historique. |
| **En l'absence de données** | Sous **Plus de champs**. Ce qui se passe quand la fenêtre n'a aucune mesure : **Ignore** (par défaut), **Treat As Zero** ou **Déclencheur**. |

Les conditions d'anomalie comparent chaque valeur à la même heure de la semaine dans la référence. Elles restent dans un état « Learning », et ne déclenchent rien, tant que la fenêtre de référence ne contient pas assez d'historique.

Chaque critère indique aussi quoi faire quand il correspond : changer le statut du moniteur, créer une alerte ou déclarer un incident. Les critères sont vérifiés de haut en bas, et le premier qui correspond l'emporte.

### Critères par défaut

Un moniteur que vous ne créez pas à partir d'un modèle commence avec deux critères :

| Ordre | Critère | Correspond quand | Ensuite |
| --- | --- | --- | --- |
| 1 | Check if _monitor name_ is offline | Une valeur quelconque de la première requête vaut `0` | Marque le moniteur **Hors ligne** et déclare l'incident « _monitor name_ is offline », qui se résout de lui-même quand le moniteur se rétablit. |
| 2 | Check if _monitor name_ is online | Une valeur quelconque est au-dessus de `0` | Marque le moniteur **Opérationnel**. |

> [!IMPORTANT]
> Le silence ne correspond à aucun des deux critères : un hôte qui cesse d'envoyer des données laisse le moniteur tel qu'il était. Pour être prévenu quand les données s'arrêtent, réglez **En l'absence de données** sur **Déclencheur** dans un critère. Le temps pendant lequel OneUptime lui-même ne recevait pas de données n'est jamais une absence de données : une vérification dont la fenêtre en contient attend à la place, comme l'explique [Quand OneUptime ne reçoit pas de données](/docs/monitor/when-oneuptime-is-not-receiving).

## Journaux collectés

L'agent suit aussi le fichier `*-json.log` de chaque conteneur et envoie chaque ligne comme enregistrement de journal OpenTelemetry avec :

| Champ | Valeur |
| --- | --- |
| `resource.host.name` | L'hôte, d'après `DOCKER_HOST_NAME`. |
| `resource.container.id` | L'ID complet du conteneur. |
| `resource.container.runtime` | Toujours `docker`. |
| `attributes["log.iostream"]` | `stdout` ou `stderr`. |
| `severityText` / `severityNumber` | Lu à partir d'un mot-clé de niveau là où un niveau figure dans la ligne (`[ERROR]`, `app.INFO:`, `{"level":"warn"}`, `level=error`). Une ligne sans niveau se rabat sur son flux : `stderr` donne `ERROR`, `stdout` donne `INFO`. |
| `body` | La ligne que le conteneur a écrite. Les lignes qui commencent par un espace ou un crochet fermant, comme les lignes d'une trace de pile, sont rattachées à la ligne précédente. |
| `time` | L'horodatage du démon Docker pour la ligne. |

Les journaux apparaissent sur la page **Journaux** de l'hôte et sur la page de chaque conteneur.

### Pilote de journalisation requis

L'agent ne peut lire que les journaux des conteneurs qui utilisent le pilote de journalisation Docker `json-file`. C'est le pilote par défaut de Docker, mais un conteneur ou le démon entier peut en utiliser un autre :

| Pilote | Ce que voit l'agent |
| --- | --- |
| `json-file` | Chaque ligne. |
| `local` | Rien : le fichier est binaire, et l'agent ne peut pas l'analyser. |
| `journald`, `syslog`, `fluentd`, `gelf`, `awslogs`, `splunk`, … | Rien : les journaux partent ailleurs, il n'y a donc aucun fichier à suivre. |
| `none` | Rien : les journaux sont supprimés. |

Vérifiez le pilote d'un conteneur, et celui du démon par défaut :

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
docker info --format '{{.LoggingDriver}}'
```

Passez à `json-file`. Docker fixe le pilote de journalisation d'un conteneur à sa création ; recréez donc chaque conteneur après le changement – un redémarrage conserve l'ancien pilote.

:::tabs
@tab Docker Compose
Définissez le pilote sur chaque service, avec rotation :

```yaml title="docker-compose.yml"
services:
  my-app:
    image: my-app:latest
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "5"
```

Puis recréez le service :

```bash
docker compose up -d --force-recreate <service>
```
@tab Démon Docker
Faites de `json-file` le pilote par défaut de chaque conteneur créé ensuite :

```json title="/etc/docker/daemon.json"
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

Redémarrez le démon Docker, puis supprimez et recréez chaque conteneur :

```bash
docker rm -f <container>
docker run ... <image>
```
:::

## Dépannage

:::details L'hôte n'est pas dans la liste Hôte Docker
Les hôtes s'enregistrent eux-mêmes à partir des données de l'agent. Vérifiez que le conteneur de l'agent tourne et que l'hôte figure sous **Produits → Infrastructure → Docker → Tous les hôtes**. Le [guide de l'agent Docker](/docs/telemetry/docker-host) contient les vérifications à exécuter sur l'hôte.
:::

:::details Les métriques arrivent mais la page Journaux est vide
Les conteneurs n'utilisent presque certainement pas le pilote de journalisation `json-file`. Vérifiez-les avec les commandes de [Pilote de journalisation requis](#pilote-de-journalisation-requis), basculez ceux dont vous voulez les journaux et recréez-les.
:::

:::details L'agent journalise « no files match the configured criteria »
L'agent cherche `/var/lib/docker/containers/*/*-json.log` et n'a rien trouvé. Soit aucun conteneur de l'hôte n'utilise `json-file`, soit le montage `/var/lib/docker/containers` de l'agent (`-v /var/lib/docker/containers:/var/lib/docker/containers:ro`) est absent ou vide, soit l'agent tourne sur Docker Desktop pour macOS, dont les fichiers de conteneurs se trouvent dans sa VM Linux.
:::

:::details Les données arrivent sous le mauvais nom d'hôte
OneUptime identifie un hôte par `resource.host.name`, que l'agent tire de `DOCKER_HOST_NAME`. Changer `DOCKER_HOST_NAME` après les premières données crée un second hôte au lieu de renommer le premier, et un moniteur reste lié au nom avec lequel il a été créé.
:::

:::details Une alerte CPU ne se déclenche jamais
Regroupez la requête par `resource.container.name` et agrégez avec **Maximum**, comme le fait le modèle **High Container CPU Usage**. Une moyenne sur tous les conteneurs d'un hôte chargé est tirée vers le bas par les conteneurs inactifs. N'oubliez pas que 100 % correspond à un cœur complet, donc un conteneur autorisé à utiliser plusieurs cœurs a besoin d'un seuil plus élevé.
:::

:::details Le modèle de boucle de redémarrage ou de bridage a cessé d'alerter
Les deux mesurent de combien un compteur a augmenté entre deux mesures d'une même minute. Si le `collection_interval` de l'agent est de 60 secondes ou plus, chaque minute ne contient qu'une mesure, la croissance vaut toujours 0 et aucun des deux modèles ne se déclenche. Gardez la valeur par défaut de l'agent, 30 secondes.
:::

## Étapes suivantes

:::cards
- [Agent Docker](/docs/telemetry/docker-host): Installer, mettre à jour et dépanner l'agent que lit ce moniteur.
- [Surveillance Podman](/docs/monitor/podman-monitor): Le même moniteur pour les hôtes Podman.
- [Surveillance Docker Swarm](/docs/monitor/docker-swarm-monitor): Surveiller les tâches d'un cluster Swarm.
- [Vue d'ensemble des incidents](/docs/incidents/index): Ce qui se passe après qu'un critère a déclaré un incident.
:::
