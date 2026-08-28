# Integrações

O OneUptime se conecta às ferramentas que o seu time já usa — Zabbix, Jira, PagerDuty, Slack e muitas outras — através dos **[Fluxos de trabalho](/docs/workflows/index)**, o motor de automação integrado. Não há plugin separado para instalar. Você monta uma integração em um canvas de arrastar e soltar, e ela roda sempre que algo acontece.

Esta página explica os dois padrões que toda integração usa. Depois de entendê-los, você pode conectar o OneUptime a quase qualquer coisa, mesmo a ferramentas que não têm uma página própria aqui.

## Os dois padrões

Toda integração move dados em uma de duas direções (e muitas usam as duas).

### Entrada — outra ferramenta envia dados para o OneUptime

Use quando um sistema externo precisa _criar ou atualizar algo no OneUptime_ — geralmente abrir um incidente ou um alerta quando ele detecta um problema.

1. Construa um workflow que começa com um **[gatilho Webhook](/docs/workflows/triggers#webhook)**. O OneUptime fornece uma URL exclusiva.
2. Na outra ferramenta, configure um webhook / ação de notificação que faça POST para essa URL quando algo acontecer.
3. No workflow, leia o payload recebido e use um componente **Create Incident** (ou Create Alert) para registrá-lo.

```text
Zabbix / Prometheus / Grafana / Datadog  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

> **Dica:** Especificamente para ferramentas de alertas, um **[monitor de Requisição de Entrada](/docs/monitor/incoming-request-monitor)** costuma ser o melhor caminho de entrada. Ele fornece uma URL de webhook sem que você construa um workflow, abre um incidente por alerta presente no payload, escala para uma política de plantão e resolve cada incidente quando a ferramenta informa a recuperação. Recorra a um workflow quando precisar de lógica que o OneUptime não faz nativamente. Veja [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) para um exemplo completo.

### Saída — o OneUptime envia dados para outra ferramenta

Use quando _algo no OneUptime deve aparecer em outra ferramenta_ — abrir um ticket no Jira, acionar alguém no PagerDuty, publicar no Slack.

1. Construa um workflow que começa com um **[gatilho de evento do OneUptime](/docs/workflows/triggers#oneuptime-event-triggers)** — por exemplo **Incident → On Create**.
2. Adicione um **[componente API](/docs/workflows/components#api)** que chama a REST API da outra ferramenta com os detalhes do incidente.
3. Armazene quaisquer chaves de API como **[variáveis globais](/docs/workflows/variables#global-variables) secretas** para que nunca apareçam no workflow nem em seus registros.

```text
OneUptime Incident → On Create  ──►  API component  ──►  Jira / PagerDuty / ServiceNow / GitHub
```

## Catálogo

| Ferramenta                                                            | Direção           | O que faz                                                                                |
| --------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| [Zabbix](/docs/integrations/zabbix)                                   | Entrada           | Transforma problemas do Zabbix em incidentes do OneUptime (e os resolve na recuperação). |
| [Jira](/docs/integrations/jira)                                       | Saída (+ entrada) | Abre um issue no Jira para cada incidente; sincroniza o status de volta.                  |
| [PagerDuty](/docs/integrations/pagerduty)                             | Saída (+ entrada) | Aciona e resolve eventos do PagerDuty a partir de incidentes do OneUptime.                |
| [Opsgenie](/docs/integrations/opsgenie)                               | Saída (+ entrada) | Cria e fecha alertas do Opsgenie.                                                         |
| [ServiceNow](/docs/integrations/servicenow)                           | Saída (+ entrada) | Abre incidentes do ServiceNow a partir do OneUptime.                                      |
| [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365)   | Saída (+ entrada) | Abre e resolve Cases do Dynamics 365 a partir de incidentes do OneUptime.                 |
| [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) | Entrada           | Converte notificações do Alertmanager em incidentes.                                      |
| [Grafana](/docs/integrations/grafana)                                 | Entrada           | Converte alertas do Grafana em incidentes.                                                |
| [Datadog](/docs/integrations/datadog)                                 | Entrada           | Converte alertas de monitor do Datadog em incidentes.                                     |
| [GitHub](/docs/integrations/github)                                   | Saída             | Abre um issue no GitHub para um incidente.                                                |
| [GitLab](/docs/integrations/gitlab)                                   | Saída             | Abre um issue no GitLab para um incidente.                                                |
| [Discord](/docs/integrations/discord)                                 | Saída             | Publica atualizações de incidentes em um canal do Discord.                                |
| [Telegram](/docs/integrations/telegram)                               | Saída             | Envia atualizações de incidentes para um chat do Telegram.                                |
| [Slack](/docs/workspace-connections/slack)                            | Ambas             | Conexão de workspace nativa — canais, alertas e plantão.                                  |
| [Microsoft Teams](/docs/workspace-connections/microsoft-teams)        | Ambas             | Conexão de workspace nativa.                                                              |

> **Slack e Microsoft Teams** têm uma conexão nativa mais profunda, que vai além dos workflows — canais de incidente automáticos, ações bidirecionais e notificações de plantão. Use as conexões de workspace do [Slack](/docs/workspace-connections/slack) e do [Microsoft Teams](/docs/workspace-connections/microsoft-teams) para esses casos, em vez de construir um workflow.

## Gerenciando segredos

Nunca cole uma chave de API ou um token diretamente em um bloco. Em vez disso:

1. Vá em **Fluxos de trabalho → Variáveis globais**.
2. Crie uma variável — por exemplo `JIRA_AUTH` — e ative **Segredo**.
3. Referencie-a em qualquer lugar com `{{global.variables.JIRA_AUTH}}`.

Variáveis secretas ficam ocultas na interface depois que você salva e são removidas dos registros de execução. Veja [Variáveis](/docs/workflows/variables#global-variables).

## Guia rápido de autenticação

A maioria das integrações de saída precisa de um cabeçalho `Authorization` no bloco de API. As formas mais comuns:

| Esquema                      | Valor do cabeçalho                                 | Usado por                           |
| ---------------------------- | -------------------------------------------------- | ----------------------------------- |
| Bearer token                 | `Bearer {{global.variables.TOKEN}}`                | GitHub, muitas APIs modernas        |
| Basic auth                   | `Basic {{global.variables.BASE64_USER_PASS}}`      | Jira Cloud, ServiceNow              |
| Cabeçalho com chave de API   | `GenieKey {{global.variables.OPSGENIE_KEY}}`       | Opsgenie                            |
| Token no corpo               | campo `routing_key` no corpo JSON                  | PagerDuty Events API                |
| Cabeçalho de token privado   | `PRIVATE-TOKEN: {{global.variables.GITLAB_TOKEN}}` | GitLab                              |
| OAuth 2.0 client credentials | `Bearer <token fetched by an earlier API block>`   | Microsoft Dynamics 365 (Dataverse)  |

Para Basic auth, codifique `username:password` (ou `email:api_token`) em base64 **uma vez** e depois armazene o resultado como segredo. No macOS/Linux:

```bash
printf '%s' 'you@example.com:your_api_token' | base64
```

## Sua ferramenta não está na lista?

Quase qualquer ferramenta se encaixa em um dos dois padrões acima:

- Se a ferramenta consegue **enviar um webhook** quando algo acontece, use o padrão de **entrada** — aponte o webhook dela para um [monitor de Requisição de Entrada](/docs/monitor/incoming-request-monitor) se for uma ferramenta de alertas, ou para um gatilho Webhook do OneUptime se você precisar de lógica personalizada.
- Se a ferramenta tem uma **REST API**, use o padrão de **saída** — chame-a a partir de um **componente API**.
- Se você precisar reformatar dados entre os dois, adicione um bloco **[Custom Code](/docs/workflows/components#custom-code)**.

Isso cobre a longa cauda — Zendesk, AWS CloudWatch (via SNS), New Relic, Splunk, StatusCake e assim por diante. A receita é a mesma; só a URL e o payload mudam.

## O que ler em seguida

- [Visão geral dos workflows](/docs/workflows/index) — como o motor de automação funciona.
- [Gatilhos](/docs/workflows/triggers) — gatilhos Webhook e de evento do OneUptime em detalhes.
- [Componentes](/docs/workflows/components) — os componentes API, Webhook e de dados.
- [Variáveis](/docs/workflows/variables) — segredos e passagem de dados entre blocos.
- [Monitor de Requisição de Entrada](/docs/monitor/incoming-request-monitor) — o caminho de entrada sem workflow para ferramentas de alertas.
- [Zabbix](/docs/integrations/zabbix), [Jira](/docs/integrations/jira) e [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) — exemplos completos trabalhados.
