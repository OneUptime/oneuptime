# syntax=docker/dockerfile:1.7
#
# OneUptime Runner Dockerfile
#
# Stage graph (production):
#
#   base   Node.js, the tools runbook steps reach for, kubectl
#     -> build  installs, type-checks and prunes the Runner and Common
#     \-> (last) copies only /usr/src out of build
#
# The Runner imports a part of Common, but Common's package.json lists every
# package any part of OneUptime needs: installed in the image that ships, that
# was 810 MB of packages (the Dashboard's diagrams and charts, React,
# Playwright, Twilio, ...) and Common's 181 MB of tests, for a Runner that
# loads a fraction of them, and the build toolchain stayed in the layer that
# installed it even after it was purged. Now the build stage installs,
# type-checks and prunes Common to the packages the Runner reaches
# (Scripts/Docker/PruneUnreachablePackages.js), the Runner's own development
# packages go, and the image copies /usr/src out of it. The development image
# (ENVIRONMENT=development) is the base stage with everything installed, as
# before. Tests/Ops/ContainerImageHardening.test.js holds the stages to this.

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
FROM public.ecr.aws/docker/library/node:26-trixie-slim AS base
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
LABEL org.opencontainers.image.description="One self-hosted agent that executes runbook steps in your own infrastructure, runs kubectl for OneUptime AI on the clusters it is given access to, and, when enabled, opens AI code-fix pull requests in your repositories."
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
# The build toolchain for native npm modules is not here: the build stage
# (and the development image) install it for the npm installs, and the image
# that ships never has it.
RUN apt-get update \
  && apt-get upgrade -y \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    bash ca-certificates curl git tini \
    wget openssh-client procps unzip xz-utils bzip2 \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

SHELL ["/bin/bash", "-c"]

# kubectl, for the AI cluster-access capability: OneUptime AI runs read-only
# kubectl during investigations and policy-tiered kubectl fixes during
# remediations through this Runner (in-cluster via the kubernetes-agent chart,
# or wherever a Kubernetes credential is assigned). Pinned by version AND
# sha256 per architecture so a rebuild can never pick up a different binary.
#
# Keep it on a SUPPORTED minor in the middle of the supported cluster range:
# kubectl is only supported within one minor of the API server, and each
# release is built with the Go of its day, so a stale pin means version-skew
# warnings on every "Test access" and a block of Go stdlib CVEs in image
# scans that no rebuild fixes. v1.36.5 (go1.26.8) covers 1.35-1.37 servers.
# Bump KUBECTL_VERSION and both digests together, at least once per
# Kubernetes minor release and whenever a patch release clears findings an
# image scan reports in it (dl.k8s.io publishes kubectl.sha256 next to each
# binary: https://dl.k8s.io/release/<version>/bin/linux/<arch>/kubectl.sha256).
#
# The command policy's comments and tests (packages/Common/Utils/
# AiRemediation) name v1.36.4, the binary its kubectl behaviours were checked
# with. kubectl's own code is the same in v1.36.5 but for `kubectl cp`, which
# the policy refuses; re-check them when a bump changes more than that.
#
# kubectl 1.33+ reads a kuberc preferences file (aliases, default flags).
# KubectlExecutor switches it off for every AI command (KUBERC=off,
# KUBECTL_KUBERC=false, an empty private HOME) and the argv guard refuses
# --kuberc, so a preferences file can never rewrite an approved argv.
ARG TARGETARCH
ARG KUBECTL_VERSION=v1.36.5
ARG KUBECTL_SHA256_AMD64=33bc88a24c3b09cf55bfd59e6ca977881b61fc3f25ab65bc80c65b430248648e
ARG KUBECTL_SHA256_ARM64=88fc1aca8fd0c1b44fe379f67c39bd6858bdfc50241dc55775f84d0f5b31da3a
RUN set -euo pipefail \
  && arch="${TARGETARCH:-amd64}" \
  && case "${arch}" in \
       amd64) sha256="${KUBECTL_SHA256_AMD64}" ;; \
       arm64) sha256="${KUBECTL_SHA256_ARM64}" ;; \
       *) echo "unsupported TARGETARCH ${arch}" >&2; exit 1 ;; \
     esac \
  && curl -fsSL --retry 6 --retry-all-errors -o /tmp/kubectl \
       "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${arch}/kubectl" \
  && echo "${sha256}  /tmp/kubectl" | sha256sum -c - \
  && install -o root -g root -m 0755 /tmp/kubectl /usr/local/bin/kubectl \
  && rm -f /tmp/kubectl \
  && kubectl version --client

RUN mkdir -p /usr/src

ENV PRODUCTION=true

# Reap zombie children (e.g. `bash -c` processes the agent spawns).
ENTRYPOINT ["/usr/bin/tini", "--"]

{{ if eq .Env.ENVIRONMENT "development" }}
# The development image installs everything where it runs, as it always has:
# python3/make/g++ as a node-gyp safety net for native npm modules, purged
# again in the layer that installs the Runner's own packages. `isolated-vm`
# (the sandbox used to run JavaScript runbook steps) ships Node 26 prebuilds,
# so the toolchain normally goes unused; it only kicks in if a prebuild is
# missing.
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/Common
COPY ./packages/Common/package*.json /usr/src/Common/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline
COPY ./packages/Common /usr/src/Common

WORKDIR /usr/src/app
COPY ./packages/Runner/package*.json /usr/src/app/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline \
    && apt-get purge -y --auto-remove python3 make g++ \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

#Run the app
CMD [ "npm", "run", "dev" ]
{{ else }}
# ---------------------------------------------------------------------------
# build: installs the Runner's packages and Common's, type-checks the Runner
# and prunes both. None of this stage's layers ship: the last stage copies
# /usr/src out of it.
# ---------------------------------------------------------------------------
FROM base AS build

# python3/make/g++ as a node-gyp safety net for native npm modules.
# `isolated-vm` (the sandbox used to run JavaScript runbook steps) and ssh2
# ship Node 26 prebuilds, so the toolchain normally goes unused; it only kicks
# in if a prebuild is missing. It stays in this stage.
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/Common
COPY ./packages/Common/package*.json /usr/src/Common/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline
COPY ./packages/Common /usr/src/Common

WORKDIR /usr/src/app
COPY ./packages/Runner/package*.json /usr/src/app/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline

# Copy app source. --chown sets node (UID 1000) ownership at copy time so we
# avoid a slow recursive `chown -R` over node_modules; deps stay root-owned and
# world-readable. The last stage's copy keeps both owners.
COPY --chown=1000:1000 ./packages/Runner /usr/src/app
# Bundle app source. This type-checks the package at build time, which is the
# precondition for TS_NODE_TRANSPILE_ONLY below: without it, disabling the
# boot-time check would leave this service's types verified nowhere at all.
RUN npm run compile

# Leave in /usr/src only what the Runner runs: Common pruned to the packages
# its imports reach (see the script's header), the Runner without its own
# development packages (ts-node keeps TypeScript, which it runs on), and
# neither package's tests nor the type-check's output (ts-node runs
# Index.ts). npm's download cache stays behind in this stage.
COPY ./Scripts/Docker/PruneUnreachablePackages.js /tmp/PruneUnreachablePackages.js
RUN node /tmp/PruneUnreachablePackages.js --entry /usr/src/app/Index.ts --package /usr/src/Common \
    && npm prune --omit=dev --offline --no-audit --no-fund \
    && node -e "require('ts-node'); require('typescript')" \
    && rm -rf /tmp/PruneUnreachablePackages.js /usr/src/Common/Tests /usr/src/app/build /usr/src/app/Tests

# ---------------------------------------------------------------------------
# The image that ships: the base, and the Runner as the build stage left it.
# ---------------------------------------------------------------------------
FROM base

COPY --from=build /usr/src /usr/src

WORKDIR /usr/src/app
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
# Run the app: package.json's start script, through sh instead of npm, so npm
# is not a second Node.js process beside the runner. tini stays PID 1 and reaps
# the commands it runs. See App/Dockerfile.tpl for why.
CMD [ "sh", "-c", "export NODE_OPTIONS=\"--max-old-space-size=8096${NODE_OPTIONS:+ $NODE_OPTIONS}\" && exec node --no-node-snapshot --require ts-node/register Index.ts" ]
{{ end }}
