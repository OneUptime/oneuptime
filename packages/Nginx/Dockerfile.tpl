# Node 26 donor stage: Alpine's apk nodejs package tops out below Node 26, so
# node + npm are copied from the official node image into the nginx image
# below. The alpine release of this tag (3.24) MUST match the alpine release
# the nginx base image is pinned to (alpine3.24 in its tag) so the copied
# node binary links against the same musl/libstdc++ ABI — when the nginx base
# moves to a newer alpine, bump this tag in the same commit.
# Tests/Ops/ContainerImageHardening.test.js fails when the two differ.
FROM public.ecr.aws/docker/library/node:26-alpine3.24 AS node26

# The newest stable nginx, with its Alpine release in the tag so it cannot
# drift away from the node donor above.
FROM nginx:1.30.5-alpine3.24


# Per-build args (GIT_SHA / APP_VERSION / IS_ENTERPRISE_EDITION) are declared at
# the bottom so the npm install / compile layers stay cacheable across commits
# and across the community + enterprise build passes.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

LABEL org.opencontainers.image.title="OneUptime Nginx"
LABEL org.opencontainers.image.description="OneUptime Nginx ingress — TLS termination, routing, and Let's Encrypt automation."
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.url="https://oneuptime.com"
LABEL org.opencontainers.image.documentation="https://oneuptime.com/docs"
LABEL org.opencontainers.image.vendor="OneUptime"
LABEL org.opencontainers.image.licenses="Apache-2.0"



# Upgrade OS packages (Alpine security fixes published since the base image
# was built), then install runtime tools (bash, curl, openssl) and the NJS
# module in a single --no-cache layer so the apk index data doesn't persist in
# the image. libstdc++ (pulls in libgcc) is required by the node binary and the
# isolated-vm prebuilt C++ addon copied/installed below.
#
# The nginx base image also ships the image-filter, xslt and geoip dynamic
# modules. nginx.conf loads only the njs module, and the other three bring in
# ~30 libraries nothing here uses (libgd, tiff, libjpeg, libpng, libwebp,
# fontconfig, the X11 client libraries, libxslt, GeoIP), including tiff's
# unfixed CVEs. Removing them takes those libraries with them.
RUN apk upgrade --no-cache \
    && apk add --no-cache bash curl openssl nginx-module-njs libstdc++ \
    && apk del --no-cache nginx-module-image-filter nginx-module-xslt nginx-module-geoip

# Install Node 26 + npm from the donor stage above (apk has no Node 26
# package). COPY --from resolves per target platform, so multi-arch builds
# pick the right binaries. isolated-vm ships musl prebuilds for Node 26, so
# no compile toolchain is needed in this image.
COPY --from=node26 /usr/local/bin/node /usr/local/bin/node
COPY --from=node26 /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# Update npm to npm@latest with every dependency it bundles (tar, undici,
# brace-expansion, ip-address, ...) reinstalled at the newest version npm's own
# ranges accept. `npm install -g npm@latest` alone ships the dependencies npm
# was packed with, and scanners flagged them in every image. See
# Scripts/Docker/UpdateNpmCli.js.
COPY ./Scripts/Docker/UpdateNpmCli.js /tmp/UpdateNpmCli.js
RUN node /tmp/UpdateNpmCli.js && rm /tmp/UpdateNpmCli.js

COPY ./packages/Nginx/envsubst-on-templates.sh /etc/nginx/envsubst-on-templates.sh

RUN chmod +x /etc/nginx/envsubst-on-templates.sh

COPY ./packages/Nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY ./packages/Nginx/nginx.conf /etc/nginx/nginx.conf

# Serialize npm lifecycle scripts so esbuild's postinstall doesn't race against
# concurrent package extractions on BuildKit's overlayfs (ETXTBSY on
# /Common/node_modules/esbuild/bin/esbuild). See esbuild#1711, #2785.
RUN npm config set foreground-scripts true

RUN mkdir /usr/src

WORKDIR /usr/src/Common
COPY ./packages/Common/package*.json /usr/src/Common/
RUN npm install
COPY ./packages/Common /usr/src/Common








ENV PRODUCTION=true

WORKDIR /usr/src/app

# Install app dependencies
COPY ./packages/Nginx/package*.json /usr/src/app/
RUN npm install

COPY ./packages/Nginx /usr/src/app
# Bundle app source
RUN npm run compile

RUN chmod +x ./run.sh

# Per-build metadata last so the npm install / compile layers above stay
# cacheable across commits and across the community + enterprise build passes.
ARG GIT_SHA
ARG APP_VERSION
ARG IS_ENTERPRISE_EDITION=false
ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
ENV IS_ENTERPRISE_EDITION=${IS_ENTERPRISE_EDITION}
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${APP_VERSION}"
# The full TypeScript type-check already ran at build time (`npm run compile`
# above). Without this, ts-node/register redoes it on every container start,
# delaying the cert/domain sidecar. See App/Dockerfile.tpl for the rationale.
ENV TS_NODE_TRANSPILE_ONLY=1

CMD ./run.sh


