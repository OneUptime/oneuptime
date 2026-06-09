# Coletor OpenTelemetry de Host (Linux, macOS, Windows)

## Visão geral

Você pode executar o **OpenTelemetry Collector** como um serviço diretamente em seus hosts Linux, macOS ou Windows para enviar telemetria de host ao OneUptime via OTLP. Esta página orienta a instalação do coletor, sua configuração para cada SO e a escolha dos receivers corretos para o que você deseja coletar:

- **Métricas de host** (CPU, memória, disco, sistema de arquivos, rede, carga, processos) em todos os SOs
- **Logs baseados em arquivo** em `/var/log/**` (Linux, macOS) via [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver)
- **journal do systemd** (Linux) via [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver)
- **Apple Unified Log** (macOS) via [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor) encapsulando uma saída de `log stream` em tail
- **Windows Event Logs** via [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver)
- **Status de serviços do Windows** (alimenta a aba **Services** do host) via [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver)

> **E quanto ao OneUptime Infrastructure Agent?** Esse agente é um daemon Go leve e separado, focado em métricas básicas e no recurso *Server / VM Monitor* (status, processos, alertas). O OpenTelemetry Collector descrito aqui é independente e é a ferramenta certa quando você quer logs (logs de arquivo, journald, Windows Event Logs) ou métricas de host mais ricas ingeridas como OTLP padrão. Ambos podem rodar no mesmo host sem interferir um no outro.

## Pré-requisitos

- Um **OneUptime Telemetry Ingestion Token** — crie um em *Project Settings → Telemetry Ingestion Keys* e copie o valor do `x-oneuptime-token`.
- A distribuição **OpenTelemetry Collector Contrib** (`otelcol-contrib`). O build padrão `otelcol` **não** inclui receivers como `windowseventlogreceiver`, `journaldreceiver` ou extras de `hostmetrics` — certifique-se de usar a distribuição `contrib`.
- Root / Administrador no host para instalar o coletor como serviço e (quando aplicável) ler fontes de log privilegiadas.

## Passo 1 — Instalar o OpenTelemetry Collector

Escolha a seção para o seu SO. Todos os exemplos assumem que você está instalando a release mais recente do `otelcol-contrib` a partir de [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases).

### Linux (Debian / Ubuntu)

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.107.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

O pacote Debian instala o binário em `/usr/bin/otelcol-contrib`, a configuração padrão em `/etc/otelcol-contrib/config.yaml` e uma unit do systemd em `/etc/systemd/system/otelcol-contrib.service`.

### Linux (RHEL / CentOS / Fedora / Amazon Linux)

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.107.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

Os caminhos correspondem ao pacote Debian (`/usr/bin/otelcol-contrib`, `/etc/otelcol-contrib/config.yaml`, unit do systemd `otelcol-contrib`).

### macOS

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/arm64/arm64/')
VERSION=0.107.0

curl -L -o otelcol-contrib.tar.gz \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_darwin_${ARCH}.tar.gz"

sudo mkdir -p /usr/local/otelcol-contrib
sudo tar -xzf otelcol-contrib.tar.gz -C /usr/local/otelcol-contrib
sudo ln -sf /usr/local/otelcol-contrib/otelcol-contrib /usr/local/bin/otelcol-contrib
sudo mkdir -p /etc/otelcol-contrib
```

Você criará `/etc/otelcol-contrib/config.yaml` no Passo 2 e um plist do `launchd` no Passo 3.

### Windows

Baixe o `otelcol-contrib_*_windows_amd64.zip` mais recente (ou `arm64`) da [página de releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases). A partir de um prompt **elevado** do PowerShell:

```powershell
$dest = "C:\Program Files\otelcol-contrib"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Expand-Archive -Path "$env:USERPROFILE\Downloads\otelcol-contrib_*_windows_amd64.zip" -DestinationPath $dest
```

Você criará `C:\Program Files\otelcol-contrib\config.yaml` no Passo 2 e registrará um serviço do Windows no Passo 3.

## Passo 2 — Configurar o coletor

O arquivo de configuração fica em:

| SO | Caminho |
|---|---|
| Linux | `/etc/otelcol-contrib/config.yaml` |
| macOS | `/etc/otelcol-contrib/config.yaml` |
| Windows | `C:\Program Files\otelcol-contrib\config.yaml` |

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
          layout: '%Y-%m-%d %H:%M:%S.%f%j'
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

Para ler um canal personalizado ou específico de aplicação (qualquer coisa que você consiga ver em *Event Viewer → Applications and Services Logs*), use seu nome de exibição exato:

```yaml
  windowseventlog/iis:
    channel: Microsoft-IIS-Logging/Logs
    start_at: end
```

### Windows Services (métricas)

Reporte o estado de execução e o tipo de inicialização dos serviços do Windows via [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver). É isso que popula a aba **Services** do host no OneUptime. É um receiver de *métricas*, então ele pertence ao pipeline de métricas (não ao de logs):

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
```

O receiver emite um gauge `windows.service.status` por serviço — o inteiro é o estado do serviço Win32 (`4` = em execução, `1` = parado) — com os atributos `name` e `startup_mode`. É **somente para Windows** (o coletor falha ao iniciar se você o habilitar no Linux ou macOS) e está atualmente em **alpha**, então fixe uma release recente do `otelcol-contrib`. Executar o serviço como `LocalSystem` (o padrão com `sc.exe create`) permite que ele leia todos os serviços.

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

`C:\Program Files\otelcol-contrib\config.yaml`:

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
      # 'load' is not supported on Windows — omit it or the scraper errors.
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
sc.exe create "otelcol-contrib" `
  binPath= "\"C:\Program Files\otelcol-contrib\otelcol-contrib.exe\" --config=\"C:\Program Files\otelcol-contrib\config.yaml\"" `
  start= auto `
  DisplayName= "OpenTelemetry Collector"

sc.exe description "otelcol-contrib" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "otelcol-contrib"
sc.exe query "otelcol-contrib"
```

O serviço roda sob `LocalSystem` por padrão, que tem os privilégios necessários para ler o canal `Security` do Windows Event Log.

## Passo 4 — Verificar no OneUptime

1. Gere algum sinal no host:
   - **Linux / macOS:** `logger "hello from oneuptime"` (escreve no syslog / journald).
   - **Windows:** `eventcreate /T INFORMATION /ID 999 /L APPLICATION /SO OneUptimeTest /D "hello from oneuptime"` a partir de um prompt elevado.
2. No dashboard do OneUptime, abra **Telemetry → Services** e escolha o `service.name` que você configurou.
3. Abra **Metrics** — as métricas de host (CPU, memória, sistema de arquivos, etc.) devem aparecer em até um minuto.
4. Abra **Logs** — seus logs de arquivo / entradas do journald / Windows Event Logs devem estar chegando. Atributos pesquisáveis úteis incluem `log.file.name`, `systemd.unit`, `winlog.channel`, `winlog.event_id` e `winlog.provider.name`.

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
  - **Windows:** procure em *Event Viewer → Windows Logs → Application* pela origem `otelcol-contrib`.
  - Confirme que o host consegue alcançar `https://oneuptime.com/otlp` (ou o seu endpoint auto-hospedado): `curl -v https://oneuptime.com/otlp` a partir da mesma máquina.
- **HTTP 401 do exporter** — o token de ingestão é inválido ou foi revogado. Gere um novo em *Project Settings → Telemetry Ingestion Keys*.
- **O canal `Security` do Windows Event Log retorna acesso negado** — o serviço não está rodando com privilégios suficientes. Recrie-o sob `LocalSystem` (o padrão com `sc.exe create`) ou conceda à conta de serviço o direito de usuário *Manage auditing and security log*.
- **O receiver `journald` falha ao iniciar** — certifique-se de que `journalctl` esteja no `PATH` do coletor e de que `/var/log/journal` exista (execute `sudo systemd-tmpfiles --create --prefix /var/log/journal` se não existir).
- **Volume / custo alto** — restrinja os receivers (canais específicos do Windows, units específicas do systemd, arquivos de log específicos), adicione um filtro `query:` no receiver do Windows Event Log ou adicione um processador `filter` para descartar eventos de baixa severidade antes da exportação.

## Próximos passos

- Adicione **Logs Monitors** para alertar sobre padrões de log específicos (por exemplo, alerte quando mais de 5 logons com falha `winlog.event_id = 4625` ocorrerem em uma janela de 5 minutos).
- Adicione **Metrics Monitors** sobre métricas de host (saturação de CPU, pouco espaço em disco, uso de swap).
- Combine isto com o [Server / VM Monitor](/docs/monitor/server-monitor) e o [OneUptime Infrastructure Agent](/docs/monitor/server-monitor) para visibilidade de host de ponta a ponta.
- Envie a mesma configuração para todos os hosts via Ansible / Chef / Puppet / Group Policy / Intune / sua ferramenta existente de gerenciamento de configuração.
