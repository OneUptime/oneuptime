#!/usr/bin/env bash
#
# Clones the OneUptime blog for the Home image, with its whole history: the
# Home server reads that history for each post's contributors and updated
# date (Utils/BlogPost.ts, Utils/BlogPostUpdatedDate.ts), so the clone is
# never shallow.
#
#   bash CloneBlog.sh /usr/src/blog
#
# The blog is ~4 GB, nearly all of it its posts' images. GitHub counts its
# ~780,000 objects for ~20 seconds and then sends them at 3-5 MiB/s, so a
# clone takes 15-20 minutes, in one transfer that git cannot resume. Nothing
# gave up a transfer that stopped delivering: the Home image build of release
# 14.0.103's gate (Build run 41681440927, 2026-11-03) sat at "Cloning into
# 'blog'..." until its 45-minute timeout, with nothing in the log to tell a
# stalled transfer from a slow one. So:
#
#   - a transfer slower than BLOG_CLONE_LOW_SPEED_LIMIT bytes a second
#     (100 KiB) for BLOG_CLONE_LOW_SPEED_TIME seconds (120) is given up, with
#     git's http.lowSpeedLimit and http.lowSpeedTime. Two minutes is six times
#     GitHub's counting, and 100 KiB/s a thirtieth of its usual rate, so only
#     a transfer that has all but stopped is given up;
#   - what the failed attempt left is removed, and the clone starts again, up
#     to BLOG_CLONE_ATTEMPTS times (3), BLOG_CLONE_RETRY_DELAY seconds (15)
#     apart;
#   - --progress logs the transfer's size and rate as it goes.
#
# BLOG_REPOSITORY_URL (https://github.com/oneuptime/blog) is what to clone.
# Tests/Ops/HomeBlogClone.test.js sets it, and the timings, to serve the
# script a repository that stalls.

set -euo pipefail

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
	echo "Usage: CloneBlog.sh <directory>" >&2
	exit 2
fi

DESTINATION="$1"
URL="${BLOG_REPOSITORY_URL:-https://github.com/oneuptime/blog}"
ATTEMPTS="${BLOG_CLONE_ATTEMPTS:-3}"
LOW_SPEED_LIMIT="${BLOG_CLONE_LOW_SPEED_LIMIT:-102400}"
LOW_SPEED_TIME="${BLOG_CLONE_LOW_SPEED_TIME:-120}"
RETRY_DELAY="${BLOG_CLONE_RETRY_DELAY:-15}"

# Each setting is a whole number, and there is at least one attempt and a
# low speed check that can fire (git turns the check off at 0).
for setting in ATTEMPTS LOW_SPEED_LIMIT LOW_SPEED_TIME RETRY_DELAY; do
	case "${!setting}" in
	'' | *[!0-9]*)
		echo "CloneBlog: BLOG_CLONE_${setting} must be a whole number, not '${!setting}'." >&2
		exit 2
		;;
	esac
done
for setting in ATTEMPTS LOW_SPEED_LIMIT LOW_SPEED_TIME; do
	if [ "${!setting}" -lt 1 ]; then
		echo "CloneBlog: BLOG_CLONE_${setting} must be at least 1." >&2
		exit 2
	fi
done

if ! command -v git >/dev/null 2>&1; then
	echo "CloneBlog: git is not installed." >&2
	exit 1
fi

# A failed attempt's directory is removed, so never clone into one that was
# there before: it is not this script's to remove.
if [ -e "$DESTINATION" ]; then
	echo "CloneBlog: ${DESTINATION} already exists; not cloning into it." >&2
	exit 1
fi

attempt=1
while true; do
	echo "CloneBlog: cloning ${URL} into ${DESTINATION} (attempt ${attempt} of ${ATTEMPTS})"
	if git \
		-c http.lowSpeedLimit="$LOW_SPEED_LIMIT" \
		-c http.lowSpeedTime="$LOW_SPEED_TIME" \
		clone --progress "$URL" "$DESTINATION"; then
		echo "CloneBlog: cloned ${URL} on attempt ${attempt}"
		exit 0
	fi

	# What the attempt left: git removes a clone that fails, unless it was
	# killed outright.
	rm -rf -- "$DESTINATION"

	if [ "$attempt" -ge "$ATTEMPTS" ]; then
		echo "CloneBlog: could not clone ${URL}: attempt ${attempt} of ${ATTEMPTS} failed." >&2
		exit 1
	fi

	echo "CloneBlog: attempt ${attempt} failed; trying again in ${RETRY_DELAY}s." >&2
	sleep "$RETRY_DELAY"
	attempt=$((attempt + 1))
done
