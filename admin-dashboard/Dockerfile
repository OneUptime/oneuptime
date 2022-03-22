#
# OneUptime-admin-dashboard Dockerfile
#

# Pull base image nodejs image.
FROM node:alpine

# Install bash. 
RUN apk update && apk add bash && apk add curl

# Install python
RUN apk update && apk add --no-cache --virtual .gyp python3 make g++

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

#SET ENV Variables
ENV PRODUCTION=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Because of this error during build
# Error message "error:0308010C:digital envelope routines::unsupported"
ENV NODE_OPTIONS=--openssl-legacy-provider

RUN mkdir /usr/src
RUN mkdir /usr/src/app


# Install common
RUN mkdir /usr/src/common
WORKDIR /usr/src/common
COPY ./common/package*.json /usr/src/common/
RUN npm install
COPY ./common /usr/src/common

# Install common-server
RUN mkdir /usr/src/common-server
WORKDIR /usr/src/common-server
COPY ./common-server/package*.json /usr/src/common-server/
RUN npm install
COPY ./common-server /usr/src/common-server

# Install common-ui
RUN mkdir /usr/src/common-ui
WORKDIR /usr/src/common-ui
COPY ./common-ui/package*.json /usr/src/common-ui/
RUN npm install
COPY ./common-ui /usr/src/common-ui

WORKDIR /usr/src/app

# Install app dependencies
COPY ./admin-dashboard/package*.json /usr/src/app/
RUN npm install  
RUN npm install -g ts-node

# Copy app source
COPY ./admin-dashboard /usr/src/app

# Bundle app source
RUN npm run build

# Expose ports.
#   - 3100:  OneUptime-admin-dashboard
EXPOSE 3100

#Run the app
CMD [ "npm", "start" ]