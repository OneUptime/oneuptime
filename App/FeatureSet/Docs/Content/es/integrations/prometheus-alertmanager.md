# Integración con Prometheus Alertmanager

Convierte las notificaciones de [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) en incidentes de OneUptime. Prometheus evalúa tus reglas de alertas, Alertmanager las enruta y OneUptime las registra y escala.

Esta integración es **entrante**: Alertmanager hace un POST a un **[Workflow](/docs/workflows/index)** de OneUptime que comienza con un **disparador Webhook**.

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Prerrequisitos

- Una configuración de Prometheus + Alertmanager donde puedas editar `alertmanager.yml`.
- Alertmanager debe poder llegar a tu instancia de OneUptime por HTTPS.
- Un proyecto de OneUptime donde puedas crear workflows.

## Paso 1 — Construir el workflow de OneUptime

1. Abre **Workflows → Create Workflow**, nómbralo `Alertmanager → Incidents` y abre el **Builder**.
2. Añade un disparador **Webhook** y **copia su URL**. Renombra el bloque como `Alertmanager`.
3. Añade un bloque **Conditions** conectado al disparador:
   - **Izquierda**: `{{Alertmanager.Request Body.status}}`
   - **Operador**: `==`
   - **Derecha**: `firing`
4. Desde **Yes**, añade un bloque **Create Incident**:
   - **Title**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Description**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Severity**: elige una (o ramifica sobre `{{Alertmanager.Request Body.commonLabels.severity}}` primero).
5. **Guarda** (deja deshabilitado hasta probar).

> **Sobre las alertas agrupadas.** Alertmanager agrupa las alertas y envía un **array** `alerts`. Los campos `commonLabels` y `commonAnnotations` de arriba son los campos compartidos en todo el grupo — perfectos para un incidente por notificación. Si quieres **un incidente por alerta**, añade un bloque [Custom Code](/docs/workflows/components#custom-code) que itere sobre `Request Body.alerts` y cree un incidente para cada uno. Ajusta el agrupamiento con `group_by` en tu ruta.

## Paso 2 — Configurar Alertmanager

Añade un receptor webhook apuntando a la URL del workflow y enruta las alertas hacia él. En `alertmanager.yml`:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://<your-workflow-webhook-url>"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 3h
```

Recarga Alertmanager (`curl -X POST http://localhost:9093/-/reload` o reinícialo).

## Paso 3 — Probarlo

1. Habilita el workflow.
2. Dispara una alerta de prueba — por ejemplo, con `amtool`:

   ```bash
   amtool alert add test_alert severity=warning --annotation=summary="Test from Alertmanager" --alertmanager.url=http://localhost:9093
   ```

3. Comprueba la pestaña **Logs** del workflow y tu lista de **Incidents**.

## Resolver al recuperarse (opcional)

Con `send_resolved: true`, Alertmanager también hace un POST cuando una alerta se despeja, esta vez con `status: resolved`. Añade una segunda rama **Conditions** (`status == resolved`), encuentra el incidente correspondiente (haz coincidir `commonLabels.alertname`) y muévelo a tu estado resuelto con **Update Incident**.

## Solución de problemas

- **No aparece ninguna ejecución** — confirma que Alertmanager puede llegar a la URL (comprueba sus registros en busca de errores de entrega) y que el workflow está **Enabled**.
- **Los campos del incidente están vacíos** — distintas reglas establecen anotaciones diferentes. Inspecciona la salida del disparador en la pestaña **Logs** y referencia los campos que realmente existen (`commonAnnotations` frente a `annotations` por alerta).
- **Demasiados incidentes** — aumenta `group_by`/`group_interval` para que Alertmanager agrupe las alertas relacionadas.

## Dónde seguir leyendo

- [Resumen de Integraciones](/docs/integrations/index) — el patrón entrante.
- [Grafana](/docs/integrations/grafana) — la misma idea, alertas de Grafana.
- [Disparador Webhook](/docs/workflows/triggers#webhook) — cómo funciona la URL receptora.
