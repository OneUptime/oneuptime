#
# Fyipe-http-test-server Dockerfile
#

# Pull base image nodejs image.
FROM node:12.16.1-alpine

#SET ENV Variables
ENV PRODUCTION=true

RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json /usr/src/app/
RUN npm ci

# Bundle app source
COPY . /usr/src/app

# Expose ports.
#   - 3010: Fyipe-http-test-server
EXPOSE 3010

#Run the app
CMD [ "npm", "start"]
