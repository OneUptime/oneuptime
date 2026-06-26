#
# OneUptime MCP Server Dockerfile
#

# Pull base image nodejs image.
FROM public.ecr.aws/docker/library/node:26-alpine3.24
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

# Per-build args (GIT_SHA / APP_VERSION / IS_ENTERPRISE_EDITION) are declared at
# the bottom so the npm install / compile layers stay cacheable across commits
# and across the community + enterprise build passes.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

LABEL org.opencontainers.image.title="OneUptime MCP Server"
LABEL org.opencontainers.image.description="OneUptime Model Context Protocol (MCP) server for AI agent integrations."
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
RUN npm install
COPY ./Common /usr/src/Common

ENV PRODUCTION=true

WORKDIR /usr/src/app

# Install app dependencies
COPY ./MCP/package*.json /usr/src/app/
RUN npm install

# Remove the build toolchain (python3/make/g++) now that all native npm modules
# have been compiled. This keeps build-time CVEs out of the runtime image.
RUN apk del .gyp

# Expose Port
EXPOSE 3405

{{ if eq .Env.ENVIRONMENT "development" }}
#Run the app
CMD [ "npm", "run", "dev" ]
{{ else }}
# Copy app source. --chown sets node (UID 1000) ownership at copy time so we
# avoid a slow recursive `chown -R` over node_modules; deps stay root-owned and
# world-readable.
COPY --chown=1000:1000 ./MCP /usr/src/app
# Bundle app source
RUN npm run compile
USER node
# Per-build metadata last so the community + enterprise passes share every heavy
# cached layer above — only this final metadata layer differs between them.
ARG GIT_SHA
ARG APP_VERSION
ARG IS_ENTERPRISE_EDITION=false
ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
ENV IS_ENTERPRISE_EDITION=${IS_ENTERPRISE_EDITION}
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${APP_VERSION}"
#Run the app
CMD [ "npm", "start" ]
{{ end }}
