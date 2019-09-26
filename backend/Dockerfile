#
# Fyipe-backend Dockerfile
#

# Pull base image nodejs image.
FROM ubuntu:latest

#SET ENV Variables.
ENV PRODUCTION=true

RUN apt-get update
RUN apt-get install -y curl software-properties-common
RUN curl -sL https://deb.nodesource.com/setup_10.x | bash -
RUN apt-get install -y nodejs

#Update NPM
RUN npm install -g npm

RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json /usr/src/app/
RUN npm ci


# Bundle app source
COPY . /usr/src/app

# Expose ports.
#   - 3002: Fyipe-backend
EXPOSE 3002

#Run the app
CMD [ "npm", "start"]
