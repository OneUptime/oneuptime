# Recolector de OpenTelemetry en el host (Linux, macOS, Windows)

## Resumen

Puedes ejecutar el **OpenTelemetry Collector** como un servicio directamente en tus hosts Linux, macOS o Windows para enviar telemetría del host a OneUptime a través de OTLP. Esta página te guía por la instalación del recolector, su configuración para cada sistema operativo y la elección de los receptores adecuados según lo que quieras recopilar:

- **Métricas del host** (CPU, memoria, disco, sistema de archivos, red, carga, procesos) en todos los sistemas operativos
- **Logs basados en archivos** bajo `/var/log/**` (Linux, macOS) mediante el [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver)
- **systemd journal** (Linux) mediante el [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver)
- **Apple Unified Log** (macOS) mediante el [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor) que envuelve una salida de `log stream` capturada
- **Windows Event Logs** mediante el [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver)
- **Estado de los servicios de Windows** (que alimenta la pestaña **Services** del host) mediante el [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) — _no está en el recolector precompilado oficial; usa el **OneUptime Host Collector** precompilado o una compilación personalizada (consulta "Windows Services (métricas)" más abajo)_

> **¿Y el OneUptime Infrastructure Agent?** Ese agente es un demonio Go separado y ligero, centrado en métricas básicas y en la función _Server / VM Monitor_ (estado, procesos, alertas). El OpenTelemetry Collector descrito aquí es independiente y es la herramienta adecuada cuando quieres logs (logs de archivos, journald, Windows Event Logs) o métricas del host más completas ingeridas como OTLP estándar. Ambos pueden ejecutarse en el mismo host sin interferir entre sí.

## Requisitos previos

- Un **OneUptime Telemetry Ingestion Token** — crea uno desde _Project Settings → Telemetry Ingestion Keys_ y copia el valor de `x-oneuptime-token`.
- La distribución **OpenTelemetry Collector Contrib** (`otelcol-contrib`). La compilación predeterminada `otelcol` **no** incluye receptores como `windowseventlogreceiver`, `journaldreceiver` ni los extras de `hostmetrics` — asegúrate de usar la distribución `contrib`. Una excepción que conviene conocer de antemano: el `windowsservicereceiver` en alpha (que alimenta la pestaña **Services** de Windows) **no** viene incluido en el binario `contrib` precompilado oficial — usa el **OneUptime Host Collector** precompilado (que sí lo incluye) o compila el tuyo propio; consulta "Windows Services (métricas)" más abajo.
- Root / Administrador en el host para instalar el recolector como servicio y (donde corresponda) leer fuentes de logs privilegiadas.

## Paso 1 — Instalar el OpenTelemetry Collector

Elige la sección correspondiente a tu sistema operativo. Todos los ejemplos asumen que estás instalando la última versión de `otelcol-contrib` desde [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases).

### Linux (Debian / Ubuntu)

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.154.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

El paquete Debian instala el binario en `/usr/bin/otelcol-contrib`, la configuración predeterminada en `/etc/otelcol-contrib/config.yaml` y una unidad systemd en `/etc/systemd/system/otelcol-contrib.service`.

### Linux (RHEL / CentOS / Fedora / Amazon Linux)

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.154.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

Las rutas coinciden con las del paquete Debian (`/usr/bin/otelcol-contrib`, `/etc/otelcol-contrib/config.yaml`, unidad systemd `otelcol-contrib`).

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

Crearás `/etc/otelcol-contrib/config.yaml` en el Paso 2 y un plist de `launchd` en el Paso 3.

### Windows

En Windows, instala el **OneUptime Host Collector** — el recolector precompilado de OneUptime que incluye el receptor `windows_service` (que alimenta la pestaña **Services** del host y que _no_ está en la compilación oficial de `otelcol-contrib`). Desde un símbolo del sistema de PowerShell **elevado**:

```powershell
$dest = "C:\Program Files\OneUptimeHostCollector"
$zip  = "$env:TEMP\oneuptime-host-collector.zip"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
# amd64; use the _arm64.zip asset on ARM
Invoke-WebRequest -Uri "https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-host-collector_windows_amd64.zip" -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $dest -Force
```

Crearás `C:\Program Files\OneUptimeHostCollector\config.yaml` en el Paso 2 y registrarás un servicio de Windows en el Paso 3.

> ¿Prefieres el `otelcol-contrib` oficial? Descarga `otelcol-contrib_*_windows_amd64.zip` desde la [página de releases de OpenTelemetry](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) en su lugar — todo lo que sigue funciona igual, **excepto** la pestaña **Services** del host, que necesita `windows_service` (no está en la compilación oficial; consulta "Windows Services (métricas)").

## Paso 2 — Configurar el recolector

El archivo de configuración se encuentra en:

| Sistema operativo | Ruta                                                  |
| ----------------- | ----------------------------------------------------- |
| Linux             | `/etc/otelcol-contrib/config.yaml`                    |
| macOS             | `/etc/otelcol-contrib/config.yaml`                    |
| Windows           | `C:\Program Files\OneUptimeHostCollector\config.yaml` |

Cada configuración sigue la misma estructura — elige los receptores que quieras, añade un procesador `batch` y `resource`, y exporta a OneUptime a través de OTLP HTTP. Los ejemplos a continuación muestran una configuración completa y lista para copiar y pegar por sistema operativo, y luego recorren cada bloque de receptor para que puedas combinarlos a tu gusto.

Reemplaza `YOUR_TELEMETRY_INGESTION_TOKEN` y el valor de `service.name` para adaptarlos a tu entorno.

### Piezas comunes (usadas por todos los sistemas operativos)

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

- **`batch`** agrupa los registros antes de exportarlos para que no pagues un viaje HTTP de ida y vuelta por cada registro.
- **`resource`** marca cada registro con `service.name`. Usa un valor diferente por host (por ejemplo, `prod-web-01`) si quieres que cada máquina aparezca como su propio servicio de telemetría en OneUptime.
- **`otlphttp`** envía a OneUptime a través de HTTPS con el token de ingestión adjunto.

### Métricas del host (Linux, macOS, Windows)

Funciona en todos los sistemas operativos. Recoge métricas de CPU, memoria, disco, sistema de archivos, red, carga, paginación y procesos desde el kernel del host:

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

> En Linux, el recolector lee `/proc` y `/sys`. Cuando el recolector se ejecuta en un contenedor, monta el `/proc` y `/sys` del host y establece las variables de entorno `HOST_PROC` / `HOST_SYS`. Cuando se ejecuta directamente como un servicio systemd (tal como se instaló más arriba), no se necesita configuración adicional.

### Logs de archivos (Linux, macOS)

Captura cualquier archivo de log en disco. A continuación se muestra un conjunto inicial común:

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

`start_at: end` significa que se capturan las líneas nuevas desde el momento en que el recolector arranca; cambia a `beginning` para rellenar datos anteriores en la primera ejecución. El recolector rastrea los desplazamientos de los archivos, por lo que reanuda correctamente tras los reinicios.

**Convertir los rastros de pila de los logs del host en Exceptions.** OneUptime escanea automáticamente las líneas de log de error y fatales en busca de rastros de pila y los agrupa en la vista de **Exceptions** (Issues), atribuidos a este host — sin necesidad de configuración adicional. Para que esto se agrupe bien, un rastro de pila de varias líneas (Java, Python, .NET, Ruby) debe llegar como **un solo** registro de log, no como un registro por línea. Habilita la recombinación de varias líneas en el receptor `filelog` para que un rastro y sus fotogramas se mantengan juntos:

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

Sin recombinación, cada fotograma se ingiere como un log independiente y la excepción aparecerá como un issue de una sola línea y mal agrupado. Si tu aplicación puede emitir directamente los atributos de log de OpenTelemetry `exception.type` / `exception.message` / `exception.stacktrace`, hazlo en su lugar — es la vía más fiable y es independiente del análisis de varias líneas.

### systemd journal (Linux)

Si tu host usa systemd, el receptor `journald` suele ser más adecuado que capturar `/var/log/*` — captura todo en un solo lugar y conserva los campos estructurados:

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

El binario del recolector debe poder ejecutar `journalctl` (los paquetes Debian / RPM ya lo incluyen como dependencia).

### Apple Unified Log (macOS)

macOS dejó obsoleto `/var/log/system.log` en favor del Apple Unified Log, que se consulta con `log show` / `log stream`. La forma más sencilla de ingerirlo es transmitir la salida de `log` mediante el receptor `filelog` con un pequeño envoltorio. Crea `/usr/local/otelcol-contrib/log-stream.sh`:

```bash
#!/bin/bash
exec /usr/bin/log stream --style ndjson --level info \
  --predicate 'subsystem != "com.apple.cfnetwork"' \
  >> /var/log/apple-unified.log
```

Hazlo ejecutable, ejecútalo bajo launchd (o `nohup` para una prueba rápida) y luego apunta el recolector al archivo:

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

(Si no necesitas el unified log, omite esto — las flotas de Mac a menudo funcionan bien con solo métricas del host + unos pocos logs de archivos).

### Windows Event Logs

Suscríbete a los canales que te interesen mediante el `wevtapi` nativo:

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

Para acotar el canal `Security`, de alto volumen, a IDs de evento específicos:

```yaml
windowseventlog/security:
  channel: Security
  start_at: end
  query: "*[System[(EventID=4625 or EventID=4740)]]"
```

Para leer un canal personalizado o específico de una aplicación (cualquiera que puedas ver en _Event Viewer → Applications and Services Logs_), usa su nombre de visualización exacto:

```yaml
windowseventlog/iis:
  channel: Microsoft-IIS-Logging/Logs
  start_at: end
```

### Windows Services (métricas)

La pestaña **Services** del host se alimenta del [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) (tipo de configuración `windows_service`), que informa del estado de ejecución y del tipo de inicio de los servicios de Windows como métricas.

**El OneUptime Host Collector (instalado en el Paso 1, el predeterminado en Windows) ya incluye este receptor.** Habilítalo en tu `config.yaml` y añádelo a la canalización de métricas:

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

El receptor emite un medidor `windows.service.status` por servicio — el entero es el estado del servicio Win32 (`4` = en ejecución, `1` = detenido) — con los atributos `name` y `startup_mode`. Ejecuta el recolector como `LocalSystem` (el valor predeterminado de `sc.exe`) para que pueda leer todos los servicios; cualquiera que no pueda abrir se omite. El receptor está en **alpha** y es **exclusivo de Windows**; entre los problemas conocidos se incluyen un error de scrape que podría hacer caer al recolector y un `access denied` en un servicio que afecta a otros — restríngelo a `include_services` si los encuentras.

#### ¿Usar el recolector oficial en su lugar?

El binario `otelcol-contrib` precompilado oficial **no** incluye `windowsservicereceiver` — añadir `windows_service` falla al arrancar con `'receivers' unknown type: "windows_service"`, y **ninguna actualización de versión lo soluciona** (no está en ninguna compilación publicada de `otelcol-contrib`). O bien cambia al OneUptime Host Collector (Paso 1), o compila el tuyo propio con el [OpenTelemetry Collector Builder (`ocb`)](https://github.com/open-telemetry/opentelemetry-collector/tree/main/cmd/builder) — crea `builder-config.yaml` (mantén cada versión en la misma release del recolector):

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

```powershell
go install go.opentelemetry.io/collector/cmd/builder@v0.154.0
builder --config builder-config.yaml
```

Luego ejecuta el `otelcol-oneuptime.exe` resultante y habilita `windows_service` como se muestra más arriba.

### Ejemplo completo — host Linux

`/etc/otelcol-contrib/config.yaml`:

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

### Ejemplo completo — host macOS

`/etc/otelcol-contrib/config.yaml`:

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

### Ejemplo completo — host Windows

`C:\Program Files\OneUptimeHostCollector\config.yaml`:

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

  # Powers the Services tab. Included in the OneUptime Host Collector (Step 1).
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

## Paso 3 — Ejecutar el recolector como servicio

### Linux (systemd)

Los paquetes Debian / RPM ya instalan una unidad systemd. Solo tienes que habilitarla e iniciarla:

```bash
sudo systemctl enable --now otelcol-contrib
sudo systemctl status otelcol-contrib
```

Para seguir los propios logs del recolector:

```bash
sudo journalctl -u otelcol-contrib -f
```

### macOS (launchd)

Crea `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:

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

Cárgalo:

```bash
sudo launchctl load -w /Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist
sudo launchctl list | grep otelcol-contrib
```

### Windows (Services)

Desde un símbolo del sistema de PowerShell **elevado**:

```powershell
sc.exe create "OneUptimeHostCollector" `
  binPath= "\"C:\Program Files\OneUptimeHostCollector\oneuptime-host-collector.exe\" --config=\"C:\Program Files\OneUptimeHostCollector\config.yaml\"" `
  start= auto `
  DisplayName= "OneUptime Host Collector"

sc.exe description "OneUptimeHostCollector" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "OneUptimeHostCollector"
sc.exe query "OneUptimeHostCollector"
```

El servicio se ejecuta bajo `LocalSystem` de forma predeterminada, que tiene los privilegios necesarios para leer el canal `Security` de Windows Event Log.

## Paso 4 — Verificar en OneUptime

1. Genera alguna señal en el host:
   - **Linux / macOS:** `logger "hello from oneuptime"` (escribe en syslog / journald).
   - **Windows:** `eventcreate /T INFORMATION /ID 999 /L APPLICATION /SO OneUptimeTest /D "hello from oneuptime"` desde un símbolo del sistema elevado.
2. En el panel de OneUptime, abre **Telemetry → Services** y elige el `service.name` que configuraste.
3. Abre **Metrics** — las métricas del host (CPU, memoria, sistema de archivos, etc.) deberían aparecer en un minuto.
4. Abre **Logs** — tus logs de archivos / entradas de journald / Windows Event Logs deberían estar transmitiéndose. Entre los atributos útiles para búsquedas se incluyen `log.file.name`, `systemd.unit`, `winlog.channel`, `winlog.event_id` y `winlog.provider.name`.

## Reducir el volumen de datos recopilados

Como tú controlas la configuración del recolector, tú decides exactamente qué sale del host — no se recopila nada a menos que un receptor que hayas añadido lo solicite. Si un host envía más de lo que quieres (lo que se traduce en un mayor volumen de ingestión y, en OneUptime Cloud, en un mayor coste), ajústalo aquí. Las dos palancas más importantes son **qué fuentes de logs capturas** y **con qué frecuencia haces scrape de las métricas**; un procesador `filter` se encarga del resto.

El principio es el mismo que el de la propia configuración: **añade solo los receptores cuyos datos vayas a mirar** y luego recórtalos por dentro. Cada cambio de los siguientes es una edición de `config.yaml` — aplícalo y reinicia el recolector (Paso 3).

### De dónde viene el volumen

| Señal                        | Principal factor                                         | Reducirlo con                                                               |
| ---------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Logs**                     | Cada línea de cada archivo / unidad de journald / canal  | Acota los receptores; filtros `query:`; un procesador `filter` por gravedad |
| **Métricas del host**        | Frecuencia de scrape × número de series                  | `collection_interval`; eliminar el scraper `process`; selección de scrapers |
| **Cardinalidad de métricas** | Métricas por proceso (un conjunto de series por proceso) | Omitir o acotar el scraper `process`                                        |

### Palanca 1 — Captura solo las fuentes de logs que necesitas

Los logs son casi siempre la mayor porción. El recolector solo lee lo que listas, así que la solución es listar menos:

- **Archivos** — apunta `filelog` a rutas específicas, no a globs amplios. `/var/log/myapp/error.log` en lugar de `/var/log/**`.
- **journald** — restringe `units:` a los servicios que te interesan y sube `priority:` para descartar en el origen las entradas ruidosas de `info`/`debug`:

  ```yaml
  receivers:
    journald:
      directory: /var/log/journal
      units:
        - ssh.service
        - nginx.service
      priority: warning # info and debug are dropped before export
  ```

- **Windows Event Logs** — el canal `Security` es con diferencia el de mayor volumen. Acótalo a los IDs de evento que realmente auditas con un `query:` (como se muestra en [Windows Event Logs](#windows-event-logs) más arriba), o descarta el canal por completo si no lo necesitas.

### Palanca 2 — Ralentiza el intervalo de las métricas

El volumen de `hostmetrics` escala directamente con `collection_interval`. Si no necesitas una resolución de 30 segundos, 60s reduce a la mitad el número de puntos de datos:

```yaml
receivers:
  hostmetrics:
    collection_interval: 60s
```

### Palanca 3 — Elimina el scraper por proceso (el causante de la cardinalidad)

El scraper `process` emite un conjunto de series independiente **por cada proceso en ejecución** del host — en una máquina con mucha actividad, esa es la mayor fuente individual de cardinalidad de métricas. A menos que necesites CPU/memoria por proceso, déjalo fuera de la lista `scrapers:`. Conserva `processes` (que son solo un puñado de métricas agregadas de recuento de procesos) — es barato. Si sí quieres métricas por proceso, acótalas a los procesos que importan:

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

### Palanca 4 — Descarta registros de bajo valor con un procesador `filter`

Cuando quieres el receptor pero no toda su salida, añade un procesador [`filter`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/filterprocessor) — evalúa una condición [OTTL](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/README.md) y **descarta cualquier registro que coincida**, antes de que se exporte nada.

Descarta los logs por debajo de un umbral de gravedad:

```yaml
processors:
  filter/drop-low-severity:
    error_mode: ignore
    logs:
      log_record:
        # Drop anything less severe than WARN (info, debug, trace).
        - "severity_number < SEVERITY_NUMBER_WARN"
```

Descarta una métrica ruidosa concreta que no representas en gráficos:

```yaml
processors:
  filter/drop-metrics:
    error_mode: ignore
    metrics:
      metric:
        - 'name == "system.paging.faults"'
```

Luego añade el procesador a la canalización correspondiente — el orden importa, así que pon `filter` antes de `batch`:

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

### Un punto de partida ligero

Un host **solo de métricas** — sin logs, intervalo grueso, sin series por proceso — es la huella útil más pequeña:

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

Vuelve a añadir una canalización de `logs` con un receptor `filelog` o `journald` de alcance reducido cuando lo necesites.

> **Ten cuidado con lo que recortas.** Las alertas basadas en logs necesitan que los logs lleguen: si filtras una gravedad o un canal, los monitores que dependen de ello se quedan en silencio. Recorta las fuentes sobre las que no actúas, no las que un monitor está vigilando. Cambia una palanca cada vez y confirma la reducción en **Project Settings → Usage History** (el uso se agrega a diario, así que dale un día o dos) antes de pasar a la siguiente.

## OneUptime autoalojado

Si estás autoalojando OneUptime, apunta el exportador a tu propio host:

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

Si tu instancia es solo HTTP, cambia el esquema a `http://` y usa el puerto apropiado.

## Detrás de un proxy

El OpenTelemetry Collector respeta las variables de entorno estándar `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`. Configúralas en el servicio:

- **systemd (Linux):** añade `/etc/systemd/system/otelcol-contrib.service.d/proxy.conf` con `[Service]\nEnvironment="HTTPS_PROXY=http://proxy.example.com:3128"`, luego `sudo systemctl daemon-reload && sudo systemctl restart otelcol-contrib`.
- **launchd (macOS):** añade un diccionario `<EnvironmentVariables>` al plist.
- **Servicio de Windows:** configura las variables de entorno en el servicio mediante `sc.exe config` o el registro bajo `HKLM\SYSTEM\CurrentControlSet\Services\otelcol-contrib\Environment`.

## Solución de problemas

- **No aparece telemetría en OneUptime**
  - Añade `service.telemetry.logs.level: debug` a la configuración y reinicia el recolector para obtener una salida detallada.
  - **Linux / macOS:** `journalctl -u otelcol-contrib -f` (Linux) o `tail -f /var/log/otelcol-contrib.err.log` (macOS).
  - **Windows:** mira en _Event Viewer → Windows Logs → Application_ la fuente `otelcol-contrib`.
  - Confirma que el host puede alcanzar `https://oneuptime.com/otlp` (o tu endpoint autoalojado): `curl -v https://oneuptime.com/otlp` desde la misma máquina.
- **HTTP 401 desde el exportador** — el token de ingestión es inválido o ha sido revocado. Genera uno nuevo desde _Project Settings → Telemetry Ingestion Keys_.
- **El canal `Security` de Windows Event Log devuelve acceso denegado** — el servicio no se ejecuta con privilegios suficientes. Recréalo bajo `LocalSystem` (el valor predeterminado con `sc.exe create`) o concede a la cuenta del servicio el derecho de usuario _Manage auditing and security log_.
- **El receptor `journald` no arranca** — asegúrate de que `journalctl` esté en el `PATH` del recolector y de que exista `/var/log/journal` (ejecuta `sudo systemd-tmpfiles --create --prefix /var/log/journal` si no es así).
- **Alto volumen / coste** — consulta [Reducir el volumen de datos recopilados](#reducing-the-volume-of-data-collected): acota los receptores (canales específicos de Windows, unidades de systemd, archivos de log), sube el `collection_interval` de las métricas, elimina el scraper por proceso o añade un procesador `filter` para descartar registros de baja gravedad antes de exportar.

## Próximos pasos

- Añade **Logs Monitors** para alertar sobre patrones de log específicos (por ejemplo, alertar cuando ocurran más de 5 inicios de sesión fallidos con `winlog.event_id = 4625` en una ventana de 5 minutos).
- Añade **Metrics Monitors** sobre las métricas del host (saturación de CPU, poco espacio en disco, uso de swap).
- Combina esto con el [Server / VM Monitor](/docs/monitor/server-monitor) y el [OneUptime Infrastructure Agent](/docs/monitor/server-monitor) para una visibilidad del host de extremo a extremo.
- Envía la misma configuración a cada host mediante Ansible / Chef / Puppet / Group Policy / Intune / tu herramienta de gestión de configuración existente.
