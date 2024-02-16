FROM fluentd

# This container will only run in dev env, so this is ok.
USER root

# Install bash and curl. 
RUN apk add bash curl