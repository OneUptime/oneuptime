# syntax=docker/dockerfile:1.7
#
# OneUptime Runbook Agent Dockerfile
#

# Floating on the 26 major so each rebuild picks up the latest Node security
# patches without manual bumps. Lockfiles still keep JS deps reproducible.
FROM public.ecr.aws/docker/library/node:26
RUN mkdir /tmp/npm &&  chmod 2777 /tmp/npm && chown 1000:1000 /tmp/npm && npm config set cache /tmp/npm --global

RUN npm config set fetch-retries 5
RUN npm config set fetch-retry-mintimeout 20000
RUN npm config set fetch-retry-maxtimeout 60000
# Serialize npm lifecycle scripts so esbuild's postinstall doesn't race against
# concurrent package extractions on BuildKit's overlayfs (ETXTBSY on
# /Common/node_modules/esbuild/bin/esbuild). See esbuild#1711, #2785.
RUN npm config set foreground-scripts true

# Upgrade the bundled npm CLI so its vendored deps (tar, glob, minimatch,
# brace-expansion, diff, ip-address, picomatch, ...) pick up security fixes
# that the base image's npm still carries.
RUN npm install -g npm@latest

# Per-build args (GIT_SHA / APP_VERSION) are declared at the bottom so the npm ci
# layers stay cacheable across commits.
ENV NODE_OPTIONS="--use-openssl-ca"

LABEL org.opencontainers.image.title="OneUptime Runbook Agent"
LABEL org.opencontainers.image.description="Executes Bash runbook steps in your own infrastructure and reports results back to OneUptime."
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.url="https://oneuptime.com"
LABEL org.opencontainers.image.vendor="OneUptime"
LABEL org.opencontainers.image.licenses="Apache-2.0"

# Trust the same intermediate certs as the rest of the platform.
COPY ./SslCertificates /usr/local/share/ca-certificates
RUN update-ca-certificates


# Upgrade OS packages (Debian security fixes published since the base image
# was built), then install bash + tini for process control and python3/make/g++
# as a node-gyp safety net for native npm modules. `isolated-vm` (the sandbox
# used to run JavaScript runbook steps) ships Node 26 prebuilds, so the
# toolchain normally goes unused; it only kicks in if a prebuild is missing.
RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y bash curl tini python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

SHELL ["/bin/bash", "-c"]

RUN mkdir -p /usr/src

WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline
COPY ./Common /usr/src/Common

ENV PRODUCTION=true

WORKDIR /usr/src/app
COPY ./RunbookAgent/package*.json /usr/src/app/
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
COPY --chown=1000:1000 ./RunbookAgent /usr/src/app
USER node
# Per-build metadata last so the npm ci layers above stay cacheable across commits.
ARG GIT_SHA
ARG APP_VERSION
ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${APP_VERSION}"
#Run the app
CMD [ "npm", "start" ]
{{ end }}
