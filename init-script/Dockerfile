#
# OneUptime Init Script
#

FROM node:17-alpine

# Install bash. 
RUN apk update && apk add bash && apk add curl

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

# Set env variables
ENV PRODUCTION=true

RUN mkdir /usr/src
RUN mkdir /usr/src/app
WORKDIR /usr/src/app

# Copy app source
COPY . /usr/src/app

# Install app dependencies
RUN npm install

# Run app
CMD ["npm", "start"]