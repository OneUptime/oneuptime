# OneUptime App (Community Edition) for Iron Bank
#
# Iron Bank (registry1.dso.mil) builds this file in its own pipeline, from the
# hardening_manifest.yaml beside it, without internet access: the image it
# ships must start from one of Iron Bank's own images, and anything else the
# build reads is a resource the manifest pins by digest or checksum. So the App
# is not built here. hardening_manifest.yaml pins the Community Edition image
# of a OneUptime release (packages/App/Dockerfile.tpl, --target community), and
# this copies its /usr/src - the App, Common and the frontend bundles, already
# pruned to what the App runs - onto Iron Bank's Node.js 26 image. Both are
# Node.js 26 on Alpine 3.24 (musl), so the native modules the release built
# load here unchanged.
#
# A COPY --from brings files and nothing else, so everything else the
# release's runtime and community stages set is set again here: bash and curl,
# npm's cache directory, the labels the manifest cannot carry, the
# environment, the user and the start command. Tests/Ops/IronBankApp.test.js
# holds them to packages/App/Dockerfile.tpl, and Scripts/IronBank/PinRelease.js
# moves the release, its version and its commit together. IronBank/README.md
# describes the whole process.

ARG BASE_REGISTRY=registry1.dso.mil
ARG BASE_IMAGE=ironbank/opensource/nodejs/nodejs26
ARG BASE_TAG=26.13.0-npm12-yarn4-slim

# The release, a resource of hardening_manifest.yaml: Iron Bank's pipeline
# pulls it by digest and gives it this name before it builds.
FROM oneuptime/app:14.0.101 AS release

FROM ${BASE_REGISTRY}/${BASE_IMAGE}:${BASE_TAG}

USER root

# bash: the Helm chart's migrate job waits for PostgreSQL in this image with
# bash's /dev/tcp. curl: the release's runtime stage installs it too, and
# Tests/Ops/AppImageRuntime.test.js reaches the App through it. Iron Bank's
# pipeline reaches Alpine's package repositories through its proxy and nothing
# else, so everything that is not an Alpine package comes from the release.
# /tmp/npm is npm's cache, writable by the node user, as in the release: the
# Helm chart's migrate job runs `npm run migrate`.
RUN apk upgrade --no-cache \
    && apk add --no-cache bash curl \
    && mkdir /tmp/npm \
    && chmod 2777 /tmp/npm \
    && chown 1000:1000 /tmp/npm \
    && npm config set cache /tmp/npm --global

COPY --from=release /usr/src /usr/src

# The release's labels that Iron Bank's schema does not let
# hardening_manifest.yaml carry. Scripts/GHA/check_app_image_edition.sh reads
# com.oneuptime.edition.
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.documentation="https://oneuptime.com/docs"
LABEL org.opencontainers.image.revision="e0bbebebec283c512ab1455ccb5e4ec3fdeb6237"
LABEL com.oneuptime.edition="community"

ENV PRODUCTION=true
ENV APP_VERSION=14.0.101
ENV GIT_SHA=e0bbebebec283c512ab1455ccb5e4ec3fdeb6237
# false on the Community Edition: true without ee/ makes the App refuse to
# start (packages/App/Utils/EnterpriseLoader.ts). ONEUPTIME_EDITION stays
# unset, as on the release.
ENV IS_ENTERPRISE_EDITION=false
# The release type-checked the App when it was built.
ENV TS_NODE_TRANSPILE_ONLY=1

WORKDIR /usr/src/app

EXPOSE 3002

USER node

# The release's start command: sh execs node, so node is the container's only
# process (see the community stage of packages/App/Dockerfile.tpl).
CMD [ "sh", "-c", "export NODE_OPTIONS=\"--max-old-space-size=8096${NODE_OPTIONS:+ $NODE_OPTIONS}\" && exec node --no-node-snapshot --require ts-node/register Index.ts" ]
