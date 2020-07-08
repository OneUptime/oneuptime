#!/usr/bin/env bash

# $1 is project directory to hash
echo "Hash a particular project"
echo "The project being hashed is $1"

# shasum --> sha256sum or sha1sum
# use head to only get the first 64 characters, removing the trailing dash
echo HASH=`find $1 -type f ! -path "*node_modules*" -print0 | sort -z | xargs -0 sha256sum | sha256sum | head -c 64`