import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The XcpNg setup guide in Portuguese (#8341): each piece of the English
 * guide's markdown (Pages/XcpNg/Utils/DocumentationMarkdown.ts) and its
 * Portuguese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Portuguese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Xen Orchestra 6.9 or later, connected to the pools you want to monitor. Its OpenMetrics plugin needs a Premium licence on an XOA; Xen Orchestra built from sources includes it":
    "Xen Orchestra 6.9 ou posterior, conectado aos pools que você quer monitorar. O plugin OpenMetrics dele precisa de uma licença Premium em um XOA; o Xen Orchestra compilado a partir do código-fonte já o inclui",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach Xen Orchestra over HTTPS":
    "Docker Engine 20.10 ou posterior com o plugin Docker Compose v2, em uma máquina que alcance o Xen Orchestra por HTTPS",
  "A certificate on Xen Orchestra that names the address the agent connects to. The self-signed certificate Xen Orchestra makes for itself names none, so no current TLS client can check it — see **Xen Orchestra's certificate** under Advanced":
    "Um certificado no Xen Orchestra que nomeie o endereço ao qual o agente se conecta. O certificado autoassinado que o Xen Orchestra cria para si mesmo não nomeia nenhum, então nenhum cliente TLS atual consegue verificá-lo — veja **Certificado do Xen Orchestra** em Avançado",
  "1. In Xen Orchestra, open *Settings → Plugins* and find **openmetrics**.":
    "1. No Xen Orchestra, abra *Settings → Plugins* e encontre **openmetrics**.",
  "2. Turn it on. The first time it starts, it makes a secret and keeps it, and Xen Orchestra keeps it across restarts.":
    "2. Ative-o. Na primeira vez que inicia, ele cria um segredo e o guarda, e o Xen Orchestra o mantém entre reinicializações.",
  "3. Open the plugin's settings and copy its **Prometheus secret** — you give it to the agent in the next step. You can also type a secret of your own there and save it.":
    "3. Abra as configurações do plugin e copie o **Prometheus secret** dele — você o entrega ao agente na próxima etapa. Você também pode digitar ali um segredo seu e salvá-lo.",
  "The plugin answers on Xen Orchestra's own address and certificate, at `/openmetrics/metrics`, and only to a request that carries its secret. It serves every pool Xen Orchestra is connected to, so one agent covers them all.":
    "O plugin responde no próprio endereço e com o próprio certificado do Xen Orchestra, em `/openmetrics/metrics`, e só a uma requisição que traga o segredo dele. Ele serve todos os pools aos quais o Xen Orchestra está conectado, então um só agente cobre todos.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "O script pede a URL do OneUptime e a chave de ingestão, ambas mostradas na etapa 1 (escolha uma chave lá para que sejam preenchidas aqui), e depois:",
  "- **Xen Orchestra's address** — as you open it in a browser, e.g. `https://xo.example.com` or `https://10.0.0.5:8443`.":
    "- **Endereço do Xen Orchestra** — como você o abre em um navegador, por ex., `https://xo.example.com` ou `https://10.0.0.5:8443`.",
  "- **The OpenMetrics plugin's secret** — from the previous step. It is not shown as you type it.":
    "- **Segredo do plugin OpenMetrics** — o da etapa anterior. Ele não aparece enquanto você o digita.",
  "- **What to call this Xen Orchestra** — the name each of its pools shows on its Settings. Press Enter to use its address.":
    "- **Como chamar este Xen Orchestra** — o nome que cada um dos pools dele mostra nas Configurações. Pressione Enter para usar o endereço dele.",
  "The script then reads Xen Orchestra's certificate. When this machine already trusts it, the agent trusts the same CA bundle. When it does not, the script shows the certificate's SHA-256 fingerprint: compare it with the one on Xen Orchestra's machine and answer **y** to trust that certificate and nothing else. It never turns the check off. It then asks the plugin for its metrics with the secret and says which pools Xen Orchestra reports, before it installs anything.":
    "Em seguida o script lê o certificado do Xen Orchestra. Quando esta máquina já confia nele, o agente confia no mesmo pacote de CA. Quando não confia, o script mostra a impressão digital SHA-256 do certificado: compare-a com a da máquina do Xen Orchestra e responda **y** para confiar nesse certificado e em nada mais. Ele nunca desliga a verificação. Depois pede ao plugin as métricas dele com o segredo e diz quais pools o Xen Orchestra informa, antes de instalar qualquer coisa.",
  "It installs to `/opt/oneuptime-xcp-ng-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Ele instala em `/opt/oneuptime-xcp-ng-agent`, grava um arquivo `.env` com `0600` e inicia o agente com o Docker Compose. Executar o script de novo reutiliza tudo o que está nesse `.env` em vez de perguntar de novo, e é também assim que você atualiza.",
  "`docker compose ps` lists `oneuptime-xcp-ng-agent`. In its logs, look for `Everything is ready. Begin running and processing data.` The agent reads Xen Orchestra every minute, and each pool it reports then appears in the **XCP-ng** section under the name Xen Orchestra gives it, with its hosts, VMs and storage.":
    "`docker compose ps` lista `oneuptime-xcp-ng-agent`. Nos registros dele, procure `Everything is ready. Begin running and processing data.` O agente lê o Xen Orchestra a cada minuto, e cada pool que ele informa aparece então na seção **XCP-ng** com o nome que o Xen Orchestra lhe dá, com seus hosts, suas VMs e seu armazenamento.",
  "The install script writes these to `/opt/oneuptime-xcp-ng-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`.":
    "O script de instalação grava estas variáveis em `/opt/oneuptime-xcp-ng-agent/.env`. Depois de alterar uma, aplique-a com `docker compose up -d` em `/opt/oneuptime-xcp-ng-agent`.",
  "| Variable | Required | Description |":
    "| Variável | Obrigatória | Descrição |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Sim | A URL da sua instância do OneUptime (por ex., `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Sim | A chave de ingestão de telemetria, a escolhida na etapa 1 |",
  "| `XO_ADDRESS` | Yes | Xen Orchestra's `host` or `host:port`, without a scheme |":
    "| `XO_ADDRESS` | Sim | O `host` ou `host:port` do Xen Orchestra, sem esquema |",
  "| `XO_SCHEME` | No | `https` (default). `http` only in a lab: the secret then crosses the network in clear |":
    "| `XO_SCHEME` | Não | `https` (padrão). `http` só em laboratório: o segredo passa então pela rede sem criptografia |",
  "| `XO_OPENMETRICS_SECRET` | Yes | The OpenMetrics plugin's secret, sent as a Bearer token. Every `$` in it is written as `$$` |":
    "| `XO_OPENMETRICS_SECRET` | Sim | O segredo do plugin OpenMetrics, enviado como token Bearer. Cada `$` nele é escrito como `$$` |",
  "| `XO_NAME` | No | What to call this Xen Orchestra in OneUptime, shown on each of its pools' Settings (default: its address) |":
    "| `XO_NAME` | Não | Como chamar este Xen Orchestra no OneUptime, mostrado nas Configurações de cada um dos pools dele (padrão: o endereço dele) |",
  "| `XO_TLS_SERVER_NAME` | No | The name Xen Orchestra's certificate is checked against, when `XO_ADDRESS` is an address the certificate does not list |":
    "| `XO_TLS_SERVER_NAME` | Não | O nome com que o certificado do Xen Orchestra é verificado, quando `XO_ADDRESS` é um endereço que o certificado não lista |",
  "| `XO_URL` | Install script | Xen Orchestra's address as typed; the script derives `XO_SCHEME` and `XO_ADDRESS` from it |":
    "| `XO_URL` | Script de instalação | O endereço do Xen Orchestra como digitado; o script deriva dele `XO_SCHEME` e `XO_ADDRESS` |",
  "| `XO_TLS_FINGERPRINT` | Install script | The SHA-256 fingerprint of Xen Orchestra's own certificate, when the agent trusts that certificate and nothing else |":
    "| `XO_TLS_FINGERPRINT` | Script de instalação | A impressão digital SHA-256 do próprio certificado do Xen Orchestra, quando o agente confia nesse certificado e em nada mais |",
  "| `XO_CA_FILE` | Install script | A CA bundle that issued Xen Orchestra's certificate, which the script copies to `xo-ca.pem` |":
    "| `XO_CA_FILE` | Script de instalação | Um pacote de CA que emitiu o certificado do Xen Orchestra, que o script copia para `xo-ca.pem` |",
  "| `ONEUPTIME_AI_XO_READ_TOKEN` | No | A token of a Xen Orchestra user holding a copy of the built-in **Read only** role and nothing else: the XCP-ng AI agent runs when it is set, and reads with it |":
    "| `ONEUPTIME_AI_XO_READ_TOKEN` | Não | Um token de um usuário do Xen Orchestra que tem uma cópia do papel integrado **Read only** e nada mais: o agente de IA do XCP-ng roda quando ele está definido e lê com ele |",
  "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | No | Only for fixes: a token of another user, whose role allows them. The AI agent changes nothing without it |":
    "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | Não | Só para correções: um token de outro usuário, cujo papel as permite. Sem ele, o agente de IA não altera nada |",
  "| `XCP_NG_POOL_ID` | No | The XAPI UUID of the pool the AI agent serves (default: the one pool its read token can see) |":
    "| `XCP_NG_POOL_ID` | Não | O UUID do XAPI do pool que o agente de IA atende (padrão: o único pool que o token de leitura dele consegue ver) |",
  "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | No | Overrides `XCP_NG_POOL_ID` as the pool the AI agent registers as |":
    "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | Não | Substitui `XCP_NG_POOL_ID` como o pool com que o agente de IA se registra |",
  "| `ONEUPTIME_AI_INVESTIGATION` | No | `true` or `false`: whether OneUptime AI may run the AI agent's read-only commands while it investigates (default: on) |":
    "| `ONEUPTIME_AI_INVESTIGATION` | Não | `true` ou `false`: se a OneUptime AI pode executar os comandos somente leitura do agente de IA enquanto investiga (padrão: ativado) |",
  "| `ONEUPTIME_AI_FIXES` | No | `off`, `ask-for-approval`, `automatic` or `bypass-approval`: how OneUptime AI may apply a fix |":
    "| `ONEUPTIME_AI_FIXES` | Não | `off`, `ask-for-approval`, `automatic` ou `bypass-approval`: como a OneUptime AI pode aplicar uma correção |",
  "| `ONEUPTIME_AI_ALLOW_WRITES` | No | `true` lets the AI agent apply fixes, with the token for changes. Anything else keeps it read-only |":
    "| `ONEUPTIME_AI_ALLOW_WRITES` | Não | `true` permite que o agente de IA aplique correções, com o token para alterações. Qualquer outro valor o mantém somente leitura |",
  "| `ONEUPTIME_AI_WRITE_TARGETS` | No | The `vm/<uuid>`, `host/<uuid>`, `pbd/<uuid>` or `schedule/<uuid>` a fix may touch, comma-separated (default: all) |":
    "| `ONEUPTIME_AI_WRITE_TARGETS` | Não | Os `vm/<uuid>`, `host/<uuid>`, `pbd/<uuid>` ou `schedule/<uuid>` que uma correção pode tocar, separados por vírgulas (padrão: todos) |",
  "| `ONEUPTIME_AI_PROTECTED_TARGETS` | No | The same, for what OneUptime AI must never change: the VM the AI agent runs in, and Xen Orchestra's own |":
    "| `ONEUPTIME_AI_PROTECTED_TARGETS` | Não | O mesmo, para o que a OneUptime AI nunca deve alterar: a VM em que o agente de IA roda, e a do próprio Xen Orchestra |",
  "| `LOG_LEVEL` | No | The AI agent's log level: `debug`, `info` (default), `warn` or `error` |":
    "| `LOG_LEVEL` | Não | O nível de log do agente de IA: `debug`, `info` (padrão), `warn` ou `error` |",
  "| `COMPOSE_PROFILES` | No | `xcp-ng-ai-agent` starts the AI agent; the install script writes it when the read token is set |":
    "| `COMPOSE_PROFILES` | Não | `xcp-ng-ai-agent` inicia o agente de IA; o script de instalação o grava quando o token de leitura está definido |",
  "The agent checks Xen Orchestra's certificate against `xo-ca.pem`, next to `docker-compose.yml`.":
    "O agente verifica o certificado do Xen Orchestra com `xo-ca.pem`, ao lado do `docker-compose.yml`.",
  "The agent checks Xen Orchestra's certificate on every read, against `xo-ca.pem` and nothing else. That file holds one of three things:":
    "O agente verifica o certificado do Xen Orchestra a cada leitura, com `xo-ca.pem` e nada mais. Esse arquivo guarda uma de três coisas:",
  "- **Xen Orchestra's own certificate**, pinned by its SHA-256 fingerprint (`XO_TLS_FINGERPRINT`): the agent trusts that certificate and no other.":
    "- **O próprio certificado do Xen Orchestra**, fixado pela impressão digital SHA-256 dele (`XO_TLS_FINGERPRINT`): o agente confia nesse certificado e em nenhum outro.",
  "- **The CA that issued it** (`XO_CA_FILE`), for a certificate from a CA of your own.":
    "- **A CA que o emitiu** (`XO_CA_FILE`), para um certificado de uma CA sua.",
  "- **This machine's CA bundle**, for a certificate this machine already trusts.":
    "- **O pacote de CA desta máquina**, para um certificado em que esta máquina já confia.",
  "Either way, the certificate must name the address the agent connects to: the agent checks the names a certificate is issued to, as every current TLS client does, and not its subject. The self-signed certificate Xen Orchestra makes for itself names none, so the agent cannot trust it, pinned or not, and fails with `x509: certificate is not valid for any names`. Give Xen Orchestra a certificate that names its address — from your CA, or a self-signed one with a subject alternative name — as [Xen Orchestra's certificate](/docs/telemetry/xcp-ng#xen-orchestras-certificate) shows.":
    "De qualquer forma, o certificado precisa nomear o endereço ao qual o agente se conecta: o agente verifica os nomes para os quais um certificado foi emitido, como todo cliente TLS atual faz, e não o assunto dele. O certificado autoassinado que o Xen Orchestra cria para si mesmo não nomeia nenhum, então o agente não pode confiar nele, fixado ou não, e falha com `x509: certificate is not valid for any names`. Dê ao Xen Orchestra um certificado que nomeie o endereço dele — da sua CA, ou um autoassinado com um nome alternativo do assunto (subject alternative name) —, como mostra [O certificado do Xen Orchestra](/docs/telemetry/xcp-ng#xen-orchestras-certificate).",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When a pinned certificate is renewed, the agent stops reading Xen Orchestra until it trusts the new one. Run the install script again: it shows the new fingerprint and stops, changing nothing. Check that fingerprint on Xen Orchestra's machine, then run the script once more with it: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.":
    "Quando o certificado nomeia o Xen Orchestra com outro nome que não o endereço em `XO_ADDRESS`, defina `XO_TLS_SERVER_NAME` com esse nome. Quando um certificado fixado é renovado, o agente para de ler o Xen Orchestra até confiar no novo. Execute o script de instalação de novo: ele mostra a nova impressão digital e para, sem mudar nada. Confira essa impressão digital na máquina do Xen Orchestra e depois execute o script mais uma vez com ela: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.",
  "Every minute the agent reads the plugin, which reads each host's XAPI round-robin databases at 60-second resolution. It keeps the `xcp_*` series, and moves each series' pool to the batch it sends, as `xcp_ng.pool.id` (the pool's UUID, which never changes) and `xcp_ng.pool.name`:":
    "A cada minuto o agente lê o plugin, que lê pelo XAPI os bancos de dados round-robin de cada host com resolução de 60 segundos. Ele mantém as séries `xcp_*` e move o pool de cada série para o lote que envia, como `xcp_ng.pool.id` (o UUID do pool, que nunca muda) e `xcp_ng.pool.name`:",
  "| Category | Series |": "| Categoria | Séries |",
  "| **Pool** | `xcp_pool_connected` — present while Xen Orchestra is connected to the pool |":
    "| **Pool** | `xcp_pool_connected` — presente enquanto o Xen Orchestra está conectado ao pool |",
  "| **Hosts** | `xcp_host_status` (power state and whether it is enabled), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` per interface, `xcp_host_disk_*` per storage repository |":
    "| **Hosts** | `xcp_host_status` (estado de energia e se está habilitado), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` por interface, `xcp_host_disk_*` por repositório de armazenamento |",
  "| **VMs** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU contention), `xcp_vm_memory_*`, `xcp_vm_network_*` per interface, `xcp_vm_disk_*` per disk, `xcp_vm_power_consumption_watts` |":
    "| **VMs** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (contenção de CPU), `xcp_vm_memory_*`, `xcp_vm_network_*` por interface, `xcp_vm_disk_*` por disco, `xcp_vm_power_consumption_watts` |",
  "| **Storage** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |":
    "| **Armazenamento** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |",
  "| **XOSTOR** | `xcp_xostor_*`, on pools that run XOSTOR |":
    "| **XOSTOR** | `xcp_xostor_*`, nos pools que executam o XOSTOR |",
  'Control domains report as VMs with `is_control_domain="true"`; the pages hide them unless you ask for them.':
    'Os domínios de controle aparecem como VMs com `is_control_domain="true"`; as páginas os ocultam, a menos que você peça para vê-los.',
  "Xen Orchestra types eight throughput series as counters, though each holds XAPI's per-second rate: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, and the VM network, network error and disk read and write series. The agent turns them into gauges with their values untouched, so OneUptime stores them as the rates they are, in bytes or errors per second.":
    "O Xen Orchestra tipa oito séries de taxa de transferência como contadores, embora cada uma traga a taxa por segundo do XAPI: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, e as séries de rede, de erros de rede e de leitura e gravação em disco das VMs. O agente as transforma em gauges sem mexer nos valores, então o OneUptime as armazena como as taxas que são, em bytes ou erros por segundo.",
  "OneUptime adds four 0/1 series for each pool, which the alert templates read: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` and `xcp_ng.vm.stopped_after_running` (a VM halted or paused that ran in the last day). It also stamps every point with `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` or `xostor`) and `xcp_ng.id` (that object's UUID), which monitors and dashboards filter on.":
    "O OneUptime adiciona quatro séries 0/1 para cada pool, que os modelos de alerta leem: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` e `xcp_ng.vm.stopped_after_running` (uma VM parada ou pausada que rodou no último dia). Ele também carimba cada ponto com `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` ou `xostor`) e `xcp_ng.id` (o UUID desse objeto), pelos quais monitores e painéis filtram.",
  "Not kept: Xen Orchestra's own process series (`xo_*`), which belong to no pool, and a host's power read over IPMI, which the plugin sends without its pool. Each VM's estimated share of it is kept.":
    "Não são mantidas: as séries de processo do próprio Xen Orchestra (`xo_*`), que não pertencem a nenhum pool, e a potência de um host lida por IPMI, que o plugin envia sem o pool dela. A parcela estimada de cada VM nela é mantida.",
  "One agent reads one Xen Orchestra and every pool it manages. For a second Xen Orchestra, install a second agent in a folder of its own, with its own `container_name` in its `docker-compose.yml`:":
    "Um agente lê um Xen Orchestra e todos os pools que ele gerencia. Para um segundo Xen Orchestra, instale um segundo agente em uma pasta própria, com seu próprio `container_name` no seu `docker-compose.yml`:",
  "Don't let two Xen Orchestras that manage the same pool both be read: the pool is one pool in OneUptime, by its UUID, and would be reported twice.":
    "Não deixe que dois Xen Orchestra que gerenciam o mesmo pool sejam lidos: o pool é um único pool no OneUptime, pelo UUID dele, e seria informado duas vezes.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on each pool the agent reads: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `oneuptime.agent.version`:":
    "Qualquer atributo de recurso com o prefixo `oneuptime.label.` vira um rótulo de projeto em cada pool que o agente lê: `oneuptime.label.<dimension>=<value>` é o rótulo `<dimension>:<value>`. Adicione-os ao processor `resource` em `otel-collector-config.yaml`, ao lado de `oneuptime.agent.version`:",
  "Then restart the collector so it reads the new config:":
    "Depois reinicie o coletor para que ele leia a nova configuração:",
  "The pools show up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent. Running the install script again replaces an edited `otel-collector-config.yaml` and keeps yours next to it as `otel-collector-config.yaml.bak.<timestamp>`.":
    "Os pools aparecem com os rótulos `team:platform` e `env:production`. Os rótulos são comparados sem diferenciar maiúsculas de minúsculas, então um rótulo `Production` existente é reutilizado; o agente nunca remove os rótulos adicionados na interface do OneUptime. Executar o script de instalação de novo substitui um `otel-collector-config.yaml` editado e mantém o seu ao lado como `otel-collector-config.yaml.bak.<timestamp>`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), checks Xen Orchestra's certificate the same way, downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the image and recreates the agent with it:":
    "**Atualizar** — a imagem do coletor está fixada no `docker-compose.yml` e a configuração dele é um arquivo ao lado, então baixar a imagem não basta para atualizar o agente. Execute o script de instalação de novo. Ele reutiliza todos os valores do seu `.env` existente (nada é perguntado de novo), verifica o certificado do Xen Orchestra da mesma forma, baixa os mais recentes `docker-compose.yml` e `otel-collector-config.yaml` — um arquivo que você editou é mantido ao lado do novo como `<file>.bak.<timestamp>` —, baixa a imagem e recria o agente com ela:",
  "The config reports the collector version it pins as each pool's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "A configuração informa a versão do coletor que ela fixa como a **Versão do agente** de cada pool. Quando este OneUptime fixa uma mais nova, um sinal de aviso ao lado dela abre estes comandos.",
  "**Uninstall** the agent:": "**Desinstale** o agente:",
  "Then turn off the OpenMetrics plugin in Xen Orchestra if nothing else reads it.":
    "Depois desative o plugin OpenMetrics no Xen Orchestra se nada mais o lê.",
  "`troubleshoot.sh` checks the whole chain — the container, Xen Orchestra's certificate against `xo-ca.pem`, the plugin and its secret, the pools it reports — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss.":
    "`troubleshoot.sh` verifica toda a cadeia — o contêiner, o certificado do Xen Orchestra com `xo-ca.pem`, o plugin e o segredo dele, os pools que ele informa — e pergunta diretamente ao OneUptime se ele aceita sua chave de ingestão. Essa última verificação é a que mais importa: os endpoints OTLP do OneUptime recusam uma chave incorreta com `401` ou `422`, que o coletor registra como uma única linha `Exporting failed` por lote, fácil de passar despercebida.",
  "It ends with a verdict naming the most likely cause. It never prints the secret.":
    "Ele termina com um veredito que aponta a causa mais provável. Ele nunca imprime o segredo.",
  "OneUptime marks a pool Disconnected when nothing has been read for it for 15 minutes.":
    "O OneUptime marca um pool como Desconectado quando nada foi lido dele por 15 minutos.",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. Se todos os pools deste Xen Orchestra estiverem Desconectados, verifique o agente (em `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` e `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "2. If only one is, Xen Orchestra stopped reporting it: under *Settings → Servers* in Xen Orchestra, the pool's server must be connected. The pool's hosts, VMs and storage stay as Xen Orchestra last reported them.":
    "2. Se for só um, o Xen Orchestra parou de informá-lo: em *Settings → Servers* no Xen Orchestra, o servidor do pool precisa estar conectado. Os hosts, as VMs e o armazenamento do pool ficam como o Xen Orchestra os informou por último.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "O coletor registra `server returned HTTP status 401 Unauthorized`. Copie o segredo de novo em *Settings → Plugins → openmetrics*, defina `XO_OPENMETRICS_SECRET` com ele no `.env` — entre aspas simples, cada `$` escrito como `$$` — e aplique-o com `docker compose up -d` em `/opt/oneuptime-xcp-ng-agent`. Antes da 6.8, o Xen Orchestra criava um segredo novo a cada reinicialização.",
  'Xen Orchestra answers, but its OpenMetrics plugin does not. Turn the plugin on under *Settings → Plugins → openmetrics* (an XOA needs a Premium licence for it), and check that Xen Orchestra is 6.9 or later. `/openmetrics/health` answers `{"status":"ok"}` without a secret while the plugin runs.':
    'O Xen Orchestra responde, mas o plugin OpenMetrics dele não. Ative o plugin em *Settings → Plugins → openmetrics* (um XOA precisa de uma licença Premium para isso) e verifique se o Xen Orchestra é a versão 6.9 ou posterior. `/openmetrics/health` responde `{"status":"ok"}` sem segredo enquanto o plugin está em execução.',
  "- `x509: certificate is not valid for any names` — the certificate names no address, as Xen Orchestra's own self-signed one does. Give Xen Orchestra a certificate that names its address.":
    "- `x509: certificate is not valid for any names` — o certificado não nomeia nenhum endereço, como o próprio certificado autoassinado do Xen Orchestra. Dê ao Xen Orchestra um certificado que nomeie o endereço dele.",
  "- `x509: certificate is valid for <names>, not <address>` — connect to one of those names, or set `XO_TLS_SERVER_NAME` to one.":
    "- `x509: certificate is valid for <names>, not <address>` — conecte-se a um desses nomes, ou defina `XO_TLS_SERVER_NAME` com um deles.",
  "- `x509: certificate signed by unknown authority` — `xo-ca.pem` does not hold this certificate or the CA that issued it. The certificate was renewed, or the file holds the wrong one: write it again, as **Xen Orchestra's certificate** under Advanced says.":
    "- `x509: certificate signed by unknown authority` — `xo-ca.pem` não contém este certificado nem a CA que o emitiu. O certificado foi renovado, ou o arquivo guarda o errado: grave-o de novo, como explica **Certificado do Xen Orchestra** em Avançado.",
  "Xen Orchestra reports only the pools it is connected to, and the agent reads only that Xen Orchestra. Connect the pool's server under *Settings → Servers* in Xen Orchestra; the pool appears in OneUptime with the next read. A pool read by another Xen Orchestra needs an agent beside that one.":
    "O Xen Orchestra informa só os pools aos quais está conectado, e o agente lê só esse Xen Orchestra. Conecte o servidor do pool em *Settings → Servers* no Xen Orchestra; o pool aparece no OneUptime na próxima leitura. Um pool lido por outro Xen Orchestra precisa de um agente próprio, ao lado desse outro Xen Orchestra.",
  "- **What to call this Xen Orchestra** — the command already names it **`xo-paris`**, as this pool's Settings show it.":
    "- **Como chamar este Xen Orchestra** — o comando já o nomeia **`xo-paris`**, como as Configurações deste pool o mostram.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "O comando já traz a sua URL do OneUptime e a sua chave de ingestão. O script pede o resto:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Baixe `docker-compose.yml` e `otel-collector-config.yaml` deste OneUptime em uma pasta nova:",
  "Create a `.env` file next to them — it holds the plugin's secret, so keep it private with `chmod 600 .env`:":
    "Crie um arquivo `.env` ao lado deles; ele guarda o segredo do plugin, então mantenha-o privado com `chmod 600 .env`:",
  "- Set `XO_ADDRESS` to Xen Orchestra's `host` or `host:port`, without `https://`.":
    "- Defina `XO_ADDRESS` com o `host` ou `host:port` do Xen Orchestra, sem `https://`.",
  "- Put the plugin's secret between single quotes. If it holds a `$`, write each one as `$$`: the collector reads the value once more.":
    "- Coloque o segredo do plugin entre aspas simples. Se ele tiver um `$`, escreva cada um como `$$`: o coletor lê o valor mais uma vez.",
  "- `XO_NAME` is what each pool's Settings call this Xen Orchestra.":
    "- `XO_NAME` é como as Configurações de cada pool chamam este Xen Orchestra.",
  "Then give the agent Xen Orchestra's certificate, as `xo-ca.pem` next to `docker-compose.yml` — the agent checks Xen Orchestra against this file and nothing else. To trust Xen Orchestra's own certificate, read it and check its fingerprint against the one on Xen Orchestra's machine:":
    "Depois dê ao agente o certificado do Xen Orchestra, como `xo-ca.pem` ao lado do `docker-compose.yml` — o agente verifica o Xen Orchestra com esse arquivo e nada mais. Para confiar no próprio certificado do Xen Orchestra, leia-o e confira a impressão digital dele com a da máquina do Xen Orchestra:",
  "When a CA of your own issued it, copy that CA's certificate to `xo-ca.pem` instead; when a public CA did, copy this machine's CA bundle (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).":
    "Quando uma CA sua o emitiu, copie em vez disso o certificado dessa CA para `xo-ca.pem`; quando foi uma CA pública, copie o pacote de CA desta máquina (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).",
  "Start the agent:": "Inicie o agente:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Escolha uma chave de ingestão na etapa 1 para preencher `<YOUR_API_KEY>`.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "O agente as lê do arquivo `.env` ao lado do `docker-compose.yml`. Depois de alterar uma, aplique-a com `docker compose up -d` na pasta que contém o `docker-compose.yml`.",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When the certificate in `xo-ca.pem` is renewed, read it again as in step 3, then run `docker compose up -d --force-recreate`.":
    "Quando o certificado nomeia o Xen Orchestra com outro nome que não o endereço em `XO_ADDRESS`, defina `XO_TLS_SERVER_NAME` com esse nome. Quando o certificado em `xo-ca.pem` é renovado, leia-o de novo como na etapa 3 e depois execute `docker compose up -d --force-recreate`.",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Execute-os na pasta do agente, a que contém o `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `xo-ca.pem` stay, and a change you made to either file has to be made again:":
    "**Atualizar** — a imagem do coletor está fixada no `docker-compose.yml` e a configuração dele é um arquivo ao lado, então baixar a imagem não basta para atualizar o agente. Baixe os dois arquivos de novo; o seu `.env` e o `xo-ca.pem` ficam, e uma alteração que você fez em um dos arquivos precisa ser feita de novo:",
  "Then pull the image and recreate the agent, so the collector reads its new config:":
    "Depois baixe a imagem e recrie o agente, para que o coletor leia a nova configuração:",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in the agent's folder): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. Se todos os pools deste Xen Orchestra estiverem Desconectados, verifique o agente (na pasta do agente): `docker compose ps` e `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "O coletor registra `server returned HTTP status 401 Unauthorized`. Copie o segredo de novo em *Settings → Plugins → openmetrics*, defina `XO_OPENMETRICS_SECRET` com ele no `.env` — entre aspas simples, cada `$` escrito como `$$` — e aplique-o com `docker compose up -d` na pasta que contém o `docker-compose.yml`. Antes da 6.8, o Xen Orchestra criava um segredo novo a cada reinicialização.",
};

export default TRANSLATION;
