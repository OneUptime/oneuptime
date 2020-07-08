#!/usr/bin/env bash

# echo "
# This script does the following.
# - Checks if hash of project exists in firestore db
# - If hash does not exist, add hash to firestore db
# - returns true or false based on whether the hash exists on firestore db
# "

echo "value of '$1': $1"
echo "value of '$2': $2"

sudo apt-get install -y jq

function storeHash {
    # $1 is project name $2 is hash value
    echo "Store hash inside db"
    
    curl -H "Content-Type: application/json" -d "{\"fields\": {\"project\": {\"stringValue\": '$1'},\"hash\": {\"stringValue\": '$2'}}}"  -X POST "https://firestore.googleapis.com/v1/projects/fyipe-devops/databases/(default)/documents/builds"
}

# $1 is the project
# $2 is the hash

RESPONSE=`curl -H "Content-Type: application/json" -d "{\"structuredQuery\": {\"from\": {\"collectionId\": \"builds\"},\"where\": {\"compositeFilter\": {\"op\": \"AND\",\"filters\": [{\"fieldFilter\": {\"field\": {\"fieldPath\": \"project\"},\"op\": \"EQUAL\",\"value\": {\"stringValue\": '$1'}}},{\"fieldFilter\": {\"field\": {\"fieldPath\": \"hash\"},\"op\": \"EQUAL\",\"value\": {\"stringValue\": '$2'}}}]}}}}" -X POST "https://firestore.googleapis.com/v1/projects/fyipe-devops/databases/(default)/documents:runQuery"`
# if response contains an array with document key, then the hash already exist in db
# if response does not contain an array with document key, then the hash does not exist in db, create the document
document=`jq '.[0].document' <<< "$RESPONSE"`

echo "value of response is '$RESPONSE'"

if [[ $document = null ]]
then
    echo "hash not in db"
    storeHash $1 $2
    false
else
    echo "hash already exist in db"
    true
fi
