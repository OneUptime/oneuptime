# Match all patterns (** means all logs)
<match **>
  @type http  # Use HTTP plugin to send logs

  # Set the target endpoint where logs are sent
  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2  # Timeout for opening a connection

  # Set the headers required for authentication and service identification
  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json  # Specify the content type as JSON
  json_array true  # Ensure logs are sent as a JSON array

  <format>
    @type json  # Specify that the logs should be formatted in JSON
  </format>
  <buffer>
    flush_interval 10s  # Set the buffer flush interval to 10 seconds
  </buffer>
</match>

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

**If you're self hosting OneUptime**: If you're self hosting OneUptime you can replace the `endpoint_url` with the URL of your OneUptime instance. `http(s)://<YOUR_HOST>/fluentd/logs`

## Usage

Once you have added the configuration to the fluentd configuration file, you can restart the fluentd service. Once the service is restarted, the telemetry data will be sent to the OneUptime HTTP Source. You can now start seeing the telemetry data in the OneUptime dashboard. If you have any questions or need help with the configuration, please reach out to us at support@oneuptime.com