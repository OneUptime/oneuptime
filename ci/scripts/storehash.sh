#!/usr/bin/env bash

# store hash in firestore
# $1 is project name $2 is hash value

HASH_VALUE=`find $1 -type f ! -path "*node_modules*" -print0 | sort -z | xargs -0 sha256sum | sha256sum | head -c 64`

curl -H "Content-Type: application/json" -d "{\"fields\": {\"project\": {\"stringValue\": '$1'},\"hash\": {\"stringValue\": '$HASH_VALUE'}}}"  -X POST "https://firestore.googleapis.com/v1/projects/fyipe-devops/databases/(default)/documents/builds"