# syntax=docker/dockerfile:1.7
#
# OneUptime-App Dockerfile
#
# The production branch (after the `else` below) builds BOTH editions of the
# App image from this one file:
#
#   --target community    the Community Edition. Apache-2.0 code only: ee/ is
#                         never copied in. It is the LAST stage, so it is also
#                         what a plain `docker build` without --target produces.
#   --target enterprise   the Enterprise Edition: the Community build plus the
#                         ee/ directory (licensed under ee/LICENSE), with the
#                         Dashboard and Admin Dashboard bundles rebuilt to
#                         include the Enterprise UI.
#
# Stage graph:
#
#   base -> community-build -> enterprise-build -> enterprise
#                           \-> community
#
# BuildKit builds only the stages the chosen target needs, so the community
# target never evaluates `COPY ./ee` and builds from a context without ee/, and
# the enterprise target reuses every cached community-build layer.
# Scripts/GHA/build_docker_images.sh publishes both targets, and the Build
# workflow (.github/workflows/build.yml) builds both on every pull request and
# checks what each image contains.

# Pull base image nodejs image.
# Floating on the 26.x patch + alpine3.24 so each rebuild picks up the latest
# Node and Alpine security patches without manual bumps. Lockfiles still keep
# JS deps reproducible.
FROM public.ecr.aws/docker/library/node:26-alpine3.24 AS base
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



# Per-build args (GIT_SHA / APP_VERSION) are declared further down so the
# expensive npm ci / build layers stay cacheable across commits and are shared
# by the community and enterprise targets.
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
COPY ./packages/Common/package*.json /usr/src/Common/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline
COPY ./packages/Common /usr/src/Common

ENV PRODUCTION=true

WORKDIR /usr/src/app

# Install app dependencies
COPY ./packages/App/package*.json /usr/src/app/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline

WORKDIR /usr/src/app/FeatureSet/Accounts
COPY ./packages/App/FeatureSet/Accounts/package*.json /usr/src/app/FeatureSet/Accounts/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline

WORKDIR /usr/src/app/FeatureSet/Dashboard
COPY ./packages/App/FeatureSet/Dashboard/package*.json /usr/src/app/FeatureSet/Dashboard/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline

WORKDIR /usr/src/app/FeatureSet/AdminDashboard
COPY ./packages/App/FeatureSet/AdminDashboard/package*.json /usr/src/app/FeatureSet/AdminDashboard/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline

WORKDIR /usr/src/app/FeatureSet/StatusPage
COPY ./packages/App/FeatureSet/StatusPage/package*.json /usr/src/app/FeatureSet/StatusPage/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline

WORKDIR /usr/src/app/FeatureSet/PublicDashboard
COPY ./packages/App/FeatureSet/PublicDashboard/package*.json /usr/src/app/FeatureSet/PublicDashboard/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline

# The session-replay browser recorder. Its own tiny dependency set (rrweb,
# pinned exactly) rather than Common's, because this bundle is served to
# third-party origins and must not carry any server dependency.
WORKDIR /usr/src/app/FeatureSet/BrowserRecorder
COPY ./packages/App/FeatureSet/BrowserRecorder/package*.json /usr/src/app/FeatureSet/BrowserRecorder/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline

# Remove the build toolchain (python3/make/g++) now that all native npm modules
# have been compiled. This keeps build-time CVEs out of the runtime image.
RUN apk del .gyp

WORKDIR /usr/src/app

# Expose ports.
#   - 3002: OneUptime-backend
EXPOSE 3002

{{ if eq .Env.ENVIRONMENT "development" }}
# ee/ is never copied into the development image, so it builds without ee/.
# Scripts/Dev/docker-compose.dev.yml bind-mounts ee/ at /usr/src/ee instead,
# and scripts/dev.sh installs ee's own dependencies when it is there.
#
# ee/package.json links Common and App as file:../packages/{Common,App} (the
# repository layout). These links recreate that layout in the container, so
# ee's node_modules/{Common,App} resolve to /usr/src/Common and /usr/src/app:
# the files the App runs, one module instance each.
RUN mkdir -p /usr/src/packages \
    && ln -s ../Common /usr/src/packages/Common \
    && ln -s ../app /usr/src/packages/App
#Run the app
CMD [ "npm", "run", "dev" ]
{{ else }}
# ---------------------------------------------------------------------------
# community-build: the complete Community Edition build. Every heavy layer is
# in this stage, so both targets share it.
# ---------------------------------------------------------------------------
FROM base AS community-build
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
COPY --chown=1000:1000 ./packages/App /usr/src/app
# Copy frontend sources
COPY --chown=1000:1000 ./packages/App/FeatureSet/Accounts /usr/src/app/FeatureSet/Accounts
COPY --chown=1000:1000 ./packages/App/FeatureSet/Dashboard /usr/src/app/FeatureSet/Dashboard
COPY --chown=1000:1000 ./packages/App/FeatureSet/AdminDashboard /usr/src/app/FeatureSet/AdminDashboard
COPY --chown=1000:1000 ./packages/App/FeatureSet/StatusPage /usr/src/app/FeatureSet/StatusPage
COPY --chown=1000:1000 ./packages/App/FeatureSet/PublicDashboard /usr/src/app/FeatureSet/PublicDashboard
COPY --chown=1000:1000 ./packages/App/FeatureSet/BrowserRecorder /usr/src/app/FeatureSet/BrowserRecorder
# Bundle frontend source. There is no ee/ in this stage, so the Dashboard and
# Admin Dashboard bundle their Community stubs (Common/UI/esbuild-enterprise.js).
RUN npm run build-frontends:prod
# Bundle app source
RUN npm run compile

# ---------------------------------------------------------------------------
# enterprise-build: community-build plus ee/.
# ---------------------------------------------------------------------------
FROM community-build AS enterprise-build
# ee/package.json links Common and App as file:../packages/{Common,App} (the
# repository layout). Recreate that layout, so ee's node_modules/{Common,App}
# resolve to /usr/src/Common and /usr/src/app: the files the App runs, one
# module instance each.
RUN mkdir -p /usr/src/packages \
    && ln -s ../Common /usr/src/packages/Common \
    && ln -s ../app /usr/src/packages/App
WORKDIR /usr/src/ee
COPY ./ee/package*.json /usr/src/ee/
# --ignore-scripts: without it npm also runs the lifecycle scripts of the
# linked Common and App packages, as root. ee's own dependencies need none.
RUN --mount=type=cache,target=/tmp/npm npm ci --ignore-scripts --prefer-offline
# .dockerignore keeps ee's tests, build output and any key material out.
COPY ./ee /usr/src/ee
# Type-check the ee server, as `npm run compile` does for core: production
# boots transpile-only (TS_NODE_TRANSPILE_ONLY below), so this is the only type
# check ee gets in the image. The ee UI is type-checked in CI (compile-ee), just
# as the image never type-checks the frontends either.
RUN ./node_modules/.bin/tsc -p tsconfig.json
WORKDIR /usr/src/app
# Rebuild ONLY the two frontends that have an Enterprise UI.
# ONEUPTIME_EDITION=enterprise turns a missing ee plugin into a build error
# instead of a quiet Community bundle, and puts the edition into the service
# worker's cache version, so browsers drop Community assets after a switch.
RUN ONEUPTIME_EDITION=enterprise bash scripts/frontend-run.sh FeatureSet/Dashboard build \
    && ONEUPTIME_EDITION=enterprise bash scripts/frontend-run.sh FeatureSet/AdminDashboard build
# esbuild also honours the frontends' tsconfig paths, which point the plugin
# specifiers at the Community stubs, so a broken alias would fall back to the
# Community UI without any error. Each ee plugin exports a sentinel string:
# refuse to produce an Enterprise image whose bundles do not contain it.
RUN grep -rqF ONEUPTIME_EE_DASHBOARD_PLUGIN_v1 FeatureSet/Dashboard/public/dist \
    || { echo "The Dashboard bundle does not contain the Enterprise UI: ONEUPTIME_EE_DASHBOARD_PLUGIN_v1 is not in FeatureSet/Dashboard/public/dist." >&2; exit 1; }
RUN grep -rqF ONEUPTIME_EE_ADMIN_DASHBOARD_PLUGIN_v1 FeatureSet/AdminDashboard/public/dist \
    || { echo "The Admin Dashboard bundle does not contain the Enterprise UI: ONEUPTIME_EE_ADMIN_DASHBOARD_PLUGIN_v1 is not in FeatureSet/AdminDashboard/public/dist." >&2; exit 1; }
# ee's devDependencies (typescript, jest, ts-jest, @types) were only needed for
# the type-check above. The Common and App links are dependencies and stay.
RUN npm --prefix /usr/src/ee prune --omit=dev --ignore-scripts

# ---------------------------------------------------------------------------
# enterprise: the Enterprise Edition image (--target enterprise).
# ---------------------------------------------------------------------------
FROM enterprise-build AS enterprise
LABEL org.opencontainers.image.licenses="Apache-2.0 AND LicenseRef-OneUptime-Enterprise"
LABEL com.oneuptime.edition="enterprise"
# The Enterprise loader's image marker (packages/App/Utils/EnterpriseLoader.ts):
# with ONEUPTIME_EDITION=enterprise ee/ MUST load, and the App refuses to boot
# when it cannot, instead of silently running as the Community Edition.
ENV ONEUPTIME_EDITION=enterprise
# Informational and deprecated: no gate reads IS_ENTERPRISE_EDITION. What the
# App actually loaded is the edition, and that is what env.js reports.
ENV IS_ENTERPRISE_EDITION=true
USER node
# The full TypeScript type-check already ran at build time (`npm run compile`
# and the ee tsc above). Without this, ts-node/register redoes that entire check
# on every container start before the HTTP listener binds -- minutes of boot on
# every pod, which is what turns a rolling update into a capacity hole and makes
# recovery from a node failure just as slow. transpile-only strips types without
# re-checking them; type errors are caught at build and in CI, not at boot.
ENV TS_NODE_TRANSPILE_ONLY=1
#Run the app
CMD [ "npm", "start" ]

# ---------------------------------------------------------------------------
# community: the Community Edition image (--target community, and the default
# target). Keep this stage LAST, and never copy ee/ into it.
# ---------------------------------------------------------------------------
FROM community-build AS community
# The Community bundles must not contain the Enterprise UI.
RUN if grep -rlF -e ONEUPTIME_EE_DASHBOARD_PLUGIN_v1 -e ONEUPTIME_EE_ADMIN_DASHBOARD_PLUGIN_v1 FeatureSet/Dashboard/public/dist FeatureSet/AdminDashboard/public/dist; then \
        echo "The Community Edition bundles listed above contain the Enterprise UI." >&2; \
        exit 1; \
    fi
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL com.oneuptime.edition="community"
# ONEUPTIME_EDITION is deliberately NOT set here. It stays "auto", which finds
# no ee/ in this image, and an operator can still set it to "community".
# Informational and deprecated: no gate reads IS_ENTERPRISE_EDITION.
ENV IS_ENTERPRISE_EDITION=false
USER node
# Types were checked at build time; see the enterprise stage above.
ENV TS_NODE_TRANSPILE_ONLY=1
#Run the app
CMD [ "npm", "start" ]
{{ end }}
