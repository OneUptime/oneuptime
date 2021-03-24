#
# Fyipe Home Dockerfile
#

# Pull base image nodejs image.
FROM node:15

#SET ENV Variables. 
ENV PRODUCTION=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json /usr/src/app/
RUN npm ci --only=production
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
