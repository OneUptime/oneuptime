# API pública

Cada página de estado responde a un pequeño conjunto de endpoints JSON de solo lectura: su vista general, su disponibilidad, sus incidentes, episodios, eventos de mantenimiento programado y anuncios. Son los endpoints que carga la propia página de estado, así que devuelven exactamente lo que ve un visitante, y una página pública no necesita clave de API. Úsalos para mostrar tu estado en tu propia aplicación, en un chatbot o en una pantalla mural.

:::cards
- [Endpoints](#endpoints): Un endpoint para cada cosa que muestra la página.
- [Leer la vista general](#leer-la-vista-general): Toda la página en una solicitud, con curl, Node.js y Python.
- [Disponibilidad en un intervalo de fechas](#disponibilidad-en-un-intervalo-de-fechas): La disponibilidad por recurso y por grupo, de hasta 90 días.
- [Errores](#errores): Qué significa cada código de estado.
:::

## Cómo se responde una solicitud

Cada solicitud nombra la página de estado por su ID o por uno de sus dominios personalizados. OneUptime encuentra la página, aplica las mismas reglas de acceso que encuentra un visitante y responde con JSON.

```mermaid title="Cómo se responde una solicitud a la API de una página de estado"
flowchart TB
    R["Solicitud con el ID o el dominio<br/>de una página de estado"] --> F{"¿ID bien formado<br/>o dominio verificado?"}
    F -->|"No"| E404["404: Status Page not found"]
    F -->|"Sí"| A{"¿Página archivada?"}
    A -->|"Sí"| E404
    A -->|"No"| IP{"¿La lista de IP permitidas<br/>deja pasar al cliente?"}
    IP -->|"No"| E403["403: dirección IP bloqueada"]
    IP -->|"Sí"| P{"¿La página es pública?"}
    P -->|"Sí"| OK["200 con JSON"]
    P -->|"No"| S{"¿Con sesión iniciada, o desbloqueada<br/>con la contraseña?"}
    S -->|"Sí"| OK
    S -->|"No"| E401["401: no autenticado"]
```

Una página privada solo responde a un navegador que ha iniciado sesión en ella o que la ha desbloqueado con su contraseña: la API lee la misma sesión que la página. Para un script, usa una página pública. Consulta [Restringir quién puede ver la página](/docs/status-pages/index#restringir-quién-puede-ver-la-página).

Un ID bien formado que no pertenece a ninguna página de estado sigue el mismo camino que una página privada, y recibe `401`. Si una página pública responde `401`, revisa el ID.

## Antes de empezar

- **El ID de la página de estado.** Abre la página en el panel (**Páginas de estado → Todas las páginas de estado** y después la página). La tarjeta **Detalles de la página de estado** de su **Vista general** muestra el **ID de la página de estado**.
- **La URL base.** Todos los endpoints de abajo están bajo `/status-page-api`:

| Dónde se ejecuta la página | URL base |
| ------------------- | -------- |
| OneUptime Cloud | `https://oneuptime.com/status-page-api` |
| OneUptime autoalojado | `https://<your-oneuptime-host>/status-page-api` |
| Un dominio personalizado de la página | `https://status.example.com/status-page-api` |

Donde una ruta de abajo diga `{statusPageIdOrDomain}`, puedes enviar el ID de la página o uno de sus dominios personalizados verificados, como `status.example.com`. El endpoint de disponibilidad solo acepta el ID.

## Endpoints

| Endpoint | Métodos | Devuelve |
| -------- | ------- | ------- |
| `/overview/{statusPageIdOrDomain}` | `GET`, `POST` | Todo lo que muestra la vista general: el estado global, los recursos y grupos, los incidentes y episodios activos, el mantenimiento programado, los anuncios en curso y los datos de las barras de disponibilidad. |
| `/uptime/{statusPageId}` | `POST` | Los porcentajes de disponibilidad por recurso y por grupo, para un intervalo de fechas. |
| `/incidents/{statusPageIdOrDomain}` | `GET`, `POST` | Los incidentes que lista la página, con sus notas públicas y cambios de estado. |
| `/incidents/{statusPageIdOrDomain}/{incidentId}` | `POST` | Un incidente. |
| `/episodes/{statusPageIdOrDomain}` | `POST` | Los episodios de incidentes que lista la página. |
| `/episodes/{statusPageIdOrDomain}/{episodeId}` | `POST` | Un episodio. |
| `/scheduled-maintenance-events/{statusPageIdOrDomain}` | `GET`, `POST` | Los eventos de mantenimiento programado que lista la página, con sus notas públicas y cambios de estado. |
| `/scheduled-maintenance-events/{statusPageIdOrDomain}/{scheduledMaintenanceId}` | `POST` | Un evento de mantenimiento programado. |
| `/announcements/{statusPageIdOrDomain}` | `GET`, `POST` | Los anuncios que lista la página. |
| `/announcements/{statusPageIdOrDomain}/{announcementId}` | `POST` | Un anuncio. |

Los endpoints siguen los propios ajustes de la página, en la tarjeta **Lo que muestra tu página de estado** (consulta [Elegir qué se muestra en la página](/docs/status-pages/index#elegir-qué-se-muestra-en-la-página)):

- Una lista desactivada rechaza su endpoint, por ejemplo con `Incidents are not enabled on this status page.`
- Cada lista llega hasta donde indica su ajuste **Mostrar … días de historial** (14 de forma predeterminada). La lista de incidentes incluye además cada incidente que aún no está resuelto, y la de mantenimiento programado cada evento que está por llegar o en curso.
- Por su ID, un incidente, episodio, evento o anuncio se devuelve sea cual sea su antigüedad, así que un enlace a uno más antiguo sigue funcionando. Uno que la página no muestra en absoluto, como un incidente en un monitor que no está en la página, vuelve como una lista vacía, y un episodio como `404`.

**Qué incidentes devuelve una página.** El endpoint de incidentes devuelve los incidentes de los monitores de la página, menos los limitados a otras páginas de estado, y menos cada incidente no limitado a esta página si la página solo muestra los incidentes limitados a ella (consulta [Una página de estado por audiencia](/docs/status-pages/one-status-page-per-audience)). A qué páginas está limitado un incidente nunca forma parte de la respuesta.

## Leer la vista general

La vista general es una sola solicitud para toda la página. Son los mismos datos que dibuja la página de estado, y tienen como mucho 15 segundos de antigüedad.

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

El estado global es el peor estado actual de los monitores y grupos de monitores de la página, el que tiene la prioridad más alta. Un estado de monitor tiene este aspecto:

```json
{
  "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
  "name": "Operational",
  "color": { "_type": "Color", "value": "#2ab57d" },
  "isOperationalState": true,
  "priority": 1
}
```

### Qué devuelve la vista general

| Clave | Qué contiene |
| --- | ------------- |
| `overallStatus` | El estado global de la página, un estado de monitor como el de arriba, o `null` cuando la página no tiene nada. |
| `statusPage` | Los ajustes públicos de la página: su título, descripción, marca y lo que muestra. |
| `statusPageResources` | Cada recurso: su nombre visible, descripción, grupo, monitor o grupo de monitores, y opciones de visualización. |
| `resourceGroups` | Los grupos, con `parentStatusPageGroupId` para los grupos anidados. |
| `monitorStatuses` | Cada estado de monitor del proyecto, de la prioridad más baja a la más alta. |
| `monitorGroupCurrentStatuses`, `monitorsInGroup` | El estado actual de cada grupo de monitores de la página y los monitores que contiene. |
| `monitorStatusTimelines`, `uptimeDailyAggregate`, `monitorGroupMergedDowntime`, `statusPageHistoryChartBarColorRules` | A partir de qué se dibujan las barras de disponibilidad, y las reglas de color de las barras de la página. |
| `activeIncidents`, `incidentPublicNotes`, `incidentStateTimelines`, `incidentStates` | Los incidentes sin resolver que muestra la página, sus notas públicas y cambios de estado, y los estados de incidente del proyecto. |
| `timelineIncidents` | Los incidentes dentro de la ventana de las barras de disponibilidad, incluidos los resueltos, para las descripciones emergentes de las barras. |
| `activeEpisodes`, `episodePublicNotes`, `episodeStateTimelines` | Lo mismo para los episodios de incidentes. |
| `scheduledMaintenanceEvents`, `scheduledMaintenanceEventsPublicNotes`, `scheduledMaintenanceStateTimelines`, `scheduledMaintenanceStates` | Los eventos de mantenimiento programado que están por llegar o en curso, sus notas públicas y cambios de estado. |
| `activeAnnouncements` | Los anuncios que se muestran ahora: empezados y sin terminar. |

## Disponibilidad en un intervalo de fechas

`POST /uptime/{statusPageId}` devuelve la disponibilidad de cada recurso y grupo de la página entre dos fechas. Ambas fechas son opcionales:

| Campo | Predeterminado | Notas |
| ----- | ------- | ----- |
| `startDate` | Hace 14 días | Una fecha y hora ISO 8601. |
| `endDate` | Ahora | No puede ser anterior a `startDate`. El intervalo puede abarcar como máximo 90 días. |

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

La respuesta:

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

| Clave | Qué contiene |
| --- | ------------- |
| `statusPageResourceUptimes` | Los recursos que no están en ningún grupo, los que los visitantes ven arriba de la página. |
| `groupUptimes` | Una entrada por grupo. `uptimePercent` y `currentStatus` de un grupo cubren cada recurso por debajo de él, incluidos los grupos anidados; su `statusPageResourceUptimes` solo lista los recursos que están directamente en él. Reconstruye el árbol con `parentStatusPageGroupId`. |
| `uptimePercent` | Redondeado a la precisión propia del recurso o del grupo. `null` cuando el recurso o el grupo no muestra un porcentaje de disponibilidad. |
| `currentStatus` | `null` cuando el recurso o el grupo no muestra su estado actual. |

El tiempo cuenta como inactividad cuando su estado de monitor es uno de los estados de **Cuenta como tiempo de inactividad** de la página.

## Incidentes, episodios, mantenimiento y anuncios

Los endpoints de lista responden a `GET` además de a `POST`; los de un solo elemento y los de episodios responden a `POST`.

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

| Endpoint | Claves de la respuesta |
| -------- | -------------------- |
| Incidentes | `incidents`, `incidentPublicNotes`, `incidentStateTimelines`, `incidentStates`, `statusPageResources`, `monitorsInGroup` |
| Episodios | `episodes`, `episodePublicNotes`, `episodeStateTimelines`, `incidentStates`, `statusPageResources`, `monitorsInGroup` |
| Eventos de mantenimiento programado | `scheduledMaintenanceEvents`, `scheduledMaintenanceEventsPublicNotes`, `scheduledMaintenanceStateTimelines`, `scheduledMaintenanceStates`, `statusPageResources`, `monitorsInGroup` |
| Anuncios | `announcements`, `statusPageResources`, `monitorsInGroup` |

Una solicitud de un solo elemento responde con las mismas claves, que contienen ese único registro.

## Errores

Un error responde con un código de estado y un cuerpo JSON que explica el motivo:

```json
{ "error": "You can only get uptime for 90 days. Please select a date range within 90 days." }
```

| Estado | Cuándo |
| ------ | ---- |
| `400` | La solicitud pide algo que la página no muestra, como una lista desactivada, o el intervalo de disponibilidad supera los 90 días o termina antes de empezar. |
| `401` | La página es privada y la solicitud no tiene sesión iniciada ni contraseña para ella. Un ID bien formado que no pertenece a ninguna página de estado también recibe `401`. |
| `403` | La lista de IP permitidas de la página no incluye la dirección del cliente. |
| `404` | El ID no está bien formado, ningún dominio personalizado verificado coincide, o la página está archivada. Un episodio que la página no muestra también recibe `404`. |

## Otras formas de leer una página de estado

- **RSS.** Cada página de estado sirve `/rss`, un feed de sus incidentes, anuncios y eventos de mantenimiento programado. Consulta [La insignia incrustable y el feed RSS](/docs/status-pages/index#la-insignia-incrustable-y-el-feed-rss).
- **llms.txt.** Junto a `/rss`, cada página de estado sirve `/llms.txt`, que dirige a los agentes de IA al feed RSS y al JSON de la vista general.
- **MCP.** Los agentes de IA pueden leer la página a través del servidor MCP de OneUptime en `https://oneuptime.com/mcp`, sin clave de API, pasando el ID o el dominio de la página como `statusPageIdOrDomain`. Está activado de forma predeterminada; desactívalo con **Habilitar servidor MCP** en **IA → MCP**, en el menú lateral de la página. Consulta [Servidor MCP](/docs/ai/mcp-server).
- **La API REST.** Para crear o cambiar páginas de estado, recursos, suscriptores y anuncios, usa la [API de OneUptime](/docs/api-reference/api-reference) con una clave de API.

## Próximos pasos

:::cards
- [Visión general de las páginas de estado](/docs/status-pages/index): Qué muestra una página de estado y quién puede verla.
- [Recursos y grupos de la página de estado](/docs/status-pages/resources-and-groups): Los recursos y grupos que devuelven estos endpoints.
- [Una página de estado por audiencia](/docs/status-pages/one-status-page-per-audience): Por qué una página lista un incidente que otra no lista.
- [Marca y dominios de la página de estado](/docs/status-pages/branding-and-domains): Sirve la página, y estos endpoints, en tu propio dominio.
:::
