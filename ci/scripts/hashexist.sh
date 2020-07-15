#!/usr/bin/env bash

chmod +x ./ci/scripts/gethash.sh


# install jq only when it does not exist
if [[ ! $(which jq) ]]
then
    sudo apt-get install -y jq
fi

function checkHash {
    # $1 is the job name
    # $2 is the project
    HASH_VALUE=`./ci/scripts/gethash.sh $1 $2`
    # signin with valid api key, email and password
    RESPONSE=`curl -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$FIRESTORE_API_KEY" -H 'Content-Type: application/json' --data-binary "{\"email\": $FIRESTORE_EMAIL,\"password\": $FIRESTORE_PASSWORD,\"returnSecureToken\":true}"`
    TOKEN=`jq '.idToken' <<< "$RESPONSE"`
    RESPONSE=`curl -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d "{\"structuredQuery\": {\"from\": {\"collectionId\": \"builds\"},\"where\": {\"compositeFilter\": {\"op\": \"AND\",\"filters\": [{\"fieldFilter\": {\"field\": {\"fieldPath\": \"project\"},\"op\": \"EQUAL\",\"value\": {\"stringValue\": '$2'}}},{\"fieldFilter\": {\"field\": {\"fieldPath\": \"hash\"},\"op\": \"EQUAL\",\"value\": {\"stringValue\": '$HASH_VALUE'}}}]}}}}" -X POST "https://firestore.googleapis.com/v1/projects/fyipe-devops/databases/(default)/documents:runQuery"`
    
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