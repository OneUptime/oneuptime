#
# OneUptime Status Page Dockerfile
#

# Pull base image nodejs image.
FROM node:alpine

# Install bash. 
RUN apk update && apk add bash && apk add curl

#Use bash shell by default
SHELL ["/bin/bash", "-c"]
RUN npm install typescript -g

RUN mkdir /usr/src

# Install common
RUN mkdir /usr/src/Common
WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
RUN npm install
COPY ./Common /usr/src/Common
RUN npm run compile

# Install CommonServer
RUN mkdir /usr/src/CommonServer
WORKDIR /usr/src/CommonServer
COPY ./CommonServer/package*.json /usr/src/CommonServer/
RUN npm install
COPY ./CommonServer /usr/src/CommonServer
RUN npm run compile

#SET ENV Variables. 
ENV PRODUCTION=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Because of this error during build
# Error message "error:0308010C:digital envelope routines::unsupported"
ENV NODE_OPTIONS=--openssl-legacy-provider

RUN mkdir /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY ./StatusPage/package*.json /usr/src/app/

RUN npm install  
RUN npm install -g ts-node
RUN npm install -g ts-node-dev
RUN npm install -g serve
RUN npm install -g eslint

# Bundle app source
COPY ./StatusPage /usr/src/app

RUN npm run build

# Expose ports.
#   - 3006: HTTP OneUptime Status Page
EXPOSE 3006

# Expose ports.
#   - 3007: HTTPS OneUptime Status Page
EXPOSE 3007

#Run the app
CMD [ "npm", "start" ]
