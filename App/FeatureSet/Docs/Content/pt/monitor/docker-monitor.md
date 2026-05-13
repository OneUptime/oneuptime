# Monitor do Docker

O monitoramento do Docker permite monitorar a saúde e o desempenho dos seus hosts Docker e dos contêineres em execução neles. O OneUptime coleta métricas e logs de contêineres via um Coletor OpenTelemetry pré-configurado (o **Agente Docker do OneUptime**) e os avalia em relação aos critérios configurados.

## Visão Geral

Os monitores do Docker usam métricas e logs dos seus hosts para fornecer visibilidade às suas cargas de trabalho de contêineres. Isso permite que você:

- Monitore o host Docker e a saúde por contêiner
- Rastreie CPU, memória, rede, E/S de bloco e contagens de processos em contêineres
- Detecte reinicializações, falhas e limitação de CPU de contêineres
- Transmita logs estruturados de contêineres no formato nativo OpenTelemetry
- Alerte sobre alta CPU, alta memória, loops de reinicialização e mais

## Criando um Monitor do Docker

1. Vá para **Monitors** no Painel do OneUptime
2. Clique em **Create Monitor**
3. Selecione **Docker** como o tipo de monitor
4. Selecione o host Docker e o escopo de recurso para monitorar
5. Configure consultas de métricas e agregação
6. Configure os critérios de monitoramento conforme necessário

## Opções de Configuração

### Host Docker

Selecione o host Docker para monitorar. Os hosts são registrados automaticamente na primeira vez que o Agente Docker do OneUptime envia telemetria deles — você não precisa criá-los manualmente.

### Escopo de Recurso

Escolha o nível no qual monitorar recursos:

| Escopo | Descrição |
|-------|-------------|
| Host | Monitorar todo o host Docker, agregado em todos os contêineres |
| Container | Monitorar um contêiner específico por nome ou imagem |

### Consultas de Métricas

Configure uma ou mais consultas de métricas para avaliar. Cada consulta especifica:

- **Nome da métrica** — A métrica do contêiner a consultar
- **Agregação** — Como agregar valores de métricas (Méd, Soma, Máx, Mín)
- **Filtros** — Filtragem adicional baseada em atributos (ex.: por nome do contêiner, imagem ou host)
- **Group By** — Opcionalmente agrupar por `resource.container.name` para que cada contêiner seja avaliado de forma independente

Você também pode criar **fórmulas** que combinam múltiplas consultas de métricas usando expressões matemáticas.

### Janela de Tempo Deslizante

Selecione a janela de tempo para avaliação de métricas:

- Último 1 Minuto
- Últimos 5 Minutos
- Últimos 10 Minutos
- Últimos 15 Minutos
- Últimos 30 Minutos
- Últimos 60 Minutos

## Métricas Coletadas

O Agente Docker usa o receptor `docker_stats` do OpenTelemetry, que faz scraping da API do Docker Engine em um intervalo configurável (padrão a cada 30 segundos).

### CPU

| Métrica | Descrição |
|--------|-------------|
| `container.cpu.utilization` | Utilização de CPU como porcentagem da CPU do host |
| `container.cpu.usage.total` | Tempo de CPU cumulativo consumido pelo contêiner |
| `container.cpu.throttling_data.throttled_time` | Tempo em que o contêiner foi limitado pelos cgroups |
| `container.cpu.throttling_data.throttled_periods` | Número de períodos de limitação |

### Memória

| Métrica | Descrição |
|--------|-------------|
| `container.memory.usage.total` | Uso atual de memória em bytes |
| `container.memory.usage.limit` | Limite de memória em bytes |
| `container.memory.percent` | Uso de memória como porcentagem do limite |

### Rede

| Métrica | Descrição |
|--------|-------------|
| `container.network.io.usage.rx_bytes` | Total de bytes recebidos |
| `container.network.io.usage.tx_bytes` | Total de bytes transmitidos |

### E/S de Bloco

| Métrica | Descrição |
|--------|-------------|
| `container.blockio.io_service_bytes_recursive.read` | Bytes lidos de dispositivos de bloco |
| `container.blockio.io_service_bytes_recursive.write` | Bytes escritos em dispositivos de bloco |

### Informações do Contêiner

| Métrica | Descrição |
|--------|-------------|
| `container.uptime` | Tempo de atividade do contêiner em segundos |
| `container.restarts` | Número de vezes que o contêiner foi reiniciado |
| `container.pids.count` | Número de processos dentro do contêiner |

## Critérios de Monitoramento

### Tipos de Verificação Disponíveis

| Tipo de Verificação | Descrição |
|------------|-------------|
| Metric Value | O valor da consulta de métrica ou fórmula configurada |

### Tipos de Agregação

| Agregação | Descrição |
|-------------|-------------|
| Average | Valor médio ao longo da janela de tempo |
| Sum | Soma de todos os valores |
| Maximum Value | Maior valor na janela de tempo |
| Minimum Value | Menor valor na janela de tempo |
| All Values | Todos os valores devem corresponder aos critérios |
| Any Value | Pelo menos um valor deve corresponder |

### Tipos de Filtro

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

## Modelos de Alerta Pré-construídos

O OneUptime fornece modelos para cenários comuns de monitoramento do Docker:

| Modelo | Descrição | Limite | Agregação |
|----------|-------------|-----------|-------------|
| High Container CPU | Utilização de CPU por contêiner | > 90% | Máx (por contêiner) |
| High Container Memory | Uso de memória como porcentagem do limite | > 85% | Máx (por contêiner) |
| High CPU Throttling | Períodos limitados de CPU | > 0 | Máx (por contêiner) |
| Container Restart Loop | Contagem de reinicializações do contêiner | > 3 | Soma |
| Container Down | Tempo de atividade do contêiner reiniciado para 0 | = 0 | Mín |

> Nota: Os modelos de CPU, memória e limitação usam agregação **Máx** agrupada por `resource.container.name`. Isso impede que o sinal de um único contêiner com alta carga seja diluído por muitos contêineres ociosos no mesmo host.

## Logs Coletados

Além das métricas, o Agente Docker acompanha o arquivo `*-json.log` de cada contêiner via o receptor filelog do OpenTelemetry e envia registros de log no formato OTLP nativo. Cada registro de log é enriquecido com:

- `resource.host.name` — o identificador do host Docker
- `resource.container.id` — o ID completo do contêiner
- `resource.container.runtime` — sempre `docker`
- `attributes["log.iostream"]` — `stdout` ou `stderr`
- `severityText` / `severityNumber` — derivado do stream: `stderr` → `ERROR`, `stdout` → `INFO`
- `body` — a linha de log bruta emitida pelo processo do contêiner
- `time` — o timestamp do daemon Docker para a linha

Os logs aparecem na aba **Logs** do host Docker e na página de detalhes de cada contêiner.

### Requisito do Driver de Log

**O Agente Docker apenas ingere logs de contêineres que usam o driver de log `json-file` do Docker.** Este é o padrão do Docker, mas pode ser substituído por contêiner ou globalmente:

- Driver **`local`** — escreve fragmentos de protobuf binário em `/var/lib/docker/containers/<id>/local-logs/container.log`. O receptor filelog não pode analisar este formato.
- **`journald`**, **`syslog`**, **`fluentd`**, **`gelf`**, **`awslogs`**, **`splunk`**, etc. — enviam logs para um destino remoto; nenhum arquivo para acompanhar.
- **`none`** — descarta os logs completamente.

Se algum dos acima estiver em uso, você verá métricas na página do host Docker, mas a aba **Logs** estará vazia (ou conterá apenas os logs do próprio Agente Docker).

**Verificar o driver de log de um contêiner específico:**

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

**Verificar o padrão do daemon:**

```bash
docker info --format '{{.LoggingDriver}}'
```

**Mudar um serviço do Docker Compose para `json-file` com rotação adequada:**

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

**Mudar o padrão do daemon** (aplica-se a cada contêiner criado depois) editando `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

Em seguida, reinicie o daemon Docker e **recrie** os contêineres afetados. O Docker vincula o driver de log no momento da criação do contêiner, portanto, um contêiner existente mantém seu driver antigo até ser removido e recriado:

```bash
# Docker Compose
docker compose up -d --force-recreate <service>

# Docker simples
docker rm -f <container>
docker run ... <image>
```

## Requisitos de Configuração

Para usar o monitoramento do Docker, você precisa:

1. Instalar o Agente Docker do OneUptime em cada host Docker que deseja monitorar
2. Passar `ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN` e `DOCKER_HOST_NAME` como variáveis de ambiente
3. Garantir que os contêineres que você deseja observar usem o driver de log `json-file` (consulte acima)

O agente é publicado como `oneuptime/docker-agent:release` no Docker Hub. Consulte o [guia de instalação do Agente Docker](https://github.com/OneUptime/oneuptime/tree/master/DockerAgent) para os exemplos completos de `docker run` e `docker compose`.

## Solução de Problemas

### Métricas aparecem, mas a aba Logs está vazia

Seus contêineres quase certamente não estão usando o driver de log `json-file`. Execute os comandos de diagnóstico na seção [Requisito do Driver de Log](#requisito-do-driver-de-log) acima e mude os contêineres que precisam ter seus logs enviados.

### O receptor filelog registra `no files match the configured criteria`

Isso significa que o glob de inclusão `/var/lib/docker/containers/*/*-json.log` não correspondeu a nenhum arquivo quando o agente foi iniciado. Ou:

1. Nenhum contêiner neste host está usando `json-file`, ou
2. O bind mount `-v /var/lib/docker/containers:/var/lib/docker/containers:ro` está ausente ou apontando para um diretório vazio, ou
3. O agente está sendo executado no Docker Desktop para macOS sem o diretório de contêineres da VM Linux exposto.

### Os logs chegam, mas estão agrupados sob o nome de host errado

O OneUptime registra automaticamente os hosts Docker por `resource.host.name`, que é retirado da variável de ambiente `DOCKER_HOST_NAME`. Alterar `DOCKER_HOST_NAME` após o primeiro lote de telemetria criará uma segunda linha de host em vez de renomear a existente.

### Incidentes não estão disparando para "High CPU"

Certifique-se de que a agregação da consulta de métrica seja **Máx** (não Méd) e que esteja agrupada por `resource.container.name`. Uma Méd em todos os contêineres em um host ocupado é diluída por contêineres ociosos e raramente cruza o limite.
