# Integración con Prometheus Alertmanager

Convierte las notificaciones de [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) en incidentes de OneUptime. Prometheus evalúa tus reglas de alertado, Alertmanager las enruta y OneUptime las registra y escala.

Esta integración es **entrante**, y hay dos formas de construirla:

| Enfoque                                                                                      | Úsalo cuando                                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Monitor de solicitudes entrantes](/docs/monitor/incoming-request-monitor)** (recomendado) | Quieres que las alertas se conviertan en incidentes con escalado de guardia, un incidente por alerta y resolución automática al recuperarse. Sin lógica que mantener. |
| **[Workflow](/docs/workflows/index) con un disparador Webhook**                              | Necesitas lógica de enrutado que OneUptime no hace de forma nativa: llamar a otros sistemas, remodelar cargas útiles, ramificación condicional.                       |

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime  ──►  Incident + on-call
```

## Prerrequisitos

- Una instalación de Prometheus + Alertmanager donde puedas editar `alertmanager.yml`.
- Alertmanager debe poder alcanzar tu instancia de OneUptime por HTTPS.
- Un proyecto de OneUptime donde puedas crear monitores (o workflows).

## Opción 1 — Monitor de solicitudes entrantes

### Paso 1 — Crear el monitor

1. Ve a **Monitores → Crear monitor** y elige **Solicitud entrante**.
2. Abre el monitor y haz clic en **Documentation** en el menú izquierdo. Copia la URL:

   ```
   https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
   ```

   Usa tu propio host si es autoalojado. La clave secreta de la ruta es la única credencial.

### Paso 2 — Apuntar Alertmanager hacia él

En `alertmanager.yml`:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
```

`send_resolved: true` es obligatorio: es lo que le dice a OneUptime que una alerta se ha recuperado. Recarga Alertmanager con `curl -X POST http://localhost:9093/-/reload`, o reinícialo.

Alertmanager envía `Content-Type: application/json`, que es lo que OneUptime necesita para leer campos dentro de la carga útil.

### Paso 3 — Configurar los criterios

Abre los **Criteria** del monitor y edita el primer criterio.

**Filtro**

- **Filter Type**: `JavaScript Expression`
- **Filter Condition**: `Evaluates To True`
- **Value**: `"{{requestBody.status}}" === "firing"`

  Las comillas alrededor del marcador son necesarias para una comparación de cadenas. Un filtro `Request Body` / `Contains` / `"status":"firing"` también funciona si prefieres no usar una expresión.

**Acciones**

- Activa _When filters match, change monitor status_ y ponlo en **Offline** (o Degraded).
- Activa _When filters match, declare an incident_. Define el **Title**, la **Severity** y las **On-Call Policies** a las que avisar.
- En **Advanced Options** de ese incidente, activa **Auto Resolve Incident**. Sin esto, las notificaciones de recuperación se ignoran y los incidentes quedan abiertos para siempre.

**Settings → Group incidents and alerts by a payload field**

Actívalo para que un mismo endpoint pueda sostener varios incidentes simultáneos —uno por alerta— en lugar de un solo incidente por notificación.

| Campo                              | Valor                               |
| ---------------------------------- | ----------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
| Field that signals recovery        | `requestBody.alerts[*].status`      |
| Value that means recovered         | `resolved`                          |
| Max incidents per request          | `100`                               |

`[*]` se despliega sobre el array `alerts` de Alertmanager y abre un incidente por cada valor extraído **distinto**. Como ambas rutas usan `[*]`, la recuperación se juzga por alerta: en una carga útil donde una alerta se resolvió y dos siguen activas, solo se cierra la resuelta.

> **Warning:** Agrupa por algo genuinamente único por alerta. El `fingerprint` de Alertmanager es un hash del conjunto completo de etiquetas de la alerta, así que siempre lo es. Una etiqueta sirve solo si varía **dentro** de una notificación, y cualquier etiqueta que figure en el `group_by` de tu ruta nunca varía, porque es justo lo que define el grupo de agregación. Con el `group_by: ["alertname", "instance"]` de arriba, agrupar por `requestBody.alerts[*].labels.alertname` extrae el mismo valor de todas las alertas de la carga útil, así que todas se funden en un solo incidente. Peor aún: de los valores duplicados solo se conserva la **primera** aparición, así que una carga útil cuya primera alerta sea `resolved` cierra ese incidente mientras el resto siguen activas.

### Paso 4 — Escribir el título y la descripción del incidente

La clave de agrupamiento está disponible como una variable con el nombre del último segmento de la ruta, así que `requestBody.alerts[*].fingerprint` te da `{{fingerprint}}`. Eso es un hash, no algo que mostrar a quien responde: titula el incidente con las etiquetas compartidas por toda la notificación. `commonLabels` lleva todas las etiquetas del `group_by` de tu ruta, así que con la configuración de arriba `alertname` e `instance` están disponibles:

- **Title**: `{{requestBody.commonLabels.alertname}} on {{requestBody.commonLabels.instance}}`
- **Description**:

  ```
  {{requestBody.commonAnnotations.summary}}

  {{requestBody.commonAnnotations.description}}
  Severity: {{requestBody.commonLabels.severity}}
  Alertmanager: {{requestBody.externalURL}}
  ```

`commonLabels` y `commonAnnotations` contienen los campos compartidos por toda la notificación. Una ruta por alerta como `requestBody.alerts[0].annotations.summary` siempre lee la _primera_ alerta de la carga útil, no aquella para la que se abrió este incidente en concreto, así que mantén `group_by` ajustado si quieres que cada incidente lleve su propio texto de anotación. Una ruta que no se resuelve se imprime literalmente, con llaves incluidas, en lugar de quedar en blanco. Consulta [Plantillas dinámicas de incidentes y alertas](/docs/monitor/incident-alert-templating) para la lista completa de variables.

### Paso 5 — Devolver el monitor a Operational (opcional)

Los criterios solo actúan cuando coinciden, así que añade un segundo criterio para que el monitor no se quede en Offline cuando todo se haya calmado:

- **Filter Type**: `JavaScript Expression`, **Value**: `"{{requestBody.status}}" === "resolved"`
- _Change monitor status to_ **Operational**, y no declares ningún incidente.

### Paso 6 — Probarlo

```bash
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{
    "version": "4",
    "status": "firing",
    "commonLabels": { "alertname": "HighCPU", "severity": "critical" },
    "commonAnnotations": { "summary": "CPU above 90% for 5m" },
    "externalURL": "http://alertmanager:9093",
    "alerts": [
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-1" },
        "fingerprint": "a1b2c3d4e5f60001"
      },
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-2" },
        "fingerprint": "a1b2c3d4e5f60002"
      }
    ]
  }'
```

Deberías obtener dos incidentes, uno por `fingerprint`. Vuelve a enviarlo con el `status` de ambas alertas en `resolved` y ambos deberían cerrarse.

También puedes lanzar una alerta real con `amtool`:

```bash
amtool alert add test_alert severity=warning \
  --annotation=summary="Test from Alertmanager" \
  --alertmanager.url=http://localhost:9093
```

## Opción 2 — Workflow

Usa esto cuando necesites lógica más allá de "una alerta se convierte en un incidente".

1. Abre **Flujos de trabajo → Crear flujo de trabajo**, nómbralo `Alertmanager → Incidents` y abre el **Constructor**.
2. Añade un disparador **Webhook** y **copia su URL**. Renombra el bloque como `Alertmanager`.
3. Añade un bloque **Condiciones** conectado al disparador:
   - **Izquierda**: `{{Alertmanager.Request Body.status}}`
   - **Operador**: `==`
   - **Derecha**: `firing`
4. Desde **Sí**, añade un bloque **Crear incidente**:
   - **Título**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Descripción**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Gravedad**: elige una (o ramifica sobre `{{Alertmanager.Request Body.commonLabels.severity}}` primero).
5. **Guarda**, y luego apunta la URL de `webhook_configs` del Paso 2 de arriba a la URL del workflow en su lugar.

Para un incidente por alerta, añade un bloque [Custom Code](/docs/workflows/components#custom-code) que itere sobre `Request Body.alerts`. Con `send_resolved: true`, añade una segunda rama de **Condiciones** sobre `status == resolved` que busque el incidente correspondiente y lo mueva a tu estado resuelto con **Update Incident**.

## Interruptor de hombre muerto

Ninguna de las dos opciones te avisa cuando el propio Prometheus deja de funcionar: que no lleguen alertas se parece exactamente a que no pase nada malo. La respuesta habitual es una alerta permanentemente activa enrutada a un monitor que la espera según una programación. [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) incluye una llamada `Watchdog`; en un Prometheus básico, añade una regla de alertado con una expresión siempre verdadera (`vector(1)`).

Crea un **segundo** monitor de solicitudes entrantes, enruta `Watchdog` hacia él con un `repeat_interval` corto y dale a ese monitor un criterio **Filter Type: Incoming Request** / **Filter Condition: Not Recieved In Minutes**. Ese es el único caso en el que un criterio de solicitud ausente tiene sentido en un receptor de alertas.

Esta es la configuración del Paso 2 con la ruta y el receptor del watchdog integrados: una subruta se evalúa antes que el receptor propio de la ruta padre, así que `Watchdog` va al segundo monitor y todo lo demás sigue yendo al primero:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

  - name: oneuptime-watchdog
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/WATCHDOG_SECRET_KEY"

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - receiver: oneuptime-watchdog
      matchers:
        - alertname = "Watchdog"
      group_wait: 0s
      group_interval: 5m
      repeat_interval: 5m
```

## Solución de problemas

- **No llega nada** — confirma que Alertmanager puede alcanzar la URL; revisa sus registros por errores de entrega. OneUptime responde a cada solicitud con un `200` vacío antes de validar nada, así que un `200` no confirma que la carga útil se haya aceptado. Consulta la línea de tiempo del monitor en su lugar.
- **Los incidentes se abren pero nunca se cierran** — revisa `send_resolved: true` en Alertmanager, el campo y el valor de recuperación en el criterio (la comparación distingue mayúsculas de minúsculas) y **Auto Resolve Incident** en las **Advanced Options** del incidente. Dos causas más sutiles: una carga útil con más claves distintas que **Max incidents per request** también oculta a la recuperación las que quedan más allá del límite; y si la notificación `resolved` es justo la que descarta la unificación en la ingesta (más abajo), el incidente queda varado para siempre, porque Alertmanager repite las notificaciones de activación pero no las de resolución. Cierra esas a mano.
- **Ningún incidente en absoluto, y el estado del monitor sin cambios** — la ruta de agrupamiento debe empezar por el literal `requestBody.`, y solo el primer `[*]` de una ruta es un comodín. Ambos errores fallan en silencio.
- **El texto del incidente muestra marcadores `{{...}}` en crudo** — la ruta no se resolvió, y OneUptime deja los marcadores sin resolver en su sitio en vez de vaciarlos. Distintas reglas definen distintas anotaciones, así que referencia campos que existan de verdad para tus reglas (`commonAnnotations` frente a las `annotations` de cada alerta).
- **Un solo incidente para una carga útil llena de alertas** — agrupaste por una etiqueta que no varía dentro de una notificación, lo más habitual una que también está en el `group_by` de tu ruta. Agrupa por `requestBody.alerts[*].fingerprint` en su lugar.
- **Demasiados incidentes** — amplía `group_by` / `group_interval` para que Alertmanager agrupe alertas relacionadas. Bajar **Max incidents per request** las limita, pero también oculta a la recuperación las claves que quedan más allá del límite.
- **Algunas notificaciones parecen omitirse en ráfagas intensas** — las solicitudes al mismo monitor se unifican en la ingesta para que un solo emisor no pueda saturarlo, lo que puede descartar una carga útil intermedia cuando las notificaciones llegan seguidas. Aumentar `group_wait` y `group_interval` las separa. La unificación se controla con la variable de entorno `INCOMING_REQUEST_INGEST_COALESCE_ENABLED` del contenedor de la app, activada por defecto; quienes autoalojan y necesitan que se evalúe cada carga útil pueden ponerla en `false` en ese contenedor.

## Dónde seguir leyendo

- [Monitor de solicitudes entrantes](/docs/monitor/incoming-request-monitor) — el tipo de monitor, sus criterios y el agrupamiento de incidentes al completo.
- [Descripción general de integraciones](/docs/integrations/index) — los patrones entrante y saliente.
- [Grafana](/docs/integrations/grafana) — la misma idea, con el alertado de Grafana.
- [Disparador Webhook](/docs/workflows/triggers#webhook) — cómo funciona la URL receptora del workflow.
