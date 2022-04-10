# Rollback

If you think the deployment went bad, then look at the pipelines which was passed before this deployment

If the last successful deployment was from hotfix release:

`https://gitlab.com/oneuptime/app/-/pipelines?page=1&scope=all&ref=hotfix-release`

If the last successful deployment was from release:

`https://gitlab.com/oneuptime/app/-/pipelines?page=1&scope=all&ref=release`

Run the deployment jobs manually in the pipeline which was last successful.

Confirm the version number on the "About" modal on OneUptime Dashboard.
