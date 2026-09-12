#!/usr/bin/env bash
set -e

# Set the package name and version
package_version="${PACKAGE_VERSION:-}"
github_sha="${GITHUB_SHA:-}"

# If no package version is provided, exit
if [ -z "$package_version" ]; then
  echo "Package version is required" >&2
  exit 1
fi

# GITHUB_SHA identifies the immutable source commit for this release. It is
# required even on a rerun so an existing registry version is never silently
# accepted from a different build.
if [ -z "$github_sha" ]; then
  echo "GITHUB_SHA is required to verify npm package provenance" >&2
  exit 1
fi

# Note: Authentication is handled via npm OIDC trusted publishing
# The GitHub Actions workflow provides id-token: write permission
# and setup-node action configures the registry-url

###
# Required Manual Configuration on npmjs.com
# You need to configure Trusted Publishers for each npm package:

# Go to npmjs.com and log into your account
# For each package (@oneuptime/common, @oneuptime/cli, etc.):
# Navigate to the package settings
# Find the "Trusted Publisher" section
# Click "GitHub Actions"
# Configure:
# Organization or user: OneUptime
# Repository: oneuptime
# Workflow filename: release.yml
# Save the configuration

is_npm_not_found_response() {
    local response=$1

    # npm has used both the legacy "npm ERR!" and current "npm error" prefixes.
    # With --json it also emits the error code in a JSON object.
    case "$response" in
        *'"code":"E404"'*|*'"code": "E404"'*|*"npm ERR! code E404"*|*"npm error code E404"*)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

common_publish_required=false
cli_publish_required=false

preflight_npm_package() {
    local directory_name=$1
    local npm_package_name
    local npm_package_spec
    local npm_view_output
    local npm_view_status
    local published_git_head

    # Read the npm package name from the directory's package.json
    npm_package_name=$(node -p "require('./$directory_name/package.json').name")
    npm_package_spec="$npm_package_name@$package_version"

    # npm versions are immutable. A rerun may reuse an existing version only
    # when the registry records that it came from this exact release commit.
    # Treat only an explicit E404 as absence; connectivity and registry errors
    # leave the state unknown and must fail closed instead of attempting publish.
    if npm_view_output=$(npm view "$npm_package_spec" version --json 2>&1); then
        if published_git_head=$(npm view "$npm_package_spec" gitHead); then
            if [ -z "$published_git_head" ]; then
                echo "Refusing to reuse $npm_package_spec: npm did not return gitHead, so its provenance cannot be verified." >&2
                return 1
            fi

            if [ "$published_git_head" != "$github_sha" ]; then
                echo "Refusing to reuse $npm_package_spec: npm gitHead '$published_git_head' does not exactly match GITHUB_SHA '$github_sha'." >&2
                return 1
            fi

            echo "$npm_package_spec is already published from GITHUB_SHA $github_sha. Safely skipping."
            return 0
        fi

        echo "Unable to read npm gitHead for $npm_package_spec. Refusing to reuse a package whose provenance cannot be verified." >&2
        return 1
    else
        npm_view_status=$?
        if ! is_npm_not_found_response "$npm_view_output"; then
            echo "Unable to determine whether $npm_package_spec is published (npm view exited $npm_view_status). Refusing to publish while registry state is unknown." >&2
            printf '%s\n' "$npm_view_output" >&2
            return 1
        fi
    fi

    case "$directory_name" in
        Common)
            common_publish_required=true
            ;;
        CLI)
            cli_publish_required=true
            ;;
        *)
            echo "Unknown npm package directory '$directory_name' during preflight" >&2
            return 1
            ;;
    esac

    echo "$npm_package_spec is not published on npm (E404). It will be published from GITHUB_SHA $github_sha after all package preflight checks pass."
}

publish_to_npm() {
    local directory_name=$1
    local npm_package_name
    local npm_package_spec

    npm_package_name=$(node -p "require('./$directory_name/package.json').name")
    npm_package_spec="$npm_package_name@$package_version"

    echo "Publishing $npm_package_spec from GITHUB_SHA $github_sha."
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

    cd ..
}

# Resolve every package's immutable registry state before publishing anything.
# This prevents a partial release when a later package has a provenance
# collision or its registry state cannot be determined.
preflight_npm_package "Common"
preflight_npm_package "CLI"

# Publish Common first - other packages depend on it.
if [ "$common_publish_required" = true ]; then
    publish_to_npm "Common"
fi

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

# Publish packages that depend on Common (after Common is available on npm).
if [ "$cli_publish_required" = true ]; then
    publish_to_npm "CLI"
fi
