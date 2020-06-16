# Pull base image nodejs image.
FROM node:12.16.1

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json /usr/src/app/
RUN npm ci

# Bundle app source
COPY . /usr/src/app

# Expose ports.
#   - 1445: Fyipe Dcos
EXPOSE 1445

#Run the app
CMD [ "npm", "start" ]