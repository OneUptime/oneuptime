import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Podman setup guide in Portuguese (#8341): each piece of the English
 * guide's markdown (Pages/Podman/Utils/DocumentationMarkdown.ts) and its
 * Portuguese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Portuguese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Podman 4.0+": "Podman 4.0 ou posterior",
  "Podman's Docker-compatible API socket at `/run/podman/podman.sock` — turn it on with `sudo systemctl enable --now podman.socket`":
    "O socket de API compatível com o Docker do Podman em `/run/podman/podman.sock`: ative-o com `sudo systemctl enable --now podman.socket`",
  "Containers whose logs you want must use the `k8s-file` log driver — rootful Podman defaults to `journald`, which the agent cannot read":
    "Os contêineres cujos registros você quer devem usar o driver de log `k8s-file`: o Podman rootful usa `journald` por padrão, que o agente não consegue ler",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "Depois inicie o agente de IA do OneUptime ao lado dele, com a mesma URL, chave e nome de host. **As investigações de IA ficam ativadas por padrão**: enquanto o OneUptime AI investiga um incidente ou alerta neste host, ele executa comandos `docker` somente leitura pelo agente de IA, no socket compatível com o Docker do Podman, e não altera nada, a menos que você permita correções; veja **O agente de IA do OneUptime** em Avançado. Pule este comando para executar o coletor sem investigações de IA.",
  "Replace `my-podman-host` with a name for this host, such as `prod-podman-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "Substitua `my-podman-host` por um nome para este host, como `prod-podman-01`. É assim que o host aparece no OneUptime, então mantenha-o estável: um nome novo registra um host novo.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Escolha uma chave de ingestão na etapa 1 para preencher `<YOUR_API_KEY>`.",
  "Look for this line in the logs:": "Procure esta linha nos registros:",
  "Once the agent connects, the host appears automatically in the **Podman** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "Assim que o agente se conecta, o host aparece automaticamente na seção **Podman**, normalmente em cerca de um minuto. O agente de IA do OneUptime aparece como Conectado na página **IA → Agente de IA** do host e no fim da sua **Visão geral**.",
  "**Metrics but no logs?** Rootful Podman writes container logs to `journald` by default, which the agent cannot read. Run your containers with `--log-driver k8s-file` — see **Collect logs from every container (k8s-file log driver)** under Advanced.":
    "**Métricas, mas nenhum registro?** O Podman rootful grava os registros dos contêineres no `journald` por padrão, que o agente não consegue ler. Execute os seus contêineres com `--log-driver k8s-file`; veja **Coletar os registros de todos os contêineres (driver de log k8s-file)** em Avançado.",
  "| Variable | Required | Description |":
    "| Variável | Obrigatória | Descrição |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Sim | A URL da sua instância do OneUptime (por ex., `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | Sim | A chave de ingestão de telemetria da etapa 1 |",
  "| `PODMAN_HOST_NAME` | No | Friendly name for this host. Defaults to `podman-host` |":
    "| `PODMAN_HOST_NAME` | Não | Um nome amigável para este host. O padrão é `podman-host` |",
  "| `DOCKER_API_VERSION` | No | Docker API version the agent speaks to the Podman socket. Empty by default: the agent negotiates it with the socket. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | Não | A versão da API do Docker que o agente usa com o socket do Podman. Vazia por padrão: o agente a negocia com o socket. Defina-a só para fixar uma versão (veja Solução de problemas) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` a `ONEUPTIME_LOG_OPERATOR_5` | Não | Operadores próprios do coletor, cada um em JSON, para um formato de log que o agente não lê |",
  "Pass each one to `podman run` as `-e NAME=value`. To change one later, remove the agent with `podman rm -f oneuptime-podman-agent` and run the command again with the new value.":
    "Passe cada uma ao `podman run` como `-e NAME=value`. Para alterar uma depois, remova o agente com `podman rm -f oneuptime-podman-agent` e execute o comando de novo com o novo valor.",
  "The agent reads the files Podman's **`k8s-file`** log driver writes — `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` — so it only sees logs from containers that use it (or `json-file`, which Podman treats as the same file-based driver). Rootful Podman's default is **`journald`**, which it cannot read, and neither can it read a remote driver such as `syslog`.":
    "O agente lê os arquivos que o driver de log **`k8s-file`** do Podman grava (`/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log`), então só vê os registros dos contêineres que o usam (ou `json-file`, que o Podman trata como o mesmo driver baseado em arquivos). O padrão do Podman rootful é **`journald`**, que ele não consegue ler, assim como não consegue ler um driver remoto como `syslog`.",
  "Check a container's log driver, and Podman's default:":
    "Verifique o driver de log de um contêiner e o padrão do Podman:",
  "Run a single container with `k8s-file`:":
    "Execute um único contêiner com `k8s-file`:",
  "Switch a Compose service to `k8s-file`, with rotation:":
    "Mude um serviço do Compose para `k8s-file`, com rotação:",
  "Or change the default for every container created afterwards, in `containers.conf` (`/etc/containers/containers.conf` rootful, `~/.config/containers/containers.conf` rootless):":
    "Ou altere o padrão para todos os contêineres criados depois, em `containers.conf` (`/etc/containers/containers.conf` no modo rootful, `~/.config/containers/containers.conf` no rootless):",
  "Then **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with. Must keep `journald`? The agent still collects metrics through the socket; only container logs need the file-based driver.":
    "Depois **recrie** (não basta reiniciar) os contêineres afetados: um contêiner mantém o driver de log com que foi criado. Precisa manter o `journald`? O agente continua coletando métricas pelo socket; só os registros dos contêineres precisam do driver baseado em arquivos.",
  "`oneuptime-podman-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `podman rm -f oneuptime-podman-ai-agent`.":
    "`oneuptime-podman-ai-agent`, o segundo contêiner que a etapa 2 inicia, executa os comandos `docker` que o OneUptime AI pede (pelo socket compatível com o Docker do Podman) enquanto investiga um incidente ou alerta neste host. **As investigações de IA ficam ativadas por padrão**: assim que ele se conecta, o OneUptime AI investiga com ele, e a página **IA → Agente de IA** do host e a sua **Visão geral** mostram o status dele. Para desativar as investigações, use **O que a IA pode fazer** nessa página; para executar o coletor sem o agente de IA, remova-o com `podman rm -f oneuptime-podman-ai-agent`.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **Somente leitura por padrão.** Ele executa comandos como `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` e `docker stats --no-stream`, nunca `exec`, `run`, `rm` nem `prune`. Os valores de ambiente na saída do `docker inspect` são mascarados antes que qualquer coisa saia do host.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **As correções são opcionais.** Adicione `-e ONEUPTIME_AI_ALLOW_WRITES=true` ao comando para permitir que ele reinicie, inicie, pare, pause, encerre ou altere os limites de um contêiner nomeado. `ONEUPTIME_AI_FIXES`, ao lado, diz se cada correção precisa de aprovação (`ask-for-approval`, `automatic` ou `bypass-approval`), e a página **IA → Agente de IA** do host mostra isso. `ONEUPTIME_AI_WRITE_TARGETS` (globs separados por vírgula, como `web-*,api-*`) limita quais contêineres; `ONEUPTIME_AI_PROTECTED_TARGETS` adiciona contêineres que ele nunca deve alterar. Ele nunca altera a si mesmo nem o coletor.",
  "- It needs the same socket as the collector, and runs as root because the socket is root-owned. The socket's `:ro` mount does not make the API read-only — the agent's command policy is the limit.":
    "- Ele precisa do mesmo socket que o coletor e roda como root porque o socket pertence ao root. A montagem `:ro` do socket não torna a API somente leitura: o limite é a política de comandos do agente.",
  "- Its logs: `podman logs -f oneuptime-podman-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- Os registros dele: `podman logs -f oneuptime-podman-ai-agent`. O que ele pode executar e como as correções funcionam: [Agentes de IA de infraestrutura](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| Tag | Descrição |",
  "| `oneuptime/podman-agent:release` | Latest stable release (community) |":
    "| `oneuptime/podman-agent:release` | Última versão estável (community) |",
  "| `oneuptime/podman-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/podman-agent:enterprise-release` | Última versão estável (enterprise) |",
  "| `oneuptime/podman-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/podman-agent:<version>` | Uma versão fixada, por ex., `10.0.31` |",
  "| `ghcr.io/oneuptime/podman-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/podman-agent:release` | A mesma imagem, espelhada no GHCR |",
  "Use one in place of `oneuptime/podman-agent:release` at the end of the `podman run` command.":
    "Use uma no lugar de `oneuptime/podman-agent:release` no fim do comando `podman run`.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**Atualizar**: baixe a imagem mais recente e remova o agente em execução:",
  "Then run both `podman run` commands from step 2 again.":
    "Depois execute de novo os dois comandos `podman run` da etapa 2.",
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
  "| **Container Logs** | stdout/stderr logs from all containers that use the `k8s-file` log driver |":
    "| **Logs de contêineres** | Registros stdout/stderr de todos os contêineres que usam o driver de log `k8s-file` |",
  'The metrics come from the collector\'s `docker_stats` receiver, through Podman\'s Docker-compatible socket, so their names are the same as the Docker agent\'s. Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'As métricas vêm do receiver `docker_stats` do coletor, pelo socket compatível com o Docker do Podman, então os nomes delas são os mesmos do agente Docker. Cada linha de registro recebe uma severidade a partir do nível que indica (`[ERROR]`, `level=warn`, `{"level":"info"}`); uma linha sem nível recorre ao seu fluxo: stderr é `ERROR` e stdout é `INFO`.',
  "The agent must run as root to read `/run/podman/podman.sock`. Make sure the `--user 0:0` flag is in your `podman run` command, and that the socket is on:":
    "O agente precisa rodar como root para ler `/run/podman/podman.sock`. Verifique se a opção `--user 0:0` está no seu comando `podman run` e se o socket está ativado:",
  "That is rootful Podman's socket, the one the agent reads. Running Podman rootless? Its socket is `/run/user/<uid>/podman/podman.sock` (turn it on with `systemctl --user enable --now podman.socket`) and its storage `~/.local/share/containers/storage`: mount those at `/run/podman/podman.sock` and `/var/lib/containers/storage` in the agent's container instead — see the Podman agent documentation.":
    "Esse é o socket do Podman rootful, o que o agente lê. Usa o Podman no modo rootless? O socket dele é `/run/user/<uid>/podman/podman.sock` (ative-o com `systemctl --user enable --now podman.socket`) e o armazenamento `~/.local/share/containers/storage`: monte-os em `/run/podman/podman.sock` e `/var/lib/containers/storage` no contêiner do agente; veja a documentação do agente Podman.",
  "The agent's logs show:": "Os registros do agente mostram:",
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Remove the agent (`podman rm -f oneuptime-podman-agent`), pull the latest image (`podman pull oneuptime/podman-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the socket.":
    "Um servidor que impõe um máximo recusa um cliente mais novo, o coletor sai por causa disso e o contêiner reinicia em loop. O agente fixa uma versão da API do Docker só quando `DOCKER_API_VERSION` indica uma, e uma imagem antiga do agente fixava `1.44`. Remova o agente (`podman rm -f oneuptime-podman-agent`), baixe a imagem mais recente (`podman pull oneuptime/podman-agent:release`) e execute de novo o comando da etapa 2, sem `-e DOCKER_API_VERSION`. Então o agente negocia a versão com o socket.",
  "To pin a version anyway, use no more than the version the socket reports:":
    "Para fixar uma versão mesmo assim, não passe da versão que o socket informa:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "Adicione-a ao comando, por ex., `-e DOCKER_API_VERSION=1.41`. Servidores mais novos continuam atendendo versões antigas da API, então uma versão fixada continua funcionando depois de uma atualização.",
  "1. Check that the agent is running: `podman ps --filter name=oneuptime-podman-agent`":
    "1. Verifique se o agente está em execução: `podman ps --filter name=oneuptime-podman-agent`",
  "2. Check the agent's logs for errors: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`":
    "2. Procure erros nos registros do agente: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `podman run` command are correct.":
    "3. Verifique se a URL do OneUptime e a chave de ingestão no comando `podman run` estão corretas.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. Verifique se o host consegue alcançar a sua instância do OneUptime pela rede.",
  "Check that the Podman socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "Verifique se o socket do Podman está montado no agente. A imagem dele não tem shell, então olhe a partir de um contêiner descartável que compartilhe as montagens dele:",
  "Then look for export errors in the agent's logs — `podman logs oneuptime-podman-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "Depois procure erros de exportação nos registros do agente (`podman logs oneuptime-podman-agent 2>&1 | grep -i error`) e verifique se a chave de ingestão é válida e não expirou.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using a file-based log driver (`k8s-file` or `json-file`) — rootful Podman defaults to `journald`, which the agent cannot read.":
    "As métricas chegam, mas a aba **Registros** está vazia ou mostra só os registros do próprio agente? Muito provavelmente os seus contêineres não usam um driver de log baseado em arquivos (`k8s-file` ou `json-file`): o Podman rootful usa `journald` por padrão, que o agente não consegue ler.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `k8s-file`. Switch them (see **Collect logs from every container (k8s-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "Se a etapa 1 mostrar `no files match the configured criteria`, ou a etapa 3 não listar arquivos dos seus contêineres, eles não usam `k8s-file`. Mude-os (veja **Coletar os registros de todos os contêineres (driver de log k8s-file)** em Avançado) e depois recrie cada um: um contêiner mantém o driver de log com que foi criado:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `PODMAN_HOST_NAME`. Change `PODMAN_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "A página de um host mostra os dados cujo nome de host é o identificador desse host, que o agente tira de `PODMAN_HOST_NAME`. Se você mudar `PODMAN_HOST_NAME` depois que o host se registrou, o OneUptime registra um segundo host com o novo nome, e os registros ficam nele. Verifique o nome que o agente informa:",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and recreate the agent — `podman rm -f oneuptime-podman-agent`, then run the command from step 2 with the new name.":
    "O nome do host vem de `PODMAN_HOST_NAME`. Um agente iniciado sem ele informa `podman-host`, então todos os hosts configurados assim parecem o mesmo host. Defina `PODMAN_HOST_NAME` com um nome próprio em cada host e recrie o agente: `podman rm -f oneuptime-podman-agent` e depois execute o comando da etapa 2 com o novo nome.",
  "This installs the agent for **`web-1`** — keep `PODMAN_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "Isto instala o agente para **`web-1`**: mantenha `PODMAN_HOST_NAME` exatamente como está, ou os dados serão registrados como um host novo.",
  "A compose provider for `podman compose`: `podman-compose` or Docker Compose":
    "Um provedor do Compose para `podman compose`: `podman-compose` ou Docker Compose",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-podman-ai-agent` service to run the collector without AI investigations.":
    "O segundo serviço é o agente de IA do OneUptime, com a mesma URL, chave e nome de host. **As investigações de IA ficam ativadas por padrão**: enquanto o OneUptime AI investiga um incidente ou alerta neste host, ele executa comandos `docker` somente leitura pelo agente de IA, no socket compatível com o Docker do Podman, e não altera nada, a menos que você permita correções; veja **O agente de IA do OneUptime** em Avançado. Exclua o serviço `oneuptime-podman-ai-agent` para executar o coletor sem investigações de IA.",
  "Set each one in the agent's `environment:` list, then run `podman compose up -d` to recreate it with the new values.":
    "Defina cada uma na lista `environment:` do agente e depois execute `podman compose up -d` para recriá-lo com os novos valores.",
  "`oneuptime-podman-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `podman compose up -d --remove-orphans`.":
    "`oneuptime-podman-ai-agent`, o segundo serviço do docker-compose.yml, executa os comandos `docker` que o OneUptime AI pede (pelo socket compatível com o Docker do Podman) enquanto investiga um incidente ou alerta neste host. **As investigações de IA ficam ativadas por padrão**: assim que ele se conecta, o OneUptime AI investiga com ele, e a página **IA → Agente de IA** do host e a sua **Visão geral** mostram o status dele. Para desativar as investigações, use **O que a IA pode fazer** nessa página; para executar o coletor sem o agente de IA, exclua o serviço dele e execute `podman compose up -d --remove-orphans`.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **As correções são opcionais.** Adicione `- ONEUPTIME_AI_ALLOW_WRITES=true` à lista `environment:` dele para permitir que ele reinicie, inicie, pare, pause, encerre ou altere os limites de um contêiner nomeado. `ONEUPTIME_AI_FIXES`, ao lado, diz se cada correção precisa de aprovação (`ask-for-approval`, `automatic` ou `bypass-approval`), e a página **IA → Agente de IA** do host mostra isso. `ONEUPTIME_AI_WRITE_TARGETS` (globs separados por vírgula, como `web-*,api-*`) limita quais contêineres; `ONEUPTIME_AI_PROTECTED_TARGETS` adiciona contêineres que ele nunca deve alterar. Ele nunca altera a si mesmo nem o coletor.",
  "Use one in place of `oneuptime/podman-agent:release` on the agent's `image:` line.":
    "Use uma no lugar de `oneuptime/podman-agent:release` na linha `image:` do agente.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**Atualizar**: na pasta que contém o docker-compose.yml, baixe as imagens mais recentes e recrie os contêineres:",
  "**Uninstall** — stop and remove everything the file started:":
    "**Desinstalar**: pare e remova tudo o que o arquivo iniciou:",
  'The agent must run as root to read `/run/podman/podman.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml, and that the socket is on:':
    'O agente precisa rodar como root para ler `/run/podman/podman.sock`. Verifique se o serviço do agente tem `user: "0:0"` no docker-compose.yml e se o socket está ativado:',
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `podman compose pull` and `podman compose up -d`. The agent then negotiates the version with the socket.":
    "Um servidor que impõe um máximo recusa um cliente mais novo, o coletor sai por causa disso e o contêiner reinicia em loop. O agente fixa uma versão da API do Docker só quando `DOCKER_API_VERSION` indica uma, e uma imagem antiga do agente fixava `1.44`. Tire `DOCKER_API_VERSION` da lista `environment:` do agente e depois execute `podman compose pull` e `podman compose up -d`. Então o agente negocia a versão com o socket.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `podman compose up -d`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "Adicione-a à lista `environment:` do agente, por ex., `- DOCKER_API_VERSION=1.41`, e execute `podman compose up -d`. Servidores mais novos continuam atendendo versões antigas da API, então uma versão fixada continua funcionando depois de uma atualização.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. Verifique se a URL do OneUptime e a chave de ingestão no docker-compose.yml estão corretas.",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and run `podman compose up -d` to recreate the agent with it.":
    "O nome do host vem de `PODMAN_HOST_NAME`. Um agente iniciado sem ele informa `podman-host`, então todos os hosts configurados assim parecem o mesmo host. Defina `PODMAN_HOST_NAME` com um nome próprio em cada host e execute `podman compose up -d` para recriar o agente com ele.",
};

export default TRANSLATION;
