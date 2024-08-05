#!/bin/bash

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
echo "//registry.npmjs.org/:_authToken=$NPM_AUTH_TOKEN" >> ~/.npmrc
echo "//registry.npmjs.org/:email=npm@oneuptime.com" >> ~/.npmrc

# Show content of npmrc file
cat ~/.npmrc

publish_to_npm() {
    directory_name=$1
    echo "Publishing $directory_name@$package_version to npm"
    cd $directory_name

    npm version $package_version

    # Before npm install, replace "Common": "file:../Common" with "@oneuptime/common": "$package_version" in package.json
    sed -i "s/\"Common\": \"file:..\/Common\"/\"Common\": \"npm:@oneuptime\/common@$package_version\"/g" package.json

    # Before npm install, replace "CommonServer": "file:../CommonServer" with "@oneuptime/common-server": "$package_version" in package.json
    sed -i "s/\"CommonServer\": \"file:..\/CommonServer\"/\"CommonServer\": \"npm:@oneuptime\/common-server@$package_version\"/g" package.json
   
    # Before npm install, replace "CommonUI": "file:../CommonUI" with "@oneuptime/common-ui": "$package_version" in package.json
    sed -i "s/\"CommonUI\": \"file:..\/CommonUI\"/\"CommonUI\": \"npm:@oneuptime\/common-ui@$package_version\"/g" package.json


    npm install
    npm run compile
    npm publish --access public

    cd ..
}


publish_to_npm "Common"
publish_to_npm "CommonServer"
publish_to_npm "CommonUI"
