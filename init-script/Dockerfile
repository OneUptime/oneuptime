#
# OneUptime Init Script
#

FROM node:16

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

# Set env variables
ENV PRODUCTION=true

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

# Copy app source
COPY . /usr/src/app

# Install app dependencies
RUN npm install

# Run app
CMD ["npm", "start"]