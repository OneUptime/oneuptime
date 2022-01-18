#
# OneUptime-licensing Dockerfile
#

# Pull base image nodejs image.
FROM node:17-alpine

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

#SET ENV Variables
ENV PRODUCTION=true

RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json /usr/src/app/
RUN npm ci --only=production

# Bundle app source
COPY . /usr/src/app

# Expose ports.
#   - 3004: OneUptime-licensing
EXPOSE 3004

#Run the app
CMD [ "npm", "start"]
