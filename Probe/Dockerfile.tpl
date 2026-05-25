#
# OneUptime-Probe Dockerfile
#

# Pull base image nodejs image.
# Switched from `node:24.9` (full Debian, ~1GB, large CVE surface) to
# `node:24-bookworm-slim` which keeps glibc (required for Playwright Chromium)
# while dropping the unneeded ~700MB of default packages. Floating on the
# 24.x patch so each rebuild picks up Node security patches.
FROM public.ecr.aws/docker/library/node:24-bookworm-slim
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
ENV NODE_OPTIONS="--use-openssl-ca"

LABEL org.opencontainers.image.title="OneUptime Probe"
LABEL org.opencontainers.image.description="OneUptime monitoring probe — runs HTTP, TCP, ping, SSL, and synthetic monitors from any location."
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.url="https://oneuptime.com"
LABEL org.opencontainers.image.documentation="https://oneuptime.com/docs/probe/custom-probe"
LABEL org.opencontainers.image.vendor="OneUptime"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${APP_VERSION}"

# Install OS packages in a single layer:
#   - Runtime tools: bash, curl, iputils-ping, tini, net-tools, dnsutils, ca-certificates
#   - Build toolchain: python3, make, g++  (removed later, after npm install)
#   - Playwright/Chromium system libs
# `--no-install-recommends` keeps the surface small. apt cache is cleaned in the
# same RUN so package metadata doesn't persist in the layer.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        bash \
        curl \
        iputils-ping \
        tini \
        net-tools \
        dnsutils \
        python3 \
        make \
        g++ \
        libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
        libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
        libgbm1 libgtk-3-0 libpango-1.0-0 libcairo2 libgdk-pixbuf2.0-0 \
        libasound2 libatspi2.0-0 \
    && rm -rf /var/lib/apt/lists/*

## Add Intermediate Certs (ca-certificates is now installed above)
COPY ./SslCertificates /usr/local/share/ca-certificates
RUN update-ca-certificates

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

RUN mkdir -p /usr/src

WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
RUN npm install
COPY ./Common /usr/src/Common











ENV PRODUCTION=true

WORKDIR /usr/src/app
# Install app dependencies first so local Playwright CLI is available
COPY ./Probe/package*.json /usr/src/app/
RUN npm install

# Install browsers to a fixed path accessible by any runtime user (root or non-root)
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright-browsers
RUN npx playwright install --with-deps && chmod -R 755 /ms-playwright-browsers

# Use tini as init to properly reap zombie processes (like Chrome/Chromium)
ENTRYPOINT ["/usr/bin/tini", "--"]

{{ if eq .Env.ENVIRONMENT "development" }}
#Run the app
CMD [ "bash", "/usr/src/app/Start.dev.sh" ]
{{ else }}
# Copy app source
COPY ./Probe /usr/src/app
# Bundle app source
RUN npm run compile
# Set permission to write logs and cache in case container run as non root
RUN chown -R 1000:1000 "/tmp/npm" && chmod -R 2777 "/tmp/npm"
#Run the app
CMD [ "npm", "start" ]
{{ end }}
