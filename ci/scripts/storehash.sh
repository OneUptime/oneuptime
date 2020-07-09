#!/usr/bin/env bash

chmod +x ./ci/scripts/checkhash.sh
chmod +x ./ci/scripts/gethash.sh

# $1 is the job name
# $2 is the project
# make sure hash don't already exist in db
export hash_exist=`./ci/scripts/checkhash.sh $1 $2`
if [[ $hash_exist == *"false"* ]]
then
    HASH_VALUE=`./ci/scripts/gethash.sh $1`
    curl -H "Content-Type: application/json" -d "{\"fields\": {\"project\": {\"stringValue\": '$2'},\"hash\": {\"stringValue\": '$HASH_VALUE'}}}"  -X POST "https://firestore.googleapis.com/v1/projects/fyipe-devops/databases/(default)/documents/builds"
fi
