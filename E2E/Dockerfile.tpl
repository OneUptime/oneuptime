# syntax=docker/dockerfile:1.7
#
# OneUptime-E2E Dockerfile
# This file is used to build the E2E docker image which is used to run the E2E tests.
#

# Pull base image nodejs image.

# Note: Alpine Images don't work with Playwright.
FROM public.ecr.aws/docker/library/node:24.9
RUN mkdir /tmp/npm &&  chmod 2777 /tmp/npm && chown 1000:1000 /tmp/npm && npm config set cache /tmp/npm --global

RUN npm config set fetch-retries 5
RUN npm config set fetch-retry-mintimeout 20000
RUN npm config set fetch-retry-maxtimeout 60000
# Serialize npm lifecycle scripts so esbuild's postinstall doesn't race against
# concurrent package extractions on BuildKit's overlayfs (ETXTBSY on
# /Common/node_modules/esbuild/bin/esbuild). See esbuild#1711, #2785.
RUN npm config set foreground-scripts true


# Per-build args (GIT_SHA / APP_VERSION / IS_ENTERPRISE_EDITION) are declared at
# the bottom so the npm ci / compile layers stay cacheable across commits and
# across the community + enterprise build passes.

LABEL org.opencontainers.image.title="OneUptime E2E"
LABEL org.opencontainers.image.description="OneUptime end-to-end test runner (Playwright-based) for verifying releases."
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.url="https://oneuptime.com"
LABEL org.opencontainers.image.documentation="https://oneuptime.com/docs"
LABEL org.opencontainers.image.vendor="OneUptime"
LABEL org.opencontainers.image.licenses="Apache-2.0"


# Install OS packages in a single layer:
#   - Runtime tools: bash, curl
#   - Build toolchain: python3, make, g++ (removed later, after npm install)
#   - Playwright/Chromium system libs
# `--no-install-recommends` keeps the surface small. apt cache is cleaned in
# the same RUN so package metadata doesn't persist in the layer.
RUN apt-get update && apt-get install -y --no-install-recommends \
        bash \
        curl \
        python3 \
        make \
        g++ \
        libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
        libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
        libgbm1 libgtk-3-0 libpango-1.0-0 libcairo2 libgdk-pixbuf2.0-0 \
        libasound2 libatspi2.0-0 \
    && rm -rf /var/lib/apt/lists/*

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline
COPY ./Common /usr/src/Common

ENV PRODUCTION=true

# Do not show the html report in the browser when job fails. 
ENV PW_TEST_HTML_REPORT_OPEN='never'

WORKDIR /usr/src/app

# Install app dependencies
COPY ./E2E/package*.json /usr/src/app/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline

# Copy app source
COPY ./E2E /usr/src/app

RUN npm run compile

# Remove the build toolchain (python3/make/g++) now that all native npm
# modules have been compiled. This keeps build-time CVEs out of the runtime image.
RUN apt-get purge -y --auto-remove python3 make g++ \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# E2E runs as root (docker-compose mounts host-owned test-results /
# playwright-report dirs over /usr/src/app/...; switching to UID 1000 makes those
# mounts unwritable). /tmp/npm is already world-writable from the base image
# setup, so no extra chown is needed here.
#
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
#Run the app
CMD [ "npm", "test" ]