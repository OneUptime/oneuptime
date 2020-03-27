# This will download, build and package docker containers.
echo "RUNNING COMMAND: chmod +x ./ci/docker-build.sh"
chmod +x ./ci/scripts/docker-build.sh
# Setup Kubernetes Cluster
chmod +x ./ci/scripts/setup-cluster.sh
echo "RUNNING COMMAND: ./ci/setup-cluster.sh"
./ci/scripts/setup-cluster.sh
