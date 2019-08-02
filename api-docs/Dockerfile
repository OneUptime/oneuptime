# Pull base image nodejs image.
FROM node:boron

#Maintainer.
MAINTAINER Rex Raphael <rex.raphael@outlook.com>


RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY package.json /usr/src/app/
RUN npm install

# Bundle app source
COPY . /usr/src/app

# Expose ports.
#   - 1445: CloudBoost Dcos
EXPOSE 1445

#Run the app
CMD [ "npm", "start" ]