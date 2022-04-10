#
# OneUptime Status Page Dockerfile
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
RUN npm compile

# Install common-server
RUN mkdir /usr/src/common-server
WORKDIR /usr/src/common-server
COPY ./common-server/package*.json /usr/src/common-server/
RUN npm install
COPY ./common-server /usr/src/common-server
RUN npm compile

#SET ENV Variables. 
ENV PRODUCTION=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Because of this error during build
# Error message "error:0308010C:digital envelope routines::unsupported"
ENV NODE_OPTIONS=--openssl-legacy-provider

RUN mkdir /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY ./status-page/package*.json /usr/src/app/

RUN npm install  
RUN npm install -g ts-node
RUN npm install -g serve
RUN npm install -g eslint

# Bundle app source
COPY ./status-page /usr/src/app

RUN npm run build

# Expose ports.
#   - 3006: HTTP OneUptime Status Page
EXPOSE 3006

# Expose ports.
#   - 3007: HTTPS OneUptime Status Page
EXPOSE 3007

#Run the app
CMD [ "npm", "start" ]
