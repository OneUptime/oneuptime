#!/usr/bin/env bash

chmod +x ./ci/scripts/gethash.sh
chmod +x ./ci/scripts/hashexist.sh

function storeHash {
    # $1 -> Job Name; $2 -> Project
    HASH_VALUE=`./ci/scripts/gethash.sh $1 $2`
    # signin with valid api key, email and password
    RESPONSE=`curl -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$FIRESTORE_API_KEY" -H 'Content-Type: application/json' --data-binary "{\"email\": $FIRESTORE_EMAIL,\"password\": $FIRESTORE_PASSWORD,\"returnSecureToken\":true}"`
    TOKEN=`jq '.idToken' <<< "$RESPONSE"`
    curl -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d "{\"fields\": {\"project\": {\"stringValue\": '$2'},\"hash\": {\"stringValue\": '$HASH_VALUE'}}}"  -X POST "https://firestore.googleapis.com/v1/projects/fyipe-devops/databases/(default)/documents/builds"
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