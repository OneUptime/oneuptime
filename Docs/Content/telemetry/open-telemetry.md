# Integrate OpenTelemetry (logging, metrics and traces) with OneUptime. 

### Step 1 - Create Telemetry Ingestion Token.

Once you have created a OneUptime account, you can create a telemetry ingestion token to ingest logs, metrics and traces from your application.

After you sign up to OneUptime and create a project. Click on "More" in the Navigation bar and click on "Project Settings".

On the Telemetry Ingestion Key page, click on "Create Ingestion Key" to create a token. 

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

Once you created a token, click on "View" to view the token.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)


### Step 2 

#### Configure the telemetry service in your application.

#### Application Logs

We use OpenTelemetry to collect application logs. OneUptime currently supports log ingestion from these OpenTelemetry SDKs. Please follow the instructions to configure the telemetry service in your application.

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


**Integrate with OneUptime**

Once you have configured the telemetry service in your application, you can integrate with OneUptime by setting the following environment variables.

| Environment Variable | Value |
| --- | --- |
| OTEL_EXPORTER_OTLP_HEADERS | x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN |
| OTEL_EXPORTER_OTLP_ENDPOINT | https://oneuptime.com/otlp |
| OTEL_SERVICE_NAME | NAME_OF_YOUR_SERVICE |


**Example**

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=9c8806e0-a4aa-11ee-be95-010d5967b068
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```


**Self Hosted OneUptime**

If you're self-hosting oneuptime, this can be changed to your self hosted OpenTelemetry collector endpoint (eg: `http(s)://YOUR-ONEUPTIME-HOST/otlp`)

Once you run your application, you should see the logs in the OneUptime telemetry service page. Please contact support@oneuptime.com if you need any help.


#### Using OpenTelemetry Collector

You can also use the OpenTelemetry collector instead of sending telemetry data directly from your application. 
If you are using OpenTelemetry Collector, you can configure the OneUptime exporter in the collector configuration file.

Here is the example configuration for OpenTelemetry Collector.

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:

  # Export over HTTP
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    # Requires use JSON encoder insted of default Proto(buf)
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "ONEUPTIME_TOKEN" # Your OneUptime token

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
