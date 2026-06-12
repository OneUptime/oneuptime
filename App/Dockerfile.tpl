# syntax=docker/dockerfile:1.7
#
# OneUptime-App Dockerfile
#

# Pull base image nodejs image.
# Floating on the 24.x patch + alpine3.24 so each rebuild picks up the latest
# Node and Alpine security patches without manual bumps. Lockfiles still keep
# JS deps reproducible.
FROM public.ecr.aws/docker/library/node:24-alpine3.24
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



# Per-build args (GIT_SHA / APP_VERSION / IS_ENTERPRISE_EDITION) are declared
# further down so the expensive npm ci / build layers stay cacheable across
# commits and across the community + enterprise build passes.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

LABEL org.opencontainers.image.title="OneUptime App"
LABEL org.opencontainers.image.description="OneUptime core application server — dashboard API, workers, and telemetry ingestion."
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.url="https://oneuptime.com"
LABEL org.opencontainers.image.documentation="https://oneuptime.com/docs"
LABEL org.opencontainers.image.vendor="OneUptime"
LABEL org.opencontainers.image.licenses="Apache-2.0"




# Upgrade OS packages, then install runtime tools + build toolchain.
# `apk upgrade` pulls in Alpine security fixes published since the base image
# was built. Build toolchain (.gyp virtual) is installed temporarily for
# native npm modules and is removed after all npm installs complete (see
# `apk del .gyp` below). --no-cache avoids retaining apk index data in the
# image layer.
RUN apk upgrade --no-cache \
    && apk add --no-cache bash curl \
    && apk add --no-cache --virtual .gyp python3 make g++

#Use bash shell by default
SHELL ["/bin/bash", "-c"]


RUN mkdir /usr/src

WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline
COPY ./Common /usr/src/Common

ENV PRODUCTION=true

WORKDIR /usr/src/app

# Install app dependencies
COPY ./App/package*.json /usr/src/app/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline

WORKDIR /usr/src/app/FeatureSet/Accounts
COPY ./App/FeatureSet/Accounts/package*.json /usr/src/app/FeatureSet/Accounts/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline

WORKDIR /usr/src/app/FeatureSet/Dashboard
COPY ./App/FeatureSet/Dashboard/package*.json /usr/src/app/FeatureSet/Dashboard/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline

WORKDIR /usr/src/app/FeatureSet/AdminDashboard
COPY ./App/FeatureSet/AdminDashboard/package*.json /usr/src/app/FeatureSet/AdminDashboard/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline

WORKDIR /usr/src/app/FeatureSet/StatusPage
COPY ./App/FeatureSet/StatusPage/package*.json /usr/src/app/FeatureSet/StatusPage/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline

WORKDIR /usr/src/app/FeatureSet/PublicDashboard
COPY ./App/FeatureSet/PublicDashboard/package*.json /usr/src/app/FeatureSet/PublicDashboard/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline

# Remove the build toolchain (python3/make/g++) now that all native npm modules
# have been compiled. This keeps build-time CVEs out of the runtime image.
RUN apk del .gyp

WORKDIR /usr/src/app

# Expose ports.
#   - 3002: OneUptime-backend
EXPOSE 3002

{{ if eq .Env.ENVIRONMENT "development" }}
#Run the app
CMD [ "npm", "run", "dev" ]
{{ else }}
# Per-build version args. Declared here (not at the top) so the npm ci layers
# above stay cacheable across commits. GIT_SHA/APP_VERSION must be set BEFORE
# build-frontends:prod because the service worker bakes the version in at build
# time (see Common/Scripts/generate-service-worker.js).
ARG GIT_SHA
ARG APP_VERSION
ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${APP_VERSION}"
# Copy app source. --chown sets node (UID 1000) ownership at copy time so we
# avoid a slow recursive `chown -R` over node_modules; deps stay root-owned and
# world-readable, which the node user can still read.
COPY --chown=1000:1000 ./App /usr/src/app
# Copy frontend sources
COPY --chown=1000:1000 ./App/FeatureSet/Accounts /usr/src/app/FeatureSet/Accounts
COPY --chown=1000:1000 ./App/FeatureSet/Dashboard /usr/src/app/FeatureSet/Dashboard
COPY --chown=1000:1000 ./App/FeatureSet/AdminDashboard /usr/src/app/FeatureSet/AdminDashboard
COPY --chown=1000:1000 ./App/FeatureSet/StatusPage /usr/src/app/FeatureSet/StatusPage
COPY --chown=1000:1000 ./App/FeatureSet/PublicDashboard /usr/src/app/FeatureSet/PublicDashboard
# Bundle frontend source
RUN npm run build-frontends:prod
# Bundle app source
RUN npm run compile
# IS_ENTERPRISE_EDITION only changes ENV/LABEL metadata and is read by no build
# step, so declaring it last lets the community and enterprise passes share every
# heavy cached layer above — only this final metadata layer differs.
ARG IS_ENTERPRISE_EDITION=false
ENV IS_ENTERPRISE_EDITION=${IS_ENTERPRISE_EDITION}
USER node
#Run the app
CMD [ "npm", "start" ]
{{ end }}
