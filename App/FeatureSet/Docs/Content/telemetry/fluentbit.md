# Use FluentBit to send telemetry data to OneUptime

## Overview

You can use the [FluentBit](https://docs.fluentbit.io/manual) plugin to collect logs & telemetry data from your applications and services. The plugin sends the telemetry data to the OneUptime OpenTelemetry HTTP Collector. You can use the opentelemetry output plugin of fluentbit to send the telemetry data to the OneUptime OpenTelemetry HTTP Collector. This plugin can be found here: https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry

## Getting Started

FluentBit supports hundreds of data sources and you can ingest logs and telemetry from any of these sources into OneUptime. Some of the popular sources include:

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

and many more. 

You can find the full list of supported sources [here](https://docs.fluentbit.io/manual)

## Prerequisites

- **Step 1: Install FluentBit on your system** - You can install FluentBit using the instructions provided [here](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit)
- **Step 2: Sign up for OneUptime account** -  You can sign up for a free account [here](https://oneuptime.com). Please note while the account is free, log ingestion is a paid feature. You can find more details about the pricing [here](https://oneuptime.com/pricing).
- **Step 3: Create OneUptime Project** - Once you have the account, you can create a project from the OneUptime dashboard. If you need any help with creating a project or have any questions, please reach out to us at support@oneuptime.com
- **Step 4: Create Telemetry Ingestion Token** - Once you have created a OneUptime account, you can create a telemetry ingestion token to ingest logs, metrics and traces from your application.

After you sign up to OneUptime and create a project. Click on "More" in the Navigation bar and click on "Project Settings".

On the Telemetry Ingestion Key page, click on "Create Ingestion Key" to create a token. 

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

Once you created a token, click on "View" to view the token.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)


## Configuration

You can use the following configuration to send the telemetry data to the OneUptime OpenTelemetry HTTP Collector. You can add this configuration to the fluentbit configuration file. The configuration file is usually located at `/etc/fluent-bit/fluent-bit.yaml`. Here's how an outputs section of the configuration file would look like:


```yaml


outputs:
  - name: stdout
    match: '*'
  - name: opentelemetry
    match: '*'
    host: 'oneuptime.com'
    port: 443
    metrics_uri: '/otlp/v1/metrics'
    logs_uri: '/otlp/v1/logs'
    traces_uri: '/otlp/v1/traces'
    tls: On
    header:
      - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN

```

Please make sure you have opentelemetry_envelope in your input section. Here's an example of how the input section would look like:

```yaml
pipeline:
  inputs:
      # Your inputs

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            # Please replace YOUR_SERVICE_NAME with the name of your service
            value: YOUR_SERVICE_NAME
```

Here is the example complete configuration file:

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
      match: '*'
    - name: opentelemetry
      match: '*'
      host: 'oneuptime.com'
      port: 443
      metrics_uri: '/otlp/v1/metrics'
      logs_uri: '/otlp/v1/logs'
      traces_uri: '/otlp/v1/traces'
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
```


**If you're self hosting OneUptime**: If you're self hosting OneUptime you can replace the `host` with the host of your OneUptime instance. If you're hosting on http server and not https, you can replace the `port` with the port of your OneUptime instance (likely port 80).

In this case the configuration would look like:

```yaml
outputs:
  - name: stdout
    match: '*'
  - name: opentelemetry
    match: '*'
    host: 'your-oneuptime-instance.com'
    port: 80
    metrics_uri: '/otlp/v1/metrics'
    logs_uri: '/otlp/v1/logs'
    traces_uri: '/otlp/v1/traces'
    header:
      - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
```

## Usage

Once you have added the configuration to the fluentbit configuration file, you can restart the fluentbit service. Once the service is restarted, the telemetry data will be sent to the OneUptime HTTP Source. You can now start seeing the telemetry data in the OneUptime dashboard. If you have any questions or need help with the configuration, please reach out to us at support@oneuptime.com
