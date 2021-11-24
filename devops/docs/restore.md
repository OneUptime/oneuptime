## Restore

Follow these steps on the destination cluster.

**Important:** If this file is large, it does take sometime to upload and restore.

**Step 1**: Copy file from local to container.

Syntax:

`sudo kubectl cp <localfilePath> <pod>:<filepath>`

Example:
`sudo kubectl cp /Volumes/DataDrive/Projects/OneUptime/app/backup.archive fi-mongodb-0:/bitnami/mongodb/oneuptimedata.archive`

**Step 2**: Mongorestore on the container.

Syntax:

`sudo kubectl exec <pod> -- mongorestore --uri="mongodb://<mongousername>:<mongopassword>@localhost:27017/<databasename>" --archive="<export-filepath>"`

Example:

`sudo kubectl exec fi-mongodb-0 -- mongorestore --uri="mongodb://oneuptime:password@localhost:27017/oneuptimedb" --archive="/bitnami/mongodb/oneuptimedata.archive"`
