# Monitor de página de status externa

Um monitor de página de status externa acompanha a página de status pública de um serviço do qual você depende (AWS, GCP, Azure, GitHub, OpenAI, Anthropic e muitos outros) e alerta você quando esse provedor informa uma interrupção ou desempenho degradado. Use-o para saber de problemas nos seus provedores assim que eles os informam, e para separá-los dos seus.

Ele também lê páginas de status criadas com o OneUptime, recurso por recurso, e distingue manutenção planejada de uma interrupção: acompanhe o projeto de outra equipe, ou um provedor cuja página de status roda no OneUptime.

:::cards
- [Criar o monitor](#criar-um-monitor-de-página-de-status-externa): Cole a URL de uma página de status e escolha o que acompanhar.
- [Escolher componentes](#componentes): Acompanhe só os componentes de que você depende.
- [Critérios](#critérios-de-monitoramento): O que conta como fora do ar, logo de saída.
- [Páginas de status do OneUptime](#páginas-de-status-do-oneuptime): Os recursos de outro projeto, e a manutenção dele.
- [Páginas de status populares](#urls-de-páginas-de-status-populares): URLs dos serviços dos quais a maioria das equipes depende.
:::

## Como funciona

A cada verificação, uma sonda baixa a página de status, descobre o formato dela e lê o status geral, os componentes e os incidentes ativos. Se você escolheu componentes, ou um grupo de componentes, só eles contam. Depois, os critérios decidem se o monitor está online ou offline.

```mermaid title="Uma verificação de uma página de status externa"
flowchart TB
    fetch["Baixar a página de status"] --> detect["Detectar o formato"]
    detect --> parse["Ler status, componentes, incidentes"]
    parse --> scope["Manter os componentes escolhidos"]
    scope --> criteria{"Incidente ativo ou interrupção?"}
    criteria -->|Sim| down["Offline, incidente declarado"]
    criteria -->|Não| up["Online"]
```

Você pode usá-lo para:

- Monitorar a disponibilidade dos serviços de terceiros dos quais seu aplicativo depende
- Ser alertado quando provedores externos sofrem interrupções
- Acompanhar o status de cada componente
- Acompanhar só os componentes de que você depende (por exemplo, Git Operations e Pull Requests do GitHub, ou o grupo "APIs" da OpenAI), para que incidentes sem relação em outras partes da página não disparem seu monitor
- Detectar desempenho degradado antes que ele afete seus usuários
- Relacionar seus próprios incidentes com problemas dos provedores externos

## Provedores compatíveis

| Provedor | Descrição |
| ------------------------ | ---------------------------------------------------------------------- |
| **Auto** (padrão) | Detecta automaticamente o formato da página de status |
| **Atlassian Statuspage** | Páginas de status baseadas no Atlassian Statuspage (API JSON) |
| **incident.io** | Páginas de status baseadas no incident.io (por exemplo, `https://status.openai.com`) |
| **OneUptime Status Page** | Páginas de status criadas com o OneUptime: o status de cada recurso, e o que está em manutenção |
| **RSS** | Páginas de status que oferecem um feed RSS |
| **Atom** | Páginas de status que oferecem um feed Atom |

### Detecção automática

Com **Auto**, o OneUptime detecta automaticamente o formato da página de status, nesta ordem:

1. Primeiro, tenta a API de páginas de status do incident.io (`/proxy/<host>`).
2. Depois, tenta a API JSON do Atlassian Statuspage (`/api/v2/status.json`, `/api/v2/components.json` e `/api/v2/incidents/unresolved.json`).
3. Em seguida, pede o resumo de uma página de status do OneUptime (`/status-page-api/summary/<page>`).
4. Se essas falharem, tenta ler a página como um feed RSS ou Atom.
5. Como último recurso, faz uma verificação básica de acessibilidade HTTP.

> [!NOTE]
> O incident.io é verificado primeiro porque algumas páginas de status do incident.io (como `https://status.openai.com`) também expõem um endpoint limitado compatível com o Atlassian, que omite os grupos de componentes e os incidentes ativos. Verificar o incident.io primeiro garante que sejam usados os dados mais completos, que conhecem os grupos.

A verificação de acessibilidade também é o último recurso quando um provedor escolhido explicitamente falha. Ela só diz se a página responde (online com uma resposta `2xx` ou `3xx`) e não informa componentes nem incidentes.

## Criar um monitor de página de status externa

:::steps
### Começar um novo monitor

Vá para **Monitores** e clique em **Criar monitor**. Em **Tipo de monitor**, clique em **Mais tipos de monitor** e escolha **External Status Page** em **Basic Monitoring**, ou digite `statuspage` na caixa de pesquisa. Digite um **Nome** e clique em **Próximo**.

### Informar a URL da página de status

Informe a **URL da Página de Status**. Deixe o **Provedor** em **Auto**, a menos que você conheça o formato.

### Escolher componentes, se precisar

Abra **Componentes** e escolha na lista da página os componentes de que você depende, como `Git Operations` e `Pull Requests` na do GitHub; deixe vazio para acompanhar a página inteira. Para acompanhar um grupo em vez disso, abra **Mais campos** e informe um **Component Group Filter**, como `APIs`.

### Testar

Clique em **Testar monitor** para baixar a página uma vez, e confira o provedor, os componentes e os incidentes encontrados.

### Revisar os critérios

A etapa de critérios começa com [os critérios padrão](#critérios-padrão), que marcam o monitor como offline quando o provedor informa um incidente ativo ou uma interrupção dentro do escopo. Altere-os se precisar e clique em **Próximo**.

### Escolher as sondas e criar

Selecione as **Sondas** e um **Intervalo de monitoramento** (começa em **A cada 5 minutos**) e clique em **Criar monitor**.
:::

## Opções de configuração

| Opção | O que informar | Padrão |
| --- | --- | --- |
| **URL da Página de Status** | A URL da página de status. Em sites baseados no Atlassian Statuspage e no incident.io, costuma ser a URL raiz (por exemplo, `https://status.example.com`). Para feeds RSS/Atom, informe diretamente a URL do feed. | — |
| **Provedor** | **Auto** para detectar o formato, ou **Atlassian Statuspage**, **incident.io**, **OneUptime Status Page**, **RSS** ou **Atom** se você souber. | **Auto** |
| **Componentes** | Os componentes a acompanhar, escolhidos na lista da página ou digitados. | A página inteira |
| **Component Group Filter** | O grupo ao qual limitar o monitor. Em **Mais campos**. | Todos os grupos |
| **Tempo limite (ms)** | O tempo máximo de espera pela página de status. Em **Mais campos**. | `10000` (10 segundos) |
| **Tentativas** | Quantas vezes tentar de novo, com um segundo de intervalo, depois que a primeira tentativa falha; `0` significa uma única tentativa. Em **Mais campos**. | `3` (até 4 tentativas) |

### Componentes

Escolha os componentes de que você depende e o monitor acompanha só eles: **External Status Page Component Status** compara só os status deles, o status geral é o pior entre os deles e **External Status Page Active Incidents** conta só os incidentes que afetam pelo menos um deles. Continua sendo uma única verificação da página, quantos você escolher.

Quando você abre **Componentes**, seu navegador lê a lista da página em uma Atlassian Statuspage, uma página do incident.io ou uma página de status do OneUptime, e a mostra nos grupos da página; cada componente que não está operacional diz como está. Um nome escolhido acompanha o componente com exatamente esse nome, sem diferenciar maiúsculas de minúsculas: `Copilot` na página do GitHub não é `Copilot AI Model Providers`.

Quando a lista não pode ser lida (uma página interna, uma página que não compartilha a lista com seu navegador, um feed RSS ou Atom), digite um nome e pressione Enter. Um `*` representa qualquer texto: `*us-east-1*` acompanha cada componente com `us-east-1` no nome. Em um feed RSS ou Atom, um item conta quando o título contém um dos nomes.

Um incidente que não nomeia nenhum componente não conta enquanto você acompanha componentes escolhidos: nada diz que ele os afeta. Sem nada escolhido, o monitor acompanha a página inteira e todo incidente conta.

Um monitor salvo com o antigo Filtro de nome de componente continua acompanhando o que acompanhava: o filtro aparece em **Componentes** como esse nome entre asteriscos, como `*API*`, que corresponde a cada componente cujo nome o contém.

> [!WARNING]
> Um nome que não corresponde a nada não acompanha nada, e parece saudável. **Componentes** e **Testar monitor** nomeiam os componentes escolhidos que a página não lista.

### Component Group Filter

Se a página de status organiza seus componentes em grupos, você pode limitar o monitor a um único grupo. Por exemplo, em `https://status.openai.com`, informar `APIs` limita o monitor aos serviços de API da OpenAI.

Quando um grupo de componentes está definido, o **número de incidentes ativos** e o **status geral** são calculados só com os componentes desse grupo: um incidente que afeta um grupo sem relação (por exemplo, o ChatGPT) não vai disparar um monitor limitado ao grupo "APIs". Com componentes também escolhidos, só contam os componentes escolhidos do grupo.

A filtragem por grupo de componentes é compatível com os provedores **Atlassian Statuspage**, **incident.io** e **OneUptime Status Page**. Feeds RSS e Atom não expõem grupos de componentes.

## Critérios de monitoramento

Você pode configurar critérios para decidir quando o serviço externo é considerado online ou offline, com base em:

| Tipo de filtro | O que verifica | Condições do filtro |
| --- | --- | --- |
| **External Status Page Is Online** | Se a página de status está acessível e retornando dados de status | Verdadeiro ou Falso |
| **External Status Page Overall Status** | O status geral que a página informa | Igual a, Diferente de, Contém, Não contém, Começa com, Termina com |
| **External Status Page Component Status** | O status de cada componente do escopo (os componentes escolhidos, ou os do grupo, quando definidos): Operacional, Under Maintenance, Degraded Performance, Partial Outage, Major Outage ou Full Outage | Igual a, Diferente de, Contém, Não contém, Começa com, Termina com |
| **External Status Page Active Incidents** | O número de incidentes ativos no momento informados na página de status (só os que afetam um componente do escopo, quando há componentes ou um grupo escolhidos) | Igual a, Diferente de e as comparações numéricas |
| **External Status Page Response Time (in ms)** | Quanto tempo leva para baixar os dados da página de status | Maior que, Menor que, Maior ou igual a, Menor ou igual a |

O status geral é o que a página diz, então os valores dele variam conforme o provedor: uma Atlassian Statuspage informa a própria descrição, como `All Systems Operational`; uma página de status do OneUptime, o pior status entre os componentes no escopo, como `under_maintenance`; um feed informa `operational` ou `degraded_performance`; a verificação de acessibilidade informa `reachable` ou `unreachable`. Com componentes ou um grupo escolhidos, é o pior status entre eles, em qualquer página. Essas comparações diferenciam maiúsculas de minúsculas. Para alertar sobre interrupções, **External Status Page Active Incidents** e **External Status Page Component Status** costumam ser mais confiáveis.

Em um feed RSS ou Atom, os itens das últimas 24 horas contam como incidentes ativos: um item RSS pela data de publicação, uma entrada Atom pela data de atualização. Um item com data no futuro só conta a partir dessa data.

### Critérios padrão

Por padrão, o OneUptime cria critérios baseados no que realmente importa em uma página de status (os incidentes ativos e a saúde dos componentes) e não na simples acessibilidade:

| Critério | Filtros | Efeito |
| --- | --- | --- |
| Offline | **Qualquer** um de: a página não está online; há pelo menos um incidente ativo no escopo; um componente do escopo informa Degraded Performance, Partial Outage, Major Outage ou Full Outage | Marca o monitor como offline e declara um incidente, que se resolve sozinho quando o critério deixa de corresponder |
| Online | **Todos** de: a página está online; não há incidentes ativos no escopo | Marca o monitor como online |

Como o número de incidentes ativos e os status dos componentes respeitam os componentes e o grupo escolhidos, esses critérios padrão miram automaticamente só nos componentes que interessam a você.

## Páginas de status do OneUptime

Escolha **OneUptime Status Page** como provedor, ou deixe **Auto**, para acompanhar uma página de status criada com o OneUptime: o projeto de outra equipe, ou a página de um provedor no OneUptime Cloud ou num OneUptime auto-hospedado. Informe o endereço da própria página em **URL da Página de Status**: o domínio dela, como `https://status.example.com`, ou `https://oneuptime.com/status-page/<status-page-id>` para uma página sem domínio próprio.

O monitor lê o resumo da página, `/status-page-api/summary/<page>` (veja [Ler o resumo](/docs/status-pages/public-api#ler-o-resumo)): só o que a página mostra aos visitantes, e nada mais do outro projeto. Cada recurso da página, um monitor ou um grupo de monitores, é um componente, com o nome que a página dá a ele, no grupo da página; um grupo dentro de outro fica `Core / Databases`. Escolha recursos em **Componentes**, ou acompanhe um grupo com **Component Group Filter**.

O status de um componente é o valor que o status dele na página representa, então os critérios de status de componente funcionam como em qualquer página de status:

| Na página | Status do componente |
| --- | --- |
| O status operacional do projeto | `operational` |
| Um status chamado `Degraded` | `degraded_performance` |
| Um status chamado `Offline`, `Down` ou `Major Outage` | `major_outage` |
| Um status chamado `Partial Outage` | `partial_outage` |
| Um status chamado `Full Outage` | `full_outage` |
| Um status chamado `Maintenance` | `under_maintenance` |
| Qualquer outro status | `degraded_performance` |
| Um status que a página oculta, com **Show current status** desligado | `unknown` |

Enquanto um evento de manutenção programada em andamento afeta um recurso, porque nomeia um dos monitores dele ou um monitor do grupo de monitores dele, o componente fica `under_maintenance`, seja qual for o status dos monitores: um monitor não é verificado enquanto um evento o segura. Um evento que ainda vai acontecer, ou que já terminou, não muda nada. Os incidentes ativos da página contam para os recursos que eles afetam.

Os [critérios padrão](#critérios-padrão) nunca tomam uma manutenção por uma interrupção: o monitor continua online durante o trabalho planejado do outro projeto.

### Mostrar no seu monitor a manutenção do outro projeto

:::steps
### Adicionar o critério

Nos critérios do monitor, clique em **Adicionar critérios**. Dê a ele o filtro **External Status Page Component Status**, **Igual a**, **Under Maintenance**, e escolha o seu status de manutenção em **Alterar status do monitor para**.

### Levá-lo para o topo

Arraste o novo critério para cima dos outros: vence o primeiro critério que corresponde.

### Conferir com Testar monitor

Clique em **Testar monitor** enquanto o outro projeto tem uma manutenção em andamento: o componente afetado mostra **Under Maintenance**.
:::

### O que uma página de status do OneUptime deixa o monitor ler

Uma página que qualquer pessoa pode abrir é lida como os visitantes a veem. Uma página privada, que pede login, SSO ou uma senha, não pode ser lida: com **OneUptime Status Page** escolhido, a verificação falha e diz por quê. Uma página com uma lista de IPs permitidos precisa liberar o endereço da sonda: acompanhe-a a partir de uma sonda dentro dessa rede.

## Variáveis de modelo

Ao criar incidentes ou alertas a partir de monitores de página de status externa, você pode usar estas variáveis em títulos, descrições e notas de correção (veja [Modelos de incidentes e alertas](/docs/monitor/incident-alert-templating)):

| Variável | Descrição |
| ------------------------- | ------------------------------------------------------------------------------- |
| `{{isOnline}}`            | Se a página de status está online (true/false) |
| `{{responseTimeInMs}}`    | Tempo de resposta em milissegundos |
| `{{failureCause}}`        | Motivo da falha, se houver |
| `{{overallStatus}}`       | O valor do indicador de status geral |
| `{{activeIncidentCount}}` | Número de incidentes ativos (dos componentes que ele acompanha, se escolheu algum) |
| `{{componentStatuses}}`   | Array JSON de status de componentes (`name`, `status`, `description`, `groupName`) |
| `{{provider}}`            | Provedor detectado (Atlassian Statuspage, incident.io, OneUptime Status Page, RSS, Atom); vazio após uma verificação de acessibilidade |
| `{{componentGroup}}`      | Grupo de componentes ao qual o monitor está limitado, se houver |
| `{{componentName}}`       | Os componentes que o monitor acompanha, separados por vírgulas, se escolheu algum |

## URLs de páginas de status populares

Aqui está uma lista de páginas de status de serviços populares. Muitas usam o Atlassian Statuspage ou o incident.io, então o provedor **Auto** as detecta automaticamente. Uma página que não é baseada em nenhum dos dois, e que não é um feed, só recebe a verificação de acessibilidade: nesses casos, monitore o feed RSS ou Atom do provedor, se ele publicar um.

| Serviço | URL da página de status |
| ---------------------------- | --------------------------------------------- |
| AWS                          | `https://health.aws.amazon.com/health/status` |
| Google Cloud Platform        | `https://status.cloud.google.com`             |
| Microsoft Azure              | `https://status.azure.com`                    |
| GitHub                       | `https://www.githubstatus.com`                |
| OpenAI                       | `https://status.openai.com`                   |
| Anthropic                    | `https://status.anthropic.com`                |
| Cloudflare                   | `https://www.cloudflarestatus.com`            |
| Datadog                      | `https://status.datadoghq.com`                |
| PagerDuty                    | `https://status.pagerduty.com`                |
| Twilio                       | `https://status.twilio.com`                   |
| Stripe                       | `https://status.stripe.com`                   |
| Slack                        | `https://status.slack.com`                    |
| Atlassian (Jira, Confluence) | `https://status.atlassian.com`                |
| Vercel                       | `https://www.vercel-status.com`               |
| Netlify                      | `https://www.netlifystatus.com`               |
| DigitalOcean                 | `https://status.digitalocean.com`             |
| Heroku                       | `https://status.heroku.com`                   |
| MongoDB Atlas                | `https://status.cloud.mongodb.com`            |
| Fastly                       | `https://status.fastly.com`                   |
| New Relic                    | `https://status.newrelic.com`                 |
| Sentry                       | `https://status.sentry.io`                    |
| CircleCI                     | `https://status.circleci.com`                 |

## Boas práticas

- **Use o provedor Auto**, a menos que você saiba o formato exato: a detecção automática funciona bem na maioria das páginas de status.
- **Escolha os componentes de que você depende** (por exemplo, Git Operations e Pull Requests do GitHub), para que incidentes sem relação não façam barulho.
- **Acompanhe um grupo inteiro** quando você depende dele todo (por exemplo, as "APIs" da OpenAI), para que os componentes que ele ganhar depois também sejam acompanhados.
- **Combine com seus próprios monitores**: junte os monitores de página de status externa aos seus monitores de API e de site. Quando os dois caem ao mesmo tempo, a página de status do provedor leva você mais rápido à causa raiz.

## Solução de problemas

:::details O monitor está offline, mas o incidente é de uma parte do serviço que eu não uso
Escolha em **Componentes** os componentes de que você depende, ou um grupo em **Component Group Filter**. Assim, o número de incidentes ativos e os status dos componentes só contam esses; um incidente que não nomeia nenhum componente não conta.
:::

:::details O monitor nunca fica offline, nem durante uma interrupção
Um nome escolhido pode não corresponder a nada na página, o que parece saudável, ou a página pode estar recebendo só a verificação de acessibilidade. Execute **Testar monitor**: ele mostra o provedor e os componentes encontrados, e nomeia cada componente escolhido que a página não lista.
:::

:::details O Auto escolhe o formato errado, ou não encontra componentes
Defina o **Provedor** que você sabe que a página usa. Para um feed RSS ou Atom, informe a URL do próprio feed em vez da URL da página de status.
:::

:::details A lista de Componentes não carrega
Seu navegador lê a lista direto da página de status. Uma página interna que seu navegador não alcança, uma página que não compartilha a lista com outros sites e um feed RSS ou Atom não têm lista para escolher: digite o nome de cada componente como a página o mostra e pressione Enter. As sondas leem a página como antes.
:::

:::details Uma página de status do OneUptime não mostra componentes
Escolha **OneUptime Status Page** como **Provedor** e clique em **Testar monitor**: o resultado diz se a página é privada, ou se a lista de IPs permitidos dela barra a sonda. Um OneUptime auto-hospedado que não é atualizado há algum tempo ainda não serve um resumo: até ser, a página recebe a verificação de acessibilidade, ou é lida como um feed.
:::

:::details Uma página de status interna não pode ser acessada
Uma sonda recusa endereços de rede privada, a menos que tenha permissão para alcançá-los. Defina `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` em uma sonda dentro da sua rede: veja [Acesso à rede privada](/docs/self-hosted/private-network-access).
:::

## Próximos passos

:::cards
- [Modelos de incidentes e alertas](/docs/monitor/incident-alert-templating): Coloque o status do provedor nos títulos dos seus incidentes.
- [Monitor de API](/docs/monitor/api-monitor): Verifique seus próprios endpoints ao lado do status do seu provedor.
- [Criar um monitor](/docs/monitor/create-monitor): Os passos que todos os tipos de monitor compartilham.
:::
