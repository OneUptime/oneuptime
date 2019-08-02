# This will download, build and package docker containers.
echo "RUNNING COMMAND: chmod +x ./ci/docker-build.sh"
chmod +x ./ci/docker-build.sh
echo "RUNNING COMMAND: ./ci/docker-build.sh branch=master GIT_USERNAME=\$GIT_USERNAME GIT_PASSWORD=\$GIT_PASSWORD"
./ci/docker-build.sh branch=$CI_COMMIT_REF_NAME GIT_USERNAME=$GIT_USERNAME GIT_PASSWORD=$GIT_PASSWORD
# Setup MognoDB
echo "RUNNING COMMAND: chmod +x ./ci/mongo-setup/setup.sh"
chmod +x ./ci/mongo-setup/setup.sh
echo "RUNNING COMMAND: ./ci/mongo-setup/setup.sh"
./ci/mongo-setup/setup.sh
# Setup Kubernetes Cluster
chmod +x ./ci/setup-cluster.sh
echo "RUNNING COMMAND: ./ci/setup-cluster.sh"
./ci/setup-cluster.sh
