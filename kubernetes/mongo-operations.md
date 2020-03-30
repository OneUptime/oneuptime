# Operations Manual

## Root Username

Admin mongodb username is: `root`

## Method 1: Copy data from server to server (recommended)

**Step 1:** Expose Mongodb over the internet on source cluster. 

Example: 

`helm upgrade -f ./kubernetes/values-saas-staging.yaml --set mongodb.ingress.enabled=true fi ./helm-chart/public/fyipe`

**Step 3:** Copy MongoDB from source to destination

On the destination cluster: 

```
kubectl exec -it fi-mongodb-primary-0 bash
mongodump --uri="mongodb://fyipe:password@34.67.53.212:27017/fyipedb" --archive="/bitnami/mongodb/fyipebackup.archive"
mongorestore --uri="mongodb://root:root@localhost:27017/fyipedb" --archive="/bitnami/mongodb/fyipebackup.archive"
```

**Step 4:** Block the exposed Mongodb from the internet

On source cluster: 

`helm upgrade -f ./kubernetes/values-saas-staging.yaml --set mongodb.ingress.enabled=false fi ./helm-chart/public/fyipe`

## Method 2: Copy data locally and move to another MognoDB server. 

### Export and Copy MongoDB data from Kubernetes to local machine: 

**Important:** If this file is large, it does take sometime to copy and download.

**Step 1**: Mongodump on the container.

Syntax: 

`kubectl exec <pod> -- mongodump --uri="mongodb://<mongousername>:<mongopassword>@localhost:27017/<databasename>" --archive="<export-filepath>"`

Example: 

`kubectl exec fi-mongodb-primary-0 -- mongodump --uri="mongodb://fyipe:password@localhost:27017/fyipedb" --archive="/bitnami/mongodb/fyipebackup.archive"`

**Step 2**: Copy file from conatiner to local machine. 

Syntax: 

`kubectl cp <pod>:<filepath> <localfilePath>`

Example:

`kubectl cp fi-mongodb-primary-0:/bitnami/mongodb/fyipebackup.archive /Volumes/DataDrive/Projects/Fyipe/app/backup.archive`


## Restore

**Important:** If this file is large, it does take sometime to upload and restore.

**Step 1**: Copy file from local to container. 

Syntax: 

`kubectl cp <localfilePath> <pod>:<filepath> `

Example: 
`kubectl cp /Volumes/DataDrive/Projects/Fyipe/app/backup.archive fi-mongodb-primary-0:/bitnami/mongodb/fyipedata.archive`


**Step 2**: Mongorestore on the container.

Syntax: 

`kubectl exec <pod> -- mongorestore --uri="mongodb://<mongousername>:<mongopassword>@localhost:27017/<databasename>" --archive="<export-filepath>"`

Example: 

`kubectl exec fi-mongodb-primary-0 -- mongorestore --uri="mongodb://fyipe:password@localhost:27017/fyipedb" --archive="/bitnami/mongodb/fyipebackup.archive"`