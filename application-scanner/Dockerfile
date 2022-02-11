#
# application-scanner Dockerfile
#

# Pull base image nodejs image.
FROM node:lts-alpine

# Install bash. 
RUN apk update && apk add bash && apk add curl

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

# Install common-server
RUN mkdir /usr/src
RUN mkdir /usr/src/common-server
WORKDIR /usr/src/common-server
COPY ./common-server/package*.json /usr/src/common-server/
RUN npm ci --only=production
COPY ./common-server /usr/src/common-server

#SET ENV Variables
ENV PRODUCTION=true


RUN mkdir /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY ./application-scanner/package*.json /usr/src/app/
RUN npm ci --only=production

# Bundle app source
COPY ./application-scanner /usr/src/app

# Expose ports.
#   - 3005: Application Scanner
EXPOSE 3005

#Run the app
CMD [ "npm", "start"]
