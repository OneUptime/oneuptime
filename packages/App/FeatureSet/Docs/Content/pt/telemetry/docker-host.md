# Agente Docker

O agente Docker do OneUptime é um contêiner que você executa em um host Docker. Ele lê as estatísticas e os arquivos de log de cada contêiner do host e os envia ao OneUptime, onde o host aparece com os contêineres, as métricas e os logs dele. Um segundo contêiner, o agente de IA do Docker, permite que a OneUptime AI investigue o host. Os [monitores de Docker](/docs/monitor/docker-monitor) alertam com base no que o agente envia.

:::cards
- [Instale o agente](#instale-o-agente): Dois contêineres, com `docker run` ou Docker Compose.
- [O que o agente coleta](#o-que-o-agente-coleta): Métricas, logs e um inventário de cada contêiner.
- [Logs de contêineres precisam de json-file](#logs-de-contêineres-precisam-do-driver-de-log-json-file): Verifique e troque o driver de log de um contêiner.
- [Solução de problemas](#solução-de-problemas): Loops de reinício, métricas faltando, logs faltando.
:::

## Como funciona

O agente é um OpenTelemetry Collector com a configuração do OneUptime embutida. Pelo socket do Docker, ele lê as estatísticas de cada contêiner a cada 30 segundos e lista cada contêiner, imagem, rede e volume a cada 5 minutos. Ele acompanha os arquivos de log dos contêineres e envia tudo para a sua URL do OneUptime via OTLP, com a chave de ingestão que você fornece.

```mermaid title="Dois contêineres no seu host Docker"
flowchart TB
    containers["Seus contêineres"] -->|"estatísticas, arquivos de log,<br/>inventário"| agent["Agente Docker"]
    agent -->|"OTLP via HTTPS"| oneuptime["OneUptime"]
    oneuptime -->|"investiga um incidente<br/>ou alerta"| ai["Agente de IA do Docker"]
    ai -->|"comandos docker<br/>somente leitura"| containers
```

O host se registra com os primeiros dados, com o nome que você define em `DOCKER_HOST_NAME`. O agente de IA é opcional: deixe-o de fora e o coletor funciona do mesmo jeito.

## Antes de começar

- Docker Engine 20.10 ou posterior e acesso root no host: o agente lê `/var/run/docker.sock`.
- Docker Compose v2 (o comando `docker compose`), se você instalar com Docker Compose.
- Uma chave de ingestão. Crie uma em **Configurações do projeto → Telemetria e APM → Chaves de ingestão** e copie o valor.
- HTTPS de saída do host para a sua URL do OneUptime.
- Para logs de contêineres, contêineres que usam o driver de log `json-file` do Docker, que é o padrão do Docker. Veja [Logs de contêineres precisam do driver de log json-file](#logs-de-contêineres-precisam-do-driver-de-log-json-file).

## Instale o agente

:::steps
### Inicie o agente

Substitua `YOUR_ONEUPTIME_URL` pela sua URL do OneUptime, `YOUR_TELEMETRY_INGESTION_TOKEN` pela chave de ingestão e `my-docker-host` por um nome para este host, como `prod-docker-01`. O nome é como o host aparece no OneUptime, então mantenha-o estável: um nome novo registra um host novo.

:::tabs
@tab Docker CLI
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

Depois inicie o [agente de IA](#agente-de-ia) ao lado dele, com os mesmos valores. **As investigações de IA vêm ativadas por padrão**: enquanto a OneUptime AI investiga um incidente ou alerta neste host, ela executa comandos `docker` somente leitura pelo agente de IA, e não altera nada a menos que você permita correções. Para instalar sem investigações de IA, pule este comando.

```bash
docker run -d \
  --name oneuptime-docker-ai-agent \
  --user 0:0 \
  --restart unless-stopped \
  --read-only --tmpfs /tmp \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e ONEUPTIME_AI_AGENT_RESOURCE_TYPE=docker \
  -e DOCKER_HOST_NAME="my-docker-host" \
  oneuptime/resource-ai-agent:release
```
@tab Docker Compose
Salve isto como `docker-compose.yml` em uma pasta no host. O segundo serviço é o [agente de IA](#agente-de-ia): deixe-o de fora para executar o coletor sem investigações de IA.

```yaml title="docker-compose.yml"
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
  oneuptime-docker-ai-agent:
    image: oneuptime/resource-ai-agent:release
    container_name: oneuptime-docker-ai-agent
    user: "0:0"
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - ONEUPTIME_AI_AGENT_RESOURCE_TYPE=docker
      - DOCKER_HOST_NAME=my-docker-host
```

Inicie-o nessa pasta:

```bash
docker compose up -d
```
:::

### Verifique se o agente está em execução

```bash
docker ps --filter name=oneuptime-docker-agent
docker logs -f oneuptime-docker-agent
```

Os logs devem mostrar esta linha assim que o coletor iniciar:

```text
Everything is ready. Begin running and processing data.
```

### Encontre o host no OneUptime

Abra **Produtos → Infraestrutura → Docker → Todos os hosts**. O host aparece com o `DOCKER_HOST_NAME` dele em cerca de um minuto, com os contêineres, as métricas e os logs dele. O agente de IA aparece como conectado na página **Agente de IA** do host e no fim da **Visão geral** dele.
:::

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `ONEUPTIME_URL` | Sim | A sua URL do OneUptime, como `https://oneuptime.com` ou a sua instância auto-hospedada. Use `http://` e a porta dela se a instância for só HTTP. |
| `ONEUPTIME_SERVICE_TOKEN` | Sim | A chave de ingestão de **Configurações do projeto → Telemetria e APM → Chaves de ingestão**. |
| `DOCKER_HOST_NAME` | Não | O nome do host no OneUptime. O padrão é `docker-host`, então dê um nome próprio a cada host. |
| `DOCKER_API_VERSION` | Não | A versão da API do Docker Engine que o agente usa. O padrão é `1.44`. Reduza-a em um daemon mais antigo, ou defina um valor vazio para negociá-la com o daemon (veja [Solução de problemas](#solução-de-problemas)). |

Para mudar um valor, remova o agente e execute o comando dele de novo (Docker CLI), ou edite `docker-compose.yml` e execute `docker compose up -d` (Docker Compose).

## O que o agente coleta

| Dados | O que é |
| --- | --- |
| Métricas de contêineres | CPU (uso, porcentagem, throttling), memória (uso, limite, porcentagem), E/S de rede e de bloco, tempo de atividade, reinícios e número de processos, por contêiner, a cada 30 segundos. |
| Logs de contêineres | stdout e stderr de cada contêiner, a partir do arquivo de log `json-file` dele. |
| Inventário | Todo contêiner em qualquer estado, e toda imagem, rede e volume, a cada 5 minutos. |

As métricas e os logs de cada contêiner são arquivados em um serviço com o nome do contêiner. Cada linha de log recebe uma severidade a partir do nível que ela cita, como `[ERROR]`, `level=warn` ou `{"level":"info"}`; uma linha que não cita nenhum fica com a do fluxo dela: stderr é `ERROR`, stdout é `INFO`. Linhas que começam com espaço em branco ou com um colchete de fechamento se juntam à linha anterior, então um stack trace chega como um único registro. Os logs do próprio agente ficam de fora.

[Monitor de Docker](/docs/monitor/docker-monitor#métricas-coletadas) lista cada métrica e o que ela significa.

## Logs de contêineres precisam do driver de log json-file

O agente acompanha `/var/lib/docker/containers/*/*-json.log`, os arquivos que o driver de log `json-file` do Docker grava. Um contêiner que usa outro driver não deixa arquivo para ler: `local` grava arquivos binários, e `journald`, `syslog`, `fluentd` e `gelf` enviam os logs para outro lugar. As métricas dele continuam chegando; os logs, não.

Verifique o driver de log de um contêiner e o padrão do daemon:

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
docker info --format '{{.LoggingDriver}}'
```

Mude um serviço do Compose para `json-file`, com rotação:

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

Ou torne-o o padrão para todo contêiner criado depois, em `/etc/docker/daemon.json`:

```json title="/etc/docker/daemon.json"
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

Depois reinicie o Docker e recrie os contêineres. Um contêiner mantém o driver de log com que foi criado, então reiniciá-lo não basta.

## Atualizando o agente

Quando o agente é mais antigo que o seu OneUptime, um sinal de aviso aparece ao lado de **Versão do agente** na **Visão geral** do host. Selecione-o para ver estes comandos.

:::tabs
@tab Docker CLI
```bash
docker pull oneuptime/docker-agent:release
docker pull oneuptime/resource-ai-agent:release
docker rm -f oneuptime-docker-agent oneuptime-docker-ai-agent
```

Depois execute de novo os dois comandos `docker run` de [Inicie o agente](#inicie-o-agente).
@tab Docker Compose
```bash
docker compose pull
docker compose up -d
```
:::

A tag `release` sempre aponta para a versão mais recente. Para fixar uma versão, use `oneuptime/docker-agent:<version>`, como `oneuptime/docker-agent:10.0.31`. A mesma imagem está no GitHub Container Registry como `ghcr.io/oneuptime/docker-agent:release`.

## Desinstalando o agente

:::tabs
@tab Docker CLI
```bash
docker rm -f oneuptime-docker-agent
docker rm -f oneuptime-docker-ai-agent
```
@tab Docker Compose
```bash
docker compose down
```
:::

O host continua no OneUptime com os dados que enviou. Se não precisar mais dele, exclua-o com **Excluir host** no menu dele.

## Agente de IA

Os comandos e o arquivo do Compose acima, o `install.sh` do agente Docker e o `docker-compose.yml` no [diretório DockerAgent](https://github.com/OneUptime/oneuptime/tree/master/agents/DockerAgent) dele executam todos o **Agente de IA do Docker**: um segundo contêiner, `oneuptime-docker-ai-agent` (imagem `oneuptime/resource-ai-agent:release`), que executa os comandos `docker` somente leitura que a OneUptime AI pede enquanto investiga um incidente ou alerta neste host — `docker ps -a`, `docker logs --tail 200 web`, `docker container inspect web`, `docker stats --no-stream` — e, só se você permitir, aplica correções como reiniciar um contêiner específico. Ele lê os mesmos `ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN` e `DOCKER_HOST_NAME` que o coletor, então atende exatamente este host, e aparece na página **Agente de IA** do host no OneUptime.

- **As investigações de IA vêm ativadas por padrão.** Assim que o agente se conecta, a OneUptime AI investiga com ele os incidentes e alertas deste host, e a **Visão geral** do host mostra o status do agente. Para parar, defina `ONEUPTIME_AI_INVESTIGATION=false` onde o agente é executado (**Alterar**, em **O que a IA pode fazer** na página do agente de IA, mostra como), ou deixe o agente de fora.
- Ele é somente leitura, a menos que você o inicie com `ONEUPTIME_AI_ALLOW_WRITES=true`; `ONEUPTIME_AI_WRITE_TARGETS` (por exemplo `web-*,api-*`) limita quais contêineres uma correção pode tocar. Inicie-o também com `ONEUPTIME_AI_FIXES`, para dizer como as correções são executadas — `ask-for-approval` (uma pessoa aprova cada uma), `automatic` ou `bypass-approval` — e a página do agente de IA mostra isso somente para leitura ([O que a IA pode fazer, definido pelo agente](/docs/ai/infrastructure-ai-agents#what-ai-may-do-set-by-the-agent)).
- Ele é executado como root com o socket do Docker montado, porque o socket pertence ao root — e quem pode usar o socket é root neste host, com `:ro` ou não. O limite é a política de comandos do agente: ele nunca executa `exec`, `run`, `rm` ou `prune`, e nunca altera a si mesmo, o coletor ou qualquer coisa em `ONEUPTIME_AI_PROTECTED_TARGETS` (globs de nomes de contêineres). Os valores de ambiente na saída de `docker inspect` são mascarados antes que qualquer coisa saia do host.
- `install.sh --no-ai-agent` o deixa de fora; `docker rm -f oneuptime-docker-ai-agent` o remove. Atualize-o como o coletor: `docker pull oneuptime/resource-ai-agent:release`, remova-o e inicie-o de novo.

O que ele pode executar, como as correções funcionam e como solucionar problemas: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).

## Solução de problemas

:::details O agente reinicia com "client version is too new"
Os logs do agente mostram:

```text
Error: cannot start pipelines: failed to start "docker_stats" receiver:
Error response from daemon: client version 1.44 is too new.
Maximum supported API version is 1.41
```

Um daemon recusa um cliente mais novo que o próprio máximo, então o receiver nunca inicia e o coletor sai junto com ele. Descubra o máximo do daemon:

```bash
docker version --format '{{ .Server.APIVersion }}'
```

Depois adicione `-e DOCKER_API_VERSION=1.41` (ou o valor que você obteve) a `docker run`, ou defina `DOCKER_API_VERSION` no Compose. Daemons mais novos continuam atendendo versões mais antigas da API, então a configuração continua válida depois de uma atualização.

Prefere não procurar o número? Defina `DOCKER_API_VERSION` como a string vazia. O agente então negocia a versão com o daemon (um `HEAD /_ping` e depois o máximo do próprio daemon), o que funciona tanto com daemons antigos quanto novos:

```bash
docker run -d ... -e DOCKER_API_VERSION= ...
```
:::

:::details Permissão negada no socket do Docker
O agente precisa ser executado como root para ler `/var/run/docker.sock`. Verifique se `--user 0:0` está no seu comando `docker run`, ou `user: "0:0"` no Compose.
:::

:::details O host aparece como desconectado
1. Verifique se o agente está em execução: `docker ps --filter name=oneuptime-docker-agent`
2. Procure erros nos logs dele: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`
3. Verifique `ONEUPTIME_URL` e `ONEUPTIME_SERVICE_TOKEN`: a chave precisa ser uma chave de ingestão válida que não foi desativada.
4. Verifique se o host consegue alcançar a sua URL do OneUptime pela rede.
:::

:::details Nenhuma métrica aparece
1. Verifique se o socket do Docker está montado no agente. A imagem dele não tem shell, então olhe a partir de um contêiner descartável que compartilhe as montagens dele: `docker run --rm --volumes-from oneuptime-docker-agent alpine:3.19 ls -la /var/run/docker.sock`
2. Procure erros de exportação nos logs dele: `docker logs oneuptime-docker-agent 2>&1 | tail -100`
3. Verifique se a chave de ingestão é válida e não expirou.
:::

:::details As métricas chegam, mas os logs dos contêineres não
Os seus contêineres provavelmente usam outro driver de log que não `json-file`. Verifique quais arquivos o agente observa e qual driver um contêiner usa:

```bash
docker logs oneuptime-docker-agent 2>&1 | grep -E "Started watching file|no files match"
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

Se o agente informar `no files match the configured criteria`, mude os contêineres para `json-file` e recrie-os, como mostra [Logs de contêineres precisam do driver de log json-file](#logs-de-contêineres-precisam-do-driver-de-log-json-file).
:::

:::details Os logs estão em outro host, ou o host se chama docker-host
O nome do host vem de `DOCKER_HOST_NAME`. Um agente iniciado sem ele informa `docker-host`, então todo host configurado assim parece ser o mesmo; mude o nome depois e o OneUptime registra um segundo host, que passa a ter os dados novos. Defina `DOCKER_HOST_NAME` com um nome próprio em cada host e recrie o agente. Para verificar o nome que o agente informa:

```bash
docker inspect oneuptime-docker-agent --format '{{range .Config.Env}}{{println .}}{{end}}' | grep DOCKER_HOST_NAME
```
:::

## Próximos passos

:::cards
- [Monitor de Docker](/docs/monitor/docker-monitor): Alerte sobre CPU, memória e reinícios dos contêineres.
- [Bancos de dados](/docs/telemetry/databases): Os contêineres de banco de dados do host são encontrados e ganham páginas próprias.
- [Agente Kubernetes](/docs/telemetry/kubernetes-agent): Monitore um cluster Kubernetes em vez disso.
- [Coletor OpenTelemetry no host](/docs/telemetry/host-otel-collector): Monitore a própria máquina: CPU, discos, processos e logs.
:::
