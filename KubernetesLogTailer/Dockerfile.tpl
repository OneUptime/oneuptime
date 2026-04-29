#
# OneUptime Kubernetes Log Tailer Dockerfile
#
# Streams pod logs via the Kubernetes API (GKE Autopilot compatible — no
# hostPath volumes, no host access) and forwards them to OneUptime via OTLP.
#

FROM public.ecr.aws/docker/library/node:24.9-slim

ARG GIT_SHA
ARG APP_VERSION
ARG IS_ENTERPRISE_EDITION=false

ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
ENV IS_ENTERPRISE_EDITION=${IS_ENTERPRISE_EDITION}
ENV NODE_OPTIONS="--use-openssl-ca"

LABEL org.opencontainers.image.title="OneUptime Kubernetes Log Tailer"
LABEL org.opencontainers.image.description="OneUptime Kubernetes log tailer — collects pod logs via the Kubernetes API (GKE Autopilot compatible) and forwards them to OneUptime via OTLP-HTTP."
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.url="https://oneuptime.com"
LABEL org.opencontainers.image.documentation="https://oneuptime.com/docs"
LABEL org.opencontainers.image.vendor="OneUptime"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${APP_VERSION}"

## Add intermediate CA certs
COPY ./SslCertificates /usr/local/share/ca-certificates
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PRODUCTION=true

WORKDIR /usr/src/app
COPY ./KubernetesLogTailer/package*.json /usr/src/app/
RUN npm install --omit=dev

# The node:*-slim base image already ships a non-root `node` user at UID/GID
# 1000. Reuse it rather than creating our own (creating a second user with
# GID 1000 fails with `groupadd: GID '1000' already exists`). UID 1000 is
# what the Helm chart's securityContext.runAsUser requests.
RUN chown -R node:node /usr/src/app

ENTRYPOINT ["/usr/bin/tini", "--"]

{{ if eq .Env.ENVIRONMENT "development" }}
USER node
CMD [ "npm", "run", "dev" ]
{{ else }}
COPY --chown=node:node ./KubernetesLogTailer /usr/src/app
RUN npm run compile
USER node
CMD [ "node", "build/dist/Index.js" ]
{{ end }}
