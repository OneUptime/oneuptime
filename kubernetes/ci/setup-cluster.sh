# Docker registry env vars to create Kubernetes secret.
echo "RUNNING COMMAND: DOCKER_REGISTRY_SERVER=\$DOCKERREGISTRY"
DOCKER_REGISTRY_SERVER=$DOCKERREGISTRY
echo "RUNNING COMMAND: DOCKER_USER=\$DOCKERUSERNAME"
DOCKER_USER=$DOCKERUSERNAME
echo "RUNNING COMMAND: DOCKER_EMAIL=\$DOCKEREMAIL"
DOCKER_EMAIL=$DOCKEREMAIL
echo "RUNNING COMMAND: DOCKER_PASSWORD=\$DOCKERPASSWORD"
DOCKER_PASSWORD=$DOCKERPASSWORD
# Create kubenetes secret.
echo "RUNNING COMMAND: sudo kubectl delete secret gitlabcredv2 || echo 'No gitlabcredv2 key found'"
sudo kubectl delete secret gitlabcredv2 || echo 'No gitlabcredv2 key found'
echo "RUNNING COMMAND: sudo kubectl create secret docker-registry gitlabcredv2 --docker-server=\$DOCKER_REGISTRY_SERVER --docker-username=\$DOCKER_USER --docker-password=\$DOCKER_PASSWORD --docker-email=\$DOCKER_EMAIL"
sudo kubectl create secret docker-registry gitlabcredv2 --docker-server=$DOCKER_REGISTRY_SERVER --docker-username=$DOCKER_USER --docker-password=$DOCKER_PASSWORD --docker-email=$DOCKER_EMAIL
# Create the entire cluster.
echo "RUNNING COMMAND: sudo kubectl create -f test-server.yaml"
sudo kubectl create -f ./kubernetes/ci/ci-server.yaml
# Wait for all the services to come online.
echo "RUNNING COMMAND: echo 'Wait for 5 mins....'"
echo 'Wait for 5 mins....'
echo "RUNNING COMMAND: sleep 5m"
sleep 5m
# Get the status of all the kubernetes resources for debugging purposes.
echo "RUNNING COMMAND: sudo kubectl get pods"
sudo kubectl get pods
echo "RUNNING COMMAND: sudo kubectl get services"
sudo kubectl get services
echo "RUNNING COMMAND: sudo kubectl get rc"
sudo kubectl get rc
echo "RUNNING COMMAND: sudo kubectl get deployments"
sudo kubectl get deployments
echo "RUNNING COMMAND: sudo kubectl get statefulset"
sudo kubectl get statefulset
echo "RUNNING COMMAND: sudo kubectl get pv"
sudo kubectl get pv
echo "RUNNING COMMAND: sudo kubectl get pvc"
sudo kubectl get pvc
echo "RUNNING COMMAND: sudo kubectl get storageclass"
sudo kubectl get storageclass
echo "RUNNING COMMAND: sudo kubectl cluster-info"
sudo kubectl cluster-info