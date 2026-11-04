#!/usr/bin/env bash
#
# One member of an OVN Raft cluster, for control-plane-clusters.sh, in its own container.
#
#   create <address>            the member that makes the cluster, with its Northbound and
#                               Southbound databases, and an ovn-northd
#   join <address> <first>      a member that joins the cluster the one at <first> made
#   start                       a member's databases again, after stop
#   stop                        kills its databases, without a word to the others
#   exporter                    openstack-network-exporter, reading this member's sockets
#
# OVN_MEMBERS holds every member's address, for ovn-northd. The paths are the ones
# Kolla-Ansible's containers share as /run/ovn, which is where the exporter looks for these
# sockets by default.

set -euo pipefail

ACTION="$1"
ADDRESS="${2:-}"
FIRST="${3:-}"
DATA=/var/lib/ovn
RUN=/run/ovn
mkdir -p "$DATA" "$RUN"

start_databases() {
  ovsdb-server --detach --no-chdir --log-file=/var/log/ovnnb.log \
    --pidfile="$RUN/ovnnb_db.pid" --unixctl="$RUN/ovnnb_db.ctl" \
    --remote="punix:$RUN/ovnnb_db.sock" --remote=ptcp:6641 "$DATA/ovnnb_db.db"
  ovsdb-server --detach --no-chdir --log-file=/var/log/ovnsb.log \
    --pidfile="$RUN/ovnsb_db.pid" --unixctl="$RUN/ovnsb_db.ctl" \
    --remote="punix:$RUN/ovnsb_db.sock" --remote=ptcp:6642 "$DATA/ovnsb_db.db"
}

remotes() {
  local port="$1" member list=""
  for member in ${OVN_MEMBERS:-}; do
    list="$list,tcp:$member:$port"
  done
  printf '%s' "${list#,}"
}

start_northd() {
  ovn-northd --detach --no-chdir --log-file=/var/log/ovn-northd.log \
    --pidfile="$RUN/ovn-northd.pid" \
    --ovnnb-db="$(remotes 6641)" \
    --ovnsb-db="$(remotes 6642)"
}

case "$ACTION" in
  create)
    ovsdb-tool create-cluster "$DATA/ovnnb_db.db" /usr/share/ovn/ovn-nb.ovsschema "tcp:$ADDRESS:6643"
    ovsdb-tool create-cluster "$DATA/ovnsb_db.db" /usr/share/ovn/ovn-sb.ovsschema "tcp:$ADDRESS:6644"
    start_databases
    start_northd
    ;;
  join)
    ovsdb-tool join-cluster "$DATA/ovnnb_db.db" OVN_Northbound "tcp:$ADDRESS:6643" "tcp:$FIRST:6643"
    ovsdb-tool join-cluster "$DATA/ovnsb_db.db" OVN_Southbound "tcp:$ADDRESS:6644" "tcp:$FIRST:6644"
    start_databases
    start_northd
    ;;
  start)
    start_databases
    ;;
  stop)
    pkill -9 -f "ovsdb-server.*ovn[ns]b_db" || true
    rm -f "$RUN/ovnnb_db.pid" "$RUN/ovnsb_db.pid" "$RUN/ovnnb_db.ctl" "$RUN/ovnsb_db.ctl"
    ;;
  exporter)
    # Only what a host of the databases has: no ovs-vswitchd or ovn-controller runs here.
    printf 'collectors: [ovsdbserver, ovnnorthd]\n' >/etc/openstack-network-exporter.yaml
    exec /usr/local/bin/openstack-network-exporter
    ;;
  *)
    echo "Unknown action $ACTION" >&2
    exit 2
    ;;
esac
