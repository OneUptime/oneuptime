#!/usr/bin/env bash

# install jq only when it does not exist
if [[ ! $(which jq) ]]
then
    sudo apt-get install -y jq
fi

function hashExist {
    # $1 is the job name
    # $2 is the project
    PROJECT_HASH=`find $2 -type f ! -path "*node_modules*" ! -path "*build*" -print0 | sort -z | xargs -0 sha256sum | sha256sum`
    HASH_VALUE=`echo $PROJECT_HASH$1 | sha256sum | head -c 64`
    RESPONSE=`curl -H "Content-Type: application/json" -d "{\"structuredQuery\": {\"from\": {\"collectionId\": \"builds\"},\"where\": {\"compositeFilter\": {\"op\": \"AND\",\"filters\": [{\"fieldFilter\": {\"field\": {\"fieldPath\": \"project\"},\"op\": \"EQUAL\",\"value\": {\"stringValue\": '$2'}}},{\"fieldFilter\": {\"field\": {\"fieldPath\": \"hash\"},\"op\": \"EQUAL\",\"value\": {\"stringValue\": '$HASH_VALUE'}}}]}}}}" -X POST "https://firestore.googleapis.com/v1/projects/fyipe-devops/databases/(default)/documents:runQuery"`
    # if response contains an array of object with document key, then the hash already exist in db
    echo "project hash is given as $PROJECT_HASH"
    echo "hash value is given as $HASH_VALUE"
    echo "response is given as $RESPONSE"
    document=`jq '.[0].document' <<< "$RESPONSE"`
    if [[ $document == null ]]
    then
        echo false
    else
        echo true
    fi
}

hashExist $1 $2