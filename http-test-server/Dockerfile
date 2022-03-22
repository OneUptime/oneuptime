#
# OneUptime-http-test-server Dockerfile
#

# Pull base image nodejs image.
FROM node:alpine

# Install bash. 
RUN apk update && apk add bash && apk add curl

#Use bash shell by default
SHELL ["/bin/bash", "-c"]


RUN mkdir /usr/src

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

#SET ENV Variables
ENV PRODUCTION=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true


RUN mkdir /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY ./http-test-server/package*.json /usr/src/app/
RUN npm install
RUN npm install -g ts-node

# Bundle app source
COPY ./http-test-server /usr/src/app

# Expose ports.
#   - 3010: OneUptime-http-test-server
EXPOSE 3010

#Run the app
CMD [ "npm", "start"]
