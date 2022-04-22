#
# Accounts Dockerfile
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


# Install CommonUI
RUN mkdir /usr/src/CommonUI
WORKDIR /usr/src/CommonUI
COPY ./CommonUI/package*.json /usr/src/CommonUI/
RUN npm install
COPY ./CommonUI /usr/src/CommonUI
RUN npm compile


#SET ENV Variables
ENV PRODUCTION=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

RUN mkdir /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY ./accounts/package*.json /usr/src/app/
RUN npm install  
RUN npm install -g ts-node

# Copy app source
COPY ./accounts /usr/src/app

# Bundle app source
RUN npm run build

# Expose ports.
#   - 3003:  accounts
EXPOSE 3003

#Run the app
CMD [ "npm", "start" ]
