#
# NotificationService Dockerfile
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
ENV CHROME_PATH=/usr/bin/chromium


WORKDIR /usr/src/app

# Install app dependencies
COPY ./Notification/package*.json /usr/src/app/
RUN npm install



# Expose ports.
#   - 3191: NotificationService Runner
EXPOSE 3191

{{ if eq .Env.ENVIRONMENT "development" }}
#Run the app
CMD [ "npm", "run", "dev" ]
{{ else }}
# Copy app source
COPY ./Notification /usr/src/app
# Bundle app source
RUN npm run compile
#Run the app
CMD [ "npm", "start" ]
{{ end }}
