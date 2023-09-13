#
# Accounts Dockerfile
#

# Pull base image nodejs image.
FROM node:current-alpine AS base
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




# Install CommonUI

FROM base AS commonui
WORKDIR /usr/src/CommonUI
COPY ./CommonUI/package*.json /usr/src/CommonUI/
RUN npm install --force
COPY ./CommonUI /usr/src/CommonUI



#SET ENV Variables
# Install app
FROM base AS app

WORKDIR /usr/src/Common
COPY --from=common /usr/src/Common .

WORKDIR /usr/src/Model
COPY --from=model /usr/src/Model .

WORKDIR /usr/src/CommonServer
COPY --from=commonserver /usr/src/CommonServer .

WORKDIR /usr/src/CommonUI
COPY --from=commonui /usr/src/CommonUI .


ENV PRODUCTION=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /usr/src/app

# Install app dependencies
COPY ./Accounts/package*.json /usr/src/app/
RUN npm install  

# Expose ports.
#   - 3003:  accounts
EXPOSE 3003



{{ if eq .Env.ENVIRONMENT "development" }}
RUN mkdir /usr/src/app/dev-env
RUN touch /usr/src/app/dev-env/.env
#Run the app
CMD [ "npm", "run", "dev" ]
{{ else }}
# Copy app source
COPY ./Accounts /usr/src/app
# Bundle app source
RUN npm run build
#Run the app
CMD [ "npm", "start" ]
{{ end }}
