#
# OneUptime:script-runner Dockerfile
#

# Pull base image nodejs image.
FROM node:17

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
#   - 3009: OneUptime:script-runner
EXPOSE 3009

#Run the app
CMD [ "npm", "start"]