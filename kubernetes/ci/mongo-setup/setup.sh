sudo kubectl create -f ./kubernetes/ci/mongo-setup/unsecureMongo.yaml
echo "Wait for 2 mins...."
sleep 2m
MONGO_IP=`sudo kubectl get --all-namespaces --output json pods | jq '.items[] | select(.metadata.name=="mongo-0")' | jq .status.podIP`
MONGO_IP=`echo "$MONGO_IP" | tr -d '"'`
mongo $MONGO_IP:27017/admin ./kubernetes/ci/mongo-setup/initialReplicaSetSetup.js
echo "Wait for 1 min...."
sleep 1m
mongo $MONGO_IP:27017/admin ./kubernetes/ci/mongo-setup/mongoAdminSetup.js
mongo $MONGO_IP:27017/admin ./kubernetes/ci/mongo-setup/replicaSetReconfig.js
