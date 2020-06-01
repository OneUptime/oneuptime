#
# Fyipe-backend Dockerfile
#

# Pull base image nodejs image.
FROM node:12.16.1

#SET ENV Variables
ENV PRODUCTION=true
ENV CHROME_PATH=/usr/src/app/node_modules/chromium/lib/chromium/chrome-linux/chrome

RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json /usr/src/app/
RUN npm ci

# Bundle app source
COPY . /usr/src/app

# Expose ports.
#   - 3008: probe
EXPOSE 3008

#Run the app
CMD [ "npm", "start"]
