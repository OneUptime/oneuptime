# This will download, build and package docker containers.
echo "RUNNING COMMAND: chmod +x ./ci/docker-build-all.sh"
chmod +x ./ci/scripts/docker-build-all.sh
./ci/scripts/docker-build-all.sh test
# Setup Kubernetes Cluster
chmod +x ./ci/scripts/setup-cluster.sh
echo "RUNNING COMMAND: ./ci/setup-cluster.sh"
./ci/scripts/setup-cluster.sh
