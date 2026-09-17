#!/usr/bin/env bash

set -euo pipefail

COMMON_DIR="/usr/src/Common"
ISOLATED_VM_DIR="${COMMON_DIR}/node_modules/isolated-vm"

log() {
    echo "[probe bootstrap] $*"
}

isolated_vm_can_load() {
    node -e 'require(process.argv[1])' "${ISOLATED_VM_DIR}" >/dev/null 2>&1
}

ensure_common_dependencies() {
    if [ ! -d "${COMMON_DIR}/node_modules" ]; then
        log "Common node_modules is missing. Installing dependencies."
        (
            cd "${COMMON_DIR}"
            npm install
        )
        return
    fi

    if [ ! -d "${ISOLATED_VM_DIR}" ]; then
        log "isolated-vm is missing from Common node_modules. Reinstalling Common dependencies."
        (
            cd "${COMMON_DIR}"
            npm install
        )
        return
    fi

    if isolated_vm_can_load; then
        return
    fi

    log "Repairing isolated-vm for the current container runtime."

    if ! (
        cd "${COMMON_DIR}"
        npm rebuild isolated-vm
    ); then
        log "isolated-vm rebuild failed. Reinstalling Common dependencies."
        rm -rf "${ISOLATED_VM_DIR}"

        (
            cd "${COMMON_DIR}"
            npm install
        )
    fi

    isolated_vm_can_load
}

ensure_common_dependencies

exec npm run dev
