# Integraciones

OneUptime se conecta con las herramientas que tu equipo ya utiliza —Zabbix, Jira, PagerDuty, Slack y muchas más— a través de **[Workflows](/docs/workflows/index)**, el motor de automatización integrado. No hay ningún plugin adicional que instalar. Conectas una integración en un lienzo de arrastrar y soltar, y se ejecuta cada vez que ocurre algo.

Esta página explica los dos patrones que usa cada integración. Una vez que los entiendas, podrás conectar OneUptime con casi cualquier cosa, incluso con herramientas que no tienen su propia página aquí.

## Los dos patrones

Cada integración mueve datos en una de dos direcciones (y muchas usan ambas).

### Entrante — otra herramienta envía datos a OneUptime

Úsalo cuando un sistema externo necesita *crear o actualizar algo en OneUptime* — normalmente abrir un incidente o una alerta cuando detecta un problema.

1. Construye un workflow que comience con un **[disparador Webhook](/docs/workflows/triggers#webhook)**. OneUptime te proporciona una URL única.
2. En la otra herramienta, configura una acción de webhook o notificación que haga un POST a esa URL cuando ocurra algo.
3. En el workflow, lee la carga útil entrante y usa un componente **Create Incident** (o Create Alert) para registrarla.

```text
Zabbix / Prometheus / Grafana / Datadog  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

### Saliente — OneUptime envía datos a otra herramienta

Úsalo cuando *algo en OneUptime deba aparecer en otra herramienta* — abrir un ticket en Jira, notificar a alguien en PagerDuty, publicar en Slack.

1. Construye un workflow que comience con un **[disparador de evento de OneUptime](/docs/workflows/triggers#oneuptime-event-triggers)** — por ejemplo **Incident → On Create**.
2. Añade un **[componente API](/docs/workflows/components#api)** que llame a la API REST de la otra herramienta con los detalles del incidente.
3. Guarda cualquier clave de API como **[variables globales](/docs/workflows/variables#global-variables)** secretas para que nunca aparezcan en el workflow ni en sus registros.

```text
OneUptime Incident → On Create  ──►  API component  ──►  Jira / PagerDuty / ServiceNow / GitHub
```

## Catálogo

| Herramienta | Dirección | Qué hace |
| --- | --- | --- |
| [Zabbix](/docs/integrations/zabbix) | Entrante | Convierte los problemas de Zabbix en incidentes de OneUptime (y los resuelve al recuperarse). |
| [Jira](/docs/integrations/jira) | Saliente (+ entrante) | Abre un issue de Jira por cada incidente; sincroniza el estado de vuelta. |
| [PagerDuty](/docs/integrations/pagerduty) | Saliente (+ entrante) | Activa y resuelve eventos de PagerDuty desde incidentes de OneUptime. |
| [Opsgenie](/docs/integrations/opsgenie) | Saliente (+ entrante) | Crea y cierra alertas de Opsgenie. |
| [ServiceNow](/docs/integrations/servicenow) | Saliente (+ entrante) | Abre incidentes de ServiceNow desde OneUptime. |
| [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) | Entrante | Convierte notificaciones de Alertmanager en incidentes. |
| [Grafana](/docs/integrations/grafana) | Entrante | Convierte alertas de Grafana en incidentes. |
| [Datadog](/docs/integrations/datadog) | Entrante | Convierte alertas de monitores de Datadog en incidentes. |
| [GitHub](/docs/integrations/github) | Saliente | Abre un issue de GitHub para un incidente. |
| [GitLab](/docs/integrations/gitlab) | Saliente | Abre un issue de GitLab para un incidente. |
| [Discord](/docs/integrations/discord) | Saliente | Publica actualizaciones de incidentes en un canal de Discord. |
| [Telegram](/docs/integrations/telegram) | Saliente | Envía actualizaciones de incidentes a un chat de Telegram. |
| [Slack](/docs/workspace-connections/slack) | Ambas | Conexión de espacio de trabajo nativa — canales, alertas y guardia. |
| [Microsoft Teams](/docs/workspace-connections/microsoft-teams) | Ambas | Conexión de espacio de trabajo nativa. |

> **Slack y Microsoft Teams** tienen una conexión nativa más profunda que va más allá de los workflows — canales de incidentes automáticos, acciones bidireccionales y notificaciones de guardia. Usa las conexiones de espacio de trabajo de [Slack](/docs/workspace-connections/slack) y [Microsoft Teams](/docs/workspace-connections/microsoft-teams) para eso, en lugar de crear un workflow.

## Gestión de secretos

Nunca pegues una clave de API o un token directamente en un bloque. En su lugar:

1. Ve a **Workflows → Global Variables**.
2. Crea una variable —por ejemplo `JIRA_AUTH`— y activa **Is Secret**.
3. Referenciarla en cualquier lugar con `{{variable.JIRA_AUTH}}`.

Las variables secretas se ocultan en la interfaz una vez guardadas y se eliminan de los registros de ejecución. Consulta [Variables](/docs/workflows/variables#global-variables).

## Guía de autenticación rápida

La mayoría de las integraciones salientes necesitan una cabecera `Authorization` en el bloque API. Las formas más comunes:

| Esquema | Valor de la cabecera | Usado por |
| --- | --- | --- |
| Token Bearer | `Bearer {{variable.TOKEN}}` | GitHub, muchas API modernas |
| Auth básica | `Basic {{variable.BASE64_USER_PASS}}` | Jira, ServiceNow |
| Cabecera de clave de API | `GenieKey {{variable.OPSGENIE_KEY}}` | Opsgenie |
| Token en el cuerpo | campo `routing_key` en el cuerpo JSON | Events API de PagerDuty |
| Cabecera de token privado | `PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}` | GitLab |

Para la autenticación básica, codifica en base64 `usuario:contraseña` (o `email:api_token`) **una sola vez** y guarda el resultado como secreto. En macOS/Linux:

```bash
printf '%s' 'you@example.com:your_api_token' | base64
```

## ¿No ves tu herramienta?

Casi cualquier herramienta encaja en uno de los dos patrones anteriores:

- Si la herramienta puede **enviar un webhook** cuando ocurre algo, usa el patrón **entrante** — apunta su webhook a un disparador Webhook de OneUptime.
- Si la herramienta tiene una **API REST**, usa el patrón **saliente** — llámala desde un **componente API**.
- Si necesitas transformar datos entre los dos, añade un bloque **[Custom Code](/docs/workflows/components#custom-code)**.

Eso cubre la larga cola — Zendesk, AWS CloudWatch (vía SNS), New Relic, Splunk, StatusCake, etc. La receta es la misma; solo cambian la URL y la carga útil.

## Dónde seguir leyendo

- [Resumen de Workflows](/docs/workflows/index) — cómo funciona el motor de automatización.
- [Disparadores](/docs/workflows/triggers) — disparadores Webhook y de eventos de OneUptime en detalle.
- [Componentes](/docs/workflows/components) — los componentes API, Webhook y de datos.
- [Variables](/docs/workflows/variables) — secretos y paso de datos entre bloques.
- [Zabbix](/docs/integrations/zabbix) y [Jira](/docs/integrations/jira) — ejemplos completos y detallados.
