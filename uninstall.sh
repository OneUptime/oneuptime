echo "REMOVING EXISTING CONTAINERS..."
sudo docker-compose down
sudo docker stop $(sudo docker ps -aq) || echo 'No docker containers'
sudo docker rm $(sudo docker ps -aq) || echo 'No docker containers'
echo "EXISTING CONTAINERS REMOVED."