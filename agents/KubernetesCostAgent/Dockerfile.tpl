# syntax=docker/dockerfile:1.7
#
# OneUptime Kubernetes Cost Agent Dockerfile
#
# Polls an in-cluster cost engine's Allocation API (OpenCost / Kubecost
# cost-model) and ships pre-priced workload cost allocations to OneUptime.
#

# Alpine, like the App, Home and TestServer images. This agent is plain
# JavaScript (no native modules) and needs nothing from the OS beyond CA
# certificates and tini, and on bookworm-slim that base alone carried ~240
# OS-package CVEs with no Debian fix (glibc, perl-base, util-linux, systemd
# libraries, ...), none of it used here.
FROM public.ecr.aws/docker/library/node:26-alpine3.24

# Update npm to npm@latest with every dependency it bundles (tar, undici,
# brace-expansion, ip-address, ...) reinstalled at the newest version npm's own
# ranges accept. `npm install -g npm@latest` alone ships the dependencies npm
# was packed with, and scanners flagged them in every image. See
# Scripts/Docker/UpdateNpmCli.js.
COPY ./Scripts/Docker/UpdateNpmCli.js /tmp/UpdateNpmCli.js
RUN node /tmp/UpdateNpmCli.js && rm /tmp/UpdateNpmCli.js

# Per-build args (GIT_SHA / APP_VERSION / IS_ENTERPRISE_EDITION) are declared at
# the bottom so the npm ci / compile layers stay cacheable across commits and
# across the community + enterprise build passes.
ENV NODE_OPTIONS="--use-openssl-ca"

LABEL org.opencontainers.image.title="OneUptime Kubernetes Cost Agent"
LABEL org.opencontainers.image.description="OneUptime Kubernetes cost agent — polls an in-cluster cost engine's Allocation API (OpenCost / Kubecost) and ships workload cost allocations to OneUptime."
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.url="https://oneuptime.com"
LABEL org.opencontainers.image.documentation="https://oneuptime.com/docs"
LABEL org.opencontainers.image.vendor="OneUptime"
LABEL org.opencontainers.image.licenses="Apache-2.0"

## Add intermediate CA certs
COPY ./packages/Common/SslCertificates /usr/local/share/ca-certificates
{{- if file.Exists "SslCertificates" }}
COPY ./SslCertificates /usr/local/share/ca-certificates
{{- end }}
# `apk upgrade` pulls in Alpine security fixes published since the base
# image was built; --no-cache keeps the apk index out of the layer.
RUN apk upgrade --no-cache \
    && apk add --no-cache ca-certificates tini \
    && update-ca-certificates

ENV PRODUCTION=true

WORKDIR /usr/src/app
COPY ./agents/KubernetesCostAgent/package*.json /usr/src/app/
# Uses the node image's default cache path (~/.npm) rather than the /tmp/npm
# convention the other images set — npm config was never customized here.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --prefer-offline

# The node base image already ships a non-root `node` user at UID/GID 1000.
# Reuse it rather than creating our own (a second user with GID 1000 cannot be
# created). UID 1000 is what the Helm chart's securityContext.runAsUser
# requests.
RUN chown -R node:node /usr/src/app

# Alpine's tini package installs the binary at /sbin/tini.
ENTRYPOINT ["/sbin/tini", "--"]

{{ if eq .Env.ENVIRONMENT "development" }}
USER node
CMD [ "npm", "run", "dev" ]
{{ else }}
COPY --chown=node:node ./agents/KubernetesCostAgent /usr/src/app
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
