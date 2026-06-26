# Dispositivos IoT de OneUptime

## Descripción general

OneUptime monitorea flotas de dispositivos IoT — sensores, gateways, controladores y equipos edge — ingiriendo métricas estándar de OpenTelemetry (OTLP). Cada dispositivo (o un gateway en su nombre) envía un pequeño conjunto de métricas `iot_*` mediante OTLP HTTP, etiquetadas con la **flota** a la que pertenece y su propio **id de dispositivo**. OneUptime agrupa esas métricas en una flota, construye un inventario de dispositivos en vivo y realiza el seguimiento por dispositivo de la batería, la conectividad, la temperatura, la CPU, la memoria y la disponibilidad.

No hay ningún agente que instalar en el lado del dispositivo — cualquier cosa que pueda hablar OTLP (un SDK de OpenTelemetry en el dispositivo, o un OpenTelemetry Collector ejecutándose en un gateway que distribuye hacia muchos dispositivos) funciona. Esta página es la **guía de ingesta**. Para configurar monitores y alertas de IoT sobre los datos que envías, consulta [Monitor de Dispositivo IoT](/docs/monitor/iot-device-monitor).

## Requisitos previos

- Un dispositivo, gateway o collector que pueda enviar OTLP/HTTP a OneUptime
- Conectividad de red desde el dispositivo/gateway hasta tu instancia de OneUptime
- Un **Token de Ingesta de Telemetría de OneUptime** — crea uno desde _Project Settings → Telemetry Ingestion Keys_ y copia el valor de `x-oneuptime-token`

## Cómo modela OneUptime el IoT

OneUptime asigna tus dispositivos a dos conceptos usando atributos de recurso de OpenTelemetry:

- **Flota** — un grupo lógico de dispositivos (por ejemplo `building-a-sensors` o `field-gateways`). La flota se deriva del atributo de recurso `iot.fleet.name` y aparece en OneUptime como el servicio de telemetría `iot/<fleet>`. Establece `service.name=iot/<fleet>` para que los logs y las métricas se alineen bajo el mismo servicio.
- **Dispositivo** — un dispositivo individual dentro de una flota, identificado por el atributo `device.id`. OneUptime construye y mantiene un inventario de dispositivos por flota indexado por `device.id`.

Los atributos opcionales refinan cómo se clasifica y se delimita cada dispositivo en los monitores:

| Atributo             | Obligatorio | Descripción                                                                      |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| `iot.fleet.name`     | Sí      | La flota a la que pertenece este dispositivo. Se convierte en el servicio de OneUptime `iot/<fleet>`    |
| `device.id`          | Sí      | Id estable y único del dispositivo dentro de la flota                                |
| `iot.device.kind`    | No       | La clase del dispositivo — por ejemplo `Device`, `Sensor` o `Gateway`. El valor predeterminado es `Device` |
| `iot.device.type`    | No       | Un tipo/modelo de dispositivo más detallado usado para filtrar monitores (por ejemplo `temp-sensor`) |
| `iot.device.firmware`| No       | Versión de firmware reportada por el dispositivo                                          |

## Envío de métricas mediante el SDK de OpenTelemetry

Si tu dispositivo ejecuta un SDK de OpenTelemetry directamente, apúntalo a OneUptime y estampa los atributos de recurso de IoT a través de las variables de entorno estándar `OTEL_*`. Reemplaza el token, el endpoint, el nombre de la flota y el id de dispositivo con los valores de tu entorno.

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
export OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=building-a-sensors,device.id=sensor-001,service.name=iot/building-a-sensors
```

| Variable de entorno           | Obligatorio | Descripción                                                                                          |
| ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Sí      | Endpoint OTLP de OneUptime (`https://oneuptime.com/otlp`, o `http(s)://YOUR-ONEUPTIME-HOST/otlp` autoalojado) |
| `OTEL_EXPORTER_OTLP_HEADERS`  | Sí      | `x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN`                                                    |
| `OTEL_RESOURCE_ATTRIBUTES`    | Sí      | Atributos de recurso separados por comas. Debe incluir `iot.fleet.name`, `device.id` y `service.name=iot/<fleet>` |

Emite tus lecturas como métricas usando los nombres `iot_*` que aparecen a continuación (consulta [Convenciones de Métricas](#metric-conventions)). En aproximadamente un minuto el dispositivo aparece en la sección **IoT** del panel de OneUptime.

## Envío de métricas mediante un OpenTelemetry Collector

Cuando muchos dispositivos reportan a través de un gateway, ejecuta un OpenTelemetry Collector en el gateway y exporta a OneUptime. El procesador `resource` estampa los atributos de la flota; recibe las lecturas de tus dispositivos (OTLP, puente MQTT, logs de archivos, etc.) y reenvíalas:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: iot.fleet.name
        value: field-gateways
        action: upsert
      - key: service.name
        value: iot/field-gateways
        action: upsert

exporters:
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    # OneUptime requiere el codificador JSON en lugar del Proto(buf) predeterminado
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"

service:
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlphttp]
```

- **`resource`** estampa cada registro con los atributos de la flota. Establece `iot.fleet.name` (y el `service.name=iot/<fleet>` correspondiente) por gateway para que los dispositivos de cada gateway aterricen en la flota correcta.
- Mantén `device.id` (y opcionalmente `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) en cada datapoint para que OneUptime pueda resolver el dispositivo individual dentro de la flota.
- **`otlphttp`** envía a OneUptime mediante HTTPS con el token de ingesta adjunto. Ten en cuenta que `encoding: json` y el encabezado `Content-Type: application/json` son obligatorios.

## Convenciones de Métricas

OneUptime reconoce los siguientes nombres de métricas `iot_*`. Cada datapoint debe llevar la etiqueta `device.id` para que la lectura se atribuya al dispositivo correcto. Solo necesitas enviar las métricas que tengan sentido para tu dispositivo — las que falten simplemente no se grafican.

| Nombre de la métrica        | Significado                                                                    |
| --------------------------- | ------------------------------------------------------------------------------ |
| `iot_device_up`             | Disponibilidad del dispositivo. `1` = activo/alcanzable, `0` = caído. Impulsa el monitor de Dispositivo IoT |
| `iot_device_info`           | Señal de identidad únicamente. Lleva `device.id` / kind / type / firmware para que un dispositivo aparezca en el inventario incluso antes de reportar lecturas |
| `iot_battery_percent`       | Nivel de carga de la batería, `0`–`100` (%)                                            |
| `iot_signal_strength_dbm`   | Intensidad de la señal inalámbrica en dBm (por ejemplo RSSI de Wi-Fi / LoRa / celular)      |
| `iot_temperature_celsius`   | Temperatura del dispositivo o sensor en °C                                             |
| `iot_cpu_usage_ratio`       | Utilización de la CPU como una proporción `0`–`1` (OneUptime la almacena como porcentaje)        |
| `iot_memory_usage_bytes`    | Memoria usada actualmente, en bytes                                                |
| `iot_memory_size_bytes`     | Memoria total disponible en el dispositivo, en bytes                                 |
| `iot_uptime_seconds`        | Segundos desde el último arranque del dispositivo                                           |

## Verificar la instalación

1. Confirma que tu dispositivo o gateway está exportando sin errores (revisa los logs del SDK/collector en busca de fallos de exportación y respuestas HTTP `401`/`403`).
2. En el panel de OneUptime, abre la sección **IoT** — tu flota debería aparecer como `iot/<fleet>` en aproximadamente un minuto.
3. Abre la pestaña **Devices** de la flota — cada `device.id` que enviaste debería aparecer listado con su última batería, señal, temperatura, CPU, memoria y estado activo/caído.
4. Abre **Metrics** bajo la flota para graficar cualquiera de las series `iot_*` anteriores.

## Solución de problemas

### La flota no aparece

1. Verifica que `iot.fleet.name` esté establecido como un atributo de **recurso** (no como una etiqueta de datapoint), y que `service.name` sea `iot/<fleet>`.
2. Confirma que el endpoint del exportador sea `https://oneuptime.com/otlp` (o tu `…/otlp` autoalojado) y que el encabezado `x-oneuptime-token` lleve un token válido.
3. Si usas un collector, asegúrate de que `encoding: json` y `Content-Type: application/json` estén establecidos en el exportador `otlphttp`.

### Faltan dispositivos en el inventario

1. Asegúrate de que cada datapoint lleve una etiqueta `device.id` — los dispositivos se indexan por ella.
2. Envía `iot_device_info` (identidad únicamente) para los dispositivos que aún no han reportado lecturas, de modo que aparezcan igualmente en el inventario.
3. Comprueba que los valores de `device.id` sean estables entre reportes; un id cambiante crea filas de dispositivo duplicadas.

### HTTP 401 / 403 del exportador

El token de ingesta es inválido, ha sido revocado o falta. Genera uno nuevo desde _Project Settings → Telemetry Ingestion Keys_ y actualiza el encabezado `x-oneuptime-token`.

### Las métricas no se grafican

1. Confirma que estás usando exactamente los nombres de métricas `iot_*` de la tabla de [Convenciones de Métricas](#metric-conventions) — los nombres no reconocidos se almacenan como métricas genéricas y no poblarán los gráficos de IoT.
2. Recuerda que `iot_cpu_usage_ratio` es una proporción `0`–`1`; envía la proporción cruda y OneUptime la representa como porcentaje.
3. Espera hasta un minuto para que los primeros datapoints aparezcan después de que un dispositivo comience a reportar.

## OneUptime autoalojado

Si estás autoalojando OneUptime, apunta el endpoint a tu propia instancia:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://your-oneuptime-host.example.com/otlp
```

O, en un collector:

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"
```

Si tu instancia es solo HTTP, cambia el esquema a `http://` y usa el puerto apropiado.

## Próximos pasos

- Configura un **Monitor de Dispositivo IoT** para alertar sobre condiciones de dispositivo fuera de línea, batería baja, señal débil, temperatura alta y CPU alta — consulta [Monitor de Dispositivo IoT](/docs/monitor/iot-device-monitor).
- Para hosts no contenerizados (VMs y bare metal de Linux / macOS / Windows), usa el [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
- Para aprender en profundidad la integración subyacente de OTLP, consulta [Integrar OpenTelemetry con OneUptime](/docs/telemetry/open-telemetry).
