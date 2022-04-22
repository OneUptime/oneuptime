#
# OneUptime Init Script
#

FROM node:alpine

# Install bash. 
RUN apk update && apk add bash && apk add curl


# Install python
RUN apk update && apk add --no-cache --virtual .gyp python3 make g++

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

RUN mkdir /usr/src

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

# Set env variables
ENV PRODUCTION=true

RUN mkdir /usr/src/app
WORKDIR /usr/src/app

# Copy app source
COPY ./InitScript /usr/src/app

# Install app dependencies
RUN npm install

# Run app
CMD ["npm", "start"]