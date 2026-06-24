# Usa FluentBit para enviar datos de telemetría a OneUptime

## Información general

Puedes usar el complemento [FluentBit](https://docs.fluentbit.io/manual) para recopilar registros y datos de telemetría de tus aplicaciones y servicios. El complemento envía los datos de telemetría al Colector HTTP OpenTelemetry de OneUptime. Puedes usar el complemento de salida opentelemetry de fluentbit para enviar los datos de telemetría al Colector HTTP OpenTelemetry de OneUptime. Este complemento se puede encontrar aquí: https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry

## Primeros pasos

FluentBit admite cientos de fuentes de datos y puedes ingestar registros y telemetría de cualquiera de estas fuentes en OneUptime. Algunas de las fuentes populares incluyen:

- Docker
- Syslog
- Apache
- Nginx
- MySQL
- PostgreSQL
- MongoDB
- NodeJS
- Ruby
- Python
- Java
- PHP
- Go
- Rust

y muchas más.

Puedes encontrar la lista completa de fuentes compatibles [aquí](https://docs.fluentbit.io/manual)

## Prerrequisitos

- **Paso 1: Instala FluentBit en tu sistema**: Puedes instalar FluentBit usando las instrucciones proporcionadas [aquí](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit)
- **Paso 2: Regístrate en una cuenta de OneUptime**: Puedes registrarte para obtener una cuenta gratuita [aquí](https://oneuptime.com). Ten en cuenta que aunque la cuenta es gratuita, la ingesta de registros es una función de pago. Puedes encontrar más detalles sobre los precios [aquí](https://oneuptime.com/pricing).
- **Paso 3: Crea un proyecto de OneUptime**: Una vez que tengas la cuenta, puedes crear un proyecto desde el panel de OneUptime. Si necesitas ayuda para crear un proyecto o tienes alguna pregunta, comunícate con nosotros en support@oneuptime.com
- **Paso 4: Crea un token de ingesta de telemetría**: Una vez que hayas creado una cuenta de OneUptime, puedes crear un token de ingesta de telemetría para ingestar registros, métricas y trazas desde tu aplicación.

Después de registrarte en OneUptime y crear un proyecto. Haz clic en "Más" en la barra de navegación y haz clic en "Configuración del proyecto".

En la página de Clave de ingesta de telemetría, haz clic en "Crear clave de ingesta" para crear un token.

![Crear servicio](/docs/static/images/TelemetryIngestionKeys.png)

Una vez que hayas creado un token, haz clic en "Ver" para verlo.

![Ver servicio](/docs/static/images/TelemetryIngestionKeyView.png)

## Configuración

Puedes usar la siguiente configuración para enviar los datos de telemetría al Colector HTTP OpenTelemetry de OneUptime. Puedes agregar esta configuración al archivo de configuración de fluentbit. El archivo de configuración generalmente se encuentra en `/etc/fluent-bit/fluent-bit.yaml`. Así es como se vería una sección de salidas del archivo de configuración:

```yaml
outputs:
  - name: stdout
    match: "*"
  - name: opentelemetry
    match: "*"
    host: "oneuptime.com"
    port: 443
    metrics_uri: "/otlp/v1/metrics"
    logs_uri: "/otlp/v1/logs"
    traces_uri: "/otlp/v1/traces"
    tls: On
    header:
      - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
```

Asegúrate de tener opentelemetry_envelope en tu sección de entrada. Aquí tienes un ejemplo de cómo se vería la sección de entrada:

```yaml
pipeline:
  inputs:
    # Tus entradas

    processors:
      logs:
        - name: opentelemetry_envelope

        - name: content_modifier
          context: otel_resource_attributes
          action: upsert
          key: service.name
          # Por favor, reemplaza YOUR_SERVICE_NAME con el nombre de tu servicio
          value: YOUR_SERVICE_NAME
```

Aquí tienes el ejemplo de archivo de configuración completo:

```yaml
service:
  flush: 1
  log_level: info

pipeline:
  inputs:
    - name: http
      listen: 0.0.0.0
      port: 8888

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            value: YOUR_SERVICE_NAME

  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "oneuptime.com"
      port: 443
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
```

**Si te auto-alojas en OneUptime**: Si te auto-alojas en OneUptime, puedes reemplazar el `host` con el host de tu instancia de OneUptime. Si estás alojando en un servidor http y no https, puedes reemplazar el `port` con el puerto de tu instancia de OneUptime (probablemente el puerto 80).

En este caso, la configuración se vería así:

```yaml
outputs:
  - name: stdout
    match: "*"
  - name: opentelemetry
    match: "*"
    host: "your-oneuptime-instance.com"
    port: 80
    metrics_uri: "/otlp/v1/metrics"
    logs_uri: "/otlp/v1/logs"
    traces_uri: "/otlp/v1/traces"
    header:
      - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
```

## Uso

Una vez que hayas agregado la configuración al archivo de configuración de fluentbit, puedes reiniciar el servicio fluentbit. Una vez que el servicio se reinicie, los datos de telemetría se enviarán a la Fuente HTTP de OneUptime. Ahora puedes empezar a ver los datos de telemetría en el panel de OneUptime. Si tienes alguna pregunta o necesitas ayuda con la configuración, comunícate con nosotros en support@oneuptime.com.
