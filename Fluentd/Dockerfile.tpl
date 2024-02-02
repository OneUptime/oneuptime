FROM fluentd
USER root
# Install bash and curl. 
RUN apk add --update --no-cache bash curl