#
# Fyipe Init Script
#

FROM node:10

# Set env variables
ENV PRODUCTION=true

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

# Copy app source
COPY . /usr/src/app

# Install app dependencies
RUN npm install

# Bundle app source
# RUN npm run build

# Expose app port
# EXPOSE 3010

# Run app
CMD ["npm", "start"]