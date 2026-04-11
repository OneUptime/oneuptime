FROM fluentd

ARG GIT_SHA
ARG APP_VERSION
ARG IS_ENTERPRISE_EDITION=false

ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
ENV IS_ENTERPRISE_EDITION=${IS_ENTERPRISE_EDITION}

LABEL org.opencontainers.image.title="OneUptime Fluentd"
LABEL org.opencontainers.image.description="OneUptime Fluentd log forwarder — ships container logs into the OneUptime telemetry pipeline."
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.url="https://oneuptime.com"
LABEL org.opencontainers.image.documentation="https://oneuptime.com/docs"
LABEL org.opencontainers.image.vendor="OneUptime"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${APP_VERSION}"

# This container will only run in dev env, so this is ok.
USER root

# Install bash and curl. 
RUN apt-get update \
	&& apt-get install -y --no-install-recommends bash curl \
	&& rm -rf /var/lib/apt/lists/*

EXPOSE 24224
EXPOSE 8888