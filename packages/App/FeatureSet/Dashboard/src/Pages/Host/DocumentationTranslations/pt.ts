import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Host setup guide in Portuguese (#8341): each piece of the English
 * guide's markdown (Pages/Host/Utils/DocumentationMarkdown.ts) and its
 * Portuguese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Portuguese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker installed on the host you want to monitor":
    "Docker instalado no host que você quer monitorar",
  "Network access from the host to your OneUptime instance":
    "Acesso de rede do host à sua instância do OneUptime",
  "Save this as `config.yaml` in the directory you will run `docker run` from — step 3 mounts it into the container.":
    "Salve isto como `config.yaml` no diretório de onde você vai executar `docker run`: a etapa 3 o monta no contêiner.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Escolha uma chave de ingestão na etapa 1 para preencher `<YOUR_API_KEY>`.",
  "`--network host`, `--pid host`, and the `/hostfs` bind mount let the `hostmetrics` and `process` scrapers read CPU, memory, disk, and per-process information from the host kernel rather than the container. Without these, you'd only see metrics for the collector container itself.":
    "`--network host`, `--pid host` e o bind mount `/hostfs` permitem que os scrapers `hostmetrics` e `process` leiam informações de CPU, memória, disco e de cada processo do kernel do host, e não do contêiner. Sem eles, você veria apenas métricas do próprio contêiner do coletor.",
  "Open the **Hosts** list in OneUptime — your host appears automatically once the first metric batch lands (usually within 30 seconds). Not there? Check the collector:":
    "Abra a lista **Hosts** no OneUptime: seu host aparece automaticamente assim que chega o primeiro lote de métricas (geralmente em até 30 segundos). Não está lá? Verifique o coletor:",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer, so add it on Linux hosts only; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**As investigações de IA ficam ativadas por padrão** em todo host: assim que o agente de IA do host roda nele, o OneUptime AI investiga ali incidentes e alertas com comandos somente leitura como `systemctl status`, `df -h`, `free -m` e `ps aux`, e não altera nada a menos que você permita correções. É um contêiner Linux com instalador próprio, então adicione-o apenas em hosts Linux; ele precisa do Docker (o mecanismo do sistema, não o Docker rootless) com o plugin Compose:",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. It asks for your OneUptime URL, the ingestion key and the host's name — leave the name empty to use the hostname, which is what this collector reports. Once it connects, it shows as Connected on the host's **AI → AI agent** page and at the bottom of its **Overview**. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#hosts).":
    "A primeira linha baixa o script como `install.sh`, para que você possa lê-lo antes de executá-lo. Ele pede a URL do OneUptime, a chave de ingestão e o nome do host: deixe o nome vazio para usar o hostname, que é o que este coletor informa. Quando conecta, ele aparece como conectado na página **IA → Agente de IA** do host e no fim da sua **Visão geral**. O que ele pode executar e como as correções funcionam: [Agentes de IA de infraestrutura](/docs/ai/infrastructure-ai-agents#hosts).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to the `config.yaml` you mounted into the container and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "A configuração já preenche os endereços IP, os endereços MAC, a arquitetura, o ID da máquina, a descrição e a versão do sistema operacional no item da máquina em **Inventário**, que é o que uma exportação de CMDB lê. Número de série, fabricante, modelo e versão do firmware (BIOS / UEFI) são diferentes: **nenhum detector de recursos consegue produzi-los.** Eles vêm do firmware da máquina, via DMI. Leia-os uma vez no provisionamento e grave-os no recurso: adicione este processador a o `config.yaml` que você montou no contêiner e cite-o no pipeline de métricas. Mescle-o nas seções que sua configuração já tem: não adicione uma segunda chave `processors:` ou `service:`.",
  "Then recreate the container so it reads the edited file — remove it, and run the `docker run` command from step 3 again:":
    "Depois recrie o contêiner para que ele leia o arquivo editado: remova-o e execute de novo o comando `docker run` da etapa 3:",
  "The values are the machine's own, so they are written once by whatever provisions it. On Linux, read them as root (`bios_version` is readable by anyone):":
    "Os valores são da própria máquina, então são gravados uma vez por quem a provisiona. No Linux, leia-os como root (`bios_version` pode ser lido por qualquer um):",
  "Within a few minutes the values show on the machine's **Inventory** item under **Details**. They are stamped, not detected, so run this again after a motherboard swap or a firmware update.":
    "Em poucos minutos os valores aparecem no item da máquina em **Inventário**, em **Detalhes**. Eles são gravados, não detectados, então execute isto de novo após uma troca de placa-mãe ou uma atualização de firmware.",
  "`host.manufacturer`, `host.model.name`, `host.firmware.version` and `host.bios.version` are accepted as alternative spellings and stored under the `device.*` keys above (and `device.serial_number` under `host.serial_number`), so a config written either way ends up in one place.":
    "`host.manufacturer`, `host.model.name`, `host.firmware.version` e `host.bios.version` são aceitos como grafias alternativas e guardados nas chaves `device.*` acima (e `device.serial_number` em `host.serial_number`), então uma configuração escrita de um jeito ou de outro vai parar no mesmo lugar.",
  "> **Don't set `device.manufacturer` on a mobile app's resource and a host's from the same config.** On a resource that carries no `host.name` or `host.id`, `device.manufacturer` still marks the batch as mobile Real User Monitoring.":
    "> **Não defina `device.manufacturer` no recurso de um app móvel e no de um host a partir da mesma configuração.** Em um recurso sem `host.name` nem `host.id`, `device.manufacturer` continua marcando o lote como Real User Monitoring móvel.",
  "Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the host (and to the telemetry service emitted from this collector). Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.":
    "Todo atributo de recurso com o prefixo `oneuptime.label.` vira um rótulo de projeto associado ao host (e ao serviço de telemetria emitido por este coletor). Padrão: `oneuptime.label.<dimension>=<value>` vira um rótulo chamado `<dimension>:<value>`.",
  "Add a `resource` processor to the `config.yaml` you mounted into the container and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Adicione um processador `resource` a o `config.yaml` que você montou no contêiner e faça referência a ele no pipeline de métricas. Mescle-o nas seções que sua configuração já tem: não adicione uma segunda chave `processors:` ou `service:`.",
  "The host shows up tagged `team:payments`, `env:production`, and `region:us-east-1`. Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated. Labels added manually in the OneUptime UI are never removed by the collector.":
    "O host aparece com os rótulos `team:payments`, `env:production` e `region:us-east-1`. Os rótulos são comparados sem diferenciar maiúsculas e minúsculas, então um rótulo `Production` já criado manualmente é reutilizado em vez de duplicado. O coletor nunca remove rótulos adicionados manualmente na interface do OneUptime.",
  "Hosts are auto-discovered from the OTel `host.name` resource attribute, which the `resourcedetection` processor sets. OneUptime registers the host once a batch that carries `host.name` also carries any of:":
    "Os hosts são descobertos automaticamente pelo atributo de recurso OTel `host.name`, que o processador `resourcedetection` define. O OneUptime registra o host assim que um lote que traz `host.name` também traz qualquer um destes:",
  "- `hostmetrics` receiver metrics (CPU, memory, disk, filesystem, network, load, processes), OR":
    "- métricas do receiver `hostmetrics` (CPU, memória, disco, sistema de arquivos, rede, carga, processos), OU",
  "- `process` scraper metrics (per-process CPU/memory/threads), OR":
    "- métricas do scraper `process` (CPU/memória/threads por processo), OU",
  "- an `os.type` or `container.runtime` resource attribute, on metrics, logs or traces":
    "- um atributo de recurso `os.type` ou `container.runtime`, em métricas, logs ou traces",
  "…and starts populating the Overview, Metrics, Processes, and Logs tabs. `host.id` or `host.arch` alone do not register a host, and telemetry that carries a Kubernetes identity (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) is filed under its Kubernetes cluster instead.":
    "…e começa a preencher as abas Visão geral, Métricas, Processos e Registros. `host.id` ou `host.arch` sozinhos não registram um host, e a telemetria que traz uma identidade do Kubernetes (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) é arquivada no seu cluster do Kubernetes.",
  "**Running on OpenStack?** Use `detectors: [nova, system, env]`, so `host.id` is the instance's UUID and OneUptime links this host to its instance, and set `host.name` to `enabled: false` under `nova: resource_attributes:` so its name stays the one `system` reports.":
    "**Roda no OpenStack?** Use `detectors: [nova, system, env]`, para que `host.id` seja o UUID da instância e o OneUptime vincule este host à instância, e defina `host.name` como `enabled: false` em `nova: resource_attributes:` para que o nome continue sendo o que `system` informa.",
  "The same resource attributes become the machine's **Inventory** item, which is what a CMDB export reads. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` and `os.version` all come from the `resourcedetection` processor; serial number, make, model and firmware version have no detector and are stamped on separately (see **Record the serial number, make, model and firmware version**).":
    "Os mesmos atributos de recurso formam o item da máquina em **Inventário**, que é o que uma exportação de CMDB lê. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` e `os.version` vêm todos do processador `resourcedetection`; número de série, fabricante, modelo e versão do firmware não têm detector e são gravados à parte (veja **Registrar o número de série, o fabricante, o modelo e a versão do firmware**).",
  "Once the host is reporting:": "Quando o host começa a reportar:",
  "- The **Metrics** tab visualizes `system.*` time-series.":
    "- A aba **Métricas** exibe as séries temporais `system.*`.",
  "- The **Processes** tab lists processes ordered by CPU once the `process` scraper is enabled.":
    "- A aba **Processos** lista os processos ordenados por CPU assim que o scraper `process` é ativado.",
  "- The **Logs** tab streams any logs whose resource attributes include `host.name`.":
    "- A aba **Registros** transmite os logs cujos atributos de recurso incluem `host.name`.",
  "The config reports the collector release it is for (`oneuptime.agent.version`) as the host's **Agent Version**. When this OneUptime pins a newer release, a warning sign beside it opens these steps.":
    "A configuração informa a versão do coletor para a qual foi escrita (`oneuptime.agent.version`) como a **Versão do agente** do host. Quando este OneUptime fixa uma versão mais nova, um sinal de aviso ao lado dela abre estas etapas.",
  "1. Save the config from step 2 again, with the same ingestion key: it reports the new version. Copy across any change you made to yours.":
    "1. Salve de novo a configuração da etapa 2, com a mesma chave de ingestão: ela informa a nova versão. Leve junto qualquer alteração que você tenha feito na sua.",
  "2. In the folder that holds it, install the new release and restart the collector:":
    "2. Na pasta que a contém, instale a nova versão e reinicie o coletor:",
  "1. Read the collector's logs for export errors: `docker logs -f otel-collector`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in the `config.yaml` you mounted into the container.":
    "1. Leia os logs do coletor em busca de erros de exportação: `docker logs -f otel-collector`. Um HTTP `401` significa que a chave está ausente, errada ou expirada; `422`, que ela foi desativada (ou é uma chave de navegador, que não pode enviar telemetria de host). Escolha uma chave que funcione na etapa 1 e atualize `x-oneuptime-token` em o `config.yaml` que você montou no contêiner.",
  "2. Check the host can reach OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` from the same machine.":
    "2. Verifique se o host alcança o OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` a partir da mesma máquina.",
  "3. Keep `resourcedetection` in the metrics pipeline — it sets `host.name`, which is how OneUptime recognises the host.":
    "3. Mantenha `resourcedetection` no pipeline de métricas: ele define `host.name`, que é como o OneUptime reconhece o host.",
  "The collector is reading its own container's kernel view. Run it with `--network host`, `--pid host`, the `/:/hostfs` bind mount and the `HOST_*` variables exactly as step 3 shows — without them the `hostmetrics` and `process` scrapers only see the collector container itself.":
    "O coletor está lendo a visão do kernel do próprio contêiner. Execute-o com `--network host`, `--pid host`, o bind mount `/:/hostfs` e as variáveis `HOST_*` exatamente como a etapa 3 mostra: sem eles, os scrapers `hostmetrics` e `process` só enxergam o próprio contêiner do coletor.",
  "A Debian or Ubuntu host (amd64 or arm64) with `sudo`":
    "Um host Debian ou Ubuntu (amd64 ou arm64) com `sudo`",
  "Save this as `config.yaml` in your current directory — step 3 installs it.":
    "Salve isto como `config.yaml` no diretório atual: a etapa 3 o instala.",
  "> **Note for native installs:** Unlike Docker, the package install reads `/proc` and `/sys` directly — no `HOST_PROC` env vars or `/hostfs` mount required. The systemd unit shipped with the package runs as the unprivileged `otelcol-contrib` user; if you want the `process` scraper to see processes owned by other users, grant it `CAP_SYS_PTRACE` or run it as root.":
    "> **Nota para instalações nativas:** ao contrário do Docker, a instalação por pacote lê `/proc` e `/sys` diretamente, sem variáveis de ambiente `HOST_PROC` nem bind mount `/hostfs`. A unidade systemd que vem com o pacote roda como o usuário sem privilégios `otelcol-contrib`; se você quer que o scraper `process` veja processos de outros usuários, conceda a ele `CAP_SYS_PTRACE` ou execute-o como root.",
  "`otelcol-contrib` has bundled the `systemd` receiver since **v0.142.0**; run **v0.143.0 or newer**, which is where its CPU metric settled on its current name and stopped probing non-service units. Turn it on by adding it to `/etc/otelcol-contrib/config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "O `otelcol-contrib` inclui o receiver `systemd` desde a **v0.142.0**; use a **v0.143.0 ou mais recente**, em que sua métrica de CPU ganhou o nome atual e ele parou de consultar unidades que não são serviços. Ative-o adicionando-o a `/etc/otelcol-contrib/config.yaml` e ao pipeline de métricas. Mescle-o nas seções que sua configuração já tem: não adicione uma segunda chave `processors:` ou `service:`.",
  "Then restart the service:": "Depois reinicie o serviço:",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so the packaged service — which runs as the `otelcol-contrib` user — needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "O receiver é **somente para Linux** e está em **alfa**. Ele lê o estado das unidades pelo D-Bus do sistema com as mesmas chamadas somente leitura de `systemctl list-units`, que o systemd permite sem privilégios, então o serviço do pacote, que roda como o usuário `otelcol-contrib`, não precisa de permissões extras. Um coletor em contêiner não alcança o barramento do host, então use uma instalação nativa. Assim que as métricas chegam, a aba **Unidades systemd** do host é preenchida com cada unidade coletada e seu estado atual (`active`, `failed`, `inactive`, ...).",
  "Each unit costs eight datapoints per scrape for the state set, plus two more if you leave the CPU metric on, so on a host with hundreds of units narrow `units:` or raise `collection_interval` rather than scraping everything.":
    "Cada unidade custa oito pontos de dados por coleta para o conjunto de estados, mais dois se você deixar a métrica de CPU ligada; então, em um host com centenas de unidades, restrinja `units:` ou aumente `collection_interval` em vez de coletar tudo.",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**As investigações de IA ficam ativadas por padrão** em todo host: assim que o agente de IA do host roda nele, o OneUptime AI investiga ali incidentes e alertas com comandos somente leitura como `systemctl status`, `df -h`, `free -m` e `ps aux`, e não altera nada a menos que você permita correções. É um contêiner Linux com instalador próprio; ele precisa do Docker (o mecanismo do sistema, não o Docker rootless) com o plugin Compose:",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI, and the packaged collector runs unprivileged, so it cannot read them itself. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "A configuração já preenche os endereços IP, os endereços MAC, a arquitetura, o ID da máquina, a descrição e a versão do sistema operacional no item da máquina em **Inventário**, que é o que uma exportação de CMDB lê. Número de série, fabricante, modelo e versão do firmware (BIOS / UEFI) são diferentes: **nenhum detector de recursos consegue produzi-los.** Eles vêm do firmware da máquina, via DMI, e o coletor do pacote roda sem privilégios, então não consegue lê-los sozinho. Leia-os uma vez no provisionamento e grave-os no recurso: adicione este processador a `/etc/otelcol-contrib/config.yaml` e cite-o no pipeline de métricas. Mescle-o nas seções que sua configuração já tem: não adicione uma segunda chave `processors:` ou `service:`.",
  "Add a `resource` processor to `/etc/otelcol-contrib/config.yaml` and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "Adicione um processador `resource` a `/etc/otelcol-contrib/config.yaml` e faça referência a ele no pipeline de métricas. Mescle-o nas seções que sua configuração já tem: não adicione uma segunda chave `processors:` ou `service:`.",
  "- The **Systemd Units** tab lists unit state once the `systemd` receiver is enabled (see **Enable the Systemd Units tab**).":
    "- A aba **Unidades systemd** lista o estado das unidades assim que o receiver `systemd` é ativado (veja **Ativar a aba Unidades systemd**).",
  "1. Read the collector's logs for export errors: `sudo journalctl -u otelcol-contrib -f`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `/etc/otelcol-contrib/config.yaml`.":
    "1. Leia os logs do coletor em busca de erros de exportação: `sudo journalctl -u otelcol-contrib -f`. Um HTTP `401` significa que a chave está ausente, errada ou expirada; `422`, que ela foi desativada (ou é uma chave de navegador, que não pode enviar telemetria de host). Escolha uma chave que funcione na etapa 1 e atualize `x-oneuptime-token` em `/etc/otelcol-contrib/config.yaml`.",
  "1. Keep `resourcedetection` in the same metrics pipeline as the `systemd` receiver — the receiver attaches only `systemd.unit.name` to each unit, so without `host.name` the samples never attach to the host.":
    "1. Mantenha `resourcedetection` no mesmo pipeline de métricas do receiver `systemd`: o receiver anexa apenas `systemd.unit.name` a cada unidade, então sem `host.name` as amostras nunca se ligam ao host.",
  "2. Run `otelcol-contrib` v0.143.0 or newer: older builds stop at startup with `'receivers' unknown type: \"systemd\"`, or name the CPU metric differently (see **Enable the Systemd Units tab**).":
    "2. Use o `otelcol-contrib` v0.143.0 ou mais recente: builds mais antigos param na inicialização com `'receivers' unknown type: \"systemd\"` ou dão outro nome à métrica de CPU (veja **Ativar a aba Unidades systemd**).",
  "3. Check the collector can reach the system D-Bus: `/run/dbus/system_bus_socket` must exist, and `systemctl list-units` run as the collector's user is the quickest test. Root is not required.":
    "3. Verifique se o coletor alcança o D-Bus do sistema: `/run/dbus/system_bus_socket` deve existir, e `systemctl list-units` executado como o usuário do coletor é o teste mais rápido. Root não é necessário.",
  "A RHEL, CentOS, Fedora or Amazon Linux host (x86_64 or aarch64) with `sudo`":
    "Um host RHEL, CentOS, Fedora ou Amazon Linux (x86_64 ou aarch64) com `sudo`",
  "A Linux host (x86_64 or aarch64) that runs systemd, with `sudo`":
    "Um host Linux (x86_64 ou aarch64) que use systemd, com `sudo`",
  "Drop a systemd unit at `/etc/systemd/system/otelcol-contrib.service`:":
    "Crie uma unidade systemd em `/etc/systemd/system/otelcol-contrib.service`:",
  "Then enable and start it:": "Depois ative-a e inicie-a:",
  "Use this when packages aren't available — locked-down servers, or container base images you want to instrument from outside. No `HOST_PROC` env vars or `/hostfs` mount are needed: the collector reads kernel state directly, and `User=root` lets the `process` scraper see processes owned by other users (granting `CAP_SYS_PTRACE` instead works too).":
    "Use isto quando não houver pacotes disponíveis: servidores restritos ou imagens base de contêiner que você quer instrumentar de fora. Não são necessárias variáveis de ambiente `HOST_PROC` nem o bind mount `/hostfs`: o coletor lê o estado do kernel diretamente, e `User=root` permite que o scraper `process` veja processos de outros usuários (conceder `CAP_SYS_PTRACE` também funciona).",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so it needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "O receiver é **somente para Linux** e está em **alfa**. Ele lê o estado das unidades pelo D-Bus do sistema com as mesmas chamadas somente leitura de `systemctl list-units`, que o systemd permite sem privilégios, então ele não precisa de permissões extras. Um coletor em contêiner não alcança o barramento do host, então use uma instalação nativa. Assim que as métricas chegam, a aba **Unidades systemd** do host é preenchida com cada unidade coletada e seu estado atual (`active`, `failed`, `inactive`, ...).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to `/opt/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "A configuração já preenche os endereços IP, os endereços MAC, a arquitetura, o ID da máquina, a descrição e a versão do sistema operacional no item da máquina em **Inventário**, que é o que uma exportação de CMDB lê. Número de série, fabricante, modelo e versão do firmware (BIOS / UEFI) são diferentes: **nenhum detector de recursos consegue produzi-los.** Eles vêm do firmware da máquina, via DMI. Leia-os uma vez no provisionamento e grave-os no recurso: adicione este processador a `/opt/otelcol-contrib/config.yaml` e cite-o no pipeline de métricas. Mescle-o nas seções que sua configuração já tem: não adicione uma segunda chave `processors:` ou `service:`.",
  "A Mac (Apple silicon or Intel) and an administrator account for `sudo`":
    "Um Mac (Apple silicon ou Intel) e uma conta de administrador para `sudo`",
  "Create `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:":
    "Crie `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:",
  "Load it:": "Carregue-o:",
  "> **Install the contrib build, as above.** The core `otelcol` build has no `resourcedetection` processor, so it refuses to start with this config.":
    "> **Instale o build contrib, como acima.** O build core `otelcol` não tem o processador `resourcedetection`, então se recusa a iniciar com esta configuração.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "A configuração já preenche os endereços IP, os endereços MAC, a arquitetura, o ID da máquina, a descrição e a versão do sistema operacional no item da máquina em **Inventário**, que é o que uma exportação de CMDB lê. Número de série, fabricante, modelo e versão do firmware (BIOS / UEFI) são diferentes: **nenhum detector de recursos consegue produzi-los.** Eles vêm do firmware da máquina. Leia-os uma vez no provisionamento e grave-os no recurso: adicione este processador a `/etc/otelcol-contrib/config.yaml` e cite-o no pipeline de métricas. Mescle-o nas seções que sua configuração já tem: não adicione uma segunda chave `processors:` ou `service:`.",
  "Then restart the collector:": "Depois reinicie o coletor:",
  "The values are the machine's own, so they are written once by whatever provisions it. On a Mac, read them like this — the manufacturer is `Apple Inc.`:":
    "Os valores são da própria máquina, então são gravados uma vez por quem a provisiona. Em um Mac, leia-os assim (o fabricante é `Apple Inc.`):",
  "`hw.model` is the model *identifier* (`MacBookPro18,3`), not the marketing name. Put it in `device.model.name` anyway — `device.model.identifier` marks a batch as a mobile app.":
    "`hw.model` é o *identificador* do modelo (`MacBookPro18,3`), não o nome comercial. Coloque-o mesmo assim em `device.model.name`: `device.model.identifier` marca um lote como app móvel.",
  "Windows 10 1803+ or Windows Server 2019+ (for the built-in `tar.exe`)":
    "Windows 10 1803+ ou Windows Server 2019+ (pelo `tar.exe` integrado)",
  "An elevated PowerShell prompt (Run as administrator)":
    "Um prompt do PowerShell com privilégios elevados (Executar como administrador)",
  "Save this as `config.yaml` in the folder you will run the PowerShell commands from — step 3 copies it into place.":
    "Salve isto como `config.yaml` na pasta de onde você vai executar os comandos do PowerShell: a etapa 3 o copia para o lugar.",
  "On Windows, install the upstream **`otelcol-contrib`** collector — from **v0.155.0** it bundles the `windows_service` receiver that powers the host **Services** tab. Run from an elevated PowerShell prompt:":
    "No Windows, instale o coletor upstream **`otelcol-contrib`**: a partir da **v0.155.0** ele inclui o receiver `windows_service`, que alimenta a aba **Serviços** do host. Execute em um prompt do PowerShell com privilégios elevados:",
  "> **Note:** The service runs as `LocalSystem` so it can read every Windows service. On Windows the `load` scraper only emulates a load average from the *Processor Queue Length* counter (it starts at 0); if it can't read the counter it is logged and skipped, so the rest of the `hostmetrics` config runs unchanged. The [Host OpenTelemetry Collector docs](/docs/telemetry/host-otel-collector) also cover the signed `.msi` installer.":
    "> **Nota:** o serviço roda como `LocalSystem` para poder ler todos os serviços do Windows. No Windows, o scraper `load` apenas emula uma média de carga a partir do contador *Processor Queue Length* (começa em 0); se não consegue ler o contador, isso é registrado no log e ignorado, e o resto da configuração `hostmetrics` roda sem mudanças. A [documentação do OpenTelemetry Collector para hosts](/docs/telemetry/host-otel-collector) também cobre o instalador `.msi` assinado.",
  "Logs are written to the Windows Application event log; view them in **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`).":
    "Os logs são gravados no log de eventos Aplicativo do Windows; veja-os em **Event Viewer → Windows Logs → Application** (origem `otelcol-contrib`).",
  "From **v0.155.0** `otelcol-contrib` includes the `windows_service` receiver — turn it on by adding it to `C:\\Program Files\\otelcol-contrib\\config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "A partir da **v0.155.0**, o `otelcol-contrib` inclui o receiver `windows_service`: ative-o adicionando-o a `C:\\Program Files\\otelcol-contrib\\config.yaml` e ao pipeline de métricas. Mescle-o nas seções que sua configuração já tem: não adicione uma segunda chave `processors:` ou `service:`.",
  "The receiver is **Windows-only** and **alpha**. Once metrics arrive, the host **Services** tab populates automatically with each service's running state and startup type.":
    "O receiver é **somente para Windows** e está em **alfa**. Assim que as métricas chegam, a aba **Serviços** do host é preenchida automaticamente com o estado de execução e o tipo de inicialização de cada serviço.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through WMI.":
    "A configuração já preenche os endereços IP, os endereços MAC, a arquitetura, o ID da máquina, a descrição e a versão do sistema operacional no item da máquina em **Inventário**, que é o que uma exportação de CMDB lê. Número de série, fabricante, modelo e versão do firmware (BIOS / UEFI) são diferentes: **nenhum detector de recursos consegue produzi-los.** Eles vêm do firmware da máquina, via WMI.",
  "Run this from an elevated PowerShell prompt on the machine — it queries WMI and prints the exact YAML for *this* machine:":
    "Execute isto em um prompt do PowerShell com privilégios elevados na máquina: ele consulta o WMI e imprime o YAML exato *desta* máquina:",
  "It prints one processor entry, already indented. Add it inside the `processors:` block your `config.yaml` already has — alongside `resourcedetection:`, `resource:` and `batch:`, not as a second `processors:` key — then name it in the metrics pipeline:":
    "Ele imprime uma entrada de processador, já indentada. Adicione-a dentro do bloco `processors:` que o seu `config.yaml` já tem, ao lado de `resourcedetection:`, `resource:` e `batch:`, e não como uma segunda chave `processors:`; depois cite-a no pipeline de métricas:",
  "Use `Get-CimInstance`, not the deprecated `Get-WmiObject` — it is absent from PowerShell 7 and later. Values are emitted in single quotes with any embedded quote doubled, so a serial or model containing punctuation stays valid YAML. A field the firmware leaves empty prints as `''`; drop that attribute rather than shipping a blank one.":
    "Use `Get-CimInstance`, não o obsoleto `Get-WmiObject`, que não existe no PowerShell 7 e posteriores. Os valores saem entre aspas simples, com cada aspa interna duplicada, para que um número de série ou modelo com pontuação continue sendo YAML válido. Um campo que o firmware deixa vazio sai como `''`; remova esse atributo em vez de enviar um em branco.",
  "Within a few minutes the machine's **Inventory** item shows `host.serial_number`, `device.manufacturer`, `device.model.name` and `device.firmware.version` under **Details**, alongside the IP and MAC addresses and machine id the detector already supplies. Run this again after a motherboard swap or a BIOS update — the values are stamped, not detected, so they do not update themselves.":
    "Em poucos minutos, o item da máquina em **Inventário** mostra em **Detalhes** `host.serial_number`, `device.manufacturer`, `device.model.name` e `device.firmware.version`, ao lado dos endereços IP e MAC e do ID da máquina que o detector já fornece. Execute isto de novo após uma troca de placa-mãe ou uma atualização de BIOS: os valores são gravados, não detectados, então não se atualizam sozinhos.",
  "- The **Services** tab lists each service's state once the `windows_service` receiver is enabled (see **Enable the Windows Services tab**).":
    "- A aba **Serviços** lista o estado de cada serviço assim que o receiver `windows_service` é ativado (veja **Ativar a aba Serviços do Windows**).",
  "1. Read the collector's logs for export errors: **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`). An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `C:\\Program Files\\otelcol-contrib\\config.yaml`.":
    "1. Leia os logs do coletor em busca de erros de exportação: **Event Viewer → Windows Logs → Application** (origem `otelcol-contrib`). Um HTTP `401` significa que a chave está ausente, errada ou expirada; `422`, que ela foi desativada (ou é uma chave de navegador, que não pode enviar telemetria de host). Escolha uma chave que funcione na etapa 1 e atualize `x-oneuptime-token` em `C:\\Program Files\\otelcol-contrib\\config.yaml`.",
  "1. Run the collector in the foreground to see the real error instead of the generic `Error 1064`:":
    "1. Execute o coletor em primeiro plano para ver o erro real em vez do genérico `Error 1064`:",
  '2. `Error 2: The system cannot find the file specified` means the service points at a file that is not there — compare `BINARY_PATH_NAME` from `sc.exe qc "otelcol-contrib"` with the contents of `C:\\Program Files\\otelcol-contrib`. The archive must be the `otelcol-contrib_` one, which unpacks `otelcol-contrib.exe`.':
    '2. `Error 2: The system cannot find the file specified` significa que o serviço aponta para um arquivo que não existe: compare `BINARY_PATH_NAME` de `sc.exe qc "otelcol-contrib"` com o conteúdo de `C:\\Program Files\\otelcol-contrib`. O arquivo compactado precisa ser o `otelcol-contrib_`, que extrai `otelcol-contrib.exe`.',
  "3. **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`) records the startup error the service manager swallowed.":
    "3. **Event Viewer → Windows Logs → Application** (origem `otelcol-contrib`) registra o erro de inicialização que o gerenciador de serviços engoliu.",
  "If you set `include_services` but still see every service, the collector hasn't picked up the edit — restart the service (`Restart-Service otelcol-contrib`) and give the Services tab a few minutes to refresh its rolling window.":
    "Se você define `include_services` mas continua vendo todos os serviços, o coletor não aplicou a edição: reinicie o serviço (`Restart-Service otelcol-contrib`) e dê à aba Serviços alguns minutos para atualizar sua janela móvel.",
  "Kubernetes nodes are monitored by the **OneUptime Kubernetes agent** rather than a host collector: each node appears under **Kubernetes** → your cluster → **Nodes**, next to its pods and workloads, not in the **Hosts** list. The steps below install the agent on a standard cluster; the install guide in the **Kubernetes** section has the steps for Amazon EKS, Google GKE, Azure AKS, GKE Autopilot and EKS Fargate.":
    "Os nós do Kubernetes são monitorados pelo **agente do Kubernetes do OneUptime**, e não por um coletor de host: cada nó aparece em **Kubernetes** → seu cluster → **Nós**, ao lado dos seus pods e workloads, não na lista **Hosts**. As etapas abaixo instalam o agente em um cluster padrão; o guia de instalação da seção **Kubernetes** tem as etapas para Amazon EKS, Google GKE, Azure AKS, GKE Autopilot e EKS Fargate.",
  "A Kubernetes cluster running v1.23 or later":
    "Um cluster Kubernetes com v1.23 ou posterior",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` e `helm` (v3) instalados na sua máquina",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "Cluster errado? Troque com `kubectl config use-context <context-name>`.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "Substitua `my-cluster` por um nome para este cluster, como `prod-us-east-1`. É assim que o cluster aparece no OneUptime, então mantenha-o estável: um nome novo registra um cluster novo.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` ativa as **investigações de IA**, como o chart faz por padrão: o OneUptime AI investiga incidentes e alertas deste cluster com kubectl somente leitura, por meio do agente de IA do Kubernetes.",
  "You should see:": "Você deve ver:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "O coletor e o agente de IA do Kubernetes, mais um pod `-logs` e um pod `-ebpf` em cada nó. Quando estiverem `Running`, o cluster aparece automaticamente na seção **Kubernetes**, normalmente em um ou dois minutos.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Agente de IA do Kubernetes (ativado por padrão, somente leitura).** O pod `kubernetes-agent-ai-agent` permite que o OneUptime AI investigue incidentes e alertas deste cluster com kubectl somente leitura (`get`, `describe`, `logs`, `events`, `top`), usando a mesma chave de API, e não pode alterar nada a menos que você lhe dê acesso de escrita depois. Abra o cluster e vá em **IA → Agente** para vê-lo. Não quer? Instale com `--set aiAgent.enabled=false` em vez de `--set aiAgent.enabled=true`.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "Regras de namespace decidem o que o agente coleta de cada namespace. Para coletar logs de pods e dados de eBPF apenas de `default`, `production` e `staging`:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "Para manter tudo, mas parar os logs de namespaces barulhentos, exclua-os apenas de `podLogs`:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **Escopos:** `podLogs` (stdout/stderr dos contêineres), `ebpfDiscovery` (traces e métricas de eBPF), `metrics` (métricas com namespace) e `traces` (todos os spans).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- Os **padrões** correspondem ao nome inteiro do namespace e aceitam `*`, como em `team-*`. Uma regra `exclude` sempre vence uma regra `include`.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **Definir as regras substitui a regra padrão**, que exclui `kube-system` de `podLogs` e `ebpfDiscovery`. Mantenha-a na sua lista, como no segundo exemplo, se ainda quiser isso.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- Métricas de nó e de cluster não têm namespace, então são sempre mantidas.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` requer Helm 3.10 ou posterior.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**Envie só as linhas importantes.** Descarte linhas de log de pods abaixo de uma severidade antes que saiam do cluster:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    'Aceita `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` e `FATAL`: `WARN` mantém avisos, erros e linhas fatais. A severidade é lida da própria linha de log (`[ERROR]`, `level=warn`, `"level":"info"`). Eventos do Kubernetes nunca são descartados por isso.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Desative os logs de pods.** As métricas não são afetadas: o coletor de nós continua rodando para as métricas de kubelet e cAdvisor, só deixa de ler os logs de pods:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**Mude como os logs são lidos.** O preset escolhe isso por você; um `logs.mode` explícito sempre tem prioridade:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: lê `/var/log/pods` em cada nó via hostPath (menor sobrecarga; requer hostPath).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: um Deployment acompanha os logs de pods pela API do Kubernetes (funciona em qualquer cluster).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: sem logs de pods.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "Isso lê o servidor de API, onde ele responde dentro do cluster. O etcd, o scheduler e o controller manager respondem nos nós do plano de controle, que o pod do agente não consegue adivinhar, então ele os lê assim que você informa o endereço de cada nó:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **O scheduler e o controller manager** servem HTTPS e aceitam o token do agente, mas o kubeadm os vincula a `127.0.0.1`: dê a eles um `--bind-address` que o pod do agente consiga alcançar.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** serve suas métricas em HTTP simples nas `--listen-metrics-urls` do kubeadm (porta 2381, vinculada a `127.0.0.1` até você adicionar o endereço do nó), como acima. Ou consulte a porta de cliente HTTPS dele, 2379, com o certificado de cliente que ele pede: coloque `ca.crt`, `tls.crt` e `tls.key` em um Secret em `oneuptime-agent` e informe-o em `controlPlane.etcd.clientCertSecret`.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "Apenas para clusters autogerenciados: serviços gerenciados (EKS, GKE, AKS) não expõem as métricas do plano de controle.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "O monitoramento de custos vem ativado por padrão: o agente inclui o mecanismo de código aberto OpenCost (mais o pequeno Prometheus de que ele precisa), precifica seus nós e volumes pelos preços públicos de tabela do seu provedor de nuvem, sem credenciais, e envia quanto custa cada namespace e workload. Os primeiros dados aparecem na visão geral do cluster e na página Custos depois da primeira hora completa.",
  "On an agent installed before it was on by default, upgrade it:":
    "Se o agente foi instalado antes de isso ser o padrão, atualize-o:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **Para desativá-lo:** adicione `--set cost.enabled=false` à mesma atualização.",
  "- **Already running Kubecost or OpenCost?** Point the agent at it instead, and nothing is bundled: add `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` (or your Kubecost service).":
    "- **Já usa Kubecost ou OpenCost?** Aponte o agente para ele, e nada é incluído: adicione `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` (ou o seu serviço Kubecost).",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **On-premises ou bare metal?** Defina uma tabela de preços com `--set cost.opencost.customPricing.enabled=true` (USD por hora de recurso; veja o `values.yaml` do chart).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "Guia completo: [Observabilidade de custos do Kubernetes](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "O agente executa o [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) em cada nó. Ele captura tráfego HTTP/HTTPS, gRPC e SQL/Redis de serviços em Go, .NET, Java, Node.js, Python, Ruby e Rust, sem SDK nem sidecar, e envia traces, métricas de requisições (RED) e dados do grafo de serviços pelo coletor.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**Requisitos:** kernel Linux **5.8+** com BTF (o padrão no Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). Os pods de eBPF rodam como **privilegiados**, o que precisam para carregar programas eBPF.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "**Desative-o** se seus nós usam um kernel mais antigo, se pods privilegiados não são permitidos ou se seus serviços já enviam traces com SDKs do OpenTelemetry e você não quer duplicatas:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**Escolha os sinais.** Cada família é ligada ou desligada com `--set ebpf.features.<name>=false` (ou `=true`):",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | Padrão | O que adiciona |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | ligado | Taxa de requisições HTTP/gRPC, erros e latência por serviço |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | ligado | Contagem de chamadas e duração dos spans (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | ligado | Arestas chamador → chamado; alimenta o mapa de serviços |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | ligado | Contadores de fluxos TCP/UDP de pod para pod |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | desligado | Métricas de rede entre zonas (dobra a cardinalidade delas) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | ligado | RTT de TCP e contadores de conexões com falha e retransmissões por nó |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "A **propagação de traces entre serviços** (ligar em um único trace uma requisição que vai do pod A → pod B, também em outro nó) fica **ligada por padrão**. Ela funciona reescrevendo o tráfego que já está em andamento (ampliando requisições HTTP em texto puro no kernel e acrescentando uma opção TCP ao TLS e ao TCP bruto), e um erro nessa contagem de bytes dessincroniza o fluxo: o sintoma relatado são transferências por um proxy L7 como o nginx que travam quando uma resposta passa de ~64KB. Se você vir isso, ou se uma service mesh começar a derrubar pods, desligue-a com `--set ebpf.contextPropagation=false`; um SDK do OpenTelemetry propaga `traceparent` no espaço do usuário sem nada disso.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Cada `oneuptime.labels.<key>=<value>` vira o rótulo `<key>:<value>` no cluster e nos serviços e hosts que ele informa. Os rótulos são comparados sem diferenciar maiúsculas de minúsculas, então um rótulo `Production` existente é reutilizado; rótulos adicionados na interface do OneUptime nunca são removidos pelo agente.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**Atualize** para o chart mais recente. `--reset-then-reuse-values` (Helm 3.14+) mantém os valores que você definiu (preset, nome do cluster, filtros) e pega todo o resto do chart novo; adicione por cima quaisquer novos flags `--set`:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "No Helm 3.13 e anteriores, atualize com os valores que você definiu:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "Não use `--reuse-values`: ele também mantém os padrões do chart de onde você atualiza, então os padrões de um chart mais novo (entre eles a imagem de eBPF) nunca se aplicam.",
  "**Uninstall** the agent and its namespace:":
    "**Desinstale** o agente e o namespace dele:",
  "| Category | Data |": "| Categoria | Dados |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **Métricas de nós** | Uso de CPU, memória, sistema de arquivos e rede |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Métricas de pods e contêineres** | CPU, memória, E/S de rede e reinícios |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **Métricas do cluster** | Condições dos nós, recursos alocáveis, contagem de pods e workloads |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Eventos do Kubernetes** | Avisos, erros e eventos de agendamento |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Logs de pods** | stdout/stderr de cada contêiner, lidos em cada nó |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **Traços de aplicações** *(eBPF)* | Spans HTTP, gRPC e SQL/Redis de cada pod, sem SDK nem mudanças no código |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **Métricas de requisições e grafo de serviços** *(eBPF)* | Taxa de requisições, erros e latência por serviço, e arestas chamador → chamado para o mapa de serviços |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **Fluxos de rede** *(eBPF)* | Contadores de bytes e pacotes TCP/UDP de pod para pod |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **Custos dos workloads** *(ativados por padrão)* | Gasto por namespace, workload e pod, com capacidade ociosa e eficiência, também como métricas para alertas |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "Seu cluster bloqueia volumes `hostPath` ou pods privilegiados. Isso é normal no **GKE Autopilot** e no **EKS Fargate**: escolha essa plataforma no topo deste guia e siga as etapas dela. No **OpenShift**, ao contrário, a instalação funciona, mas os pods de nó do agente nunca iniciam: escolha **Red Hat OpenShift**.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "Em qualquer outro cluster com uma política de Pod Security restritiva, remova a release que falhou:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "Depois execute o comando de instalação de novo, acrescentando `--set preset=gke-autopilot`. Esse preset lê os logs de pods pela API do Kubernetes em vez de hostPath, aplica um contexto de segurança reforçado e deixa de fora os pods privilegiados de eBPF e de profiling.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. Verifique se os pods do agente estão rodando: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. Verifique os logs do coletor: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. Confirme que a URL do OneUptime e a chave de ingestão no comando de instalação estão corretas.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. Garanta que o cluster consegue alcançar sua instância do OneUptime pela rede.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. Verifique o pod do agente de IA: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. Verifique os logs dele: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. Nenhum pod? Atualize o chart (veja **Atualize ou desinstale o agente** em Avançado) e adicione `--set aiAgent.enabled=true`.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. Verifique se o nome do cluster confere: este guia instala **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. Confirme as permissões RBAC do agente: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Procure erros de exportação nos logs do coletor: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **Kernel antigo demais ou sem BTF.** O eBPF precisa do Linux 5.8+ com BTF; confira com `uname -r` em um nó. Se não puder atualizar, desligue o eBPF com `--set ebpf.enabled=false`.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **Pods privilegiados bloqueados.** Alguns clusters restritos os rejeitam. Desligue o eBPF.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` indisponíveis no host.** Desligue só a família de estatísticas TCP: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. Verifique se os pods de eBPF estão saudáveis: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. Ative a saída de depuração do OBI para confirmar que ele vê tráfego: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, e depois leia `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Se os spans aparecem ali, mas não no OneUptime, procure erros de exportação nos logs do coletor: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
};

export default TRANSLATION;
