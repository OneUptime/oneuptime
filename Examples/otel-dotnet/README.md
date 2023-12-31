# Open Telemetry .NET Example 

### Run the project. 

Please use 

```bash
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-service-token=9c8806e0-a4aa-11ee-be95-010d5967b068" && export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost" && dotnet run --urls=http://localhost:7856/
```

### Run on test server

```bash
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-service-token=41505e10-a7d6-11ee-b9c3-4f66c767c922" && export OTEL_EXPORTER_OTLP_ENDPOINT="https://test-otlp.oneuptime.com" && dotnet run --urls=http://localhost:7856/
```

