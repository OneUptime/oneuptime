# Monitor de Página de Status Externa

O monitoramento de páginas de status externas permite monitorar páginas de status de terceiros e ser alertado quando os serviços dos quais você depende experimentam interrupções ou degradação de desempenho. O OneUptime verifica periodicamente páginas de status externas (como AWS, GCP, Azure, GitHub e mais) e avalia seu status.

## Visão Geral

Os monitores de páginas de status externas verificam a saúde dos serviços dos quais você depende consultando suas páginas de status públicas. Isso permite que você:

- Monitore a disponibilidade de serviços de terceiros dos quais seu aplicativo depende
- Seja alertado quando provedores upstream experimentam interrupções
- Rastreie status de componentes individuais (ex.: "AWS EC2 us-east-1")
- Detecte degradação de desempenho antes que afete seus usuários
- Correlacione seus próprios incidentes com problemas de provedores upstream

## Provedores Suportados

O OneUptime suporta o monitoramento de páginas de status através dos seguintes métodos:

| Tipo de Provedor         | Descrição                                                          |
| ------------------------ | ------------------------------------------------------------------ |
| **Auto** (padrão)        | Detecta automaticamente o formato da página de status              |
| **Atlassian Statuspage** | Páginas de status alimentadas pelo Atlassian Statuspage (API JSON) |
| **RSS**                  | Páginas de status que fornecem um feed RSS                         |
| **Atom**                 | Páginas de status que fornecem um feed Atom                        |

### Detecção Automática

Quando definido como **Auto**, o OneUptime tentará detectar o formato da página de status automaticamente:

1. Primeiro, tenta a API JSON do Atlassian Statuspage (`/api/v2/status.json` e `/api/v2/components.json`)
2. Se isso falhar, tenta analisar a página como um feed RSS ou Atom
3. Como fallback final, realiza uma verificação básica de acessibilidade HTTP

## Criando um Monitor de Página de Status Externa

1. Vá para **Monitors** no Painel do OneUptime
2. Clique em **Create Monitor**
3. Selecione **External Status Page** como o tipo de monitor
4. Insira a URL da página de status que deseja monitorar
5. Opcionalmente selecione um tipo de provedor específico (ou deixe como Auto)
6. Opcionalmente insira um nome de componente para filtrar o monitoramento para um componente específico
7. Configure os critérios de monitoramento conforme necessário

## Opções de Configuração

### URL da Página de Status

Insira a URL da página de status externa que deseja monitorar. Para sites alimentados pelo Atlassian Statuspage, esta é tipicamente a URL raiz (ex.: `https://status.example.com`). Para feeds RSS/Atom, insira a URL do feed diretamente.

### Tipo de Provedor

Selecione o tipo de provedor para a página de status. Use **Auto** (padrão) para deixar o OneUptime detectar o formato automaticamente, ou especifique um tipo de provedor específico se você o conhece.

### Filtro de Nome de Componente

Se a página de status relata sobre múltiplos componentes, você pode opcionalmente especificar um nome de componente para monitorar apenas esse componente específico. Por exemplo, para monitorar apenas o AWS EC2 em us-east-1, você digitaria `EC2 us-east-1` (o nome exato do componente como mostrado na página de status).

Quando nenhum nome de componente é especificado, o status geral da página de status é monitorado.

### Opções Avançadas

#### Timeout

O tempo máximo (em milissegundos) para aguardar uma resposta da página de status. O padrão é 10000ms (10 segundos).

#### Retries

O número de vezes para tentar a requisição novamente se ela falhar. O padrão é 3 tentativas.

## Critérios de Monitoramento

Você pode configurar critérios para determinar quando o serviço externo é considerado online, degradado ou offline com base em:

- **Is Online** — Se a página de status está acessível e retornando dados de status
- **Overall Status** — O indicador de status geral da página de status (ex.: "operational", "major_outage")
- **Component Status** — O status de um componente específico (ao usar filtro de nome de componente)
- **Active Incidents** — O número de incidentes ativos relatados na página de status
- **Response Time** — Quanto tempo leva para buscar os dados da página de status

## URLs Populares de Páginas de Status

Aqui está uma lista curada de URLs populares de páginas de status de serviços que você pode monitorar:

| Serviço                      | URL da Página de Status                       |
| ---------------------------- | --------------------------------------------- |
| AWS                          | `https://health.aws.amazon.com/health/status` |
| Google Cloud Platform        | `https://status.cloud.google.com`             |
| Microsoft Azure              | `https://status.azure.com`                    |
| GitHub                       | `https://www.githubstatus.com`                |
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

> **Nota:** Muitos desses usam o Atlassian Statuspage, então o tipo de provedor **Auto** os detectará automaticamente.

## Modelos de Incidente e Alerta

Ao criar incidentes ou alertas a partir de monitores de páginas de status externas, você pode usar as seguintes variáveis de modelo:

| Variável                  | Descrição                                      |
| ------------------------- | ---------------------------------------------- |
| `{{isOnline}}`            | Se a página de status está online (true/false) |
| `{{responseTimeInMs}}`    | Tempo de resposta em milissegundos             |
| `{{failureCause}}`        | Motivo da falha, se houver                     |
| `{{overallStatus}}`       | O valor do indicador de status geral           |
| `{{activeIncidentCount}}` | Número de incidentes ativos                    |
| `{{componentStatuses}}`   | Array JSON de status de componentes            |

## Melhores Práticas

- **Use o tipo de provedor Auto** a menos que você conheça o formato exato — a detecção automática funciona bem para a maioria das páginas de status
- **Monitore componentes específicos** se você depender apenas de determinados serviços (ex.: uma região específica da AWS)
- **Configure correlação de incidentes** — quando seus monitores detectam problemas e a página de status upstream também mostra problemas, isso ajuda a identificar as causas raiz mais rapidamente
- **Combine com outros monitores** — emparelhe monitores de páginas de status externas com seus próprios monitores de API/site para visibilidade abrangente
