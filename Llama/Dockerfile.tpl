ARG TAG=latest
FROM continuumio/miniconda3:$TAG 

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

