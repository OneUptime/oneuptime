# Collecteur OpenTelemetry sur l'hôte (Linux, macOS, Windows)

## Vue d'ensemble

Vous pouvez exécuter le **collecteur OpenTelemetry** en tant que service directement sur vos hôtes Linux, macOS ou Windows pour envoyer la télémétrie de l'hôte vers OneUptime via OTLP. Cette page vous guide à travers l'installation du collecteur, sa configuration pour chaque système d'exploitation et le choix des bons récepteurs en fonction de ce que vous souhaitez collecter :

- **Métriques de l'hôte** (CPU, mémoire, disque, système de fichiers, réseau, charge, processus) sur chaque système d'exploitation
- **Journaux basés sur des fichiers** sous `/var/log/**` (Linux, macOS) via le [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver)
- **journal systemd** (Linux) via le [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver)
- **Apple Unified Log** (macOS) via le [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor) qui encapsule une sortie `log stream` suivie
- **Journaux d'événements Windows** via le [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver)
- **État des services Windows** (alimente l'onglet **Services** de l'hôte) via le [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) — inclus dans la version `otelcol-contrib` en amont à partir de la **v0.155.0** (voir « Services Windows (métriques) » ci-dessous)

> **Qu'en est-il de l'agent d'infrastructure OneUptime ?** Cet agent est un démon Go séparé et léger, axé sur les métriques de base et la fonctionnalité _Server / VM Monitor_ (état, processus, alertes). Le collecteur OpenTelemetry décrit ici est indépendant et constitue l'outil approprié lorsque vous souhaitez ingérer des journaux (journaux de fichiers, journald, journaux d'événements Windows) ou des métriques d'hôte plus riches sous forme d'OTLP standard. Les deux peuvent fonctionner sur le même hôte sans interférer.

## Prérequis

- Un **jeton d'ingestion de télémétrie OneUptime** — créez-en un depuis _Project Settings → Telemetry Ingestion Keys_ et copiez la valeur `x-oneuptime-token`.
- La distribution **OpenTelemetry Collector Contrib** (`otelcol-contrib`). La version par défaut `otelcol` n'inclut **pas** de récepteurs comme `windowseventlogreceiver`, `journaldreceiver` ou les extras `hostmetrics` — assurez-vous d'utiliser la distribution `contrib`. Le récepteur alpha `windowsservicereceiver` qui alimente l'onglet **Services** de Windows est inclus dans `otelcol-contrib` à partir de la **v0.155.0**, installez donc une version récente ; voir « Services Windows (métriques) » ci-dessous.
- Un accès root / administrateur sur l'hôte pour installer le collecteur en tant que service et (le cas échéant) lire les sources de journaux privilégiées.

## Étape 1 — Installer le collecteur OpenTelemetry

Choisissez la section correspondant à votre système d'exploitation. Tous les exemples supposent que vous installez la dernière version `otelcol-contrib` depuis [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases).

### Linux (Debian / Ubuntu)

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.156.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

Le paquet Debian installe le binaire dans `/usr/bin/otelcol-contrib`, la configuration par défaut dans `/etc/otelcol-contrib/config.yaml` et une unité systemd dans `/etc/systemd/system/otelcol-contrib.service`.

### Linux (RHEL / CentOS / Fedora / Amazon Linux)

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.156.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

Les chemins correspondent à ceux du paquet Debian (`/usr/bin/otelcol-contrib`, `/etc/otelcol-contrib/config.yaml`, unité systemd `otelcol-contrib`).

### macOS

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/arm64/arm64/')
VERSION=0.156.0

curl -L -o otelcol-contrib.tar.gz \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_darwin_${ARCH}.tar.gz"

sudo mkdir -p /usr/local/otelcol-contrib
sudo tar -xzf otelcol-contrib.tar.gz -C /usr/local/otelcol-contrib
sudo ln -sf /usr/local/otelcol-contrib/otelcol-contrib /usr/local/bin/otelcol-contrib
sudo mkdir -p /etc/otelcol-contrib
```

Vous créerez `/etc/otelcol-contrib/config.yaml` à l'étape 2 et un fichier plist `launchd` à l'étape 3.

### Windows

Sous Windows, téléchargez la version **`otelcol-contrib`** en amont — elle intègre le récepteur `windows_service` qui alimente l'onglet **Services** de l'hôte (à partir de la **v0.155.0**). Depuis une invite PowerShell **avec privilèges élevés** :

```powershell
$VERSION = "0.156.0"                          # use v0.155.0 or later for the Services tab
$dest    = "C:\Program Files\otelcol-contrib"
$tar     = "$env:TEMP\otelcol-contrib.tar.gz"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
# amd64; use the _windows_arm64.tar.gz asset on ARM
Invoke-WebRequest -Uri "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$VERSION/otelcol-contrib_${VERSION}_windows_amd64.tar.gz" -OutFile $tar
tar -xf $tar -C $dest                          # tar.exe ships with Windows 10 1803+ / Server 2019+
```

Cela décompresse `otelcol-contrib.exe` dans `C:\Program Files\otelcol-contrib`. Vous créerez `config.yaml` dans le même dossier à l'étape 2 et enregistrerez un service Windows à l'étape 3.

> Vous préférez un installateur natif ? OpenTelemetry publie également un **`.msi`** signé (`otelcol-contrib_<version>_windows_x64.msi`) sur la même [page des versions](https://github.com/open-telemetry/opentelemetry-collector-releases/releases), qui enregistre le collecteur en tant que service Windows pour vous. Si vous l'utilisez, pointez-le vers le `config.yaml` de l'étape 2 et assurez-vous que le service s'exécute en tant que `LocalSystem` afin que l'onglet **Services** puisse lire le Service Control Manager.

## Étape 2 — Configurer le collecteur

Le fichier de configuration se trouve dans :

| Système d'exploitation | Chemin                                                |
| ---------------------- | ----------------------------------------------------- |
| Linux                  | `/etc/otelcol-contrib/config.yaml`                    |
| macOS                  | `/etc/otelcol-contrib/config.yaml`                    |
| Windows                | `C:\Program Files\otelcol-contrib\config.yaml` |

Chaque configuration suit la même structure — choisissez les récepteurs souhaités, ajoutez un processeur `batch` et `resource`, puis exportez vers OneUptime via OTLP HTTP. Les exemples ci-dessous présentent une configuration complète, prête à copier-coller, pour chaque système d'exploitation, puis détaillent chaque bloc de récepteur afin que vous puissiez les combiner à votre guise.

Remplacez `YOUR_TELEMETRY_INGESTION_TOKEN` et la valeur `service.name` pour les adapter à votre environnement.

### Éléments communs (utilisés par chaque système d'exploitation)

```yaml
processors:
  batch:
    send_batch_size: 512
    timeout: 5s

  resource:
    attributes:
      - key: service.name
        value: host-telemetry
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

- **`batch`** regroupe les enregistrements avant l'exportation afin que vous n'ayez pas à effectuer un aller-retour HTTP par enregistrement.
- **`resource`** estampille chaque enregistrement avec `service.name`. Utilisez une valeur différente par hôte (par exemple `prod-web-01`) si vous souhaitez que chaque machine apparaisse comme son propre service de télémétrie dans OneUptime.
- **`otlphttp`** envoie les données vers OneUptime via HTTPS avec le jeton d'ingestion joint.

### Métriques de l'hôte (Linux, macOS, Windows)

Fonctionne sur tous les systèmes d'exploitation. Récupère les métriques de CPU, mémoire, disque, système de fichiers, réseau, charge, pagination et processus depuis le noyau de l'hôte :

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:
      process:
        mute_process_name_error: true
```

> Sous Linux, le collecteur lit `/proc` et `/sys`. Lorsque le collecteur s'exécute dans un conteneur, montez les répertoires `/proc` et `/sys` de l'hôte et définissez les variables d'environnement `HOST_PROC` / `HOST_SYS`. Lorsqu'il s'exécute directement en tant que service systemd (comme installé ci-dessus), aucune configuration supplémentaire n'est nécessaire.

### Journaux de fichiers (Linux, macOS)

Suivez n'importe quel fichier journal sur le disque. Voici un ensemble de départ courant :

```yaml
receivers:
  filelog/syslog:
    include:
      - /var/log/syslog
      - /var/log/messages
    start_at: end

  filelog/auth:
    include:
      - /var/log/auth.log
      - /var/log/secure
    start_at: end
```

`start_at: end` signifie les nouvelles lignes à partir du moment où le collecteur démarre ; changez en `beginning` pour récupérer l'historique lors de la première exécution. Le collecteur suit les décalages des fichiers, il reprend donc correctement après les redémarrages.

**Transformer les traces de pile des journaux de l'hôte en exceptions.** OneUptime analyse automatiquement les lignes de journaux d'erreur et fatales à la recherche de traces de pile et les regroupe dans la vue **Exceptions** (Issues), attribuées à cet hôte — aucune configuration supplémentaire n'est nécessaire. Pour que le regroupement fonctionne bien, une trace de pile multiligne (Java, Python, .NET, Ruby) doit arriver comme **un seul** enregistrement de journal, et non un enregistrement par ligne. Activez la recombinaison multiligne sur le récepteur `filelog` afin qu'une trace et ses cadres restent ensemble :

```yaml
receivers:
  filelog/app:
    include:
      - /var/log/myapp/*.log
    start_at: end
    multiline:
      # A new log entry starts with a timestamp; continuation lines (the
      # "at ...", "File ...", "Caused by: ..." frames) are folded into it.
      line_start_pattern: '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}'
```

Sans recombinaison, chaque cadre est ingéré comme un journal distinct et l'exception apparaîtra comme un problème sur une seule ligne, mal regroupé. Si votre application peut émettre directement les attributs de journal OpenTelemetry `exception.type` / `exception.message` / `exception.stacktrace`, faites-le plutôt — c'est la voie la plus fiable et elle est indépendante de l'analyse multiligne.

### journal systemd (Linux)

Si votre hôte utilise systemd, le récepteur `journald` est souvent plus adapté que le suivi de `/var/log/*` — il capture tout au même endroit et préserve les champs structurés :

```yaml
receivers:
  journald:
    directory: /var/log/journal
    units:
      # Drop this list to ingest everything; restrict it to limit volume.
      - ssh.service
      - cron.service
      - nginx.service
    priority: info
```

Le binaire du collecteur doit pouvoir exécuter `journalctl` (les paquets Debian / RPM l'incluent déjà comme dépendance).

### Apple Unified Log (macOS)

macOS a déprécié `/var/log/system.log` au profit de l'Apple Unified Log, interrogé avec `log show` / `log stream`. Le moyen le plus simple de l'ingérer est de diffuser la sortie de `log` via le récepteur `filelog` avec un petit wrapper. Créez `/usr/local/otelcol-contrib/log-stream.sh` :

```bash
#!/bin/bash
exec /usr/bin/log stream --style ndjson --level info \
  --predicate 'subsystem != "com.apple.cfnetwork"' \
  >> /var/log/apple-unified.log
```

Rendez-le exécutable, lancez-le sous launchd (ou `nohup` pour un test rapide), puis pointez le collecteur vers le fichier :

```yaml
receivers:
  filelog/apple-unified:
    include:
      - /var/log/apple-unified.log
    start_at: end
    operators:
      - type: json_parser
        timestamp:
          parse_from: attributes.timestamp
          layout: "%Y-%m-%d %H:%M:%S.%f%j"
```

(Si vous n'avez pas besoin du journal unifié, ignorez cette étape — les parcs de Mac fonctionnent souvent très bien avec uniquement les métriques de l'hôte + quelques journaux de fichiers.)

### Journaux d'événements Windows

Abonnez-vous aux canaux qui vous intéressent via l'API native `wevtapi` :

```yaml
receivers:
  windowseventlog/system:
    channel: System
    start_at: end

  windowseventlog/application:
    channel: Application
    start_at: end

  windowseventlog/security:
    channel: Security
    start_at: end
```

Pour restreindre le canal `Security` à fort volume à des identifiants d'événements spécifiques :

```yaml
windowseventlog/security:
  channel: Security
  start_at: end
  query: "*[System[(EventID=4625 or EventID=4740)]]"
```

Pour lire un canal personnalisé ou spécifique à une application (tout ce que vous pouvez voir sous _Event Viewer → Applications and Services Logs_), utilisez son nom d'affichage exact :

```yaml
windowseventlog/iis:
  channel: Microsoft-IIS-Logging/Logs
  start_at: end
```

### Services Windows (métriques)

L'onglet **Services** de l'hôte est alimenté par le [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) (type de configuration `windows_service`), qui signale l'état d'exécution et le type de démarrage des services Windows sous forme de métriques.

**Ce récepteur est fourni dans le binaire `otelcol-contrib` en amont à partir de la v0.155.0** — sur les versions antérieures, l'ajout de `windows_service` échoue au démarrage avec `'receivers' unknown type: "windows_service"`. Installez une version récente (étape 1), puis activez-le dans votre `config.yaml` et ajoutez-le au pipeline de métriques :

```yaml
receivers:
  windows_service:
    collection_interval: 30s
    # Collect every service by default. To cut volume — and avoid the
    # "access denied" noise from services the collector can't open —
    # list just the ones you care about:
    # include_services: [Spooler, W3SVC, MSSQLSERVER]
    # Or collect everything except a few:
    # exclude_services: [TrustedInstaller]

service:
  pipelines:
    metrics:
      receivers: [hostmetrics, windows_service]
```

Le récepteur émet une jauge `windows.service.status` par service — l'entier correspond à l'état du service Win32 (`4` = en cours d'exécution, `1` = arrêté) — avec les attributs `name` et `startup_mode`. Exécutez le collecteur en tant que `LocalSystem` (la valeur par défaut de `sc.exe`) afin qu'il puisse lire tous les services ; ceux qu'il ne peut pas ouvrir sont ignorés. Le récepteur est en version **alpha** et **réservé à Windows** ; les problèmes connus incluent une erreur de scrape qui pourrait faire planter le collecteur et un `access denied` sur un service affectant les autres — restreignez avec `include_services` si vous les rencontrez.

> **`include_services` n'a aucun effet ?** Le filtre ne peut jamais que *restreindre* l'ensemble ; donc si vous répertoriez des services et que vous les voyez quand même tous, la configuration modifiée n'a presque certainement pas atteint le collecteur en cours d'exécution. Redémarrez le service après modification (étape 3) ; assurez-vous que `include_services` est une liste renseignée au même niveau d'indentation que `collection_interval` (et non laissée commentée ou vide) ; et laissez à l'onglet **Services** quelques minutes pour que les services signalés avant la modification disparaissent de sa fenêtre glissante. Les noms sont les noms de _clé_ de service Windows exacts et sensibles à la casse (par exemple `Spooler`, `W3SVC`), que vous pouvez lister avec `Get-Service | Select-Object Name`.

### Exemple complet — hôte Linux

`/etc/otelcol-contrib/config.yaml` :

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:

  filelog/syslog:
    include:
      - /var/log/syslog
      - /var/log/messages
      - /var/log/auth.log
    start_at: end

  journald:
    directory: /var/log/journal
    priority: info

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: service.name
        value: linux-host
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [resource, batch]
      exporters: [otlphttp]
    logs:
      receivers: [filelog/syslog, journald]
      processors: [resource, batch]
      exporters: [otlphttp]
```

### Exemple complet — hôte macOS

`/etc/otelcol-contrib/config.yaml` :

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:

  filelog/system:
    include:
      - /var/log/install.log
      - /var/log/wifi.log
    start_at: end

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: service.name
        value: macos-host
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [resource, batch]
      exporters: [otlphttp]
    logs:
      receivers: [filelog/system]
      processors: [resource, batch]
      exporters: [otlphttp]
```

### Exemple complet — hôte Windows

`C:\Program Files\otelcol-contrib\config.yaml` :

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      # On Windows the 'load' scraper only emulates an average from the
      # Processor Queue Length counter (it starts at 0) — omitted here.
      paging:
      processes:

  windowseventlog/system:
    channel: System
    start_at: end

  windowseventlog/application:
    channel: Application
    start_at: end

  windowseventlog/security:
    channel: Security
    start_at: end

  # Powers the Services tab (otelcol-contrib v0.155.0+).
  windows_service:
    collection_interval: 30s

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: service.name
        value: windows-host
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [hostmetrics, windows_service]
      processors: [resource, batch]
      exporters: [otlphttp]
    logs:
      receivers:
        - windowseventlog/system
        - windowseventlog/application
        - windowseventlog/security
      processors: [resource, batch]
      exporters: [otlphttp]
```

## Étape 3 — Exécuter le collecteur en tant que service

### Linux (systemd)

Les paquets Debian / RPM installent déjà une unité systemd. Il suffit de l'activer et de la démarrer :

```bash
sudo systemctl enable --now otelcol-contrib
sudo systemctl status otelcol-contrib
```

Pour suivre les propres journaux du collecteur :

```bash
sudo journalctl -u otelcol-contrib -f
```

### macOS (launchd)

Créez `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist` :

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.oneuptime.otelcol-contrib</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/otelcol-contrib</string>
    <string>--config=/etc/otelcol-contrib/config.yaml</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/var/log/otelcol-contrib.out.log</string>
  <key>StandardErrorPath</key><string>/var/log/otelcol-contrib.err.log</string>
</dict>
</plist>
```

Chargez-le :

```bash
sudo launchctl load -w /Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist
sudo launchctl list | grep otelcol-contrib
```

### Windows (Services)

Depuis une invite PowerShell **avec privilèges élevés** :

```powershell
sc.exe create "otelcol-contrib" `
  binPath= "\"C:\Program Files\otelcol-contrib\otelcol-contrib.exe\" --config=\"C:\Program Files\otelcol-contrib\config.yaml\"" `
  start= auto `
  DisplayName= "OpenTelemetry Collector (OneUptime)"

sc.exe description "otelcol-contrib" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "otelcol-contrib"
sc.exe query "otelcol-contrib"
```

Le service s'exécute par défaut sous `LocalSystem`, qui dispose des privilèges nécessaires pour lire le canal `Security` des journaux d'événements Windows et tous les services Windows.

## Étape 4 — Vérifier dans OneUptime

1. Générez un signal sur l'hôte :
   - **Linux / macOS :** `logger "hello from oneuptime"` (écrit dans syslog / journald).
   - **Windows :** `eventcreate /T INFORMATION /ID 999 /L APPLICATION /SO OneUptimeTest /D "hello from oneuptime"` depuis une invite avec privilèges élevés.
2. Dans le tableau de bord OneUptime, ouvrez **Telemetry → Services** et choisissez le `service.name` que vous avez configuré.
3. Ouvrez **Metrics** — les métriques de l'hôte (CPU, mémoire, système de fichiers, etc.) devraient apparaître en moins d'une minute.
4. Ouvrez **Logs** — vos journaux de fichiers / entrées journald / journaux d'événements Windows devraient arriver en flux continu. Les attributs utiles pour la recherche incluent `log.file.name`, `systemd.unit`, `winlog.channel`, `winlog.event_id` et `winlog.provider.name`.

## Réduire le volume de données collectées

Parce que vous êtes propriétaire de la configuration du collecteur, vous décidez exactement de ce qui quitte l'hôte — rien n'est collecté à moins qu'un récepteur que vous avez ajouté ne le demande. Si un hôte envoie plus que ce que vous souhaitez (ce qui se traduit par un volume d'ingestion plus élevé, et sur OneUptime Cloud, un coût plus élevé), ajustez-le ici. Les deux leviers les plus importants sont **les sources de journaux que vous suivez** et **la fréquence à laquelle vous collectez les métriques** ; un processeur `filter` gère le reste.

Le principe est le même que pour la configuration elle-même : **n'ajoutez que les récepteurs dont vous consulterez les données**, puis réduisez au sein de ceux-ci. Chaque modification ci-dessous est une modification de `config.yaml` — appliquez-la et redémarrez le collecteur (étape 3).

### D'où vient le volume

| Signal                        | Principal facteur                                        | Réduire avec                                                                          |
| ----------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Journaux**                  | Chaque ligne de chaque fichier / unité journald / canal  | Restreindre les récepteurs ; filtres `query:` ; un processeur `filter` sur la gravité |
| **Métriques de l'hôte**       | Fréquence de collecte × nombre de séries                 | `collection_interval` ; supprimer le scraper `process` ; sélection des scrapers       |
| **Cardinalité des métriques** | Métriques par processus (un jeu de séries par processus) | Omettre ou restreindre le scraper `process`                                           |

### Levier 1 — Ne suivez que les sources de journaux dont vous avez besoin

Les journaux constituent presque toujours la plus grande part. Le collecteur ne lit que ce que vous répertoriez, donc la solution consiste à répertorier moins :

- **Fichiers** — pointez `filelog` vers des chemins spécifiques, et non des globs larges. `/var/log/myapp/error.log` au lieu de `/var/log/**`.
- **journald** — restreignez `units:` aux services qui vous intéressent et augmentez `priority:` afin de supprimer les entrées `info`/`debug` bavardes à la source :

  ```yaml
  receivers:
    journald:
      directory: /var/log/journal
      units:
        - ssh.service
        - nginx.service
      priority: warning # info and debug are dropped before export
  ```

- **Journaux d'événements Windows** — le canal `Security` est de loin celui qui génère le plus de volume. Restreignez-le aux identifiants d'événements que vous auditez réellement avec un `query:` (comme indiqué dans [Journaux d'événements Windows](#journaux-dévénements-windows) ci-dessus), ou supprimez complètement le canal si vous n'en avez pas besoin.

### Levier 2 — Ralentissez l'intervalle des métriques

Le volume de `hostmetrics` évolue directement avec `collection_interval`. Si vous n'avez pas besoin d'une résolution de 30 secondes, 60s réduit de moitié le nombre de points de données :

```yaml
receivers:
  hostmetrics:
    collection_interval: 60s
```

### Levier 3 — Supprimez le scraper par processus (le facteur de cardinalité)

Le scraper `process` émet un jeu de séries distinct **pour chaque processus en cours d'exécution** sur l'hôte — sur une machine chargée, c'est la principale source de cardinalité des métriques. À moins que vous n'ayez besoin des métriques CPU/mémoire par processus, laissez-le en dehors de la liste `scrapers:`. Conservez `processes` (qui n'est qu'une poignée de métriques agrégées de comptage de processus) — c'est peu coûteux. Si vous souhaitez tout de même des métriques par processus, restreignez-les aux processus qui comptent :

```yaml
receivers:
  hostmetrics:
    collection_interval: 60s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes: # aggregate counts only — cheap
      # 'process:' (per-process series) intentionally omitted.
      # If you need it, scope it instead of collecting every process:
      # process:
      #   mute_process_name_error: true
      #   include:
      #     names: [nginx, postgres, node]
      #     match_type: strict
```

### Levier 4 — Supprimez les enregistrements de faible valeur avec un processeur `filter`

Lorsque vous voulez le récepteur mais pas la totalité de sa sortie, ajoutez un processeur [`filter`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/filterprocessor) — il évalue une condition [OTTL](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/README.md) et **supprime tout enregistrement qui correspond**, avant que quoi que ce soit ne soit exporté.

Supprimez les journaux en dessous d'un seuil de gravité :

```yaml
processors:
  filter/drop-low-severity:
    error_mode: ignore
    logs:
      log_record:
        # Drop anything less severe than WARN (info, debug, trace).
        # The UNSPECIFIED guard is required — see the warning below.
        - "severity_number != SEVERITY_NUMBER_UNSPECIFIED and severity_number < SEVERITY_NUMBER_WARN"
```

> **Ne supprimez pas la protection `UNSPECIFIED`.** `SEVERITY_NUMBER_UNSPECIFIED` vaut `0` et `SEVERITY_NUMBER_WARN` vaut `13` ; un simple `severity_number < SEVERITY_NUMBER_WARN` équivaut donc à `0 < 13` — **vrai pour chaque enregistrement dont la gravité n'a jamais été analysée**. Un récepteur `filelog` nu n'analyse pas la gravité depuis la ligne de journal : rien dans les exemples `filelog` de cette page ne définit `operators:`, de sorte que ces enregistrements arrivent au filtre avec `severity_number: 0`. Sans cette protection, cette condition supprime silencieusement **100 % de** `/var/log/syslog`, `/var/log/messages` et `/var/log/auth.log` — sans aucune erreur nulle part. Avec la protection, les enregistrements non classifiés sont conservés et vous les verrez arriver dans OneUptime avec la gravité `Unspecified`, ce qui vous indique que ce dont vous avez réellement besoin est un analyseur de gravité.

Pour filtrer les journaux de fichiers par gravité *correctement*, analysez d'abord une gravité avec un opérateur [`severity_parser`](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/stanza/docs/operators/severity_parser.md) sur le récepteur, afin que les enregistrements portent un véritable niveau avant d'atteindre le filtre :

```yaml
receivers:
  filelog/app:
    include:
      - /var/log/myapp/*.log
    start_at: end
    operators:
      # Pull a level out of lines like "2026-01-01 ERROR something broke".
      - type: regex_parser
        regex: '(?i)(?P<level>TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)'
        parse_from: body
        # Lines with no recognisable level fall through unparsed rather
        # than being discarded, and are then kept by the guard above.
        on_error: send
      - type: severity_parser
        parse_from: attributes.level
        preset: default
        mapping:
          warn: warning
          error: err
          fatal: panic
```

Sur les hôtes systemd, vous n'avez besoin de rien de tout cela — la `priority:` de `journald` (Levier 1) filtre par niveau dans `journalctl` lui-même, avant même qu'un enregistrement OTel n'existe.

Supprimez les métriques que vous ne visualisez pas — par nom exact, ou par motif :

```yaml
processors:
  filter/drop-metrics:
    error_mode: ignore
    metrics:
      metric:
        # Exact metric name.
        - 'name == "system.paging.faults"'
        # Or a whole family. IsMatch is RE2 and UNANCHORED, so anchor it
        # yourself with ^ when you mean "starts with".
        - 'IsMatch(name, "^system\\.paging\\.")'
```

N'envoyez **qu'**un ensemble fixe de métriques (une liste d'autorisation) en inversant la condition — `filter` supprime ce qui correspond, donc `not (...)` supprime tout ce que vous n'avez pas nommé :

```yaml
processors:
  filter/allowlist:
    error_mode: ignore
    metrics:
      metric:
        - 'not (name == "system.cpu.utilization" or name == "system.memory.utilization" or name == "system.filesystem.utilization")'
```

Gardez cette condition sur **une seule ligne**. Une liste d'autorisation est un outil brutal : tout ce que vous oubliez de nommer disparaît, en même temps que les moniteurs construits dessus. Préférez supprimer les quelques métriques dont vous ne voulez pas, ou simplement omettre le scraper qui les produit (Levier 3) — une métrique jamais collectée ne coûte rien à filtrer.

Ajoutez ensuite le processeur au pipeline concerné — l'ordre est important, alors placez `filter` avant `batch` :

```yaml
service:
  pipelines:
    logs:
      receivers: [journald]
      processors: [filter/drop-low-severity, resource, batch]
      exporters: [otlphttp]
    metrics:
      receivers: [hostmetrics]
      processors: [filter/drop-metrics, resource, batch]
      exporters: [otlphttp]
```

> **Vous modifiez la configuration générée pour vous par OneUptime ?** Le pipeline ci-dessus correspond aux exemples complets de cette page. La configuration issue du tableau de bord (Hosts → Documentation) nomme les choses différemment : ses processeurs sont `resourcedetection` et `batch` (il n'y a **pas** de processeur `resource`) et son exportateur est `otlphttp/oneuptime`. Référencer un processeur qui n'est pas défini arrête le collecteur au démarrage avec `references processor "resource" which is not configured`. Ajoutez le filtre à ce qui existe déjà plutôt que de coller ce bloc par-dessus :
>
> ```yaml
> service:
>   pipelines:
>     metrics:
>       receivers: [hostmetrics]
>       processors: [filter/drop-metrics, resourcedetection, batch]
>       exporters: [otlphttp/oneuptime]
> ```
>
> Conservez `resourcedetection` — OneUptime associe la télémétrie à un hôte à l'aide des `host.name` / `host.id` qu'il définit. Cette configuration générée est également **uniquement métriques** : elle n'a pas de pipeline `logs:` tant que vous n'en ajoutez pas un, de sorte qu'un `filter/drop-low-severity` n'a rien à filtrer tant que vous n'ajoutez pas un récepteur `filelog` ou `journald` à côté.

> **Sur macOS, utilisez l'archive tarball, pas Homebrew.** La formule Homebrew fournit le collecteur **core**, et `filter` est un processeur disponible uniquement dans contrib — le collecteur refusera de démarrer, que votre YAML soit correct ou non.

### Un point de départ minimal

Un hôte **uniquement métriques** — sans journaux, avec un intervalle grossier, sans séries par processus — constitue l'empreinte utile la plus réduite :

```yaml
receivers:
  hostmetrics:
    collection_interval: 60s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: service.name
        value: linux-host
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [resource, batch]
      exporters: [otlphttp]
```

Rajoutez un pipeline `logs` avec un récepteur `filelog` ou `journald` étroitement délimité lorsque vous en avez besoin.

> **Faites attention à ce que vous coupez.** Les alertes basées sur les journaux ont besoin que les journaux arrivent : si vous filtrez une gravité ou un canal, les moniteurs qui s'en servent deviennent silencieux. Réduisez les sources sur lesquelles vous n'agissez pas, pas celles qu'un moniteur surveille. Modifiez un levier à la fois et confirmez la baisse sous **Project Settings → Usage History** (l'utilisation est agrégée quotidiennement, alors laissez-lui un jour ou deux) avant de passer au suivant.

## OneUptime auto-hébergé

Si vous hébergez vous-même OneUptime, pointez l'exportateur vers votre propre hôte :

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

Si votre instance est en HTTP uniquement, remplacez le schéma par `http://` et utilisez le port approprié.

## Derrière un proxy

Le collecteur OpenTelemetry respecte les variables d'environnement standard `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`. Définissez-les sur le service :

- **systemd (Linux) :** ajoutez un fichier `/etc/systemd/system/otelcol-contrib.service.d/proxy.conf` avec `[Service]\nEnvironment="HTTPS_PROXY=http://proxy.example.com:3128"`, puis `sudo systemctl daemon-reload && sudo systemctl restart otelcol-contrib`.
- **launchd (macOS) :** ajoutez un dictionnaire `<EnvironmentVariables>` au fichier plist.
- **Service Windows :** définissez les variables d'environnement sur le service via `sc.exe config` ou le registre sous `HKLM\SYSTEM\CurrentControlSet\Services\otelcol-contrib\Environment`.

## Dépannage

- **Aucune télémétrie n'apparaît dans OneUptime**
  - Ajoutez `service.telemetry.logs.level: debug` à la configuration et redémarrez le collecteur pour obtenir une sortie détaillée.
  - **Linux / macOS :** `journalctl -u otelcol-contrib -f` (Linux) ou `tail -f /var/log/otelcol-contrib.err.log` (macOS).
  - **Windows :** consultez _Event Viewer → Windows Logs → Application_ pour la source `otelcol-contrib`.
  - Confirmez que l'hôte peut atteindre `https://oneuptime.com/otlp` (ou votre point de terminaison auto-hébergé) : `curl -v https://oneuptime.com/otlp` depuis la même machine.
- **HTTP 401 de l'exportateur** — le jeton d'ingestion est invalide ou révoqué. Générez-en un nouveau depuis _Project Settings → Telemetry Ingestion Keys_.
- **Le canal `Security` des journaux d'événements Windows renvoie une erreur d'accès refusé** — le service ne s'exécute pas avec des privilèges suffisants. Recréez-le sous `LocalSystem` (la valeur par défaut avec `sc.exe create`) ou accordez au compte de service le droit utilisateur _Manage auditing and security log_.
- **Le récepteur `journald` ne démarre pas** — assurez-vous que `journalctl` se trouve dans le `PATH` du collecteur et que `/var/log/journal` existe (exécutez `sudo systemd-tmpfiles --create --prefix /var/log/journal` si ce n'est pas le cas).
- **Volume / coût élevé** — voir [Réduire le volume de données collectées](#réduire-le-volume-de-données-collectées) : restreignez les récepteurs (canaux Windows spécifiques, unités systemd, fichiers journaux), augmentez le `collection_interval` des métriques, supprimez le scraper par processus, ou ajoutez un processeur `filter` pour supprimer les enregistrements de faible gravité avant l'exportation.

## Étapes suivantes

- Ajoutez des **moniteurs de journaux** pour alerter sur des modèles de journaux spécifiques (par exemple, alerter lorsque plus de 5 connexions échouées `winlog.event_id = 4625` se produisent dans une fenêtre de 5 minutes).
- Ajoutez des **moniteurs de métriques** sur les métriques de l'hôte (saturation CPU, espace disque faible, utilisation du swap).
- Combinez ceci avec le [Server / VM Monitor](/docs/monitor/server-monitor) et l'[agent d'infrastructure OneUptime](/docs/monitor/server-monitor) pour une visibilité de bout en bout sur l'hôte.
- Déployez la même configuration sur chaque hôte via Ansible / Chef / Puppet / Group Policy / Intune / votre outil de gestion de configuration existant.
