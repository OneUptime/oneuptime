# This will download, build and package docker containers.
echo "RUNNING COMMAND: chmod +x ./ci/docker-build.sh"
chmod +x ./kubernetes/ci/docker-build.sh
# Setup Kubernetes Cluster
chmod +x ./kubernetes/ci/setup-cluster.sh
echo "RUNNING COMMAND: ./ci/setup-cluster.sh"
./kubernetes/ci/setup-cluster.sh
