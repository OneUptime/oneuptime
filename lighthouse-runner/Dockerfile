#
# lighthouse-runner Dockerfile
#

# Pull base image nodejs image.
FROM node:alpine

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

#SET ENV Variables
ENV PRODUCTION=true
ENV CHROME_PATH=/usr/bin/chromium

# Install Chrome.
RUN apk add curl chromium

RUN mkdir /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY ./lighthouse-runner/package*.json /usr/src/app/
RUN npm install
RUN npm install -g ts-node

# Bundle app source
COPY ./lighthouse-runner /usr/src/app

# Expose ports.
#   - 3015: Lighthouse Runner
EXPOSE 3015

#Run the app
CMD [ "npm", "start"]
