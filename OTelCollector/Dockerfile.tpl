FROM otel/opentelemetry-collector-contrib:0.104.0

COPY ./OTelCollector/config.yaml /etc/otelcol-contrib/config.yaml