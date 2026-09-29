# syntax=docker/dockerfile:1.7
#
# OneUptime-E2E Dockerfile
# This file is used to build the E2E docker image which is used to run the E2E tests.
#

# Pull base image nodejs image.

# Note: Alpine Images don't work with Playwright.
# Floating on the 26 major so each rebuild picks up the latest Node security
# patches without manual bumps. Lockfiles still keep JS deps reproducible.
# The Debian release is pinned (bookworm), as it is for the Probe, so the two
# Playwright images install their browsers on the same distribution.
#
# bookworm-slim, not the full node:26-bookworm: the full image is
# buildpack-deps, which preinstalls compilers, kernel headers and ~70 -dev
# libraries this image never uses. They were most of the ~4,000 OS-package
# CVEs scanners reported for it, and the toolchain purge at the end could not
# remove them because the base image owns them.
FROM public.ecr.aws/docker/library/node:26-bookworm-slim
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


# Upgrade OS packages (Debian security fixes published since the base image
# was built) and install OS packages in a single layer:
#   - Runtime tools: bash, curl (the failure webhook in `npm test`) and
#     ca-certificates, which the slim base image does not have
#   - Build toolchain: python3, make, g++ (removed later, after npm install)
# The browsers' own system libraries are installed with the browsers below
# (`playwright install --with-deps`), so the list always matches the
# Playwright version in the lockfile.
# `--no-install-recommends` keeps the surface small. apt cache is cleaned in
# the same RUN so package metadata doesn't persist in the layer.
RUN apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        python3 \
        make \
        g++ \
    && rm -rf /var/lib/apt/lists/*

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

WORKDIR /usr/src/Common
COPY ./packages/Common/package*.json /usr/src/Common/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline
COPY ./packages/Common /usr/src/Common

ENV PRODUCTION=true

# Do not show the html report in the browser when job fails. 
ENV PW_TEST_HTML_REPORT_OPEN='never'

WORKDIR /usr/src/app

# Install app dependencies.
# --ignore-scripts skips the package's `preinstall` hook
# (`npx playwright install-deps && npx playwright install`), which is there
# for local checkouts. Run before the dependencies exist, its `npx
# playwright` is whatever release is newest on the registry, not the locked
# one, so in the image it installed a second set of browsers, WebKit, and
# WebKit's system libraries (GStreamer, FFmpeg, libsoup, ...): none of them
# used by the suite, all of them in the scan. No dependency of this package
# has an install script of its own.
COPY ./packages/E2E/package*.json /usr/src/app/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline --ignore-scripts

# Install the Playwright browsers the suite runs (chromium and firefox) for
# the LOCKED playwright version (node_modules/.bin/playwright from the npm ci
# above), with their system libraries. `--with-deps` apt-installs those, so
# refresh the apt lists first and drop them again in the same layer.
# libavcodec59 (the FFmpeg stack Playwright lists for Firefox) is removed again,
# as in the Probe image: Firefox only uses it to decode MP4/H.264, which no
# test plays (see packages/Probe/Dockerfile.tpl).
RUN apt-get update \
    && npx playwright install --with-deps chromium firefox \
    && apt-get purge -y --auto-remove libavcodec59 \
    && rm -rf /var/lib/apt/lists/*

# Copy app source
COPY ./packages/E2E /usr/src/app

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