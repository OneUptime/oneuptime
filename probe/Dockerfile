#
# Fyipe-backend Dockerfile
#

# Pull base image nodejs image.
FROM node:12.16.1

#SET ENV Variables
ENV PRODUCTION=true
ENV CHROME_PATH=/usr/bin/google-chrome

# Install Chrome.
RUN \
  wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - && \
  echo "deb http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google.list && \
  apt-get update && \
  apt-get install -y google-chrome-stable && \
  rm -rf /var/lib/apt/lists/*

RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json /usr/src/app/
RUN npm ci

# Bundle app source
COPY . /usr/src/app

# Expose ports.
#   - 3008: probe
EXPOSE 3008

#Run the app
CMD [ "npm", "start"]