#
# OneUptime-copilot Dockerfile
#

# Pull base image nodejs image.
FROM node:22.3.0
RUN mkdir /tmp/npm &&  chmod 2777 /tmp/npm && chown 1000:1000 /tmp/npm && npm config set cache /tmp/npm --global

ARG GIT_SHA
ARG APP_VERSION

ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}


# IF APP_VERSION is not set, set it to 1.0.0
RUN if [ -z "$APP_VERSION" ]; then export APP_VERSION=1.0.0; fi


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


WORKDIR /usr/src/Model
COPY ./Model/package*.json /usr/src/Model/
# Set version in ./Model/package.json to the APP_VERSION
RUN sed -i "s/\"version\": \".*\"/\"version\": \"$APP_VERSION\"/g" /usr/src/Model/package.json
RUN npm install
COPY ./Model /usr/src/Model

WORKDIR /usr/src/CommonProject
COPY ./CommonProject/package*.json /usr/src/CommonProject/
# Set version in ./CommonProject/package.json to the APP_VERSION
RUN sed -i "s/\"version\": \".*\"/\"version\": \"$APP_VERSION\"/g" /usr/src/CommonProject/package.json
RUN npm install
COPY ./CommonProject /usr/src/CommonProject


WORKDIR /usr/src/CommonServer
COPY ./CommonServer/package*.json /usr/src/CommonServer/
# Set version in ./CommonServer/package.json to the APP_VERSION
RUN sed -i "s/\"version\": \".*\"/\"version\": \"$APP_VERSION\"/g" /usr/src/CommonServer/package.json
RUN npm install
COPY ./CommonServer /usr/src/CommonServer


WORKDIR /usr/src/CommonUI
COPY ./CommonUI/package*.json /usr/src/CommonUI/
# Set version in ./CommonServer/package.json to the APP_VERSION
RUN sed -i "s/\"version\": \".*\"/\"version\": \"$APP_VERSION\"/g" /usr/src/CommonUI/package.json
RUN npm install
COPY ./CommonUI /usr/src/CommonUI

ENV PRODUCTION=true

WORKDIR /usr/src/app

# Install app dependencies
COPY ./Copilot/package*.json /usr/src/app/
RUN npm install


# Create /repository/ directory where the app will store the repository
RUN mkdir -p /repository

# Set the stack trace limit to 0 to show full stack traces
ENV NODE_OPTIONS='--stack-trace-limit=30'

{{ if eq .Env.ENVIRONMENT "development" }}
#Run the app
CMD [ "npm", "run", "dev" ]
{{ else }}
# Copy app source
COPY ./Copilot /usr/src/app
# Bundle app source
RUN npm run compile
#Run the app
CMD [ "npm", "start" ]
{{ end }}