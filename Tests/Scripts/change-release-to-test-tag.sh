# This script replcaes APP_TAG in config.env to test
# This is used to change the release tag to test tag for the tests

# Replace APP_TAG in config.env to test
sed -i 's/APP_TAG=latest/APP_TAG=test/g' config.env