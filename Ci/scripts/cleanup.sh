#
sudo dpkg --configure -a
echo "Running Cleanup Script..."
if [[ $(which helm) ]]
then
  # Remove oneuptime if helm is installed
  echo "RUNNING COMMAND: sudo helm uninstall oneuptime || echo 'oneuptime not installed'"
  sudo helm uninstall oneuptime || echo 'oneuptime not installed'
fi

if [[ $(which microk8s) ]]
then
  # Stop microk8s VM
  echo "Stopping microk8s..."
  # Delete microk8s cluster so it can be fresh for next job.
  echo "Delete microk8s Cluster..."
  echo "RUNNING COMMAND:  sudo usermod -a -G microk8s $USER"
  sudo usermod -a -G microk8s $USER || echo "microk8s group not found"
  echo "RUNNING COMMAND: microk8s.reset || 'microk8s cannot delete'"
  sudo microk8s.reset || 'microk8s cannot delete'
  echo "RUNNING COMMAND: microk8s.kubectl delete all --all || 'microk8s.kubectl cannot delete'"
  sudo microk8s.kubectl delete all --all || 'microk8s.kubectl cannot delete'
  echo "RUNNING COMMAND: microk8s.stop || 'microk8s cannot Stop'"
  sudo microk8s.stop || "microk8s cannot Stop"
  echo "RUNNING COMMAND: sudo snap remove microk8s || 'microk8s cannot be removed.'"
  sudo snap remove microk8s || 'microk8s cannot be removed.'
fi

if [[ $(which docker) ]]
then
  # Stop all docker containers
  echo "Stop and Delete all docker containers..."
  echo "RUNNING COMMAND: sudo docker stop \$(sudo docker ps -aq) || echo 'No docker containers'"
  sudo docker stop $(sudo docker ps -aq) || echo 'No docker containers'
  # Remove all docker containers.
  echo "RUNNING COMMAND: sudo docker rm \$(sudo docker ps -aq) || echo 'No docker containers'"
  sudo docker rm $(sudo docker ps -aq) || echo 'No docker containers'
  # Delete all locally built images. (Comment this out to reduce build times)
  # echo "RUNNING COMMAND: sudo docker rmi -f \$(sudo docker images -q) || echo 'No docker containers'"
  # sudo docker rmi -f $(sudo docker images -q) || echo 'No docker containers'
  
  # Comment line below to reduce build times. 
  # sudo docker system prune -a --volumes --force
fi

# fix broken unmet dependencies
sudo apt --fix-broken install -y -y

# remove any service holding port 80
sudo apt remove apache2 nginx -y
sudo apt purge apache2 nginx -y
sudo apt autoremove -y