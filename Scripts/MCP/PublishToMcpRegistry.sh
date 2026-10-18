#!/bin/bash
#
# Publishes OneUptime Cloud's MCP server to the official MCP Registry
# (registry.modelcontextprotocol.io) at this release's version: the entry in
# packages/App/FeatureSet/MCP/server.json, com.oneuptime/mcp, which points MCP
# clients and directories at https://oneuptime.com/mcp.
#
# The publish-mcp-registry job in .github/workflows/release.yml runs it once
# the GitHub release is published, with mcp-publisher on PATH and:
#
#   PACKAGE_VERSION           the release's version, e.g. 14.0.72
#   MCP_REGISTRY_PRIVATE_KEY  the Ed25519 private key, in hex, whose public key
#                             is in oneuptime.com's MCPv1 TXT record
#
# Only whoever controls oneuptime.com may publish under com.oneuptime:
# `mcp-publisher login dns` signs a timestamp with the key, and the registry
# checks the signature against the "v=MCPv1; k=ed25519; p=..." TXT record on
# oneuptime.com itself, not on a subdomain. packages/App/FeatureSet/MCP/README.md
# says how the key and the record are made.
#
# Like Scripts/NPM/PublishAllPackages.sh, it skips a version the registry
# already has, so a re-run of the release publishes nothing twice. A version,
# once published, can be neither changed nor published again.

set -euo pipefail

SERVER_JSON="packages/App/FeatureSet/MCP/server.json"
REGISTRY_URL="https://registry.modelcontextprotocol.io"
DOMAIN="oneuptime.com"

# Seconds to wait before each retry of the registry lookup, space separated;
# the count also sets the attempts (delays + 1). Tests set it to zeros.
LOOKUP_RETRY_DELAYS="${MCP_REGISTRY_LOOKUP_RETRY_DELAYS-5 15 30}"

version="${PACKAGE_VERSION:-}"
if [ -z "$version" ]; then
    echo "PACKAGE_VERSION is required" >&2
    exit 1
fi

name="$(jq --exit-status --raw-output '.name' "$SERVER_JSON")"
lookup_url="${REGISTRY_URL}/v0.1/servers/$(jq --null-input --raw-output --arg name "$name" '$name | @uri')/versions/$(jq --null-input --raw-output --arg version "$version" '$version | @uri')?include_deleted=true"

# Answers "does the registry have this version?" as yes (0), no (1), or
# could-not-tell (exits the script).
#
# Only a clean 404 is "no". The registry is a preview service and now and
# then answers a lookup with a 500 - it did so for a server it had never
# heard of while this was being written - so any other answer, or none, is
# asked again and, if it persists, fails the job rather than be read either
# way: as "yes" it would skip a release's entry, and as "no" it would try to
# publish a version the registry may already have. Deleted versions count:
# the registry keeps their version numbers.
version_is_published() {
    local -a delays=()
    # `|| true` because read reports failure at EOF; the herestring always
    # supplies a trailing newline, but an empty override would trip `set -e`.
    read -ra delays <<< "$LOOKUP_RETRY_DELAYS" || true
    local max_attempts=$(( ${#delays[@]} + 1 ))
    local attempt=1
    local status

    while true; do
        status="$(curl --silent --show-error --max-time 30 --output /dev/null --write-out '%{http_code}' "$lookup_url" || true)"

        case "$status" in
            200) return 0 ;;
            404) return 1 ;;
        esac

        if (( attempt >= max_attempts )); then
            echo "::error::Could not tell whether the MCP Registry has ${name} ${version}: ${lookup_url} answered HTTP ${status:-000} ${max_attempts} times. Nothing was published; re-run this job to try again."
            exit 1
        fi

        echo "The MCP Registry answered HTTP ${status:-000} on attempt ${attempt}/${max_attempts} for ${name} ${version}; asking again in ${delays[attempt - 1]}s." >&2
        sleep "${delays[attempt - 1]}"
        attempt=$(( attempt + 1 ))
    done
}

if version_is_published; then
    echo "${name} ${version} is already in the MCP Registry. Skipping."
    exit 0
fi

if [ -z "${MCP_REGISTRY_PRIVATE_KEY:-}" ]; then
    echo "::error::MCP_REGISTRY_PRIVATE_KEY is not set, so ${name} ${version} cannot be published. Add it as a secret of the mcp-registry-publish environment: see packages/App/FeatureSet/MCP/README.md."
    exit 1
fi

# The server.json in the repository carries a placeholder version. The
# release's goes on a copy, which is what is validated and published.
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
release_json="$work_dir/server.json"
jq --arg version "$version" '.version = $version' "$SERVER_JSON" > "$release_json"

echo "Publishing ${name} ${version} to the MCP Registry"
mcp-publisher validate "$release_json"
mcp-publisher login dns --registry "$REGISTRY_URL" --domain "$DOMAIN" --private-key "$MCP_REGISTRY_PRIVATE_KEY"
mcp-publisher publish "$release_json"
echo "Published ${name} ${version} to the MCP Registry."
