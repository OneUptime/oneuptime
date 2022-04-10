# Deployment

## Before Deployment Checklist

-   Make sure test & pipeline passes
-   Make sure all deployment jobs are deployed to staging and smoke test job passes.
-   Make sure all staging services are online. Check staging status page whcih will show you status of all the services.
-   Manually smoke test staging.
-   Go to oneuptime.com/dashboard (production) and click About and copy the version number. You might need this incase of rollback.
-   Montor status of all services by:

    ```
    kubectl get pods # on staging cluster.
    ```

-   Make sure no service has multiple restarts or in CrashLoopBackoff state.

## Deployment Checklist

-   Merge `master` to `release` to start the deployment process. Energency Deployment: Merge `master` to `hotfix-release`
-   Check if the smoke test on production passes. If smoke test does not pass, rollback immediately.
-   Montor status of all services by:

    ```
    kubectl get pods # on production cluster.
    ```

-   Make sure no service has multiple restarts or in CrashLoopBackoff state.

-   Manually smoke test production.
-   Check status page of production service and make sure they all are online.
-   Keep monitoring for another hour to few hours to see if there are any support emails.

## Rollback Strategy

Read `/app/devops/docs/rollback.md`

## Emergency Deployment to Staging

Run this on master branch.

```
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
```
