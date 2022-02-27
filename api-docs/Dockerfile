# Pull base image nodejs image.
FROM node:17-alpine

# Install bash. 
RUN apk update && apk add bash && apk add curl

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

RUN mkdir /usr/src
RUN mkdir /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY ./api-docs/package*.json /usr/src/app/
RUN npm ci
RUN npm install -g ts-node

# Bundle app source
COPY ./api-docs /usr/src/app

# Expose ports.
#   - 1445: OneUptime Docs
EXPOSE 1445

#Run the app
CMD [ "npm", "start" ]