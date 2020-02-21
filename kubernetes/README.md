# Setup Production Server

###  Run the production.yml file. 

run the file specific to the project with their specific names.
`kubectl create -f production.yml`

# Kubernetes file for Fyipe Deployment. 

Step #1 - Get into a MongoDB pod 

`kubectl exec -it mongo-0 mongo`

Step #2 - Use admin db

`use admin`

Step #3 - Initiate a Replicaset

rs.initiate({
     "_id" : "fyipe",
     "version":1,
     "members" : [
          {
               "_id" : 0,
               "host" : "mongo-0.mongo-headless.default.svc.cluster.local:27017",
               "priority" : 10
          },
          {
               "_id" : 1,
               "host" : "mongo-1.mongo-headless.default.svc.cluster.local:27017",
               "priority" : 9
          },
          {
               "_id" : 2,
               "host" : "mongo-2.mongo-headless.default.svc.cluster.local:27017",
               "arbiterOnly" : true
          }
     ]
},{force : true});


Step #4 - Create admin user
db.createUser({
  user:'admin', pwd:'372b60f4-704c-4205-8e5c-45cdbf44b1fc', roles : [{role:'root', db:'admin'}]
});

Step #5 - Auth with admin user

db.auth('admin','372b60f4-704c-4205-8e5c-45cdbf44b1fc');

Step #6 - Create admin user in fyipe db

use fyipedb

db.createUser({
  user:'admin', pwd:'372b60f4-704c-4205-8e5c-45cdbf44b1fc', roles : [{role:'dbAdmin', db:'fyipedb'},{role:'readWrite', db:'fyipedb'}]
});

Step #6 - Delete Stateful set. 

kubectl delete statefulset mongo

Step 7

Add auth flag to MongoDB and create stateful set again. 






