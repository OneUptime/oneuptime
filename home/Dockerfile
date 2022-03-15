#
# OneUptime Home Dockerfile
#

# Pull base image nodejs image.
FROM node:alpine

#SET ENV Variables. 
ENV PRODUCTION=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Install bash. 
RUN apk update && apk add bash && apk add curl

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

# Install common-server
RUN mkdir /usr/src
RUN mkdir /usr/src/common-server
WORKDIR /usr/src/common-server
COPY ./common-server/package*.json /usr/src/common-server/
RUN npm install
COPY ./common-server /usr/src/common-server

RUN mkdir /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY ./home/package*.json /usr/src/app/
RUN npm install
RUN npm install -g ts-node

# Bundle app source
COPY ./home /usr/src/app

# Expose ports.
#   - 1444: OneUptime Home
EXPOSE 1444

#Run the app
CMD [ "npm", "start" ]
