##############
# IMPORTANT:
# This script sets the CI/CD machine up to run a build job. It's usually the first script that runs
##############

# Cleanup
echo "RUNNING COMMAND:  chmod +x ./ci/cleanup.sh"
chmod +x ./ci/scripts/cleanup.sh
echo "RUNNING COMMAND:  ./ci/cleanup.sh"
./ci/scripts/cleanup.sh

# Setup Machine.
echo "RUNNING COMMAND:  chmod +x ./HelmChart/public/install.sh"
chmod +x ./HelmChart/public/install.sh
echo "RUNNING COMMAND:  ./HelmChart/public/install.sh"
./HelmChart/public/install.sh ci-install $1

# For dpkg interruption 
sudo dpkg --configure -a