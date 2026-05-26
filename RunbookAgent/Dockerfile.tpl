#
# OneUptime Runbook Agent Dockerfile
#

FROM public.ecr.aws/docker/library/node:24.9
RUN mkdir /tmp/npm &&  chmod 2777 /tmp/npm && chown 1000:1000 /tmp/npm && npm config set cache /tmp/npm --global

RUN npm config set fetch-retries 5
RUN npm config set fetch-retry-mintimeout 20000
RUN npm config set fetch-retry-maxtimeout 60000

ARG GIT_SHA
ARG APP_VERSION

ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
ENV NODE_OPTIONS="--use-openssl-ca"

LABEL org.opencontainers.image.title="OneUptime Runbook Agent"
LABEL org.opencontainers.image.description="Executes Bash runbook steps in your own infrastructure and reports results back to OneUptime."
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.url="https://oneuptime.com"
LABEL org.opencontainers.image.vendor="OneUptime"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${APP_VERSION}"

# Trust the same intermediate certs as the rest of the platform.
COPY ./SslCertificates /usr/local/share/ca-certificates
RUN update-ca-certificates


# bash + tini for process control; python3/make/g++ to compile `isolated-vm`
# (the sandbox used to run JavaScript runbook steps).
RUN apt-get update \
  && apt-get install -y bash curl tini python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

SHELL ["/bin/bash", "-c"]

RUN mkdir -p /usr/src

WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
RUN npm install
COPY ./Common /usr/src/Common

ENV PRODUCTION=true

WORKDIR /usr/src/app
COPY ./RunbookAgent/package*.json /usr/src/app/
RUN npm install \
    && apt-get purge -y --auto-remove python3 make g++ \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# Reap zombie children (e.g. `bash -c` processes the agent spawns).
ENTRYPOINT ["/usr/bin/tini", "--"]

{{ if eq .Env.ENVIRONMENT "development" }}
#Run the app
CMD [ "npm", "run", "dev" ]
{{ else }}
# Copy app source
COPY ./RunbookAgent /usr/src/app
# Ensure runtime dirs are owned by the non-root `node` user (UID 1000) so the
# container can run as non-root.
RUN chown -R 1000:1000 /usr/src /tmp/npm && chmod -R 2777 /tmp/npm
USER node
#Run the app
CMD [ "npm", "start" ]
{{ end }}
