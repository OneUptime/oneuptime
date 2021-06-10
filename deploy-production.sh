#!/bin/bash

# Deploy to production
git checkout hotfix-release
git merge master
git push

git checkout master