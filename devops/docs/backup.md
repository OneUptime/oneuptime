# Backing up a database.

Admin mongodb username is: `root`

Run these on source cluster:

Syntax:

`sudo kubectl exec <pod> -- mongodump --uri="mongodb://<mongousername>:<mongopassword>@localhost:27017/<databasename>" --archive="<export-filepath>"`

Example:

`sudo kubectl exec fi-mongodb-primary-0 -- mongodump --uri="mongodb://fyipe:password@localhost:27017/fyipedb" --archive="/bitnami/mongodb/fyipedata.archive"`

**Step 2**: Copy file from conatiner to local machine.

Syntax:

`sudo kubectl cp <pod>:<filepath> <localfilePath>`

Example:

`sudo kubectl cp fi-mongodb-primary-0:/bitnami/mongodb/fyipedata.archive /Volumes/DataDrive/Projects/Fyipe/app/backup.archive`
