# Envoyer des données de profilage continu à OneUptime

## Vue d'ensemble

Le profilage continu est le quatrième pilier de l'observabilité aux côtés des journaux, des métriques et des traces. Les profils capturent la façon dont votre application utilise le temps CPU, alloue la mémoire et utilise les ressources système au niveau des fonctions. OneUptime ingère les données de profilage via le protocole OpenTelemetry (OTLP) et les stocke aux côtés de vos autres signaux de télémétrie pour une analyse unifiée.

Avec les données de profilage dans OneUptime, vous pouvez identifier les fonctions gourmandes en CPU, détecter les fuites mémoire, trouver les goulots d'étranglement de contention et corréler les problèmes de performances avec des traces et spans spécifiques.

## Types de profils pris en charge

OneUptime prend en charge les types de profils suivants :

| Type de profil | Description                                                 | Unité        |
| -------------- | ----------------------------------------------------------- | ------------ |
| cpu            | Temps CPU consacré à l'exécution du code                    | nanosecondes |
| wall           | Temps d'horloge murale (inclut l'attente/la mise en veille) | nanosecondes |
| alloc_objects  | Nombre d'allocations de tas                                 | nombre       |
| alloc_space    | Octets de mémoire de tas alloués                            | octets       |
| goroutine      | Nombre de goroutines actives (Go)                           | nombre       |
| contention     | Temps passé à attendre sur des verrous/mutex                | nanosecondes |

## Démarrage

### Étape 1 - Créer un jeton d'ingestion de télémétrie

Après vous être inscrit à OneUptime et avoir créé un projet, cliquez sur « Plus » dans la barre de navigation et cliquez sur « Paramètres du projet ».

Sur la page des clés d'ingestion de télémétrie, cliquez sur « Créer une clé d'ingestion » pour créer un jeton.

![Créer un service](/docs/static/images/TelemetryIngestionKeys.png)

Une fois que vous avez créé un jeton, cliquez sur « Afficher » pour le visualiser.

![Afficher le service](/docs/static/images/TelemetryIngestionKeyView.png)

### Étape 2 - Configurer votre profileur

OneUptime accepte les données de profilage via gRPC et HTTP en utilisant le protocole de profils OTLP.

| Protocole | Point d'accès                                         |
| --------- | ----------------------------------------------------- |
| gRPC      | `votre-hôte-oneuptime:4317` (port gRPC standard OTLP) |
| HTTP      | `https://votre-hôte-oneuptime/otlp/v1/profiles`       |

**Variables d'environnement**

Définissez les variables d'environnement suivantes pour pointer votre profileur vers OneUptime :

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=VOTRE_JETON_SERVICE_ONEUPTIME
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=mon-service
```

**OneUptime auto-hébergé**

Si vous auto-hébergez OneUptime, remplacez le point d'accès par votre propre hôte (ex. : `http(s)://VOTRE-HÔTE-ONEUPTIME/otlp`). Pour gRPC, connectez-vous directement au port 4317 de votre hôte OneUptime.

## Guide d'instrumentation

### Utilisation de Grafana Alloy (profilage basé sur eBPF)

Grafana Alloy (anciennement Grafana Agent) peut collecter des profils CPU de tous les processus sur un hôte Linux en utilisant eBPF, sans aucune modification de code requise. Configurez-le pour exporter via OTLP vers OneUptime.

Exemple de configuration Alloy :

```hcl
pyroscope.ebpf "default" {
  forward_to = [pyroscope.write.oneuptime.receiver]
  targets    = discovery.process.all.targets
}

pyroscope.write "oneuptime" {
  endpoint {
    url = "https://oneuptime.com/pyroscope"
    headers = {
      "x-oneuptime-token" = "VOTRE_JETON_SERVICE_ONEUPTIME",
    }
  }
}
```

### Utilisation d'async-profiler (Java)

Pour les applications Java, utilisez [async-profiler](https://github.com/async-profiler/async-profiler) avec l'agent Java OpenTelemetry pour envoyer des données de profilage via OTLP.

```bash
# Démarrer votre application Java avec l'agent Java OpenTelemetry
java -javaagent:opentelemetry-javaagent.jar \
  -Dotel.exporter.otlp.endpoint=https://oneuptime.com/otlp \
  -Dotel.exporter.otlp.headers=x-oneuptime-token=VOTRE_JETON_SERVICE_ONEUPTIME \
  -Dotel.service.name=mon-service-java \
  -jar mon-app.jar
```

### Utilisation de Go pprof avec l'exportation OTLP

Pour les applications Go, vous pouvez utiliser le package standard `net/http/pprof` avec un exportateur OTLP. Configurez le profilage continu en collectant périodiquement des données pprof et en les transmettant à OneUptime.

```go
import (
    "runtime/pprof"
    "bytes"
    "time"
)

// Collecter un profil CPU de 30 secondes et exporter périodiquement
func collectProfile() {
    var buf bytes.Buffer
    pprof.StartCPUProfile(&buf)
    time.Sleep(30 * time.Second)
    pprof.StopCPUProfile()
    // Convertir la sortie pprof en format OTLP et envoyer à OneUptime
}
```

Alternativement, utilisez le collecteur OpenTelemetry avec un récepteur de profilage qui scrape le point d'accès `/debug/pprof` de votre application Go et exporte via OTLP.

### Utilisation de py-spy (Python)

Pour les applications Python, [py-spy](https://github.com/benfred/py-spy) peut capturer des profils CPU sans modification du code. Utilisez le collecteur OpenTelemetry pour recevoir et transmettre les données de profil.

```bash
# Capturer des profils et les envoyer à un collecteur OTLP local
py-spy record --format speedscope --pid $PID -o profile.json
```

Pour le profilage continu, exécutez py-spy aux côtés de votre application et configurez le collecteur OpenTelemetry pour ingérer et transmettre les profils à OneUptime.

## Utilisation du collecteur OpenTelemetry

Vous pouvez utiliser le collecteur OpenTelemetry comme proxy pour recevoir des profils de vos applications et les transmettre à OneUptime.

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "VOTRE_JETON_SERVICE_ONEUPTIME"

service:
  pipelines:
    profiles:
      receivers: [otlp]
      exporters: [otlphttp]
```

## Fonctionnalités

### Visualisation par flamegraph

OneUptime affiche les données de profil sous forme de flamegraphs interactifs. Chaque barre représente une fonction dans la pile d'appels, et sa largeur est proportionnelle au temps ou aux ressources consommées. Vous pouvez cliquer sur n'importe quelle fonction pour zoomer et voir ses appelants et ses appelés.

### Liste des fonctions

Affichez un tableau triable de toutes les fonctions capturées dans un profil, classées par temps propre, temps total ou nombre d'allocations. Cela vous aide à identifier rapidement les fonctions les plus coûteuses dans votre application.

### Corrélation avec les traces

Les profils dans OneUptime peuvent être corrélés avec des traces distribuées. Lorsqu'un profil inclut des ID de trace et de span (via la table de liens OTLP), vous pouvez naviguer directement depuis un span de trace lent vers le profil CPU ou mémoire correspondant pour comprendre exactement quel code s'exécutait.

### Filtrage par type de profil

Filtrez les profils par type (cpu, wall, alloc_objects, alloc_space, goroutine, contention) pour vous concentrer sur la dimension de ressource spécifique que vous examinez.

## Rétention des données

La rétention des données de profil est configurée par service de télémétrie dans les paramètres de votre projet OneUptime. La période de rétention par défaut est de 15 jours. Les données sont automatiquement supprimées après l'expiration de la période de rétention.

Pour modifier la période de rétention d'un service, accédez à **Télémétrie > Services > [Votre service] > Paramètres** et mettez à jour la valeur de rétention des données.

## Besoin d'aide ?

Veuillez contacter support@oneuptime.com si vous avez besoin d'aide pour configurer le profilage avec OneUptime.
