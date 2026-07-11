# SNMP Network Device Simulator

Test OneUptime's Network Device monitoring (device pages, interface stats,
bandwidth/utilization charts, LLDP topology, discovery scans, traps, and
SNMPv3) without owning any managed switches or routers.

The OneUptime probe polls devices over plain SNMP (UDP/161), so anything that
answers SNMP works as a "device". This compose file starts three:

| Container   | IP              | What it is                                                        | Credentials                                             |
| ----------- | --------------- | ----------------------------------------------------------------- | ------------------------------------------------------- |
| `switch-a`  | `172.30.99.11`  | snmpsim replaying a fake 3-port switch (LLDP, live counters)       | v2c, community `public`                                  |
| `switch-b`  | `172.30.99.12`  | Same, LLDP-adjacent to `switch-a` (renders a topology edge)        | v2c, community `public`                                  |
| `router-v3` | `172.30.99.13`  | Real `snmpd` agent, for exercising the SNMPv3 code path            | v3 user `oneuptime`, authPriv, SHA `authpass123`, AES `privpass123` (also v2c `public`) |

What the fake switches serve:

- System group (`sysDescr`, `sysName`, etc.)
- `ifTable` + `ifXTable` for 3 gigabit ports, with octet/error counters that
  grow in real time (via snmpsim's `numeric` variation module), so interface
  bandwidth, utilization and errors-per-second get real values after two polls.
- `switch-a` port Gi0/3 is operationally down (tests interfaces-down counts and
  the "interface is down" alert criteria).
- LLDP `lldpRemTable`: `switch-a` and `switch-b` see each other on Gi0/2, and
  `switch-a` also sees an unregistered `core-router` (shows up as an unmanaged
  node on the Topology page).
- `hrProcessorLoad` (`1.3.6.1.2.1.25.3.3.1.2.1`) oscillating slowly between
  10-90%, handy for testing custom-OID alert criteria.

## Quick start

```bash
cd Examples/snmp-simulator
docker compose up -d --build
```

Sanity check (optional):

```bash
docker run --rm --network oneuptime-snmp-simulator_snmpsim \
  oneuptime-snmp-simulator:local \
  snmpwalk -v2c -c public 172.30.99.11 1.3.6.1.2.1.2.2.1.2
```

The probe container runs with `network_mode: host`, so it reaches these
container IPs directly - no port publishing needed. (If you run the probe as a
plain Node process on macOS instead of in Docker, the bridge IPs are not
reachable from the host; publish each container's `161/udp` on distinct host
ports and use `127.0.0.1` + that port as the device address instead.)

## Wire it into OneUptime

1. **Register devices** - Dashboard -> Network Devices -> add:
   - `switch-a`: hostname `172.30.99.11`, SNMP v2c, community `public`, port 161, pick your probe.
   - `switch-b`: hostname `172.30.99.12`, same settings.
   - `router-v3`: hostname `172.30.99.13`, SNMP v3, user `oneuptime`,
     security level authPriv, auth SHA / `authpass123`, priv AES / `privpass123`.
2. **Create monitors** - one "Network Device" monitor per device, with
   interface monitoring enabled. After the first poll the device shows
   `sysName`/`sysDescr` and its interfaces; after the second poll the
   bandwidth/utilization/error charts have data (rates are computed from the
   counter delta between two polls).
3. **Topology** - once both switches have been polled, the Topology page shows
   `switch-a <-> switch-b` (mutual LLDP adjacency, matched by sysName) plus an
   unmanaged `core-router` node hanging off `switch-a`.
4. **Discovery** - run a discovery scan with CIDR `172.30.99.0/28`, v2c,
   community `public`. It should find all three devices (and offer to import
   the unregistered ones).
5. **Traps** - the probe listens on UDP/162. Send a linkDown trap *from* a
   device container so the source IP matches the registered hostname:

   ```bash
   docker compose exec switch-a snmptrap -v 2c -c public 172.30.99.1:162 '' \
     1.3.6.1.6.3.1.1.5.3 1.3.6.1.2.1.2.2.1.1 i 3
   ```

   (`172.30.99.1` is this bridge network's gateway, i.e. the host where the
   host-networked probe is listening.)

## Simulating your own devices

Each device is a directory under `data/` mounted into an snmpsim container.
The file `public.snmprec` is the recording; the **file name is the community
string**. Format is one `OID|type|value` record per line:

- Records must stay **sorted in ascending OID order**, and the format does
  **not** allow comment lines.
- Types: 2=Integer, 4=OctetString, `4x`=hex OctetString, 6=OID, 65=Counter32,
  66=Gauge32, 67=TimeTicks, 70=Counter64.
- `type:numeric|rate=N` makes a value grow by N per second (add `wrap=1` on
  Counter32 so it wraps at 2^32 like real hardware).
  `function=sin,scale=40,offset=50,rate=0.01` gives a slow 10-90 oscillation.
  Functions come from Python's `math` module.

To add a device: copy a `data/` directory, change `sysName`, add a service
with a new static IP in `docker-compose.yml`, and (optionally) add mutual
`lldpRemTable` rows so the Topology page links it - each device's
`lldpRemSysName` (`1.0.8802.1.1.2.1.4.1.1.9.<timeMark>.<localPort>.<idx>`)
must equal the *other* device's `sysName`.

You can also replay a snapshot of any real device: `snmpsim-record-commands`
(or `snmpwalk`-format files dropped into `data/`) turn a real agent into a
recording.

## Note on SNMPv3 and snmpsim

snmpsim selects the recording by SNMPv3 *context name*, but the OneUptime
probe (like most pollers) sends an empty context - so v3 against the snmpsim
switches times out. That is why `router-v3` exists: it is a real net-snmp
agent and answers v3 with the default context. Use v2c for the snmpsim
switches and `router-v3` for the v3 path.

## Heavier alternatives

If you ever need realistic control-plane behaviour (real LLDP negotiation,
vendor MIBs, config changes propagating):

- **containerlab** - spins up real NOS containers (Nokia SR Linux, Arista
  cEOS, FRR/Linux with `lldpd`) wired with veth pairs, so LLDP is genuinely
  negotiated. Heavier, but the closest thing to a rack of real switches.
- **GNS3 / EVE-NG** - full network emulators; needed if you specifically want
  Cisco IOS images (bring your own licensed images).

For testing OneUptime's pipeline (walks, rates, topology, traps, discovery),
the snmpsim setup above covers everything the probe actually reads.
