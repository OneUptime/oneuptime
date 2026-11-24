#!/usr/bin/env bash
#
# Checks the packages build-package.sh wrote before anything is published:
# for each platform, that the runtime image embedded in its package is that
# platform's, and that the provider binary in it is built for that platform
# - and, with --run, that the binary starts.
#
#   bash Scripts/CrossplaneProvider/check-package.sh \
#     [--platforms linux/amd64,linux/arm64] [--input <dir>] [--run]
#
# The end-to-end test installs the amd64 package only, so a package whose
# image or binary is another platform's would be published unnoticed, and
# the provider's pod would crash on every node of that platform with
# "exec format error" (#6617). Each package (<input>/provider-oneuptime-
# <arch>.xpkg) is a docker-loadable image tarball:
#
#   - its image config says os linux and the platform's architecture;
#   - its entrypoint, /usr/local/bin/provider, is in one of its layers, an
#     ELF executable for that architecture (its header's e_machine);
#   - it holds package.yaml, the layer Crossplane reads the package from;
#   - with --run, `docker run --platform <platform> ... --help` prints the
#     provider's usage: another architecture than the machine's needs QEMU
#     (docker/setup-qemu-action registers it in CI).
#
# Needs python3, and docker for --run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLATFORMS="linux/amd64,linux/arm64"
INPUT="${ROOT}/Crossplane/packages"
RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platforms) PLATFORMS="$2"; shift 2 ;;
    --input) INPUT="$2"; shift 2 ;;
    --run) RUN=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

tools=(python3)
if [[ "$RUN" == true ]]; then
  tools+=(docker)
fi
for tool in "${tools[@]}"; do
  command -v "$tool" >/dev/null || { echo "$tool is not on PATH." >&2; exit 1; }
done

# The image config's platform and the entrypoint binary's architecture,
# read from the tarball: prints "<os> <architecture> <binary architecture>",
# or fails with what is wrong.
inspect_package() {
  python3 -I - "$1" <<'PYTHON'
import io
import json
import sys
import tarfile

ENTRYPOINT = "usr/local/bin/provider"
# ELF e_machine values (the header's bytes 18-19, little endian).
MACHINES = {0x3E: "amd64", 0xB7: "arm64"}


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def layer_members(package, name):
    data = package.extractfile(name)
    if data is None:
        fail(f"layer {name} is missing")
    # Layers are gzipped or plain tarballs.
    return tarfile.open(fileobj=io.BytesIO(data.read()), mode="r:*")


try:
    package = tarfile.open(sys.argv[1], mode="r:*")
except (OSError, tarfile.TarError) as error:
    fail(f"not an image tarball: {error}")

try:
    manifest = json.load(package.extractfile("manifest.json"))[0]
except (KeyError, TypeError, ValueError, IndexError):
    fail("no manifest.json: not a package build-package.sh writes")

config = json.load(package.extractfile(manifest["Config"]))
entrypoint = (config.get("config") or {}).get("Entrypoint") or []
if entrypoint != ["/" + ENTRYPOINT]:
    fail(f"its entrypoint is {entrypoint}, not /{ENTRYPOINT}")

binary = None
has_package_yaml = False
for name in manifest["Layers"]:
    layer = layer_members(package, name)
    for member in layer.getmembers():
        path = member.name.lstrip("./")
        if path == "package.yaml":
            has_package_yaml = True
        if path == ENTRYPOINT and member.isfile():
            binary = layer.extractfile(member).read(20)

if not has_package_yaml:
    fail("it holds no package.yaml: Crossplane would not find the package")
if binary is None:
    fail(f"no layer holds /{ENTRYPOINT}")
if len(binary) < 20 or binary[:4] != b"\x7fELF":
    fail(f"/{ENTRYPOINT} is not an ELF executable")
machine = int.from_bytes(binary[18:20], "little")

print(
    config.get("os", ""),
    config.get("architecture", ""),
    MACHINES.get(machine, f"e_machine-0x{machine:x}"),
)
PYTHON
}

failed=0
IFS=',' read -r -a platforms <<<"$PLATFORMS"
for platform in "${platforms[@]}"; do
  os="${platform%%/*}"
  arch="${platform##*/}"
  file="${INPUT}/provider-oneuptime-${arch}.xpkg"
  echo "==> ${platform}: $(basename "$file")"

  if [[ ! -f "$file" ]]; then
    echo "::error title=No ${platform} package::${file} is missing: build-package.sh writes one for each platform." >&2
    failed=1
    continue
  fi

  if ! found="$(inspect_package "$file" 2>"${file}.check-error")"; then
    echo "::error title=Broken ${platform} package::$(basename "$file"): $(cat "${file}.check-error")" >&2
    rm -f "${file}.check-error"
    failed=1
    continue
  fi
  rm -f "${file}.check-error"
  read -r image_os image_arch binary_arch <<<"$found"

  if [[ "$image_os" != "$os" || "$image_arch" != "$arch" ]]; then
    echo "::error title=Wrong runtime image in the ${platform} package::$(basename "$file") embeds a ${image_os}/${image_arch} runtime image, not ${platform}." >&2
    failed=1
    continue
  fi
  if [[ "$binary_arch" != "$arch" ]]; then
    echo "::error title=Wrong provider binary in the ${platform} package::$(basename "$file")'s /usr/local/bin/provider is built for ${binary_arch}, not ${arch}." >&2
    failed=1
    continue
  fi
  echo "    image ${image_os}/${image_arch}, binary ${binary_arch}"

  if [[ "$RUN" == true ]]; then
    loaded="$(docker load --quiet --input "$file")"
    image="${loaded##*: }"
    if ! usage="$(docker run --rm --platform "$platform" "$image" --help 2>&1)"; then
      echo "::error title=The ${platform} provider does not start::$(basename "$file"): ${usage}" >&2
      failed=1
    elif ! grep -q "usage:" <<<"$usage"; then
      echo "::error title=The ${platform} provider does not start::$(basename "$file") printed no usage: ${usage}" >&2
      failed=1
    else
      echo "    it starts: $(head -n 1 <<<"$usage")"
    fi
    docker image rm "$image" >/dev/null 2>&1 || true
  fi
done

exit "$failed"
