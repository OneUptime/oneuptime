# See all services.

sudo docker service ls

# Restart Service

sudo docker service update --force <SERVICE_ID>

# See Logs

sudo docker service logs <SERVICE_ID>

# See all containers running on all docker swarm nodes

sudo docker node ps \$(sudo docker node ls -q)

# Deploy / Update a stack

sudo docker stack deploy stack -c stack.yaml
