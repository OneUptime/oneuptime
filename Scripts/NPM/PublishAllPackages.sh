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
    # What npm publishes, inside the package's directory: the package itself,
    # or the directory the package's `build-npm-package` script writes, for a
    # package whose own manifest cannot be the one npm publishes. Common is
    # that package (see "Publish Common first" below).
    local built_package_directory="${2:-}"
    # Read the npm package name from the directory's package.json
    local npm_package_name
    npm_package_name=$(node -p "require('./$directory_name/package.json').name")

    # Check if this version is already published on npm, so a re-run of the
    # release after a partial failure publishes only what is missing.
    # `--prefer-online` asks the registry itself: registry.npmjs.org serves
    # packuments with max-age=300, and without it npm answers from a packument
    # it cached earlier in the job, one that can predate the version (a read
    # like that, in a poll this script no longer has, failed 13.0.7's release).
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

        # No package published here needs Common when it runs (#4872). The
        # CLI bundles the Common code it uses when npm packs it (its prepack
        # script, packages/CLI/esbuild.config.js), so its lockfile's link to
        # ../Common stays as it is: the bundle is built from this checkout's
        # Common and its locked dependencies, the code CI tested. This used
        # to rewrite that link to npm:@oneuptime/common@<version>, which
        # swapped in a registry copy with freshly resolved dependencies and
        # published a CLI that needed @oneuptime/common to run.
        npm install
        if [ -z "$built_package_directory" ]; then
            npm run compile
            npm publish --access public
        else
            # The build compiles everything it publishes, so it type-checks
            # it too, and refuses to write a package that names a file or a
            # package it does not have.
            npm run build-npm-package
            npm publish "./$built_package_directory" --access public
        fi
    )
}


# Publish Common first, in the order the release has always published.
#
# packages/Common/package.json is the manifest every package of this
# repository links as node_modules/Common, so it cannot also be the manifest
# of what npm publishes as @oneuptime/common: an exports map there would
# redirect every require("Common/...") in the repository. And publishing the
# directory as it is shipped a package Node.js could not load at all (its
# main, index.js, did not exist; its paths held TypeScript). So `npm run
# build-npm-package` (packages/Common/Scripts/NpmPackage/BuildNpmPackage.js)
# writes the npm package into build/npm/package - the modules of Types/,
# Utils/ and Models/ that run in plain Node.js, as CommonJS and ES modules
# with their types, under an exports map, at the version `npm version` set
# above - and npm publishes that directory.
publish_to_npm "packages/Common" "build/npm/package"

# The packages below are published as soon as Common's publish has returned,
# without waiting for @oneuptime/common@$package_version to become readable on
# the registry. None of them installs it: since #4872 the CLI bundles ../Common
# when npm packs it (its prepack script), and the React Native recorder never
# used Common. So the wait that stood here - `npm view` polled every 10 seconds
# for up to 90 minutes - only kept the order, and the order holds without it,
# because each publish below starts after Common's has finished.
#
# What the wait cost was every minute npm took to make a 181 MB package
# readable: 8.6, 13.6 and 19.7 minutes in the releases of 14.0.61, 14.0.63 and
# 14.0.65, and 55 minutes in 14.0.7's, with a runner held all along and the
# release's e2e jobs, which needed this job, waiting behind it.

# Install packages/Common's own dependencies before anything compiles against
# it.
#
# The packages below do not actually type-check against the tarball. Their
# lockfiles pin node_modules/Common as a link to ../Common, and npm keeps that
# link, so tsc follows the symlink and type-checks packages/Common's real
# sources — which import typeorm, react, axios and zod. Those resolve only if
# packages/Common/node_modules is populated. The CLI's bundle is built from
# the same sources and the same node_modules.
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

# Then the React Native recorder and the CLI, in that order, as always.
publish_to_npm "packages/App/FeatureSet/MobileRecorder"
publish_to_npm "packages/CLI"
