FROM fluentd

# This container will only run in dev env, so this is ok.
USER root

# Install bash and curl. 
RUN apt-get update \
	&& apt-get install -y --no-install-recommends bash curl \
	&& rm -rf /var/lib/apt/lists/*

EXPOSE 24224
EXPOSE 8888