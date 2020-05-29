# Deployment

## Emergency Deployment

Run this on master branch.

```
git checkout master
git pull

# Deploy to staging
git checkout hotfix-master
git merge master
git push

# Deploy to production
git checkout hotfix-release
git merge master
git push

```