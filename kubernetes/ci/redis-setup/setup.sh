sudo k create -f ./kubernetes/ci/redis-setup/unsecureRedis.yaml
echo "Wait for 5 mins...."
sleep 5m
# Deploy redis cluster, 3 masters and 3 slaves
sudo k exec -it redis-0 -- redis-cli --cluster create --cluster-replicas 1 $(sudo k get pods -l app=redis -o jsonpath='{range.items[*]}{.status.podIP}:6379 ') --cluster-yes
REDIS_IP=$(sudo k get pods -l app=redis -o jsonpath='{range.items[]}{.status.podIP}')
REDIS_IP=`echo "$REDIS_IP" | tr -d '"'`
export REDIS_HOST_IP=$REDIS_IP
# Setup redis host
sudo k create configmap redis-host --from-literal=REDIS_HOST=${REDIS_HOST_IP}
echo "Wait for 1 min...."
sleep 1m