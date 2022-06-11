#
# Accounts Dockerfile
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


# Install CommonUI
RUN mkdir /usr/src/CommonUI
WORKDIR /usr/src/CommonUI
COPY ./CommonUI/package*.json /usr/src/CommonUI/
RUN npm install
COPY ./CommonUI /usr/src/CommonUI
RUN npm run compile


#SET ENV Variables
ENV PRODUCTION=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

RUN mkdir /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY ./Accounts/package*.json /usr/src/app/
RUN npm install  
RUN npm install -g ts-node
RUN npm install -g ts-node-dev

# Copy app source
COPY ./Accounts /usr/src/app

# Bundle app source
RUN npm run build

# Expose ports.
#   - 3003:  accounts
EXPOSE 3003

#Run the app
CMD [ "npm", "start" ]
