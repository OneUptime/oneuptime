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
# For each package (@oneuptime/common, @oneuptime/react-native-replay,
# @oneuptime/cli, etc.):
# Navigate to the package settings
# Find the "Trusted Publisher" section
# Click "GitHub Actions"
# Configure:
# Organization or user: OneUptime
# Repository: oneuptime
# Workflow filename: release.yml
# Save the configuration

publish_to_npm() {
    local directory_name="$1"
    # Read the npm package name from the directory's package.json
    local npm_package_name
    npm_package_name=$(node -p "require('./$directory_name/package.json').name")

    # Check if this version is already published on npm.
    # `--prefer-online` for the same reason as the wait loop below: without it
    # this read can be answered from a packument npm cached earlier in the run.
    if npm view --prefer-online "$npm_package_name@$package_version" version 2>/dev/null; then
        echo "$npm_package_name@$package_version is already published on npm. Skipping."
        return 0
    fi

    echo "Publishing $npm_package_name@$package_version to npm"
    # Run each publish in a subshell. MobileRecorder is nested more deeply
    # than Common and CLI, so `cd ..` cannot reliably return to the repo root.
    (
        cd "$directory_name"

        # `--allow-same-version` because Scripts/Install/SyncPackageVersions.js
        # (run via the workflow's `npm run prerun`) has already pinned every
        # internal package.json to VERSION. Without this flag, `npm version`
        # exits 1 with "Version not changed" and aborts the publish step.
        npm version --allow-same-version "$package_version"

        # Replace any Common dependency with the pinned version being published
        sed -i "s/\"Common\": \"file:..\/Common\"/\"Common\": \"npm:@oneuptime\/common@$package_version\"/g" package.json
        sed -i "s/\"Common\": \"npm:@oneuptime\/common@latest\"/\"Common\": \"npm:@oneuptime\/common@$package_version\"/g" package.json

        npm install
        npm run compile
        npm publish --access public
    )
}


# Publish Common first - other packages depend on it
publish_to_npm "packages/Common"

# Wait for @oneuptime/common to be readable from the registry, because the
# packages below install against it by version.
#
# `--prefer-online` is load-bearing, not belt and braces. registry.npmjs.org
# serves packuments with max-age=300, and npm answers from its own cache
# without revalidating until that expires. The `npm view` in publish_to_npm
# above therefore seeds a cached packument that does not contain the version
# being published, and every poll here reads that same stale copy — so the
# loop could not observe the new version until the cache entry aged out,
# which is the five minutes this loop used to allow in total. 13.0.7 timed
# out here after publishing successfully, skipping the CLI and React Native
# publishes and every job gated behind them.
#
# The budget is raised to 15 minutes as well: @oneuptime/common unpacks to
# ~156 MB, and real propagation of a tarball that size is not instant.
echo "Waiting for @oneuptime/common@$package_version to be available on npm..."
max_attempts=90
attempt=1
until npm view --prefer-online "@oneuptime/common@$package_version" version 2>/dev/null; do
    if [ "$attempt" -ge "$max_attempts" ]; then
        echo "Timed out waiting for @oneuptime/common@$package_version to appear on npm after $((max_attempts * 10))s"
        exit 1
    fi
    echo "Attempt $attempt/$max_attempts - not available yet, retrying in 10s..."
    attempt=$((attempt + 1))
    sleep 10
done
echo "@oneuptime/common@$package_version is now available on npm"

# Install packages/Common's own dependencies before anything compiles against
# it.
#
# The packages below do not actually type-check against the tarball. Their
# lockfiles pin node_modules/Common as a link to ../Common, and npm keeps that
# link, so tsc follows the symlink and type-checks packages/Common's real
# sources — which import typeorm, react, axios and zod. Those resolve only if
# packages/Common/node_modules is populated.
#
# publish_to_npm populates it as a side effect of publishing, but it returns
# early when the version is already on npm, which is exactly the case when a
# release is re-run after a partial failure. 13.0.7 hit this: Common was
# already published, its install was skipped, and @oneuptime/cli failed with
# "Cannot find module 'typeorm'" against ../Common/**. Installing here makes
# the dependents' build independent of whether this run is the one that
# published Common.
echo "Installing packages/Common dependencies so dependents can compile against it"
(cd packages/Common && npm install)

# Publish packages that depend on Common (after Common is available on npm)
publish_to_npm "packages/App/FeatureSet/MobileRecorder"
publish_to_npm "packages/CLI"
