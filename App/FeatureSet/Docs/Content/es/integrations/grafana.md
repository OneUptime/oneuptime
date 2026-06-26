# Integración con Grafana

Convierte las alertas de [Grafana](https://grafana.com) en incidentes de OneUptime. Grafana evalúa las reglas de alerta de tus paneles; OneUptime las registra, escala y hace seguimiento.

Esta integración es **entrante**: el sistema de alertas de Grafana publica en un **[Workflow](/docs/workflows/index)** de OneUptime que comienza con un **disparador Webhook**, usando un **punto de contacto Webhook** de Grafana.

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Prerrequisitos

- Grafana 9+ con [alertas unificadas](https://grafana.com/docs/grafana/latest/alerting/) habilitadas (el valor predeterminado en versiones modernas de Grafana).
- Grafana debe poder llegar a tu instancia de OneUptime por HTTPS.
- Un proyecto de OneUptime donde puedas crear workflows.

## Paso 1 — Construir el workflow de OneUptime

1. Abre **Workflows → Create Workflow**, nómbralo `Grafana → Incidents` y abre el **Builder**.
2. Añade un disparador **Webhook** y **copia su URL**. Renombra el bloque como `Grafana`.
3. Añade un bloque **Conditions** conectado al disparador:
   - **Izquierda**: `{{Grafana.Request Body.status}}`
   - **Operador**: `==`
   - **Derecha**: `firing`
4. Desde **Yes**, añade un bloque **Create Incident**:
   - **Title**: `{{Grafana.Request Body.title}}`
   - **Description**: `{{Grafana.Request Body.message}}`
   - **Severity**: elige una (o ramifica sobre `{{Grafana.Request Body.commonLabels.severity}}`).
5. **Guarda** (deja deshabilitado hasta probar).

La carga útil del webhook de Grafana sigue el formato de Alertmanager — incluye `status`, un array `alerts`, `commonLabels` y `commonAnnotations`, además de campos convenientes de nivel superior `title` y `message`.

## Paso 2 — Configurar el punto de contacto de Grafana

1. En Grafana, ve a **Alerting → Contact points → Add contact point**.
2. **Name**: `OneUptime`. **Integration**: **Webhook**.
3. **URL**: pega la URL del webhook de tu workflow. **HTTP Method**: `POST`.
4. Guarda el punto de contacto.
5. Ve a **Alerting → Notification policies** y enruta las alertas que quieras (o la política predeterminada) al punto de contacto **OneUptime**.

## Paso 3 — Probarlo

1. Habilita el workflow.
2. En la pantalla del punto de contacto, usa **Test** para enviar una notificación de muestra, o deja que dispare una regla de alerta real.
3. Comprueba la pestaña **Logs** del workflow y tu lista de **Incidents**.

## Resolver al recuperarse (opcional)

Cuando la alerta se despeja, Grafana envía otra notificación con `status: resolved`. Añade una segunda rama **Conditions** (`status == resolved`), encuentra el incidente correspondiente y muévelo a tu estado resuelto con **Update Incident**.

## Notas

- **Alertas heredadas (Grafana 8 y anteriores)** envían una carga útil diferente (`ruleName`, `state`, `evalMatches`). Si estás en alertas heredadas, referencia `{{Grafana.Request Body.ruleName}}` y `{{Grafana.Request Body.state}}` en su lugar, y ramifica sobre `state == alerting`.
- También puedes omitir el sistema de alertas de Grafana por completo y hacer que OneUptime monitorice directamente las mismas métricas — consulta el [Monitor de Métricas](/docs/monitor/metrics-monitor).

## Solución de problemas

- **No aparece ninguna ejecución** — confirma que Grafana puede llegar a la URL (comprueba los registros del servidor de Grafana) y que el workflow está **Enabled**.
- **Campos vacíos** — inspecciona la salida del disparador en la pestaña **Logs**; referencia los campos que existen para tu versión del sistema de alertas.

## Dónde seguir leyendo

- [Resumen de Integraciones](/docs/integrations/index) — el patrón entrante.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — carga útil estrechamente relacionada.
- [Monitor de Métricas](/docs/monitor/metrics-monitor) — monitoriza métricas en OneUptime directamente.
