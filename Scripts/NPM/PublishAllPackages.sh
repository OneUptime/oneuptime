#!/bin/bash

# Set the package name and version
package_version=$PACKAGE_VERSION

# If no package version is provided, exit
if [ -z "$package_version" ]; then
  echo "Package version is required"
  exit 1
fi

# Note: Authentication is handled via npm OIDC trusted publishing
# The GitHub Actions workflow provides id-token: write permission
# and setup-node action configures the registry-url

###
# Required Manual Configuration on npmjs.com
# You need to configure Trusted Publishers for each npm package:

# Go to npmjs.com and log into your account
# For each package (@oneuptime/common, @oneuptime/mcp-server, etc.):
# Navigate to the package settings
# Find the "Trusted Publisher" section
# Click "GitHub Actions"
# Configure:
# Organization or user: OneUptime
# Repository: oneuptime
# Workflow filename: release.yml
# Save the configuration

publish_to_npm() {
    directory_name=$1
    echo "Publishing $directory_name@$package_version to npm"
    cd $directory_name

    npm version $package_version

    # Before npm install, replace "Common": "file:../Common" with "@oneuptime/common": "$package_version" in package.json
    sed -i "s/\"Common\": \"file:..\/Common\"/\"Common\": \"npm:@oneuptime\/common@$package_version\"/g" package.json

    npm install
    npm run compile
    npm publish --access public

    cd ..
}


publish_to_npm "Common"
