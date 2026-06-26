FROM otel/opentelemetry-collector-contrib:0.154.0



FROM public.ecr.aws/ubuntu/ubuntu:26.04

# Per-build args (GIT_SHA / APP_VERSION / IS_ENTERPRISE_EDITION) are declared at
# the bottom so the apt-get / gomplate-download layers stay cacheable across the
# community + enterprise build passes.

LABEL org.opencontainers.image.title="OneUptime OpenTelemetry Collector"
LABEL org.opencontainers.image.description="OneUptime's OpenTelemetry Collector distribution — preconfigured to ingest traces, metrics, and logs."
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.url="https://oneuptime.com"
LABEL org.opencontainers.image.documentation="https://oneuptime.com/docs"
LABEL org.opencontainers.image.vendor="OneUptime"
LABEL org.opencontainers.image.licenses="Apache-2.0"

ENV COLLECTOR_VERSION=0.154.0

# Upgrade OS packages (Ubuntu security fixes published since the base image
# was built) and install the tools needed below. apt lists are removed in the
# same RUN so package metadata doesn't persist in the layer.
RUN apt-get update && apt-get upgrade -y \
    && apt-get install -y curl bash wget \
    && rm -rf /var/lib/apt/lists/*

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
    echo "Installed gomplate"'

# Copy Otel Colector Binary from Previous Stage
COPY --from=0 /otelcol-contrib /usr/bin/otelcol

# Copy the configuration template file config.yaml.tpl
COPY ./OTelCollector/otel-collector-config.template.yaml /etc/otel-collector-config.template.yaml

# Per-build metadata last so the apt-get / gomplate-download layers above stay
# cacheable across the community + enterprise build passes.
ARG GIT_SHA
ARG APP_VERSION
ARG IS_ENTERPRISE_EDITION=false
ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
ENV IS_ENTERPRISE_EDITION=${IS_ENTERPRISE_EDITION}
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${APP_VERSION}"

# In command, gomplate the configuration file to replace the environment variables otel-collector-config.yaml and run the collector

# The config declares a `profiles` pipeline; profiling support is alpha-gated
# in the collector, so the gate must be enabled or the collector refuses to
# start ("pipeline \"profiles\": profiling signal support is at alpha level").
CMD gomplate -f /etc/otel-collector-config.template.yaml > /tmp/otel-collector-config.yaml && echo "Here is the generated config file: " && cat /tmp/otel-collector-config.yaml && otelcol --config /tmp/otel-collector-config.yaml --feature-gates=service.profilesSupport
