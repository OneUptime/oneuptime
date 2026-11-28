import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The StorageArray setup guide in Portuguese (#8341): each piece of the English
 * guide's markdown (Pages/StorageArray/Utils/DocumentationMarkdown.ts) and its
 * Portuguese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Portuguese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashArray's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 ou posterior com o plugin Docker Compose v2, em uma máquina que alcance o endereço de gerenciamento do FlashArray por HTTPS (TCP 443)",
  "An administrator account on the FlashArray, to create the agent's read-only user":
    "Uma conta de administrador no FlashArray, para criar o usuário somente leitura do agente",
  "Create the token **without an expiry**, or the agent stops the day it expires.":
    "Crie o token **sem expiração**, ou o agente para no dia em que ele expirar.",
  "SSH to the FlashArray as an administrator. The first command asks for the new user's password; the second prints its API token:":
    "Conecte-se por SSH ao FlashArray como administrador. O primeiro comando pede a senha do novo usuário; o segundo imprime o token de API dele:",
  "1. Open **Settings → Users and Policies** (**Settings → Access** on older releases).":
    "1. Abra **Settings → Users and Policies** (**Settings → Access** em versões mais antigas).",
  "2. From the ⋮ menu of the **Users** panel choose **Create User…**, name it `oneuptime` and give it the **readonly** role.":
    "2. No menu ⋮ do painel **Users**, escolha **Create User…**, dê ao usuário o nome `oneuptime` e atribua a ele a função **readonly**.",
  "3. From the new user's ⋮ menu choose **Create API Token…**, leave **Expires In** empty, and copy the token.":
    "3. No menu ⋮ do novo usuário, escolha **Create API Token…**, deixe **Expires In** vazio e copie o token.",
  "A `purefa_info{...} 1` line means the array serves its metrics natively: carry on. A **404** means its Purity//FA is older (Pure documents the native endpoint for 6.7.0 and later; its exporter's deprecation notice says 6.6.11 and later) — pick **FlashArray, older Purity** at the top of this guide instead.":
    "Uma linha `purefa_info{...} 1` significa que o array fornece as métricas nativamente: continue. Um **404** significa que o Purity//FA dele é mais antigo (a Pure documenta o endpoint nativo para 6.7.0 e posteriores; o aviso de descontinuação do exportador dela indica 6.6.11 e posteriores): escolha **FlashArray, Purity mais antigo** no topo deste guia.",
  "The first line downloads the script as `install.sh`, so you can read it before you run it.":
    "A primeira linha baixa o script como `install.sh`, para que você possa lê-lo antes de executá-lo.",
  "The command carries the platform you picked above. The script asks for:":
    "O comando traz a plataforma que você escolheu acima. O script pede:",
  "- your **OneUptime URL** and **ingestion key**, both shown in step 1 (pick a key there to have them filled in here)":
    "- a sua **URL do OneUptime** e a sua **chave de ingestão**, ambas mostradas na etapa 1 (escolha uma chave lá para que sejam preenchidas aqui)",
  "- an **array name** — how the array appears in OneUptime. Give every array its own and keep it stable: a new name registers a new storage array":
    "- um **nome de array**: como o array aparece no OneUptime. Dê a cada array o seu e mantenha-o estável: um nome novo registra um novo array de armazenamento",
  "- the FlashArray's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- o **endereço de gerenciamento** do FlashArray (nome de host ou IP, sem `https://`) e o **token de API** do usuário somente leitura, que ele lê sem exibir",
  "- whether to verify the array's certificate — answer **N** unless the array carries a certificate from a CA you trust (arrays ship a self-signed one)":
    "- se deve verificar o certificado do array: responda **N**, a menos que o array tenha um certificado de uma CA em que você confia (os arrays vêm com um autoassinado)",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the API token) and starts the agent with Docker Compose.":
    "Ele instala em `/opt/oneuptime-storage-array-agent`, grava um arquivo `.env` que só você pode ler (ele guarda o token de API) e inicia o agente com o Docker Compose.",
  "Download the compose file and the collector configs from this OneUptime into a new folder:":
    "Baixe o arquivo compose e as configurações do coletor deste OneUptime em uma pasta nova:",
  "Create a `.env` file next to them:": "Crie um arquivo `.env` ao lado deles:",
  "- Replace `my-storage-array` with a name for this array, such as `fa-prod-01`. It is how the array appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- Substitua `my-storage-array` por um nome para este array, como `fa-prod-01`. É assim que o array aparece no OneUptime, então mantenha-o estável: um nome novo registra um novo array de armazenamento.",
  "- Set `PURE_FA_ENDPOINT` to the FlashArray's management address — host name or IP, no `https://` — and `PURE_FA_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- Defina `PURE_FA_ENDPOINT` como o endereço de gerenciamento do FlashArray (nome de host ou IP, sem `https://`) e `PURE_FA_API_TOKEN` como o token de API do usuário somente leitura. Execute `chmod 600 .env`: o arquivo guarda o token.",
  "Start the agent:": "Inicie o agente:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Escolha uma chave de ingestão na etapa 1 para preencher `<YOUR_API_KEY>`.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The array then appears automatically in the **Storage Arrays** section after its first scrape, usually within a minute or two.":
    "Procure `Everything is ready. Begin running and processing data.` nos registros. O array então aparece automaticamente na seção **Arrays de armazenamento** após a primeira coleta, normalmente em um ou dois minutos.",
  "The install script writes these to `/opt/oneuptime-storage-array-agent/.env`; a Docker Compose install reads them from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the agent's folder.":
    "O script de instalação as grava em `/opt/oneuptime-storage-array-agent/.env`; uma instalação com Docker Compose as lê do arquivo `.env` ao lado do `docker-compose.yml`. Depois de alterar uma, aplique-a com `docker compose up -d` na pasta do agente.",
  "| Variable | Required | Description |":
    "| Variável | Obrigatória | Descrição |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Sim | A URL da sua instância do OneUptime (por ex., `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Sim | A chave de ingestão de telemetria, a escolhida na etapa 1 |",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this array registers under in OneUptime. Stamped on every metric as the `storage.array.name` resource attribute. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | Sim | O nome com que este array se registra no OneUptime. Carimbado em cada métrica como o atributo de recurso `storage.array.name`. Mantenha-o estável: alterá-lo registra um novo array de armazenamento |",
  "| `STORAGE_SYSTEM` | No | The platform, stamped as the `storage.system` resource attribute: `purestorage.flasharray` or `purestorage.flashblade` (default: `purestorage.flasharray`) |":
    "| `STORAGE_SYSTEM` | Não | A plataforma, carimbada como o atributo de recurso `storage.system`: `purestorage.flasharray` ou `purestorage.flashblade` (padrão: `purestorage.flasharray`) |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | No | Which shipped config runs: `otel-collector-config.yaml` (FlashArray, native — the default), `otel-collector-config.flasharray-exporter.yaml` (older FlashArray) or `otel-collector-config.flashblade.yaml` (FlashBlade) |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Não | Qual configuração incluída é executada: `otel-collector-config.yaml` (FlashArray, nativa; a padrão), `otel-collector-config.flasharray-exporter.yaml` (FlashArray mais antigo) ou `otel-collector-config.flashblade.yaml` (FlashBlade) |",
  "| `COMPOSE_PROFILES` | No | Starts the exporter the config needs: empty for the native FlashArray config, `flasharray-exporter` or `flashblade` for the others |":
    "| `COMPOSE_PROFILES` | Não | Inicia o exportador de que a configuração precisa: vazio para a configuração nativa do FlashArray, `flasharray-exporter` ou `flashblade` para as outras |",
  "| `PURE_FA_ENDPOINT` | FlashArray | The FlashArray's management address — host name or IP, no `https://` |":
    "| `PURE_FA_ENDPOINT` | FlashArray | O endereço de gerenciamento do FlashArray: nome de host ou IP, sem `https://` |",
  "| `PURE_FA_API_TOKEN` | FlashArray | API token of the FlashArray user with the readonly role |":
    "| `PURE_FA_API_TOKEN` | FlashArray | O token de API do usuário do FlashArray com a função readonly |",
  "| `PURE_FB_ENDPOINT` | FlashBlade | The FlashBlade's management address — host name or IP, no `https://` |":
    "| `PURE_FB_ENDPOINT` | FlashBlade | O endereço de gerenciamento do FlashBlade: nome de host ou IP, sem `https://` |",
  "| `PURE_FB_API_TOKEN` | FlashBlade | API token of the FlashBlade user with the readonly role |":
    "| `PURE_FB_API_TOKEN` | FlashBlade | O token de API do usuário do FlashBlade com a função readonly |",
  "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No | `true` accepts the array's self-signed certificate on the native endpoint; `false` verifies it (default: `true`). Pure's exporters never verify the array's certificate, so it does not apply to them |":
    "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | Não | `true` aceita o certificado autoassinado do array no endpoint nativo; `false` o verifica (padrão: `true`). Os exportadores da Pure nunca verificam o certificado do array, então ela não se aplica a eles |",
  "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-storage-array-agent`). A second array's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | Não | O nome do contêiner do agente (padrão: `oneuptime-storage-array-agent`). O agente de um segundo array na mesma máquina precisa de um próprio: o script de instalação dá a um novo agente o nome da pasta dele, a menos que você o defina, e o mantém quando você executa o script de novo |",
  "- The collector reads the FlashArray's own OpenMetrics endpoint over HTTPS with the token as a Bearer credential — no exporter runs.":
    "- O coletor lê o próprio endpoint OpenMetrics do FlashArray por HTTPS, com o token como credencial Bearer: nenhum exportador é executado.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/volumes`, `/metrics/hosts` and `/metrics/pods` every 2 minutes; `/metrics/directories` every 30 minutes — directory space is expensive for the array to compute.":
    "- **Uma tarefa de coleta por endpoint**, cada uma lida com a frequência que vale a pena: `/metrics/array` a cada 60 segundos; `/metrics/volumes`, `/metrics/hosts` e `/metrics/pods` a cada 2 minutos; `/metrics/directories` a cada 30 minutos, porque o espaço dos diretórios é caro para o array calcular.",
  "- **Every job labels its series `scrape_endpoint: <endpoint>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted object leaves the inventory. Keep the labels as shipped.":
    "- **Cada tarefa rotula suas séries com `scrape_endpoint: <endpoint>`**, para que o OneUptime saiba de quais objetos um lote é a lista completa: é assim que um objeto excluído sai do inventário. Mantenha os rótulos como vêm.",
  "- **Per-volume and per-host latency keeps three dimensions** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); a `metric_relabel_configs` rule drops the QoS, queue, SAN and service-time breakdown, which multiplies the series count of a large array. The array-wide breakdown is kept.":
    "- **A latência por volume e por host mantém três dimensões** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); uma regra de `metric_relabel_configs` descarta o detalhamento por QoS, fila, SAN e tempo de serviço, que multiplica a contagem de séries de um array grande. O detalhamento do array inteiro é mantido.",
  "- **No `send_batch_max_size`.** OneUptime rebuilds the inventory from one whole scrape, so the `batch` processor never splits one.":
    "- **Sem `send_batch_max_size`.** O OneUptime reconstrói o inventário a partir de uma coleta inteira, então o processor `batch` nunca divide uma.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "Este é o `otel-collector-config.yaml` completo que o agente executa; o arquivo `.env` fornece os valores `${env:...}`:",
  "The agent ships metrics only until you turn on its syslog receivers. Arrays forward their alerts and audit events as syslog; the agent stamps `storage.array.name` on every line, so they land on this array's **Logs** page.":
    "O agente envia apenas métricas até você ativar os receivers de syslog dele. Os arrays encaminham seus alertas e eventos de auditoria como syslog; o agente carimba `storage.array.name` em cada linha, então eles chegam à página **Registros** deste array.",
  "1. In `otel-collector-config.yaml`, uncomment the `syslog/tcp` and `syslog/udp` receivers and the `logs` pipeline. Classic BSD syslog timestamps carry no time zone: set `location` to the array's time zone unless its clock runs on UTC.":
    "1. Em `otel-collector-config.yaml`, descomente os receivers `syslog/tcp` e `syslog/udp` e o pipeline `logs`. Os timestamps do syslog BSD clássico não trazem fuso horário: defina `location` como o fuso horário do array, a menos que o relógio dele esteja em UTC.",
  "2. In `docker-compose.yml`, uncomment the `ports:` block that publishes `5514/tcp` and `5514/udp`, and open the port on the machine's firewall for the array's management network.":
    "2. Em `docker-compose.yml`, descomente o bloco `ports:` que publica `5514/tcp` e `5514/udp` e abra a porta no firewall da máquina para a rede de gerenciamento do array.",
  "3. Apply both:": "3. Aplique os dois:",
  "4. On the FlashArray, as an administrator, open **Settings → System → Syslog Servers**, add `udp://<agent-host>:5514` (or `tcp://<agent-host>:5514`) and send a test message.":
    "4. No FlashArray, como administrador, abra **Settings → System → Syslog Servers**, adicione `udp://<agent-host>:5514` (ou `tcp://<agent-host>:5514`) e envie uma mensagem de teste.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the array: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor of the collector config you use, next to `storage.array.name`:":
    "Qualquer atributo de recurso com o prefixo `oneuptime.label.` vira um rótulo de projeto no array: `oneuptime.label.<dimension>=<value>` é o rótulo `<dimension>:<value>`. Adicione-os ao processor `resource` da configuração do coletor que você usa, ao lado de `storage.array.name`:",
  "Then restart the collector so it reads the new config:":
    "Depois reinicie o coletor para que ele leia a nova configuração:",
  "The array shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "O array aparece com os rótulos `team:storage` e `env:production`. Os rótulos são comparados sem diferenciar maiúsculas de minúsculas, então um rótulo `Production` existente é reutilizado; o agente nunca remove os rótulos adicionados na interface do OneUptime.",
  "Every value is a gauge the FlashArray computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "Cada valor é um gauge que o próprio FlashArray calcula: latência por operação em microssegundos, taxa de transferência por segundo. As páginas de arrays de armazenamento do OneUptime, o catálogo de métricas e os modelos de alerta se baseiam em:",
  "| Endpoint | Data |": "| Endpoint | Dados |",
  "| **Array** (`/metrics/array`) | `purefa_info`, capacity and data reduction (`purefa_array_space_*`), performance, open alerts (`purefa_alerts_open`), hardware components, drives, controllers and network interfaces |":
    "| **Array** (`/metrics/array`) | `purefa_info`, capacidade e redução de dados (`purefa_array_space_*`), desempenho, alertas abertos (`purefa_alerts_open`), componentes de hardware, unidades, controladoras e interfaces de rede |",
  "| **Volumes** (`/metrics/volumes`) | Latency, IOPS, bandwidth, space and data reduction per volume |":
    "| **Volumes** (`/metrics/volumes`) | Latência, IOPS, largura de banda, espaço e redução de dados por volume |",
  "| **Hosts** (`/metrics/hosts`) | Connectivity, connected volumes, latency, IOPS and space per host |":
    "| **Hosts** (`/metrics/hosts`) | Conectividade, volumes conectados, latência, IOPS e espaço por host |",
  "| **Pods** (`/metrics/pods`) | ActiveCluster and ActiveDR replica link lag, mediator status, performance and space |":
    "| **Pods** (`/metrics/pods`) | Atraso do link de réplica do ActiveCluster e do ActiveDR, status do mediador, desempenho e espaço |",
  "| **Directories** (`/metrics/directories`) | Space and performance of FlashArray file services' managed directories |":
    "| **Diretórios** (`/metrics/directories`) | Espaço e desempenho dos diretórios gerenciados dos serviços de arquivos do FlashArray |",
  "One agent reads one array. To monitor several from the same machine, install each into its own folder with its own `.env` and its own container name — two containers cannot share one:":
    "Um agente lê um array. Para monitorar vários a partir da mesma máquina, instale cada um na própria pasta com o próprio `.env` e o próprio nome de contêiner, porque dois contêineres não podem compartilhar um nome:",
  "Without `STORAGE_ARRAY_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `STORAGE_ARRAY_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "Sem `STORAGE_ARRAY_AGENT_CONTAINER_NAME`, o script dá ao contêiner o nome da pasta. Ele guarda o nome no `.env` desse agente, então executar o script de novo para atualizar o agente o mantém, e um agente cujo `container_name` você já editou no `docker-compose.yml` mantém esse nome. Com o Docker Compose, defina `STORAGE_ARRAY_AGENT_CONTAINER_NAME` no `.env` de cada agente em vez disso.",
  "The agent ships a systemd unit that assumes the install script's folder, `/opt/oneuptime-storage-array-agent`. The install script does not download it, so fetch it:":
    "O agente traz uma unidade systemd que pressupõe a pasta do script de instalação, `/opt/oneuptime-storage-array-agent`. O script de instalação não a baixa, então baixe-a você:",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its configs are files beside it, so pulling alone does not move the agent forward. Re-run the install script. It reuses every value in your existing `.env` (nothing is prompted for again), downloads the latest `docker-compose.yml` and collector configs — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — and recreates the agent with them:":
    "**Atualizar**: a imagem do coletor está fixada no `docker-compose.yml` e as configurações dele são arquivos ao lado, então baixar a imagem não basta para atualizar o agente. Execute o script de instalação de novo. Ele reutiliza todos os valores do seu `.env` existente (nada é perguntado de novo), baixa os mais recentes `docker-compose.yml` e configurações do coletor (um arquivo que você editou é mantido ao lado do novo como `<file>.bak.<timestamp>`) e recria o agente com eles:",
  "An agent installed outside `/opt/oneuptime-storage-array-agent` (a second array's, say) needs its folder: `INSTALL_DIR=<folder> bash install.sh`.":
    "Um agente instalado fora de `/opt/oneuptime-storage-array-agent` (o de um segundo array, por exemplo) precisa da pasta dele: `INSTALL_DIR=<folder> bash install.sh`.",
  "Installed it with Docker Compose instead? In the agent's folder, download the compose file and the collector configs again; your `.env` stays, and a change you made to any of them has to be made again:":
    "Instalou com o Docker Compose? Na pasta do agente, baixe de novo o arquivo compose e as configurações do coletor; o seu `.env` fica, e uma alteração que você fez em qualquer um deles precisa ser feita de novo:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Depois baixe as imagens e recrie o agente, para que o coletor leia a nova configuração:",
  "The config reports the collector version it pins as the array's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "A configuração informa a versão do coletor que ela fixa como a **Versão do agente** do array. Quando este OneUptime fixa uma mais nova, um sinal de aviso ao lado abre estes comandos.",
  "**Uninstall** the agent:": "**Desinstale** o agente:",
  "Then delete the read-only user and its API token on the array if you no longer need them.":
    "Depois exclua o usuário somente leitura e o token de API dele no array, se não precisar mais deles.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the array endpoint exactly as the collector reaches it (the native endpoint or Pure's exporter, DNS, TLS, the API token), array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "O `troubleshoot.sh` verifica toda a cadeia (o runtime de contêineres, o endpoint do array exatamente como o coletor o alcança, ou seja, o endpoint nativo ou o exportador da Pure, com DNS, TLS e o token de API, o carimbo do nome do array, as métricas próprias do coletor) e pergunta diretamente ao OneUptime se ele aceita a sua chave de ingestão. Essa última verificação é a mais importante: os endpoints OTLP do OneUptime recusam uma chave errada com `401` ou `422`, o que o coletor registra como uma única linha `Exporting failed` por lote, fácil de não notar, então o script consulta `GET /otlp/v1/validate` para obter um veredito direto 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Ele termina com um veredito que aponta a causa mais provável.",
  "1. Check the collector logs: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` means the array refused the API token, `404` means the FlashArray has no native endpoint, `x509` means TLS verification is on against the array's self-signed certificate, `no such host` or `connection refused` means a wrong `PURE_FA_ENDPOINT`, and an export `401` means a bad ingestion key.":
    "1. Verifique os registros do coletor: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` significa que o array recusou o token de API; `404`, que o FlashArray não tem endpoint nativo; `x509`, que a verificação TLS está ativa contra o certificado autoassinado do array; `no such host` ou `connection refused`, um `PURE_FA_ENDPOINT` errado; e um `401` na exportação, uma chave de ingestão errada.",
  "2. Make sure `STORAGE_ARRAY_NAME` is set — discovery keys on the `storage.array.name` resource attribute, and the collector refuses to start without it.":
    "2. Verifique se `STORAGE_ARRAY_NAME` está definido: a descoberta se baseia no atributo de recurso `storage.array.name`, e o coletor se recusa a iniciar sem ele.",
  "3. Make sure `STORAGE_ARRAY_COLLECTOR_CONFIG` and `COMPOSE_PROFILES` name the same platform.":
    "3. Verifique se `STORAGE_ARRAY_COLLECTOR_CONFIG` e `COMPOSE_PROFILES` indicam a mesma plataforma.",
  "Its Purity//FA has no native OpenMetrics endpoint. Set `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` and `COMPOSE_PROFILES=flasharray-exporter` in `.env` and run `docker compose up -d` — or re-run `install.sh` with the older-Purity choice. After upgrading the array to Purity//FA 6.7 or later, switch back to the native config and drop the profile.":
    "O Purity//FA dele não tem endpoint OpenMetrics nativo. Defina `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` e `COMPOSE_PROFILES=flasharray-exporter` no `.env` e execute `docker compose up -d`, ou execute `install.sh` de novo com a opção de Purity mais antigo. Depois de atualizar o array para o Purity//FA 6.7 ou posterior, volte para a configuração nativa e remova o perfil.",
  "Check that you pasted the token, not the user's password; that the user still exists and holds the readonly role; and that the token has not expired. Create a new token (`pureadmin create --api-token oneuptime` on a FlashArray), put it in `.env` as `PURE_FA_API_TOKEN` and run `docker compose up -d`.":
    "Verifique se você colou o token, e não a senha do usuário; se o usuário ainda existe e tem a função readonly; e se o token não expirou. Crie um token novo (`pureadmin create --api-token oneuptime` em um FlashArray), coloque-o no `.env` como `PURE_FA_API_TOKEN` e execute `docker compose up -d`.",
  "Arrays present a self-signed certificate by default, which no Docker image trusts. Set `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network), or install a certificate on the array from a CA the collector image trusts.":
    "Os arrays apresentam por padrão um certificado autoassinado, em que nenhuma imagem Docker confia. Defina `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (a escolha pragmática em uma rede de gerenciamento privada) ou instale no array um certificado de uma CA em que a imagem do coletor confie.",
  "`pure-fa-exporter` or `pure-fb-exporter` is not running: `COMPOSE_PROFILES` must match `STORAGE_ARRAY_COLLECTOR_CONFIG` — `flasharray-exporter` for the FlashArray exporter config, `flashblade` for the FlashBlade config. Fix `.env` and run `docker compose up -d`; `docker compose ps` then lists the exporter.":
    "`pure-fa-exporter` ou `pure-fb-exporter` não está em execução: `COMPOSE_PROFILES` precisa corresponder a `STORAGE_ARRAY_COLLECTOR_CONFIG`, ou seja, `flasharray-exporter` para a configuração do exportador do FlashArray e `flashblade` para a configuração do FlashBlade. Corrija o `.env` e execute `docker compose up -d`; depois o `docker compose ps` lista o exportador.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-storage-array-agent`":
    "1. Verifique se o agente está em execução: `docker ps --filter name=oneuptime-storage-array-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`":
    "2. Procure erros nos registros do agente: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Verifique se a URL do OneUptime e a chave de ingestão estão corretas.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Verifique se a máquina do agente consegue alcançar a instância do OneUptime pela rede.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "A identidade do array vem de `STORAGE_ARRAY_NAME`, carimbado em cada métrica como `storage.array.name`. Corrija-o no `.env` e aplique-o com `docker compose up -d` na pasta do agente; observe que um nome novo registra um novo array de armazenamento.",
  "It registers the array as **`array-1`** — the name this array already has in OneUptime.":
    "Ele registra o array como **`array-1`**, o nome que este array já tem no OneUptime.",
  "- This installs the agent for **`array-1`** — keep `STORAGE_ARRAY_NAME` exactly as it is, or the data registers as a new storage array.":
    "- Isto instala o agente para **`array-1`**: mantenha `STORAGE_ARRAY_NAME` exatamente como está, ou os dados serão registrados como um novo array de armazenamento.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. This array is **`array-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "A identidade do array vem de `STORAGE_ARRAY_NAME`, carimbado em cada métrica como `storage.array.name`. Este array é **`array-1`**. Corrija-o no `.env` e aplique-o com `docker compose up -d` na pasta do agente; observe que um nome novo registra um novo array de armazenamento.",
  "The command already carries your OneUptime URL, ingestion key and the platform you picked above. The script asks for:":
    "O comando já traz a sua URL do OneUptime, a sua chave de ingestão e a plataforma que você escolheu acima. O script pede:",
  "Access from that machine to `quay.io`, where Docker pulls Pure's exporter image":
    "Acesso dessa máquina a `quay.io`, de onde o Docker baixa a imagem do exportador da Pure",
  "- `COMPOSE_PROFILES=flasharray-exporter` starts `pure-fa-exporter`, Pure's exporter, next to the collector; the two must match.":
    "- `COMPOSE_PROFILES=flasharray-exporter` inicia o `pure-fa-exporter`, o exportador da Pure, ao lado do coletor; os dois precisam corresponder.",
  "`docker compose ps` in the agent's folder also lists **`pure-fa-exporter`**, Pure's exporter, which the collector reads the FlashArray through.":
    "O `docker compose ps` na pasta do agente também lista o **`pure-fa-exporter`**, o exportador da Pure, por meio do qual o coletor lê o FlashArray.",
  "- The collector reads the FlashArray through `pure-fa-exporter`, Pure's exporter, which logs in to the FlashArray's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- O coletor lê o FlashArray por meio do `pure-fa-exporter`, o exportador da Pure, que faz login na API REST do FlashArray com o token que o coletor envia a cada coleta. A porta do exportador fica na rede do compose.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashBlade's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 ou posterior com o plugin Docker Compose v2, em uma máquina que alcance o endereço de gerenciamento do FlashBlade por HTTPS (TCP 443)",
  "An administrator account on the FlashBlade, to create the agent's read-only user":
    "Uma conta de administrador no FlashBlade, para criar o usuário somente leitura do agente",
  "On the FlashBlade, as an administrator, create a user named `oneuptime` with the **readonly** role — in the FlashBlade GUI's user settings, or with `pureadmin` in the Purity//FB CLI — and create an **API token** for it. Create the token **without an expiry**, or the agent stops the day it expires.":
    "No FlashBlade, como administrador, crie um usuário chamado `oneuptime` com a função **readonly** (nas configurações de usuário da GUI do FlashBlade ou com `pureadmin` na CLI do Purity//FB) e crie um **token de API** para ele. Crie o token **sem expiração**, ou o agente para no dia em que ele expirar.",
  "FlashBlade API tokens start with `T-`. A Purity//FB release without local users takes a directory service (LDAP or Active Directory) account whose group maps to the readonly role instead.":
    "Os tokens de API do FlashBlade começam com `T-`. Uma versão do Purity//FB sem usuários locais usa, em vez disso, uma conta de um serviço de diretório (LDAP ou Active Directory) cujo grupo é mapeado para a função readonly.",
  "- the FlashBlade's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- o **endereço de gerenciamento** do FlashBlade (nome de host ou IP, sem `https://`) e o **token de API** do usuário somente leitura, que ele lê sem exibir",
  "- Set `PURE_FB_ENDPOINT` to the FlashBlade's management address — host name or IP, no `https://` — and `PURE_FB_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- Defina `PURE_FB_ENDPOINT` como o endereço de gerenciamento do FlashBlade (nome de host ou IP, sem `https://`) e `PURE_FB_API_TOKEN` como o token de API do usuário somente leitura. Execute `chmod 600 .env`: o arquivo guarda o token.",
  "`docker compose ps` in the agent's folder also lists **`pure-fb-exporter`**, Pure's exporter, which the collector reads the FlashBlade through.":
    "O `docker compose ps` na pasta do agente também lista o **`pure-fb-exporter`**, o exportador da Pure, por meio do qual o coletor lê o FlashBlade.",
  "- The collector reads the FlashBlade through `pure-fb-exporter`, Pure's exporter, which logs in to the FlashBlade's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- O coletor lê o FlashBlade por meio do `pure-fb-exporter`, o exportador da Pure, que faz login na API REST do FlashBlade com o token que o coletor envia a cada coleta. A porta do exportador fica na rede do compose.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/filesystems` and `/metrics/objectstore` every 5 minutes — the FlashBlade REST API is not built to report every file system and bucket quickly.":
    "- **Uma tarefa de coleta por endpoint**, cada uma lida com a frequência que vale a pena: `/metrics/array` a cada 60 segundos; `/metrics/filesystems` e `/metrics/objectstore` a cada 5 minutos, porque a API REST do FlashBlade não foi feita para informar rapidamente cada sistema de arquivos e cada bucket.",
  "4. On the FlashBlade, as an administrator, add a syslog server `udp://<agent-host>:5514` (or `tcp://`) in its syslog settings.":
    "4. No FlashBlade, como administrador, adicione um servidor syslog `udp://<agent-host>:5514` (ou `tcp://`) nas configurações de syslog dele.",
  "Every value is a gauge the FlashBlade computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "Cada valor é um gauge que o próprio FlashBlade calcula: latência por operação em microssegundos, taxa de transferência por segundo. As páginas de arrays de armazenamento do OneUptime, o catálogo de métricas e os modelos de alerta se baseiam em:",
  "| **Array** (`/metrics/array`) | `purefb_info`, capacity and data reduction (`purefb_array_space_*`), performance per protocol, open alerts (`purefb_alerts_open`), hardware health (`purefb_hardware_health`) |":
    "| **Array** (`/metrics/array`) | `purefb_info`, capacidade e redução de dados (`purefb_array_space_*`), desempenho por protocolo, alertas abertos (`purefb_alerts_open`), integridade do hardware (`purefb_hardware_health`) |",
  "| **File systems** (`/metrics/filesystems`) | Space, data reduction and performance per file system |":
    "| **Sistemas de arquivos** (`/metrics/filesystems`) | Espaço, redução de dados e desempenho por sistema de arquivos |",
  "| **Object store** (`/metrics/objectstore`) | Space, quota, object counts and performance per bucket |":
    "| **Armazenamento de objetos** (`/metrics/objectstore`) | Espaço, cota, contagem de objetos e desempenho por bucket |",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that reaches every node of the cluster on UDP 161 (SNMP)":
    "Docker Engine 20.10 ou posterior com o plugin Docker Compose v2, em uma máquina que alcance todos os nós do cluster pela porta UDP 161 (SNMP)",
  "An administrator account on the cluster, to turn on SNMP and set the agent's read-only community or SNMPv3 user":
    "Uma conta de administrador no cluster, para ativar o SNMP e definir a community somente leitura ou o usuário SNMPv3 do agente",
  "SSH to any node as an administrator: OneFS applies SNMP settings to the whole cluster. If the cluster already answers SNMP for another tool, give the agent the same community or user and skip this step. Otherwise, turn on SNMP v2c with a read-only community of your own, not OneFS's default `I$ilonpublic`:":
    "Conecte-se por SSH a qualquer nó como administrador: o OneFS aplica as configurações de SNMP ao cluster inteiro. Se o cluster já responde a SNMP para outra ferramenta, dê ao agente a mesma community ou o mesmo usuário e pule esta etapa. Caso contrário, ative o SNMP v2c com uma community somente leitura própria, não a padrão do OneFS, `I$ilonpublic`:",
  "Or turn on SNMPv3, which authenticates and encrypts every poll. OneFS has one SNMPv3 read-only user, `general` until you rename it: give it passwords of at least eight characters, without spaces:":
    "Ou ative o SNMPv3, que autentica e criptografa cada consulta. O OneFS tem um único usuário SNMPv3 somente leitura, `general` até que você o renomeie: dê a ele senhas de pelo menos oito caracteres, sem espaços:",
  "`isi snmp settings view` shows the settings, with the user's authentication and privacy protocols. Allow UDP 161 from the agent's machine to every node, and list the nodes' addresses with `isi network interfaces list`.":
    "`isi snmp settings view` mostra as configurações, com os protocolos de autenticação e de privacidade do usuário. Libere a porta UDP 161 da máquina do agente para cada nó e liste os endereços dos nós com `isi network interfaces list`.",
  "- **every node's address**, separated by commas: each node's own address, never the SmartConnect zone name, since a node answers only for its own drives, sensors and ports":
    "- os **endereços de todos os nós**, separados por vírgulas: o endereço próprio de cada nó, nunca o nome da zona SmartConnect, já que um nó só responde pelas suas próprias unidades, sensores e portas",
  "- the **SNMP version**, then the read-only **community**, or the SNMPv3 **user** and its two passwords, each read without echo":
    "- a **versão do SNMP**, depois a **community** somente leitura, ou o **usuário** SNMPv3 e as suas duas senhas, cada uma lida sem ser exibida",
  "A user whose protocols are not SHA and AES needs `POWERSCALE_SNMP_AUTH_PROTOCOL` and `POWERSCALE_SNMP_PRIVACY_PROTOCOL` in front of `bash install.sh`, and a user without privacy `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`.":
    "Um usuário cujos protocolos não são SHA e AES precisa de `POWERSCALE_SNMP_AUTH_PROTOCOL` e `POWERSCALE_SNMP_PRIVACY_PROTOCOL` antes de `bash install.sh`, e um usuário sem privacidade, de `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`.",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the community or the SNMPv3 passwords), with one poll per node, and starts the agent with Docker Compose. When the cluster gains a node, add its address to `POWERSCALE_NODES` in that file and run `bash install.sh` again.":
    "Ele instala em `/opt/oneuptime-storage-array-agent`, grava um arquivo `.env` que só você pode ler (ele guarda a community ou as senhas SNMPv3), com uma consulta por nó, e inicia o agente com o Docker Compose. Quando o cluster ganhar um nó, adicione o endereço dele a `POWERSCALE_NODES` nesse arquivo e execute `bash install.sh` de novo.",
  "- Replace `my-storage-array` with a name for this cluster, such as `ps-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- Substitua `my-storage-array` por um nome para este cluster, como `ps-prod`. É assim que o cluster aparece no OneUptime, então mantenha-o estável: um nome novo registra um novo array de armazenamento.",
  "- List every node in `POWERSCALE_NODES` and give each its own `POWERSCALE_NODE_<n>` and `snmp/node-<n>` in `POWERSCALE_SNMP_RECEIVERS`, up to 252, after `snmp/cluster` and `snmp/quotas`. An IPv6 address goes in brackets, such as `[fd00::11]`.":
    "- Liste cada nó em `POWERSCALE_NODES` e dê a cada um o seu próprio `POWERSCALE_NODE_<n>` e o seu próprio `snmp/node-<n>` em `POWERSCALE_SNMP_RECEIVERS`, até 252, depois de `snmp/cluster` e `snmp/quotas`. Um endereço IPv6 vai entre colchetes, como `[fd00::11]`.",
  "- For SNMPv3, set `POWERSCALE_SNMP_VERSION=v3`, `POWERSCALE_SNMP_USER`, `POWERSCALE_SNMP_AUTH_PASSWORD` and `POWERSCALE_SNMP_PRIVACY_PASSWORD` instead of the community. Run `chmod 600 .env`: it holds the community or the passwords.":
    "- Para SNMPv3, defina `POWERSCALE_SNMP_VERSION=v3`, `POWERSCALE_SNMP_USER`, `POWERSCALE_SNMP_AUTH_PASSWORD` e `POWERSCALE_SNMP_PRIVACY_PASSWORD` no lugar da community. Execute `chmod 600 .env`: o arquivo guarda a community ou as senhas.",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this cluster registers under in OneUptime, stamped on every metric as `storage.array.name`. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | Sim | O nome com que este cluster se registra no OneUptime, carimbado em cada métrica como `storage.array.name`. Mantenha-o estável: alterá-lo registra um novo array de armazenamento |",
  "| `STORAGE_SYSTEM` | Yes | `dell.powerscale` |":
    "| `STORAGE_SYSTEM` | Sim | `dell.powerscale` |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Yes | `otel-collector-config.powerscale.yaml` |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Sim | `otel-collector-config.powerscale.yaml` |",
  "| `POWERSCALE_NODES` | Yes | Every node's address, separated by commas. The install script writes the polls below from it |":
    "| `POWERSCALE_NODES` | Sim | Os endereços de todos os nós, separados por vírgulas. O script de instalação grava a partir deles as consultas abaixo |",
  "| `POWERSCALE_ENDPOINT` | Yes | The node the cluster's own health, capacity and quotas are read through: the first in `POWERSCALE_NODES` |":
    "| `POWERSCALE_ENDPOINT` | Sim | O nó através do qual se leem a saúde, a capacidade e as cotas do próprio cluster: o primeiro de `POWERSCALE_NODES` |",
  "| `POWERSCALE_SNMP_RECEIVERS` | Yes | The polls the collector runs: `snmp/cluster`, `snmp/quotas`, then `snmp/node-<n>` for each node |":
    "| `POWERSCALE_SNMP_RECEIVERS` | Sim | As consultas que o coletor executa: `snmp/cluster`, `snmp/quotas` e depois `snmp/node-<n>` para cada nó |",
  "| `POWERSCALE_NODE_<n>` | Yes | Node `<n>`'s address, from 1 to 252 |":
    "| `POWERSCALE_NODE_<n>` | Sim | O endereço do nó `<n>`, de 1 a 252 |",
  "| `POWERSCALE_SNMP_VERSION` | No | `v2c` (default) or `v3` |":
    "| `POWERSCALE_SNMP_VERSION` | Não | `v2c` (padrão) ou `v3` |",
  "| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | The cluster's read-only community |":
    "| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | A community somente leitura do cluster |",
  "| `POWERSCALE_SNMP_USER` | SNMPv3 | The cluster's SNMPv3 read-only user |":
    "| `POWERSCALE_SNMP_USER` | SNMPv3 | O usuário SNMPv3 somente leitura do cluster |",
  "| `POWERSCALE_SNMP_SECURITY_LEVEL` | No | `auth_priv` (default), `auth_no_priv` or `no_auth_no_priv` |":
    "| `POWERSCALE_SNMP_SECURITY_LEVEL` | Não | `auth_priv` (padrão), `auth_no_priv` ou `no_auth_no_priv` |",
  "| `POWERSCALE_SNMP_AUTH_PROTOCOL` | No | `SHA` (default), `MD5`, `SHA224`, `SHA256`, `SHA384` or `SHA512` |":
    "| `POWERSCALE_SNMP_AUTH_PROTOCOL` | Não | `SHA` (padrão), `MD5`, `SHA224`, `SHA256`, `SHA384` ou `SHA512` |",
  "| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | The SNMPv3 user's authentication password |":
    "| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | A senha de autenticação do usuário SNMPv3 |",
  "| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | No | `AES` (default), `DES`, `AES192`, `AES256`, `AES192C` or `AES256C` |":
    "| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | Não | `AES` (padrão), `DES`, `AES192`, `AES256`, `AES192C` ou `AES256C` |",
  "| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | The SNMPv3 user's privacy password |":
    "| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | A senha de privacidade do usuário SNMPv3 |",
  "- **One collector, no exporter.** The collector's own SNMP receiver reads Dell's ISILON-MIB; nothing else runs beside it.":
    "- **Um coletor, nenhum exportador.** O próprio receptor SNMP do coletor lê a ISILON-MIB da Dell; nada mais roda ao lado dele.",
  "- **The cluster's objects once, through `POWERSCALE_ENDPOINT`:** its health, capacity, throughput and node counts every 60 seconds (`snmp/cluster`), and its SmartQuotas every 5 minutes (`snmp/quotas`).":
    "- **Os objetos do cluster uma única vez, através de `POWERSCALE_ENDPOINT`:** a sua saúde, capacidade, taxa de transferência e contagens de nós a cada 60 segundos (`snmp/cluster`), e as suas SmartQuotas a cada 5 minutos (`snmp/quotas`).",
  "- **Each node's from the node:** its health, CPU, protocol performance, drives, sensors and ports every 60 seconds (`snmp/node-<n>`).":
    "- **Os de cada nó, a partir do próprio nó:** a sua saúde, CPU, desempenho de protocolos, unidades, sensores e portas a cada 60 segundos (`snmp/node-<n>`).",
  "- **Every poll labels its series `scrape_endpoint: <poll>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted quota leaves the inventory. Keep the labels as shipped.":
    "- **Cada consulta rotula as suas séries com `scrape_endpoint: <poll>`**, para que o OneUptime saiba de quais objetos um lote é a lista completa: é assim que uma cota excluída sai do inventário. Mantenha os rótulos como vêm.",
  "The full config, one SNMP receiver per node slot, is `otel-collector-config.powerscale.yaml` in the agent's folder:":
    "A configuração completa, com um receptor SNMP por posição de nó, é `otel-collector-config.powerscale.yaml` na pasta do agente:",
  "Then turn SNMP off on the cluster, or change the agent's community or SNMPv3 passwords, if nothing else polls it.":
    "Depois desative o SNMP no cluster, ou altere a community ou as senhas SNMPv3 do agente, se nada mais o consultar.",
  "`troubleshoot.sh` checks the whole chain — the container runtime, the node addresses and the community or SNMPv3 user in `.env`, each node with `snmpget` when the machine has it, array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key.":
    "O `troubleshoot.sh` verifica toda a cadeia (o runtime de contêineres, os endereços dos nós e a community ou o usuário SNMPv3 no `.env`, cada nó com `snmpget` quando a máquina o tem, o carimbo do nome do array, as métricas próprias do coletor) e pergunta diretamente ao OneUptime se ele aceita a sua chave de ingestão.",
  "`Error scraping metrics` with `request timeout` in `docker logs oneuptime-storage-array-agent` names a node that does not answer SNMP from this machine: SNMP is off for the version the agent uses, the community or SNMPv3 user is not the cluster's, or UDP 161 is blocked on the way. A node that answers but is missing from the cluster's nodes is not in `POWERSCALE_NODES`: add it and run `bash install.sh` again.":
    "`Error scraping metrics` com `request timeout` em `docker logs oneuptime-storage-array-agent` aponta um nó que não responde a SNMP a partir desta máquina: o SNMP está desativado para a versão que o agente usa, a community ou o usuário SNMPv3 não são os do cluster, ou a porta UDP 161 está bloqueada no caminho. Um nó que responde mas falta entre os nós do cluster não está em `POWERSCALE_NODES`: adicione-o e execute `bash install.sh` de novo.",
};

export default TRANSLATION;
