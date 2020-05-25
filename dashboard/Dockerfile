#
# Fyipe Dockerfile
#

# Pull base image nodejs image.
FROM node:12.16.1

#SET ENV Variables
ENV PRODUCTION=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

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
#   - 3000:  Fyipe
EXPOSE 3000

#Run the app
CMD [ "npm", "start" ]
