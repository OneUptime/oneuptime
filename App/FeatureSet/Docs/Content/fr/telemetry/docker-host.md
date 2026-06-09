# Agent Docker OneUptime

## Vue d'ensemble

L'agent Docker OneUptime est une image de conteneur préconstruite qui est livrée avec une configuration OpenTelemetry Collector optimisée. Exécutez-le à côté de vos conteneurs existants et il découvre automatiquement chaque conteneur sur l'hôte, collecte les métriques de CPU / mémoire / réseau / E/S de bloc ainsi que les journaux des conteneurs, et transmet le tout à OneUptime via OTLP. Une seule image, une seule commande.

Cette page est le **guide d'installation**. Pour configurer les moniteurs et les alertes Docker au-dessus des données collectées par l'agent, consultez [Moniteur Docker](/docs/monitor/docker-monitor).

## Prérequis

- Docker Engine 20.10+
- Accès à `/var/run/docker.sock` sur l'hôte
- Un **jeton d'ingestion de télémétrie OneUptime** — créez-en un depuis *Project Settings → Telemetry Ingestion Keys* et copiez la valeur

## Démarrage rapide (une seule commande)

Remplacez `YOUR_ONEUPTIME_URL`, `YOUR_TELEMETRY_INGESTION_TOKEN` et le nom d'hôte par les valeurs correspondant à votre environnement. Le nom d'hôte détermine la façon dont cet hôte Docker apparaîtra dans OneUptime — choisissez quelque chose comme `prod-docker-01`.

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

C'est tout. Une fois que l'agent se connecte, votre hôte Docker apparaîtra automatiquement dans la section **Docker** du tableau de bord OneUptime.

## Alternative — Docker Compose

Si vous préférez Docker Compose, insérez ce qui suit dans un fichier `docker-compose.yml` :

```yaml
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
```

Démarrez-le :

```bash
docker compose up -d
```

## Variables d'environnement

| Variable | Requis | Description |
|----------|----------|-------------|
| `ONEUPTIME_URL` | Oui | L'URL de votre instance OneUptime (par exemple `https://oneuptime.com` ou votre hôte auto-hébergé) |
| `ONEUPTIME_SERVICE_TOKEN` | Oui | Jeton d'ingestion de télémétrie depuis *Project Settings → Telemetry Ingestion Keys* |
| `DOCKER_HOST_NAME` | Non | Nom convivial pour cet hôte. La valeur par défaut est `docker-host`. Définissez-le sur une valeur stable par hôte (par exemple `prod-docker-01`) |

## Vérifier l'installation

Vérifiez que l'agent est en cours d'exécution :

```bash
docker ps --filter name=oneuptime-docker-agent
```

Consultez les journaux de l'agent :

```bash
docker logs -f oneuptime-docker-agent
```

Recherchez : `"Everything is ready. Begin running and processing data."`

En une minute environ, l'hôte devrait apparaître dans le tableau de bord OneUptime avec les métriques et les journaux qui circulent.

## Mettre à niveau l'agent

```bash
docker pull oneuptime/docker-agent:release
docker rm -f oneuptime-docker-agent
# Re-run the `docker run` command above
```

Ou avec Docker Compose :

```bash
docker compose pull
docker compose up -d
```

## Désinstaller l'agent

```bash
docker rm -f oneuptime-docker-agent
```

Si vous avez utilisé Docker Compose :

```bash
docker compose down
```

## Ce qui est collecté

| Catégorie | Données |
|----------|------|
| **Métriques CPU** | Utilisation totale, pourcentage d'utilisation, temps de limitation (par conteneur) |
| **Métriques de mémoire** | Utilisation, limite, pourcentage, RSS, cache (par conteneur) |
| **Métriques réseau** | Octets et paquets reçus / transmis (par conteneur) |
| **Métriques d'E/S de bloc** | Octets et opérations de lecture / écriture (par conteneur) |
| **Informations sur le conteneur** | Temps de fonctionnement, nombre de redémarrages, nombre de processus |
| **Journaux des conteneurs** | Journaux stdout / stderr de tous les conteneurs |

## OneUptime auto-hébergé

Si vous auto-hébergez OneUptime, définissez `ONEUPTIME_URL` sur votre propre instance :

```bash
-e ONEUPTIME_URL="https://your-oneuptime-host.example.com"
```

Si votre instance est en HTTP uniquement, utilisez `http://` et le port approprié.

## Dépannage

### Permission refusée pour le socket Docker

Le conteneur de l'agent doit s'exécuter en tant que root (`--user 0:0`) pour accéder à `/var/run/docker.sock`. Assurez-vous que l'indicateur `--user 0:0` (ou `user: "0:0"` dans Compose) est présent.

### L'agent s'affiche comme déconnecté

1. Vérifiez que l'agent est en cours d'exécution : `docker ps --filter name=oneuptime-docker-agent`
2. Consultez les journaux de l'agent : `docker logs oneuptime-docker-agent | grep -i error`
3. Vérifiez que votre URL OneUptime et votre jeton de service sont corrects
4. Assurez-vous que votre hôte Docker peut atteindre l'instance OneUptime via le réseau

### Aucune métrique n'apparaît

1. Vérifiez que le socket Docker est accessible à l'intérieur de l'agent : `docker exec oneuptime-docker-agent ls -la /var/run/docker.sock`
2. Consultez les journaux du collecteur pour détecter les erreurs d'exportation : `docker logs oneuptime-docker-agent | tail -100`
3. Assurez-vous que votre jeton de service est valide et non expiré

### Le nom d'hôte s'affiche comme un ID de conteneur

Définissez la variable d'environnement `DOCKER_HOST_NAME` sur un nom convivial et recréez le conteneur.

## Étapes suivantes

- Configurez des **moniteurs Docker** pour alerter sur les conditions de CPU / mémoire / redémarrage des conteneurs — consultez [Moniteur Docker](/docs/monitor/docker-monitor).
- Pour les clusters Kubernetes au lieu d'hôtes Docker autonomes, utilisez l'[agent Kubernetes OneUptime](/docs/telemetry/kubernetes-agent).
- Pour les hôtes non conteneurisés (VM Linux / macOS / Windows et matériel physique), utilisez le [collecteur OpenTelemetry hôte](/docs/telemetry/host-otel-collector).
