# Flow export fixtures

Each `.hex` file holds the UDP datagrams one real flow exporter sent, one
datagram per line, in the order they arrived. `RealExporterFixtures.test.ts`
decodes them with the probe's collector.

| File                          | Exporter                     | Format                              |
| ----------------------------- | ---------------------------- | ----------------------------------- |
| `softflowd-v5.hex`            | softflowd 1.1.0              | NetFlow v5                          |
| `softflowd-v9.hex`            | softflowd 1.1.0              | NetFlow v9                          |
| `softflowd-v9-sampled.hex`    | softflowd 1.1.0 (`-s 2`)     | NetFlow v9, sampling in an option record scoped to an interface |
| `softflowd-ipfix.hex`         | softflowd 1.1.0              | IPFIX, uptimes plus the boot time in an option record |
| `softflowd-ipfix-sampled.hex` | softflowd 1.1.0 (`-s 2`)     | IPFIX, packet interval and space in an option record |
| `pmacct-v9-sampled.hex`       | pmacct 1.7.7 nfprobe         | NetFlow v9, absolute timestamps, a sampler option record that flow records name |
| `pmacct-ipfix-sampled.hex`    | pmacct 1.7.7 nfprobe         | IPFIX, the same with a selector     |
| `pmacct-sflow.hex`            | pmacct 1.7.7 sfprobe         | sFlow v5, one sample per packet     |
| `pmacct-sflow-sampled.hex`    | pmacct 1.7.7 sfprobe (`sampling_rate: 4`) | sFlow v5, 1 in 4 sampling |

The traffic is invented: `Generate/make-pcap.js` writes a short capture of
HTTPS, DNS, IPv6 HTTPS, ICMP, a VLAN-tagged UDP stream and SSH between
documentation and private addresses, and `Generate/run-exporters.sh` feeds it
to each exporter in a Debian bookworm container and records what they send
(`Generate/capture.js`):

```bash
docker run --rm -v "<Generate>:/scripts:ro" -v "<output>:/out" \
  node:26-bookworm-slim bash /scripts/run-exporters.sh
```

Every address, port, protocol, byte count, packet count and interface the
probe decodes from these files was checked against goflow2 v2.2.3 decoding the
same datagrams. Where the two differ, the probe is right and goflow2 does not
read the field:

- the IPFIX packet interval and space softflowd uses for `-s 2`
  (samplingPacketInterval / samplingPacketSpace) - goflow2 reports 1 in 1;
- pmacct's v9 flowStartMilliseconds / flowEndMilliseconds - goflow2 falls
  back to the export time.

softflowd reading a capture file stamps flows with uptimes from the file and
exports them with its own, later, clock; the probe clamps such flow times to
the export time, as it does for any device whose clock runs ahead.
