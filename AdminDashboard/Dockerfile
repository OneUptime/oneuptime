#
# OneUptime-AdminDashboard Dockerfile
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
RUN mkdir /usr/src/Common
WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
RUN npm install
COPY ./Common /usr/src/Common
RUN npm compile

# Install CommonServer
RUN mkdir /usr/src/CommonServer
WORKDIR /usr/src/CommonServer
COPY ./CommonServer/package*.json /usr/src/CommonServer/
RUN npm install
COPY ./CommonServer /usr/src/CommonServer
RUN npm compile

# Install CommonUI
RUN mkdir /usr/src/CommonUI
WORKDIR /usr/src/CommonUI
COPY ./CommonUI/package*.json /usr/src/CommonUI/
RUN npm install
COPY ./CommonUI /usr/src/CommonUI
RUN npm compile

WORKDIR /usr/src/app

# Install app dependencies
COPY ./AdminDashboard/package*.json /usr/src/app/
RUN npm install  
RUN npm install -g ts-node

# Copy app source
COPY ./AdminDashboard /usr/src/app

# Bundle app source
RUN npm run build

# Expose ports.
#   - 3100:  OneUptime-AdminDashboard
EXPOSE 3100

#Run the app
CMD [ "npm", "start" ]