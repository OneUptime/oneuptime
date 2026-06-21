# syntax=docker/dockerfile:1.7
#
# OneUptime-Probe Dockerfile
#

# Pull base image nodejs image.
# Floating on the 26.x patch + bookworm-slim so each rebuild picks up the
# latest Node and Debian security patches without manual bumps. Lockfiles
# still keep JS deps reproducible. The slim variant drops the full image's
# preinstalled toolchain (and its hundreds of OS-package CVEs); everything the
# probe needs is installed explicitly below. The Debian release is pinned
# (bookworm) because the apt package list below is release-specific (e.g.
# libgdk-pixbuf2.0-0 has no install candidate on trixie).
FROM public.ecr.aws/docker/library/node:26-bookworm-slim
RUN mkdir /tmp/npm &&  chmod 2777 /tmp/npm && chown 1000:1000 /tmp/npm && npm config set cache /tmp/npm --global

RUN npm config set fetch-retries 5
RUN npm config set fetch-retry-mintimeout 20000
RUN npm config set fetch-retry-maxtimeout 60000

# Upgrade the bundled npm CLI so its vendored deps (tar, glob, minimatch,
# brace-expansion, diff, ip-address, picomatch, ...) pick up security fixes
# that the base image's npm still carries.
RUN npm install -g npm@latest


ARG GIT_SHA
ARG APP_VERSION

ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
# IS_ENTERPRISE_EDITION is declared in the prod branch below (it is read by no
# build step, so keeping it out of scope here lets the community + enterprise
# passes share the npm ci / compile layers). GIT_SHA/APP_VERSION stay here
# because APP_VERSION is consumed at build time (sed into Common/package.json).
ENV NODE_OPTIONS="--use-openssl-ca"

LABEL org.opencontainers.image.title="OneUptime Probe"
LABEL org.opencontainers.image.description="OneUptime monitoring probe — runs HTTP, TCP, ping, SSL, and synthetic monitors from any location."
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.url="https://oneuptime.com"
LABEL org.opencontainers.image.documentation="https://oneuptime.com/docs/probe/custom-probe"
LABEL org.opencontainers.image.vendor="OneUptime"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${APP_VERSION}"

## Add Intermediate Certs
COPY ./SslCertificates /usr/local/share/ca-certificates


# IF APP_VERSION is not set, set it to 1.0.0
RUN if [ -z "$APP_VERSION" ]; then export APP_VERSION=1.0.0; fi


# Upgrade OS packages and install everything the probe needs in one layer:
#   - Runtime tools: bash, curl, iputils-ping, net-tools, dnsutils (dig is
#     used in DNSSEC validation), traceroute (NetworkPathMonitor execs it on
#     Linux; it was missing from the old full image too)
#   - tini: a tiny init for containers to properly reap zombie processes
#   - ca-certificates: required by update-ca-certificates (intermediate certs
#     copied above)
#   - Build toolchain: python3, make, g++ (node-gyp / native npm modules)
#   - Playwright/Chromium system libraries
# apt lists are removed in the same RUN so package metadata doesn't persist
# in the layer.
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
        bash curl iputils-ping net-tools dnsutils traceroute tini ca-certificates \
        python3 make g++ \
        libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
        libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
        libgbm1 libgtk-3-0 libpango-1.0-0 libcairo2 libgdk-pixbuf2.0-0 \
        libasound2 libatspi2.0-0 \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

RUN mkdir -p /usr/src

WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
# Set version in ./Common/package.json to the APP_VERSION
RUN sed -i "s/\"version\": \".*\"/\"version\": \"$APP_VERSION\"/g" /usr/src/Common/package.json
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline
COPY ./Common /usr/src/Common











ENV PRODUCTION=true

WORKDIR /usr/src/app
# Install app dependencies first so local Playwright CLI is available
COPY ./Probe/package*.json /usr/src/app/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline

# Install browsers to a fixed path accessible by any runtime user (root or non-root)
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright-browsers
# `--with-deps` apt-installs any remaining browser dependencies (fonts, webkit
# libs, ...), so refresh the apt lists first and drop them again afterwards.
RUN apt-get update \
    && npx playwright install --with-deps \
    && rm -rf /var/lib/apt/lists/* \
    && chmod -R 755 /ms-playwright-browsers

# Use tini as init to properly reap zombie processes (like Chrome/Chromium)
ENTRYPOINT ["/usr/bin/tini", "--"]

{{ if eq .Env.ENVIRONMENT "development" }}
#Run the app
CMD [ "bash", "/usr/src/app/Start.dev.sh" ]
{{ else }}
# Copy app source
COPY ./Probe /usr/src/app
# Bundle app source
RUN npm run compile
# IS_ENTERPRISE_EDITION only changes ENV metadata and is read by no build step,
# so declaring it last lets the community + enterprise passes share the heavy
# cached layers above. (/tmp/npm is already world-writable from the base setup,
# so no extra chown is needed for non-root runtimes.)
ARG IS_ENTERPRISE_EDITION=false
ENV IS_ENTERPRISE_EDITION=${IS_ENTERPRISE_EDITION}
#Run the app
CMD [ "npm", "start" ]
{{ end }}
