#
# OneUptime Init Script
#

FROM node:17-alpine

# Install bash. 
RUN apk update && apk add bash && apk add curl


# Install python
RUN apk add --update python make g++\
   && rm -rf /var/cache/apk/*
   
#Use bash shell by default
SHELL ["/bin/bash", "-c"]

# Install common-server
RUN mkdir /usr/src
RUN mkdir /usr/src/common-server
WORKDIR /usr/src/common-server
COPY ./common-server/package*.json /usr/src/common-server/
RUN npm ci --only=production
COPY ./common-server /usr/src/common-server

# Set env variables
ENV PRODUCTION=true

RUN mkdir /usr/src/app
WORKDIR /usr/src/app

# Copy app source
COPY ./init-script /usr/src/app

# Install app dependencies
RUN npm install

# Run app
CMD ["npm", "start"]