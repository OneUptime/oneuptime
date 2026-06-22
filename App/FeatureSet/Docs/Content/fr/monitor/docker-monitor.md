# Moniteur Docker

La surveillance Docker vous permet de surveiller la santé et les performances de vos hôtes Docker ainsi que des conteneurs qui y sont exécutés. OneUptime collecte des métriques et des journaux de conteneurs via un collecteur OpenTelemetry préconfiguré (l'**agent Docker OneUptime**) et les évalue en fonction de vos critères configurés.

## Vue d'ensemble

Les moniteurs Docker utilisent les métriques et les journaux de vos hôtes pour offrir une visibilité sur vos charges de travail de conteneurs. Cela vous permet de :

- Surveiller la santé de l'hôte Docker et de chaque conteneur
- Suivre le CPU, la mémoire, le réseau, les E/S de blocs et le nombre de processus par conteneur
- Détecter les redémarrages, les pannes et la limitation CPU des conteneurs
- Transmettre les journaux structurés des conteneurs au format natif OpenTelemetry
- Alerter sur les CPU élevés, la mémoire élevée, les boucles de redémarrage, et plus encore

## Création d'un moniteur Docker

1. Allez dans **Moniteurs** dans le tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **Docker** comme type de moniteur
4. Sélectionnez l'hôte Docker et la portée de ressources à surveiller
5. Configurez les requêtes de métriques et l'agrégation
6. Configurez les critères de surveillance selon vos besoins

## Options de configuration

### Hôte Docker

Sélectionnez l'hôte Docker à surveiller. Les hôtes sont automatiquement enregistrés la première fois que l'agent Docker OneUptime leur transmet des données de télémétrie — il n'est pas nécessaire de les créer manuellement.

### Portée de la ressource

Choisissez le niveau auquel surveiller les ressources :

| Portée    | Description                                                            |
| --------- | ---------------------------------------------------------------------- |
| Hôte      | Surveiller l'ensemble de l'hôte Docker, agrégé sur tous les conteneurs |
| Conteneur | Surveiller un conteneur spécifique par nom ou image                    |

### Requêtes de métriques

Configurez une ou plusieurs requêtes de métriques à évaluer. Chaque requête spécifie :

- **Nom de la métrique** — La métrique du conteneur à interroger
- **Agrégation** — Comment agréger les valeurs des métriques (Moy, Somme, Max, Min)
- **Filtres** — Filtrage supplémentaire basé sur les attributs (ex. : par nom de conteneur, image ou hôte)
- **Regrouper par** — Optionnellement regrouper par `resource.container.name` afin que chaque conteneur soit évalué indépendamment

Vous pouvez également créer des **formules** qui combinent plusieurs requêtes de métriques à l'aide d'expressions mathématiques.

### Fenêtre temporelle glissante

Sélectionnez la fenêtre temporelle pour l'évaluation des métriques :

- 1 dernière minute
- 5 dernières minutes
- 10 dernières minutes
- 15 dernières minutes
- 30 dernières minutes
- 60 dernières minutes

## Métriques collectées

L'agent Docker utilise le récepteur `docker_stats` d'OpenTelemetry, qui interroge l'API Docker Engine à un intervalle configurable (par défaut toutes les 30 secondes).

### CPU

| Métrique                                          | Description                                                    |
| ------------------------------------------------- | -------------------------------------------------------------- |
| `container.cpu.utilization`                       | Utilisation CPU en pourcentage du CPU hôte                     |
| `container.cpu.usage.total`                       | Temps CPU cumulatif consommé par le conteneur                  |
| `container.cpu.throttling_data.throttled_time`    | Temps pendant lequel le conteneur a été limité par les cgroups |
| `container.cpu.throttling_data.throttled_periods` | Nombre de périodes de limitation                               |

### Mémoire

| Métrique                       | Description                                     |
| ------------------------------ | ----------------------------------------------- |
| `container.memory.usage.total` | Utilisation mémoire actuelle en octets          |
| `container.memory.usage.limit` | Limite de mémoire en octets                     |
| `container.memory.percent`     | Utilisation mémoire en pourcentage de la limite |

### Réseau

| Métrique                              | Description               |
| ------------------------------------- | ------------------------- |
| `container.network.io.usage.rx_bytes` | Total des octets reçus    |
| `container.network.io.usage.tx_bytes` | Total des octets transmis |

### E/S de blocs

| Métrique                                             | Description                                  |
| ---------------------------------------------------- | -------------------------------------------- |
| `container.blockio.io_service_bytes_recursive.read`  | Octets lus depuis les périphériques de blocs |
| `container.blockio.io_service_bytes_recursive.write` | Octets écrits sur les périphériques de blocs |

### Informations sur le conteneur

| Métrique               | Description                                      |
| ---------------------- | ------------------------------------------------ |
| `container.uptime`     | Durée de fonctionnement du conteneur en secondes |
| `container.restarts`   | Nombre de fois que le conteneur a redémarré      |
| `container.pids.count` | Nombre de processus à l'intérieur du conteneur   |

## Critères de surveillance

### Types de vérifications disponibles

| Type de vérification | Description                                               |
| -------------------- | --------------------------------------------------------- |
| Valeur de métrique   | La valeur de la requête de métrique ou formule configurée |

### Types d'agrégation

| Agrégation              | Description                                          |
| ----------------------- | ---------------------------------------------------- |
| Moyenne                 | Valeur moyenne sur la fenêtre temporelle             |
| Somme                   | Somme de toutes les valeurs                          |
| Valeur maximale         | Valeur la plus élevée dans la fenêtre temporelle     |
| Valeur minimale         | Valeur la plus basse dans la fenêtre temporelle      |
| Toutes les valeurs      | Toutes les valeurs doivent correspondre aux critères |
| N'importe quelle valeur | Au moins une valeur doit correspondre                |

### Types de filtres

- **Supérieur à**, **Inférieur à**, **Supérieur ou égal à**, **Inférieur ou égal à**, **Égal à**, **Différent de**

## Modèles d'alertes préconfigurés

OneUptime fournit des modèles pour les scénarios courants de surveillance Docker :

| Modèle                             | Description                                            | Seuil | Agrégation          |
| ---------------------------------- | ------------------------------------------------------ | ----- | ------------------- |
| CPU de conteneur élevé             | Utilisation CPU par conteneur                          | > 90% | Max (par conteneur) |
| Mémoire de conteneur élevée        | Utilisation mémoire en pourcentage de la limite        | > 85% | Max (par conteneur) |
| Limitation CPU élevée              | Périodes de limitation CPU                             | > 0   | Max (par conteneur) |
| Boucle de redémarrage de conteneur | Nombre de redémarrages du conteneur                    | > 3   | Somme               |
| Conteneur hors ligne               | Durée de fonctionnement du conteneur réinitialisée à 0 | = 0   | Min                 |

> Remarque : Les modèles CPU, mémoire et limitation utilisent l'agrégation **Max** groupée par `resource.container.name`. Cela évite que le signal d'un conteneur surchargé soit dilué par de nombreux conteneurs inactifs sur le même hôte.

## Journaux collectés

En plus des métriques, l'agent Docker suit le fichier `*-json.log` de chaque conteneur via le récepteur filelog d'OpenTelemetry et transmet les enregistrements de journaux au format OTLP natif. Chaque enregistrement de journal est enrichi avec :

- `resource.host.name` — l'identifiant de l'hôte Docker
- `resource.container.id` — l'identifiant complet du conteneur
- `resource.container.runtime` — toujours `docker`
- `attributes["log.iostream"]` — `stdout` ou `stderr`
- `severityText` / `severityNumber` — dérivés du flux : `stderr` → `ERROR`, `stdout` → `INFO`
- `body` — la ligne de journal brute émise par le processus du conteneur
- `time` — l'horodatage du démon Docker pour la ligne

Les journaux apparaissent dans l'onglet **Journaux** de l'hôte Docker et sur la page de détail de chaque conteneur.

### Exigence relative au pilote de journalisation

**L'agent Docker n'ingère des journaux que des conteneurs utilisant le pilote de journalisation `json-file` de Docker.** Il s'agit du pilote par défaut de Docker, mais il peut être remplacé par conteneur ou globalement :

- Pilote **`local`** — écrit des blocs protobuf binaires dans `/var/lib/docker/containers/<id>/local-logs/container.log`. Le récepteur filelog ne peut pas analyser ce format.
- **`journald`**, **`syslog`**, **`fluentd`**, **`gelf`**, **`awslogs`**, **`splunk`**, etc. — envoient les journaux vers une destination distante ; pas de fichier à suivre.
- **`none`** — supprime les journaux entièrement.

Si l'un des éléments ci-dessus est utilisé, vous verrez des métriques sur la page de l'hôte Docker mais l'onglet **Journaux** sera vide (ou ne contiendra que les propres journaux de l'agent Docker).

**Vérifier le pilote de journalisation d'un conteneur spécifique :**

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

**Vérifier le pilote par défaut du démon :**

```bash
docker info --format '{{.LoggingDriver}}'
```

**Passer un service Docker Compose à `json-file` avec une rotation raisonnable :**

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

**Changer le pilote par défaut du démon** (s'applique à chaque conteneur créé par la suite) en modifiant `/etc/docker/daemon.json` :

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

Redémarrez ensuite le démon Docker et **recréez** les conteneurs affectés. Docker lie le pilote de journalisation au moment de la création du conteneur, donc un conteneur existant conserve son ancien pilote jusqu'à ce qu'il soit supprimé et recréé :

```bash
# Docker Compose
docker compose up -d --force-recreate <service>

# Docker simple
docker rm -f <container>
docker run ... <image>
```

## Prérequis d'installation

Pour utiliser la surveillance Docker, vous devez :

1. Installer l'agent Docker OneUptime sur chaque hôte Docker que vous souhaitez surveiller
2. Passer `ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN` et `DOCKER_HOST_NAME` comme variables d'environnement
3. S'assurer que les conteneurs que vous souhaitez observer utilisent le pilote de journalisation `json-file` (voir ci-dessus)

L'agent est publié sous le nom `oneuptime/docker-agent:release` sur Docker Hub. Consultez le [guide d'installation de l'agent Docker](https://github.com/OneUptime/oneuptime/tree/master/DockerAgent) pour les exemples complets `docker run` et `docker compose`.

## Dépannage

### Les métriques s'affichent mais l'onglet Journaux est vide

Vos conteneurs n'utilisent presque certainement pas le pilote de journalisation `json-file`. Exécutez les commandes de diagnostic dans la section [Exigence relative au pilote de journalisation](#exigence-relative-au-pilote-de-journalisation) ci-dessus et changez les conteneurs qui ont besoin de transmettre leurs journaux.

### Le récepteur filelog journalise `no files match the configured criteria`

Cela signifie que le glob d'inclusion `/var/lib/docker/containers/*/*-json.log` n'a correspondu à aucun fichier au démarrage de l'agent. Soit :

1. Aucun conteneur sur cet hôte n'utilise `json-file`, soit
2. Le montage bind `-v /var/lib/docker/containers:/var/lib/docker/containers:ro` est absent ou pointe vers un répertoire vide, soit
3. L'agent s'exécute sur Docker Desktop pour macOS sans que le répertoire de conteneurs de la VM Linux soit exposé.

### Les journaux arrivent mais sont regroupés sous le mauvais nom d'hôte

OneUptime enregistre automatiquement les hôtes Docker par `resource.host.name`, qui est extrait de la variable d'environnement `DOCKER_HOST_NAME`. Modifier `DOCKER_HOST_NAME` après le premier lot de télémétrie créera une deuxième ligne d'hôte plutôt que de renommer celle existante.

### Les incidents ne se déclenchent pas pour "CPU élevé"

Assurez-vous que l'agrégation de la requête de métrique est **Max** (pas Moy) et qu'elle regroupe par `resource.container.name`. Une Moy sur tous les conteneurs d'un hôte occupé est diluée par les conteneurs inactifs et dépasse rarement le seuil.
