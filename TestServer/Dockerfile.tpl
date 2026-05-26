#
# OneUptime-test-server-api Dockerfile
#

# Pull base image nodejs image.
FROM public.ecr.aws/docker/library/node:24.9-alpine3.21
RUN mkdir /tmp/npm &&  chmod 2777 /tmp/npm && chown 1000:1000 /tmp/npm && npm config set cache /tmp/npm --global

RUN npm config set fetch-retries 5
RUN npm config set fetch-retry-mintimeout 20000
RUN npm config set fetch-retry-maxtimeout 60000


ARG GIT_SHA
ARG APP_VERSION
ARG IS_ENTERPRISE_EDITION=false

ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
ENV IS_ENTERPRISE_EDITION=${IS_ENTERPRISE_EDITION}
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

LABEL org.opencontainers.image.title="OneUptime Test Server"
LABEL org.opencontainers.image.description="OneUptime synthetic test server used by probes and end-to-end test suites."
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.url="https://oneuptime.com"
LABEL org.opencontainers.image.documentation="https://oneuptime.com/docs"
LABEL org.opencontainers.image.vendor="OneUptime"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${APP_VERSION}"




# Install runtime tools + build toolchain.
# Build toolchain (.gyp virtual) is installed temporarily for native npm
# modules and is removed after all npm installs complete (see `apk del .gyp`
# below). --no-cache avoids retaining apk index data in the image layer.
RUN apk add --no-cache bash curl \
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
COPY ./TestServer/package*.json /usr/src/app/
RUN npm install

# Remove the build toolchain (python3/make/g++) now that all native npm modules
# have been compiled. This keeps build-time CVEs out of the runtime image.
RUN apk del .gyp

# Expose ports.
#   - 3800: OneUptime-test-server-api
EXPOSE 3800

{{ if eq .Env.ENVIRONMENT "development" }}
#Run the app
CMD [ "npm", "run", "dev" ]
{{ else }}
# Copy app source
COPY ./TestServer /usr/src/app
# Bundle app source
RUN npm run compile
# Ensure runtime dirs are owned by the non-root `node` user (UID 1000) so the
# container can run as non-root.
RUN chown -R 1000:1000 /usr/src /tmp/npm && chmod -R 2777 /tmp/npm
USER node
#Run the app
CMD [ "npm", "start" ]
{{ end }}

