# Utiliser Fluentd pour envoyer des données de télémétrie à OneUptime

## Vue d'ensemble

Vous pouvez utiliser le plugin [Fluentd](https://www.fluentd.org/) pour collecter des journaux et des données de télémétrie depuis vos applications et services. Le plugin envoie les données de télémétrie à la source HTTP OneUptime. Vous pouvez utiliser le plugin de sortie http de fluentd pour envoyer les données de télémétrie à la source HTTP OneUptime. Ce plugin peut être trouvé ici : https://docs.fluentd.org/output/http

## Démarrage

Fluentd prend en charge des centaines de sources de données et vous pouvez ingérer des journaux depuis n'importe laquelle de ces sources dans OneUptime. Parmi les sources populaires, on trouve :

- Docker
- Syslog
- Apache
- Nginx
- MySQL
- PostgreSQL
- MongoDB
- NodeJS
- Ruby
- Python
- Java
- PHP
- Go
- Rust

et bien d'autres.

Vous pouvez trouver la liste complète des sources prises en charge [ici](https://www.fluentd.org/datasources)

## Prérequis

- **Étape 1 : Installer Fluentd sur votre système** — Vous pouvez installer Fluentd en suivant les instructions fournies [ici](https://docs.fluentd.org/installation)
- **Étape 2 : Créer un compte OneUptime** — Vous pouvez créer un compte gratuit [ici](https://oneuptime.com). Veuillez noter que si le compte est gratuit, l'ingestion de journaux est une fonctionnalité payante. Vous pouvez trouver plus de détails sur la tarification [ici](https://oneuptime.com/pricing).
- **Étape 3 : Créer un projet OneUptime** — Une fois que vous avez le compte, vous pouvez créer un projet depuis le tableau de bord OneUptime. Si vous avez besoin d'aide pour créer un projet ou si vous avez des questions, veuillez nous contacter à support@oneuptime.com
- **Étape 4 : Créer un jeton d'ingestion de télémétrie** — Une fois que vous avez créé un compte OneUptime, vous pouvez créer un jeton d'ingestion de télémétrie pour ingérer des journaux, des métriques et des traces depuis votre application.

Après vous être inscrit à OneUptime et avoir créé un projet. Cliquez sur « Plus » dans la barre de navigation et cliquez sur « Paramètres du projet ».

Sur la page des clés d'ingestion de télémétrie, cliquez sur « Créer une clé d'ingestion » pour créer un jeton.

![Créer un service](/docs/static/images/TelemetryIngestionKeys.png)

Une fois que vous avez créé un jeton, cliquez sur « Afficher » pour le visualiser.

![Afficher le service](/docs/static/images/TelemetryIngestionKeyView.png)


## Configuration

Vous pouvez utiliser la configuration suivante pour envoyer les données de télémétrie à la source HTTP OneUptime. Vous pouvez ajouter cette configuration au fichier de configuration de fluentd. Le fichier de configuration se trouve généralement à `/etc/fluentd/fluent.conf` ou `/etc/td-agent/td-agent.conf`.

Vous devez remplacer `YOUR_SERVICE_TOKEN` par le jeton que vous avez créé à l'étape précédente. Vous devez également remplacer `YOUR_SERVICE_NAME` par le nom de votre service. Le nom du service peut être n'importe quel nom que vous souhaitez. Si le service n'existe pas dans OneUptime, il sera créé automatiquement.

```yaml
# Correspondre à tous les motifs 
<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  <format>
    @type json
  </format>
  <buffer>
    flush_interval 10s
  </buffer>
</match>
```


Un exemple de fichier de configuration complet est présenté ci-dessous :

```yaml
####
## Descriptions des sources :
##

## Entrée TCP intégrée
## @see https://docs.fluentd.org/input/forward
<source>
  @type forward
  port 24224
  bind 0.0.0.0
</source>

<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  <format>
    @type json
  </format>
  <buffer>
    flush_interval 10s
  </buffer>
</match>
```

**Si vous auto-hébergez OneUptime** : Si vous auto-hébergez OneUptime, vous pouvez remplacer l'`endpoint_url` par l'URL de votre instance OneUptime. `http(s)://VOTRE_HÔTE_ONEUPTIME/fluentd/logs`

## Utilisation

Une fois que vous avez ajouté la configuration au fichier de configuration de fluentd, vous pouvez redémarrer le service fluentd. Une fois le service redémarré, les données de télémétrie seront envoyées à la source HTTP OneUptime. Vous pouvez maintenant commencer à voir les données de télémétrie dans le tableau de bord OneUptime. Si vous avez des questions ou avez besoin d'aide pour la configuration, veuillez nous contacter à support@oneuptime.com
