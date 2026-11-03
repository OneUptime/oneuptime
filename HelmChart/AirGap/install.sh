#!/usr/bin/env bash
#
# Carries a OneUptime release into a network with no route to the internet.
#
# On a machine that reaches the internet, `save` writes every image the
# release's Helm chart runs, and the signed chart itself, into one folder with
# a checksum for every file. Carry the folder across the gap; then, on a
# machine that reaches your registry, `push` checks the checksums, loads every
# image into your registry under the same names and tags, and prints the
# values that point the chart at it.
#
# Every OneUptime serves this script at /install/air-gapped, OneUptime Cloud
# among them:
#
#   curl -fsSL https://oneuptime.com/install/air-gapped -o air-gap.sh
#
#   bash air-gap.sh images --version 14.0.102            # what a release runs
#   bash air-gap.sh save   --version 14.0.102            # on the connected side
#   bash air-gap.sh push   --bundle oneuptime-air-gap-14.0.102 \
#                          --registry registry.example.com  # inside the gap
#
# It needs helm (images and save), and one of crane, skopeo or docker to copy
# images: it uses the first it finds, in that order, unless --tool names one.
# Docs: https://oneuptime.com/docs/installation/air-gapped

set -euo pipefail

CHART_REPOSITORY="https://helm-chart.oneuptime.com"
CHART_NAME="oneuptime"

COMMAND=""
VERSION=""
EDITION="community"
PLATFORM="linux/amd64"
TOOL=""
OUTPUT=""
BUNDLE=""
REGISTRY=""
CHART=""
INSECURE="false"
VALUES_FILES=()
WORK_DIR=""

usage() {
    cat <<'USAGE'
Usage:
  air-gap.sh images --version VERSION [options]
  air-gap.sh save   --version VERSION [options]
  air-gap.sh push   --bundle FOLDER --registry REGISTRY [options]

Commands:
  images   Print every image the release's chart runs, one per line.
  save     Write those images and the signed chart into one folder, with
           SHA256SUMS. Run it where the internet is reachable.
  push     Check a saved folder's checksums and load every image into
           REGISTRY, keeping names and tags. Run it inside the gap.

Options:
  --version VERSION     The OneUptime release, such as 14.0.102.
  --edition EDITION     community (the default) or enterprise.
  --values FILE         Your values.yaml, so the images of what you turn on
                        (PgBouncer, vLLM, the database operators) are
                        included. Repeat for more files.
  --platform PLATFORM   The platform to save, such as linux/amd64 (the
                        default) or linux/arm64.
  --tool TOOL           crane, skopeo or docker. Default: the first found.
  --output FOLDER       Where save writes. Default: oneuptime-air-gap-VERSION.
  --chart PATH          A chart folder or .tgz to read instead of
                        downloading the release's chart.
  --bundle FOLDER       The folder save wrote (push).
  --registry REGISTRY   Your registry, such as registry.example.com or
                        registry.example.com/mirror (push).
  --insecure            Let crane or skopeo reach a registry over HTTP or
                        with a certificate they do not trust (push).
  -h, --help            Show this help.
USAGE
}

log() {
    printf '%s\n' "$*" >&2
}

die() {
    printf 'air-gap.sh: %s\n' "$*" >&2
    exit 1
}

need() {
    command -v "$1" >/dev/null 2>&1 || die "$1 is not installed. $2"
}

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------

parse_args() {
    if [ "$#" -eq 0 ]; then
        usage
        exit 1
    fi

    case "$1" in
        -h | --help)
            usage
            exit 0
            ;;
        images | save | push)
            COMMAND="$1"
            shift
            ;;
        *)
            usage >&2
            die "unknown command '$1'"
            ;;
    esac

    while [ "$#" -gt 0 ]; do
        case "$1" in
            --version | --edition | --values | --platform | --tool | --output | --chart | --bundle | --registry)
                [ "$#" -ge 2 ] && [ -n "$2" ] || die "$1 needs a value"
                case "$1" in
                    --version) VERSION="$2" ;;
                    --edition) EDITION="$2" ;;
                    --values) VALUES_FILES+=("$2") ;;
                    --platform) PLATFORM="$2" ;;
                    --tool) TOOL="$2" ;;
                    --output) OUTPUT="$2" ;;
                    --chart) CHART="$2" ;;
                    --bundle) BUNDLE="$2" ;;
                    --registry) REGISTRY="${2%/}" ;;
                esac
                shift 2
                ;;
            --insecure)
                INSECURE="true"
                shift
                ;;
            -h | --help)
                usage
                exit 0
                ;;
            *)
                die "unknown option '$1' (see --help)"
                ;;
        esac
    done

    case "$EDITION" in
        community | enterprise) ;;
        *) die "--edition is community or enterprise, not '$EDITION'" ;;
    esac

    case "$PLATFORM" in
        */*) ;;
        *) die "--platform is os/arch, such as linux/amd64, not '$PLATFORM'" ;;
    esac

    if [ -n "$VERSION" ] && ! printf '%s' "$VERSION" | grep -Eq '^[0-9A-Za-z][0-9A-Za-z._-]*$'; then
        die "--version '$VERSION' is not a release, such as 14.0.102"
    fi

    local file
    for file in ${VALUES_FILES[@]+"${VALUES_FILES[@]}"}; do
        [ -f "$file" ] || die "--values $file: no such file"
    done
}

# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------

# crane, skopeo or docker: the one --tool names, else the first installed.
pick_tool() {
    if [ -n "$TOOL" ]; then
        case "$TOOL" in
            crane | skopeo | docker) ;;
            *) die "--tool is crane, skopeo or docker, not '$TOOL'" ;;
        esac
        need "$TOOL" "Install it, or pick another with --tool."
        return
    fi

    local candidate
    for candidate in crane skopeo docker; do
        if command -v "$candidate" >/dev/null 2>&1; then
            TOOL="$candidate"
            log "Copying images with $TOOL."
            return
        fi
    done

    die "found none of crane, skopeo or docker to copy images with. Install one."
}

# The release's chart, downloaded into <folder> with its signature, or --chart.
fetch_chart() {
    local folder="$1"

    if [ -n "$CHART" ]; then
        [ -e "$CHART" ] || die "--chart $CHART: no such file or folder"
        if [ -d "$CHART" ]; then
            helm package "$CHART" --destination "$folder" >/dev/null ||
                die "helm could not package the chart in $CHART"
        else
            cp "$CHART" "$folder/"
            if [ -f "${CHART}.prov" ]; then
                cp "${CHART}.prov" "$folder/"
            fi
        fi
    else
        log "Downloading the OneUptime ${VERSION} chart and its signature from ${CHART_REPOSITORY}."
        helm pull "$CHART_NAME" --repo "$CHART_REPOSITORY" --version "$VERSION" \
            --destination "$folder" --prov >/dev/null ||
            die "helm could not download chart ${CHART_NAME} ${VERSION} from ${CHART_REPOSITORY}"
    fi

    local chart_file
    chart_file="$(find "$folder" -maxdepth 1 -name '*.tgz' | head -n 1)"
    [ -n "$chart_file" ] || die "no chart was written to $folder"
    printf '%s\n' "$chart_file"
}

# Every image the chart runs at this release and edition, with the user's
# values: what its templates render as image or imageName, once each.
list_images() {
    local chart_file="$1" image_type="community-edition" rendered

    if [ "$EDITION" = "enterprise" ]; then
        image_type="enterprise-edition"
    fi

    local values_args=()
    local file
    for file in ${VALUES_FILES[@]+"${VALUES_FILES[@]}"}; do
        values_args+=(--values "$file")
    done

    rendered="$(helm template oneuptime "$chart_file" \
        --set "image.tag=${VERSION}" \
        --set "image.type=${image_type}" \
        ${values_args[@]+"${values_args[@]}"})" ||
        die "helm could not render the chart"

    printf '%s\n' "$rendered" |
        sed -n -E 's/^[[:space:]]*(-[[:space:]]+)?(image|imageName):[[:space:]]*//p' |
        tr -d "\"'" |
        sed -E 's/[[:space:]]+$//; /^$/d' |
        sort -u
}

# An image's file name in the bundle: its reference, made safe for a path.
image_file() {
    printf 'images/%s.tar\n' "$(printf '%s' "$1" | tr '/:@' '___')"
}

# The image's name without its registry, as global.imageRegistry expects it
# under your registry: docker.io/oneuptime/app:14.0.102 is oneuptime/app:14.0.102,
# postgres:15 stays postgres:15. A first segment with a "." or a ":", or
# "localhost", is a registry, as Docker reads an image name.
without_registry() {
    local reference="$1" first
    case "$reference" in
        */*)
            first="${reference%%/*}"
            case "$first" in
                *.* | *:* | localhost)
                    printf '%s\n' "${reference#*/}"
                    return
                    ;;
            esac
            ;;
    esac
    printf '%s\n' "$reference"
}

# Whether the image names a registry other than Docker Hub: global.imageRegistry
# leaves those as written, so their own values have to move them.
names_other_registry() {
    local reference="$1" first
    case "$reference" in
        */*) first="${reference%%/*}" ;;
        *) return 1 ;;
    esac
    case "$first" in
        docker.io | index.docker.io) return 1 ;;
        *.* | *:* | localhost) return 0 ;;
    esac
    return 1
}

save_image() {
    local reference="$1" file="$2"
    local os="${PLATFORM%%/*}" rest="${PLATFORM#*/}" arch variant=""
    arch="${rest%%/*}"
    if [ "$rest" != "$arch" ]; then
        variant="${rest#*/}"
    fi

    case "$TOOL" in
        crane)
            crane pull --platform "$PLATFORM" "$reference" "$file"
            ;;
        skopeo)
            local platform_args=(--override-os "$os" --override-arch "$arch")
            if [ -n "$variant" ]; then
                platform_args+=(--override-variant "$variant")
            fi
            skopeo copy "${platform_args[@]}" "docker://${reference}" "docker-archive:${file}:${reference}"
            ;;
        docker)
            docker pull --platform "$PLATFORM" "$reference" >/dev/null
            docker save --output "$file" "$reference"
            ;;
    esac
}

push_image() {
    local file="$1" reference="$2" destination="$3"

    case "$TOOL" in
        crane)
            if [ "$INSECURE" = "true" ]; then
                crane push --insecure "$file" "$destination"
            else
                crane push "$file" "$destination"
            fi
            ;;
        skopeo)
            if [ "$INSECURE" = "true" ]; then
                skopeo copy --dest-tls-verify=false "docker-archive:${file}" "docker://${destination}"
            else
                skopeo copy "docker-archive:${file}" "docker://${destination}"
            fi
            ;;
        docker)
            docker load --input "$file" >/dev/null
            docker tag "$reference" "$destination"
            docker push "$destination" >/dev/null
            ;;
    esac
}

# ---------------------------------------------------------------------------
# Checksums: sha256sum where it is (Linux), shasum -a 256 where it is not (macOS).
# ---------------------------------------------------------------------------

sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$@"
    else
        shasum -a 256 "$@"
    fi
}

sha256_check() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum --check --quiet "$1"
    else
        shasum -a 256 --check --quiet "$1"
    fi
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

cmd_images() {
    [ -n "$VERSION" ] || die "images needs --version, such as --version 14.0.102"
    need helm "Install Helm 3: https://helm.sh/docs/intro/install/"

    WORK_DIR="$(mktemp -d)"
    trap 'rm -rf "$WORK_DIR"' EXIT

    local chart_file
    chart_file="$(fetch_chart "$WORK_DIR")"
    list_images "$chart_file"
}

cmd_save() {
    [ -n "$VERSION" ] || die "save needs --version, such as --version 14.0.102"
    need helm "Install Helm 3: https://helm.sh/docs/intro/install/"
    pick_tool

    local output="${OUTPUT:-oneuptime-air-gap-${VERSION}}"
    if [ -e "$output" ] && [ -n "$(ls -A "$output" 2>/dev/null)" ]; then
        die "$output already exists and is not empty: name another with --output"
    fi
    mkdir -p "$output/images" "$output/chart"

    local chart_file images count=0 total
    chart_file="$(fetch_chart "$output/chart")"
    images="$(list_images "$chart_file")"
    [ -n "$images" ] || die "the chart renders no images"
    total="$(printf '%s\n' "$images" | wc -l | tr -d ' ')"

    : >"$output/images.txt"
    local reference file
    while IFS= read -r reference; do
        count=$((count + 1))
        file="$(image_file "$reference")"
        log "[${count}/${total}] ${reference}"
        save_image "$reference" "$output/$file" </dev/null || die "could not save ${reference}"
        printf '%s %s\n' "$file" "$reference" >>"$output/images.txt"
    done <<<"$images"

    {
        printf 'VERSION=%s\n' "$VERSION"
        printf 'EDITION=%s\n' "$EDITION"
        printf 'PLATFORM=%s\n' "$PLATFORM"
        printf 'CHART=chart/%s\n' "$(basename "$chart_file")"
    } >"$output/bundle.env"

    (
        cd "$output"
        find . -type f ! -name SHA256SUMS | sed 's|^\./||' | sort | while IFS= read -r path; do
            sha256_of "$path"
        done >SHA256SUMS
    )

    log ""
    log "Saved ${total} images and the chart in ${output}/ ($(du -sh "$output" | cut -f1))."
    log "Carry the whole folder across, then run:"
    log "  bash air-gap.sh push --bundle ${output} --registry registry.example.com"
    if [ ! -f "$output/chart/$(basename "$chart_file").prov" ]; then
        log "This chart has no signature file, so helm verify cannot check it."
    fi
}

cmd_push() {
    [ -n "$BUNDLE" ] || die "push needs --bundle, the folder save wrote"
    [ -n "$REGISTRY" ] || die "push needs --registry, such as --registry registry.example.com"
    [ -d "$BUNDLE" ] || die "--bundle $BUNDLE: no such folder"
    [ -f "$BUNDLE/images.txt" ] && [ -f "$BUNDLE/SHA256SUMS" ] && [ -f "$BUNDLE/bundle.env" ] ||
        die "$BUNDLE is not a folder save wrote: images.txt, SHA256SUMS or bundle.env is missing"
    pick_tool

    log "Checking every file against SHA256SUMS."
    (cd "$BUNDLE" && sha256_check SHA256SUMS) ||
        die "a file in $BUNDLE does not match SHA256SUMS: copy the folder across again"

    local version edition
    version="$(sed -n 's/^VERSION=//p' "$BUNDLE/bundle.env")"
    edition="$(sed -n 's/^EDITION=//p' "$BUNDLE/bundle.env")"

    local total count=0 file reference destination moved_by_values=""
    total="$(grep -c . "$BUNDLE/images.txt" || true)"
    while IFS=' ' read -r file reference; do
        [ -n "$file" ] || continue
        count=$((count + 1))
        destination="${REGISTRY}/$(without_registry "$reference")"
        log "[${count}/${total}] ${destination}"
        push_image "$BUNDLE/$file" "$reference" "$destination" </dev/null ||
            die "could not push ${destination}"
        if names_other_registry "$reference"; then
            moved_by_values="${moved_by_values}  ${destination}
"
        fi
    done <"$BUNDLE/images.txt"

    log ""
    log "Pushed ${count} images to ${REGISTRY}. Point the chart at it with:"
    printf '%s\n' "global:"
    printf '  imageRegistry: %s\n' "$REGISTRY"
    printf '%s\n' "image:"
    printf '  tag: "%s"\n' "$version"
    if [ "$edition" = "enterprise" ]; then
        printf '%s\n' "  type: enterprise-edition"
    fi
    if [ -n "$moved_by_values" ]; then
        log ""
        log "These images name a registry of their own, so global.imageRegistry leaves"
        log "them as written: set the value that names each one to its copy here."
        printf '%s' "$moved_by_values" >&2
    fi
}

main() {
    parse_args "$@"
    case "$COMMAND" in
        images) cmd_images ;;
        save) cmd_save ;;
        push) cmd_push ;;
    esac
}

main "$@"
