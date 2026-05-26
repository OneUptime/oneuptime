#
# OneUptime-AIAgent Dockerfile
#

# Pull base image nodejs image.
FROM public.ecr.aws/docker/library/node:24.9
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

LABEL org.opencontainers.image.title="OneUptime AI Agent"
LABEL org.opencontainers.image.description="OneUptime AI agent service that powers incident triage, summarization, and autonomous workflows."
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.url="https://oneuptime.com"
LABEL org.opencontainers.image.documentation="https://oneuptime.com/docs"
LABEL org.opencontainers.image.vendor="OneUptime"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${APP_VERSION}"

# Install runtime tools (bash, curl, ca-certificates) in a single layer with
# cache cleanup. ca-certificates is required by `update-ca-certificates` below.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        bash \
        curl \
    && rm -rf /var/lib/apt/lists/*

## Add Intermediate Certs (ca-certificates is now installed above)
COPY ./SslCertificates /usr/local/share/ca-certificates
RUN update-ca-certificates

# Install OpenCode AI coding assistant. The installer defaults to
# $HOME/.opencode (i.e. /root/.opencode), which is unreachable from non-root
# users because /root is mode 700. Relocate to /usr/local/opencode so the
# `node` user can read+execute the CLI when we drop privileges below.
RUN curl -fsSL https://opencode.ai/install | bash \
    && mv /root/.opencode /usr/local/opencode \
    && chmod -R a+rx /usr/local/opencode
ENV PATH="/usr/local/opencode/bin:${PATH}"

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

RUN mkdir -p /usr/src

WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
RUN npm install
COPY ./Common /usr/src/Common


ENV PRODUCTION=true

WORKDIR /usr/src/app

# Install app dependencies
COPY ./AIAgent/package*.json /usr/src/app/
RUN npm install

# Expose ports.
#   - 3875: OneUptime-AIAgent
EXPOSE 3875

{{ if eq .Env.ENVIRONMENT "development" }}
#Run the app
CMD [ "npm", "run", "dev" ]
{{ else }}
# Copy app source
COPY ./AIAgent /usr/src/app
# Bundle app source
RUN npm run compile
# Ensure runtime dirs are owned by the non-root `node` user (UID 1000) so the
# container can run as non-root.
RUN chown -R 1000:1000 /usr/src /tmp/npm && chmod -R 2777 /tmp/npm
USER node
#Run the app
CMD [ "npm", "start" ]
{{ end }}
