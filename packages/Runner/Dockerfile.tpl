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
# scans that no rebuild fixes. v1.36.7 (go1.26.11) covers 1.35-1.37 servers.
# Bump KUBECTL_VERSION and both digests together, at least once per
# Kubernetes minor release and whenever a patch release clears findings an
# image scan reports in it (dl.k8s.io publishes kubectl.sha256 next to each
# binary: https://dl.k8s.io/release/<version>/bin/linux/<arch>/kubectl.sha256).
#
# The command policy's comments and tests (packages/Common/Utils/
# AiRemediation) name v1.36.4, the binary its kubectl behaviours were checked
# with. kubectl's own code has changed since only in `kubectl cp` and in
# `kubectl proxy`'s default --reject-paths, two commands the policy refuses
# (v1.36.6 changed nothing but its Go; v1.36.7 changed its Go and added the
# node proxy's run path to those reject paths); re-check them when a bump
# changes more than that.
#
# kubectl 1.33+ reads a kuberc preferences file (aliases, default flags).
# KubectlExecutor switches it off for every AI command (KUBERC=off,
# KUBECTL_KUBERC=false, an empty private HOME) and the argv guard refuses
# --kuberc, so a preferences file can never rewrite an approved argv.
ARG TARGETARCH
ARG KUBECTL_VERSION=v1.36.7
ARG KUBECTL_SHA256_AMD64=b08f96b43904747897fe569b3c51056b00ddfc67847f6db1bf9fe0c9583a2d26
ARG KUBECTL_SHA256_ARM64=4e83edb4cc75beae9dc7cfb42be71899d5397a7b6a2384fbe1ae163d4f544aaf
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

# The JavaScript sandbox's launcher and its no-network filter, as the
# production image installs them. The development Runner runs the sandbox's
# worker from its TypeScript (no bundle: its source is mounted and changes),
# and runs as root, so the launcher works for it whatever its mode.
COPY ./packages/Runner/Utils/JavaScriptSandbox/Native/javascript-sandbox.c /tmp/javascript-sandbox.c
COPY ./packages/Runner/Utils/JavaScriptSandbox/Native/javascript-sandbox-no-network.c /tmp/javascript-sandbox-no-network.c
RUN mkdir -p /usr/lib/oneuptime-runner \
  && gcc -O2 -Wall -Wextra -Werror -Wformat-security -fstack-protector-strong -D_FORTIFY_SOURCE=2 -fPIE -pie -Wl,-z,relro,-z,now \
       -o /usr/lib/oneuptime-runner/javascript-sandbox /tmp/javascript-sandbox.c \
  && gcc -O2 -Wall -Wextra -Werror -Wformat-security -fstack-protector-strong -D_FORTIFY_SOURCE=2 -fPIE -pie -Wl,-z,relro,-z,now \
       -o /usr/lib/oneuptime-runner/javascript-sandbox-no-network /tmp/javascript-sandbox-no-network.c \
  && rm /tmp/javascript-sandbox.c /tmp/javascript-sandbox-no-network.c \
  && chown root:node /usr/lib/oneuptime-runner/javascript-sandbox \
  && chmod 4750 /usr/lib/oneuptime-runner/javascript-sandbox \
  && chown root:root /usr/lib/oneuptime-runner/javascript-sandbox-no-network \
  && chmod 0755 /usr/lib/oneuptime-runner/javascript-sandbox-no-network

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
# Type-check app source. The image runs the JavaScript compiled below without
# checking it, so this is where the Runner's types are checked in the image.
RUN npm run compile

# A global Runner's JavaScript sandbox (Utils/JavaScriptSandbox): each step
# runs in a process of its own. The launcher starts that process as a user of
# its own (setuid root, run by the node group alone; the last stage sets its
# owner and mode again); the no-network filter, which any user may run (mode
# 0755), runs before the worker and sets a seccomp filter that keeps the
# process off every socket. The worker the process runs is one bundle that
# loads no TypeScript: about 0.3 s and 130 MB a step, where ts-node took 2 s
# and 270 MB. The bundle is made before the prune below, so it holds every
# package it uses but isolated-vm, a native addon the Runner keeps. The last
# stage runs all three once.
RUN mkdir -p /usr/lib/oneuptime-runner \
  && gcc -O2 -Wall -Wextra -Werror -Wformat-security -fstack-protector-strong -D_FORTIFY_SOURCE=2 -fPIE -pie -Wl,-z,relro,-z,now \
       -o /usr/lib/oneuptime-runner/javascript-sandbox /usr/src/app/Utils/JavaScriptSandbox/Native/javascript-sandbox.c \
  && gcc -O2 -Wall -Wextra -Werror -Wformat-security -fstack-protector-strong -D_FORTIFY_SOURCE=2 -fPIE -pie -Wl,-z,relro,-z,now \
       -o /usr/lib/oneuptime-runner/javascript-sandbox-no-network /usr/src/app/Utils/JavaScriptSandbox/Native/javascript-sandbox-no-network.c \
  && /usr/src/Common/node_modules/.bin/esbuild /usr/src/app/Utils/JavaScriptSandbox/SandboxWorker.ts \
       --bundle --platform=node --target=node26 --external:isolated-vm --tsconfig=/usr/src/app/tsconfig.json \
       --legal-comments=none --log-level=warning --outfile=/usr/lib/oneuptime-runner/javascript-sandbox-worker.js

# Compile the Runner's TypeScript and Common's to JavaScript, each file beside
# its TypeScript, as ts-node compiled them when the image ran it: the Runner
# runs JavaScript, and loads neither TypeScript nor ts-node. After the
# sandbox's bundle, which is built from the TypeScript alone. See
# App/Dockerfile.tpl.
RUN node /usr/src/Common/Server/Utils/TsNode/Precompile.js --project /usr/src/app/tsconfig.json --root /usr/src/app --root /usr/src/Common

# Leave in /usr/src only what the Runner runs: Common pruned to the packages
# its imports and the stack-trace support its start command requires reach
# (see the script's header), the Runner without its own development packages
# (ts-node and TypeScript go with them: it runs the JavaScript compiled above,
# and the check after the prune holds it to that), and neither package's tests
# nor the type-check's output. npm's download cache stays behind in this
# stage.
COPY ./Scripts/Docker/PruneUnreachablePackages.js /tmp/PruneUnreachablePackages.js
RUN node /tmp/PruneUnreachablePackages.js --entry /usr/src/app/Index.ts --entry /usr/src/Common/Server/Utils/TsNode/PrecompiledSourceMaps.js --package /usr/src/Common \
    && npm prune --omit=dev --offline --no-audit --no-fund \
    && node -e "for (const name of ['ts-node', 'typescript']) for (const from of ['/usr/src/app', '/usr/src/Common']) { let found = ''; try { found = require.resolve(name, { paths: [from] }); } catch {} if (found) throw new Error(found + ' is still installed, and the image runs JavaScript'); }" \
    && rm -rf /tmp/PruneUnreachablePackages.js /usr/src/Common/Tests /usr/src/app/build /usr/src/app/Tests

# ---------------------------------------------------------------------------
# The image that ships: the base, and the Runner as the build stage left it.
# ---------------------------------------------------------------------------
FROM base

COPY --from=build /usr/src /usr/src
COPY --from=build /usr/lib/oneuptime-runner /usr/lib/oneuptime-runner

# The launcher is root's and the node group's alone: setuid, and runnable by
# the Runner (node) and nobody else - never by a step's own user, which is in
# no group. The no-network filter is root's, runnable by everyone (every step
# user must exec it), and never setuid: it needs no privilege. The bundle and
# the folder are root's, read by everyone. Then each runs once, in the image
# as it ships (pruned): the launcher must answer a call it does not know with
# its usage code (64), the no-network filter's check must pass (0, the kernel
# lets a process filter its own system calls), and the bundle must load,
# isolated-vm with it, and refuse an empty request (2).
RUN chown root:root /usr/lib/oneuptime-runner /usr/lib/oneuptime-runner/javascript-sandbox-worker.js /usr/lib/oneuptime-runner/javascript-sandbox-no-network \
  && chmod 0755 /usr/lib/oneuptime-runner \
  && chmod 0644 /usr/lib/oneuptime-runner/javascript-sandbox-worker.js \
  && chmod 0755 /usr/lib/oneuptime-runner/javascript-sandbox-no-network \
  && chown root:node /usr/lib/oneuptime-runner/javascript-sandbox \
  && chmod 4750 /usr/lib/oneuptime-runner/javascript-sandbox \
  && { /usr/lib/oneuptime-runner/javascript-sandbox 2>/dev/null; test $? -eq 64; } \
  && { /usr/lib/oneuptime-runner/javascript-sandbox-no-network check; test $? -eq 0; } \
  && { echo '' | NODE_PATH=/usr/src/Common/node_modules node --no-node-snapshot /usr/lib/oneuptime-runner/javascript-sandbox-worker.js 3>/dev/null 4>/dev/null; test $? -eq 2; }

WORKDIR /usr/src/app
USER node
# Per-build metadata last so the npm ci layers above stay cacheable across commits.
ARG GIT_SHA
ARG APP_VERSION
ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${APP_VERSION}"
# Run the app: package.json's start script, through sh instead of npm, so npm
# is not a second Node.js process beside the runner. tini stays PID 1 and reaps
# the commands it runs. The script sizes node's heap to the container's memory
# limit first, then runs the JavaScript compiled in the build stage. See
# App/Dockerfile.tpl for all three.
CMD [ "sh", "-c", "heap=8096; for file in \"/sys/fs/cgroup$(sed -n 's/^0:://p' /proc/self/cgroup 2>/dev/null)/memory.max\" /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory/memory.limit_in_bytes; do limit=$(cat \"$file\" 2>/dev/null); case $limit in ''|*[!0-9]*|????????????????*) ;; *) heap=$((limit / 1048576 * 3 / 4)); [ $heap -ge 256 ] || heap=256; [ $heap -le 8096 ] || heap=8096; break ;; esac; done; export NODE_OPTIONS=\"--max-old-space-size=$heap${NODE_OPTIONS:+ $NODE_OPTIONS}\" && exec node --no-node-snapshot --require Common/Server/Utils/TsNode/PrecompiledSourceMaps.js Index.js" ]
{{ end }}
