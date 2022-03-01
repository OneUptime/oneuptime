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
COPY ./common-server/package*.json /usr/src/common-server/
RUN npm ci
COPY ./common-server /usr/src/common-server

RUN mkdir /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY ./helm-chart/package*.json /usr/src/app/
RUN npm ci
RUN npm install -g ts-node

# Bundle app source
COPY ./helm-chart /usr/src/app

# Expose ports.
#   - 3423: OneUptime Helm Chart Server
EXPOSE 3423

#Run the app
CMD [ "npm", "start" ]