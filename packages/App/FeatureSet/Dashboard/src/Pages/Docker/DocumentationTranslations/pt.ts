import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Docker setup guide in Portuguese (#8341): each piece of the English
 * guide's markdown (Pages/Docker/Utils/DocumentationMarkdown.ts) and its
 * Portuguese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Portuguese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+": "Docker Engine 20.10 ou posterior",
  "Access to `/var/run/docker.sock` on the host":
    "Acesso a `/var/run/docker.sock` no host",
  "Containers whose logs you want must use the `json-file` log driver — Docker's default":
    "Os contêineres cujos registros você quer devem usar o driver de log `json-file`, o padrão do Docker",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "Depois inicie o agente de IA do OneUptime ao lado dele, com a mesma URL, chave e nome de host. **As investigações de IA ficam ativadas por padrão**: enquanto o OneUptime AI investiga um incidente ou alerta neste host, ele executa comandos `docker` somente leitura pelo agente de IA e não altera nada, a menos que você permita correções; veja **O agente de IA do OneUptime** em Avançado. Pule este comando para executar o coletor sem investigações de IA.",
  "Replace `my-docker-host` with a name for this host, such as `prod-docker-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "Substitua `my-docker-host` por um nome para este host, como `prod-docker-01`. É assim que o host aparece no OneUptime, então mantenha-o estável: um nome novo registra um host novo.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Escolha uma chave de ingestão na etapa 1 para preencher `<YOUR_API_KEY>`.",
  "Look for this line in the logs:": "Procure esta linha nos registros:",
  "Once the agent connects, the host appears automatically in the **Docker** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "Assim que o agente se conecta, o host aparece automaticamente na seção **Docker**, normalmente em cerca de um minuto. O agente de IA do OneUptime aparece como Conectado na página **IA → Agente de IA** do host e no fim da sua **Visão geral**.",
  "| Variable | Required | Description |":
    "| Variável | Obrigatória | Descrição |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Sim | A URL da sua instância do OneUptime (por ex., `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | Sim | A chave de ingestão de telemetria da etapa 1 |",
  "| `DOCKER_HOST_NAME` | No | Friendly name for this host. Defaults to `docker-host` |":
    "| `DOCKER_HOST_NAME` | Não | Um nome amigável para este host. O padrão é `docker-host` |",
  "| `DOCKER_API_VERSION` | No | Docker Engine API version the agent speaks. Empty by default: the agent negotiates it with the daemon, so any Docker Engine from 20.10 on works. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | Não | A versão da API do Docker Engine que o agente usa. Vazia por padrão: o agente a negocia com o daemon, então qualquer Docker Engine a partir da 20.10 funciona. Defina-a só para fixar uma versão (veja Solução de problemas) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` a `ONEUPTIME_LOG_OPERATOR_5` | Não | Operadores próprios do coletor, cada um em JSON, para um formato de log que o agente não lê |",
  "Pass each one to `docker run` as `-e NAME=value`. To change one later, remove the agent with `docker rm -f oneuptime-docker-agent` and run the command again with the new value.":
    "Passe cada uma ao `docker run` como `-e NAME=value`. Para alterar uma depois, remova o agente com `docker rm -f oneuptime-docker-agent` e execute o comando de novo com o novo valor.",
  "The agent tails `/var/lib/docker/containers/*/*-json.log`, so it only sees logs from containers that use Docker's **`json-file`** log driver. That is Docker's default, but some hosts switch to `local` (binary files the agent cannot parse) or to a remote driver (`journald`, `syslog`, `fluentd`, `gelf`, …), which leave no files to read.":
    "O agente acompanha `/var/lib/docker/containers/*/*-json.log`, então só vê os registros dos contêineres que usam o driver de log **`json-file`** do Docker. Esse é o padrão do Docker, mas alguns hosts mudam para `local` (arquivos binários que o agente não consegue ler) ou para um driver remoto (`journald`, `syslog`, `fluentd`, `gelf`, …), que não deixam arquivos para ler.",
  "Check a container's log driver, and the daemon's default:":
    "Verifique o driver de log de um contêiner e o padrão do daemon:",
  "Switch a Compose service to `json-file`, with rotation:":
    "Mude um serviço do Compose para `json-file`, com rotação:",
  "Or change the daemon's default for every container created afterwards, in `/etc/docker/daemon.json`:":
    "Ou altere o padrão do daemon para todos os contêineres criados depois, em `/etc/docker/daemon.json`:",
  "Then restart Docker and **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with.":
    "Depois reinicie o Docker e **recrie** (não basta reiniciar) os contêineres afetados: um contêiner mantém o driver de log com que foi criado.",
  "`oneuptime-docker-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `docker rm -f oneuptime-docker-ai-agent`.":
    "`oneuptime-docker-ai-agent`, o segundo contêiner que a etapa 2 inicia, executa os comandos `docker` que o OneUptime AI pede enquanto investiga um incidente ou alerta neste host. **As investigações de IA ficam ativadas por padrão**: assim que ele se conecta, o OneUptime AI investiga com ele, e a página **IA → Agente de IA** do host e a sua **Visão geral** mostram o status dele. Para desativar as investigações, use **O que a IA pode fazer** nessa página; para executar o coletor sem o agente de IA, remova-o com `docker rm -f oneuptime-docker-ai-agent`.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **Somente leitura por padrão.** Ele executa comandos como `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` e `docker stats --no-stream`, nunca `exec`, `run`, `rm` nem `prune`. Os valores de ambiente na saída do `docker inspect` são mascarados antes que qualquer coisa saia do host.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **As correções são opcionais.** Adicione `-e ONEUPTIME_AI_ALLOW_WRITES=true` ao comando para permitir que ele reinicie, inicie, pare, pause, encerre ou altere os limites de um contêiner nomeado. `ONEUPTIME_AI_FIXES`, ao lado, diz se cada correção precisa de aprovação (`ask-for-approval`, `automatic` ou `bypass-approval`), e a página **IA → Agente de IA** do host mostra isso. `ONEUPTIME_AI_WRITE_TARGETS` (globs separados por vírgula, como `web-*,api-*`) limita quais contêineres; `ONEUPTIME_AI_PROTECTED_TARGETS` adiciona contêineres que ele nunca deve alterar. Ele nunca altera a si mesmo nem o coletor.",
  "- It runs as root because the Docker socket is root-owned. The socket's `:ro` mount does not make the Docker API read-only — the agent's command policy is the limit.":
    "- Ele roda como root porque o socket do Docker pertence ao root. A montagem `:ro` do socket não torna a API do Docker somente leitura: o limite é a política de comandos do agente.",
  "- Its logs: `docker logs -f oneuptime-docker-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- Os registros dele: `docker logs -f oneuptime-docker-ai-agent`. O que ele pode executar e como as correções funcionam: [Agentes de IA de infraestrutura](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| Tag | Descrição |",
  "| `oneuptime/docker-agent:release` | Latest stable release (community) |":
    "| `oneuptime/docker-agent:release` | Última versão estável (community) |",
  "| `oneuptime/docker-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/docker-agent:enterprise-release` | Última versão estável (enterprise) |",
  "| `oneuptime/docker-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/docker-agent:<version>` | Uma versão fixada, por ex., `10.0.31` |",
  "| `ghcr.io/oneuptime/docker-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/docker-agent:release` | A mesma imagem, espelhada no GHCR |",
  "Use one in place of `oneuptime/docker-agent:release` at the end of the `docker run` command.":
    "Use uma no lugar de `oneuptime/docker-agent:release` no fim do comando `docker run`.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**Atualizar**: baixe a imagem mais recente e remova o agente em execução:",
  "Then run both `docker run` commands from step 2 again.":
    "Depois execute de novo os dois comandos `docker run` da etapa 2.",
  "**Uninstall:**": "**Desinstalar:**",
  "| Category | Data |": "| Categoria | Dados |",
  "| **CPU Metrics** | Usage total, usage percentage, throttling time (per container) |":
    "| **Métricas de CPU** | Uso total, percentual de uso, tempo de limitação (por contêiner) |",
  "| **Memory Metrics** | Usage, limit, percentage, RSS, cache (per container) |":
    "| **Métricas de memória** | Uso, limite, percentual, RSS, cache (por contêiner) |",
  "| **Network Metrics** | Bytes and packets received/transmitted (per container) |":
    "| **Métricas de rede** | Bytes e pacotes recebidos/transmitidos (por contêiner) |",
  "| **Block I/O Metrics** | Read/write bytes and operations (per container) |":
    "| **Métricas de E/S de bloco** | Bytes e operações de leitura/gravação (por contêiner) |",
  "| **Container Info** | Uptime, restart count, process count |":
    "| **Informações do contêiner** | Tempo de atividade, número de reinicializações, número de processos |",
  "| **Container Logs** | stdout/stderr logs from all containers |":
    "| **Logs de contêineres** | Registros stdout/stderr de todos os contêineres |",
  'Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'Cada linha de registro recebe uma severidade a partir do nível que indica (`[ERROR]`, `level=warn`, `{"level":"info"}`); uma linha sem nível recorre ao seu fluxo: stderr é `ERROR` e stdout é `INFO`.',
  "The agent must run as root to read `/var/run/docker.sock`. Make sure the `--user 0:0` flag is in your `docker run` command.":
    "O agente precisa rodar como root para ler `/var/run/docker.sock`. Verifique se a opção `--user 0:0` está no seu comando `docker run`.",
  "The agent's logs show:": "Os registros do agente mostram:",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Remove the agent (`docker rm -f oneuptime-docker-agent`), pull the latest image (`docker pull oneuptime/docker-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the daemon.":
    "O daemon recusa um cliente mais novo que o seu próprio máximo, o coletor sai por causa disso e o contêiner reinicia em loop. O agente fixa uma versão só quando `DOCKER_API_VERSION` indica uma, e uma imagem antiga do agente fixava `1.44`, que o Docker Engine 20.10 a 24 recusa. Remova o agente (`docker rm -f oneuptime-docker-agent`), baixe a imagem mais recente (`docker pull oneuptime/docker-agent:release`) e execute de novo o comando da etapa 2, sem `-e DOCKER_API_VERSION`. Então o agente negocia a versão com o daemon.",
  "To pin a version anyway, use no more than the daemon's maximum:":
    "Para fixar uma versão mesmo assim, não passe do máximo do daemon:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "Adicione-a ao comando, por ex., `-e DOCKER_API_VERSION=1.41`. Daemons mais novos continuam atendendo versões antigas da API, então uma versão fixada continua funcionando depois de atualizar o Docker.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-docker-agent`":
    "1. Verifique se o agente está em execução: `docker ps --filter name=oneuptime-docker-agent`",
  "2. Check the agent's logs for errors: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`":
    "2. Procure erros nos registros do agente: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `docker run` command are correct.":
    "3. Verifique se a URL do OneUptime e a chave de ingestão no comando `docker run` estão corretas.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. Verifique se o host consegue alcançar a sua instância do OneUptime pela rede.",
  "Check that the Docker socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "Verifique se o socket do Docker está montado no agente. A imagem dele não tem shell, então olhe a partir de um contêiner descartável que compartilhe as montagens dele:",
  "Then look for export errors in the agent's logs — `docker logs oneuptime-docker-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "Depois procure erros de exportação nos registros do agente (`docker logs oneuptime-docker-agent 2>&1 | grep -i error`) e verifique se a chave de ingestão é válida e não expirou.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using the `json-file` log driver.":
    "As métricas chegam, mas a aba **Registros** está vazia ou mostra só os registros do próprio agente? Muito provavelmente os seus contêineres não usam o driver de log `json-file`.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `json-file`. Switch them (see **Collect logs from every container (json-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "Se a etapa 1 mostrar `no files match the configured criteria`, ou a etapa 3 não listar arquivos dos seus contêineres, eles não usam `json-file`. Mude-os (veja **Coletar os registros de todos os contêineres (driver de log json-file)** em Avançado) e depois recrie cada um: um contêiner mantém o driver de log com que foi criado:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `DOCKER_HOST_NAME`. Change `DOCKER_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "A página de um host mostra os dados cujo nome de host é o identificador desse host, que o agente tira de `DOCKER_HOST_NAME`. Se você mudar `DOCKER_HOST_NAME` depois que o host se registrou, o OneUptime registra um segundo host com o novo nome, e os registros ficam nele. Verifique o nome que o agente informa:",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and recreate the agent — `docker rm -f oneuptime-docker-agent`, then run the command from step 2 with the new name.":
    "O nome do host vem de `DOCKER_HOST_NAME`. Um agente iniciado sem ele informa `docker-host`, então todos os hosts configurados assim parecem o mesmo host. Defina `DOCKER_HOST_NAME` com um nome próprio em cada host e recrie o agente: `docker rm -f oneuptime-docker-agent` e depois execute o comando da etapa 2 com o novo nome.",
  "This installs the agent for **`web-1`** — keep `DOCKER_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "Isto instala o agente para **`web-1`**: mantenha `DOCKER_HOST_NAME` exatamente como está, ou os dados serão registrados como um host novo.",
  "Docker Compose v2 (the `docker compose` command)":
    "Docker Compose v2 (o comando `docker compose`)",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-docker-ai-agent` service to run the collector without AI investigations.":
    "O segundo serviço é o agente de IA do OneUptime, com a mesma URL, chave e nome de host. **As investigações de IA ficam ativadas por padrão**: enquanto o OneUptime AI investiga um incidente ou alerta neste host, ele executa comandos `docker` somente leitura pelo agente de IA e não altera nada, a menos que você permita correções; veja **O agente de IA do OneUptime** em Avançado. Exclua o serviço `oneuptime-docker-ai-agent` para executar o coletor sem investigações de IA.",
  "Set each one in the agent's `environment:` list, then run `docker compose up -d` to recreate it with the new values.":
    "Defina cada uma na lista `environment:` do agente e depois execute `docker compose up -d` para recriá-lo com os novos valores.",
  "`oneuptime-docker-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `docker compose up -d --remove-orphans`.":
    "`oneuptime-docker-ai-agent`, o segundo serviço do docker-compose.yml, executa os comandos `docker` que o OneUptime AI pede enquanto investiga um incidente ou alerta neste host. **As investigações de IA ficam ativadas por padrão**: assim que ele se conecta, o OneUptime AI investiga com ele, e a página **IA → Agente de IA** do host e a sua **Visão geral** mostram o status dele. Para desativar as investigações, use **O que a IA pode fazer** nessa página; para executar o coletor sem o agente de IA, exclua o serviço dele e execute `docker compose up -d --remove-orphans`.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **As correções são opcionais.** Adicione `- ONEUPTIME_AI_ALLOW_WRITES=true` à lista `environment:` dele para permitir que ele reinicie, inicie, pare, pause, encerre ou altere os limites de um contêiner nomeado. `ONEUPTIME_AI_FIXES`, ao lado, diz se cada correção precisa de aprovação (`ask-for-approval`, `automatic` ou `bypass-approval`), e a página **IA → Agente de IA** do host mostra isso. `ONEUPTIME_AI_WRITE_TARGETS` (globs separados por vírgula, como `web-*,api-*`) limita quais contêineres; `ONEUPTIME_AI_PROTECTED_TARGETS` adiciona contêineres que ele nunca deve alterar. Ele nunca altera a si mesmo nem o coletor.",
  "Use one in place of `oneuptime/docker-agent:release` on the agent's `image:` line.":
    "Use uma no lugar de `oneuptime/docker-agent:release` na linha `image:` do agente.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**Atualizar**: na pasta que contém o docker-compose.yml, baixe as imagens mais recentes e recrie os contêineres:",
  "**Uninstall** — stop and remove everything the file started:":
    "**Desinstalar**: pare e remova tudo o que o arquivo iniciou:",
  'The agent must run as root to read `/var/run/docker.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml.':
    'O agente precisa rodar como root para ler `/var/run/docker.sock`. Verifique se o serviço do agente tem `user: "0:0"` no docker-compose.yml.',
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `docker compose pull` and `docker compose up -d`. The agent then negotiates the version with the daemon.":
    "O daemon recusa um cliente mais novo que o seu próprio máximo, o coletor sai por causa disso e o contêiner reinicia em loop. O agente fixa uma versão só quando `DOCKER_API_VERSION` indica uma, e uma imagem antiga do agente fixava `1.44`, que o Docker Engine 20.10 a 24 recusa. Tire `DOCKER_API_VERSION` da lista `environment:` do agente e depois execute `docker compose pull` e `docker compose up -d`. Então o agente negocia a versão com o daemon.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `docker compose up -d`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "Adicione-a à lista `environment:` do agente, por ex., `- DOCKER_API_VERSION=1.41`, e execute `docker compose up -d`. Daemons mais novos continuam atendendo versões antigas da API, então uma versão fixada continua funcionando depois de atualizar o Docker.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. Verifique se a URL do OneUptime e a chave de ingestão no docker-compose.yml estão corretas.",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and run `docker compose up -d` to recreate the agent with it.":
    "O nome do host vem de `DOCKER_HOST_NAME`. Um agente iniciado sem ele informa `docker-host`, então todos os hosts configurados assim parecem o mesmo host. Defina `DOCKER_HOST_NAME` com um nome próprio em cada host e execute `docker compose up -d` para recriar o agente com ele.",
};

export default TRANSLATION;
