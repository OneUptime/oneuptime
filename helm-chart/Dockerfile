# Pull base image nodejs image.
FROM node:17-alpine

# Install bash. 
RUN apk update && apk add bash && apk add curl

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

RUN mkdir /usr/src
RUN mkdir /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY ./helm-chart/package*.json /usr/src/app/
RUN npm ci --only=production

# Bundle app source
COPY ./helm-chart /usr/src/app

# Expose ports.
#   - 3423: OneUptime Helm Chart Server
EXPOSE 3423

#Run the app
CMD [ "npm", "start" ]