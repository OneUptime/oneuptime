sudo k create -f ./kubernetes/ci/redis-setup/unsecureRedis.yaml
echo "Wait for 2 mins...."
sleep 2m
REDIS_IP=`sudo k get --all-namespaces --output json pods | jq '.items[] | select(.metadata.name=="redis-0")' | jq .status.podIP`
REDIS_IP=`echo "$REDIS_IP" | tr -d '"'`
redis-server --appendonly yes --cluster-enabled yes
echo "Wait for 1 min...."
sleep 1m
redis-cli --cluster create $REDIS_IP:6379 $REDIS_IP:6379 $REDIS_IP:6379 $REDIS_IP:6379 $REDIS_IP:6379 $REDIS_IP:6379 --cluster-replicas 1
