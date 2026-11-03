# OneUptime Probe for Iron Bank
#
# Iron Bank (registry1.dso.mil) builds this file in its own pipeline, from the
# hardening_manifest.yaml beside it, without internet access: the image it
# ships must start from one of Iron Bank's own images, and anything else the
# build reads is a resource the manifest pins by digest or checksum. So the
# probe is not built here. hardening_manifest.yaml pins the probe image of a
# OneUptime release (packages/Probe/Dockerfile.tpl), and this copies out of it
# what that Dockerfile builds - the probe in /usr/src, the Chromium and Firefox
# that Playwright downloaded, the synthetic monitors' native helpers, and the
# Node.js that runs it all, as Iron Bank's own Node.js images copy theirs out
# of Node's - onto Iron Bank's Debian 12 image, the Debian the release is
# built on, so everything it compiled runs here unchanged.
#
# Microsoft's SQL Server ODBC driver (msodbcsql18) is not a Debian package:
# the release installs it from Microsoft's repository, which Iron Bank's
# pipeline cannot reach, so hardening_manifest.yaml pins its package by
# checksum and this installs that file. The rest of the release's packages,
# and the libraries Playwright's browsers need (Playwright's own install-deps,
# from the release's node_modules, names them), come from Debian's
# repositories, which Iron Bank's pipeline reaches through its proxy.
#
# A COPY --from brings files and nothing else, so everything else the
# release's Dockerfile sets is set again here: its packages, npm's settings,
# the labels the manifest cannot carry, the environment, the entrypoint and
# the start command. Tests/Ops/IronBankProjects.test.js holds them to
# packages/Probe/Dockerfile.tpl, and Scripts/IronBank/PinRelease.js moves the
# release, its version and its commit together. IronBank/README.md describes
# the whole process.

ARG BASE_REGISTRY=registry1.dso.mil
ARG BASE_IMAGE=ironbank/opensource/debian/debian
ARG BASE_TAG=12-slim

# The release, a resource of hardening_manifest.yaml: Iron Bank's pipeline
# pulls it by digest and gives it this name before it builds.
FROM oneuptime/probe:14.0.102 AS release

FROM ${BASE_REGISTRY}/${BASE_IMAGE}:${BASE_TAG}

# The probe runs as root, as the release does: ping, traceroute and tcpdump
# open raw sockets. IronBank/README.md gives the justification.
USER root

# A resource of hardening_manifest.yaml, which Iron Bank's pipeline downloads
# and checks against its sha256 before it builds.
COPY msodbcsql18.deb /tmp/msodbcsql18.deb

COPY --from=release /usr/local/bin/node /usr/local/bin/node
COPY --from=release /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=release /usr/local/share/ca-certificates /usr/local/share/ca-certificates
COPY --from=release /usr/src /usr/src
COPY --from=release /ms-playwright-browsers /ms-playwright-browsers
COPY --from=release /usr/lib/oneuptime-probe /usr/lib/oneuptime-probe

# The release's runtime packages: the monitors' network tools, tini (the
# entrypoint), Kerberos for SQL Server, and the browsers' libraries; then the
# ODBC driver, and whatever else this Playwright needs for its Chromium and
# Firefox, as the release's `playwright install --with-deps` installs it, less
# the video decoder the release removes again. Then npm's links and settings
# as the release's base image and Dockerfile make them.
RUN apt-get update \
    && apt-get upgrade -y \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends bash curl iputils-ping net-tools dnsutils traceroute tcpdump tini ca-certificates krb5-user libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libgtk-3-0 libpango-1.0-0 libcairo2 libgdk-pixbuf2.0-0 libasound2 libatspi2.0-0 \
    && ACCEPT_EULA=Y DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends /tmp/msodbcsql18.deb \
    && node /usr/src/app/node_modules/playwright/cli.js install-deps chromium firefox \
    && apt-get purge -y --auto-remove libavcodec59 \
    && update-ca-certificates \
    && ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && mkdir /tmp/npm \
    && chmod 2777 /tmp/npm \
    && chown 1000:1000 /tmp/npm \
    && npm config set cache /tmp/npm --global \
    && npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 60000 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* /tmp/msodbcsql18.deb

SHELL ["/bin/bash", "-c"]

# The release's labels that Iron Bank's schema does not let
# hardening_manifest.yaml carry.
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.documentation="https://oneuptime.com/docs/probe/custom-probe"
LABEL org.opencontainers.image.revision="eabb86bd64e59edcecab13b7f8bc3512babb2483"

ENV APP_VERSION=14.0.102
ENV GIT_SHA=eabb86bd64e59edcecab13b7f8bc3512babb2483
ENV NODE_OPTIONS="--use-openssl-ca"
ENV PRODUCTION=true
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright-browsers
ENV IS_ENTERPRISE_EDITION=false
# The release type-checked the probe when it was built.
ENV TS_NODE_TRANSPILE_ONLY=1

WORKDIR /usr/src/app

ENTRYPOINT ["/usr/bin/tini", "--"]

# The release's start command: sh execs node under tini.
CMD [ "sh", "-c", "export NODE_OPTIONS=\"--max-old-space-size=8096${NODE_OPTIONS:+ $NODE_OPTIONS}\" && exec node --no-node-snapshot --require ts-node/register Index.ts" ]
