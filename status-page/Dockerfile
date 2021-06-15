#
# Fyipe Home Dockerfile
#

# Pull base image nodejs image.
FROM node:16

#SET ENV Variables. 
ENV PRODUCTION=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json /usr/src/app/
# using --legacy-peer-deps because of issues with dependency
# https://stackoverflow.com/a/66620869
# this issue is because of the node update
# will remove the flag, once the dependency tree for all package is updated
RUN npm ci --only=production --legacy-peer-deps
RUN npm install -g serve
RUN npm install -g eslint

# Bundle app source
COPY . /usr/src/app

RUN npm run build

# Expose ports.
#   - 3006: HTTP Fyipe Status Page
EXPOSE 3006

# Expose ports.
#   - 3007: HTTPS Fyipe Status Page
EXPOSE 3007

#Run the app
CMD [ "npm", "start" ]
