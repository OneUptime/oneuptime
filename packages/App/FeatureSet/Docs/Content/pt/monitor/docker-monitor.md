# Monitor de Docker

Um monitor de Docker acompanha os contêineres de um host Docker e avisa você quando um contêiner esquenta demais, fica sem memória ou entra em loop de reinícios. Ele lê as métricas que o agente Docker do OneUptime envia do host, então nada é sondado de fora: instale o agente e depois crie o monitor a partir de um modelo ou da sua própria consulta.

:::cards
- [Criar o monitor](#criar-um-monitor-de-docker): Seis passos no painel.
- [Modelos](#modelos-de-alerta-prontos): Sete alertas prontos, um incidente por contêiner.
- [Métricas](#métricas-coletadas): O que o agente coleta e o que cada métrica significa.
- [Logs](#logs-coletados): Os logs dos contêineres e o driver de log de que eles precisam.
:::

## Como funciona

O agente Docker do OneUptime é executado como contêiner no host. A cada 30 segundos, ele lê as estatísticas dos contêineres pela API do Docker Engine, acompanha os arquivos de log dos contêineres e envia os dois para o OneUptime via OTLP. Os primeiros dados de um host o registram no OneUptime.

Um monitor de Docker está vinculado a um host. A cada minuto, ele executa sua consulta sobre as métricas dos contêineres desse host e compara o resultado com seus critérios.

```mermaid title="De um host Docker ao incidente"
flowchart TB
    subgraph host["Seu host Docker"]
        direction LR
        containers["Contêineres"] --> agent["Agente Docker do OneUptime"]
    end
    agent -->|"métricas e logs via OTLP"| oneuptime["OneUptime"]
    oneuptime -->|"primeiros dados"| registered["Host Docker registrado"]
    oneuptime --> monitor["Monitor de Docker"]
    monitor -->|"a cada minuto"| criteria{"Critérios atendidos?"}
    criteria -->|"sim"| incident["Incidente ou alerta"]
    criteria -->|"não"| online["Monitor online"]
```

## Antes de começar

- **Instale o agente Docker** no host. O [guia do agente Docker](/docs/telemetry/docker-host) cobre a instalação, a atualização e a verificação.
- **Verifique se o host está registrado.** Ele aparece em **Produtos → Infraestrutura → Docker → Todos os hosts**, com o nome do `DOCKER_HOST_NAME` do agente, assim que chegam os primeiros dados.
- **Para os logs dos contêineres**, execute os contêineres com o driver de log `json-file` do Docker. Consulte [Requisito do driver de log](#requisito-do-driver-de-log).

## Criar um monitor de Docker

:::steps
### Começar um monitor novo

Acesse **Monitores** e clique em **Criar monitor**.

### Escolher Docker Container

Em **Tipo de monitor**, clique em **Mais tipos de monitor** e escolha **Docker Container** em **Infraestrutura**, ou digite `docker` na caixa de busca. Informe um **Nome** – ele é usado nos títulos de incidentes e alertas – e clique em **Próximo**.

### Escolher o host

Em **Configuração do monitor Docker**, escolha o host em **Host Docker**. Todo host que enviou dados está na lista. Depois da escolha, uma linha abaixo do campo diz se estão chegando dados. **Adicionar host Docker** abre passos de configuração com as suas chaves já preenchidas, que esperam os primeiros dados.

### Escolher o que monitorar

Um monitor novo começa com **Host Stopped Reporting**, em **Sobre o que alertar**. Para vigiar outra coisa:

- **Alterar** – escolha outro [modelo](#modelos-de-alerta-prontos). Ele define a métrica, a agregação, o intervalo de tempo e os limites, e substitui os critérios abaixo pelos dele. Você ainda pode mudar o **Intervalo de tempo**.
- **Custom Metric** (em **Mais campos**) – escolha uma métrica em **Métrica do Docker** e depois defina **Agregação** e **Intervalo de tempo**. **Nome do contêiner** e **Imagem do contêiner** a restringem a alguns contêineres.
- **Avançado** (em **Mais campos**) – monte você mesmo consultas e fórmulas em **Selecionar Métricas**. Use **Agrupar por** `resource.container.name` para avaliar cada contêiner separadamente.

### Revisar os critérios

Abra cada critério em **Critérios do monitor** e confira sua **Métrica**, **Agregação**, **Condição** e **Limite**. Um modelo os preenche. Com **Custom Metric** ou **Avançado**, o monitor começa com os [critérios padrão](#critérios-padrão), que só percebem uma métrica que não envia dados, então defina o seu próprio limite.

### Criar o monitor

Clique em **Criar monitor**. O OneUptime abre a página do monitor e o avalia a cada minuto. Os incidentes e alertas que ele gera também aparecem nas páginas **Incidentes** e **Alertas** do host.
:::

> [!TIP]
> Para configurar vários modelos de uma vez, abra o host em **Produtos → Infraestrutura → Docker** e vá para **Recomendações**. Escolha os modelos que quiser, escolha quem é acionado, e o OneUptime cria um monitor por modelo.

## Configurações do monitor

| Campo | Aba | O que faz |
| --- | --- | --- |
| **Host Docker** | Todas | Obrigatório. Restringe cada consulta ao `resource.host.name` do host. O OneUptime também adiciona `resource.container.runtime = docker` a cada consulta. |
| **Métrica do Docker** | Custom Metric | Uma métrica do catálogo do agente, agrupada em CPU, memória, rede, E/S de bloco e contêiner. |
| **Nome do contêiner** | Custom Metric, Avançado | Opcional. Correspondência exata com `resource.container.name`, por exemplo `my-container`. |
| **Imagem do contêiner** | Custom Metric, Avançado | Opcional. Correspondência exata com `resource.container.image.name`, por exemplo `nginx:latest`. |
| **Agregação** | Custom Metric | Como as amostras são combinadas: **Média**, **Máximo**, **Mínimo**, **Soma** ou **Contagem**. Começa na agregação usual da métrica. |
| **Intervalo de tempo** | Todas | A janela móvel que a consulta lê, de **Past 1 Minute** a **Past 365 Days**. Um monitor novo começa em **Past 1 Minute**; os modelos definem a sua. |
| **Selecionar Métricas** | Avançado | O construtor de consultas: **Métrica**, **Aggregate by**, **Filter by attributes**, **Agrupar por**, além de **Adicionar métrica** e **Adicionar fórmula** para combinar consultas. |

## Modelos de alerta prontos

A lista de **Sobre o que alertar** oferece sete modelos. Cada um monta um monitor completo: uma consulta, um critério que dispara e outro que se recupera. Todos os modelos, exceto **Host Stopped Reporting**, agrupam a consulta por `resource.container.name`, então cada contêiner é avaliado separadamente, um contêiner ocupado não esconde outro, e cada contêiner que ultrapassa o limite recebe seu próprio incidente e seu próprio alerta. Os limites são pontos de partida que você pode editar.

Salvo indicação contrária na tabela, um critério só dispara quando a condição vale em todos os minutos da sua janela, e se recupera 10% além do limite para que um valor oscilando na linha não fique mudando de estado.

| Modelo | Gravidade | Monitora | Dispara quando | Recupera quando |
| --- | --- | --- | --- | --- |
| Host Stopped Reporting | Crítico | `container.memory.percent`, Count sobre todos os contêineres do host, últimos 10 minutos | Nenhum dado durante toda a janela | Os dados voltam a chegar |
| High Container CPU Usage | Warning | `container.cpu.utilization`, Max por contêiner, últimos 5 minutos | Acima de 80 (% de um núcleo) | Em 72 ou menos |
| High Container Memory Usage | Warning | `container.memory.percent`, Max por contêiner, últimos 5 minutos | Acima de 85% | Em 76,5% ou menos |
| Container Restart Loop | Crítico | `container.restarts.increase`, Sum por contêiner, últimos 15 minutos | Mais de 3 reinícios na janela (Soma) | 2,7 ou menos |
| Container CPU Throttling | Warning | Crescimento de `container.cpu.throttling_data.throttled_time` em ms por contêiner, últimos 5 minutos | Mais de 1000 ms na janela (Soma) | 900 ms ou menos |
| High Container Process Count | Warning | `container.pids.count`, Max por contêiner, últimos 5 minutos | Acima de 2000 | Em 1800 ou menos |
| Container Restarted (Low Uptime) | Crítico | `container.uptime`, Min por contêiner, último 1 minuto | Menos de 120 segundos | 132 segundos ou mais |

**Gravidade** é o rótulo que o seletor mostra. O incidente e o alerta que um modelo cria começam com a gravidade de incidente e de alerta mais alta do seu projeto; altere-as nos critérios.

> [!NOTE]
> **Host Stopped Reporting** dispara quando nada chega do host por dez minutos: o host está fora do ar, ou o agente parou, perdeu a rota até o OneUptime ou teve o token revogado. Ele se resolve quando os dados voltam. Quando os dados param, os outros modelos não têm nada para comparar e mantêm o último status, então é este que avisa você. Um host sem outros contêineres continua enviando dados, porque o agente roda como um contêiner e envia os do seu próprio contêiner.

> [!NOTE]
> `container.cpu.utilization` é o número que o `docker stats` imprime, em média no intervalo de 30 segundos do agente: 100% é um núcleo de CPU inteiro, não o host inteiro, então um contêiner usando dois núcleos marca 200. Em um host com vários núcleos, o limite de 80 é um orçamento de CPU, não uma fatia da máquina.

> [!NOTE]
> `container.memory.percent` divide pelo limite de memória do contêiner quando há um definido e, caso contrário, pela memória total **do host**. Verifique se o contêiner foi iniciado com `--memory` antes de tratar uma violação como um encerramento iminente por falta de memória.

> [!WARNING]
> `container.cpu.throttling_data.throttled_time` só cresce, então **Container CPU Throttling** alerta com base em quanto ele cresceu na janela: uma consulta de Máximo e uma de Mínimo por minuto, subtraídas por uma fórmula e somadas. Com a coleta do agente a cada 30 segundos, isso enxerga cerca de metade da limitação real, e o limite já leva isso em conta. Se você aumentar o `collection_interval` do agente para 60 segundos ou mais, cada minuto terá uma única amostra e o modelo deixará de alertar.

> [!NOTE]
> `container.restarts` também só cresce, até que um reinício manual ou um contêiner recriado o faça recomeçar do 0, então o agente também envia `container.restarts.increase` a cada amostra: os reinícios desde a amostra anterior dele daquele contêiner. **Container Restart Loop** soma esses valores, então conta cada reinício, por mais distantes que estejam as amostras, e um reinício manual não conta. O Docker informa um contêiner que está reiniciando como em execução, então o agente continua amostrando um contêiner em loop de reinícios entre as execuções. Um agente mais antigo não envia `container.restarts.increase`: [atualize-o](/docs/telemetry/docker-host#atualizando-o-agente) primeiro. Um monitor criado a partir do modelo antes disso lê quanto `container.restarts` cresceu dentro de cada minuto, o que deixa passar cerca de metade dos reinícios de um loop: exclua-o e crie o modelo novamente.

> [!CAUTION]
> `container.uptime` só existe para contêineres em execução. Um contêiner que para e continua parado não envia dados, então **Container Restarted (Low Uptime)** pega reinícios e novas implantações, não um desligamento permanente. Um contêiner feito para rodar menos de dois minutos fica em estado de alerta durante toda a vida. Para um serviço que precisa ficar no ar, monitore também o que ele serve – por exemplo, com um [monitor de API](/docs/monitor/api-monitor).

## Métricas coletadas

O agente usa o receptor `docker_stats` do OpenTelemetry no socket do Docker, a cada 30 segundos. As métricas de cada contêiner trazem sua identidade como atributos de recurso: `resource.container.name`, `resource.container.image.name`, `resource.container.id`, `resource.container.runtime` (`docker`) e `resource.host.name`.

### CPU

| Métrica | Descrição |
| --- | --- |
| `container.cpu.utilization` | CPU usada em cada intervalo de 30 segundos, em que 100% é um núcleo de CPU inteiro (a coluna CPU% do `docker stats`). |
| `container.cpu.usage.total` | Tempo de CPU usado desde que o contêiner iniciou, em nanossegundos. Um contador de toda a vida útil. |
| `container.cpu.throttling_data.throttled_time` | Nanossegundos em que o contêiner foi limitado pelo seu limite de CPU desde que iniciou. Um contador de toda a vida útil. |
| `container.cpu.throttling_data.throttled_periods` | Períodos de limitação desde que o contêiner iniciou. Um contador de toda a vida útil. |

### Memória

| Métrica | Descrição |
| --- | --- |
| `container.memory.usage.total` | Memória em uso, em bytes. |
| `container.memory.usage.limit` | Limite de memória, em bytes. |
| `container.memory.percent` | Uso de memória como porcentagem do limite do contêiner, ou da memória total do host quando o contêiner não tem limite. |

### Rede

| Métrica | Descrição |
| --- | --- |
| `container.network.io.usage.rx_bytes` | Bytes recebidos. Um contador de toda a vida útil. |
| `container.network.io.usage.tx_bytes` | Bytes enviados. Um contador de toda a vida útil. |

### E/S de bloco

| Métrica | Descrição |
| --- | --- |
| `container.blockio.io_service_bytes_recursive` | Bytes lidos e gravados em cada dispositivo de bloco desde que o contêiner iniciou, separados por `operation` (`read`, `write`). Um contador acumulado. A lista o oferece filtrado para leituras e para gravações. |

### Contêiner

| Métrica | Descrição |
| --- | --- |
| `container.uptime` | Segundos desde que o contêiner iniciou. Só contêineres em execução a informam. |
| `container.restarts` | Quantas vezes o contêiner reiniciou desde que foi criado. Um contador de toda a vida útil. |
| `container.restarts.increase` | Reinícios desde a amostra anterior do contêiner feita pelo agente, enviados a cada amostra. A soma deles numa janela são os reinícios dessa janela, então alerte com esta e não com o contador de toda a vida útil. |
| `container.pids.count` | Tarefas no contêiner. O controlador pids do cgroup conta threads além de processos. |

`container.cpu.throttling_data.throttled_periods` não está na lista; consulte-a em **Avançado**.

## Critérios de monitoramento

Um critério compara uma das consultas ou fórmulas do monitor com um limite. Os critérios de um monitor de Docker não têm **Tipo de filtro**: cada regra verifica o valor da métrica, com estes campos.

| Campo | O que faz |
| --- | --- |
| **Métrica** | A consulta ou fórmula a verificar, pelo nome da variável. |
| **Agregação** | Como os valores da janela viram uma única resposta: **Média**, **Soma**, **Maximum Value**, **Minimum Value**, **All Values** (todos os valores precisam corresponder, na janela inteira) ou **Any Value** (basta um). |
| **Condição** | **Maior que**, **Menor que**, **Maior ou igual a**, **Menor ou igual a** ou **Igual a** – ou uma condição de anomalia: **Anomalously High**, **Anomalously Low** ou **Anomalous**. **Sem dados** corresponde quando a consulta não retornou nada na janela, e **Com dados** quando retornou algo. |
| **Limite** | O valor com que comparar. Uma lista de unidades fica ao lado quando a métrica tem unidade. Não aparece em condições de anomalia. |
| **Sensibilidade** | Só condições de anomalia. **Baixo** (4σ), **Médio** (3σ, o padrão) ou **Alto** (2σ). |
| **Janela de linha de base** | Só condições de anomalia. 14 dias (o padrão), 28, 60 ou 90 dias de histórico. |
| **Se não houver dados** | Em **Mais campos**. O que acontece quando a janela não tem amostras: **Ignore** (o padrão), **Treat As Zero** ou **Gatilho**. |

As condições de anomalia comparam cada valor com a mesma hora da semana na linha de base. Elas ficam em um estado "Learning", e não geram nada, até a janela de linha de base ter histórico suficiente.

Cada critério também diz o que fazer quando corresponde: mudar o status do monitor, criar um alerta ou declarar um incidente. Os critérios são verificados de cima para baixo, e o primeiro que corresponde decide.

### Critérios padrão

Um monitor que você não cria a partir de um modelo começa com dois critérios:

| Ordem | Critério | Corresponde quando | Então |
| --- | --- | --- | --- |
| 1 | Check if _monitor name_ is offline | A primeira consulta não tem dados em toda a janela | Marca o monitor como **Offline** e declara o incidente "_monitor name_ is offline", que se resolve sozinho quando o monitor se recupera. |
| 2 | Check if _monitor name_ is online | A primeira consulta tem dados | Marca o monitor como **Operacional**. |

> [!IMPORTANT]
> Um valor de `0` é um dado, então uma métrica que costuma ser zero, como reinícios ou erros, não deixa o monitor offline. Para receber alertas sobre um valor, comece por um modelo ou adicione um critério com um limite. Quando nenhum dado chega e nenhum critério corresponde, o monitor mantém o status e os incidentes abertos continuam abertos: silêncio não é recuperação. O tempo em que o próprio OneUptime não recebia dados nunca conta como falta de dados: uma verificação cuja janela o inclui espera, como explica [Quando o OneUptime não recebe dados](/docs/monitor/when-oneuptime-is-not-receiving).

## Logs coletados

O agente também acompanha o arquivo `*-json.log` de cada contêiner e envia cada linha como um registro de log do OpenTelemetry com:

| Campo | Valor |
| --- | --- |
| `resource.host.name` | O host, de `DOCKER_HOST_NAME`. |
| `resource.container.id` | O ID completo do contêiner. |
| `resource.container.runtime` | Sempre `docker`. |
| `attributes["log.iostream"]` | `stdout` ou `stderr`. |
| `severityText` / `severityNumber` | Lidos de uma palavra-chave de nível onde houver um nível na linha (`[ERROR]`, `app.INFO:`, `{"level":"warn"}`, `level=error`). Uma linha sem nível recorre ao seu fluxo: `stderr` é `ERROR`, `stdout` é `INFO`. |
| `body` | A linha que o contêiner escreveu. Linhas que começam com espaço ou com um colchete de fechamento, como as linhas de um stack trace, são unidas à linha anterior. |
| `time` | O carimbo de data/hora do daemon do Docker para a linha. |

Os logs aparecem na página **Registros** do host e na página de cada contêiner.

### Requisito do driver de log

O agente só consegue ler os logs de contêineres que usam o driver de log `json-file` do Docker. Ele é o padrão do Docker, mas um contêiner ou o daemon inteiro pode usar outro:

| Driver | O que o agente vê |
| --- | --- |
| `json-file` | Todas as linhas. |
| `local` | Nada: o arquivo é binário, e o agente não consegue analisá-lo. |
| `journald`, `syslog`, `fluentd`, `gelf`, `awslogs`, `splunk`, … | Nada: os logs vão para outro lugar, então não há arquivo para acompanhar. |
| `none` | Nada: os logs são descartados. |

Verifique o driver de um contêiner e o padrão do daemon:

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
docker info --format '{{.LoggingDriver}}'
```

Mude para `json-file`. O Docker define o driver de log de um contêiner quando o contêiner é criado, então recrie cada contêiner depois da mudança – um reinício mantém o driver antigo.

:::tabs
@tab Docker Compose
Defina o driver em cada serviço, com rotação:

```yaml title="docker-compose.yml"
services:
  my-app:
    image: my-app:latest
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "5"
```

Depois recrie o serviço:

```bash
docker compose up -d --force-recreate <service>
```
@tab Daemon do Docker
Torne `json-file` o padrão para todo contêiner criado depois:

```json title="/etc/docker/daemon.json"
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

Reinicie o daemon do Docker e depois remova e recrie cada contêiner:

```bash
docker rm -f <container>
docker run ... <image>
```
:::

## Solução de problemas

:::details O host não aparece na lista Host Docker
Os hosts se registram sozinhos a partir dos dados do agente. Verifique se o contêiner do agente está em execução e se o host aparece em **Produtos → Infraestrutura → Docker → Todos os hosts**. O [guia do agente Docker](/docs/telemetry/docker-host) traz as verificações a executar no host.
:::

:::details As métricas chegam, mas a página Registros está vazia
Quase certamente os contêineres não estão usando o driver de log `json-file`. Verifique-os com os comandos de [Requisito do driver de log](#requisito-do-driver-de-log), mude os contêineres cujos logs você quer e recrie-os.
:::

:::details O agente registra "no files match the configured criteria"
O agente procura `/var/lib/docker/containers/*/*-json.log` e não encontrou nada. Ou nenhum contêiner do host usa `json-file`, ou a montagem `/var/lib/docker/containers` do agente (`-v /var/lib/docker/containers:/var/lib/docker/containers:ro`) está faltando ou vazia, ou o agente roda no Docker Desktop para macOS, cujos arquivos de contêiner ficam dentro da VM Linux dele.
:::

:::details Os dados chegam com o nome de host errado
O OneUptime identifica um host por `resource.host.name`, que o agente obtém de `DOCKER_HOST_NAME`. Mudar `DOCKER_HOST_NAME` depois dos primeiros dados cria um segundo host em vez de renomear o primeiro, e um monitor continua vinculado ao nome com que foi criado.
:::

:::details Um alerta de CPU nunca dispara
Agrupe a consulta por `resource.container.name` e agregue com **Máximo**, como faz o modelo **High Container CPU Usage**. Uma média de todos os contêineres de um host ocupado é puxada para baixo pelos ociosos. Lembre-se de que 100% significa um núcleo inteiro, então um contêiner que pode usar vários núcleos precisa de um limite mais alto. Se a CPU de um contêiner for uma linha plana, qualquer que seja a carga, o host executa um agente antigo: [atualize-o](/docs/telemetry/docker-host#atualizando-o-agente).
:::

:::details O modelo de limitação parou de alertar
Ele mede quanto `container.cpu.throttling_data.throttled_time` cresceu entre duas amostras do mesmo minuto. Se o `collection_interval` do agente for de 60 segundos ou mais, cada minuto terá uma única amostra, o crescimento sempre marcará 0 e o modelo nunca disparará. Mantenha o padrão do agente, de 30 segundos.
:::

:::details O modelo de loop de reinícios nunca dispara ou deixa passar reinícios
Ele lê `container.restarts.increase`, que um agente mais antigo não envia: [atualize o agente](/docs/telemetry/docker-host#atualizando-o-agente). Um monitor criado a partir do modelo antes disso lê quanto `container.restarts` cresceu entre duas amostras do mesmo minuto, e deixa passar os reinícios entre as amostras de dois minutos diferentes: exclua-o e crie o modelo novamente.
:::

## Próximos passos

:::cards
- [Agente Docker](/docs/telemetry/docker-host): Instalar, atualizar e solucionar problemas do agente que este monitor lê.
- [Monitor de Podman](/docs/monitor/podman-monitor): O mesmo monitor para hosts Podman.
- [Monitor de Docker Swarm](/docs/monitor/docker-swarm-monitor): Monitorar as tarefas de um cluster Swarm.
- [Visão geral dos incidentes](/docs/incidents/index): O que acontece depois que um critério declara um incidente.
:::
