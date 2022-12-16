#
# StatusPage Dockerfile
#

# Pull base image nodejs image.
FROM node:alpine

# Install bash. 
RUN apk update && apk add bash && apk add curl

#Use bash shell by default
SHELL ["/bin/bash", "-c"]
RUN npm install typescript -g
RUN npm install ts-node -g
RUN npm install nodemon -g
RUN npm install http-server -g

RUN mkdir /usr/src

# Install Common
RUN mkdir /usr/src/Common
WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
RUN npm install
RUN mkdir /usr/src/Common/temp
COPY ./Common /usr/src/Common/temp
# Remove node modules copies from local computer. 
RUN rm -rf /usr/src/Common/temp/node_modules
RUN cp -a /usr/src/Common/temp/. /usr/src/Common/
RUN cd /usr/src/Common/
RUN rm -rf /usr/src/Common/temp/
RUN npm run compile

# Install Model
RUN mkdir /usr/src/Model
WORKDIR /usr/src/Model
COPY ./Model/package*.json /usr/src/Model/
RUN npm install
RUN mkdir /usr/src/Model/temp
COPY ./Model /usr/src/Model/temp
# Remove node modules copies from local computer. 
RUN rm -rf /usr/src/Model/temp/node_modules
RUN cp -a /usr/src/Model/temp/. /usr/src/Model/
RUN cd /usr/src/Model/
RUN rm -rf /usr/src/Model/temp/
RUN npm run compile


# Install CommonServer
RUN mkdir /usr/src/CommonServer
WORKDIR /usr/src/CommonServer
COPY ./CommonServer/package*.json /usr/src/CommonServer/
RUN npm install
RUN mkdir /usr/src/CommonServer/temp
COPY ./CommonServer /usr/src/CommonServer/temp
# Remove node modules copies from local computer. 
RUN rm -rf /usr/src/CommonServer/temp/node_modules
RUN cp -a /usr/src/CommonServer/temp/. /usr/src/CommonServer/
RUN cd /usr/src/CommonServer/
RUN rm -rf /usr/src/CommonServer/temp/
RUN npm run compile

# Install CommonUI
RUN mkdir /usr/src/CommonUI
WORKDIR /usr/src/CommonUI
COPY ./CommonUI/package*.json /usr/src/CommonUI/
RUN npm install
RUN mkdir /usr/src/CommonUI/temp
COPY ./CommonUI /usr/src/CommonUI/temp
# Remove node modules copies from local computer. 
RUN rm -rf /usr/src/CommonUI/temp/node_modules
RUN cp -a /usr/src/CommonUI/temp/. /usr/src/CommonUI/
RUN cd /usr/src/CommonUI/
RUN rm -rf /usr/src/CommonUI/temp/
RUN npm run compile
#SET ENV Variables
ENV PRODUCTION=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

RUN mkdir /usr/src/app

WORKDIR /usr/src/app

# Install app dependencies
COPY ./StatusPage/package*.json /usr/src/app/
RUN npm install

# Expose ports.
#   - 3105:  StatusPage
EXPOSE 3105
# API
EXPOSE 3106

{{ if eq .Env.ENVIRONMENT "development" }}
#Run the app
CMD [ "npm", "run", "dev" ]
{{ else }}
# Copy app source
COPY ./StatusPage /usr/src/app
# Bundle app source
RUN npm run compile
#Run the app
CMD [ "npm", "start" ]
{{ end }}

