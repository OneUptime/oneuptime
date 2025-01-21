FROM public.ecr.aws/ubuntu/ubuntu:25.04

RUN COLLECTOR_VERSION=0.117.0

# Get the architecture
RUN apt-get update && apt-get install -y curl bash wget

# Install gomplate
RUN ARCHITECTURE=$(uname -m) && \
    if [[ $ARCHITECTURE == "aarch64" ]]; then \
        ARCHITECTURE="arm64"; \
    elif [[ $ARCHITECTURE == "x86_64" ]]; then \
        ARCHITECTURE="amd64"; \
    fi && \
    echo "ARCHITECTURE: $(uname -s) $ARCHITECTURE" && \
    curl -o /usr/local/bin/gomplate -sSL https://github.com/hairyhenderson/gomplate/releases/download/v3.11.3/gomplate_$(uname -s)-$ARCHITECTURE && \
    chmod 755 /usr/local/bin/gomplate

# Install the collector
RUN ARCHITECTURE=$(uname -m) && \
    if [[ $ARCHITECTURE == "aarch64" ]]; then \
        wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$COLLECTOR_VERSION/otelcol_$COLLECTOR_VERSION_linux_arm64.deb && \
        dpkg -i otelcol_$COLLECTOR_VERSION_linux_arm64.deb; \
    elif [[ $ARCHITECTURE == "x86_64" ]]; then \
        wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$COLLECTOR_VERSION/otelcol_$COLLECTOR_VERSION_linux_amd64.deb && \
        dpkg -i otelcol_$COLLECTOR_VERSION_linux_amd64.deb; \
    elif [[ $ARCHITECTURE == "i386" ]]; then \
        wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$COLLECTOR_VERSION/otelcol_$COLLECTOR_VERSION_linux_386.deb && \
        dpkg -i otelcol_$COLLECTOR_VERSION_linux_386.deb; \
    fi

# Copy the configuration template file config.yaml.tpl
COPY ./OTelCollector/otel-collector-config.template.yaml /etc/otel-collector-config.template.yaml

# In command, gomplate the configuration file to replace the environment variables otel-collector-config.yaml and run the collector

CMD gomplate -f /etc/otel-collector-config.template.yaml > /etc/otel-collector-config.yaml && otelcol --config /etc/otel-collector-config.yaml
