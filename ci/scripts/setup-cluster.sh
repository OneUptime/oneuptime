# Wait for all the services to come online.
echo "RUNNING COMMAND: echo 'Wait for 5 mins....'"
echo 'Wait for 5 mins....'
echo "RUNNING COMMAND: sleep 5m"
sleep 5m
# Get the status of all the kubernetes resources for debugging purposes.
echo "RUNNING COMMAND: sudo k get pods"
sudo k get pods
echo "RUNNING COMMAND: sudo k get services"
sudo k get services
echo "RUNNING COMMAND: sudo k get rc"
sudo k get rc
echo "RUNNING COMMAND: sudo k get deployments"
sudo k get deployments
echo "RUNNING COMMAND: sudo k get statefulset"
sudo k get statefulset
echo "RUNNING COMMAND: sudo k get pv"
sudo k get pv
echo "RUNNING COMMAND: sudo k get pvc"
sudo k get pvc
echo "RUNNING COMMAND: sudo k get storageclass"
sudo k get storageclass
echo "RUNNING COMMAND: sudo k cluster-info"
sudo k cluster-info
echo "RUNNING COMMAND: sudo k get all --all-namespaces"
sudo k get all --all-namespaces