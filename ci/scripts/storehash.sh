#!/usr/bin/env bash

chmod +x ./ci/scripts/gethash.sh
chmod +x ./ci/scripts/hashexist.sh

function storeHash {
    # $1 -> Job Name; $2 -> Project
    HASH_VALUE=`./ci/scripts/gethash.sh $1 $2`
    echo "hash value before store is $HASH_VALUE"
    curl -H "Content-Type: application/json" -d "{\"fields\": {\"project\": {\"stringValue\": '$2'},\"hash\": {\"stringValue\": '$HASH_VALUE'}}}"  -X POST "https://firestore.googleapis.com/v1/projects/fyipe-devops/databases/(default)/documents/builds"
}

if [[ $CI_COMMIT_BRANCH != "master" ]] && [[ $CI_COMMIT_BRANCH != "release" ]]
then
    # the first argument is always the job name ($1)
    for ((i = 2; i <= $#; i++ ))
    do
        hash_exist=`./ci/scripts/hashexist.sh $1 ${!i}`
        echo "before store hash_exist $hash_exist"
        if [[ $hash_exist == *"false"* ]]
        then
            storeHash $1 ${!i}
        fi
    done
fi