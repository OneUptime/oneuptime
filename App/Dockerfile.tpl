#
# OneUptime-App Dockerfile
#

# Pull base image nodejs image.
FROM node:21.2-alpine3.18
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



WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
RUN npm install
COPY ./Common /usr/src/Common


WORKDIR /usr/src/Model
COPY ./Model/package*.json /usr/src/Model/
RUN npm install
COPY ./Model /usr/src/Model



WORKDIR /usr/src/CommonServer
COPY ./CommonServer/package*.json /usr/src/CommonServer/
RUN npm install
COPY ./CommonServer /usr/src/CommonServer



ENV PRODUCTION=true

WORKDIR /usr/src/app

# Install app dependencies
COPY ./App/package*.json /usr/src/app/
RUN npm install

# Install global npm modules 
RUN npm i -D webpack-cli

# Expose ports.
#   - 3002: OneUptime-backend
EXPOSE 3002



# -----------------
# Install Accounts REact App 
# -----------------

COPY ./App/FeatureSet/Accounts/package*.json /usr/src/app/FeatureSet/Accounts/
RUN cd /usr/src/app/FeatureSet/Accounts && npm install




{{ if eq .Env.ENVIRONMENT "development" }}
#Run the app

RUN mkdir /usr/src/app/dev-env
RUN touch /usr/src/app/dev-env/.env
RUN npm i -D webpack-dev-server

CMD [ "npm", "run", "dev" ]
{{ else }}
# Copy app source
COPY ./App /usr/src/app
# Bundle app source
RUN npm run compile
#Run the app

# Build Accounts. 
RUN cd /usr/src/app/FeatureSet/Accounts && npm run build

CMD [ "npm", "start" ]
{{ end }}
