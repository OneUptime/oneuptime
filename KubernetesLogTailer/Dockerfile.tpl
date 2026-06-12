# syntax=docker/dockerfile:1.7
#
# OneUptime Kubernetes Log Tailer Dockerfile
#
# Streams pod logs via the Kubernetes API (GKE Autopilot compatible — no
# hostPath volumes, no host access) and forwards them to OneUptime via OTLP.
#

FROM public.ecr.aws/docker/library/node:24-slim

# Upgrade the bundled npm CLI so its vendored deps (tar, glob, minimatch,
# brace-expansion, diff, ip-address, picomatch, ...) pick up security fixes
# that the base image's npm still carries.
RUN npm install -g npm@latest

# Per-build args (GIT_SHA / APP_VERSION / IS_ENTERPRISE_EDITION) are declared at
# the bottom so the npm ci / compile layers stay cacheable across commits and
# across the community + enterprise build passes.
ENV NODE_OPTIONS="--use-openssl-ca"

LABEL org.opencontainers.image.title="OneUptime Kubernetes Log Tailer"
LABEL org.opencontainers.image.description="OneUptime Kubernetes log tailer — collects pod logs via the Kubernetes API (GKE Autopilot compatible) and forwards them to OneUptime via OTLP-HTTP."
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.url="https://oneuptime.com"
LABEL org.opencontainers.image.documentation="https://oneuptime.com/docs"
LABEL org.opencontainers.image.vendor="OneUptime"
LABEL org.opencontainers.image.licenses="Apache-2.0"

## Add intermediate CA certs
COPY ./SslCertificates /usr/local/share/ca-certificates
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PRODUCTION=true

WORKDIR /usr/src/app
COPY ./KubernetesLogTailer/package*.json /usr/src/app/
# Uses node:*-slim default cache path (~/.npm) rather than the /tmp/npm
# convention the other images set — npm config was never customized here.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --prefer-offline

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
# Per-build metadata last so the npm ci / compile layers above stay cacheable
# across commits and across the community + enterprise build passes.
ARG GIT_SHA
ARG APP_VERSION
ARG IS_ENTERPRISE_EDITION=false
ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
ENV IS_ENTERPRISE_EDITION=${IS_ENTERPRISE_EDITION}
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${APP_VERSION}"
CMD [ "node", "build/dist/Index.js" ]
{{ end }}
