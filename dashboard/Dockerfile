#
# OneUptime Dockerfile
#

# Pull base image nodejs image.
FROM node:17-alpine

# Install bash. 
RUN apk update && apk add bash && apk add curl


# Install python
RUN apk update && apk add --no-cache --virtual .gyp python3 make g++

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

# Install common-server
RUN mkdir /usr/src
RUN mkdir /usr/src/common-server
WORKDIR /usr/src/common-server
COPY ./common-server/package*.json /usr/src/common-server/
RUN npm ci
COPY ./common-server /usr/src/common-server

# Install common-ui
RUN mkdir /usr/src/common-ui
WORKDIR /usr/src/common-ui
COPY ./common-ui/package*.json /usr/src/common-ui/
RUN npm ci
COPY ./common-ui /usr/src/common-ui

ENV NODE_OPTIONS="--max-old-space-size=8192"

#SET ENV Variables
ENV PRODUCTION=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Because of this error during build
# Error message "error:0308010C:digital envelope routines::unsupported"
ENV NODE_OPTIONS=--openssl-legacy-provider

RUN mkdir /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY ./dashboard/package*.json /usr/src/app/
RUN npm ci  
RUN npm install -g ts-node

# Copy app source
COPY ./dashboard /usr/src/app

# Install purgecss to make CSS files smaller. 
RUN npm install purgecss -g

# Bundle app source
RUN npm run build

# Expose ports.
#   - 3000:  OneUptime
EXPOSE 3000

#Run the app
CMD [ "npm", "start" ]
