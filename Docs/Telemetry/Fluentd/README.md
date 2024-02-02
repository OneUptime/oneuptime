# Ingest logs & telemetry data from Fluentd to OneUptime

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
- **Step 4: Create a OneUptime Telemetry Service on OneUptime Dashboard** 

On the telemetry service page, click on "Create Telemetry Service" button.

![Create Service](/Docs/Telemetry/Images/CreateService.png)

Once you create a telemetry service, click on "View Service" and you will be redirected to the telemetry service page.

Click on View Service Token and copy the token. You will need this token to configure the telemetry service. **Please keep this token safe.**

![View Service](/Docs/Telemetry/Images/ViewServiceToken.png)


## Configuration

You can use the following configuration to send the telemetry data to the OneUptime HTTP Source. You can add this configuration to the fluentd configuration file. The configuration file is usually located at `/etc/fluentd/fluent.conf` or `/etc/td-agent/td-agent.conf`. 

```yaml
# Match all patterns 
<match **>
  @type http

  endpoint https://oneuptime.com/ingestor/fluentd/v1/logs
  open_timeout 2

  headers {"x-oneuptime-service-token":"<YOUR_SERVICE_TOKEN>"}

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

  endpoint https://oneuptime.com/ingestor/fluentd/v1/logs
  open_timeout 2

  headers {"x-oneuptime-service-token":"<YOUR_SERVICE_TOKEN>"}

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

**If you're self hosting OneUptime**: If you're self hosting OneUptime you can replace the `endpoint_url` with the URL of your OneUptime instance. `http(s)://<YOUR_HOST>/ingestor/fluentd/v1/logs`

## Usage

Once you have added the configuration to the fluentd configuration file, you can restart the fluentd service. Once the service is restarted, the telemetry data will be sent to the OneUptime HTTP Source. You can now start seeing the telemetry data in the OneUptime dashboard. If you have any questions or need help with the configuration, please reach out to us at support@oneuptime.com