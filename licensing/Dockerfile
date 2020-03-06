#
# Fyipe-backend Dockerfile
#

# Pull base image nodejs image.
FROM node:12.16.1

#SET ENV Variables
RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json /usr/src/app/
RUN npm ci

# Bundle app source
COPY . /usr/src/app

# Expose ports.
#   - 3002: Fyipe-backend
EXPOSE 3008

#Run the app
CMD [ "npm", "start"]
