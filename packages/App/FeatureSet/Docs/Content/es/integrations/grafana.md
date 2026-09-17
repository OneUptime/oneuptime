# Integración con Grafana

Convierte las alertas de [Grafana](https://grafana.com) en incidentes de OneUptime. Grafana evalúa las reglas de alerta de tus paneles; OneUptime las registra, escala y les da seguimiento.

Esta integración es **entrante**: un **punto de contacto Webhook** de Grafana envía por POST a OneUptime. Hay dos formas de recibirlo.

| Enfoque                                                                                      | Úsalo cuando                                                                                                                                    |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Monitor de solicitudes entrantes](/docs/monitor/incoming-request-monitor)** (recomendado) | Quieres que las alertas se conviertan en incidentes con escalado de guardia, un incidente por alerta y resolución automática al recuperarse.    |
| **[Workflow](/docs/workflows/index) con un disparador Webhook**                              | Necesitas lógica de enrutado que OneUptime no hace de forma nativa: llamar a otros sistemas, remodelar cargas útiles, ramificación condicional. |

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime  ──►  Incident + on-call
```

La carga útil del webhook de Grafana sigue el formato de Alertmanager — `status`, un array `alerts`, `commonLabels` y `commonAnnotations`, además de campos convenientes de nivel superior `title` y `message`.

## Prerrequisitos

- Grafana 9+ con [unified alerting](https://grafana.com/docs/grafana/latest/alerting/) habilitado (lo predeterminado en Grafana moderno).
- Grafana debe poder alcanzar tu instancia de OneUptime por HTTPS.
- Un proyecto de OneUptime donde puedas crear monitores (o workflows).

## Opción 1 — Monitor de solicitudes entrantes

1. Ve a **Monitores → Crear monitor** y elige **Solicitud entrante**. Ábrelo y haz clic en **Documentation** en el menú izquierdo para copiar la URL.
2. Abre los **Criteria** del monitor y pon **Filter Type** en `JavaScript Expression` y **Value** en `"{{requestBody.status}}" === "firing"`.
3. Declara un incidente al coincidir, elige las **On-Call Policies** a las que avisar y activa **Auto Resolve Incident** en **Advanced Options**.
4. En **Settings**, activa **Group incidents and alerts by a payload field** y define:

   | Campo                              | Valor                               |
   | ---------------------------------- | ----------------------------------- |
   | Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
   | Field that signals recovery        | `requestBody.alerts[*].status`      |
   | Value that means recovered         | `resolved`                          |

5. Titula el incidente con `{{requestBody.commonLabels.alertname}}` y descríbelo con `{{requestBody.message}}` o `{{requestBody.commonAnnotations.summary}}`. (`{{fingerprint}}` contiene la propia clave de agrupamiento, pero es un hash, no algo que mostrar a quien responde.)
6. Apunta el punto de contacto de Grafana a la URL del monitor (ver los pasos del punto de contacto más abajo).

Cada valor de agrupamiento **distinto** se convierte en su propio incidente, y cada uno se cierra cuando Grafana lo reporta como resuelto. El `fingerprint` por alerta de Grafana es único para el conjunto de etiquetas de una alerta, y por eso es la ruta de agrupamiento de arriba. La página de [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) recorre la misma configuración con más detalle: el formato de la carga útil es el mismo, así que todos sus pasos aplican aquí.

> **Warning:** No agrupes por una etiqueta que sea constante en toda una notificación. La política de notificación por defecto de Grafana agrupa por `grafana_folder` y `alertname`, así que todas las alertas de un webhook comparten alertname: agrupar por `requestBody.alerts[*].labels.alertname` fundiría toda la carga útil en un solo incidente. Las rutas de agrupamiento también deben empezar por el literal `requestBody.`, y solo el primer `[*]` de una ruta es un comodín. Todo esto falla en silencio.

## Opción 2 — Workflow

Usa esto cuando necesites lógica más allá de "una alerta se convierte en un incidente".

### Paso 1 — Construir el workflow de OneUptime

1. Abre **Flujos de trabajo → Crear flujo de trabajo**, nómbralo `Grafana → Incidents` y abre el **Constructor**.
2. Añade un disparador **Webhook** y **copia su URL**. Renombra el bloque como `Grafana`.
3. Añade un bloque **Condiciones** conectado al disparador:
   - **Izquierda**: `{{Grafana.Request Body.status}}`
   - **Operador**: `==`
   - **Derecha**: `firing`
4. Desde **Sí**, añade un bloque **Crear incidente**:
   - **Título**: `{{Grafana.Request Body.title}}`
   - **Descripción**: `{{Grafana.Request Body.message}}`
   - **Gravedad**: elige una (o ramifica sobre `{{Grafana.Request Body.commonLabels.severity}}`).
5. **Guarda** (deja deshabilitado hasta probar).

## Configurar el punto de contacto de Grafana

1. En Grafana, ve a **Alerting → Contact points → Add contact point**.
2. **Name**: `OneUptime`. **Integration**: **Webhook**.
3. **URL**: pega la URL del monitor de la Opción 1, o la URL del webhook del workflow de la Opción 2. **HTTP Method**: `POST`.
4. Guarda el punto de contacto.
5. Ve a **Alerting → Notification policies** y enruta las alertas que quieras (o la política por defecto) al punto de contacto **OneUptime**.

## Probarlo

1. Habilita el workflow, si construiste uno.
2. En la pantalla del punto de contacto, usa **Test** para enviar una notificación de ejemplo, o deja que se dispare una regla de alerta real.
3. Revisa tu lista de **Incidentes** — y la pestaña **Registros** del workflow si usaste la Opción 2.

## Resolver al recuperarse

Cuando la alerta se calma, Grafana envía otra notificación con `status: resolved`.

Con la **Opción 1**, el campo y el valor de recuperación configurados arriba cierran el incidente correspondiente de forma automática, siempre que **Auto Resolve Incident** esté activado.

Con la **Opción 2**, añade una segunda rama de **Condiciones** (`status == resolved`), busca el incidente correspondiente y muévelo a tu estado resuelto con **Update Incident**.

## Notas

- **El alertado heredado (Grafana 8 y anteriores)** envía una carga útil distinta (`ruleName`, `state`, `evalMatches`). Si usas alertado heredado, referencia `{{Grafana.Request Body.ruleName}}` y `{{Grafana.Request Body.state}}` en su lugar, y ramifica sobre `state == alerting`.
- También puedes saltarte por completo el alertado de Grafana y hacer que OneUptime monitorice las mismas métricas directamente — ver el [Monitor de métricas](/docs/monitor/metrics-monitor).

## Solución de problemas

- **No llega nada** — confirma que Grafana puede alcanzar la URL (revisa los registros del servidor de Grafana) y, para la Opción 2, que el workflow esté **Habilitado**. OneUptime responde a cada solicitud entrante con un `200` vacío antes de validarla, así que un `200` en los registros de Grafana no confirma que la carga útil se haya aceptado.
- **Los incidentes se abren pero nunca se cierran** — revisa el campo y el valor de recuperación en el criterio, y que **Auto Resolve Incident** esté activado en las **Advanced Options** del incidente. La comparación distingue mayúsculas de minúsculas.
- **Un solo incidente para una carga útil llena de alertas** — agrupaste por una etiqueta que no varía dentro de una notificación. Agrupa por `requestBody.alerts[*].fingerprint` en su lugar.
- **El texto del incidente muestra marcadores `{{...}}` en crudo** — la ruta no se resolvió, y los marcadores sin resolver se dejan en su sitio en vez de vaciarse. Referencia campos que existan para tu versión de alertado; inspecciona la salida del disparador en la pestaña **Registros** si usaste la Opción 2.

## Dónde seguir leyendo

- [Monitor de solicitudes entrantes](/docs/monitor/incoming-request-monitor) — el tipo de monitor, sus criterios y el agrupamiento de incidentes al completo.
- [Descripción general de integraciones](/docs/integrations/index) — el patrón entrante.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — carga útil muy relacionada.
- [Monitor de métricas](/docs/monitor/metrics-monitor) — monitoriza métricas directamente en OneUptime.
