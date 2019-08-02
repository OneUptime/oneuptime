# Setup Production Server


### Setup Docker Credentials

On your local terminal

```
DOCKER_REGISTRY_SERVER=https://index.docker.io/v1/
DOCKER_USER=Type your dockerhub username, same as when you `docker login`
DOCKER_EMAIL=Type your dockerhub email, same as when you `docker login`
DOCKER_PASSWORD=Type your dockerhub pw, same as when you `docker login`

kubectl create secret docker-registry regcred \
  --docker-server=$DOCKER_REGISTRY_SERVER \
  --docker-username=$DOCKER_USER \
  --docker-password=$DOCKER_PASSWORD \
  --docker-email=$DOCKER_EMAIL
```

### Setup Gitlab Credentials

```
DOCKER_REGISTRY_SERVER= registry.gitlab.com
DOCKER_USER=Type your gitlab username, same as when you `gitlab login`
DOCKER_EMAIL=Type your gitlab email, same as when you `gitlab login`
DOCKER_PASSWORD=Type your gitlab pw, same as when you `gitlab login`

kubectl create secret docker-registry gitlabcredv2 \
  --docker-server=$DOCKER_REGISTRY_SERVER \
  --docker-username=$DOCKER_USER \
  --docker-password=$DOCKER_PASSWORD \
  --docker-email=$DOCKER_EMAIL
```

###  Run the production-server.yml file. 

run the file specific to the project with their specific names.
`kubectl create -f production-server.yml`

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






