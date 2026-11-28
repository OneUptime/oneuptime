#!/usr/bin/env bash
#
# The CycloneDX SBOM of one file GoReleaser built, the same bytes for the
# same file (.goreleaser.yaml's sboms:, which runs this in dist/):
#
#   sbom.sh <artifact> <document>
#
# syft writes a random serial number and the time it ran into every SBOM it
# makes, and has no setting for either, so two builds of the same commit made
# two of each, and the checksums file that lists them differed too (#11466).
# This keeps every byte syft wrote but those two: the time is the commit's
# (SBOM_TIMESTAMP, which GoReleaser sets from the commit), and the serial
# number is a UUID of everything else in the document, so it is the same for
# the same SBOM and changes whenever anything else in it does.
#
# Tests/Ops/InfrastructureAgentReproducibleBuild.test.js runs it, on its own
# and in a build of the agent.

set -euo pipefail

if [ "$#" -ne 2 ] || [ -z "${SBOM_TIMESTAMP:-}" ]; then
    echo "Usage: SBOM_TIMESTAMP=<RFC 3339 time> sbom.sh <artifact> <document>" >&2
    exit 2
fi

# As GoReleaser ran syft before: the artifact as syft finds it (an archive is
# unpacked, a binary read), in CycloneDX JSON.
syft "$1" --output "cyclonedx-json=$2"

python3 - "$2" "$SBOM_TIMESTAMP" <<'PYTHON'
import hashlib
import json
import re
import sys
import uuid

path, timestamp = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as document:
    text = document.read()

# The two values, where syft writes them: the document's own serialNumber,
# and the first field of its metadata. Each must be there exactly once.
SERIAL = re.compile(r'"serialNumber":"urn:uuid:[0-9a-fA-F-]{36}"')
TIMESTAMP = re.compile(r'"metadata":\{"timestamp":"[^"]*"')
if len(SERIAL.findall(text)) != 1 or len(TIMESTAMP.findall(text)) != 1:
    sys.exit(f"sbom.sh: {path} is not the CycloneDX document syft writes")

body = TIMESTAMP.sub(
    lambda match: '"metadata":{"timestamp":' + json.dumps(timestamp), text
)
serial = uuid.uuid5(
    uuid.NAMESPACE_URL,
    "https://oneuptime.com/sbom/sha256/"
    + hashlib.sha256(SERIAL.sub('"serialNumber":""', body).encode("utf-8")).hexdigest(),
)
result = SERIAL.sub(lambda match: f'"serialNumber":"{serial.urn}"', body)

# Still the document syft wrote, with the two values in their places.
parsed = json.loads(result)
if parsed.get("serialNumber") != serial.urn or parsed.get("metadata", {}).get("timestamp") != timestamp:
    sys.exit(f"sbom.sh: could not set the serial number and time of {path}")

with open(path, "w", encoding="utf-8") as document:
    document.write(result)
PYTHON
