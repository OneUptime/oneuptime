#
# Fyipe-admin-dashboard Dockerfile
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

# Copy app source
COPY . /usr/src/app

# Bundle app source
RUN npm run build

# Expose ports.
#   - 3100:  Fyipe-admin-dashboard
EXPOSE 3100

#Run the app
CMD [ "npm", "start" ]