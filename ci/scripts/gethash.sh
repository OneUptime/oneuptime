#!/usr/bin/env bash

# $1 is the job name
# $2 is the project
find $2 -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | read projecthash; echo "$projecthash $1" | sha256sum | head -c 64