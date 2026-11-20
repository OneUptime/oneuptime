# Prometheus, Loki, Splunk, Datadog & Sentry

¿Ya usas Prometheus, un cliente de Loki, un reenviador de Splunk, el Datadog Agent o un SDK de Sentry? No hace falta cambiarlo. OneUptime acepta lo que envía cada una de estas herramientas, en las rutas que la herramienta ya usa, y lo guarda como datos de OpenTelemetry. Probar OneUptime es cuestión de cambiar una URL y una clave, no de volver a instrumentar, y tus filtros de descarte, reglas de depuración, canalizaciones de registros, retención y presupuestos de ingesta se aplican a estos datos como a cualquier otro.

:::cards
- [Prometheus remote write](#prometheus-remote-write): Métricas de Prometheus, Grafana Alloy o cualquier emisor de remote write.
- [Loki](#loki): Registros de Promtail, Grafana Alloy, Fluent Bit o Vector.
- [Splunk HTTP Event Collector](#splunk-http-event-collector): Registros y eventos de métricas de cualquier cliente HEC.
- [Datadog Agent](#datadog-agent): Métricas, registros y trazas de APM del Datadog Agent.
- [SDK de Sentry](#sdk-de-sentry): Errores, transacciones, registros, check-ins de cron, comentarios y perfiles de cualquier SDK de Sentry.
:::

## Cómo funciona

```mermaid title="De las herramientas que usas a OneUptime"
flowchart TB
    subgraph tools["Los agentes y SDK que ya usas"]
        direction LR
        prometheus["Prometheus"]
        loki["Clientes de Loki"]
        splunk["Clientes HEC de Splunk"]
        datadog["Datadog Agent"]
        sentry["SDK de Sentry"]
    end
    tools -->|"Su propio protocolo + tu clave de ingesta"| endpoint["Endpoints compatibles de OneUptime"]
    endpoint --> otlp["Guardado como datos de OpenTelemetry"]
    otlp --> signals["Registros, métricas, trazas, excepciones y perfiles"]
```

Cada endpoint responde en el idioma de su herramienta (un `204` para Prometheus y Loki, el `{"text": "Success", "code": 0}` de HEC, el `202` de Datadog, el ID de evento de Sentry), así que la herramienta informa de los éxitos y los fallos como siempre. Después, los datos se procesan exactamente igual que los de un SDK de OpenTelemetry.

## Antes de empezar

- **Un proyecto de OneUptime**: en OneUptime Cloud, la telemetría se factura por GB ingerido, y un proyecto del plan Free necesita un método de pago antes de poder enviar telemetría.
- **Clave de ingesta de telemetría**: crea una clave de **Servidor** en **Productos → Ajustes del proyecto → Telemetría y APM → Claves de ingesta** y copia su **Clave secreta**. Cada herramienta la envía donde envía su propia credencial. El DSN de Sentry de una aplicación de navegador lleva en cambio una clave de **Navegador**, limitada a los orígenes de tu sitio.
- **Tu host**: los ejemplos usan `oneuptime.com`. Si alojas OneUptime tú mismo, usa tu propio host.

> [!TIP]
> La pestaña Guía de configuración de Registros, Métricas, Trazas y Excepciones incluye estas herramientas entre sus formas de enviar, con tu host y la clave que elijas ya rellenados.

## Endpoints

| Herramienta | Apúntala a | Dónde va la clave |
| --- | --- | --- |
| Prometheus remote write | `https://oneuptime.com/telemetry/prometheus/api/v1/write` | Un token bearer, o autenticación básica con la clave como contraseña. |
| Loki | `https://oneuptime.com/telemetry/loki/api/v1/push` | Autenticación básica con la clave como contraseña, o un token bearer. |
| Splunk HTTP Event Collector | `https://oneuptime.com/telemetry/services/collector` | El token de HEC: `Authorization: Splunk <key>`. |
| Datadog Agent | `https://oneuptime.com/telemetry/datadog` | La clave de API: `DD-API-KEY`. |
| SDK de Sentry | El DSN `https://<key>@oneuptime.com/telemetry/sentry/1` | La clave pública del DSN. |

Todos los endpoints aceptan también la clave en una cabecera `x-oneuptime-token`, y una cabecera `x-oneuptime-service-name` indica el servicio al que pertenece todo lo que envía la herramienta. Una clave puede escribirse como sus 32 dígitos hexadecimales sin guiones; en el DSN de Sentry y como clave de API de Datadog tiene que escribirse así.

## Prometheus remote write

Añade OneUptime como destino de remote write. Prometheus sigue haciendo scrape como hasta ahora y envía una copia de cada muestra:

```yaml title="prometheus.yml"
remote_write:
  - url: https://oneuptime.com/telemetry/prometheus/api/v1/write
    authorization:
      credentials: YOUR_TELEMETRY_KEY
    send_exemplars: true
```

Con Grafana Alloy, añade un componente `prometheus.remote_write` y reenvíale tus scrapes:

```text title="config.alloy"
prometheus.remote_write "oneuptime" {
  endpoint {
    url          = "https://oneuptime.com/telemetry/prometheus/api/v1/write"
    bearer_token = "YOUR_TELEMETRY_KEY"
  }
}

prometheus.scrape "app" {
  targets    = [{"__address__" = "localhost:8080"}]
  forward_to = [prometheus.remote_write.oneuptime.receiver]
}
```

Se aceptan tanto remote write 1.0 como 2.0, comprimidos con snappy, como los envía cualquier emisor. Para enviar 2.0, que lleva el tipo, la unidad y la descripción de cada serie, configura `protobuf_message: io.prometheus.write.v2.Request` (Prometheus 3) o `protobuf_message = "io.prometheus.write.v2.Request"` (Alloy). Prometheus envía los exemplars con `send_exemplars: true` en cuanto los guarda (`--enable-feature=exemplar-storage`); Alloy los envía de forma predeterminada.

### En qué se convierte una serie

- **Su nombre y sus etiquetas se mantienen.** `http_requests_total{job="checkout", code="500"}` es la métrica `http_requests_total` con los atributos `job` y `code`, así que una consulta traída de Grafana la encuentra.
- **El job es el servicio.** Cada `job` se convierte en un servicio, y cada `instance`, en su instancia de servicio, tal como los asignan las reglas de Prometheus de OpenTelemetry.
- **Los tipos se conservan.** Los contadores, y los buckets y el recuento de un histograma, son sumas acumulativas, así que sus tasas se grafican correctamente. El tipo sale de los metadatos que incluye el emisor; sin ellos, un nombre terminado en `_total` es un contador, y un `_bucket` con una etiqueta `le`, un bucket de histograma.
- **Los histogramas clásicos grafican sus percentiles.** Un histograma clásico conserva sus series `_bucket`, `_count` y `_sum`. Grafica su métrica `_bucket` con P50 a P99 en el [Explorador de métricas](/docs/telemetry/metrics-explorer) y los buckets de cada scrape se leen como un solo histograma, sin importar en qué solicitud llegó cada bucket. En [PromQL](/docs/telemetry/promql), `histogram_quantile(0.95, sum by (le) (rate(<name>_bucket[5m])))` responde como en Prometheus.
- **Los histogramas nativos** se convierten en histogramas exponenciales, y los histogramas nativos con buckets personalizados, en histogramas.
- **Los exemplars enlazan con las trazas.** Un exemplar con una etiqueta `trace_id` (o `traceID`) vincula su punto de datos con esa traza y ese span: en el gráfico de la métrica, haz clic en su punto para ver la traza o sus registros. Su valor y sus otras etiquetas no se conservan, ni tampoco un exemplar cuyo punto de datos llegó en otra solicitud.
- **No se conservan:** los marcadores de obsolescencia y otros valores NaN o infinitos, ni las series `_created` de los contadores. Aun así se cuentan como escritos, así que el emisor no informa de muestras fallidas.
- **Se rechazan:** los datos que ninguna versión de remote write permite, como una serie sin nombre de métrica o una muestra con una marca de tiempo negativa. El resto de la solicitud se guarda, y el emisor recibe un `400` con lo que se rechazó.

## Loki

OneUptime acepta la API push de Loki en la misma ruta que usa Loki, en JSON o como el protobuf comprimido con snappy que envían Promtail y Grafana Alloy. Añádelo como cliente:

```yaml title="promtail.yaml"
clients:
  - url: https://oneuptime.com/telemetry/loki/api/v1/push
    bearer_token: YOUR_TELEMETRY_KEY
```

La salida `loki` de Fluent Bit recibe el host y la ruta por separado:

```text title="fluent-bit.conf"
[OUTPUT]
    Name         loki
    Match        *
    Host         oneuptime.com
    Port         443
    Tls          On
    Uri          /telemetry/loki/api/v1/push
    Http_User    oneuptime
    Http_Passwd  YOUR_TELEMETRY_KEY
    Labels       job=fluent-bit
```

OneUptime responde como Loki: `204` cuando un push queda guardado, `400` para uno que no puede leer, `413` para uno que supera los límites de más abajo, `401` para una clave que falta o que no se conoce, `403` para un presupuesto diario agotado, `429` con `Retry-After` al superar una tasa, y `503` cuando no puede aceptarlo en ese momento. Promtail, Alloy y Vector reintentan un `429` o un `503`, y descartan cualquier otro lote rechazado indicando el motivo; Fluent Bit descarta un `400` y reintenta todo lo demás, hasta su `Retry_Limit`.

### En qué se convierte un flujo

- **Cada entrada es un registro**, con su propia marca de tiempo con precisión de nanosegundos y su línea como cuerpo.
- **Las etiquetas y los metadatos estructurados son atributos**, con los nombres que tienen en Loki.
- **El servicio** sale del primero de `service_name`, `service`, `app`, `application`, `name`, `app_kubernetes_io_name`, `container`, `container_name`, `component`, `workload` y `job` que tenga un flujo, tal como lo determina Loki. Una etiqueta `host` o `hostname` indica el host.
- **El nivel** sale de una etiqueta o un metadato `level`, `detected_level` o `severity`, o, si no, de un `level=` de logfmt o del campo `level` de una línea JSON.
- **Contexto de traza:** un `trace_id` y un `span_id` en los metadatos estructurados vinculan el registro con su traza.

## Splunk HTTP Event Collector

Usa OneUptime como HTTP Event Collector, con tu clave de ingesta como token de HEC. El controlador de registro de Docker para Splunk añade la ruta por sí mismo, así que solo necesita el host:

```bash
docker run \
  --log-driver=splunk \
  --log-opt splunk-url=https://oneuptime.com \
  --log-opt splunk-token=YOUR_TELEMETRY_KEY \
  --log-opt splunk-format=json \
  your-image
```

Cualquier otro cliente HEC hace POST a `/services/collector/event` o `/services/collector/raw`. Para enviar un evento:

```bash
curl https://oneuptime.com/telemetry/services/collector/event \
  -H "Authorization: Splunk YOUR_TELEMETRY_KEY" \
  -d '{"event": "Payment failed for order 42", "sourcetype": "app", "fields": {"service": "checkout"}}'
```

Un `200` con `{"text": "Success", "code": 0}` significa que el evento se aceptó. El endpoint responde también con los códigos propios de HEC: `No data` (5), `Invalid data format` (6) con el número del evento que no era válido, y `Event field is required` (12). Además, responde a `GET /services/collector/health` sin token.

### En qué se convierte un evento

- **Un registro**, con su `time` como marca de tiempo. Un evento de tipo cadena es el cuerpo; en un evento de tipo objeto, `message`, `msg`, `log`, `line` o `text` es el cuerpo, y sus demás campos son atributos.
- **Sus metadatos se mantienen:** `host` es el host, y `source`, `sourcetype` e `index` se conservan como `com.splunk.source`, `com.splunk.sourcetype` y `com.splunk.index`. Los `host`, `source`, `sourcetype` e `index` de la cadena de consulta completan lo que un evento omite.
- **Sus campos son atributos.** Un campo `service.name` da nombre al servicio, igual que el campo `service` de un registro.
- **Los eventos de métricas** (`"event": "metric"`, con `metric_name` y `_value`, o con campos `metric_name:<name>`) se guardan como métricas, nunca como registros.
- **No se ofrece:** la confirmación del indexador. Un cliente que la pida no recibe ningún `ackId`.

## Datadog Agent

Apunta las métricas, los registros y las trazas de APM del Agent a OneUptime, con tu clave de ingesta como clave de API:

```yaml title="datadog.yaml"
api_key: YOUR_TELEMETRY_KEY_WITHOUT_HYPHENS
dd_url: https://oneuptime.com/telemetry/datadog
logs_enabled: true
logs_config:
  use_http: true
  logs_dd_url: oneuptime.com:443
apm_config:
  enabled: true
  apm_dd_url: https://oneuptime.com/telemetry/datadog
process_config:
  process_collection:
    enabled: false
```

El Agent añade sus propias rutas a `dd_url` y a `apm_dd_url`, y envía los registros a `/api/v2/logs` en el host y el puerto que indica `logs_dd_url`. En la raíz, OneUptime solo responde a esas rutas para una solicitud que lleve una cabecera `DD-API-KEY`. Reinicia el Agent después del cambio; `datadog-agent status` muestra su clave de API como válida cuando OneUptime la acepta.

### En qué se convierten los datos del Agent

- **Las métricas** conservan sus nombres. Los gauges siguen siendo gauges, los contadores se convierten en sumas y las tasas, en gauges de su valor por segundo.
- **Las distribuciones** se convierten en summaries con su recuento, su suma, su mínimo y su máximo.
- **Los checks de servicio** se convierten en una métrica con el nombre del check, cuyo valor es el estado del check: 0 OK, 1 advertencia, 2 crítico, 3 desconocido.
- **Los registros** conservan su mensaje, estado, host y servicio, y el resto de sus campos, como atributos.
- **Las trazas de APM** aparecen en Trazas. Cada span lleva el nombre de su recurso (`GET /users/:id`, una consulta) y pertenece a su servicio; un span al que una integración dio un nombre de servicio propio, como `checkout-postgres`, pertenece al servicio que hizo la llamada. Su nombre de operación y su tipo se conservan en `datadog.operation_name` y `datadog.span_type`.
- **Los errores** de un span aparecen en Excepciones, con el stack trace que registró el tracer.
- **Las etiquetas son atributos**, y las etiquetas `service`, `env` y `version` indican el servicio, su entorno y su versión. Las etiquetas HTTP y de base de datos de un span también se escriben con sus nombres de OpenTelemetry: `http.status_code` como `http.response.status_code`, `db.type` como `db.system.name`.
- **Aún no se leen:** los procesos, los contenedores, los datos de red y los perfiles. Déjalos desactivados en `datadog.yaml`, como arriba. Las estadísticas de APM del Agent se aceptan y no se conservan: OneUptime calcula las suyas a partir de los spans.

Los clientes de la API HTTP de Datadog (una biblioteca de registros que hace POST a `/api/v2/logs`, un script que envía series) pueden enviar al mismo endpoint con la cabecera `DD-API-KEY`.

### Sin Agent

dd-trace-go puede enviar sus trazas a OneUptime por sí mismo, con tu clave de ingesta como contraseña de su URL de Agent:

```bash
DD_TRACE_AGENT_URL=https://oneuptime:YOUR_TELEMETRY_KEY@oneuptime.com/telemetry/datadog
```

Los tracers de Python y Node.js omiten la ruta y la contraseña de la URL, así que envía sus trazas a través del Agent.

## SDK de Sentry

Sustituye el DSN donde configuras Sentry. El resto de tu código de Sentry se queda como está:

```javascript
Sentry.init({
  dsn: "https://YOUR_TELEMETRY_KEY_WITHOUT_HYPHENS@oneuptime.com/telemetry/sentry/1",
  release: "checkout@1.4.2",
  environment: "production",
});
```

```python
sentry_sdk.init(
    dsn="https://YOUR_TELEMETRY_KEY_WITHOUT_HYPHENS@oneuptime.com/telemetry/sentry/1",
    release="checkout@1.4.2",
    environment="production",
)
```

Los SDK de Sentry exigen el `1` del final del DSN, pero no se lee. El DSN de una aplicación de navegador es público, así que usa ahí una clave de ingesta de **Navegador**, limitada a los orígenes de tu sitio.

### En qué se convierte un sobre

- **Los errores** aparecen en Excepciones, con sus stack traces y las excepciones que los causaron, agrupados como cualquier otra excepción. Cada uno es un span de su traza, bajo el span que estaba activo.
- **Las transacciones** y sus spans aparecen en Trazas.
- **Los registros de Sentry** y los mensajes capturados con `capture_message` aparecen en Registros.
- **Los check-ins de cron** aparecen en Registros, un registro por check-in, con el slug del monitor en `sentry.monitor.slug` y su estado en `sentry.check_in.status`. Un check-in fallido, vencido o perdido se registra con el nivel Error. Para saber cuándo una tarea falla o no se ejecuta, crea un [monitor de registros](/docs/monitor/logs-monitor) sobre su slug.
- **Los comentarios de los usuarios**, del widget de comentarios de Sentry o de `capture_user_feedback`, aparecen en Registros, en la traza desde la que se enviaron. Su `sentry.feedback.associated_event_id` es el `sentry.event_id` del error al que se refieren.
- **Los perfiles**, de transacciones y del perfilado continuo, aparecen en Perfiles como perfiles de tiempo real (wall time), enlazados a la traza de su transacción. Los perfiles de Android aún no se leen.
- **El servicio** es una etiqueta `service` o, si no la hay, el nombre de la release antes de la `@`: `checkout@1.4.2` es `checkout`. La release es la versión del servicio, y el entorno se conserva.
- **No se conservan:** sesiones, replays y adjuntos. El SDK los sigue enviando; OneUptime los acepta y los descarta.

## Límites y presupuestos de ingesta

- **Tamaño de la solicitud**: el ingress de OneUptime acepta solicitudes de hasta 4 MB bajo `/telemetry`, y cada cuerpo puede descomprimirse hasta un máximo de 64 MB. Una solicitud de Prometheus remote write puede descomprimirse hasta un máximo de 32 MB y contener como máximo 500.000 series, etiquetas y muestras, para que ninguna solicitud por sí sola pueda agotar la memoria del servidor. Prometheus y Alloy envían 2.000 muestras por solicitud de forma predeterminada, muy por debajo de ambos; una solicitud que los supere se rechaza con `413`, así que reduce `max_samples_per_send` en `queue_config`.
- **Pushes de Loki**: un push puede descomprimirse hasta un máximo de 32 MB y contener como máximo 500.000 entradas, etiquetas y metadatos estructurados, contando las etiquetas de un flujo una vez por cada una de sus entradas. Promtail y Alloy envían lotes de 1 MB de forma predeterminada, muy por debajo de ambos; un push que los supere se rechaza con `413`, así que reduce el tamaño de lote del cliente.
- **Cargas JSON, MessagePack y de Datadog**: un cuerpo JSON o MessagePack puede contener como máximo 1.000.000 de valores (objetos, arrays, cadenas y números), y una carga protobuf del Datadog Agent como máximo 500.000 series, puntos, spans, etiquetas y sketches. Cada uno se cuenta antes de leerse, y una solicitud que supere un límite se rechaza con `413`.
- **Presupuestos de ingesta**: Prometheus remote write y Loki se comprueban contra el presupuesto de métricas o de registros antes de leer su cuerpo, y se rechazan con `403` cuando está agotado. Después, cada solicitud se descuenta por su tamaño descomprimido, como una solicitud OTLP, también de los presupuestos de un equipo o de una etiqueta. Un lote de HEC, una carga de Datadog o un sobre de Sentry pueden llevar varias señales, así que cada señal se descuenta de su propio presupuesto al guardarse, y se descarta cuando ese presupuesto está agotado: los registros y los eventos de métrica de un lote de HEC se reparten su tamaño, y cada elemento de un sobre de Sentry se descuenta de su propia señal (sus perfiles del presupuesto de perfiles, sus check-ins y comentarios del de registros), mientras que sus adjuntos, replays y sesiones, que no se conservan, no se descuentan de ninguno.

## Solución de problemas

### Todas las solicitudes se rechazan con 401

La clave no llegó adonde el endpoint la busca, o no es una clave de este proyecto. Compara la configuración de credenciales de la herramienta con la tabla de [Endpoints](#endpoints), y comprueba que la clave no esté desactivada ni caducada.

### Un SDK de Sentry dice que el DSN no es válido

Los SDK de Sentry rechazan un DSN cuya clave tenga guiones. Escribe la clave como sus 32 dígitos hexadecimales, sin los guiones.

### Llegan las métricas de Datadog, pero no los registros

Comprueba que `logs_config.use_http` sea `true` y que `logs_config.logs_dd_url` sea un host y un puerto, no una URL. El Agent envía los registros por TCP cuando `use_http` no está definido.

### Un registro de Datadog no se enlaza con su traza

El tracer solo escribió en el registro los 64 bits inferiores del ID de traza. Define `DD_TRACE_128_BIT_TRACEID_LOGGING_ENABLED=true` en el tracer para que escriba el ID completo.

### Prometheus devuelve 415

El emisor pidió un protocolo de remote write que OneUptime no lee. Envía remote write 1.0 o 2.0.
