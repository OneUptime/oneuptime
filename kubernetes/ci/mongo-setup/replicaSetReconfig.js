print("Initiating Replicaset");

rs.reconfig({
    "_id" : "fyipe",
    "version":1,
    "protocolVersion": 1,
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
              "priority" : 8
         }
    ]
},{force : true});

print("ReplicaSet Initiated");