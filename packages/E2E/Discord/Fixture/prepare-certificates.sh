#!/usr/bin/env bash
set -euo pipefail
# Execute inside the disposable Debian runner with /fixture-private and
# /fixture-trust backed by dedicated Docker volumes. Never use host credentials.
umask 077
mkdir -p /fixture-private /fixture-trust
openssl req -x509 -newkey rsa:2048 -nodes -keyout /fixture-private/ca.key -out /fixture-trust/ca.crt -days 2 -subj /CN=OneUptime-Discord-Disposable-E2E-CA >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -keyout /fixture-private/server.key -out /fixture-private/server.csr -subj /CN=discord.com >/dev/null 2>&1
printf 'subjectAltName=DNS:discord.com,DNS:discord-fixture\nextendedKeyUsage=serverAuth\n' > /fixture-private/server.ext
openssl x509 -req -in /fixture-private/server.csr -CA /fixture-trust/ca.crt -CAkey /fixture-private/ca.key -CAcreateserial -out /fixture-private/server.crt -days 2 -extfile /fixture-private/server.ext >/dev/null 2>&1
openssl genpkey -algorithm ED25519 -out /fixture-private/interaction.key >/dev/null 2>&1
openssl pkey -in /fixture-private/interaction.key -pubout -outform DER -out /fixture-private/interaction-public.der
chmod 644 /fixture-trust/ca.crt
