#!/bin/sh
#
# Sends SNMPv3 traps and informs to the OneUptime probe, as a SAN switch set
# up for SNMPv3 notifications does. Run it in the san-switch-v3 container,
# so they come from its fixed address (172.30.99.17):
#
#   docker compose exec san-switch-v3 send-v3-traps            # all of the below
#   docker compose exec san-switch-v3 send-v3-traps trap       # authPriv SHA / AES trap
#   docker compose exec san-switch-v3 send-v3-traps trap-sha256  # authPriv SHA-256 / AES-256 trap
#   docker compose exec san-switch-v3 send-v3-traps inform     # SNMPv3 inform, waits for the probe's acknowledgement
#   docker compose exec san-switch-v3 send-v3-traps inform-v2c # v2c inform, the same
#   docker compose exec san-switch-v3 send-v3-traps wrong-key  # refused: a wrong authentication passphrase
#   docker compose exec san-switch-v3 send-v3-traps inform-to <probe engine id>
#                                     # an inform sent with the probe's engine ID given up front, as Cisco IOS does
#
# PROBE_ADDRESS and PROBE_TRAP_PORT say where the probe listens (the
# bridge's gateway, 172.30.99.1, is the host a host-networked probe runs on).

set -u

PROBE="udp:${PROBE_ADDRESS:-172.30.99.1}:${PROBE_TRAP_PORT:-162}"

# This switch's own SNMP engine ID: the engine its traps are authenticated as.
ENGINE_ID="${ENGINE_ID:-0x80001F888053414E2D53572D3031}"

LINK_DOWN="1.3.6.1.6.3.1.1.5.3"
LINK_UP="1.3.6.1.6.3.1.1.5.4"
IF_INDEX="1.3.6.1.2.1.2.2.1.1.7"

# The users the README registers in OneUptime.
SAN_MONITOR="-u san-monitor -l authPriv -a SHA -A authpass123 -x AES -X privpass123"
FABRIC_MONITOR="-u fabric-monitor -l authPriv -a SHA-256 -A fabricauth123 -x AES-256 -X fabricpriv123"

say() {
  printf '%s\n' "$*"
}

send_trap() {
  say "SNMPv3 trap (authPriv, SHA / AES, user san-monitor): linkDown on ifIndex 7"
  # shellcheck disable=SC2086
  snmptrap -v 3 -e "$ENGINE_ID" $SAN_MONITOR "$PROBE" '' "$LINK_DOWN" "$IF_INDEX" i 7
}

send_trap_sha256() {
  say "SNMPv3 trap (authPriv, SHA-256 / AES-256, user fabric-monitor): linkUp on ifIndex 7"
  # shellcheck disable=SC2086
  snmptrap -v 3 -e "$ENGINE_ID" $FABRIC_MONITOR "$PROBE" '' "$LINK_UP" "$IF_INDEX" i 7
}

send_inform() {
  say "SNMPv3 inform (authPriv, SHA / AES, user san-monitor): linkUp on ifIndex 7"
  # snmpinform discovers the probe's engine ID, then waits for its acknowledgement.
  # shellcheck disable=SC2086
  if snmpinform -v 3 -t 5 -r 2 $SAN_MONITOR "$PROBE" '' "$LINK_UP" "$IF_INDEX" i 7; then
    say "  acknowledged by the probe"
  else
    say "  not acknowledged: is the probe listening, and does OneUptime have the san-monitor user?"
    return 1
  fi
}

send_inform_v2c() {
  say "v2c inform (community public): linkUp on ifIndex 7"
  if snmpinform -v 2c -c public -t 5 -r 2 "$PROBE" '' "$LINK_UP" "$IF_INDEX" i 7; then
    say "  acknowledged by the probe"
  else
    say "  not acknowledged: is the probe listening?"
    return 1
  fi
}

send_wrong_key() {
  say "SNMPv3 trap signed with a wrong authentication passphrase (user san-monitor): the probe refuses it"
  snmptrap -v 3 -e "$ENGINE_ID" -u san-monitor -l authPriv -a SHA -A not-the-passphrase \
    -x AES -X privpass123 "$PROBE" '' "$LINK_DOWN" "$IF_INDEX" i 7
}

send_inform_to() {
  if [ -z "${1:-}" ]; then
    say "Give the probe's SNMPv3 engine ID, as its page in OneUptime shows it."
    return 1
  fi

  say "SNMPv3 inform with the probe's engine ID given up front: $1"
  # shellcheck disable=SC2086
  if snmpinform -v 3 -t 5 -r 2 -e "0x$1" $SAN_MONITOR "$PROBE" '' "$LINK_UP" "$IF_INDEX" i 7; then
    say "  acknowledged by the probe"
  else
    say "  not acknowledged: is that the probe's engine ID?"
    return 1
  fi
}

case "${1:-all}" in
  trap) send_trap ;;
  trap-sha256) send_trap_sha256 ;;
  inform) send_inform ;;
  inform-v2c) send_inform_v2c ;;
  wrong-key) send_wrong_key ;;
  inform-to) send_inform_to "${2:-}" ;;
  all)
    send_trap
    send_trap_sha256
    send_inform
    send_inform_v2c
    ;;
  *)
    say "Usage: send-v3-traps [trap|trap-sha256|inform|inform-v2c|wrong-key|inform-to <engine id>|all]"
    exit 2
    ;;
esac
