#
# OneUptime-admin-dashboard Dockerfile
#

# Pull base image nodejs image.
FROM node:17-alpine

# Install bash. 
RUN apk update && apk add bash && apk add curl

# Install python
RUN apk add --update python

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

# Install common-ui
RUN mkdir /usr/src/common-ui
WORKDIR /usr/src/common-ui
COPY ./common-ui/package*.json /usr/src/common-ui/
RUN npm ci --only=production
COPY ./common-ui /usr/src/common-ui

WORKDIR /usr/src/app

# Install app dependencies
COPY ./admin-dashboard/package*.json /usr/src/app/
RUN npm ci --only=production --legacy-peer-deps

# Copy app source
COPY ./admin-dashboard /usr/src/app

# Bundle app source
RUN npm run build

# Expose ports.
#   - 3100:  OneUptime-admin-dashboard
EXPOSE 3100

#Run the app
CMD [ "npm", "start" ]