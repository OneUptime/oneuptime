# OneUptime Docker Agent

## Visão geral

O OneUptime Docker Agent é uma imagem de contêiner pré-construída que vem com uma configuração ajustada do OpenTelemetry Collector. Execute-o ao lado dos seus contêineres existentes e ele descobre automaticamente todos os contêineres no host, coleta métricas de CPU / memória / rede / E/S de bloco além de logs de contêiner e encaminha tudo para o OneUptime via OTLP. Uma única imagem, um único comando.

Esta página é o **guia de instalação**. Para configurar monitores e alertas de Docker sobre os dados que o agente coleta, consulte [Docker Monitor](/docs/monitor/docker-monitor).

## Pré-requisitos

- Docker Engine 20.10+
- Acesso a `/var/run/docker.sock` no host
- Um **OneUptime Telemetry Ingestion Token** — crie um em _Project Settings → Telemetry Ingestion Keys_ e copie o valor

## Início rápido (um comando)

Substitua `YOUR_ONEUPTIME_URL`, `YOUR_TELEMETRY_INGESTION_TOKEN` e o nome do host pelos valores do seu ambiente. O nome do host é como este host Docker aparecerá no OneUptime — escolha algo como `prod-docker-01`.

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

É isso. Assim que o agente se conectar, seu host Docker aparecerá automaticamente na seção **Docker** do painel do OneUptime.

## Alternativa — Docker Compose

Se você preferir o Docker Compose, coloque o seguinte em um `docker-compose.yml`:

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

Inicie-o:

```bash
docker compose up -d
```

## Variáveis de ambiente

| Variável                  | Obrigatória | Descrição                                                                                                                   |
| ------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL`           | Sim         | A URL da sua instância OneUptime (por exemplo, `https://oneuptime.com` ou seu host auto-hospedado)                          |
| `ONEUPTIME_SERVICE_TOKEN` | Sim         | Token de ingestão de telemetria de _Project Settings → Telemetry Ingestion Keys_                                            |
| `DOCKER_HOST_NAME`        | Não         | Nome amigável para este host. O padrão é `docker-host`. Defina-o como algo estável por host (por exemplo, `prod-docker-01`) |

## Verificar a instalação

Verifique se o agente está em execução:

```bash
docker ps --filter name=oneuptime-docker-agent
```

Verifique os logs do agente:

```bash
docker logs -f oneuptime-docker-agent
```

Procure por: `"Everything is ready. Begin running and processing data."`

Em cerca de um minuto, o host deve aparecer no painel do OneUptime com métricas e logs fluindo.

## Atualizando o agente

```bash
docker pull oneuptime/docker-agent:release
docker rm -f oneuptime-docker-agent
# Execute novamente o comando `docker run` acima
```

Ou com o Docker Compose:

```bash
docker compose pull
docker compose up -d
```

## Desinstalando o agente

```bash
docker rm -f oneuptime-docker-agent
```

Se você usou o Docker Compose:

```bash
docker compose down
```

## O que é coletado

| Categoria                    | Dados                                                                   |
| ---------------------------- | ----------------------------------------------------------------------- |
| **Métricas de CPU**          | Uso total, percentual de uso, tempo de throttling (por contêiner)       |
| **Métricas de memória**      | Uso, limite, percentual, RSS, cache (por contêiner)                     |
| **Métricas de rede**         | Bytes e pacotes recebidos / transmitidos (por contêiner)                |
| **Métricas de E/S de bloco** | Bytes e operações de leitura / escrita (por contêiner)                  |
| **Informações do contêiner** | Tempo de atividade, contagem de reinicializações, contagem de processos |
| **Logs do contêiner**        | Logs de stdout / stderr de todos os contêineres                         |

## OneUptime auto-hospedado

Se você estiver auto-hospedando o OneUptime, defina `ONEUPTIME_URL` para sua própria instância:

```bash
-e ONEUPTIME_URL="https://your-oneuptime-host.example.com"
```

Se a sua instância for somente HTTP, use `http://` e a porta apropriada.

## Solução de problemas

### Permissão negada no socket do Docker

O contêiner do agente deve ser executado como root (`--user 0:0`) para acessar `/var/run/docker.sock`. Certifique-se de que a flag `--user 0:0` (ou `user: "0:0"` no Compose) esteja presente.

### O agente aparece como desconectado

1. Verifique se o agente está em execução: `docker ps --filter name=oneuptime-docker-agent`
2. Verifique os logs do agente: `docker logs oneuptime-docker-agent | grep -i error`
3. Verifique se sua URL do OneUptime e o token de serviço estão corretos
4. Certifique-se de que seu host Docker consiga alcançar a instância do OneUptime pela rede

### Nenhuma métrica aparece

1. Verifique se o socket do Docker está acessível dentro do agente: `docker exec oneuptime-docker-agent ls -la /var/run/docker.sock`
2. Verifique os logs do collector em busca de erros de exportação: `docker logs oneuptime-docker-agent | tail -100`
3. Certifique-se de que seu token de serviço seja válido e não esteja expirado

### O nome do host aparece como um ID de contêiner

Defina a variável de ambiente `DOCKER_HOST_NAME` com um nome amigável e recrie o contêiner.

## Próximos passos

- Configure **Docker Monitors** para alertar sobre condições de CPU / memória / reinicialização de contêineres — consulte [Docker Monitor](/docs/monitor/docker-monitor).
- Para clusters Kubernetes em vez de hosts Docker independentes, use o [OneUptime Kubernetes Agent](/docs/telemetry/kubernetes-agent).
- Para hosts não conteinerizados (VMs e bare metal Linux / macOS / Windows), use o [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
