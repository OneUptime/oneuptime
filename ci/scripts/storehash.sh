#!/usr/bin/env bash

chmod +x ./ci/scripts/hashexist.sh

function storeHash {
    # $1 -> Job Name; $2 -> Project
    PROJECT_HASH=`find $2 -type f ! -path "*node_modules*" -print0 | sort -z | xargs -0 sha256sum | sha256sum`
    HASH_VALUE=`echo $1$PROJECT_HASH | sha256sum | head -c 64`
    curl -H "Content-Type: application/json" -d "{\"fields\": {\"project\": {\"stringValue\": '$2'},\"hash\": {\"stringValue\": '$HASH_VALUE'}}}"  -X POST "https://firestore.googleapis.com/v1/projects/fyipe-devops/databases/(default)/documents/builds"
    
    echo "project hash in storehash $PROJECT_HASH"
    echo "hash value in storehash $HASH_VALUE"
}

if [[ $CI_COMMIT_BRANCH != "master" ]] && [[ $CI_COMMIT_BRANCH != "release" ]]
then
    # the first argument is always the job name ($1)
    for ((i = 2; i <= $#; i++ ))
    do
        hash_exist=`./ci/scripts/hashexist.sh $1 ${!i}`
        echo "the value of hash_exist $hash_exist"
        if [[ $hash_exist == *"false"* ]]
        then
            storeHash $1 ${!i}
        fi
    done
fi