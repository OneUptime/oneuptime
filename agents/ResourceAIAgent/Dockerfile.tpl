# syntax=docker/dockerfile:1.19
#
# OneUptime Resource AI Agent Dockerfile
#
# Runs the commands OneUptime AI asks for on ONE infrastructure resource —
# a Docker, Podman or Swarm host, a Proxmox cluster, a VMware vCenter, a Ceph
# cluster, a database server, a host, or a cloud account (AWS, Azure, Google
# Cloud) — with the credentials of its own environment, read-only unless the
# operator sets ONEUPTIME_AI_ALLOW_WRITES=true. Installed next to each
# resource's collector (the "ai-agent" service of its docker-compose.yml), or
# for a cloud account in the customer's cloud by its setup command, and
# selected with ONEUPTIME_AI_AGENT_RESOURCE_TYPE.
#
# Syntax 1.19 is the first whose stable channel has COPY --exclude, which keeps
# the agent's tests out of the image (see the copy of the agent below).
#

# govc, from VMware's own release rather than Alpine's package, downloaded
# and verified in its own stage so the download tool never ships, and pinned
# by version AND sha256 per architecture (as the Kubernetes AI agent pins
# kubectl). Alpine 3.24's govc 0.53.0-r4 is built with golang.org/x/text
# 0.34.0, which has two high vulnerabilities fixed in 0.41.0 (GO-2026-5970,
# GO-2026-6629; #9830); govmomi's v0.56.2 release is built with 0.41.0 and
# Go 1.26.10, and changed nothing in how govc reads a command line since 0.53
# (no breaking change in 0.53.1 to 0.56.2), so GovcCommandPolicy holds as
# written. Bump GOVC_VERSION and both digests together (checksums.txt is
# published with each release), whenever a scan reports findings a release
# clears; going back to Alpine's package is fine once Alpine's build is clean.
FROM public.ecr.aws/docker/library/node:26-alpine3.24 AS govc
ARG TARGETARCH
ARG GOVC_VERSION=v0.56.2
ARG GOVC_SHA256_AMD64=12889f30e42e868487041f6628e9789606c80e13a194fb37c099abffc92d5a59
ARG GOVC_SHA256_ARM64=9c34a018300fbb02b943e48f277b9cee8f90ab7a6e6936427ef9f48c1e93af50
RUN set -eu \
  && apk add --no-cache curl \
  && arch="${TARGETARCH:-amd64}" \
  && case "${arch}" in \
       amd64) asset=govc_Linux_x86_64.tar.gz; sha256="${GOVC_SHA256_AMD64}" ;; \
       arm64) asset=govc_Linux_arm64.tar.gz; sha256="${GOVC_SHA256_ARM64}" ;; \
       *) echo "unsupported TARGETARCH ${arch}" >&2; exit 1 ;; \
     esac \
  && curl -fsSL --retry 6 --retry-all-errors -o /tmp/govc.tar.gz \
       "https://github.com/vmware/govmomi/releases/download/${GOVC_VERSION}/${asset}" \
  && echo "${sha256}  /tmp/govc.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/govc.tar.gz -C /tmp govc \
  && install -m 0755 /tmp/govc /usr/bin/govc \
  && rm -f /tmp/govc.tar.gz /tmp/govc \
  && /usr/bin/govc version

# Alpine, like the other agents. The agent itself is plain JavaScript (no
# native modules); the image adds only the CLIs its executors spawn, each
# from Alpine's own packages but govc (the stage above):
#   docker-cli       docker / podman hosts and swarm managers (DockerExecutor)
#   govc             VMware vCenter (GovcExecutor), copied in below
#   ceph19-common    the ceph CLI (CephExecutor)
#   util-linux-misc  nsenter, to run a host's own programs (HostExecutor)
# Proxmox and the clouds are reached over their HTTPS APIs and databases
# through their Node drivers, so none of them needs a binary.
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
LABEL org.opencontainers.image.description="OneUptime resource AI agent — runs the commands OneUptime AI asks for on one Docker, Podman or Swarm host, Proxmox or VMware cluster, Ceph cluster, database server, host or cloud account, with its own credentials (read-only unless you allow fixes)."
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
    && apk add --no-cache ca-certificates tini docker-cli ceph19-common util-linux-misc \
    && update-ca-certificates

# Where Alpine's package put it, on the PATH every executor spawns with.
COPY --from=govc /usr/bin/govc /usr/bin/govc

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
# Without its tests, which no image runs (see packages/Probe/Dockerfile.tpl):
# they stay out of this layer and of what the compile below writes to
# build/dist. `npm test` compiles and runs them on a checkout.
COPY --chown=node:node --exclude=Tests ./agents/ResourceAIAgent /usr/src/app
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
