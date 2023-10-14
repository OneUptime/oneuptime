FROM continuumio/miniconda3:latest as intelligence

ENV MODEL_NAME="llama-7b"

RUN apt-get update \
    && DEBIAN_FRONTEND="noninteractive" apt-get install -y --no-install-recommends \
        git \
        locales \
        sudo \
        build-essential \
        dpkg-dev \
        wget \
        openssh-server \
        nano \
    && rm -rf /var/lib/apt/lists/*

# Setting up locales

RUN locale-gen en_US.UTF-8
ENV LANG en_US.UTF-8

# Updating conda to the latest version
RUN conda update conda -y

RUN git clone https://github.com/ggerganov/llama.cpp.git

WORKDIR /llama.cpp
RUN make
COPY ./Llama/Models ./models

RUN python3 -m pip install -r requirements.txt
RUN python3 convert.py models/$MODEL_NAME/
RUN ./quantize ./models/$MODEL_NAME/ggml-model-f16.gguf ./models/$MODEL_NAME/ggml-model-q4_0.gguf q4_0


## Node App

FROM node:current-alpine as app

ENV MODEL_NAME="llama-7b"

USER root
RUN mkdir /tmp/npm &&  chmod 2777 /tmp/npm && chown 1000:1000 /tmp/npm && npm config set cache /tmp/npm --global



ARG GIT_SHA
ARG APP_VERSION

ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}


# Install bash. 
RUN apk add bash && apk add curl


# Install python
RUN apk update && apk add --no-cache --virtual .gyp python3 make g++

#Use bash shell by default
SHELL ["/bin/bash", "-c"]

RUN mkdir /usr/src

ENV PRODUCTION=true

WORKDIR /usr/src/app

COPY --from=intelligence /llama.cpp/models/$MODEL_NAME/ggml-model-q4_0.gguf .

# Install app dependencies
COPY ./Llama/package*.json /usr/src/app/
RUN npm install

# Copy app source
COPY ./Llama/Index.ts /usr/src/app/Index.ts
COPY ./Llama/nodemon.json /usr/src/app/nodemon.json
COPY ./Llama/tsconfig.json /usr/src/app/tsconfig.json

# Bundle app source
RUN npm run compile

#Run the app
CMD [ "npm", "start" ]
