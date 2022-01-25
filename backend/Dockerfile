#
# OneUptime-backend Dockerfile
#

# Pull base image nodejs image.
FROM node:17-alpine

# Install bash. 
RUN apk update && apk add bash && apk add curl

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

# Install common-server
RUN mkdir /usr/src
RUN mkdir /usr/src/common-server
WORKDIR /usr/src/common-server
COPY ./package*.json /usr/src/common-server/
RUN npm ci --only=production
COPY . /usr/src/common-server

#SET ENV Variables
ENV PRODUCTION=true

RUN mkdir /usr/src/app

WORKDIR /usr/src/app

# Install trivy for container scanning
RUN curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/master/contrib/install.sh | sh -s -- -b /usr/local/bin

# Install app dependencies
COPY ./package*.json /usr/src/app/
RUN npm ci --only=production

# Bundle app source
COPY . /usr/src/app

# Expose ports.
#   - 3002: OneUptime-backend
EXPOSE 3002

#Run the app
CMD [ "npm", "start"]
