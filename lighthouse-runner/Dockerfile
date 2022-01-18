#
# lighthouse-runner Dockerfile
#

# Pull base image nodejs image.
FROM node:17

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

#SET ENV Variables
ENV PRODUCTION=true
ENV CHROME_PATH=/usr/bin/chromium

# Install Chrome.
RUN apt-get update
RUN apt-get install -y chromium

RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json /usr/src/app/
RUN npm ci --only=production

# Bundle app source
COPY . /usr/src/app

# Expose ports.
#   - 3015: Lighthouse Runner
EXPOSE 3015

#Run the app
CMD [ "npm", "start"]
