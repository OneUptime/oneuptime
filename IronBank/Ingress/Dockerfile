# OneUptime Ingress (nginx) for Iron Bank
#
# Iron Bank (registry1.dso.mil) builds this file in its own pipeline, from the
# hardening_manifest.yaml beside it, without internet access: the image it
# ships must start from one of Iron Bank's own images, and anything else the
# build reads is a resource the manifest pins by digest or checksum. So the
# ingress is not built here. hardening_manifest.yaml pins the ingress image of
# a OneUptime release (packages/Nginx/Dockerfile.tpl), and this copies out of
# it what that Dockerfile adds to nginx - its nginx configuration, the
# certificate sidecar in /usr/src, and the Node.js that runs it - onto Iron
# Bank's nginx 1.30 image. Both are nginx 1.30 from nginx.org on Alpine 3.24
# (musl), with the same modules, njs included.
#
# A COPY --from brings files and nothing else, so everything else the
# release's base and final stages set is set again here: its Alpine packages,
# the npm links, the labels the manifest cannot carry, the environment, the
# working directory and the start command. Tests/Ops/IronBankProjects.test.js
# holds them to packages/Nginx/Dockerfile.tpl, and
# Scripts/IronBank/PinRelease.js moves the release, its version and its commit
# together. IronBank/README.md describes the whole process.

ARG BASE_REGISTRY=registry1.dso.mil
ARG BASE_IMAGE=ironbank/opensource/nginx/nginx-alpine
ARG BASE_TAG=1.30.3

# The release, a resource of hardening_manifest.yaml: Iron Bank's pipeline
# pulls it by digest and gives it this name before it builds.
FROM oneuptime/nginx:14.0.102 AS release

# The release without its tests, which no image runs: one of Common's test
# fixtures (an SVG data URI with a script in it) is what ClamAV calls
# phishing, and Iron Bank's pipeline fails an image on any ClamAV detection.
# Removed in a stage of its own, so that no layer of this image carries them.
FROM release AS shipped
USER root
RUN rm -rf /usr/src/Common/Tests /usr/src/app/Tests

FROM ${BASE_REGISTRY}/${BASE_IMAGE}:${BASE_TAG}

# Iron Bank's nginx image runs as nginx. The release runs as root, as the
# official nginx image does: run.sh renders the configuration into
# /etc/nginx/conf.d, provisions certificates and starts nginx, whose workers
# drop to the nginx user. IronBank/README.md gives the justification.
USER root

# Node.js and npm for the certificate sidecar (run.sh starts it with
# `npm start`), as the release's base stage copies them out of Node's image.
COPY --from=release /usr/local/bin/node /usr/local/bin/node
COPY --from=release /usr/local/lib/node_modules /usr/local/lib/node_modules

# The release's Alpine packages: bash for run.sh, curl and openssl for the
# certificate sidecar, libstdc++ and libatomic for Node.js. libxml2: njs, which
# nginx.conf loads, links it, and Iron Bank's image copies nginx's modules
# without the libraries the official image installs with them. Iron Bank's
# pipeline reaches Alpine's package repositories through its proxy and
# nothing else, so everything that is not an Alpine package comes from the
# release.
RUN apk upgrade --no-cache \
    && apk add --no-cache bash curl openssl libstdc++ libatomic libxml2 \
    && ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

COPY --from=release /etc/nginx/envsubst-on-templates.sh /etc/nginx/envsubst-on-templates.sh
COPY --from=release /etc/nginx/templates/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=release /etc/nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=shipped /usr/src /usr/src

# The release's labels that Iron Bank's schema does not let
# hardening_manifest.yaml carry.
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.documentation="https://oneuptime.com/docs"
LABEL org.opencontainers.image.revision="eabb86bd64e59edcecab13b7f8bc3512babb2483"

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PRODUCTION=true
ENV APP_VERSION=14.0.102
ENV GIT_SHA=eabb86bd64e59edcecab13b7f8bc3512babb2483
ENV IS_ENTERPRISE_EDITION=false
# The release type-checked the sidecar when it was built.
ENV TS_NODE_TRANSPILE_ONLY=1

WORKDIR /usr/src/app

# The release's start command: run.sh renders the templates, then runs nginx
# and the certificate sidecar.
CMD ./run.sh
