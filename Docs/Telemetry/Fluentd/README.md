# Fluentd Telemetry

## Overview

You can use the [Fluentd](https://www.fluentd.org/) plugin to collect logs & telemetry data from your applications and services. The plugin sends the telemetry data to the OneUptime HTTP Source. You can use the http output plugin of fluentd to send the telemetry data to the OneUptime HTTP Source. This plugin can be found here: https://docs.fluentd.org/output/http

## Prerequisites

- **Install Fluentd on your system** - You can install Fluentd using the instructions provided [here](https://docs.fluentd.org/installation)
- **Sign up for OneUptime account** -  You can sign up for a free account [here](https://oneuptime.com). Please note while the account is free, log ingestion is a paid feature. You can find more details about the pricing [here](https://oneuptime.com/pricing).
- **Create OneUptime Project** - Once you have the account, you can create a project from the OneUptime dashboard. If you need any help with creating a project or have any questions, please reach out to us at support@oneuptime.com
- **Create a OneUptime Telemetry Service on OneUptime Dashboard** - Once you have the project, you can create a telemetry service from the OneUptime dashboard. Please click on "More" in the top nav bar and click on "Telemetry". Create a new telemetry service on that page. 


## Configuration

You can use the following configuration to send the telemetry data to the OneUptime HTTP Source. You can add this configuration to the fluentd configuration file. The configuration file is usually located at `/etc/fluentd/fluent.conf` or `/etc/td-agent/td-agent.conf`. 

```yaml
<match **>
  @type http
  endpoint_url "https://api.oneuptime.com/v1/telemetry/ingest"
  http_method post
  serializer json
  <buffer>
    @type file
    path /var/log/fluentd-buffers/oneuptime-buffer
    flush_mode interval
    flush_interval 5s
  </buffer>
</match>
```

**For Selfhosters**: If you're self hosting OneUptime you can replace the `endpoint_url` with the URL of your OneUptime instance.

## Usage

Once you have added the configuration to the fluentd configuration file, you can restart the fluentd service using the following command:

```bash
sudo service td-agent restart
```

You can now start seeing the telemetry data in the OneUptime dashboard. If you have any questions or need help with the configuration, please reach out to us at

- Email: support@oneuptime.com


Please note that the above configuration is just an example. You can customize the configuration based on your requirements. You can find more details about the http output plugin of fluentd [here](https://docs.fluentd.org/output/http).