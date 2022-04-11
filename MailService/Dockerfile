#
# MailService Dockerfile
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

# Install CommonServer
RUN mkdir /usr/src/CommonServer
WORKDIR /usr/src/CommonServer
COPY ./CommonServer/package*.json /usr/src/CommonServer/
RUN npm install
COPY ./CommonServer /usr/src/CommonServer
RUN npm compile

#SET ENV Variables
ENV PRODUCTION=true
ENV CHROME_PATH=/usr/bin/chromium

# Install Chrome.
RUN apk add curl chromium

RUN mkdir /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY ./MailService/package*.json /usr/src/app/
RUN npm install
RUN npm install -g ts-node

# Bundle app source
COPY ./MailService /usr/src/app

# Expose ports.
#   - 3190: MailService Runner
EXPOSE 3190

#Run the app
RUN npm compile
CMD [ "npm", "start"]
