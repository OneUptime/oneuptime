# Use Fluentd to send telemetry data to OneUptime

## Overview

You can use the [Fluentd](https://www.fluentd.org/) plugin to collect logs & telemetry data from your applications and services. The plugin sends the telemetry data to the OneUptime HTTP Source. You can use the http output plugin of fluentd to send the telemetry data to the OneUptime HTTP Source. This plugin can be found here: https://docs.fluentd.org/output/http

## Getting Started

Fluentd supports hundreds of data sources and you can ingest logs from any of these sources into OneUptime. Some of the popular sources include:

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

You can find the full list of supported sources [here](https://www.fluentd.org/datasources)

## Prerequisites

- **Step 1: Install Fluentd on your system** - You can install Fluentd using the instructions provided [here](https://docs.fluentd.org/installation)
- **Step 2: Sign up for OneUptime account** -  You can sign up for a free account [here](https://oneuptime.com). Please note while the account is free, log ingestion is a paid feature. You can find more details about the pricing [here](https://oneuptime.com/pricing).
- **Step 3: Create OneUptime Project** - Once you have the account, you can create a project from the OneUptime dashboard. If you need any help with creating a project or have any questions, please reach out to us at support@oneuptime.com
- **Step 4: Create Telemetry Ingestion Token** - Once you have created a OneUptime account, you can create a telemetry ingestion token to ingest logs, metrics and traces from your application.

After you sign up to OneUptime and create a project. Click on "More" in the Navigation bar and click on "Project Settings".

On the Telemetry Ingestion Key page, click on "Create Ingestion Key" to create a token. 

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

Once you created a token, click on "View" to view the token.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)


## Configuration

You can use the following configuration to send the telemetry data to the OneUptime HTTP Source. You can add this configuration to the fluentd configuration file. The configuration file is usually located at `/etc/fluentd/fluent.conf` or `/etc/td-agent/td-agent.conf`. 

You  need to replace the `YOUR_SERVICE_TOKEN` with the token you created in the previous step. You also need to replace the `YOUR_SERVICE_NAME` with the name of your service. name of the service can be any name you like. If the service does not exist in OneUptime, it will be created automatically.

```yaml
# Match all patterns 
<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  <format>
    @type json
  </format>
  <buffer>
    flush_interval 10s
  </buffer>
</match>
```


An example of full configuration file is shown below:

```yaml
####
## Source descriptions:
##

## built-in TCP input
## @see https://docs.fluentd.org/input/forward
<source>
  @type forward
  port 24224
  bind 0.0.0.0
</source>

<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  <format>
    @type json
  </format>
  <buffer>
    flush_interval 10s
  </buffer>
</match>
```

**If you're self hosting OneUptime**: If you're self hosting OneUptime you can replace the `endpoint_url` with the URL of your OneUptime instance. `http(s)://YOUR_ONEUPTIME_HOST/fluentd/logs`

## Usage

Once you have added the configuration to the fluentd configuration file, you can restart the fluentd service. Once the service is restarted, the telemetry data will be sent to the OneUptime HTTP Source. You can now start seeing the telemetry data in the OneUptime dashboard. If you have any questions or need help with the configuration, please reach out to us at support@oneuptime.com