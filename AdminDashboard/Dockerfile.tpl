#
# AdminDashboard Dockerfile
#

# Pull base image nodejs image.
FROM node:current-alpine
USER root
RUN mkdir /tmp/npm &&  chmod 2777 /tmp/npm && chown 1000:1000 /tmp/npm && npm config set cache /tmp/npm --global

RUN npm config set fetch-retry-maxtimeout 6000000
RUN npm config set fetch-retry-mintimeout 1000000
RUN npm install -g pnpm

ARG GIT_SHA
ARG APP_VERSION

ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}


# Install bash. 
RUN apk add bash && apk add curl

#Use bash shell by default
SHELL ["/bin/bash", "-c"]


RUN mkdir /usr/src

WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
RUN pnpm install
COPY ./Common /usr/src/Common


WORKDIR /usr/src/Model
COPY ./Model/package*.json /usr/src/Model/
RUN pnpm install
COPY ./Model /usr/src/Model



WORKDIR /usr/src/CommonServer
COPY ./CommonServer/package*.json /usr/src/CommonServer/
RUN pnpm install
COPY ./CommonServer /usr/src/CommonServer




# Install CommonUI

WORKDIR /usr/src/CommonUI
COPY ./CommonUI/package*.json /usr/src/CommonUI/
RUN pnpm install --force
COPY ./CommonUI /usr/src/CommonUI



ENV PRODUCTION=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /usr/src/app

# Install app dependencies
COPY ./AdminDashboard/package*.json /usr/src/app/
RUN pnpm install  

# Expose ports.
#   - 3158:  AdminDashboard
EXPOSE 3158

{{ if eq .Env.ENVIRONMENT "development" }}
#Run the app
RUN mkdir /usr/src/app/dev-env
RUN touch /usr/src/app/dev-env/.env
CMD [ "npm", "run", "dev" ]
{{ else }}
# Copy app source
COPY ./AdminDashboard /usr/src/app
# Bundle app source
RUN npm run build
#Run the app
CMD [ "npm", "start" ]
{{ end }}
