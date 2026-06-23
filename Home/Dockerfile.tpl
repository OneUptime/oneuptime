# syntax=docker/dockerfile:1.7
#
# OneUptime-App Dockerfile
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
# the bottom so the npm ci / compile / blog layers stay cacheable across commits
# and across the community + enterprise build passes.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

LABEL org.opencontainers.image.title="OneUptime Home"
LABEL org.opencontainers.image.description="OneUptime marketing site, product pages, and documentation hub."
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
# image layer. `git` stays — Home clones the blog repo below.
RUN apk upgrade --no-cache \
    && apk add --no-cache bash curl git \
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
COPY ./Home/package*.json /usr/src/app/
RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline

# Remove the build toolchain (python3/make/g++) now that all native npm modules
# have been compiled. This keeps build-time CVEs out of the runtime image.
RUN apk del .gyp

# Expose ports.
#   - 1444: OneUptime-home
EXPOSE 1444

# The blog repo is cloned per-branch below. In production it is cloned as the
# non-root `node` user so the runtime UpdateBlog `git pull` can write into it
# without a costly recursive chown of its ~100k files.

{{ if eq .Env.ENVIRONMENT "development" }}
# Clone blog repo (dev container runs as root).
RUN cd /usr/src && git clone https://github.com/oneuptime/blog
#Run the app
CMD [ "npm", "run", "dev" ]
{{ else }}
# Copy app source. --chown sets node (UID 1000) ownership at copy time so we
# avoid a slow recursive `chown -R` over node_modules; deps stay root-owned and
# world-readable.
COPY --chown=1000:1000 ./Home /usr/src/app
# Bundle app source
RUN npm run compile
# Give node ownership of /usr/src itself (non-recursive — instant) so it can
# create and own the blog clone below. Common/node_modules stay root-owned.
RUN chown 1000:1000 /usr/src
USER node
# Clone the blog as node so the runtime UpdateBlog `git pull` (runs as node) can
# write into it — avoids a recursive chown of the blog's ~100k files.
RUN cd /usr/src && git clone https://github.com/oneuptime/blog
# Per-build metadata last so the heavy layers above stay cacheable across commits
# and across the community + enterprise build passes.
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
