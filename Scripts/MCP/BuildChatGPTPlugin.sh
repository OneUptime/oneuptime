#!/bin/bash
#
# Builds the ZIP OneUptime uploads to the ChatGPT plugin directory
# (platform.openai.com/plugins), which ChatGPT and Codex share, to list its
# hosted MCP server: the package in packages/App/FeatureSet/MCP/ChatGPTPlugin,
# with plugin.json, mcp.json and assets/ at the root of the archive, and the
# coding agent plugin's skills under skills/. The package's README says what
# else a submission needs.
#
# Usage: npm run build-chatgpt-plugin [-- <output.zip>]
#   default output: build/chatgpt-plugin/oneuptime-chatgpt-plugin.zip

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLUGIN_DIRECTORY="$REPO_ROOT/packages/App/FeatureSet/MCP/ChatGPTPlugin"
SKILLS_DIRECTORY="$REPO_ROOT/packages/App/FeatureSet/MCP/CodingAgentPlugin"

output="${1:-$REPO_ROOT/build/chatgpt-plugin/oneuptime-chatgpt-plugin.zip}"

# A relative path is relative to where the command was typed. npm runs the
# script from the repository root and keeps that place in INIT_CWD.
case "$output" in
    /*) ;;
    *) output="${INIT_CWD:-$PWD}/$output" ;;
esac

mkdir -p "$(dirname "$output")"
output="$(cd "$(dirname "$output")" && pwd)/$(basename "$output")"

# zip adds to an archive that exists; start from nothing.
rm -f "$output"

# The package's files only (README.md is for people), without directory
# entries or extra file attributes such as owners.
(cd "$PLUGIN_DIRECTORY" && zip -q -X -D "$output" plugin.json mcp.json assets/*)

# The skills ChatGPT and Codex load from skills/ at the root of the package:
# the coding agent plugin's, so one set of skills serves every client, held to
# this server by packages/App/FeatureSet/MCP/Tests/CodingAgentPlugin.test.ts.
(cd "$SKILLS_DIRECTORY" && zip -q -X -D -r "$output" skills -x '*.DS_Store')

echo "Built $output"
