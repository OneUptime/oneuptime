# Deployment

## Emergency Deployment to Staging and Production

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

git checkout master
```

# Rollback

If you think the deployment went bad, then look at the pipelines which was passed before this deployment

If the last successful deployment was from hotfix release: 

`https://gitlab.com/fyipe-project/app/-/pipelines?page=1&scope=all&ref=hotfix-release`

If the last successful deployment was from release: 

`https://gitlab.com/fyipe-project/app/-/pipelines?page=1&scope=all&ref=release`

Run the deployment jobs manually in the pipeline which was last successful. 