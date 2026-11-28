import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Proxmox setup guide in Portuguese (#8341): each piece of the English
 * guide's markdown (Pages/Proxmox/Utils/DocumentationMarkdown.ts) and its
 * Portuguese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Portuguese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach every node's Proxmox VE API on port 8006":
    "Docker Engine 20.10 ou mais recente com o plugin Docker Compose v2, em uma máquina que alcance a API do Proxmox VE de cada nó na porta 8006",
  "A root shell on any PVE node, or the Proxmox web UI, to create a read-only API token":
    "Um shell de root em qualquer nó PVE, ou a interface web do Proxmox, para criar um token de API somente leitura",
  "Ideally a machine outside the cluster, or a VM that Proxmox HA restarts on another node — the agent reads the cluster from another node when one goes down, but not when its own machine does":
    "De preferência uma máquina fora do cluster, ou uma VM que o Proxmox HA reinicia em outro nó: o agente lê o cluster de outro nó quando um cai, mas não quando cai a própria máquina dele",
  "As root on any PVE node:": "Como root em qualquer nó PVE:",
  "- The first line only fails, harmlessly, if `monitoring@pam` already exists. API tokens carry their own secret, so the user needs no password or system account.":
    "- A primeira linha só falha, sem prejuízo, se `monitoring@pam` já existir. Tokens de API têm o próprio segredo, então o usuário não precisa de senha nem de conta de sistema.",
  "- `pveum user token add` prints the token secret — copy it now, it is shown only once. The token id is `monitoring@pam!oneuptime`.":
    "- `pveum user token add` imprime o segredo do token: copie-o agora, ele é mostrado só uma vez. O ID do token é `monitoring@pam!oneuptime`.",
  "- The role goes on the user as well as the token because a privilege-separated token only gets the permissions its user also has. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "- A função vai para o usuário e também para o token porque um token com separação de privilégios só recebe as permissões que o usuário dele também tem. Ela precisa ficar no caminho raiz `/`: o pve-exporter lê o status do cluster inteiro, e um token restrito a um subcaminho falha com `Permission check failed (/, Sys.Audit)`.",
  "1. Go to *Datacenter → Permissions → API Tokens* and click **Add**.":
    "1. Vá para *Datacenter → Permissions → API Tokens* e clique em **Add**.",
  "2. Pick (or create) a user, give the token an ID like `oneuptime`, make sure **Privilege Separation** is checked, and click **Add**.":
    "2. Escolha (ou crie) um usuário, dê ao token um ID como `oneuptime`, confira se **Privilege Separation** está marcado e clique em **Add**.",
  "3. Copy the token id (`user@realm!tokenname`) and the secret — the secret is shown only once.":
    "3. Copie o ID do token (`user@realm!tokenname`) e o segredo: o segredo é mostrado só uma vez.",
  "4. Under *Datacenter → Permissions*, click **Add** twice to give path `/` the **PVEAuditor** role: once as an **API Token Permission** for the token, once as a **User Permission** for its user.":
    "4. Em *Datacenter → Permissions*, clique duas vezes em **Add** para dar ao caminho `/` a função **PVEAuditor**: uma vez como **API Token Permission** para o token e outra como **User Permission** para o usuário dele.",
  "A privilege-separated token only gets the permissions its user also has, so both need the role. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "Um token com separação de privilégios só recebe as permissões que o usuário dele também tem, então os dois precisam da função. Ela precisa ficar no caminho raiz `/`: o pve-exporter lê o status do cluster inteiro, e um token restrito a um subcaminho falha com `Permission check failed (/, Sys.Audit)`.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "O script pede a URL do OneUptime e a chave de ingestão, ambas mostradas na etapa 1 (escolha uma chave lá para que sejam preenchidas aqui), e depois:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **Nome do cluster**: como o cluster aparece no OneUptime. Dê a cada cluster o seu e mantenha-o estável: um nome novo registra um cluster novo.",
  "- **Proxmox VE API host** — any node, e.g. `192.168.1.10`. While its API does not answer, the agent reads the cluster from the next node in the list below.":
    "- **Host da API do Proxmox VE**: qualquer nó, por exemplo `192.168.1.10`. Enquanto a API dele não responder, o agente lê o cluster do próximo nó da lista abaixo.",
  "- **Bundled prometheus-pve-exporter** — answer **Y** unless you already run one.":
    "- **prometheus-pve-exporter incluído**: responda **Y**, a menos que você já execute um.",
  "- **API token** — the token id and secret from the previous step.":
    "- **Token de API**: o ID e o segredo do token da etapa anterior.",
  "- **Every node's address** — each node's own address, comma-separated, never a virtual IP. With the token, the script offers the cluster's own list: press Enter to take it. The agent also reads the cluster from these when the first node is down.":
    "- **Endereço de cada nó**: o endereço próprio de cada nó, separados por vírgulas, nunca um IP virtual. Com o token, o script oferece a lista do próprio cluster: pressione Enter para aceitá-la. O agente também lê o cluster desses nós quando o primeiro está fora do ar.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only.":
    "- **Agente de IA do OneUptime**: se ele pode aplicar correções; responda **N** para mantê-lo somente leitura.",
  "It installs to `/opt/oneuptime-proxmox-agent`, writes a `0600` `.env` file and starts everything with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Ele instala em `/opt/oneuptime-proxmox-agent`, grava um arquivo `.env` com permissão `0600` e inicia tudo com o Docker Compose. Executar o script de novo reutiliza tudo o que está nesse `.env` em vez de perguntar de novo, então essa também é a forma de atualizar.",
  "`docker compose ps` lists the collector (`oneuptime-proxmox-agent`), the node failover (`oneuptime-pve-api-failover`), the bundled exporter (`oneuptime-pve-exporter`, unless you use your own) and the OneUptime AI agent (`oneuptime-proxmox-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cluster then appears automatically in the **Proxmox** section.":
    "`docker compose ps` lista o coletor (`oneuptime-proxmox-agent`), o failover entre nós (`oneuptime-pve-api-failover`), o exportador incluído (`oneuptime-pve-exporter`, a menos que você use o seu) e o agente de IA do OneUptime (`oneuptime-proxmox-ai-agent`). Nos registros do coletor, procure `Everything is ready. Begin running and processing data.` Depois o cluster aparece automaticamente na seção **Proxmox**.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `pvesh` requests, and changes nothing unless you allow fixes — see **OneUptime AI agent** under Advanced.":
    "**Agente de IA do OneUptime (ativado por padrão, somente leitura).** As investigações de IA estão ativadas: ele permite que o OneUptime AI investigue incidentes e alertas neste cluster com solicitações `pvesh` somente leitura, e não altera nada, a menos que você permita correções; veja **Agente de IA do OneUptime** em Avançado.",
  "Needs Proxmox VE 8.3 or later. Pick an ingestion key in step 1 to show the two commands: they carry the key, which Proxmox VE keeps in the webhook target they add.":
    "Requer Proxmox VE 8.3 ou mais recente. Escolha uma chave de ingestão na etapa 1 para mostrar os dois comandos: eles levam a chave, que o Proxmox VE guarda no destino de webhook que eles adicionam.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts.":
    "A página de cada convidado passa a mostrar o último backup dele, e as **Recomendações** do cluster oferecem os alertas **Backup Job Failed** e **Node Fenced**.",
  "The install script writes these to `/opt/oneuptime-proxmox-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`.":
    "O script de instalação grava estas variáveis em `/opt/oneuptime-proxmox-agent/.env`. Depois de alterar uma, aplique-a com `docker compose up -d` em `/opt/oneuptime-proxmox-agent`.",
  "| Variable | Required | Description |":
    "| Variável | Obrigatória | Descrição |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Sim | A URL da sua instância do OneUptime (por ex., `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Sim | A chave de ingestão de telemetria, a escolhida na etapa 1 |",
  "| `PROXMOX_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `proxmox.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `proxmox-cluster`) |":
    "| `PROXMOX_CLUSTER_NAME` | Sim | O identificador do cluster mostrado no OneUptime. Carimbado em cada métrica como o atributo de recurso `proxmox.cluster.name`. Mantenha-o estável: alterá-lo registra um cluster novo (padrão: `proxmox-cluster`) |",
  "| `PVE_HOST` | Yes | The node whose Proxmox VE API the exporter reads the cluster from and the AI agent queries, e.g. `192.168.1.10`. While its API does not answer, both use the next node in `PVE_NODES` that does |":
    "| `PVE_HOST` | Sim | O nó por cuja API do Proxmox VE o exportador lê o cluster e que o agente de IA consulta, por exemplo `192.168.1.10`. Enquanto a API dele não responder, os dois usam o próximo nó de `PVE_NODES` que responder |",
  "| `PVE_NODES` | On a cluster | Every node's own API address, comma-separated in square brackets, e.g. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Defaults to `PVE_HOST` alone, which is enough for a single node. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen. The agent also reads the cluster from the next of them when `PVE_HOST` goes down. |":
    "| `PVE_NODES` | Em um cluster | O endereço de API próprio de cada nó, separados por vírgulas entre colchetes, por exemplo `[192.168.1.10,192.168.1.11,192.168.1.12]`. Por padrão, só `PVE_HOST`, o que basta para um nó único. O exportador lê o início no boot (Guest Down), a replicação e a assinatura só do nó que ele consulta, então cada nó é consultado por vez; um nó deixado de fora fica invisível. O agente também lê o cluster do próximo deles quando `PVE_HOST` cai. |",
  "| `PVE_EXPORTER_URL` | No | Address (`host:port`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (`pve-exporter:9221`) |":
    "| `PVE_EXPORTER_URL` | Não | Endereço (`host:port`, sem esquema) do prometheus-pve-exporter. Por padrão, o exportador incluído (`pve-exporter:9221`) |",
  "| `PVE_API_TOKEN_ID` | Bundled exporter and AI agent | Full Proxmox API token id, e.g. `monitoring@pam!oneuptime` (PVEAuditor, read-only) |":
    "| `PVE_API_TOKEN_ID` | Exportador incluído e agente de IA | ID completo do token de API do Proxmox, por exemplo `monitoring@pam!oneuptime` (PVEAuditor, somente leitura) |",
  "| `PVE_API_TOKEN_SECRET` | Bundled exporter and AI agent | Proxmox API token secret |":
    "| `PVE_API_TOKEN_SECRET` | Exportador incluído e agente de IA | Segredo do token de API do Proxmox |",
  "| `PVE_VERIFY_SSL` | No | Verify the Proxmox API TLS certificate (default: `false` — PVE ships self-signed certificates) |":
    "| `PVE_VERIFY_SSL` | Não | Verificar o certificado TLS da API do Proxmox (padrão: `false`; o PVE vem com certificados autoassinados) |",
  "| `COMPOSE_PROFILES` | No | Set to `pve-exporter` to start the bundled exporter container |":
    "| `COMPOSE_PROFILES` | Não | Defina como `pve-exporter` para iniciar o contêiner do exportador incluído |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "As configurações próprias do agente de IA do OneUptime estão em **Agente de IA do OneUptime**.",
  "When the install script asks **Run the bundled prometheus-pve-exporter?**, answer **n** and give your exporter's address (`host:port`, no scheme).":
    "Quando o script de instalação perguntar **Run the bundled prometheus-pve-exporter?**, responda **n** e informe o endereço do seu exportador (`host:port`, sem esquema).",
  "Use an address the agent's container can reach — the host's LAN IP or DNS name: `localhost` inside the container is the container itself. Keep `PVE_API_TOKEN_ID` and `PVE_API_TOKEN_SECRET` in `.env` if you use the OneUptime AI agent, which reads the API with that token.":
    "Use um endereço que o contêiner do agente consiga alcançar, o IP da LAN ou o nome DNS do host: `localhost` dentro do contêiner é o próprio contêiner. Mantenha `PVE_API_TOKEN_ID` e `PVE_API_TOKEN_SECRET` no `.env` se você usa o agente de IA do OneUptime, que lê a API com esse token.",
  "The agent scrapes the exporter every 30 seconds: its cluster collectors once, at `PVE_HOST` (or the node it reads the cluster from while `PVE_HOST` is down), and its node collectors once for each node in `PVE_NODES`. Every series carries an `id` label identifying the resource — `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>`, or `storage/<node>/<storage>`:":
    "O agente consulta o exportador a cada 30 segundos: os coletores de cluster dele uma vez, em `PVE_HOST` (ou no nó do qual ele lê o cluster enquanto `PVE_HOST` está fora do ar), e os coletores de nó uma vez para cada nó de `PVE_NODES`. Cada série leva um rótulo `id` que identifica o recurso: `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>` ou `storage/<node>/<storage>`:",
  "| Category | Metrics |": "| Categoria | Métricas |",
  "| **Availability** | `pve_up`, `pve_uptime_seconds` |":
    "| **Disponibilidade** | `pve_up`, `pve_uptime_seconds` |",
  "| **Node** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |":
    "| **Nó** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |",
  "| **Guest (VM / LXC)** | `pve_guest_info`, plus CPU / memory / network series on `qemu/*` and `lxc/*` ids |":
    "| **Convidado (VM / LXC)** | `pve_guest_info`, além de séries de CPU, memória e rede nos IDs `qemu/*` e `lxc/*` |",
  "| **Storage** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |":
    "| **Armazenamento** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |",
  "| **HA** | `pve_ha_state` |":
    "| **HA** (alta disponibilidade) | `pve_ha_state` |",
  "| **Backup coverage** | `pve_not_backed_up_total`, `pve_not_backed_up_info` — guests no backup job selects (whether backups ran or succeeded is not exposed) |":
    "| **Cobertura de backup** | `pve_not_backed_up_total`, `pve_not_backed_up_info`: convidados que nenhum job de backup seleciona (se os backups rodaram ou deram certo não é exposto) |",
  "| **Start-on-boot** | `pve_onboot_status` per guest, which **Guest Down** reads |":
    "| **Início no boot** | `pve_onboot_status` por convidado, que o **Guest Down** lê |",
  "| **Replication** | `pve_replication_*` series per storage replication job — their `id` label is the job id (e.g. `100-0`), not a resource |":
    "| **Replicação** | Séries `pve_replication_*` por job de replicação do armazenamento: o rótulo `id` delas é o ID do job (por exemplo `100-0`), não um recurso |",
  "Start-on-boot and replication come from the exporter's node collectors, which read only the node the exporter asks: a node missing from `PVE_NODES` has neither.":
    "O início no boot e a replicação vêm dos coletores de nó do exportador, que só leem o nó que o exportador consulta: um nó ausente de `PVE_NODES` não tem nem um nem outro.",
  "The collector also splits the `id` label into three equality-filterable datapoint attributes (the `transform/pve-identity` processor) — monitor criteria and dashboard filters match on these:":
    "O coletor também divide o rótulo `id` em três atributos de ponto de dados filtráveis por igualdade (o processador `transform/pve-identity`); os critérios dos monitores e os filtros dos painéis se baseiam neles:",
  "| Attribute | Values | Example for `qemu/100` |":
    "| Atributo | Valores | Exemplo para `qemu/100` |",
  "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` and `lxc` both map to `guest`) | `guest` |":
    "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` e `lxc` viram `guest`) | `guest` |",
  "| `pve.id` | Everything after the first `/` of `id` (`pve1`, `100`, `pve1/local`) | `100` |":
    "| `pve.id` | Tudo depois da primeira `/` de `id` (`pve1`, `100`, `pve1/local`) | `100` |",
  "The original `id` label is kept untouched.":
    "O rótulo `id` original é mantido intacto.",
  "The agent reads the whole cluster through one node's API: `PVE_HOST`'s while it answers. Every 15 seconds the `oneuptime-pve-api-failover` container checks that node, and when its API stops answering the collector reads the cluster from the next node in `PVE_NODES` that answers, until `PVE_HOST` answers again. With the API token in `.env` it also passes over a node that answers but is cut off from the quorate part of the cluster, whose view would report every other node down. The OneUptime AI agent does the same for each of its calls. So when a node fails, **Node Offline** fires for it and the rest of the cluster keeps reporting.":
    "O agente lê o cluster inteiro pela API de um nó: a de `PVE_HOST` enquanto ele responder. A cada 15 segundos, o contêiner `oneuptime-pve-api-failover` verifica esse nó, e quando a API dele para de responder, o coletor lê o cluster do próximo nó de `PVE_NODES` que responder, até `PVE_HOST` responder de novo. Com o token de API no `.env`, ele também pula um nó que responde mas está isolado da parte do cluster com quórum, cuja visão mostraria todos os outros nós fora do ar. O agente de IA do OneUptime faz o mesmo em cada uma das chamadas dele. Assim, quando um nó falha, o **Node Offline** dispara para ele e o resto do cluster continua reportando.",
  "Its logs say which node the cluster is read from, and why.":
    "Os registros dele dizem de qual nó o cluster está sendo lido, e por quê.",
  "What it cannot cover is the machine the agent runs on: if that goes down, the whole cluster goes quiet and **Cluster Stopped Reporting** fires. Run the agent off the cluster, or in a VM that Proxmox HA restarts on another node (`ha-manager add vm:<vmid>`, on shared storage), and run one agent per cluster: each agent reads the whole cluster, so a second one reports every resource twice. See [When a node goes down](/docs/telemetry/proxmox#when-a-node-goes-down).":
    "O que ele não consegue cobrir é a máquina em que o agente roda: se ela cair, o cluster inteiro fica em silêncio e o **Cluster Stopped Reporting** dispara. Execute o agente fora do cluster, ou em uma VM que o Proxmox HA reinicia em outro nó (`ha-manager add vm:<vmid>`, em armazenamento compartilhado), e execute um agente por cluster: cada agente lê o cluster inteiro, então um segundo reportaria cada recurso duas vezes. Veja [Quando um nó cai](/docs/telemetry/proxmox#when-a-node-goes-down).",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values. The `transform/pve-identity` processor derives the `pve.scope` / `pve.type` / `pve.id` attributes that the built-in Proxmox alert templates and dashboard filters rely on — keep it in place if you customize the config:":
    "Este é o `otel-collector-config.yaml` completo que o agente executa; o arquivo `.env` fornece os valores `${env:...}`. O processador `transform/pve-identity` deriva os atributos `pve.scope` / `pve.type` / `pve.id` nos quais se baseiam os modelos de alerta do Proxmox incluídos e os filtros dos painéis; mantenha-o se você personalizar a configuração:",
  "By default the agent ships metrics only, so the cluster's **Logs** tab stays empty. The PVE services log to the systemd journal, and the shipped config has a commented-out `journald` receiver for `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` and `qmeventd`.":
    "Por padrão o agente envia só métricas, então a aba **Registros** do cluster fica vazia. Os serviços do PVE registram no journal do systemd, e a configuração incluída tem um receiver `journald` comentado para `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` e `qmeventd`.",
  "1. **Run the agent on a PVE node.** The journal is per host, so a remote agent cannot read it, and each node ships only its own. To keep the metrics agent off the cluster, run a second, log-only collector on each node instead.":
    "1. **Execute o agente em um nó PVE.** O journal é de cada host, então um agente remoto não consegue lê-lo, e cada nó envia só o seu. Para manter o agente de métricas fora do cluster, execute em vez disso um segundo coletor, só para registros, em cada nó.",
  "2. Uncomment the `journald` receiver and the `logs` pipeline in `otel-collector-config.yaml`, and the two journal volumes in `docker-compose.yml`.":
    "2. Remova o comentário do receiver `journald` e do pipeline `logs` em `otel-collector-config.yaml`, e dos dois volumes do journal em `docker-compose.yml`.",
  "3. **Swap the collector image.** The stock image has no `journalctl` and runs as a user that cannot read the journal. Build this wrapper and point `image:` in `docker-compose.yml` at it:":
    "3. **Troque a imagem do coletor.** A imagem padrão não tem `journalctl` e roda como um usuário que não consegue ler o journal. Crie este wrapper e aponte `image:` no `docker-compose.yml` para ele:",
  "4. Apply it:": "4. Aplique:",
  "Rather keep the stock image? The documentation has a `filelog` fallback that tails `/var/log/syslog`: [Ship Proxmox service logs](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).":
    "Prefere manter a imagem padrão? A documentação tem uma alternativa com `filelog` que acompanha `/var/log/syslog`: [Enviar os registros dos serviços do Proxmox](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `proxmox.cluster.name`:":
    "Qualquer atributo de recurso com o prefixo `oneuptime.label.` vira um rótulo de projeto no cluster: `oneuptime.label.<dimension>=<value>` é o rótulo `<dimension>:<value>`. Adicione-os ao processor `resource` em `otel-collector-config.yaml`, ao lado de `proxmox.cluster.name`:",
  "Then restart the collector so it reads the new config:":
    "Depois reinicie o coletor para que ele leia a nova configuração:",
  "The cluster shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "O cluster aparece com os rótulos `team:platform` e `env:production`. Os rótulos são comparados sem diferenciar maiúsculas de minúsculas, então um rótulo `Production` existente é reutilizado; o agente nunca remove os rótulos adicionados na interface do OneUptime.",
  "`docker-compose.yml` also runs **`oneuptime-proxmox-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs read-only `pvesh` commands through it — `pvesh get /cluster/status`, a guest's current status, a node's failed tasks. There is no `pvesh` binary in it: each command becomes one call to the Proxmox VE API at `PVE_HOST`. It registers as the cluster named `PROXMOX_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "O `docker-compose.yml` também executa o **`oneuptime-proxmox-ai-agent`**. Enquanto o OneUptime AI investiga um incidente ou alerta neste cluster, ele executa comandos `pvesh` somente leitura por meio dele: `pvesh get /cluster/status`, o status atual de um convidado, as tarefas com falha de um nó. Não há nenhum binário `pvesh` nele: cada comando vira uma chamada à API do Proxmox VE em `PVE_HOST`. Ele se registra como o cluster chamado `PROXMOX_CLUSTER_NAME` e aparece na página **IA → Agente de IA** do cluster.",
  "- **The API token is the hard limit.** It reads with the collector's PVEAuditor token (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), which can read and nothing else. If you run your own exporter and have no token in `.env`, add one.":
    "- **O token de API é o limite rígido.** Ele lê com o token PVEAuditor do coletor (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), que pode ler e nada mais. Se você executa o seu próprio exportador e não tem token no `.env`, adicione um.",
  "- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`. Fixes — starting or rebooting a guest — also need a token of its own that may power guests, set as `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; the agent's README has the `pveum` commands. If the agent runs in a guest of this cluster, put that guest's VMID in `ONEUPTIME_AI_PROTECTED_TARGETS`.":
    "- Ele é **somente leitura**, a menos que você defina `ONEUPTIME_AI_ALLOW_WRITES=true`. Correções (iniciar ou reiniciar um convidado) também precisam de um token próprio que possa ligar e desligar convidados, definido como `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; o README do agente tem os comandos `pveum`. Se o agente roda em um convidado deste cluster, coloque o VMID desse convidado em `ONEUPTIME_AI_PROTECTED_TARGETS`.",
  "- Check it: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- Verifique-o: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-proxmox-ai-agent` service from `docker-compose.yml`.":
    "- Não usa o OneUptime AI? Exclua o serviço `oneuptime-proxmox-ai-agent` do `docker-compose.yml`.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#proxmox-clusters).":
    "O que ele pode executar e como as correções funcionam: [Agentes de IA de infraestrutura](/docs/ai/infrastructure-ai-agents#proxmox-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them:":
    "**Atualizar**: a imagem do coletor está fixada no `docker-compose.yml` e a configuração dele é um arquivo ao lado, então baixar a imagem não basta para atualizar o agente. Execute o script de instalação de novo. Ele reutiliza todos os valores do seu `.env` existente (nada é perguntado de novo), baixa os mais recentes `docker-compose.yml` e `otel-collector-config.yaml` (um arquivo que você editou é mantido ao lado do novo como `<file>.bak.<timestamp>`), baixa as imagens e recria o agente com elas:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "A configuração informa a versão do coletor que ela fixa como a **Versão do agente** do cluster. Quando este OneUptime fixa uma mais nova, um sinal de aviso ao lado abre estes comandos.",
  "**Uninstall** the agent:": "**Desinstale** o agente:",
  "Then delete the API token under *Datacenter → Permissions → API Tokens* if you no longer need it.":
    "Depois exclua o token de API em *Datacenter → Permissions → API Tokens* se você não precisar mais dele.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the exporter scrape, cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "O `troubleshoot.sh` verifica toda a cadeia (o runtime de contêineres, a coleta do exportador, a marcação do nome do cluster, o formato do token, as métricas próprias do coletor) e pergunta diretamente ao OneUptime se ele aceita a sua chave de ingestão. Essa última verificação é a que mais importa: os endpoints OTLP do OneUptime recusam uma chave errada com `401` ou `422`, que o coletor registra como uma única linha `Exporting failed` por lote, fácil de passar despercebida, então o script pede a `GET /otlp/v1/validate` um veredito direto 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Ele termina com um veredito que aponta a causa mais provável.",
  "1. Check that the agent is running (in `/opt/oneuptime-proxmox-agent`): `docker compose ps`":
    "1. Verifique se o agente está em execução (em `/opt/oneuptime-proxmox-agent`): `docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-proxmox-agent | grep -i error`":
    "2. Procure erros nos registros do agente: `docker compose logs oneuptime-proxmox-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Verifique se a URL do OneUptime e a chave de ingestão estão corretas.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Verifique se a máquina do agente consegue alcançar a instância do OneUptime pela rede.",
  "1. Check the exporter answers. The bundled exporter does not publish its port on the host, so run curl inside its network namespace — you should see `pve_*` metric lines (for your own exporter, curl its `host:9221` directly):":
    "1. Verifique se o exportador responde. O exportador incluído não publica a porta dele no host, então execute o curl dentro do namespace de rede dele; você deve ver linhas de métricas `pve_*` (para o seu próprio exportador, consulte o `host:9221` dele diretamente com curl):",
  "2. Verify the API token has the **PVEAuditor** role on path `/`, on the token and on its user.":
    "2. Verifique se o token de API tem a função **PVEAuditor** no caminho `/`, no token e no usuário dele.",
  "3. Check the collector logs for scrape or export errors (in `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`":
    "3. Verifique nos registros do coletor erros de coleta ou de exportação (em `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`",
  "The API token is wrong or lacks permissions. Re-check the token id format (`user@realm!tokenname`), the secret, and that the **PVEAuditor** role is granted on path `/` to the token and to its user. The exporter's own logs show the API's answer: `docker logs oneuptime-pve-exporter`":
    "O token de API está errado ou não tem as permissões necessárias. Confira de novo o formato do ID do token (`user@realm!tokenname`), o segredo e se a função **PVEAuditor** foi concedida no caminho `/` ao token e ao usuário dele. Os registros do próprio exportador mostram a resposta da API: `docker logs oneuptime-pve-exporter`",
  'Guest series (`qemu/*`, `lxc/*` ids) come from the exporter\'s cluster collector. The shipped config enables it (the `cluster=1` scrape parameter) — if you customized the config, restore the `cluster: ["1"]` param.':
    'As séries de convidados (IDs `qemu/*`, `lxc/*`) vêm do coletor de cluster do exportador. A configuração incluída o ativa (o parâmetro de coleta `cluster=1`); se você personalizou a configuração, restaure o parâmetro `cluster: ["1"]`.',
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "Os sinalizadores de início no boot e os jobs de replicação deles vêm do nó em que rodam, e o agente só lê os nós de `PVE_NODES`. Liste ali o endereço próprio de cada nó, como `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, e aplique com `docker compose up -d` em `/opt/oneuptime-proxmox-agent`. Se o coletor parar de iniciar depois de uma edição, a lista perdeu os colchetes. O `troubleshoot.sh` verifica cada nó da lista.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "A identidade do cluster vem de `PROXMOX_CLUSTER_NAME`, carimbada em cada métrica como `proxmox.cluster.name`. Corrija-a no `.env` e aplique-a com `docker compose up -d` em `/opt/oneuptime-proxmox-agent`; observe que um nome novo registra um cluster novo.",
  "- **Cluster name** — enter **`pve-1`** exactly; a different name registers a new cluster.":
    "- **Nome do cluster**: digite exatamente **`pve-1`**; um nome diferente registra um cluster novo.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "A identidade do cluster vem de `PROXMOX_CLUSTER_NAME`, carimbada em cada métrica como `proxmox.cluster.name`. Este cluster é **`pve-1`**. Corrija-a no `.env` e aplique-a com `docker compose up -d` em `/opt/oneuptime-proxmox-agent`; observe que um nome novo registra um cluster novo.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "O comando já traz a sua URL do OneUptime e a sua chave de ingestão. O script pede o resto:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the cluster name you gave the agent, so the notifications reach the same cluster.":
    "Requer Proxmox VE 8.3 ou mais recente. O primeiro comando adiciona um destino de webhook chamado `oneuptime`, que envia cada notificação ao OneUptime como um registro deste cluster e guarda a chave e o nome do cluster nos segredos dele. O segundo envia todas as notificações para ele. Substitua `my-proxmox-cluster` pelo nome de cluster que você deu ao agente, para que as notificações cheguem ao mesmo cluster.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts. To stop sending them:":
    "A página de cada convidado passa a mostrar o último backup dele, e as **Recomendações** do cluster oferecem os alertas **Backup Job Failed** e **Node Fenced**. Para parar de enviá-las:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. The command already names **`pve-1`**, so the notifications reach this cluster.":
    "Requer Proxmox VE 8.3 ou mais recente. O primeiro comando adiciona um destino de webhook chamado `oneuptime`, que envia cada notificação ao OneUptime como um registro deste cluster e guarda a chave e o nome do cluster nos segredos dele. O segundo envia todas as notificações para ele. O comando já nomeia **`pve-1`**, então as notificações chegam a este cluster.",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Baixe `docker-compose.yml` e `otel-collector-config.yaml` deste OneUptime em uma pasta nova:",
  "Create a `.env` file next to them — it holds the token secret, so keep it private with `chmod 600 .env`:":
    "Crie um arquivo `.env` ao lado deles; ele guarda o segredo do token, então mantenha-o privado com `chmod 600 .env`:",
  "- Replace `my-proxmox-cluster` with a name for this cluster, such as `pve-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- Substitua `my-proxmox-cluster` por um nome para este cluster, como `pve-prod`. É assim que o cluster aparece no OneUptime, então mantenha-o estável: um nome novo registra um cluster novo.",
  "- Set `PVE_HOST` to any node of the cluster: while its API does not answer, the agent reads the cluster from the next node in `PVE_NODES`, so it needs no virtual IP.":
    "- Defina `PVE_HOST` como qualquer nó do cluster: enquanto a API dele não responder, o agente lê o cluster do próximo nó de `PVE_NODES`, então não precisa de nenhum IP virtual.",
  "- Set `PVE_NODES` to every node's own address, in square brackets, never a virtual IP. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen.":
    "- Defina `PVE_NODES` como o endereço próprio de cada nó, entre colchetes, nunca um IP virtual. O exportador lê o início no boot (Guest Down), a replicação e a assinatura só do nó que ele consulta, então cada nó é consultado por vez; um nó deixado de fora fica invisível.",
  "- Fill in the token from the previous step. `COMPOSE_PROFILES=pve-exporter` also starts the bundled prometheus-pve-exporter, which reads the API with it.":
    "- Preencha o token da etapa anterior. `COMPOSE_PROFILES=pve-exporter` também inicia o prometheus-pve-exporter incluído, que lê a API com ele.",
  "Start the agent:": "Inicie o agente:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Escolha uma chave de ingestão na etapa 1 para preencher `<YOUR_API_KEY>`.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "O agente as lê do arquivo `.env` ao lado do `docker-compose.yml`. Depois de alterar uma, aplique-a com `docker compose up -d` na pasta que contém o `docker-compose.yml`.",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter instead (`host:port`, no scheme):":
    "Deixe `COMPOSE_PROFILES` fora do `.env` e, em vez disso, aponte o agente para o seu exportador (`host:port`, sem esquema):",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Execute-os na pasta do agente, a que contém o `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**Atualizar**: a imagem do coletor está fixada no `docker-compose.yml` e a configuração dele é um arquivo ao lado, então baixar a imagem não basta para atualizar o agente. Baixe os dois arquivos de novo; o seu `.env` fica, e uma alteração que você fez em um dos arquivos precisa ser feita de novo:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Depois baixe as imagens e recrie o agente, para que o coletor leia a nova configuração:",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. Verifique se o agente está em execução (na pasta do agente): `docker compose ps`",
  "3. Check the collector logs for scrape or export errors (in the agent's folder): `docker compose logs oneuptime-proxmox-agent`":
    "3. Verifique nos registros do coletor erros de coleta ou de exportação (na pasta do agente): `docker compose logs oneuptime-proxmox-agent`",
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "Os sinalizadores de início no boot e os jobs de replicação deles vêm do nó em que rodam, e o agente só lê os nós de `PVE_NODES`. Liste ali o endereço próprio de cada nó, como `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, e aplique com `docker compose up -d` na pasta com o `docker-compose.yml`. Se o coletor parar de iniciar depois de uma edição, a lista perdeu os colchetes. O `troubleshoot.sh` verifica cada nó da lista.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "A identidade do cluster vem de `PROXMOX_CLUSTER_NAME`, carimbada em cada métrica como `proxmox.cluster.name`. Corrija-a no `.env` e aplique-a com `docker compose up -d` na pasta que contém o `docker-compose.yml`; observe que um nome novo registra um cluster novo.",
  "- This installs the agent for **`pve-1`** — keep `PROXMOX_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- Isto instala o agente para **`pve-1`**: mantenha `PROXMOX_CLUSTER_NAME` exatamente como está, ou os dados serão registrados como um cluster novo.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "A identidade do cluster vem de `PROXMOX_CLUSTER_NAME`, carimbada em cada métrica como `proxmox.cluster.name`. Este cluster é **`pve-1`**. Corrija-a no `.env` e aplique-a com `docker compose up -d` na pasta que contém o `docker-compose.yml`; observe que um nome novo registra um cluster novo.",
  "**No agent, but less data.** Proxmox VE 9.0 and later push each node's metrics to OneUptime themselves. HA state, start-on-boot (used by **Guest Down**), backup coverage and replication are not pushed — use the install script or Docker Compose if you need them. Use one or the other for a cluster: running both reports every resource twice.":
    "**Sem agente, mas com menos dados.** O Proxmox VE 9.0 e posteriores enviam eles mesmos as métricas de cada nó ao OneUptime. Estado de HA, início no boot (usado pelo **Guest Down**), cobertura de backup e replicação não são enviados: use o script de instalação ou o Docker Compose se precisar deles. Use um ou outro em um cluster: com os dois, cada recurso é reportado duas vezes.",
  "Proxmox VE **9.0 or later**": "Proxmox VE **9.0 ou mais recente**",
  "The Proxmox web UI, to add a metric server under *Datacenter → Metric Server*":
    "A interface web do Proxmox, para adicionar um servidor de métricas em *Datacenter → Metric Server*",
  "Every node can reach `<YOUR_ONEUPTIME_HOST>` on port `443`":
    "Cada nó alcança `<YOUR_ONEUPTIME_HOST>` na porta `443`",
  "| Field | Value |": "| Campo | Valor |",
  "| **Server** | `<YOUR_ONEUPTIME_HOST>` |":
    "| **Server** (servidor) | `<YOUR_ONEUPTIME_HOST>` |",
  "| **Port** | `443` |": "| **Port** (porta) | `443` |",
  "| **Protocol** | `https` |": "| **Protocol** (protocolo) | `https` |",
  "| **Path** | `/otlp/v1/metrics` |":
    "| **Path** (caminho) | `/otlp/v1/metrics` |",
  "| **Headers** | The JSON below |":
    "| **Headers** (cabeçalhos) | O JSON abaixo |",
  "Add it once for the datacenter — every node of the cluster then pushes its own metrics.":
    "Adicione-o uma vez para o datacenter: cada nó do cluster passa então a enviar as próprias métricas.",
  "OneUptime translates the push into the same `pve_*` series the agent sends. The cluster registers itself under your Proxmox cluster name — a standalone node under its node name — and appears in the **Proxmox** section, where the Nodes, Guests and Storage pages, the overview charts, the metric catalog and the CPU / memory / storage alert templates work as they do with the agent.":
    "O OneUptime traduz o push para as mesmas séries `pve_*` que o agente envia. O cluster se registra com o nome do seu cluster Proxmox (um nó independente, com o nome do nó) e aparece na seção **Proxmox**, onde as páginas Nós, Convidados e Armazenamento, os gráficos da visão geral, o catálogo de métricas e os modelos de alerta de CPU, memória e armazenamento funcionam como com o agente.",
  "Each node pushes only its own status, so a node that goes down cannot report itself down — the nodes still alive report it for it:":
    "Cada nó envia só o próprio status, então um nó que cai não consegue reportar a própria queda; os nós que continuam ativos reportam por ele:",
  "- It shows **Offline** on the Proxmox pages about 2 minutes after its last report, and **Node Offline** fires after about 5 minutes.":
    "- Ele aparece como **Offline** nas páginas do Proxmox cerca de 2 minutos depois do último relatório, e o **Node Offline** dispara depois de cerca de 5 minutos.",
  "- **Cluster Quorum at Risk** counts it as offline too; it fires about 7–9 minutes after the node went quiet, once its whole 5-minute window has reports.":
    "- O **Cluster Quorum at Risk** também o conta como offline; ele dispara cerca de 7–9 minutos depois que o nó ficou em silêncio, quando toda a janela de 5 minutos dele tem relatórios.",
  "- Its next report brings it back.":
    "- O próximo relatório dele o traz de volta.",
  'Offline means "stopped reporting": a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. A standalone host or a whole cluster going silent has nobody left to report it, so the cluster turns **Disconnected** instead. A node silent for more than 7 days is no longer reported. The reports are marked `oneuptime.proxmox.inferred=not-reporting` in Metrics Explorer.':
    "Offline significa “parou de reportar”: um `pvestatd` travado, um `pmxcfs` parado ou uma rede cortada até o OneUptime aparecem da mesma forma. Um host independente ou um cluster inteiro em silêncio não tem mais ninguém para reportá-lo, então o cluster passa a **Desconectado**. Um nó em silêncio há mais de 7 dias deixa de ser reportado. Esses relatórios são marcados com `oneuptime.proxmox.inferred=not-reporting` no Explorador de Métricas.",
  "The cluster registers under its Proxmox cluster name; a standalone node registers under its node name. A `proxmox.cluster.name` resource attribute set under the metric server's *Resource Attributes* keeps being used instead.":
    "O cluster se registra com o nome do cluster Proxmox dele; um nó independente se registra com o nome do nó. Um atributo de recurso `proxmox.cluster.name` definido em *Resource Attributes* do servidor de métricas continua sendo usado no lugar.",
  "OneUptime translates the push into the `pve_*` series the agent sends, so the Proxmox pages and the CPU / memory / storage alert templates work unchanged. The original `proxmox_*` series stay available in Metrics Explorer for anything else Proxmox VE reports.":
    "O OneUptime traduz o push para as séries `pve_*` que o agente envia, então as páginas do Proxmox e os modelos de alerta de CPU, memória e armazenamento funcionam sem mudanças. As séries `proxmox_*` originais continuam disponíveis no Explorador de Métricas para tudo o mais que o Proxmox VE reporta.",
  "Some alert templates need data only the agent collects:":
    "Alguns modelos de alerta precisam de dados que só o agente coleta:",
  "| Needs the agent | Why |": "| Precisa do agente | Por quê |",
  "| HA state | Not pushed — the **HA Resource in Error State** template needs the agent |":
    "| Estado de HA | Não enviado: o modelo **HA Resource in Error State** precisa do agente |",
  "| Start-on-boot flag | Not pushed — **Guest Down**, which only pages for guests set to start on boot, needs the agent |":
    "| Sinalizador de início no boot | Não enviado: o **Guest Down**, que só alerta para convidados configurados para iniciar no boot, precisa do agente |",
  "| Backup coverage and replication | Not pushed — **Guest Not Backed Up** and **Replication Failing** need the agent |":
    "| Cobertura de backup e replicação | Não enviadas: **Guest Not Backed Up** e **Replication Failing** precisam do agente |",
  "Every node has stopped reporting, or never started.":
    "Todos os nós pararam de reportar, ou nunca começaram.",
  "1. Under *Datacenter → Metric Server*, check the OpenTelemetry entry: server `<YOUR_ONEUPTIME_HOST>`, port `443`, protocol `https`, path `/otlp/v1/metrics`, and the `x-oneuptime-token` header with a key from step 1.":
    "1. Em *Datacenter → Metric Server*, verifique a entrada OpenTelemetry: servidor `<YOUR_ONEUPTIME_HOST>`, porta `443`, protocolo `https`, caminho `/otlp/v1/metrics` e o cabeçalho `x-oneuptime-token` com uma chave da etapa 1.",
  "2. Check that the nodes can reach `<YOUR_ONEUPTIME_HOST>` over the network.":
    "2. Verifique se os nós alcançam `<YOUR_ONEUPTIME_HOST>` pela rede.",
  "It stopped reporting: a node that is down, a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. Its next report brings it back. If you took the node out of the cluster, use **Remove Node** on its page — otherwise it stays Offline for up to 7 days.":
    "Ele parou de reportar: um nó fora do ar, um `pvestatd` travado, um `pmxcfs` parado ou uma rede cortada até o OneUptime aparecem da mesma forma. O próximo relatório dele o traz de volta. Se você tirou o nó do cluster, use **Remover nó** na página dele; caso contrário, ele fica Offline por até 7 dias.",
  "The native push does not send HA state, start-on-boot, backup coverage or replication. Pick **Install script** or **Docker Compose** at the top of this guide to run the agent instead — and remove the metric server, since running both reports every resource twice.":
    "O push nativo não envia estado de HA, início no boot, cobertura de backup nem replicação. Escolha **Script de instalação** ou **Docker Compose** no topo deste guia para executar o agente em vez disso, e remova o servidor de métricas, já que com os dois cada recurso é reportado duas vezes.",
  "This cluster is **`pve-1`** in OneUptime. If that is not the Proxmox cluster's own name, set `proxmox.cluster.name` to `pve-1` under the metric server's *Resource Attributes*, or the push registers a new cluster.":
    "Este cluster é **`pve-1`** no OneUptime. Se esse não for o nome próprio do cluster Proxmox, defina `proxmox.cluster.name` como `pve-1` em *Resource Attributes* do servidor de métricas, ou o push registrará um novo cluster.",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the name the cluster appears under in OneUptime: its Proxmox cluster name, or a standalone node's own name.":
    "Requer Proxmox VE 8.3 ou mais recente. O primeiro comando adiciona um destino de webhook chamado `oneuptime`, que envia cada notificação ao OneUptime como um registro deste cluster e guarda a chave e o nome do cluster nos segredos dele. O segundo envia todas as notificações para ele. Substitua `my-proxmox-cluster` pelo nome com que o cluster aparece no OneUptime: o nome do cluster Proxmox dele, ou o nome próprio de um nó independente.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | Não | O nome do contêiner do coletor (padrão: `oneuptime-proxmox-agent`). O agente de um segundo cluster na mesma máquina precisa de nomes próprios: o script de instalação dá aos contêineres de um novo agente o nome da pasta dele, a menos que você os defina, e os mantém quando você executa o script de novo |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). The install script names a second cluster's API failover sidecar after its collector (`oneuptime-pve-api-failover-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | Não | O nome do contêiner do sidecar de failover da API (padrão: `oneuptime-pve-api-failover`). O script de instalação dá ao sidecar de failover da API de um segundo cluster um nome baseado no do coletor dele (`oneuptime-pve-api-failover-cluster2` ao lado de `oneuptime-proxmox-agent-cluster2`), a menos que você o defina, e o mantém quando você executa o script de novo |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). The install script names a second cluster's bundled exporter after its collector (`oneuptime-pve-exporter-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | Não | O nome do contêiner do exportador incluído (padrão: `oneuptime-pve-exporter`). O script de instalação dá ao exportador incluído de um segundo cluster um nome baseado no do coletor dele (`oneuptime-pve-exporter-cluster2` ao lado de `oneuptime-proxmox-agent-cluster2`), a menos que você o defina, e o mantém quando você executa o script de novo |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-proxmox-ai-agent-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | Não | O nome do contêiner do agente de IA (padrão: `oneuptime-proxmox-ai-agent`). O script de instalação dá ao agente de IA de um segundo cluster um nome baseado no do coletor dele (`oneuptime-proxmox-ai-agent-cluster2` ao lado de `oneuptime-proxmox-agent-cluster2`), a menos que você o defina, e o mantém quando você executa o script de novo |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "Um agente lê um cluster. Para um segundo cluster, instale um segundo agente em uma pasta própria, com nomes de contêiner próprios, porque dois contêineres não podem compartilhar um nome:",
  "The script names the containers after the folder, such as `oneuptime-proxmox-agent-cluster2`, unless you set their variables, such as `PROXMOX_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "O script dá aos contêineres nomes baseados na pasta, como `oneuptime-proxmox-agent-cluster2`, a menos que você defina as variáveis deles, como `PROXMOX_AGENT_CONTAINER_NAME`. Ele guarda os nomes no `.env` desse agente, então executar o script de novo com o mesmo `INSTALL_DIR` para atualizar o agente os mantém, e um agente cujo `container_name` você já editou no `docker-compose.yml` mantém esse nome.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "Dê a cada pasta um nome próprio: o Docker Compose dá a um projeto o nome apenas da pasta dele, então o script recusa uma pasta com o mesmo nome de outra que já executa um agente em outro lugar. Passe a pasta ao script de diagnóstico com `-d`.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | Não | O nome do contêiner do coletor (padrão: `oneuptime-proxmox-agent`). O agente de um segundo cluster na mesma máquina precisa de um próprio |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | Não | O nome do contêiner do sidecar de failover da API (padrão: `oneuptime-pve-api-failover`). O agente de um segundo cluster na mesma máquina precisa de um próprio |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | Não | O nome do contêiner do exportador incluído (padrão: `oneuptime-pve-exporter`). O agente de um segundo cluster na mesma máquina precisa de um próprio |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | Não | O nome do contêiner do agente de IA (padrão: `oneuptime-proxmox-ai-agent`). O agente de um segundo cluster na mesma máquina precisa de um próprio |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "Um agente lê um cluster. Para um segundo cluster, configure um segundo agente em uma pasta própria, com nomes de contêiner próprios, porque dois contêineres não podem compartilhar um nome. Defina-os no `.env` desse agente:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "Dê a cada pasta um nome próprio: o Docker Compose dá a um projeto o nome apenas da pasta dele, então uma segunda pasta com o mesmo nome substituiria os contêineres do primeiro agente. Deixe os nomes fora do `docker-compose.yml`, que uma atualização substitui.",
};

export default TRANSLATION;
