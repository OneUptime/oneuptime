# API pública

Cada página de status responde a um pequeno conjunto de endpoints JSON somente leitura: a sua visão geral, a disponibilidade, os incidentes, os episódios, os eventos de manutenção programada e os avisos. São os endpoints que a própria página de status carrega, então eles retornam exatamente o que um visitante vê, e uma página pública não precisa de chave de API. Use-os para mostrar o seu status na sua própria aplicação, num chatbot ou numa tela de parede.

:::cards
- [Endpoints](#endpoints): Um endpoint para cada coisa que a página mostra.
- [Ler a visão geral](#ler-a-visão-geral): A página inteira numa requisição, com curl, Node.js e Python.
- [Disponibilidade num intervalo de datas](#disponibilidade-num-intervalo-de-datas): A disponibilidade por recurso e por grupo, de até 90 dias.
- [Erros](#erros): O que cada código de status significa.
:::

## Como uma requisição é respondida

Cada requisição identifica a página de status pelo ID ou por um dos seus domínios personalizados. O OneUptime encontra a página, aplica as mesmas regras de acesso que um visitante encontra e responde com JSON.

```mermaid title="Como uma requisição à API de uma página de status é respondida"
flowchart TB
    R["Requisição com o ID ou o domínio<br/>de uma página de status"] --> F{"ID bem formado<br/>ou domínio verificado?"}
    F -->|"Não"| E404["404: Status Page not found"]
    F -->|"Sim"| A{"Página arquivada?"}
    A -->|"Sim"| E404
    A -->|"Não"| IP{"A lista de IPs permitidos<br/>deixa o chamador entrar?"}
    IP -->|"Não"| E403["403: endereço IP bloqueado"]
    IP -->|"Sim"| P{"A página é pública?"}
    P -->|"Sim"| OK["200 com JSON"]
    P -->|"Não"| S{"Conectado, ou desbloqueada<br/>com a senha?"}
    S -->|"Sim"| OK
    S -->|"Não"| E401["401: não autenticado"]
```

Uma página privada só responde a um navegador que entrou nela, ou que a desbloqueou com a senha: a API lê a mesma sessão que a página. Para um script, use uma página pública. Veja [Restringir quem pode ver a página](/docs/status-pages/index#restringir-quem-pode-ver-a-página).

Um ID bem formado que não pertence a nenhuma página de status segue o mesmo caminho de uma página privada e recebe `401`. Se uma página pública responder `401`, confira o ID.

## Antes de começar

- **O ID da página de status.** Abra a página no painel (**Páginas de status → Todas as páginas de status** e depois a página). O cartão **Detalhes da página de status** na **Visão geral** dela mostra o **ID da página de status**.
- **A URL base.** Todos os endpoints abaixo ficam em `/status-page-api`:

| Onde a página roda | URL base |
| ------------------- | -------- |
| OneUptime Cloud | `https://oneuptime.com/status-page-api` |
| OneUptime auto-hospedado | `https://<your-oneuptime-host>/status-page-api` |
| Um domínio personalizado da página | `https://status.example.com/status-page-api` |

Onde um caminho abaixo indicar `{statusPageIdOrDomain}`, você pode enviar o ID da página ou um dos seus domínios personalizados verificados, como `status.example.com`. O endpoint de disponibilidade aceita apenas o ID, e responde a um domínio com `401`.

## Endpoints

| Endpoint | Métodos | Retorna |
| -------- | ------- | ------- |
| `/overview/{statusPageIdOrDomain}` | `GET`, `POST` | Tudo o que a visão geral mostra: o status geral, os recursos e grupos, os incidentes e episódios ativos, a manutenção programada, os avisos em exibição e os dados por trás das barras de disponibilidade. |
| `/uptime/{statusPageId}` | `POST` | Percentuais de disponibilidade por recurso e por grupo, para um intervalo de datas. |
| `/incidents/{statusPageIdOrDomain}` | `GET`, `POST` | Os incidentes que a página lista, com as suas notas públicas e mudanças de estado. |
| `/incidents/{statusPageIdOrDomain}/{incidentId}` | `POST` | Um incidente. |
| `/episodes/{statusPageIdOrDomain}` | `POST` | Os episódios de incidentes que a página lista. |
| `/episodes/{statusPageIdOrDomain}/{episodeId}` | `POST` | Um episódio. |
| `/scheduled-maintenance-events/{statusPageIdOrDomain}` | `GET`, `POST` | Os eventos de manutenção programada que a página lista, com as suas notas públicas e mudanças de estado. |
| `/scheduled-maintenance-events/{statusPageIdOrDomain}/{scheduledMaintenanceId}` | `POST` | Um evento de manutenção programada. |
| `/announcements/{statusPageIdOrDomain}` | `GET`, `POST` | Os avisos que a página lista. |
| `/announcements/{statusPageIdOrDomain}/{announcementId}` | `POST` | Um aviso. |

Os endpoints seguem as próprias configurações da página, no cartão **O que sua página de status mostra** (veja [Escolher o que aparece na página](/docs/status-pages/index#escolher-o-que-aparece-na-página)):

- Uma lista desligada recusa o seu endpoint, por exemplo com `Incidents are not enabled on this status page.`
- Cada lista volta até onde indica a configuração **Mostrar … dias de histórico** (14 por padrão). A lista de incidentes inclui também todo incidente ainda não resolvido, e a de manutenção programada todo evento que ainda vai acontecer ou está em andamento.
- Pelo ID, um incidente, episódio, evento ou aviso é retornado qualquer que seja a sua idade, então um link para um mais antigo continua funcionando. Um que a página não mostra de jeito nenhum, como um incidente num monitor que não está na página, volta como uma lista vazia, e um episódio como `404`.

**Quais incidentes uma página retorna.** O endpoint de incidentes retorna os incidentes nos monitores da página, menos os limitados a outras páginas de status, e menos todo incidente não limitado a esta página se a página só mostrar os incidentes limitados a ela (veja [Uma página de status por público](/docs/status-pages/one-status-page-per-audience)). A quais páginas um incidente está limitado nunca faz parte da resposta.

## Ler a visão geral

A visão geral é uma requisição para a página inteira. São os mesmos dados que a página de status desenha, e eles têm no máximo 15 segundos.

:::tabs
@tab curl
```bash
curl https://oneuptime.com/status-page-api/overview/YOUR_STATUS_PAGE_ID
```
@tab Node.js
```javascript title="status.mjs"
// Node.js 18 or later: fetch is built in. Run with `node status.mjs`.
const statusPageId = "YOUR_STATUS_PAGE_ID";

const response = await fetch(
  `https://oneuptime.com/status-page-api/overview/${statusPageId}`,
);
const body = await response.json();

if (!response.ok) {
  throw new Error(`${response.status}: ${body.error}`);
}

console.log(body.overallStatus?.name); // "Operational"
```
@tab Python
```python title="status.py"
# Python 3, standard library only. Run with `python3 status.py`.
import json
import urllib.request

STATUS_PAGE_ID = "YOUR_STATUS_PAGE_ID"
url = f"https://oneuptime.com/status-page-api/overview/{STATUS_PAGE_ID}"

with urllib.request.urlopen(url, timeout=10) as response:
    overview = json.load(response)

print((overview.get("overallStatus") or {}).get("name"))  # Operational
```
:::

O status geral é o pior status atual dos monitores e grupos de monitores da página, o de maior prioridade. Um status de monitor tem esta aparência:

```json
{
  "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
  "name": "Operational",
  "color": { "_type": "Color", "value": "#2ab57d" },
  "isOperationalState": true,
  "priority": 1
}
```

### O que a visão geral retorna

| Chave | O que contém |
| --- | ------------- |
| `overallStatus` | O status geral da página, um status de monitor como o de cima, ou `null` quando a página não tem nada. |
| `statusPage` | As configurações públicas da página: título, descrição, marca e o que ela mostra. |
| `statusPageResources` | Cada recurso: o nome de exibição, a descrição, o grupo, o monitor ou grupo de monitores e as opções de exibição. |
| `resourceGroups` | Os grupos, com `parentStatusPageGroupId` para os grupos aninhados. |
| `monitorStatuses` | Todo status de monitor do projeto, da menor prioridade para a maior. |
| `monitorGroupCurrentStatuses`, `monitorsInGroup` | O status atual de cada grupo de monitores da página e os monitores dentro dele. |
| `monitorStatusTimelines`, `uptimeDailyAggregate`, `monitorGroupMergedDowntime`, `statusPageHistoryChartBarColorRules` | A partir de que as barras de disponibilidade são desenhadas, e as regras de cor das barras da página. |
| `activeIncidents`, `incidentPublicNotes`, `incidentStateTimelines`, `incidentStates` | Os incidentes não resolvidos que a página mostra, as suas notas públicas e mudanças de estado, e os estados de incidente do projeto. |
| `timelineIncidents` | Os incidentes dentro da janela das barras de disponibilidade, inclusive os resolvidos, para as dicas das barras. |
| `activeEpisodes`, `episodePublicNotes`, `episodeStateTimelines` | O mesmo para os episódios de incidentes. |
| `scheduledMaintenanceEvents`, `scheduledMaintenanceEventsPublicNotes`, `scheduledMaintenanceStateTimelines`, `scheduledMaintenanceStates` | Os eventos de manutenção programada que ainda vão acontecer ou estão em andamento, as suas notas públicas e mudanças de estado. |
| `activeAnnouncements` | Os avisos em exibição agora: já começados e ainda não encerrados. |

## Disponibilidade num intervalo de datas

`POST /uptime/{statusPageId}` retorna a disponibilidade de cada recurso e grupo da página entre duas datas. As duas datas são opcionais:

| Campo | Padrão | Observações |
| ----- | ------- | ----- |
| `startDate` | 14 dias atrás | Uma data e hora ISO 8601. |
| `endDate` | Agora | Não pode ser anterior a `startDate`. O intervalo pode cobrir no máximo 90 dias. |

:::tabs
@tab curl
```bash
curl -X POST https://oneuptime.com/status-page-api/uptime/YOUR_STATUS_PAGE_ID \
  -H "Content-Type: application/json" \
  -d '{"startDate": "2026-09-01T00:00:00Z", "endDate": "2026-09-30T23:59:59Z"}'
```
@tab Node.js
```javascript title="uptime.mjs"
// Node.js 18 or later. Run with `node uptime.mjs`.
const statusPageId = "YOUR_STATUS_PAGE_ID";

const response = await fetch(
  `https://oneuptime.com/status-page-api/uptime/${statusPageId}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      startDate: "2026-09-01T00:00:00Z",
      endDate: "2026-09-30T23:59:59Z",
    }),
  },
);
const uptime = await response.json();

for (const group of uptime.groupUptimes) {
  console.log(group.statusPageGroupName, group.uptimePercent);
}
```
@tab Python
```python title="uptime.py"
# Python 3, standard library only. Run with `python3 uptime.py`.
import json
import urllib.request

STATUS_PAGE_ID = "YOUR_STATUS_PAGE_ID"

request = urllib.request.Request(
    f"https://oneuptime.com/status-page-api/uptime/{STATUS_PAGE_ID}",
    data=json.dumps(
        {"startDate": "2026-09-01T00:00:00Z", "endDate": "2026-09-30T23:59:59Z"}
    ).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)

with urllib.request.urlopen(request, timeout=10) as response:
    uptime = json.load(response)

for group in uptime["groupUptimes"]:
    print(group["statusPageGroupName"], group["uptimePercent"])
```
:::

A resposta:

```json
{
  "statusPageResourceUptimes": [
    {
      "statusPageResourceId": {
        "_type": "ObjectID",
        "value": "cfffa3c3-fdf3-4cd7-9585-d6d408a14663"
      },
      "uptimePercent": 99.98,
      "statusPageResourceName": "Checkout API",
      "currentStatus": {
        "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
        "name": "Operational",
        "color": { "_type": "Color", "value": "#2ab57d" },
        "isOperationalState": true,
        "priority": 1
      }
    }
  ],
  "groupUptimes": [
    {
      "statusPageGroupId": {
        "_type": "ObjectID",
        "value": "df7632c4-c5c0-453c-88bf-9ee3d68d45f2"
      },
      "parentStatusPageGroupId": null,
      "uptimePercent": 99.98,
      "statusPageResourceUptimes": [
        {
          "statusPageResourceId": {
            "_type": "ObjectID",
            "value": "8175534f-aa77-456c-ad5b-b8e7b85876aa"
          },
          "uptimePercent": 99.98,
          "statusPageResourceName": "Web app",
          "currentStatus": {
            "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
            "name": "Operational",
            "color": { "_type": "Color", "value": "#2ab57d" },
            "isOperationalState": true,
            "priority": 1
          }
        }
      ],
      "statusPageGroupName": "Web",
      "currentStatus": {
        "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
        "name": "Operational",
        "color": { "_type": "Color", "value": "#2ab57d" },
        "isOperationalState": true,
        "priority": 1
      }
    }
  ],
  "startDate": "2026-09-01T00:00:00.000Z",
  "endDate": "2026-09-30T23:59:59.000Z"
}
```

| Chave | O que contém |
| --- | ------------- |
| `statusPageResourceUptimes` | Os recursos que não estão em nenhum grupo, os que os visitantes veem no topo da página. |
| `groupUptimes` | Uma entrada por grupo. `uptimePercent` e `currentStatus` de um grupo cobrem todo recurso abaixo dele, inclusive os grupos aninhados; o seu `statusPageResourceUptimes` lista só os recursos diretamente nele. Reconstrua a árvore com `parentStatusPageGroupId`. |
| `uptimePercent` | Arredondado para a precisão do próprio recurso ou grupo. `null` quando o recurso ou grupo não mostra um percentual de disponibilidade. |
| `currentStatus` | `null` quando o recurso ou grupo não mostra o seu status atual. |

O tempo conta como indisponibilidade quando o seu status de monitor é um dos status **Conta como indisponibilidade** da página.

## Incidentes, episódios, manutenção e avisos

Os endpoints de lista respondem a `GET` além de `POST`; os de um único item e os de episódios respondem a `POST`.

:::tabs
@tab curl
```bash
# The incidents the page lists
curl https://oneuptime.com/status-page-api/incidents/YOUR_STATUS_PAGE_ID

# One scheduled maintenance event
curl -X POST https://oneuptime.com/status-page-api/scheduled-maintenance-events/YOUR_STATUS_PAGE_ID/EVENT_ID
```
@tab Node.js
```javascript title="incidents.mjs"
// Node.js 18 or later. Run with `node incidents.mjs`.
const statusPageId = "YOUR_STATUS_PAGE_ID";

const response = await fetch(
  `https://oneuptime.com/status-page-api/incidents/${statusPageId}`,
);
const { incidents } = await response.json();

for (const incident of incidents) {
  console.log(incident.title, incident.currentIncidentState?.name);
}
```
@tab Python
```python title="incidents.py"
# Python 3, standard library only. Run with `python3 incidents.py`.
import json
import urllib.request

STATUS_PAGE_ID = "YOUR_STATUS_PAGE_ID"
url = f"https://oneuptime.com/status-page-api/incidents/{STATUS_PAGE_ID}"

with urllib.request.urlopen(url, timeout=10) as response:
    incidents = json.load(response)["incidents"]

for incident in incidents:
    print(incident["title"], (incident.get("currentIncidentState") or {}).get("name"))
```
:::

| Endpoint | Chaves na resposta |
| -------- | -------------------- |
| Incidentes | `incidents`, `incidentPublicNotes`, `incidentStateTimelines`, `incidentStates`, `statusPageResources`, `monitorsInGroup` |
| Episódios | `episodes`, `episodePublicNotes`, `episodeStateTimelines`, `incidentStates`, `statusPageResources`, `monitorsInGroup` |
| Eventos de manutenção programada | `scheduledMaintenanceEvents`, `scheduledMaintenanceEventsPublicNotes`, `scheduledMaintenanceStateTimelines`, `scheduledMaintenanceStates`, `statusPageResources`, `monitorsInGroup` |
| Avisos | `announcements`, `statusPageResources`, `monitorsInGroup` |

Uma requisição de um único item responde com as mesmas chaves, contendo esse único registro.

## Erros

Um erro responde com um código de status e um corpo JSON que diz o motivo:

```json
{ "error": "You can only get uptime for 90 days. Please select a date range within 90 days." }
```

| Status | Quando |
| ------ | ---- |
| `400` | A requisição pede algo que a página não mostra, como uma lista desligada, ou o intervalo de disponibilidade passa de 90 dias ou termina antes de começar. |
| `401` | A página é privada, e a requisição não tem sessão conectada nem senha para ela. Um ID bem formado que não pertence a nenhuma página de status também recebe `401`. |
| `403` | A lista de IPs permitidos da página não inclui o endereço do chamador. |
| `404` | O ID não está bem formado, nenhum domínio personalizado verificado corresponde, ou a página está arquivada. Um episódio que a página não mostra também recebe `404`. |

## Outras formas de ler uma página de status

- **RSS.** Toda página de status serve `/rss`, um feed dos seus incidentes, avisos e eventos de manutenção programada. Veja [O selo incorporável e o feed RSS](/docs/status-pages/index#o-selo-incorporável-e-o-feed-rss).
- **llms.txt.** Ao lado de `/rss`, toda página de status serve `/llms.txt`, que aponta agentes de IA para o feed RSS e para o JSON da visão geral.
- **MCP.** Agentes de IA podem ler a página pelo servidor MCP do OneUptime em `https://oneuptime.com/mcp`, sem chave de API, passando o ID ou o domínio da página como `statusPageIdOrDomain`. Ele vem ligado por padrão; desligue-o com **Habilitar servidor MCP** em **IA → MCP**, no menu lateral da página. Veja [Servidor MCP](/docs/ai/mcp-server).
- **A API REST.** Para criar ou alterar páginas de status, recursos, assinantes e avisos, use a [API do OneUptime](/docs/api-reference/api-reference) com uma chave de API.

## Próximos passos

:::cards
- [Visão geral das páginas de status](/docs/status-pages/index): O que uma página de status mostra, e quem pode vê-la.
- [Recursos e grupos da página de status](/docs/status-pages/resources-and-groups): Os recursos e grupos que esses endpoints retornam.
- [Uma página de status por público](/docs/status-pages/one-status-page-per-audience): Por que uma página lista um incidente que outra não lista.
- [Marca e domínios da página de status](/docs/status-pages/branding-and-domains): Sirva a página, e esses endpoints, no seu próprio domínio.
:::
