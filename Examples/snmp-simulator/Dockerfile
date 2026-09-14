FROM python:3.11-alpine

# snmpsim serves the .snmprec snapshots over real SNMP (v1/v2c/v3).
# net-snmp-tools provides snmpwalk/snmpget/snmptrap for poking the agent
# and for sending test traps to the OneUptime probe.
RUN pip install --no-cache-dir snmpsim-lextudio && \
    apk add --no-cache net-snmp-tools && \
    adduser -D snmpsim

EXPOSE 161/udp

CMD ["snmpsim-command-responder", \
     "--data-dir=/data", \
     "--cache-dir=/tmp/snmpsim-cache", \
     "--agent-udpv4-endpoint=0.0.0.0:161", \
     "--process-user=snmpsim", \
     "--process-group=snmpsim"]
