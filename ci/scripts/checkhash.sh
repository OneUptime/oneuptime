#!/usr/bin/env bash

chmod +x ./ci/scripts/hashexist.sh

if [[ $CI_COMMIT_BRANCH != "master" ]] && [[ $CI_COMMIT_BRANCH != "release" ]]
then
    next_stage="skip"
    
    # the first argument is always the job name ($1)
    for ((i = 2; i <= $#; i++ ))
    do
        hash_found=`./ci/scripts/hashexist.sh $1 ${!i}`
        if [[ $hash_found == *"false"* ]]
        then
            next_stage="continue"
        fi
    done
    
    echo $next_stage
fi