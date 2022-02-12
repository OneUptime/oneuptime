#
# OneUptime Home Dockerfile
#

# Pull base image nodejs image.
FROM node:17-alpine

#SET ENV Variables. 
ENV PRODUCTION=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Install bash. 
RUN apk update && apk add bash && apk add curl

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

RUN mkdir /usr/src
RUN mkdir /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY ./home/package*.json /usr/src/app/
RUN npm ci --only=production

# Bundle app source
COPY ./home /usr/src/app

# Expose ports.
#   - 1444: OneUptime Home
EXPOSE 1444

#Run the app
CMD [ "npm", "start" ]
