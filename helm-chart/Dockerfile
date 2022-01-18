# Pull base image nodejs image.
FROM node:17

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json /usr/src/app/
RUN npm ci --only=production

# Bundle app source
COPY . /usr/src/app

# Expose ports.
#   - 3423: OneUptime Helm Chart Server
EXPOSE 3423

#Run the app
CMD [ "npm", "start" ]