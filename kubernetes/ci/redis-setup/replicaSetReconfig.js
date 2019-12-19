print("Initiating Replicaset");

rs.reconfig({
     "_id": "fyipe-redis",
     "version": 1,
     "protocolVersion": 1,
     "members": [
          {
               "_id": 0,
               "host": "redis-0.redis-cluster.default.svc.cluster.local:6379",
               "priority": 10
          },
          {
               "_id": 1,
               "host": "redis-1.redis-cluster.default.svc.cluster.local:6379",
               "priority": 9
          },
          {
               "_id": 2,
               "host": "redis-2.redis-cluster.default.svc.cluster.local:6379",
               "priority": 8
          },
          {
               "_id": 3,
               "host": "redis-3.redis-cluster.default.svc.cluster.local:6379",
               "priority": 7
          },
          {
               "_id": 4,
               "host": "redis-4.redis-cluster.default.svc.cluster.local:6379",
               "priority": 6
          },
          {
               "_id": 5,
               "host": "redis-5.redis-cluster.default.svc.cluster.local:6379",
               "priority": 5
          }
     ]
}, { force: true });

print("ReplicaSet Initiated");