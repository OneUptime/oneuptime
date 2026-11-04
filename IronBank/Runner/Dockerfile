# OneUptime Runner for Iron Bank
#
# Iron Bank (registry1.dso.mil) builds this file in its own pipeline, from the
# hardening_manifest.yaml beside it, without internet access: the image it
# ships must start from one of Iron Bank's own images, and anything else the
# build reads is a resource the manifest pins by digest or checksum. So the
# runner is not built here. hardening_manifest.yaml pins the runner image of a
# OneUptime release (packages/Runner/Dockerfile.tpl), and this copies out of
# it the runner in /usr/src, kubectl (which the release downloads and checks
# against its sha256) and the CA certificates it trusts, onto Iron Bank's
# Node.js 26 image. Both are Node.js 26 on Debian 13 (glibc), so the native
# modules the release built load here unchanged.
#
# A COPY --from brings files and nothing else, so everything else the
# release's base and final stages set is set again here: its Debian packages,
# npm's settings, the labels the manifest cannot carry, the environment, the
# entrypoint, the user and the start command.
# Tests/Ops/IronBankProjects.test.js holds them to packages/Runner/Dockerfile.tpl,
# and Scripts/IronBank/PinRelease.js moves the release, its version and its
# commit together. IronBank/README.md describes the whole process.

ARG BASE_REGISTRY=registry1.dso.mil
ARG BASE_IMAGE=ironbank/opensource/nodejs/debian/nodejs
ARG BASE_TAG=26.12.1-npm12-yarn4

# The release, a resource of hardening_manifest.yaml: Iron Bank's pipeline
# pulls it by digest and gives it this name before it builds.
FROM oneuptime/runner:14.0.102 AS release

# The release without its tests, which no image runs: one of Common's test
# fixtures (an SVG data URI with a script in it) is what ClamAV calls
# phishing, and Iron Bank's pipeline fails an image on any ClamAV detection.
# Removed in a stage of its own, so that no layer of this image carries them.
FROM release AS shipped
USER root
RUN rm -rf /usr/src/Common/Tests /usr/src/app/Tests

FROM ${BASE_REGISTRY}/${BASE_IMAGE}:${BASE_TAG}

USER root

COPY --from=release /usr/local/share/ca-certificates /usr/local/share/ca-certificates
COPY --from=release /usr/local/bin/kubectl /usr/local/bin/kubectl

# The release's Debian packages: what runbook steps run with (bash, curl, git,
# wget, ssh, archive tools) and tini, the entrypoint. Iron Bank's pipeline
# reaches Debian's package repositories through its proxy and nothing else, so
# everything that is not a Debian package comes from the release. Then npm's
# settings as the release's base stage makes them: /tmp/npm is its cache,
# writable by the node user.
RUN apt-get update \
    && apt-get upgrade -y \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends bash ca-certificates curl git tini wget openssh-client procps unzip xz-utils bzip2 \
    && update-ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /tmp/npm \
    && chmod 2777 /tmp/npm \
    && chown 1000:1000 /tmp/npm \
    && npm config set cache /tmp/npm --global \
    && npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 60000 \
    && npm config set foreground-scripts true

SHELL ["/bin/bash", "-c"]

COPY --from=shipped /usr/src /usr/src

# The release's labels that Iron Bank's schema does not let
# hardening_manifest.yaml carry.
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.revision="eabb86bd64e59edcecab13b7f8bc3512babb2483"

ENV NODE_OPTIONS="--use-openssl-ca"
ENV PRODUCTION=true
ENV APP_VERSION=14.0.102
ENV GIT_SHA=eabb86bd64e59edcecab13b7f8bc3512babb2483
# The release type-checked the runner when it was built.
ENV TS_NODE_TRANSPILE_ONLY=1

ENTRYPOINT ["/usr/bin/tini", "--"]

WORKDIR /usr/src/app

USER node

# The release's start command: sh execs node under tini.
CMD [ "sh", "-c", "export NODE_OPTIONS=\"--max-old-space-size=8096${NODE_OPTIONS:+ $NODE_OPTIONS}\" && exec node --no-node-snapshot --require ts-node/register Index.ts" ]
