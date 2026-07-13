# Coletor OpenTelemetry de Host (Linux, macOS, Windows)

## Visão geral

Você pode executar o **OpenTelemetry Collector** como um serviço diretamente em seus hosts Linux, macOS ou Windows para enviar telemetria de host ao OneUptime via OTLP. Esta página orienta a instalação do coletor, sua configuração para cada SO e a escolha dos receivers corretos para o que você deseja coletar:

- **Métricas de host** (CPU, memória, disco, sistema de arquivos, rede, carga, processos) em todos os SOs
- **Logs baseados em arquivo** em `/var/log/**` (Linux, macOS) via [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver)
- **journal do systemd** (Linux) via [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver)
- **Apple Unified Log** (macOS) via [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor) encapsulando uma saída de `log stream` em tail
- **Windows Event Logs** via [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver)
- **Status de serviços do Windows** (alimenta a aba **Services** do host) via [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) — _não está no coletor pré-compilado upstream; use o **OneUptime Host Collector** pré-compilado ou um build personalizado (veja "Windows Services (métricas)" abaixo)_

> **E quanto ao OneUptime Infrastructure Agent?** Esse agente é um daemon Go leve e separado, focado em métricas básicas e no recurso _Server / VM Monitor_ (status, processos, alertas). O OpenTelemetry Collector descrito aqui é independente e é a ferramenta certa quando você quer logs (logs de arquivo, journald, Windows Event Logs) ou métricas de host mais ricas ingeridas como OTLP padrão. Ambos podem rodar no mesmo host sem interferir um no outro.

## Pré-requisitos

- Um **OneUptime Telemetry Ingestion Token** — crie um em _Project Settings → Telemetry Ingestion Keys_ e copie o valor do `x-oneuptime-token`.
- A distribuição **OpenTelemetry Collector Contrib** (`otelcol-contrib`). O build padrão `otelcol` **não** inclui receivers como `windowseventlogreceiver`, `journaldreceiver` ou extras de `hostmetrics` — certifique-se de usar a distribuição `contrib`. Uma exceção que vale a pena saber de antemão: o `windowsservicereceiver` alpha (que alimenta a aba **Services** do Windows) **não** está incluído no binário `contrib` pré-compilado upstream — use o **OneUptime Host Collector** pré-compilado (que o inclui) ou compile o seu próprio; veja "Windows Services (métricas)" abaixo.
- Root / Administrador no host para instalar o coletor como serviço e (quando aplicável) ler fontes de log privilegiadas.

## Passo 1 — Instalar o OpenTelemetry Collector

Escolha a seção para o seu SO. Todos os exemplos assumem que você está instalando a release mais recente do `otelcol-contrib` a partir de [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases).

### Linux (Debian / Ubuntu)

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.154.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

O pacote Debian instala o binário em `/usr/bin/otelcol-contrib`, a configuração padrão em `/etc/otelcol-contrib/config.yaml` e uma unit do systemd em `/etc/systemd/system/otelcol-contrib.service`.

### Linux (RHEL / CentOS / Fedora / Amazon Linux)

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.154.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

Os caminhos correspondem ao pacote Debian (`/usr/bin/otelcol-contrib`, `/etc/otelcol-contrib/config.yaml`, unit do systemd `otelcol-contrib`).

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

Você criará `/etc/otelcol-contrib/config.yaml` no Passo 2 e um plist do `launchd` no Passo 3.

### Windows

No Windows, instale o **OneUptime Host Collector** — o coletor pré-compilado da OneUptime que inclui o receiver `windows_service` (que alimenta a aba **Services** do host e _não_ está no build upstream do `otelcol-contrib`). A partir de um prompt **elevado** do PowerShell:

```powershell
$dest = "C:\Program Files\OneUptimeHostCollector"
$zip  = "$env:TEMP\oneuptime-host-collector.zip"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
# amd64; use the _arm64.zip asset on ARM
Invoke-WebRequest -Uri "https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-host-collector_windows_amd64.zip" -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $dest -Force
```

Você criará `C:\Program Files\OneUptimeHostCollector\config.yaml` no Passo 2 e registrará um serviço do Windows no Passo 3.

> Prefere o `otelcol-contrib` upstream? Baixe o `otelcol-contrib_*_windows_amd64.zip` da [página de releases do OpenTelemetry](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) em vez disso — tudo abaixo funciona da mesma forma, **exceto** a aba **Services** do host, que precisa do `windows_service` (não está no build upstream; veja "Windows Services (métricas)").

## Passo 2 — Configurar o coletor

O arquivo de configuração fica em:

| SO      | Caminho                                               |
| ------- | ----------------------------------------------------- |
| Linux   | `/etc/otelcol-contrib/config.yaml`                    |
| macOS   | `/etc/otelcol-contrib/config.yaml`                    |
| Windows | `C:\Program Files\OneUptimeHostCollector\config.yaml` |

Toda configuração segue o mesmo formato — escolha os receivers que você quer, adicione um processador `batch` e `resource`, e exporte para o OneUptime via OTLP HTTP. Os exemplos abaixo mostram uma configuração completa e pronta para copiar e colar por SO e, em seguida, percorrem cada bloco de receiver para que você possa combiná-los à vontade.

Substitua `YOUR_TELEMETRY_INGESTION_TOKEN` e o valor de `service.name` conforme o seu ambiente.

### Partes comuns (usadas por todos os SOs)

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

- **`batch`** agrupa registros antes da exportação para que você não pague uma viagem de ida e volta HTTP por registro.
- **`resource`** carimba cada registro com `service.name`. Use um valor diferente por host (por exemplo, `prod-web-01`) se quiser que cada máquina apareça como seu próprio serviço de telemetria no OneUptime.
- **`otlphttp`** envia para o OneUptime via HTTPS com o token de ingestão anexado.

### Métricas de host (Linux, macOS, Windows)

Funciona em todos os SOs. Captura métricas de CPU, memória, disco, sistema de arquivos, rede, carga, paginação e processos a partir do kernel do host:

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

> No Linux, o coletor lê `/proc` e `/sys`. Quando o coletor roda em um contêiner, monte o `/proc` e `/sys` do host e defina as variáveis de ambiente `HOST_PROC` / `HOST_SYS`. Quando ele roda diretamente como um serviço do systemd (como instalado acima), nenhuma configuração extra é necessária.

### Logs de arquivo (Linux, macOS)

Faça tail de qualquer arquivo de log em disco. Abaixo está um conjunto inicial comum:

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

`start_at: end` significa novas linhas a partir do momento em que o coletor inicia; altere para `beginning` para preencher retroativamente na primeira execução. O coletor rastreia os offsets dos arquivos, então ele retoma corretamente entre reinicializações.

**Transformando stack traces de logs de host em Exceptions.** O OneUptime examina automaticamente as linhas de log de erro e fatal em busca de stack traces e as agrupa na visão **Exceptions** (Issues), atribuídas a este host — nenhuma configuração extra é necessária. Para que o agrupamento funcione bem, um stack trace de várias linhas (Java, Python, .NET, Ruby) deve chegar como **um** registro de log, e não um registro por linha. Habilite a recombinação multiline no receiver `filelog` para que um trace e seus frames permaneçam juntos:

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

Sem a recombinação, cada frame é ingerido como um log separado e a exceção aparecerá como um problema de uma única linha, mal agrupado. Se sua aplicação puder emitir diretamente os atributos de log `exception.type` / `exception.message` / `exception.stacktrace` do OpenTelemetry, faça isso em vez disso — é o caminho mais confiável e independe do parsing multiline.

### journal do systemd (Linux)

Se o seu host usa systemd, o receiver `journald` costuma ser uma escolha melhor do que fazer tail de `/var/log/*` — ele captura tudo em um só lugar e preserva campos estruturados:

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

O binário do coletor precisa ser capaz de executar `journalctl` (os pacotes Debian / RPM já o incluem como dependência).

### Apple Unified Log (macOS)

O macOS descontinuou `/var/log/system.log` em favor do Apple Unified Log, que é consultado com `log show` / `log stream`. A maneira mais simples de ingeri-lo é fazer stream da saída do `log` via receiver `filelog` com um pequeno wrapper. Crie `/usr/local/otelcol-contrib/log-stream.sh`:

```bash
#!/bin/bash
exec /usr/bin/log stream --style ndjson --level info \
  --predicate 'subsystem != "com.apple.cfnetwork"' \
  >> /var/log/apple-unified.log
```

Torne-o executável, execute-o sob o launchd (ou `nohup` para um teste rápido) e, em seguida, aponte o coletor para o arquivo:

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

(Se você não precisa do unified log, pule isto — frotas de Mac muitas vezes funcionam bem apenas com métricas de host + alguns logs de arquivo.)

### Windows Event Logs

Inscreva-se nos canais que lhe interessam via a `wevtapi` nativa:

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

Para restringir o canal `Security`, de alto volume, a IDs de evento específicos:

```yaml
windowseventlog/security:
  channel: Security
  start_at: end
  query: "*[System[(EventID=4625 or EventID=4740)]]"
```

Para ler um canal personalizado ou específico de aplicação (qualquer coisa que você consiga ver em _Event Viewer → Applications and Services Logs_), use seu nome de exibição exato:

```yaml
windowseventlog/iis:
  channel: Microsoft-IIS-Logging/Logs
  start_at: end
```

### Windows Services (métricas)

A aba **Services** do host é alimentada pelo [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) (tipo de config `windows_service`), que reporta o estado de execução e o tipo de inicialização dos serviços do Windows como métricas.

**O OneUptime Host Collector (instalado no Passo 1, o padrão no Windows) já inclui esse receiver.** Habilite-o no seu `config.yaml` e adicione-o ao pipeline de métricas:

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

O receiver emite um gauge `windows.service.status` por serviço — o inteiro é o estado do serviço Win32 (`4` = em execução, `1` = parado) — com os atributos `name` e `startup_mode`. Execute o coletor como `LocalSystem` (o padrão do `sc.exe`) para que ele possa ler todos os serviços; qualquer um que ele não consiga abrir é ignorado. O receiver está em **alpha** e é **somente para Windows**; problemas conhecidos incluem um erro de scrape que poderia derrubar o coletor e um `access denied` em um serviço afetando outros — restrinja a `include_services` se você os encontrar.

#### Usando o coletor upstream em vez disso?

O binário `otelcol-contrib` pré-compilado upstream **não** inclui o `windowsservicereceiver` — adicionar `windows_service` falha na inicialização com `'receivers' unknown type: "windows_service"`, e **nenhuma atualização de versão corrige isso** (ele não está em nenhum build lançado do `otelcol-contrib`). Ou troque para o OneUptime Host Collector (Passo 1), ou compile o seu próprio com o [OpenTelemetry Collector Builder (`ocb`)](https://github.com/open-telemetry/opentelemetry-collector/tree/main/cmd/builder) — crie `builder-config.yaml` (mantenha todas as versões na mesma release do coletor):

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

Então execute o `otelcol-oneuptime.exe` resultante e habilite o `windows_service` conforme mostrado acima.

### Exemplo completo — host Linux

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

### Exemplo completo — host macOS

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

### Exemplo completo — host Windows

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

## Passo 3 — Executar o coletor como serviço

### Linux (systemd)

Os pacotes Debian / RPM já instalam uma unit do systemd. Basta habilitá-la e iniciá-la:

```bash
sudo systemctl enable --now otelcol-contrib
sudo systemctl status otelcol-contrib
```

Para acompanhar os próprios logs do coletor:

```bash
sudo journalctl -u otelcol-contrib -f
```

### macOS (launchd)

Crie `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:

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

Carregue-o:

```bash
sudo launchctl load -w /Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist
sudo launchctl list | grep otelcol-contrib
```

### Windows (Services)

A partir de um prompt **elevado** do PowerShell:

```powershell
sc.exe create "OneUptimeHostCollector" `
  binPath= "\"C:\Program Files\OneUptimeHostCollector\oneuptime-host-collector.exe\" --config=\"C:\Program Files\OneUptimeHostCollector\config.yaml\"" `
  start= auto `
  DisplayName= "OneUptime Host Collector"

sc.exe description "OneUptimeHostCollector" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "OneUptimeHostCollector"
sc.exe query "OneUptimeHostCollector"
```

O serviço roda sob `LocalSystem` por padrão, que tem os privilégios necessários para ler o canal `Security` do Windows Event Log.

## Passo 4 — Verificar no OneUptime

1. Gere algum sinal no host:
   - **Linux / macOS:** `logger "hello from oneuptime"` (escreve no syslog / journald).
   - **Windows:** `eventcreate /T INFORMATION /ID 999 /L APPLICATION /SO OneUptimeTest /D "hello from oneuptime"` a partir de um prompt elevado.
2. No dashboard do OneUptime, abra **Telemetry → Services** e escolha o `service.name` que você configurou.
3. Abra **Metrics** — as métricas de host (CPU, memória, sistema de arquivos, etc.) devem aparecer em até um minuto.
4. Abra **Logs** — seus logs de arquivo / entradas do journald / Windows Event Logs devem estar chegando. Atributos pesquisáveis úteis incluem `log.file.name`, `systemd.unit`, `winlog.channel`, `winlog.event_id` e `winlog.provider.name`.

## Reduzindo o volume de dados coletados

Como você é o dono da configuração do coletor, é você quem decide exatamente o que sai do host — nada é coletado a menos que um receiver que você adicionou o solicite. Se um host está enviando mais do que você quer (o que se reflete em maior volume de ingestão e, no OneUptime Cloud, em maior custo), ajuste-o aqui. As duas maiores alavancas são **quais fontes de log você faz tail** e **com que frequência você coleta métricas**; um processador `filter` cuida do resto.

O princípio é o mesmo da própria configuração: **adicione apenas os receivers cujos dados você vai analisar** e, então, reduza dentro deles. Cada alteração abaixo é uma edição no `config.yaml` — aplique-a e reinicie o coletor (Passo 3).

### De onde vem o volume

| Sinal                         | Maior fator                                                | Reduza com                                                                       |
| ----------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Logs**                      | Cada linha de cada arquivo / unit do journald / canal      | Restrinja os receivers; filtros `query:`; um processador `filter` por severidade |
| **Métricas de host**          | Frequência de coleta × número de séries                    | `collection_interval`; remova o scraper `process`; seleção de scrapers           |
| **Cardinalidade de métricas** | Métricas por processo (um conjunto de séries por processo) | Omita ou restrinja o scraper `process`                                           |

### Alavanca 1 — Faça tail apenas das fontes de log necessárias

Os logs são quase sempre a maior fatia. O coletor só lê o que você lista, então a solução é listar menos:

- **Arquivos** — aponte o `filelog` para caminhos específicos, não globs amplos. `/var/log/myapp/error.log` em vez de `/var/log/**`.
- **journald** — restrinja `units:` aos serviços que lhe interessam e aumente `priority:` para descartar entradas `info`/`debug` tagarelas na origem:

  ```yaml
  receivers:
    journald:
      directory: /var/log/journal
      units:
        - ssh.service
        - nginx.service
      priority: warning # info and debug are dropped before export
  ```

- **Windows Event Logs** — o canal `Security` é de longe o de maior volume. Restrinja-o aos IDs de evento que você realmente audita com um `query:` (como mostrado em [Windows Event Logs](#windows-event-logs) acima) ou descarte o canal por completo se você não precisar dele.

### Alavanca 2 — Aumente o intervalo de coleta de métricas

O volume de `hostmetrics` escala diretamente com `collection_interval`. Se você não precisa de resolução de 30 segundos, 60s reduz pela metade o número de pontos de dados:

```yaml
receivers:
  hostmetrics:
    collection_interval: 60s
```

### Alavanca 3 — Remova o scraper por processo (o fator de cardinalidade)

O scraper `process` emite um conjunto separado de séries **para cada processo em execução** no host — em uma máquina movimentada, essa é a maior fonte isolada de cardinalidade de métricas. A menos que você precise de CPU/memória por processo, deixe-o de fora da lista `scrapers:`. Mantenha `processes` (que são apenas um punhado de métricas agregadas de contagem de processos) — é barato. Se você realmente quiser métricas por processo, restrinja-as aos processos que importam:

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

### Alavanca 4 — Descarte registros de baixo valor com um processador `filter`

Quando você quer o receiver mas não toda a sua saída, adicione um processador [`filter`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/filterprocessor) — ele avalia uma condição [OTTL](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/README.md) e **descarta qualquer registro que corresponda**, antes que qualquer coisa seja exportada.

Descarte logs abaixo de um limite de severidade:

```yaml
processors:
  filter/drop-low-severity:
    error_mode: ignore
    logs:
      log_record:
        # Drop anything less severe than WARN (info, debug, trace).
        - "severity_number < SEVERITY_NUMBER_WARN"
```

Descarte uma métrica ruidosa específica que você não plota:

```yaml
processors:
  filter/drop-metrics:
    error_mode: ignore
    metrics:
      metric:
        - 'name == "system.paging.faults"'
```

Então adicione o processador ao pipeline relevante — a ordem importa, então coloque `filter` antes de `batch`:

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

### Um ponto de partida enxuto

Um host **somente de métricas** — sem logs, intervalo grosseiro, sem séries por processo — é a menor pegada útil:

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

Adicione de volta um pipeline de `logs` com um receiver `filelog` ou `journald` de escopo restrito quando precisar dele.

> **Cuidado com o que você corta.** Alertas baseados em log precisam que os logs cheguem: se você filtrar uma severidade ou um canal, os monitors que dependem disso ficam em silêncio. Reduza as fontes sobre as quais você não age, não aquelas que um monitor está observando. Altere uma alavanca por vez e confirme a queda em **Project Settings → Usage History** (o uso é agregado diariamente, então dê um dia ou dois) antes de passar para a próxima.

## OneUptime auto-hospedado

Se você está auto-hospedando o OneUptime, aponte o exporter para o seu próprio host:

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

Se a sua instância for somente HTTP, altere o esquema para `http://` e use a porta apropriada.

## Atrás de um proxy

O OpenTelemetry Collector respeita as variáveis de ambiente padrão `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`. Defina-as no serviço:

- **systemd (Linux):** coloque um `/etc/systemd/system/otelcol-contrib.service.d/proxy.conf` com `[Service]\nEnvironment="HTTPS_PROXY=http://proxy.example.com:3128"` e, em seguida, `sudo systemctl daemon-reload && sudo systemctl restart otelcol-contrib`.
- **launchd (macOS):** adicione um dict `<EnvironmentVariables>` ao plist.
- **Serviço do Windows:** defina as variáveis de ambiente no serviço via `sc.exe config` ou pelo registro em `HKLM\SYSTEM\CurrentControlSet\Services\otelcol-contrib\Environment`.

## Solução de problemas

- **Nenhuma telemetria aparece no OneUptime**
  - Adicione `service.telemetry.logs.level: debug` à configuração e reinicie o coletor para uma saída detalhada.
  - **Linux / macOS:** `journalctl -u otelcol-contrib -f` (Linux) ou `tail -f /var/log/otelcol-contrib.err.log` (macOS).
  - **Windows:** procure em _Event Viewer → Windows Logs → Application_ pela origem `otelcol-contrib`.
  - Confirme que o host consegue alcançar `https://oneuptime.com/otlp` (ou o seu endpoint auto-hospedado): `curl -v https://oneuptime.com/otlp` a partir da mesma máquina.
- **HTTP 401 do exporter** — o token de ingestão é inválido ou foi revogado. Gere um novo em _Project Settings → Telemetry Ingestion Keys_.
- **O canal `Security` do Windows Event Log retorna acesso negado** — o serviço não está rodando com privilégios suficientes. Recrie-o sob `LocalSystem` (o padrão com `sc.exe create`) ou conceda à conta de serviço o direito de usuário _Manage auditing and security log_.
- **O receiver `journald` falha ao iniciar** — certifique-se de que `journalctl` esteja no `PATH` do coletor e de que `/var/log/journal` exista (execute `sudo systemd-tmpfiles --create --prefix /var/log/journal` se não existir).
- **Volume / custo alto** — veja [Reduzindo o volume de dados coletados](#reducing-the-volume-of-data-collected): restrinja os receivers (canais específicos do Windows, units do systemd, arquivos de log), aumente o `collection_interval` das métricas, remova o scraper por processo ou adicione um processador `filter` para descartar registros de baixa severidade antes da exportação.

## Próximos passos

- Adicione **Logs Monitors** para alertar sobre padrões de log específicos (por exemplo, alerte quando mais de 5 logons com falha `winlog.event_id = 4625` ocorrerem em uma janela de 5 minutos).
- Adicione **Metrics Monitors** sobre métricas de host (saturação de CPU, pouco espaço em disco, uso de swap).
- Combine isto com o [Server / VM Monitor](/docs/monitor/server-monitor) e o [OneUptime Infrastructure Agent](/docs/monitor/server-monitor) para visibilidade de host de ponta a ponta.
- Envie a mesma configuração para todos os hosts via Ansible / Chef / Puppet / Group Policy / Intune / sua ferramenta existente de gerenciamento de configuração.
