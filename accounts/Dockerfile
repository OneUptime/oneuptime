#
# Accounts Dockerfile
#

# Pull base image nodejs image.
FROM node:10

#SET ENV Variables
ENV PRODUCTION=true

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
#   - 3003:  accounts
EXPOSE 3003

#Run the app
CMD [ "npm", "start" ]
