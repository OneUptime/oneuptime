#!/usr/bin/env bash

chmod +x ./ci/scripts/gethash.sh

function doesHashExist {
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

function storeHash {
    # $1 -> Job Name; $2 -> Project
    HASH_VALUE=`./ci/scripts/gethash.sh $1 $2`
    curl -H "Content-Type: application/json" -d "{\"fields\": {\"project\": {\"stringValue\": '$2'},\"hash\": {\"stringValue\": '$HASH_VALUE'}}}"  -X POST "https://firestore.googleapis.com/v1/projects/fyipe-devops/databases/(default)/documents/builds"
}


if [[ $CI_COMMIT_BRANCH != "master" ]] && [[ $CI_COMMIT_BRANCH != "release" ]]
then
    # install jq only when it does not exist
    if [[ ! $(which jq) ]]
    then
        sudo apt-get install -y jq
    fi
    
    # the first argument is always the job name ($1)
    for ((i = 2; i <= $#; i++ ))
    do
        hash_exist=`doesHashExist $1 ${!i}`
        if [[ $hash_exist == *"false"* ]]
        then
            storeHash $1 ${!i}
        fi
    done
fi