#
echo "Running Cleanup Script..."
# Stop microk8s VM
echo "Stopping microk8s..."
# Delete microk8s cluster so it can be fresh for next job. 
echo "Delete microk8s Cluster..."
echo "RUNNING COMMAND:  sudo usermod -a -G microk8s $USER"
sudo usermod -a -G microk8s $USER || echo "microk8s group not found"
echo "RUNNING COMMAND: microk8s.reset || 'microk8s cannot delete'"
microk8s.reset || 'microk8s cannot delete'
echo "RUNNING COMMAND: microk8s.stop || 'microk8s cannot Stop'"
microk8s.stop || "microk8s cannot Stop"
echo "RUNNING COMMAND: sudo snap remove microk8s || 'microk8s cannot be removed.'"
sudo snap remove microk8s || 'microk8s cannot be removed.'
# Stop all docker containers
echo "Stop and Delete all docker containers..."
echo "RUNNING COMMAND: sudo docker stop \$(sudo docker ps -aq) || echo 'No docker containers'"
sudo docker stop $(sudo docker ps -aq) || echo 'No docker containers'
# Remove all docker containers.
echo "RUNNING COMMAND: sudo docker rm \$(sudo docker ps -aq) || echo 'No docker containers'"
sudo docker rm $(sudo docker ps -aq) || echo 'No docker containers'
echo "REINSTALL DOCKER"
# Delete all locally built images. (Comment this out to reduce build times)
# echo "RUNNING COMMAND: sudo docker rmi -f \$(sudo docker images -q) || echo 'No docker containers'"
# sudo docker rmi -f $(sudo docker images -q) || echo 'No docker containers'