#
# Fyipe Home Dockerfile
#

# Pull base image nodejs image.
FROM node:10

#SET ENV Variables. 
ENV PRODUCTION=true

RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json /usr/src/app/
RUN npm ci
RUN npm install -g serve
RUN npm install -g eslint

# Bundle app source
COPY . /usr/src/app

# Expose ports.
#   - 1444: CloudBoost Fyipe Home
EXPOSE 3006

#Run the app
CMD [ "npm", "start" ]
