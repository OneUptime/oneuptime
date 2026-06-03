FROM nginx:1.29.5-alpine 


# Per-build args (GIT_SHA / APP_VERSION / IS_ENTERPRISE_EDITION) are declared at
# the bottom so the npm install / compile layers stay cacheable across commits
# and across the community + enterprise build passes.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

LABEL org.opencontainers.image.title="OneUptime Nginx"
LABEL org.opencontainers.image.description="OneUptime Nginx ingress — TLS termination, routing, and Let's Encrypt automation."
LABEL org.opencontainers.image.source="https://github.com/OneUptime/oneuptime"
LABEL org.opencontainers.image.url="https://oneuptime.com"
LABEL org.opencontainers.image.documentation="https://oneuptime.com/docs"
LABEL org.opencontainers.image.vendor="OneUptime"
LABEL org.opencontainers.image.licenses="Apache-2.0"



# Install bash. 
RUN apk add bash && apk add curl && apk add openssl

# Install NJS module
RUN apk add nginx-module-njs

COPY ./Nginx/envsubst-on-templates.sh /etc/nginx/envsubst-on-templates.sh

RUN chmod +x /etc/nginx/envsubst-on-templates.sh

COPY ./Nginx/default.conf.template /etc/nginx/templates/default.conf.template 
COPY ./Nginx/nginx.conf /etc/nginx/nginx.conf

# Now install nodejs

RUN apk add nodejs npm

# Serialize npm lifecycle scripts so esbuild's postinstall doesn't race against
# concurrent package extractions on BuildKit's overlayfs (ETXTBSY on
# /Common/node_modules/esbuild/bin/esbuild). See esbuild#1711, #2785.
RUN npm config set foreground-scripts true

RUN mkdir /usr/src

WORKDIR /usr/src/Common
COPY ./Common/package*.json /usr/src/Common/
RUN npm install
COPY ./Common /usr/src/Common








ENV PRODUCTION=true

WORKDIR /usr/src/app

# Install app dependencies
COPY ./Nginx/package*.json /usr/src/app/
RUN npm install

COPY ./Nginx /usr/src/app
# Bundle app source
RUN npm run compile

RUN chmod +x ./run.sh

# Per-build metadata last so the npm install / compile layers above stay
# cacheable across commits and across the community + enterprise build passes.
ARG GIT_SHA
ARG APP_VERSION
ARG IS_ENTERPRISE_EDITION=false
ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
ENV IS_ENTERPRISE_EDITION=${IS_ENTERPRISE_EDITION}
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${APP_VERSION}"

CMD ./run.sh


