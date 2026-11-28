import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Ceph setup guide in Portuguese (#8341): each piece of the English
 * guide's markdown (Pages/Ceph/Utils/DocumentationMarkdown.ts) and its
 * Portuguese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Portuguese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach your Ceph mgr daemons on port 9283":
    "Docker Engine 20.10 ou posterior com o plugin Docker Compose v2, em uma máquina que alcance os daemons mgr do Ceph na porta 9283",
  "A shell on a Ceph admin node, where the `ceph` CLI works with admin rights":
    "Um shell em um nó de administração do Ceph, onde a CLI `ceph` funcione com direitos de administrador",
  "Then list your mgr daemons — the agent needs **all** of them, active and standbys:":
    "Depois liste os seus daemons mgr: o agente precisa de **todos**, o ativo e os standby:",
  "Only the **active** mgr returns metrics — standbys answer with an empty response — so scraping every mgr keeps metrics flowing when the active one fails over.":
    "Só o mgr **ativo** retorna métricas (os standby respondem com uma resposta vazia), então coletar de todos os mgr mantém as métricas fluindo quando o ativo faz failover.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "O script pede a URL do OneUptime e a chave de ingestão, ambas mostradas na etapa 1 (escolha uma chave lá para que sejam preenchidas aqui), e depois:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **Nome do cluster**: como o cluster aparece no OneUptime. Dê a cada cluster o seu e mantenha-o estável: um nome novo registra um cluster novo.",
  "- **Mgr endpoints** — every mgr from the previous step as comma-separated `host:port`, e.g. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. The script adds the square brackets.":
    "- **Endpoints de mgr**: cada mgr da etapa anterior como `host:port` separados por vírgula, por ex., `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. O script adiciona os colchetes.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only. Where `ceph` works with admin rights, the script also offers to create the AI agent's own Ceph client.":
    "- **Agente de IA do OneUptime**: se ele pode aplicar correções; responda **N** para mantê-lo somente leitura. Onde o `ceph` funciona com direitos de administrador, o script também oferece criar o cliente Ceph próprio do agente de IA.",
  "It installs to `/opt/oneuptime-ceph-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Ele instala em `/opt/oneuptime-ceph-agent`, grava um arquivo `.env` com `0600` e inicia o agente com o Docker Compose. Executar o script de novo reutiliza tudo o que está nesse `.env` em vez de perguntar de novo, e é também assim que você atualiza.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The cluster then appears automatically in the **Ceph** section, usually within a minute or so.":
    "Procure `Everything is ready. Begin running and processing data.` nos registros. O cluster então aparece automaticamente na seção **Ceph**, normalmente em cerca de um minuto.",
  "Docker Compose also runs **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. If the install script created its Ceph client it is already working; otherwise it waits for one — see **OneUptime AI agent** under Advanced.":
    "O Docker Compose também executa **`oneuptime-ceph-ai-agent`**, o agente de IA do OneUptime. Se o script de instalação criou o cliente Ceph dele, ele já está funcionando; caso contrário, espera por um; veja **Agente de IA do OneUptime** em Avançado.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: once it has its Ceph client, it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `ceph` commands, and changes nothing unless you allow fixes.":
    "**Agente de IA do OneUptime (ativado por padrão, somente leitura).** As investigações de IA estão ativadas: assim que ele tem o seu cliente Ceph, permite que o OneUptime AI investigue incidentes e alertas neste cluster com comandos `ceph` somente leitura, e não altera nada, a menos que você permita correções.",
  "The install script writes these to `/opt/oneuptime-ceph-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent`.":
    "O script de instalação grava estas variáveis em `/opt/oneuptime-ceph-agent/.env`. Depois de alterar uma, aplique-a com `docker compose up -d` em `/opt/oneuptime-ceph-agent`.",
  "| Variable | Required | Description |":
    "| Variável | Obrigatória | Descrição |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Sim | A URL da sua instância do OneUptime (por ex., `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Sim | A chave de ingestão de telemetria, a escolhida na etapa 1 |",
  "| `CEPH_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `ceph.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `ceph`) |":
    "| `CEPH_CLUSTER_NAME` | Sim | O identificador do cluster mostrado no OneUptime. Carimbado em cada métrica como o atributo de recurso `ceph.cluster.name`. Mantenha-o estável: alterá-lo registra um cluster novo (padrão: `ceph`) |",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]`. The install script adds the brackets for you |":
    "| `CEPH_MGR_ENDPOINTS` | Sim | Lista `host:port` separada por vírgula de **todos** os daemons mgr, entre colchetes, por ex., `[ceph-mon-1:9283,ceph-mon-2:9283]`. O script de instalação adiciona os colchetes para você |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "As configurações próprias do agente de IA do OneUptime estão em **Agente de IA do OneUptime**.",
  "- **All mgrs are scraped** (active and standbys), so metrics survive an active-mgr failover.":
    "- **Todos os mgr são coletados** (o ativo e os standby), então as métricas sobrevivem a um failover do mgr ativo.",
  "- **Every 30 seconds.** The mgr prometheus module caches a scrape for `mgr/prometheus/scrape_interval` (15 seconds by default) — never scrape more often than that, you would only re-read the cache.":
    "- **A cada 30 segundos.** O módulo prometheus do mgr guarda uma coleta em cache por `mgr/prometheus/scrape_interval` (15 segundos por padrão): nunca colete com mais frequência, você só leria o cache de novo.",
  "- **`honor_labels: true`** keeps the labels Ceph exports (`ceph_daemon`, `pool_id`) as they are, so series stay continuous across mgr failovers.":
    "- **`honor_labels: true`** mantém como estão os rótulos que o Ceph exporta (`ceph_daemon`, `pool_id`), então as séries continuam contínuas através dos failovers de mgr.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "Este é o `otel-collector-config.yaml` completo que o agente executa; o arquivo `.env` fornece os valores `${env:...}`:",
  "The agent can tail `/var/log/ceph/ceph.log` and ship it to OneUptime, which fills the **Cluster Log** page. It is off by default because the agent must run on a host that has the cluster log — a mon host by default.":
    "O agente pode acompanhar `/var/log/ceph/ceph.log` e enviá-lo ao OneUptime, o que preenche a página **Registro do cluster**. Fica desativado por padrão porque o agente precisa rodar em um host que tenha o registro do cluster, um host mon por padrão.",
  "1. In `otel-collector-config.yaml`, uncomment the `filelog` receiver and the `logs` pipeline.":
    "1. Em `otel-collector-config.yaml`, descomente o receiver `filelog` e o pipeline `logs`.",
  "2. In `docker-compose.yml`, uncomment the `/var/log/ceph:/var/log/ceph:ro` volume.":
    "2. Em `docker-compose.yml`, descomente o volume `/var/log/ceph:/var/log/ceph:ro`.",
  "3. Apply both:": "3. Aplique os dois:",
  "Lines ship verbatim; OneUptime parses the ceph.log format (timestamp, daemon, INF/WRN/ERR level, message) when it reads them, and the `resource` processor stamps `ceph.cluster.name` so the log lands on this cluster.":
    "As linhas são enviadas como estão; o OneUptime interpreta o formato do ceph.log (data e hora, daemon, nível INF/WRN/ERR, mensagem) ao lê-las, e o processor `resource` carimba `ceph.cluster.name` para que o registro chegue a este cluster.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `ceph.cluster.name`:":
    "Qualquer atributo de recurso com o prefixo `oneuptime.label.` vira um rótulo de projeto no cluster: `oneuptime.label.<dimension>=<value>` é o rótulo `<dimension>:<value>`. Adicione-os ao processor `resource` em `otel-collector-config.yaml`, ao lado de `ceph.cluster.name`:",
  "Then restart the collector so it reads the new config:":
    "Depois reinicie o coletor para que ele leia a nova configuração:",
  "The cluster shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "O cluster aparece com os rótulos `team:storage` e `env:production`. Os rótulos são comparados sem diferenciar maiúsculas de minúsculas, então um rótulo `Production` existente é reutilizado; o agente nunca remove os rótulos adicionados na interface do OneUptime.",
  "The agent ships everything the mgr prometheus module exports. OneUptime's Ceph pages, metric catalog and alert templates are built on:":
    "O agente envia tudo o que o módulo prometheus do mgr exporta. As páginas do Ceph, o catálogo de métricas e os modelos de alerta do OneUptime se baseiam em:",
  "| Category | Data |": "| Categoria | Dados |",
  "| **Cluster Health** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), monitor quorum, total and used raw capacity |":
    "| **Saúde do cluster** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), quórum dos monitores, capacidade bruta total e usada |",
  "| **OSD** | Up / in state for every OSD (per `ceph_daemon` label, e.g. `osd.3`) |":
    "| **OSD** | Estado up / in de cada OSD (por rótulo `ceph_daemon`, por ex., `osd.3`) |",
  "| **Pool** | Stored bytes, max available, object counts, read/write operations and throughput per pool |":
    "| **Pool** | Bytes armazenados, máximo disponível, contagem de objetos, operações e taxa de leitura/gravação por pool |",
  "| **Placement Groups** | Active, degraded, and undersized PG counts |":
    "| **Placement Groups** | Contagem de PGs ativos, degradados e subdimensionados |",
  "`docker-compose.yml` also runs **`oneuptime-ceph-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs `ceph` commands through it — `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. It registers as the cluster named `CEPH_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "O `docker-compose.yml` também executa **`oneuptime-ceph-ai-agent`**. Enquanto o OneUptime AI investiga um incidente ou alerta neste cluster, ele executa comandos `ceph` por meio dele: `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. Ele se registra como o cluster chamado `CEPH_CLUSTER_NAME` e aparece na página **IA → Agente de IA** do cluster.",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. The install script offers to create them on a fresh install, when `ceph` works with admin rights on the machine you run it on. Otherwise, or to add them later, on a Ceph admin node:":
    "Ele se conecta como o seu próprio cliente Ceph, `client.oneuptime-ai`, com o `ceph.conf` mínimo do cluster e o keyring desse cliente em uma pasta `ceph/` ao lado do `docker-compose.yml`. O script de instalação oferece criá-los em uma instalação nova, quando o `ceph` funciona com direitos de administrador na máquina em que você o executa. Caso contrário, ou para adicioná-los depois, em um nó de administração do Ceph:",
  "If the agent runs on another machine, copy the two files into its `ceph/` folder the same way. **Never put the admin keyring there.**":
    "Se o agente roda em outra máquina, copie os dois arquivos para a pasta `ceph/` dele do mesmo jeito. **Nunca coloque o keyring de administrador ali.**",
  "- **The client's caps are the hard limit.** With these read caps nothing it runs can change the cluster. Fixes — marking an OSD back in, clearing `noout` — also need `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` and the fixes caps from the agent's README.":
    "- **As caps do cliente são o limite rígido.** Com estas caps de leitura, nada do que ele executa pode alterar o cluster. Correções (voltar um OSD para in, limpar `noout`) também precisam de `ONEUPTIME_AI_ALLOW_WRITES=true` no `.env` e das caps de correção do README do agente.",
  "- Check it: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- Verifique-o: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-ceph-ai-agent` service from `docker-compose.yml`.":
    "- Não usa o OneUptime AI? Exclua o serviço `oneuptime-ceph-ai-agent` do `docker-compose.yml`.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#ceph-clusters).":
    "O que ele pode executar e como as correções funcionam: [Agentes de IA de infraestrutura](/docs/ai/infrastructure-ai-agents#ceph-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them. The AI agent's `ceph/` folder stays as it is:":
    "**Atualizar**: a imagem do coletor está fixada no `docker-compose.yml` e a configuração dele é um arquivo ao lado, então baixar a imagem não basta para atualizar o agente. Execute o script de instalação de novo. Ele reutiliza todos os valores do seu `.env` existente (nada é perguntado de novo), baixa os mais recentes `docker-compose.yml` e `otel-collector-config.yaml` (um arquivo que você editou é mantido ao lado do novo como `<file>.bak.<timestamp>`), baixa as imagens e recria o agente com elas. A pasta `ceph/` do agente de IA fica como está:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "A configuração informa a versão do coletor que ela fixa como a **Versão do agente** do cluster. Quando este OneUptime fixa uma mais nova, um sinal de aviso ao lado abre estes comandos.",
  "**Uninstall** the agent:": "**Desinstale** o agente:",
  "If you created the AI agent's Ceph client, remove it on an admin node: `ceph auth del client.oneuptime-ai`.":
    "Se você criou o cliente Ceph do agente de IA, remova-o em um nó de administração: `ceph auth del client.oneuptime-ai`.",
  "`troubleshoot.sh` checks the whole chain — container runtime, every mgr endpoint (including the active-vs-standby trap), cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "O `troubleshoot.sh` verifica toda a cadeia (o runtime de contêineres, cada endpoint de mgr, incluindo a armadilha do ativo contra o standby, o carimbo do nome do cluster, o formato do token, as métricas próprias do coletor) e pergunta diretamente ao OneUptime se ele aceita a sua chave de ingestão. Essa última verificação é a mais importante: os endpoints OTLP do OneUptime recusam uma chave errada com `401` ou `422`, o que o coletor registra como uma única linha `Exporting failed` por lote, fácil de passar despercebida, então o script consulta `GET /otlp/v1/validate` para ter um veredito direto 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Ele termina com um veredito que aponta a causa mais provável.",
  "1. Check the collector logs: `docker logs oneuptime-ceph-agent` — look for export errors (`401` means a bad ingestion key, connection refused means a wrong `ONEUPTIME_URL`).":
    "1. Verifique os registros do coletor: `docker logs oneuptime-ceph-agent`; procure erros de exportação (`401` significa uma chave de ingestão errada, connection refused significa uma `ONEUPTIME_URL` errada).",
  "2. Verify a mgr endpoint serves metrics: `curl http://<active-mgr>:9283/metrics | head` — you should see `ceph_*` metric lines. If not, enable the module: `ceph mgr module enable prometheus`.":
    "2. Verifique se um endpoint de mgr fornece métricas: `curl http://<active-mgr>:9283/metrics | head`; você deve ver linhas de métricas `ceph_*`. Se não, ative o módulo: `ceph mgr module enable prometheus`.",
  "3. Make sure `CEPH_MGR_ENDPOINTS` is wrapped in square brackets — without them the collector treats the whole comma-separated string as a single (invalid) target.":
    "3. Verifique se `CEPH_MGR_ENDPOINTS` está entre colchetes: sem eles, o coletor trata toda a string separada por vírgula como um único alvo (inválido).",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-ceph-agent`":
    "1. Verifique se o agente está em execução: `docker ps --filter name=oneuptime-ceph-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`":
    "2. Procure erros nos registros do agente: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Verifique se a URL do OneUptime e a chave de ingestão estão corretas.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Verifique se a máquina do agente consegue alcançar a instância do OneUptime pela rede.",
  "You are probably scraping only the (previously) active mgr. List **every** mgr daemon in `CEPH_MGR_ENDPOINTS` — scrapes of standby mgrs are cheap and return empty responses.":
    "Provavelmente você coleta só o mgr (antes) ativo. Liste **cada** daemon mgr em `CEPH_MGR_ENDPOINTS`: coletar dos mgr standby custa pouco e retorna respostas vazias.",
  "Expected if `mgr/prometheus/standby_behaviour` is set to `error` on your cluster — standbys then answer with HTTP 500. The active mgr's scrape still succeeds, so the errors are noise; switch the behaviour back to `default` to silence them.":
    "É o esperado se `mgr/prometheus/standby_behaviour` estiver em `error` no seu cluster: os standby então respondem com HTTP 500. A coleta do mgr ativo ainda funciona, então os erros são ruído; volte o comportamento para `default` para silenciá-los.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "A identidade do cluster vem de `CEPH_CLUSTER_NAME`, carimbada em cada métrica como `ceph.cluster.name`. Corrija-a no `.env` e aplique-a com `docker compose up -d` em `/opt/oneuptime-ceph-agent`; observe que um nome novo registra um cluster novo.",
  "- **Cluster name** — enter **`ceph-1`** exactly; a different name registers a new cluster.":
    "- **Nome do cluster**: digite exatamente **`ceph-1`**; um nome diferente registra um cluster novo.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "A identidade do cluster vem de `CEPH_CLUSTER_NAME`, carimbada em cada métrica como `ceph.cluster.name`. Este cluster é **`ceph-1`**. Corrija-a no `.env` e aplique-a com `docker compose up -d` em `/opt/oneuptime-ceph-agent`; observe que um nome novo registra um cluster novo.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "O comando já traz a sua URL do OneUptime e a sua chave de ingestão. O script pede o resto:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Baixe `docker-compose.yml` e `otel-collector-config.yaml` deste OneUptime em uma pasta nova:",
  "Create a `.env` file next to them:": "Crie um arquivo `.env` ao lado deles:",
  "- Replace `my-ceph-cluster` with a name for this cluster, such as `ceph-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- Substitua `my-ceph-cluster` por um nome para este cluster, como `ceph-prod`. É assim que o cluster aparece no OneUptime, então mantenha-o estável: um nome novo registra um cluster novo.",
  "- List **every** mgr daemon in `CEPH_MGR_ENDPOINTS`, comma-separated and wrapped in square brackets — without the brackets the collector reads the whole list as one invalid target.":
    "- Liste **cada** daemon mgr em `CEPH_MGR_ENDPOINTS`, separados por vírgula e entre colchetes: sem os colchetes, o coletor lê a lista inteira como um único alvo inválido.",
  "Start the agent:": "Inicie o agente:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Escolha uma chave de ingestão na etapa 1 para preencher `<YOUR_API_KEY>`.",
  "Docker Compose also starts **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. It waits for a Ceph client of its own — see **OneUptime AI agent** under Advanced, or delete its service from `docker-compose.yml` if you do not use OneUptime AI.":
    "O Docker Compose também inicia **`oneuptime-ceph-ai-agent`**, o agente de IA do OneUptime. Ele espera por um cliente Ceph próprio; veja **Agente de IA do OneUptime** em Avançado, ou exclua o serviço dele do `docker-compose.yml` se você não usa o OneUptime AI.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "O agente as lê do arquivo `.env` ao lado do `docker-compose.yml`. Depois de alterar uma, aplique-a com `docker compose up -d` na pasta que contém o `docker-compose.yml`.",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]` |":
    "| `CEPH_MGR_ENDPOINTS` | Sim | Lista `host:port` separada por vírgula de **todos** os daemons mgr, entre colchetes, por ex., `[ceph-mon-1:9283,ceph-mon-2:9283]` |",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. On a Ceph admin node, in the agent's folder:":
    "Ele se conecta como o seu próprio cliente Ceph, `client.oneuptime-ai`, com o `ceph.conf` mínimo do cluster e o keyring desse cliente em uma pasta `ceph/` ao lado do `docker-compose.yml`. Em um nó de administração do Ceph, na pasta do agente:",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Execute-os na pasta do agente, a que contém o `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**Atualizar**: a imagem do coletor está fixada no `docker-compose.yml` e a configuração dele é um arquivo ao lado, então baixar a imagem não basta para atualizar o agente. Baixe os dois arquivos de novo; o seu `.env` fica, e uma alteração que você fez em um dos arquivos precisa ser feita de novo:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Depois baixe as imagens e recrie o agente, para que o coletor leia a nova configuração:",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "A identidade do cluster vem de `CEPH_CLUSTER_NAME`, carimbada em cada métrica como `ceph.cluster.name`. Corrija-a no `.env` e aplique-a com `docker compose up -d` na pasta que contém o `docker-compose.yml`; observe que um nome novo registra um cluster novo.",
  "- This installs the agent for **`ceph-1`** — keep `CEPH_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- Isto instala o agente para **`ceph-1`**: mantenha `CEPH_CLUSTER_NAME` exatamente como está, ou os dados serão registrados como um cluster novo.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "A identidade do cluster vem de `CEPH_CLUSTER_NAME`, carimbada em cada métrica como `ceph.cluster.name`. Este cluster é **`ceph-1`**. Corrija-a no `.env` e aplique-a com `docker compose up -d` na pasta que contém o `docker-compose.yml`; observe que um nome novo registra um cluster novo.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `CEPH_AGENT_CONTAINER_NAME` | Não | O nome do contêiner do coletor (padrão: `oneuptime-ceph-agent`). O agente de um segundo cluster na mesma máquina precisa de nomes próprios: o script de instalação dá aos contêineres de um novo agente o nome da pasta dele, a menos que você os defina, e os mantém quando você executa o script de novo |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-ceph-ai-agent-cluster2` beside `oneuptime-ceph-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | Não | O nome do contêiner do agente de IA (padrão: `oneuptime-ceph-ai-agent`). O script de instalação dá ao agente de IA de um segundo cluster um nome baseado no do coletor dele (`oneuptime-ceph-ai-agent-cluster2` ao lado de `oneuptime-ceph-agent-cluster2`), a menos que você o defina, e o mantém quando você executa o script de novo |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "Um agente lê um cluster. Para um segundo cluster, instale um segundo agente em uma pasta própria, com nomes de contêiner próprios, porque dois contêineres não podem compartilhar um nome:",
  "The script names the containers after the folder, such as `oneuptime-ceph-agent-cluster2`, unless you set their variables, such as `CEPH_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "O script dá aos contêineres nomes baseados na pasta, como `oneuptime-ceph-agent-cluster2`, a menos que você defina as variáveis deles, como `CEPH_AGENT_CONTAINER_NAME`. Ele guarda os nomes no `.env` desse agente, então executar o script de novo com o mesmo `INSTALL_DIR` para atualizar o agente os mantém, e um agente cujo `container_name` você já editou no `docker-compose.yml` mantém esse nome.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "Dê a cada pasta um nome próprio: o Docker Compose dá a um projeto o nome apenas da pasta dele, então o script recusa uma pasta com o mesmo nome de outra que já executa um agente em outro lugar. Passe a pasta ao script de diagnóstico com `-d`.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AGENT_CONTAINER_NAME` | Não | O nome do contêiner do coletor (padrão: `oneuptime-ceph-agent`). O agente de um segundo cluster na mesma máquina precisa de um próprio |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | Não | O nome do contêiner do agente de IA (padrão: `oneuptime-ceph-ai-agent`). O agente de um segundo cluster na mesma máquina precisa de um próprio |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "Um agente lê um cluster. Para um segundo cluster, configure um segundo agente em uma pasta própria, com nomes de contêiner próprios, porque dois contêineres não podem compartilhar um nome. Defina-os no `.env` desse agente:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "Dê a cada pasta um nome próprio: o Docker Compose dá a um projeto o nome apenas da pasta dele, então uma segunda pasta com o mesmo nome substituiria os contêineres do primeiro agente. Deixe os nomes fora do `docker-compose.yml`, que uma atualização substitui.",
};

export default TRANSLATION;
