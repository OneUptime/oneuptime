# Collecteur OpenTelemetry sur l'hôte (Linux, macOS, Windows)

## Vue d'ensemble

Vous pouvez exécuter le **collecteur OpenTelemetry** en tant que service directement sur vos hôtes Linux, macOS ou Windows pour envoyer la télémétrie de l'hôte vers OneUptime via OTLP. Cette page vous guide à travers l'installation du collecteur, sa configuration pour chaque système d'exploitation et le choix des bons récepteurs en fonction de ce que vous souhaitez collecter :

- **Métriques de l'hôte** (CPU, mémoire, disque, système de fichiers, réseau, charge, processus) sur chaque système d'exploitation
- **Journaux basés sur des fichiers** sous `/var/log/**` (Linux, macOS) via le [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver)
- **journal systemd** (Linux) via le [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver)
- **Apple Unified Log** (macOS) via le [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor) qui encapsule une sortie `log stream` suivie
- **Journaux d'événements Windows** via le [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver)
- **État des services Windows** (alimente l'onglet **Services** de l'hôte) via le [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) — *pas inclus dans le collecteur précompilé en amont ; utilisez le **OneUptime Host Collector** précompilé ou une compilation personnalisée (voir « Services Windows (métriques) » ci-dessous)*

> **Qu'en est-il de l'agent d'infrastructure OneUptime ?** Cet agent est un démon Go séparé et léger, axé sur les métriques de base et la fonctionnalité *Server / VM Monitor* (état, processus, alertes). Le collecteur OpenTelemetry décrit ici est indépendant et constitue l'outil approprié lorsque vous souhaitez ingérer des journaux (journaux de fichiers, journald, journaux d'événements Windows) ou des métriques d'hôte plus riches sous forme d'OTLP standard. Les deux peuvent fonctionner sur le même hôte sans interférer.

## Prérequis

- Un **jeton d'ingestion de télémétrie OneUptime** — créez-en un depuis *Project Settings → Telemetry Ingestion Keys* et copiez la valeur `x-oneuptime-token`.
- La distribution **OpenTelemetry Collector Contrib** (`otelcol-contrib`). La version par défaut `otelcol` n'inclut **pas** de récepteurs comme `windowseventlogreceiver`, `journaldreceiver` ou les extras `hostmetrics` — assurez-vous d'utiliser la distribution `contrib`. Une exception à connaître d'emblée : le récepteur alpha `windowsservicereceiver` (qui alimente l'onglet **Services** de Windows) n'est **pas** inclus dans le binaire `contrib` précompilé en amont — utilisez le **OneUptime Host Collector** précompilé (qui l'inclut) ou compilez le vôtre ; voir « Services Windows (métriques) » ci-dessous.
- Un accès root / administrateur sur l'hôte pour installer le collecteur en tant que service et (le cas échéant) lire les sources de journaux privilégiées.

## Étape 1 — Installer le collecteur OpenTelemetry

Choisissez la section correspondant à votre système d'exploitation. Tous les exemples supposent que vous installez la dernière version `otelcol-contrib` depuis [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases).

### Linux (Debian / Ubuntu)

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.154.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

Le paquet Debian installe le binaire dans `/usr/bin/otelcol-contrib`, la configuration par défaut dans `/etc/otelcol-contrib/config.yaml` et une unité systemd dans `/etc/systemd/system/otelcol-contrib.service`.

### Linux (RHEL / CentOS / Fedora / Amazon Linux)

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.154.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

Les chemins correspondent à ceux du paquet Debian (`/usr/bin/otelcol-contrib`, `/etc/otelcol-contrib/config.yaml`, unité systemd `otelcol-contrib`).

### macOS

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/arm64/arm64/')
VERSION=0.154.0

curl -L -o otelcol-contrib.tar.gz \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_darwin_${ARCH}.tar.gz"

sudo mkdir -p /usr/local/otelcol-contrib
sudo tar -xzf otelcol-contrib.tar.gz -C /usr/local/otelcol-contrib
sudo ln -sf /usr/local/otelcol-contrib/otelcol-contrib /usr/local/bin/otelcol-contrib
sudo mkdir -p /etc/otelcol-contrib
```

Vous créerez `/etc/otelcol-contrib/config.yaml` à l'étape 2 et un fichier plist `launchd` à l'étape 3.

### Windows

Sous Windows, installez le **OneUptime Host Collector** — le collecteur précompilé de OneUptime qui intègre le récepteur `windows_service` (qui alimente l'onglet **Services** de l'hôte et qui n'est *pas* présent dans la version `otelcol-contrib` en amont). Depuis une invite PowerShell **avec privilèges élevés** :

```powershell
$dest = "C:\Program Files\OneUptimeHostCollector"
$zip  = "$env:TEMP\oneuptime-host-collector.zip"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
# amd64; use the _arm64.zip asset on ARM
Invoke-WebRequest -Uri "https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-host-collector_windows_amd64.zip" -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $dest -Force
```

Vous créerez `C:\Program Files\OneUptimeHostCollector\config.yaml` à l'étape 2 et enregistrerez un service Windows à l'étape 3.

> Vous préférez l'`otelcol-contrib` en amont ? Téléchargez plutôt `otelcol-contrib_*_windows_amd64.zip` depuis la [page des versions OpenTelemetry](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) — tout ce qui suit fonctionne de la même manière, **sauf** l'onglet **Services** de l'hôte, qui nécessite `windows_service` (absent de la version en amont ; voir « Services Windows (métriques) »).

## Étape 2 — Configurer le collecteur

Le fichier de configuration se trouve dans :

| Système d'exploitation | Chemin |
|---|---|
| Linux | `/etc/otelcol-contrib/config.yaml` |
| macOS | `/etc/otelcol-contrib/config.yaml` |
| Windows | `C:\Program Files\OneUptimeHostCollector\config.yaml` |

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
          layout: '%Y-%m-%d %H:%M:%S.%f%j'
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

Pour lire un canal personnalisé ou spécifique à une application (tout ce que vous pouvez voir sous *Event Viewer → Applications and Services Logs*), utilisez son nom d'affichage exact :

```yaml
  windowseventlog/iis:
    channel: Microsoft-IIS-Logging/Logs
    start_at: end
```

### Services Windows (métriques)

L'onglet **Services** de l'hôte est alimenté par le [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) (type de configuration `windows_service`), qui signale l'état d'exécution et le type de démarrage des services Windows sous forme de métriques.

> **Ce récepteur n'est _pas_ inclus dans le binaire `otelcol-contrib` précompilé en amont.** Bien que ses métadonnées déclarent la distribution `contrib`, il n'a pas été ajouté au manifeste de version de contrib, de sorte que le collecteur précompilé officiel que vous avez installé à l'étape 1 ne le contient pas. L'ajout de `windows_service` à ce collecteur échoue au démarrage avec `'receivers' unknown type: "windows_service"` — et **aucune mise à niveau de version ne corrige cela**, car il n'est livré dans aucune version publiée d'`otelcol-contrib`. Le récepteur est également en version **alpha** et **réservé à Windows**.

Vous disposez de deux façons d'obtenir un collecteur qui l'inclut. Si vous n'avez pas besoin de l'état par service, vous pouvez ignorer entièrement cette section — les métriques de l'hôte, les journaux d'événements Windows et tout le reste fonctionnent avec le collecteur standard.

#### Option A — Utiliser le OneUptime Host Collector (recommandé)

OneUptime publie un collecteur précompilé — le **OneUptime Host Collector** — qui inclut déjà `windows_service` (ainsi que `hostmetrics`, `windowseventlog`, `filelog` et l'exportateur OTLP). Aucune chaîne d'outils Go ni compilation requise.

1. Téléchargez l'asset Windows depuis la [page des versions OneUptime](https://github.com/OneUptime/oneuptime/releases) — soit `oneuptime-host-collector_windows_amd64.zip` (ou `_arm64.zip`), soit l'installateur `oneuptime-host-collector-amd64.msi`.
2. Décompressez-le dans `C:\Program Files\OneUptimeHostCollector\` (le MSI l'y installe pour vous). L'archive est livrée avec un `config.yaml` qui active déjà `windows_service`.
3. Modifiez `config.yaml` et définissez votre `x-oneuptime-token` (ainsi que le point de terminaison si vous l'auto-hébergez).
4. Enregistrez-le et démarrez-le en tant que service Windows depuis une invite PowerShell **avec privilèges élevés** :

```powershell
sc.exe create "OneUptimeHostCollector" `
  binPath= "\"C:\Program Files\OneUptimeHostCollector\oneuptime-host-collector.exe\" --config=\"C:\Program Files\OneUptimeHostCollector\config.yaml\"" `
  start= auto `
  DisplayName= "OneUptime Host Collector"

sc.exe start "OneUptimeHostCollector"
```

Il s'exécute en tant que `LocalSystem` (la valeur par défaut de `sc.exe`) afin de pouvoir lire tous les services. L'onglet **Services** se remplit automatiquement dès que les métriques arrivent. C'est le même collecteur pour Linux/macOS également (ces assets omettent simplement le récepteur réservé à Windows).

#### Option B — Compiler le vôtre avec `ocb`

Si vous préférez compiler votre propre collecteur (ou si vous exécutez déjà une distribution personnalisée), compilez-en un avec l'[OpenTelemetry Collector Builder (`ocb`)](https://github.com/open-telemetry/opentelemetry-collector/tree/main/cmd/builder).

**1. Compilez un collecteur personnalisé avec `ocb`.** Créez `builder-config.yaml` (gardez chaque version sur la même version du collecteur) :

```yaml
dist:
  name: otelcol-oneuptime
  description: OpenTelemetry Collector with the Windows service receiver
  output_path: ./otelcol-oneuptime
  otelcol_version: 0.154.0

receivers:
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/receiver/hostmetricsreceiver v0.154.0
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/receiver/windowseventlogreceiver v0.154.0
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/receiver/windowsservicereceiver v0.154.0

processors:
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/processor/resourcedetectionprocessor v0.154.0
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/processor/resourceprocessor v0.154.0
  - gomod: go.opentelemetry.io/collector/processor/batchprocessor v0.154.0

exporters:
  - gomod: go.opentelemetry.io/collector/exporter/otlphttpexporter v0.154.0
```

Compilez-le ensuite (nécessite Go) — la sortie est un unique `otelcol-oneuptime.exe` que vous exécutez à la place d'`otelcol-contrib` :

```powershell
go install go.opentelemetry.io/collector/cmd/builder@v0.154.0
builder --config builder-config.yaml
```

**2. Activez le récepteur** dans votre `config.yaml` et ajoutez-le au pipeline de métriques :

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

Le récepteur émet une jauge `windows.service.status` par service — l'entier correspond à l'état du service Win32 (`4` = en cours d'exécution, `1` = arrêté) — avec les attributs `name` et `startup_mode`. Exécutez le collecteur en tant que `LocalSystem` (la valeur par défaut avec `sc.exe create`) afin qu'il puisse lire tous les services ; ceux qu'il ne peut pas ouvrir sont ignorés. Comme le récepteur est en version alpha, épinglez et testez la version avant la mise en production — les problèmes connus incluent une erreur de scrape qui pourrait faire planter le collecteur et un `access denied` sur un service affectant les autres ; restreignez avec `include_services` si vous les rencontrez.

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

  # Windows service status (the Services tab) needs the windows_service
  # receiver, which is NOT in the prebuilt collector — see
  # "Windows Services (metrics)" above to build a collector that includes it.

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
      receivers: [hostmetrics]
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
  DisplayName= "OpenTelemetry Collector"

sc.exe description "otelcol-contrib" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "otelcol-contrib"
sc.exe query "otelcol-contrib"
```

Le service s'exécute par défaut sous `LocalSystem`, qui dispose des privilèges nécessaires pour lire le canal `Security` des journaux d'événements Windows.

## Étape 4 — Vérifier dans OneUptime

1. Générez un signal sur l'hôte :
   - **Linux / macOS :** `logger "hello from oneuptime"` (écrit dans syslog / journald).
   - **Windows :** `eventcreate /T INFORMATION /ID 999 /L APPLICATION /SO OneUptimeTest /D "hello from oneuptime"` depuis une invite avec privilèges élevés.
2. Dans le tableau de bord OneUptime, ouvrez **Telemetry → Services** et choisissez le `service.name` que vous avez configuré.
3. Ouvrez **Metrics** — les métriques de l'hôte (CPU, mémoire, système de fichiers, etc.) devraient apparaître en moins d'une minute.
4. Ouvrez **Logs** — vos journaux de fichiers / entrées journald / journaux d'événements Windows devraient arriver en flux continu. Les attributs utiles pour la recherche incluent `log.file.name`, `systemd.unit`, `winlog.channel`, `winlog.event_id` et `winlog.provider.name`.

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
  - **Windows :** consultez *Event Viewer → Windows Logs → Application* pour la source `otelcol-contrib`.
  - Confirmez que l'hôte peut atteindre `https://oneuptime.com/otlp` (ou votre point de terminaison auto-hébergé) : `curl -v https://oneuptime.com/otlp` depuis la même machine.
- **HTTP 401 de l'exportateur** — le jeton d'ingestion est invalide ou révoqué. Générez-en un nouveau depuis *Project Settings → Telemetry Ingestion Keys*.
- **Le canal `Security` des journaux d'événements Windows renvoie une erreur d'accès refusé** — le service ne s'exécute pas avec des privilèges suffisants. Recréez-le sous `LocalSystem` (la valeur par défaut avec `sc.exe create`) ou accordez au compte de service le droit utilisateur *Manage auditing and security log*.
- **Le récepteur `journald` ne démarre pas** — assurez-vous que `journalctl` se trouve dans le `PATH` du collecteur et que `/var/log/journal` existe (exécutez `sudo systemd-tmpfiles --create --prefix /var/log/journal` si ce n'est pas le cas).
- **Volume / coût élevé** — restreignez les récepteurs (canaux Windows spécifiques, unités systemd spécifiques, fichiers journaux spécifiques), ajoutez un filtre `query:` sur le récepteur de journaux d'événements Windows, ou ajoutez un processeur `filter` pour supprimer les événements de faible gravité avant l'exportation.

## Étapes suivantes

- Ajoutez des **moniteurs de journaux** pour alerter sur des modèles de journaux spécifiques (par exemple, alerter lorsque plus de 5 connexions échouées `winlog.event_id = 4625` se produisent dans une fenêtre de 5 minutes).
- Ajoutez des **moniteurs de métriques** sur les métriques de l'hôte (saturation CPU, espace disque faible, utilisation du swap).
- Combinez ceci avec le [Server / VM Monitor](/docs/monitor/server-monitor) et l'[agent d'infrastructure OneUptime](/docs/monitor/server-monitor) pour une visibilité de bout en bout sur l'hôte.
- Déployez la même configuration sur chaque hôte via Ansible / Chef / Puppet / Group Policy / Intune / votre outil de gestion de configuration existant.
