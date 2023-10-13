FROM otel/opentelemetry-collector-contrib:latest

COPY ./OTelCollector/config.yaml /etc/otelcol-contrib/config.yaml