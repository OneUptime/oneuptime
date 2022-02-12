#
# Accounts Dockerfile
#

# Pull base image nodejs image.
FROM node:17-alpine

# Install bash. 
RUN apk update && apk add bash && apk add curl

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

#SET ENV Variables
ENV PRODUCTION=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

RUN mkdir /usr/src
RUN mkdir /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY ./accounts/package*.json /usr/src/app/
RUN npm ci --only=production --legacy-peer-deps

# Copy app source
COPY ./accounts /usr/src/app

# Bundle app source
RUN npm run build

# Expose ports.
#   - 3003:  accounts
EXPOSE 3003

#Run the app
CMD [ "npm", "start" ]
