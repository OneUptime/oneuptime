#
# Fyipe Dockerfile
#

# Pull base image nodejs image.
FROM node:16

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

ENV NODE_OPTIONS="--max-old-space-size=8192"

#SET ENV Variables
ENV PRODUCTION=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json /usr/src/app/
RUN npm ci --only=production

# Copy app source
COPY . /usr/src/app

# Install purgecss to mame CSS files smaller. 
RUN npm install purgecss -g

# Bundle app source
RUN npm run build

# Expose ports.
#   - 3000:  Fyipe
EXPOSE 3000

#Run the app
CMD [ "npm", "start" ]
