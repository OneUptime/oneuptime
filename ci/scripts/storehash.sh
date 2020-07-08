#!/usr/bin/env bash

# check the status of build process
# if successful, then store hash in firestore
# if not skip
function storeHash {
    # store hash in firestore
    # $1 is project name $2 is hash value
    curl -H "Content-Type: application/json" -d "{\"fields\": {\"project\": {\"stringValue\": '$1'},\"hash\": {\"stringValue\": '$2'}}}"  -X POST "https://firestore.googleapis.com/v1/projects/fyipe-devops/databases/(default)/documents/builds"
}