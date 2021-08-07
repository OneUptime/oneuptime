#
# Fyipe-backend Dockerfile
#

# Pull base image nodejs image.
FROM node:16

#SET ENV Variables
ENV PRODUCTION=true
ENV CHROME_PATH=/usr/bin/chromium-browser

# Install Chrome.
RUN apt-get update
RUN apt-get install chromium-browser

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
