#!/usr/bin/env bash
#
# Put back every file traces-record.sh edited, and take away its collector. It does this itself
# when it ends, and this is for when it never got to: the limit on its step kills it where it
# stands, with OSProfiler on and whatever it was trying left behind, and on run 41912669813 that
# had Neutron answering 500 to the logs step after it. So the workflow runs this after that step
# whatever became of it, and a hang there costs that step alone.
#
# Does nothing when there is nothing to put back, which is what a run that ended well leaves.
#
# Usage: bash traces-put-back.sh [folder traces-record.sh saved them in]

set -uo pipefail

SAVED_DIR="${1:-${RUNNER_TEMP:-/tmp}/traces-record-saved}"
COLLECTOR_NAME=ou-openstack-traces

if ! sudo test -f "$SAVED_DIR/manifest"; then
  echo "traces-record.sh left nothing to put back."
  exit 0
fi

echo "traces-record.sh did not finish: putting back what it edited."
while IFS= read -r file; do
  saved="$SAVED_DIR/$(printf '%s' "$file" | tr '/' '_')"
  if sudo test -f "$saved"; then
    sudo cp -p "$saved" "$file"
    echo "  $file"
  fi
done < <(sudo cat "$SAVED_DIR/manifest")

docker rm -f "$COLLECTOR_NAME" >/dev/null 2>&1 || true
sudo systemctl cancel || true
sudo systemctl reset-failed 'devstack@*' || true
# Bounded, so that what comes next does not pay for a service that will not come back.
sudo timeout 300 systemctl restart 'devstack@*' || true
sudo rm -rf "$SAVED_DIR"
