# Integración con Datadog

Convierte las alertas de monitores de [Datadog](https://www.datadoghq.com) en incidentes de OneUptime, para que la detección de Datadog alimente la respuesta a incidentes y las páginas de estado de OneUptime.

Esta integración es **entrante**: la [integración Webhooks](https://docs.datadoghq.com/integrations/webhooks/) de Datadog publica en un **[Workflow](/docs/workflows/index)** de OneUptime que comienza con un **disparador Webhook**.

```text
Datadog monitor alerts  ──►  Webhook integration  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Prerrequisitos

- Una cuenta de Datadog donde puedas configurar integraciones y monitores.
- Un proyecto de OneUptime donde puedas crear workflows.

## Paso 1 — Construir el workflow de OneUptime

1. Abre **Workflows → Create Workflow**, nómbralo `Datadog → Incidents` y abre el **Builder**.
2. Añade un disparador **Webhook** y **copia su URL**. Renombra el bloque como `Datadog`.
3. Añade un bloque **Conditions** conectado al disparador:
   - **Izquierda**: `{{Datadog.Request Body.transition}}`
   - **Operador**: `==`
   - **Derecha**: `Triggered`
4. Desde **Yes**, añade un bloque **Create Incident**:
   - **Title**: `{{Datadog.Request Body.title}}`
   - **Description**: `{{Datadog.Request Body.body}}\nHost: {{Datadog.Request Body.host}}\n{{Datadog.Request Body.link}}`
   - **Severity**: elige una.
5. **Guarda** (deja deshabilitado hasta probar).

## Paso 2 — Crear el webhook de Datadog

1. En Datadog, ve a **Integrations → Webhooks** (instala la integración **Webhooks** si aún no lo has hecho).
2. **Añade un webhook**:

   - **Name**: `oneuptime` (esto lo convierte en `@webhook-oneuptime`).
   - **URL**: la URL del webhook de tu workflow.
   - **Payload** — Datadog te permite definir el cuerpo JSON usando [variables de plantilla](https://docs.datadoghq.com/integrations/webhooks/#usage):

     ```json
     {
       "title": "$EVENT_TITLE",
       "body": "$TEXT_ONLY_MSG",
       "alert_type": "$ALERT_TYPE",
       "transition": "$ALERT_TRANSITION",
       "id": "$ALERT_ID",
       "host": "$HOSTNAME",
       "link": "$LINK",
       "priority": "$PRIORITY"
     }
     ```

3. Guarda el webhook.

## Paso 3 — Enviar las alertas de un monitor al webhook

Añade el identificador del webhook a los monitores que quieras reenviar. En el **mensaje de notificación** de cada monitor, incluye:

```text
{{#is_alert}}@webhook-oneuptime{{/is_alert}}
{{#is_recovery}}@webhook-oneuptime{{/is_recovery}}
```

Esto envía tanto la alerta como la recuperación a OneUptime. (Para reenviar todo, también puedes añadir `@webhook-oneuptime` a un monitor de forma incondicional.)

## Paso 4 — Probarlo

1. Habilita el workflow.
2. Desde un monitor, usa **Test Notifications → Alert**, o deja que un monitor real se active.
3. Comprueba la pestaña **Logs** del workflow y tu lista de **Incidents**.

## Resolver al recuperarse (opcional)

`$ALERT_TRANSITION` es `Recovered` cuando un monitor se despeja. Añade una segunda rama **Conditions** (`transition == Recovered`), encuentra el incidente correspondiente (haz coincidir el `id` que enviaste) y muévelo a tu estado resuelto con **Update Incident**.

## Solución de problemas

- **No aparece ninguna ejecución** — confirma que el mensaje del monitor incluye `@webhook-oneuptime` y que el workflow está **Enabled**.
- **Los campos están vacíos** — Datadog solo sustituye las variables de plantilla que aplican al evento. Inspecciona la salida del disparador en la pestaña **Logs** y ajusta la carga útil de tu webhook.
- **Incidentes duplicados** — un monitor que re-alerta (renotify) envía múltiples eventos `Triggered`; deduplica con una comprobación **Find Incident** sobre el `id` antes de crear.

## Dónde seguir leyendo

- [Resumen de Integraciones](/docs/integrations/index) — el patrón entrante.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) y [Grafana](/docs/integrations/grafana) — otras fuentes entrantes.
- [Disparador Webhook](/docs/workflows/triggers#webhook) — cómo funciona la URL receptora.
