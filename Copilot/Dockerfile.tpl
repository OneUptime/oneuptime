#
# OneUptime-copilot Dockerfile
#

# Pull base image nodejs image.
FROM public.ecr.aws/docker/library/node:22.3.0
RUN mkdir /tmp/npm &&  chmod 2777 /tmp/npm && chown 1000:1000 /tmp/npm && npm config set cache /tmp/npm --global

RUN npm config set fetch-retries 5
RUN npm config set fetch-retry-mintimeout 100000
RUN npm config set fetch-retry-maxtimeout 600000


ARG GIT_SHA
ARG APP_VERSION
ARG IS_ENTERPRISE_EDITION=false

ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
ENV IS_ENTERPRISE_EDITION=${IS_ENTERPRISE_EDITION}
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1


# IF APP_VERSION is not set, set it to 1.0.0
RUN if [ -z "$APP_VERSION" ]; then export APP_VERSION=1.0.0; fi


RUN apt-get update

# Install bash. 
RUN apt-get install bash -y && apt-get install curl -y

# Install python
RUN apt-get update && apt-get install -y .gyp python3 make g++

#Use bash shell by default
SHELL ["/bin/bash", "-c"]


RUN mkdir -p /usr/src

WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
# Set version in ./Common/package.json to the APP_VERSION
RUN sed -i "s/\"version\": \".*\"/\"version\": \"$APP_VERSION\"/g" /usr/src/Common/package.json
RUN npm install
COPY ./Common /usr/src/Common



ENV PRODUCTION=true

WORKDIR /usr/src/app

# Install app dependencies
COPY ./Copilot/package*.json /usr/src/app/
RUN npm install

# Create /repository/ directory where the app will store the repository
RUN mkdir -p /repository

# Set the stack trace limit to 30 to show longer stack traces
ENV NODE_OPTIONS="--stack-trace-limit=30"

{{ if eq .Env.ENVIRONMENT "development" }}
#Run the app
CMD [ "npm", "run", "dev" ]
{{ else }}
# Copy app source
COPY ./Copilot /usr/src/app
# Bundle app source
RUN npm run build
# Set permission to write logs and cache in case container run as non root
RUN chown -R 1000:1000 "/tmp/npm" && chmod -R 2777 "/tmp/npm"
#Run the app
CMD [ "npm", "start" ]
{{ end }}
