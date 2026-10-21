#!/bin/bash
# Runs inside node:26-bookworm-slim with /scripts (read-only) and /out mounted.
set -u
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null 2>&1
apt-get install -y -qq softflowd pmacct >/dev/null 2>&1 || { echo "install failed"; exit 1; }
softflowd -h 2>&1 | head -60 > /out/softflowd-help.txt
pmacctd -V > /out/pmacct-version.txt 2>&1

node /scripts/make-pcap.js /out/traffic.pcap

run_softflowd() {
  local label=$1; shift
  node /scripts/capture.js /out "$label:2055" &
  local cap=$!
  sleep 1
  timeout 20 softflowd -d -r /out/traffic.pcap -n 127.0.0.1:2055 "$@" > "/out/$label.softflowd.log" 2>&1
  wait $cap
}

run_softflowd softflowd-v5 -v 5
run_softflowd softflowd-v9 -v 9
run_softflowd softflowd-ipfix -v 10
run_softflowd softflowd-v9-sampled -v 9 -s 2
run_softflowd softflowd-ipfix-sampled -v 10 -s 2

run_pmacct() {
  local label=$1; local port=$2; local conf=$3
  node /scripts/capture.js /out "$label:$port" &
  local cap=$!
  sleep 1
  timeout 25 pmacctd -f "$conf" > "/out/$label.pmacct.log" 2>&1
  wait $cap
}

cat > /tmp/sfprobe.conf <<EOF
daemonize: false
pcap_savefile: /out/traffic.pcap
pcap_savefile_wait: false
plugins: sfprobe
sfprobe_receiver: 127.0.0.1:6343
sfprobe_agentip: 192.0.2.10
sfprobe_agentsubid: 3
sampling_rate: 1
EOF
run_pmacct pmacct-sflow 6343 /tmp/sfprobe.conf

cat > /tmp/sfprobe-sampled.conf <<EOF
daemonize: false
pcap_savefile: /out/traffic.pcap
pcap_savefile_wait: false
plugins: sfprobe
sfprobe_receiver: 127.0.0.1:6343
sfprobe_agentip: 192.0.2.10
sampling_rate: 4
EOF
run_pmacct pmacct-sflow-sampled 6343 /tmp/sfprobe-sampled.conf

cat > /tmp/nfprobe-v9.conf <<EOF
daemonize: false
pcap_savefile: /out/traffic.pcap
pcap_savefile_wait: false
plugins: nfprobe
nfprobe_receiver: 127.0.0.1:2055
nfprobe_version: 9
nfprobe_timeouts: tcp=1:maxlife=2:expint=1
sampling_rate: 10
EOF
run_pmacct pmacct-v9-sampled 2055 /tmp/nfprobe-v9.conf

cat > /tmp/nfprobe-ipfix.conf <<EOF
daemonize: false
pcap_savefile: /out/traffic.pcap
pcap_savefile_wait: false
plugins: nfprobe
nfprobe_receiver: 127.0.0.1:4739
nfprobe_version: 10
nfprobe_timeouts: tcp=1:maxlife=2:expint=1
sampling_rate: 10
EOF
run_pmacct pmacct-ipfix-sampled 4739 /tmp/nfprobe-ipfix.conf

ls -la /out
