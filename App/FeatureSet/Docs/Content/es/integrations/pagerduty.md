# Integración con PagerDuty

Activa un incidente de [PagerDuty](https://www.pagerduty.com) cada vez que se crea un incidente en OneUptime, y resuélvelo cuando OneUptime lo resuelva. Útil cuando PagerDuty gestiona tus escalaciones y turnos de guardia y quieres que la monitorización de OneUptime lo alimente.

Esta integración es **saliente**: OneUptime llama a la [Events API v2](https://developer.pagerduty.com/docs/events-api-v2/overview/) de PagerDuty. Usa un **[Workflow](/docs/workflows/index)** de OneUptime con un disparador **Incident → On Create** y un **componente API**.

> OneUptime tiene su propia guardia y escalación integradas — consulta [On Call](/docs/on-call/incoming-call-policy). Usa esta integración solo si específicamente quieres que los eventos lleguen también a PagerDuty.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/enqueue)  ──►  PagerDuty incident
```

## Prerrequisitos

- Un servicio de PagerDuty con una integración **Events API v2**. En PagerDuty: **Service → Integrations → Add integration → Events API v2**. Copia la **Integration Key** (también llamada *routing key*).
- Un proyecto de OneUptime donde puedas crear workflows.

## Paso 1 — Guardar la routing key

1. Ve a **Workflows → Global Variables → Create**.
2. Nómbrala `PAGERDUTY_ROUTING_KEY`, pega la clave de integración y activa **Is Secret**.

## Paso 2 — Construir el workflow de "activación"

1. Abre **Workflows → Create Workflow**, nómbralo `Incidents → PagerDuty` y abre el **Builder**.
2. Añade un disparador **Incident** configurado en **On Create**. Renómbralo `Incident`.
3. Añade un bloque **API** conectado al disparador:
   - **Method**: `POST`
   - **URL**: `https://events.pagerduty.com/v2/enqueue`
   - **Headers**: `Content-Type: application/json`
   - **Body**:

     ```json
     {
       "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
       "event_action": "trigger",
       "dedup_key": "oneuptime-{{Incident._id}}",
       "payload": {
         "summary": "{{Incident.title}}",
         "source": "OneUptime",
         "severity": "critical",
         "custom_details": {
           "description": "{{Incident.description}}"
         }
       }
     }
     ```

   El **`dedup_key`** vincula este incidente de PagerDuty al incidente de OneUptime para poder resolverlo más adelante. Usar el ID del incidente de OneUptime lo mantiene único y predecible.
4. **Guarda**, habilita y crea un incidente de prueba. Una respuesta `202` en los registros del workflow significa que PagerDuty aceptó el evento.

## Paso 3 — Resolver al resolver en OneUptime (recomendado)

1. ¿Añadir un segundo disparador **Incident** en el **mismo** workflow? No — un workflow tiene un solo disparador. En su lugar, crea un **segundo** workflow llamado `Resolve PagerDuty` con un disparador **Incident → On Update**.
2. Añade un bloque **Conditions** para comprobar que el incidente ya está resuelto (ramifica sobre el estado del incidente `{{Incident.currentIncidentState.name}}` igual al nombre de tu estado resuelto).
3. Desde **Yes**, añade un bloque **API** a PagerDuty con el **mismo `dedup_key`** y `event_action` configurado en `resolve`:

   ```json
   {
     "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
     "event_action": "resolve",
     "dedup_key": "oneuptime-{{Incident._id}}"
   }
   ```

PagerDuty hace coincidir el `dedup_key` y cierra el incidente original.

## Mapeo de gravedades (opcional)

El campo `severity` de PagerDuty acepta `critical`, `error`, `warning` o `info`. Para mapear desde las gravedades de OneUptime, añade ramas **Conditions** sobre `{{Incident.incidentSeverity.name}}` antes del bloque API y envía un cuerpo diferente desde cada una.

## Entrante (opcional)

Para hacer lo contrario — abrir un incidente de OneUptime desde un evento de PagerDuty — añade un workflow con disparador **Webhook** y apunta un [webhook V3](https://developer.pagerduty.com/docs/webhooks/v3-overview/) de PagerDuty (o una Events Orchestration) a su URL, luego usa **Create Incident**. Consulta el [patrón entrante](/docs/integrations/index#inbound-another-tool-sends-data-into-oneuptime).

## Solución de problemas

- **`400` con `"invalid routing key"`** — la integración debe ser **Events API v2**, no la Events API v1 anterior ni otro tipo de integración. Vuelve a copiar la clave.
- **El resolve no cierra nada** — el `dedup_key` en la llamada de resolución debe coincidir exactamente con el de la llamada de activación.
- **Nada en los registros** — confirma que el workflow está **Enabled** y que el disparador es **On Create**.

## Dónde seguir leyendo

- [Resumen de Integraciones](/docs/integrations/index) — patrones y la guía de autenticación.
- [On Call](/docs/on-call/incoming-call-policy) — la escalación integrada de OneUptime.
- [Opsgenie](/docs/integrations/opsgenie) — la misma idea para Opsgenie.
