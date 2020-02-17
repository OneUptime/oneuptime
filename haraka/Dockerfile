##
# This file is from the official Harakaa Docker Repository - https://github.com/haraka/Haraka
# https://github.com/haraka/Haraka/blob/master/Dockerfile 
##


# NOTICE: This is user-contributed and not officially supported by the Haraka team. Use at your own risk.
#
# This file describes how to build Haraka into a runnable linux container with all dependencies installed
# To build:
# 1.) Install docker (http://docker.io)
# 2.) Clone Haraka repo if you haven't already: git clone https://github.com/haraka/Haraka.git
# 3.) Modify config/host_list with the domain(s) that you'd like to receive mail to
# 4.) Build: cd Haraka && docker build .
# 5.) Run:
# docker run -d <imageid>
#
# VERSION           0.1
# DOCKER-VERSION    0.5.3

# See http://phusion.github.io/baseimage-docker/

FROM node:10

ENV HOME /root

RUN npm install -g Haraka --unsafe
RUN haraka -i /
ADD ./config/host_list /config/host_list
RUN npm install

EXPOSE 25

# Start the init daemon - runit will launch the Haraka process
CMD ["haraka -c /"]