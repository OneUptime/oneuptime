#!/usr/bin/env bash

chmod +x ./ci/scripts/hashexist.sh

function storeHash {
    # $1 -> Job Name; $2 -> Project
    PROJECT_HASH=`find $2 -type f ! -path "*node_modules*" ! -path "*build*" -print0 | sort -z | xargs -0 sha256sum | sha256sum`
    HASH_VALUE=`echo $PROJECT_HASH$1 | sha256sum | head -c 64`
    curl -H "Content-Type: application/json" -d "{\"fields\": {\"project\": {\"stringValue\": '$2'},\"hash\": {\"stringValue\": '$HASH_VALUE'}}}"  -X POST "https://firestore.googleapis.com/v1/projects/oneuptime-devops/databases/(default)/documents/builds"
}

if [[ $CI_COMMIT_BRANCH != "master" ]] && [[ $CI_COMMIT_BRANCH != "release" ]]
then
    # the first argument is always the job name ($1)
    for ((i = 2; i <= $#; i++ ))
    do
        hash_exist=`./ci/scripts/hashexist.sh $1 ${!i}`
        if [[ $hash_exist == *"false"* ]]
        then
            storeHash $1 ${!i}
        fi
    done
fi