# syntax=docker/dockerfile:1.7
#
# OneUptime-AIAgent Dockerfile
#

# Pull base image nodejs image.
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


# Per-build args (GIT_SHA / APP_VERSION / IS_ENTERPRISE_EDITION) are declared at
# the bottom so the npm ci / compile layers stay cacheable across commits and
# across the community + enterprise build passes.
ENV NODE_OPTIONS="--use-openssl-ca"

LABEL org.opencontainers.image.title="OneUptime AI Agent"
LABEL org.opencontainers.image.description="OneUptime AI agent service that powers incident triage, summarization, and autonomous workflows."
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.url="https://oneuptime.com"
LABEL org.opencontainers.image.documentation="https://oneuptime.com/docs"
LABEL org.opencontainers.image.vendor="OneUptime"
LABEL org.opencontainers.image.licenses="Apache-2.0"

# Upgrade OS packages (Debian security fixes published since the base image
# was built) and install runtime tools (bash, curl, ca-certificates) in a
# single layer with cache cleanup. ca-certificates is required by
# `update-ca-certificates` below.
RUN apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        bash \
        curl \
    && rm -rf /var/lib/apt/lists/*

## Add Intermediate Certs (ca-certificates is now installed above)
COPY ./SslCertificates /usr/local/share/ca-certificates
RUN update-ca-certificates

# Install OpenCode AI coding assistant. The installer defaults to
# $HOME/.opencode (i.e. /root/.opencode), which is unreachable from non-root
# users because /root is mode 700. Relocate to /usr/local/opencode so the
# `node` user can read+execute the CLI when we drop privileges below.
RUN curl -fsSL https://opencode.ai/install | bash \
    && mv /root/.opencode /usr/local/opencode \
    && chmod -R a+rx /usr/local/opencode
ENV PATH="/usr/local/opencode/bin:${PATH}"

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

RUN mkdir -p /usr/src

WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline
COPY ./Common /usr/src/Common


ENV PRODUCTION=true

WORKDIR /usr/src/app

# Install app dependencies
COPY ./AIAgent/package*.json /usr/src/app/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline

# Expose ports.
#   - 3875: OneUptime-AIAgent
EXPOSE 3875

{{ if eq .Env.ENVIRONMENT "development" }}
#Run the app
CMD [ "npm", "run", "dev" ]
{{ else }}
# Copy app source. --chown sets node (UID 1000) ownership at copy time so we
# avoid a slow recursive `chown -R` over node_modules; deps stay root-owned and
# world-readable.
COPY --chown=1000:1000 ./AIAgent /usr/src/app
# Bundle app source
RUN npm run compile
USER node
# Per-build metadata last so the community + enterprise passes share every heavy
# cached layer above — only this final metadata layer differs between them.
ARG GIT_SHA
ARG APP_VERSION
ARG IS_ENTERPRISE_EDITION=false
ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
ENV IS_ENTERPRISE_EDITION=${IS_ENTERPRISE_EDITION}
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${APP_VERSION}"
#Run the app
CMD [ "npm", "start" ]
{{ end }}
