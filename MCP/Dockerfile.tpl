#
# OneUptime MCP Server Dockerfile
#

# Pull base image nodejs image.
FROM public.ecr.aws/docker/library/node:22.3.0
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

# IF APP_VERSION is not set, set it to 1.0.0
RUN if [ -z "$APP_VERSION" ]; then export APP_VERSION=1.0.0; fi

# Install bash. 
RUN apt-get install bash -y && apt-get install curl -y

# Install python
RUN apt-get update && apt-get install -y .gyp python3 make g++

#Use bash shell by default
SHELL ["/bin/bash", "-c"]
RUN npm install typescript -g

USER root

RUN mkdir -p /usr/src

WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
RUN npm install
COPY ./Common /usr/src/Common

WORKDIR /usr/src/app

# Install app dependencies
COPY ./MCP/package*.json /usr/src/app/
RUN npm update @oneuptime/common
RUN npm install
COPY ./MCP /usr/src/app

# Build the application
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

# Expose Port
EXPOSE 3002

#Run the app
CMD [ "npm", "start" ]
