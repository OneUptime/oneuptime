#
# OneUptime-DashboardAPI Dockerfile
#

# Pull base image nodejs image.
FROM node:current-alpine as Base
USER root
RUN mkdir /tmp/npm &&  chmod 2777 /tmp/npm && chown 1000:1000 /tmp/npm && npm config set cache /tmp/npm --global

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

FROM Base AS Common
WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
RUN npm install
COPY ./Common /usr/src/Common


# Install Model

FROM Base AS Model
WORKDIR /usr/src/Model
COPY ./Model/package*.json /usr/src/Model/
RUN npm install
COPY ./Model /usr/src/Model



# Install CommonServer

FROM Base AS CommonServer
WORKDIR /usr/src/CommonServer
COPY ./CommonServer/package*.json /usr/src/CommonServer/
RUN npm install
COPY ./CommonServer /usr/src/CommonServer



#SET ENV Variables
# Install app
FROM Base AS App

WORKDIR /usr/src/Common
COPY --from=Common /usr/src/Common .

WORKDIR /usr/src/Model
COPY --from=Model /usr/src/Model .

WORKDIR /usr/src/CommonServer
COPY --from=CommonServer /usr/src/CommonServer .

ENV PRODUCTION=true

WORKDIR /usr/src/app

# Install app dependencies
COPY ./DashboardAPI/package*.json /usr/src/app/
RUN npm install

# Expose ports.
#   - 3002: OneUptime-backend
EXPOSE 3002

{{ if eq .Env.ENVIRONMENT "development" }}
#Run the app
CMD [ "npm", "run", "dev" ]
{{ else }}
# Copy app source
COPY ./DashboardAPI /usr/src/app
# Bundle app source
RUN npm run compile
#Run the app
CMD [ "npm", "start" ]
{{ end }}
