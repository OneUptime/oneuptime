# Node 26 donor stage: Alpine's apk nodejs package tops out below Node 26, so
# node + npm are copied from the official node image into the nginx image
# below. The alpine release of this tag (3.23) MUST match the alpine release
# of the nginx base image (nginx:1.30.2-alpine is Alpine 3.23.x) so the copied
# node binary links against the same musl/libstdc++ ABI — when the nginx base
# moves to a newer alpine, bump this tag in the same commit.
FROM public.ecr.aws/docker/library/node:26-alpine3.23 AS node26

FROM nginx:1.30.2-alpine


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
RUN apk upgrade --no-cache \
    && apk add --no-cache bash curl openssl nginx-module-njs libstdc++

# Install Node 26 + npm from the donor stage above (apk has no Node 26
# package). COPY --from resolves per target platform, so multi-arch builds
# pick the right binaries. isolated-vm ships musl prebuilds for Node 26, so
# no compile toolchain is needed in this image.
COPY --from=node26 /usr/local/bin/node /usr/local/bin/node
COPY --from=node26 /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# Upgrade the bundled npm CLI so its vendored deps (tar, glob, minimatch,
# brace-expansion, picomatch, ...) pick up security fixes that the base
# image's npm still carries.
RUN npm install -g npm@latest

COPY ./Nginx/envsubst-on-templates.sh /etc/nginx/envsubst-on-templates.sh

RUN chmod +x /etc/nginx/envsubst-on-templates.sh

COPY ./Nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY ./Nginx/nginx.conf /etc/nginx/nginx.conf

# Serialize npm lifecycle scripts so esbuild's postinstall doesn't race against
# concurrent package extractions on BuildKit's overlayfs (ETXTBSY on
# /Common/node_modules/esbuild/bin/esbuild). See esbuild#1711, #2785.
RUN npm config set foreground-scripts true

RUN mkdir /usr/src

WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
RUN npm install
COPY ./Common /usr/src/Common








ENV PRODUCTION=true

WORKDIR /usr/src/app

# Install app dependencies
COPY ./Nginx/package*.json /usr/src/app/
RUN npm install

COPY ./Nginx /usr/src/app
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

CMD ./run.sh


