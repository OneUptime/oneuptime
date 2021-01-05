# Operations Manual

## Root Username

Admin mongodb username is: `root`

## Backup

## Method 1: Copy data from server to server (recommended)

**Step 1:** Expose Mongodb over the internet on source cluster.

Run these on source cluster:

Example:

```
# Delete audit logs (optional, but recommended)

sudo kubectl exec -it fi-mongodb-primary-0 -- bash
mongo
use fyipedb
db.auth('fyipe', 'password')
db.auditlogs.remove({})


# Open MongoDB to the internet.

sudo kubectl delete job fi-init-script
sudo helm upgrade -f ./kubernetes/values-saas-staging.yaml --set mongodb.ingress.enabled=true fi ./helm-chart/public/fyipe
```

Run

`sudo kubectl get svc`

and look for `mongo-ingress` resource. Copy External-IP address.

**Step 2:** Copy MongoDB from source to destination

On the destination cluster:

```
kubectl exec -it fi-mongodb-primary-0 -- bash
mongodump --uri="mongodb://fyipe:password@<EXTERNAL-IP-ADDRESS-FROM-STEP-1>:27017/fyipedb" --archive="/bitnami/mongodb/fyipedata.archive"
mongorestore --uri="mongodb://fyipe:password@localhost:27017/fyipedb" --archive="/bitnami/mongodb/fyipedata.archive"
```

**Step 3:** Block the exposed Mongodb from the internet

On source cluster:

```
kubectl delete job fi-init-script
helm upgrade -f ./kubernetes/values-saas-staging.yaml --set mongodb.ingress.enabled=false fi ./helm-chart/public/fyipe
```

## Method 2: Copy data locally and move to another MognoDB server.

### Export and Copy MongoDB data from Kubernetes to local machine:

**Important:** If this file is large, it does take sometime to copy and download.

**Step 1**: Mongodump on the container.

Syntax:

`sudo kubectl exec <pod> -- mongodump --uri="mongodb://<mongousername>:<mongopassword>@localhost:27017/<databasename>" --archive="<export-filepath>"`

Example:

`sudo kubectl exec fi-mongodb-primary-0 -- mongodump --uri="mongodb://fyipe:password@localhost:27017/fyipedb" --archive="/bitnami/mongodb/fyipedata.archive"`

**Step 2**: Copy file from conatiner to local machine.

Syntax:

`sudo kubectl cp <pod>:<filepath> <localfilePath>`

Example:

`sudo kubectl cp fi-mongodb-primary-0:/bitnami/mongodb/fyipedata.archive /Volumes/DataDrive/Projects/Fyipe/app/backup.archive`

## Restore

Follow these steps on the destination cluster.

**Important:** If this file is large, it does take sometime to upload and restore.

**Step 1**: Copy file from local to container.

Syntax:

`sudo kubectl cp <localfilePath> <pod>:<filepath>`

Example:
`sudo kubectl cp /Volumes/DataDrive/Projects/Fyipe/app/backup.archive fi-mongodb-primary-0:/bitnami/mongodb/fyipedata.archive`

**Step 2**: Mongorestore on the container.

Syntax:

`sudo kubectl exec <pod> -- mongorestore --uri="mongodb://<mongousername>:<mongopassword>@localhost:27017/<databasename>" --archive="<export-filepath>"`

Example:

`sudo kubectl exec fi-mongodb-primary-0 -- mongorestore --uri="mongodb://fyipe:password@localhost:27017/fyipedb" --archive="/bitnami/mongodb/fyipedata.archive"`

## Misc commands

Get into a MongoDB container with mongo shell:
`sudo kubectl exec -it fi-mongodb-primary-0 mongo`

## Change / Rotate MongoDB Password

Change root password:

```
kubectl exec -it fi-mongodb-primary-0 mongo     # get into mongodb container.
db = db.getSiblingDB('admin')                   # Change to admin db
db.auth("root", "<OLD-PASSWORD>")
db.changeUserPassword("root", "<NEW-PASSWORD>")
exit                                            # This is important.
```

Change user password:

```
kubectl exec -it fi-mongodb-primary-0 mongo     # get into mongodb container.
db = db.getSiblingDB('admin')                   # Change to admin db
db.auth("root", "<OLD-PASSWORD>")
use fyipedb
db.changeUserPassword("<USER-PASSWORD>", "<NEW-PASSWORD>")
exit                                            # This is important.
```
