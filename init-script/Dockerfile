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