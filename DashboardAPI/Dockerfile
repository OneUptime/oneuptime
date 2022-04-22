#
# OneUptime-backend Dockerfile
#

# Pull base image nodejs image.
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

#SET ENV Variables
ENV PRODUCTION=true

RUN mkdir /usr/src/app

WORKDIR /usr/src/app

# Install trivy for container scanning
RUN curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/master/contrib/install.sh | sh -s -- -b /usr/local/bin

# Install app dependencies
COPY ./DashboardAPI/package*.json /usr/src/app/
RUN npm install
RUN npm install -g ts-node

# Bundle app source
COPY ./DashboardAPI /usr/src/app

# Expose ports.
#   - 3002: OneUptime-backend
EXPOSE 3002

#Run the app
RUN npm compile
CMD [ "npm", "start"]
