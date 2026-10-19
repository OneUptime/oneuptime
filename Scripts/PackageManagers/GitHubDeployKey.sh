#!/usr/bin/env bash
#
# Shared by the publish scripts in this directory. Source it; it defines one
# function and runs nothing on its own.
#
# use_github_deploy_key <private key> <directory>
#
# Makes git reach github.com over SSH with this deploy key, and trust only
# github.com's own host key (https://api.github.com/meta, ssh_keys), so a
# runner whose known_hosts says otherwise, or has no entry, neither prompts
# nor talks to anyone else. The key may carry its newlines as literal \n, as
# a GitHub secret pasted on one line does. The key and known_hosts are
# written to <directory>, which the caller removes.

readonly GITHUB_SSH_HOST_KEY="github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl"

use_github_deploy_key() {
	local key="$1"
	local directory="$2"

	(
		umask 077
		printf '%b\n' "$key" >"$directory/deploy_key"
		printf '%s\n' "$GITHUB_SSH_HOST_KEY" >"$directory/known_hosts"
	)

	export GIT_SSH_COMMAND="ssh -i '$directory/deploy_key' -o IdentitiesOnly=yes -o UserKnownHostsFile='$directory/known_hosts' -o StrictHostKeyChecking=yes -o HostKeyAlgorithms=ssh-ed25519"
}
