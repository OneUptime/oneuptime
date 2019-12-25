# This will download, build and package docker containers.
echo "RUNNING COMMAND: chmod +x ./ci/docker-build.sh"
chmod +x ./kubernetes/ci/docker-build.sh
echo "RUNNING COMMAND: ./ci/docker-build.sh branch=master GIT_USERNAME=\$GIT_USERNAME GIT_PASSWORD=\$GIT_PASSWORD"
./kubernetes/ci/docker-build.sh branch=$CI_COMMIT_REF_NAME GIT_USERNAME=$GIT_USERNAME GIT_PASSWORD=$GIT_PASSWORD
# Setup MognoDB
echo "RUNNING COMMAND: chmod +x ./ci/mongo-setup/setup.sh"
chmod +x ./kubernetes/ci/mongo-setup/setup.sh
echo "RUNNING COMMAND: ./ci/mongo-setup/setup.sh"
./kubernetes/ci/mongo-setup/setup.sh
# Setup Kubernetes Cluster
chmod +x ./kubernetes/ci/setup-cluster.sh
echo "RUNNING COMMAND: ./ci/setup-cluster.sh"
./kubernetes/ci/setup-cluster.sh
