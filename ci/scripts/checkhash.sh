#!/usr/bin/env bash

chmod +x ./ci/scripts/hashexist.sh

if [[ $CI_COMMIT_BRANCH != "master" ]] && [[ $CI_COMMIT_BRANCH != "release" ]]
then
    next_stage="continue"
    
    # the first argument is always the job name ($1)
    for ((i = 2; i <= $#; i++ ))
    do
        hash_found=`./ci/scripts/hashexist.sh $1 ${!i}`
        echo "hash found is given as $hash_found"
        if [[ $hash_found == *"true"* ]]
        then
            next_stage="skip"
        fi
    done
    
    echo $next_stage
fi