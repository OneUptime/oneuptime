#!/bin/bash
set -e

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
    # Read the npm package name from the directory's package.json
    npm_package_name=$(node -p "require('./$directory_name/package.json').name")

    # Check if this version is already published on npm
    if npm view "$npm_package_name@$package_version" version 2>/dev/null; then
        echo "$npm_package_name@$package_version is already published on npm. Skipping."
        return 0
    fi

    echo "Publishing $npm_package_name@$package_version to npm"
    cd $directory_name

    npm version $package_version

    # Replace any Common dependency with the pinned version being published
    sed -i "s/\"Common\": \"file:..\/Common\"/\"Common\": \"npm:@oneuptime\/common@$package_version\"/g" package.json
    sed -i "s/\"Common\": \"npm:@oneuptime\/common@latest\"/\"Common\": \"npm:@oneuptime\/common@$package_version\"/g" package.json

    npm install
    npm run compile
    npm publish --access public

    cd ..
}


# Publish Common first - other packages depend on it
publish_to_npm "Common"

# Wait for @oneuptime/common to be available on the npm registry.
# There is a propagation delay after publishing, so we poll until
# the version resolves (up to ~5 minutes).
echo "Waiting for @oneuptime/common@$package_version to be available on npm..."
max_attempts=30
attempt=0
until npm view "@oneuptime/common@$package_version" version 2>/dev/null; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge "$max_attempts" ]; then
        echo "Timed out waiting for @oneuptime/common@$package_version to appear on npm"
        exit 1
    fi
    echo "Attempt $attempt/$max_attempts - not available yet, retrying in 10s..."
    sleep 10
done
echo "@oneuptime/common@$package_version is now available on npm"

# Publish packages that depend on Common (after Common is available on npm)
publish_to_npm "CLI"
