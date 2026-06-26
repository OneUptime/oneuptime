# Integra OpenTelemetry (registros, métricas y trazas) con OneUptime.

### Paso 1: Crear un token de ingesta de telemetría.

Una vez que hayas creado una cuenta de OneUptime, puedes crear un token de ingesta de telemetría para ingestar registros, métricas y trazas desde tu aplicación.

Después de registrarte en OneUptime y crear un proyecto. Haz clic en "Más" en la barra de navegación y haz clic en "Configuración del proyecto".

En la página de Clave de ingesta de telemetría, haz clic en "Crear clave de ingesta" para crear un token.

![Crear servicio](/docs/static/images/TelemetryIngestionKeys.png)

Una vez que hayas creado un token, haz clic en "Ver" para verlo.

![Ver servicio](/docs/static/images/TelemetryIngestionKeyView.png)

### Paso 2

#### Configurar el servicio de telemetría en tu aplicación.

#### Registros de la aplicación

Usamos OpenTelemetry para recopilar registros de la aplicación. OneUptime actualmente admite la ingesta de registros desde estos SDK de OpenTelemetry. Por favor, sigue las instrucciones para configurar el servicio de telemetría en tu aplicación.

- [C++](https://opentelemetry.io/docs/instrumentation/cpp/)
- [Go](https://opentelemetry.io/docs/instrumentation/go/)
- [Java](https://opentelemetry.io/docs/instrumentation/java/)
- [JavaScript / Typescript / NodeJS / Browser](https://opentelemetry.io/docs/instrumentation/js/)
- [Python](https://opentelemetry.io/docs/instrumentation/python/)
- [Ruby](https://opentelemetry.io/docs/instrumentation/ruby/)
- [PHP](https://opentelemetry.io/docs/instrumentation/php/)
- [Erlang](https://opentelemetry.io/docs/instrumentation/erlang/)
- [Rust](https://opentelemetry.io/docs/instrumentation/rust/)
- [.NET / C#](https://opentelemetry.io/docs/instrumentation/net/)
- [Swift](https://opentelemetry.io/docs/instrumentation/swift/)

**Integrar con OneUptime**

Una vez que hayas configurado el servicio de telemetría en tu aplicación, puedes integrar con OneUptime estableciendo las siguientes variables de entorno.

| Variable de entorno         | Valor                                          |
| --------------------------- | ---------------------------------------------- |
| OTEL_EXPORTER_OTLP_HEADERS  | x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN |
| OTEL_EXPORTER_OTLP_ENDPOINT | https://oneuptime.com/otlp                     |
| OTEL_SERVICE_NAME           | NAME_OF_YOUR_SERVICE                           |

**Ejemplo**

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=9c8806e0-a4aa-11ee-be95-010d5967b068
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```

**OneUptime auto-alojado**

Si te auto-alojas en OneUptime, esto puede cambiarse a tu punto de conexión del colector OpenTelemetry auto-alojado (por ejemplo: `http(s)://YOUR-ONEUPTIME-HOST/otlp`)

Una vez que ejecutes tu aplicación, deberías ver los registros en la página del servicio de telemetría de OneUptime. Comunícate con support@oneuptime.com si necesitas ayuda.

#### Uso del Colector OpenTelemetry

También puedes usar el Colector OpenTelemetry en lugar de enviar datos de telemetría directamente desde tu aplicación.
Si estás usando el Colector OpenTelemetry, puedes configurar el exportador de OneUptime en el archivo de configuración del colector.

Aquí tienes la configuración de ejemplo para el Colector OpenTelemetry.

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  # Exportar a través de HTTP
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    # Requiere usar el codificador JSON en lugar del predeterminado Proto(buf)
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "ONEUPTIME_TOKEN" # Tu token de OneUptime

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlphttp]
    metrics:
      receivers: [otlp]
      exporters: [otlphttp]
    logs:
      receivers: [otlp]
      exporters: [otlphttp]
```
