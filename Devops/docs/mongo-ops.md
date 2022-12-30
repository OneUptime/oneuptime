# Mongo Operations Manual

## Create Root User

```
use admin

db.createUser(
{
    user: "root",
    pwd: "<password>",
    roles: [ "root" ]
})
```


## Create OneUptime User

```
use admin

db.auth("root", "<password>")

use oneuptimedb

db.createUser(
{
    user: "<username>",
    pwd: "<password>",
    roles: [ 
       "dbOwner"
    ]
})
```

## Copy DB from One Server to Another

```
mongodump --uri="mongodb://old_username:old_password@old_ip:old_port/oneuptimedb" --archive | mongorestore --uri="mongodb://new_username:new_pass@new_ip:new_port/oneuptimedb" --archive
```

## Root Username

Admin mongodb username is: `root`

## MongoDB common issues.

MongoDB will give you a lot of issues like:

#### MongoDB Crashloop Backoff

#### MongoDB Replica Set IDs do not match

This will delete all data

If your mongodb crashloop backs off on Kubernetes, then...

Important: Backup surving member. See backup section in this document for more info.

Resolution: Delete all statefulset and start again.

```
kubectl delete pvc datadir-fi-mongodb-0 datadir-fi-mongodb-1

# If staging
sudo helm upgrade -f ./HelmChart/public/oneuptime/values.yaml -f ./kubernetes/values-saas-staging.yaml fi ./HelmChart/public/oneuptime

# If production
sudo helm upgrade -f ./HelmChart/public/oneuptime/values.yaml -f ./kubernetes/values-saas-production.yaml fi ./HelmChart/public/oneuptime
```

Important: Restore. See restore section in this document for more info.

## Backup

## Method 1: Copy data from server to server (recommended)

**Step 1:** Expose Mongodb over the internet on source cluster.

Run these on source cluster:

Example:

```
# Open MongoDB to the internet.
# Only run this when MongoDB is not open to the internet

sudo kubectl delete job fi-InitScript

sudo helm upgrade -f ./kubernetes/values-saas-staging.yaml --set mongodb.externalAccess.enabled=true --set mongodb.externalAccess.service.type=LoadBalancer --set externalAccess.service.port=27017 --set mongodb.externalAccess.autoDiscovery.enabled=true --set mongodb.serviceAccount.create=true --set mongodb.rbac.create=true fi ./HelmChart/public/oneuptime

```

Run

`sudo kubectl get svc`

and look for `mongo-x-external` resource, `x` can be any number from 0 and above. Copy External-IP address.

**Step 2:** Copy MongoDB from source to destination

On the destination cluster:

```
kubectl exec -it fi-mongodb-0 -- bash
mongodump --uri="mongodb://oneuptime:password@<EXTERNAL-IP-ADDRESS-FROM-STEP-1>:27017/oneuptimedb" --archive="/bitnami/mongodb/oneuptimedata.archive" --excludeCollection=auditlogs --excludeCollection=monitorlogs
mongorestore --uri="mongodb://oneuptime:password@localhost:27017/oneuptimedb" --archive="/bitnami/mongodb/oneuptimedata.archive"
```

**Step 3:** Block the exposed Mongodb from the internet

On source cluster:

```
kubectl delete job fi-InitScript

sudo helm upgrade -f ./kubernetes/values-saas-staging.yaml --set mongodb.externalAccess.enabled=false --set mongodb.externalAccess.autoDiscovery.enabled=false --set mongodb.serviceAccount.create=false --set mongodb.rbac.create=false fi ./HelmChart/public/oneuptime

```

## Method 2: Copy data locally and move to another MognoDB server.

### Export and Copy MongoDB data from Kubernetes to local machine:

**Important:** If this file is large, it does take sometime to copy and download.

**Step 1**: Mongodump on the container.

Syntax:

`sudo kubectl exec <pod> -- mongodump --uri="mongodb://<mongousername>:<mongopassword>@localhost:27017/<databasename>" --archive="<export-filepath>" --excludeCollection=auditlogs --excludeCollection=monitorlogs`

Example:

`sudo kubectl exec fi-mongodb-0 -- mongodump --uri="mongodb://oneuptime:password@localhost:27017/oneuptimedb" --archive="/bitnami/mongodb/oneuptimedata.archive"`

**Step 2**: Copy file from conatiner to local machine.

Syntax:

`sudo kubectl cp <pod>:<filepath> <localfilePath>`

Example:

`sudo kubectl cp fi-mongodb-0:/bitnami/mongodb/oneuptimedata.archive /Volumes/DataDrive/Projects/OneUptime/app/backup.archive`

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

## Misc commands

Get into a MongoDB container with mongo shell:
`sudo kubectl exec -it fi-mongodb-0 mongo`

## Change / Rotate MongoDB Password

Change root password:

```
kubectl exec -it fi-mongodb-0 mongo     # get into mongodb container.
db = db.getSiblingDB('admin')                   # Change to admin db
db.auth("root", "<OLD-PASSWORD>")
db.changeUserPassword("root", "<NEW-PASSWORD>")
exit                                            # This is important.
```

Change user password:

```
kubectl exec -it fi-mongodb-0 mongo     # get into mongodb container.
db = db.getSiblingDB('admin')                   # Change to admin db
db.auth("root", "<OLD-PASSWORD>")
use oneuptimedb
db.changeUserPassword("<USER-PASSWORD>", "<NEW-PASSWORD>")
exit                                            # This is important.
```

## Set a member as master admin of OneUptime.

```
kubectl exec -it fi-mongodb-0 mongo
use oneuptimedb
db.auth('oneuptime','password')
db.users.find({email: 'admin@oneuptime.com'}) # Master admin user. Should be already signed up.
db.users.update({email: 'admin@oneuptime.com'}, {$set:{ role: 'master-admin'}}) # Update the user
```
