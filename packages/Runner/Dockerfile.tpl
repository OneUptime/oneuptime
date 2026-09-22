# syntax=docker/dockerfile:1.7
#
# OneUptime Runner Dockerfile
#

# Floating on the 26 major so each rebuild picks up the latest Node security
# patches without manual bumps. Lockfiles still keep JS deps reproducible.
#
# trixie-slim, not the full node:26: the full image is buildpack-deps, which
# preinstalls compilers, kernel headers and ~70 -dev libraries (ImageMagick,
# MariaDB, libxml2, OpenEXR, ...). None of it is used here, but it made up
# nearly all of the ~3,000 OS-package CVEs scanners reported for this image,
# and the purge below could not remove it because the base image owns it.
# trixie is the Debian release node:26 is built on, so package names are the
# same; the command-line tools runbook steps commonly reach for are installed
# explicitly below.
FROM public.ecr.aws/docker/library/node:26-trixie-slim
RUN mkdir /tmp/npm &&  chmod 2777 /tmp/npm && chown 1000:1000 /tmp/npm && npm config set cache /tmp/npm --global

RUN npm config set fetch-retries 5
RUN npm config set fetch-retry-mintimeout 20000
RUN npm config set fetch-retry-maxtimeout 60000
# Serialize npm lifecycle scripts so esbuild's postinstall doesn't race against
# concurrent package extractions on BuildKit's overlayfs (ETXTBSY on
# /Common/node_modules/esbuild/bin/esbuild). See esbuild#1711, #2785.
RUN npm config set foreground-scripts true

# Update npm to npm@latest with every dependency it bundles (tar, undici,
# brace-expansion, ip-address, ...) reinstalled at the newest version npm's own
# ranges accept. `npm install -g npm@latest` alone ships the dependencies npm
# was packed with, and scanners flagged them in every image. See
# Scripts/Docker/UpdateNpmCli.js.
COPY ./Scripts/Docker/UpdateNpmCli.js /tmp/UpdateNpmCli.js
RUN node /tmp/UpdateNpmCli.js && rm /tmp/UpdateNpmCli.js

# Per-build args (GIT_SHA / APP_VERSION) are declared at the bottom so the npm ci
# layers stay cacheable across commits.
ENV NODE_OPTIONS="--use-openssl-ca"

LABEL org.opencontainers.image.title="OneUptime Runner"
LABEL org.opencontainers.image.description="One self-hosted agent that executes runbook steps in your own infrastructure and, when enabled, opens AI code-fix pull requests in your repositories."
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.url="https://oneuptime.com"
LABEL org.opencontainers.image.vendor="OneUptime"
LABEL org.opencontainers.image.licenses="Apache-2.0"

# Trust the same intermediate certs as the rest of the platform. They are
# added to the system store below, once ca-certificates is installed.
COPY ./packages/Common/SslCertificates /usr/local/share/ca-certificates
{{- if file.Exists "SslCertificates" }}
COPY ./SslCertificates /usr/local/share/ca-certificates
{{- end }}


# Upgrade OS packages (Debian security fixes published since the base image
# was built), then install:
#   - bash + tini for process control; git for the code-fix capability
#     (clone, branch, push); ca-certificates for TLS and the certs above.
#   - The command-line tools the full node image used to provide and that
#     Bash runbook steps and remediation commands commonly use: curl, wget,
#     openssh-client, procps (ps, top, kill), unzip, xz-utils, bzip2.
#   - python3/make/g++ as a node-gyp safety net for native npm modules,
#     purged again after the npm installs below. `isolated-vm` (the sandbox
#     used to run JavaScript runbook steps) ships Node 26 prebuilds, so the
#     toolchain normally goes unused; it only kicks in if a prebuild is
#     missing.
RUN apt-get update \
  && apt-get upgrade -y \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    bash ca-certificates curl git tini \
    wget openssh-client procps unzip xz-utils bzip2 \
    python3 make g++ \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

SHELL ["/bin/bash", "-c"]

RUN mkdir -p /usr/src

WORKDIR /usr/src/Common
COPY ./packages/Common/package*.json /usr/src/Common/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline
COPY ./packages/Common /usr/src/Common

ENV PRODUCTION=true

WORKDIR /usr/src/app
COPY ./packages/Runner/package*.json /usr/src/app/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline \
    && apt-get purge -y --auto-remove python3 make g++ \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# Reap zombie children (e.g. `bash -c` processes the agent spawns).
ENTRYPOINT ["/usr/bin/tini", "--"]

{{ if eq .Env.ENVIRONMENT "development" }}
#Run the app
CMD [ "npm", "run", "dev" ]
{{ else }}
# Copy app source. --chown sets node (UID 1000) ownership at copy time so we
# avoid a slow recursive `chown -R` over node_modules; deps stay root-owned and
# world-readable.
COPY --chown=1000:1000 ./packages/Runner /usr/src/app
# Bundle app source. This type-checks the package at build time, which is the
# precondition for TS_NODE_TRANSPILE_ONLY below: without it, disabling the
# boot-time check would leave this service's types verified nowhere at all.
RUN npm run compile
USER node
# Per-build metadata last so the npm ci layers above stay cacheable across commits.
ARG GIT_SHA
ARG APP_VERSION
ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${APP_VERSION}"
# The full TypeScript type-check already ran at build time (`npm run compile`
# above). Without this, ts-node/register redoes it on every container start.
# See App/Dockerfile.tpl for the full rationale.
ENV TS_NODE_TRANSPILE_ONLY=1
#Run the app
CMD [ "npm", "start" ]
{{ end }}
