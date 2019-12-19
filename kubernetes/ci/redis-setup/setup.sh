sudo k create -f ./kubernetes/ci/redis-setup/unsecureRedis.yaml
echo "Wait for 2 mins...."
sleep 2m
REDIS_IP=`sudo k get --all-namespaces --output json pods | jq '.items[] | select(.metadata.name=="redis-0")' | jq .status.podIP`
REDIS_IP=`echo "$REDIS_IP" | tr -d '"'`
redis $REDIS_IP:6379 ./kubernetes/ci/redis-setup/initialReplicaSetSetup.js
echo "Wait for 1 min...."
sleep 1m
redis $REDIS_IP:6379 ./kubernetes/ci/redis-setup/replicaSetReconfig.js
