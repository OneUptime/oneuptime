# syntax=docker/dockerfile:1.7
#
# OneUptime Resource AI Agent Dockerfile
#
# Runs the commands OneUptime AI asks for on ONE infrastructure resource —
# a Docker, Podman or Swarm host, a Proxmox cluster, a VMware vCenter, a Ceph
# cluster, a database server or a host — with the credentials of its own
# environment, read-only unless the operator sets
# ONEUPTIME_AI_ALLOW_WRITES=true. Installed next to each resource's collector
# (the "ai-agent" service of its docker-compose.yml) and selected with
# ONEUPTIME_AI_AGENT_RESOURCE_TYPE.
#

# Alpine, like the other agents. The agent itself is plain JavaScript (no
# native modules); the image adds only the CLIs its executors spawn, each
# from Alpine's own packages:
#   docker-cli       docker / podman hosts and swarm managers (DockerExecutor)
#   govc             VMware vCenter (GovcExecutor)
#   ceph19-common    the ceph CLI (CephExecutor)
#   util-linux-misc  nsenter, to run a host's own programs (HostExecutor)
# Proxmox is reached over its HTTPS API and databases through their Node
# drivers, so neither needs a binary.
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

# Networks that reach OneUptime only through an egress proxy set
# HTTPS_PROXY / HTTP_PROXY / NO_PROXY on the agent. The agent switches Node's
# proxy support on itself at start-up (http.setGlobalProxyFromEnv, see
# Proxy.ts). NODE_USE_ENV_PROXY=1 is NOT set on purpose: with it, Node parses
# those variables before any agent code runs, and one typo (a URL without
# http://) kills the process on every start — a container restarting in a
# loop instead of a log line saying what to fix. The programs the agent
# spawns never see the proxy: each gets an environment built for that one
# command (Executors/SpawnSandbox.ts).

LABEL org.opencontainers.image.title="OneUptime Resource AI Agent"
LABEL org.opencontainers.image.description="OneUptime resource AI agent — runs the commands OneUptime AI asks for on one Docker, Podman or Swarm host, Proxmox or VMware cluster, Ceph cluster, database server or host, with its own credentials (read-only unless you allow fixes)."
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
    && apk add --no-cache ca-certificates tini docker-cli govc ceph19-common util-linux-misc \
    && update-ca-certificates

ENV PRODUCTION=true

WORKDIR /usr/src/app
COPY ./agents/ResourceAIAgent/package*.json /usr/src/app/
# Uses the node image's default cache path (~/.npm) rather than the /tmp/npm
# convention the other images set — npm config was never customized here.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --prefer-offline

# The node base image already ships a non-root `node` user at UID/GID 1000.
# Reuse it rather than creating our own (a second user with GID 1000 cannot be
# created). The agent runs as it by default; the compose files of the kinds
# that need more run the container as root instead (a Docker or Podman
# socket is root-owned, and a host agent enters the host's namespaces) — the
# command policy, not the account, is the limit there. The agent writes
# nothing outside /tmp (its private per-command directories), so it runs
# with a read-only root filesystem and a tmpfs on /tmp.
RUN chown -R node:node /usr/src/app

# Alpine's tini package installs the binary at /sbin/tini.
ENTRYPOINT ["/sbin/tini", "--"]

{{ if eq .Env.ENVIRONMENT "development" }}
USER node
CMD [ "npm", "run", "dev" ]
{{ else }}
COPY --chown=node:node ./agents/ResourceAIAgent /usr/src/app
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
