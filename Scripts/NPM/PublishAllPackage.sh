# Set the package name and version
package_version=$PACKAGE_VERSION

# If no package version is provided, exit
if [ -z "$package_version" ]; then
  echo "Package version is required"
  exit 1
fi

# touch npmrc file
touch ~/.npmrc

# Add Auth Token to npmrc file
echo "//registry.npmjs.org/:_authToken=$NPM_AUTH_TOKEN" > ~/.npmrc
echo "//registry.npmjs.org/:email=npm@oneuptime.com" >> ~/.npmrc

npm version $package_version

# Run npm install
npm install

# Run npm compile
npm run compile

# Publish the package
npm publish --tag latest

# Tag the package with the specified version
npm dist-tag add $package_name@$package_version latest

# Logout from npm
npm logout