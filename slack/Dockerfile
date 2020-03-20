#
# Fyipe Home Dockerfile
#

# Pull base image nodejs image.
FROM node:12.16.1

#SET ENV Variables. 
ENV PRODUCTION=true

RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json /usr/src/app/
RUN npm ci

# Bundle app source
COPY . /usr/src/app

# Expose ports.
#   - 1267: Fyipe Slack.
EXPOSE 1267

#Run the app
CMD [ "npm", "start" ]
