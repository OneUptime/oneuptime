#!/usr/bin/env bash
set -euo pipefail
mkdir -p /root/.pki/nssdb
certutil -N -d sql:/root/.pki/nssdb --empty-password
certutil -A -d sql:/root/.pki/nssdb -n discord-disposable-e2e -t 'C,,' -i /fixture-trust/ca.crt
exec "$@"
