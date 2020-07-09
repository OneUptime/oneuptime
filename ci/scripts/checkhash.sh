#!/usr/bin/env bash

sudo apt-get install -y jq
chmod +x ./ci/scripts/gethash.sh

function checkHash {
    # $1 is the job name
    # $2 is the project
    HASH_VALUE=`./ci/scripts/gethash.sh $1 $2`
    RESPONSE=`curl -H "Content-Type: application/json" -d "{\"structuredQuery\": {\"from\": {\"collectionId\": \"builds\"},\"where\": {\"compositeFilter\": {\"op\": \"AND\",\"filters\": [{\"fieldFilter\": {\"field\": {\"fieldPath\": \"project\"},\"op\": \"EQUAL\",\"value\": {\"stringValue\": '$2'}}},{\"fieldFilter\": {\"field\": {\"fieldPath\": \"hash\"},\"op\": \"EQUAL\",\"value\": {\"stringValue\": '$HASH_VALUE'}}}]}}}}" -X POST "https://firestore.googleapis.com/v1/projects/fyipe-devops/databases/(default)/documents:runQuery"`
    
    # if response contains an array of object with document key, then the hash already exist in db
    document=`jq '.[0].document' <<< "$RESPONSE"`
    if [[ $document = null ]]
    then
        echo false
    else
        echo true
    fi
}

checkHash $1 $2