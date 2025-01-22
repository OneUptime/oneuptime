FROM public.ecr.aws/ubuntu/ubuntu:25.04

ENV COLLECTOR_VERSION=0.117.0

# Get the architecture
RUN apt-get update && apt-get install -y curl bash wget

# Install gomplate
RUN /bin/bash -c 'set -ex && \
    ARCH=`uname -m` && \
    if [ "$ARCH" == "x86_64" ]; then \
       ARCHITECTURE="amd64"; \
    elif [ "$ARCH" == "aarch64" ]; then \
       ARCHITECTURE="arm64"; \
    fi && \
    echo "Image Architecture: $ARCHITECTURE" && \
    echo "ARCHITECTURE: $ARCHITECTURE" && \
    curl -o /usr/local/bin/gomplate -sSL https://github.com/hairyhenderson/gomplate/releases/download/v3.11.3/gomplate_Linux-$ARCHITECTURE && \
    echo "Downloaded gomplate" && \
    chmod 755 /usr/local/bin/gomplate && \
    echo "Installed gomplate" && \  
    wget "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${COLLECTOR_VERSION}/otelcol_${COLLECTOR_VERSION}_$(uname -s)_${ARCHITECTURE}.deb" && \
    echo "Downloaded otelcol_${COLLECTOR_VERSION}_$(uname -s)_${ARCHITECTURE}.deb" && \
    dpkg -i otelcol_${COLLECTOR_VERSION}_$(uname -s)_${ARCHITECTURE}.deb && \
    echo "Installed otelcol_${COLLECTOR_VERSION}_$(uname -s)_${ARCHITECTURE}.deb"'

# Copy the configuration template file config.yaml.tpl
COPY ./OTelCollector/otel-collector-config.template.yaml /etc/otel-collector-config.template.yaml

# In command, gomplate the configuration file to replace the environment variables otel-collector-config.yaml and run the collector

CMD gomplate -f /etc/otel-collector-config.template.yaml > /etc/otel-collector-config.yaml && otelcol --config /etc/otel-collector-config.yaml
