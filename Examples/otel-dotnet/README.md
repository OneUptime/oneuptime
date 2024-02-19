# Open Telemetry .NET Example 

### Run the project. 

Please use 

```bash
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-service-token=51d01130-cf14-11ee-a74d-1364f8ef0ac6" && export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost" && dotnet run --urls=http://localhost:7856/
```

### Run on test server

```bash
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-service-token=3be58190-c7ec-11ee-8e5e-3952f961cde5" && export OTEL_EXPORTER_OTLP_ENDPOINT="https://test-otlp.oneuptime.com" && dotnet run --urls=http://localhost:7856/
```

