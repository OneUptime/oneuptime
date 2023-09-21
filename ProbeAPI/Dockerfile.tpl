#
# OneUptime-probe-api Dockerfile
#

# Pull base image nodejs image.
FROM node:current-alpine AS base
USER root
RUN mkdir /tmp/npm &&  chmod 2777 /tmp/npm && chown 1000:1000 /tmp/npm && npm config set cache /tmp/npm --global

RUN npm config set fetch-retry-maxtimeout 6000000
RUN npm config set fetch-retry-mintimeout 1000000

ARG GIT_SHA
ARG APP_VERSION

ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}


# Install bash. 
RUN apk add bash && apk add curl


# Install python
RUN apk update && apk add --no-cache --virtual .gyp python3 make g++

#Use bash shell by default
SHELL ["/bin/bash", "-c"]


RUN mkdir /usr/src

# Install common

FROM base AS common
WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
RUN npm install
COPY ./Common /usr/src/Common


# Install Model

FROM base AS model
WORKDIR /usr/src/Model
COPY ./Model/package*.json /usr/src/Model/
RUN npm install
COPY ./Model /usr/src/Model



# Install CommonServer

FROM base AS commonserver
WORKDIR /usr/src/CommonServer
COPY ./CommonServer/package*.json /usr/src/CommonServer/
RUN npm install
COPY ./CommonServer /usr/src/CommonServer



#SET ENV Variables
# Install app
FROM base AS app

WORKDIR /usr/src/Common
COPY --from=common /usr/src/Common .

WORKDIR /usr/src/Model
COPY --from=model /usr/src/Model .

WORKDIR /usr/src/CommonServer
COPY --from=commonserver /usr/src/CommonServer .

ENV PRODUCTION=true

WORKDIR /usr/src/app

# Install app dependencies
COPY ./ProbeAPI/package*.json /usr/src/app/
RUN npm install

# Expose ports.
#   - 3400: OneUptime-probe-api
EXPOSE 3400

{{ if eq .Env.ENVIRONMENT "development" }}
#Run the app
CMD [ "npm", "run", "dev" ]
{{ else }}
# Copy app source
COPY ./ProbeAPI /usr/src/app
# Bundle app source
RUN npm run compile
#Run the app
CMD [ "npm", "start" ]
{{ end }}

