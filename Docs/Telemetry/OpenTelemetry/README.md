# Integrate OpenTelemetry (logging, metrics and traces) with OneUptime. 

### Step 1 - Create a OneUptime Telemetry Service. 

Once you have created a OneUptime account, you can create a telemetry service by clicking on the "Add Service" button.

After you sign up to OneUptime and create a project. Click on more in the Navigation bar and click on "Telemetry".

On the telemetry service page, click on "Create Telemetry Service" button.

![Create Service](/Docs/Telemetry/Images/CreateService.png)

Once you create a telemetry service, click on "View Service" and you will be redirected to the telemetry service page.

Click on View Service Token and copy the token. You will need this token to configure the telemetry service. Please keep this token safe.

![View Service](/Docs/Telemetry/Images/ViewServiceToken.png)


### Step 2 - Configure the telemetry service in your application.

#### Application Logs

We use OpenTelemetry to collect application logs. OneUptime currently supports log ingestion from these OpenTelemetry SDKs. Please follow the instructions to configure the telemetry service in your application.

- [C++](https://opentelemetry.io/docs/instrumentation/cpp/)
- [Go](https://opentelemetry.io/docs/instrumentation/go/)
- [Java](https://opentelemetry.io/docs/instrumentation/java/)
- [JavaScript / Typescript / NodeJS / Browser](https://opentelemetry.io/docs/instrumentation/js/)
- [Python](https://opentelemetry.io/docs/instrumentation/python/)
- [Ruby](https://opentelemetry.io/docs/instrumentation/ruby/)
- [Swift](https://opentelemetry.io/docs/instrumentation/swift/)
- [PHP](https://opentelemetry.io/docs/instrumentation/php/)
- [Erlang](https://opentelemetry.io/docs/instrumentation/erlang/)
- [Rust](https://opentelemetry.io/docs/instrumentation/rust/)
- [.NET / C#](https://opentelemetry.io/docs/instrumentation/net/)
- [Swift](https://opentelemetry.io/docs/instrumentation/swift/)


**Integrate with OneUptime**

Once you have configured the telemetry service in your application, you can integrate with OneUptime by setting the following environment variables.

| Environment Variable | Value |
| --- | --- |
| OTEL_EXPORTER_OTLP_HEADERS | x-oneuptime-service-token=<YOUR_ONEUPTIME_SERVICE_TOKEN> |
| OTEL_EXPORTER_OTLP_ENDPOINT | https://otlp.oneuptime.com |

**Example**

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-service-token=9c8806e0-a4aa-11ee-be95-010d5967b068
export OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.oneuptime.com
```

If you're self-hosting oneuptime, this can be changed to your self hosted collector endpoint (eg: `http(s)://<your-oneuptime-host>/otlp`)

Once you run your application, you should see the logs in the OneUptime telemetry service page. Please contact support@oneuptime.com if you need any help.
