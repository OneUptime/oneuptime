#!/bin/bash


# Deploy to staging

git checkout hotfix-master
git pull
git checkout master
git pull

git merge hotfix-master
git push

git checkout hotfix-master
git merge master
git push
git checkout master