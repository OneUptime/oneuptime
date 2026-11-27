# SNMP Network Device Simulator

Test OneUptime's Network Device monitoring (device pages, interface stats,
bandwidth/utilization charts, LLDP topology, discovery scans, traps, and
SNMPv3) without owning any managed switches or routers.

The OneUptime probe polls devices over plain SNMP (UDP/161), so anything that
answers SNMP works as a "device". This compose file starts these:

| Container   | IP              | What it is                                                        | Credentials                                             |
| ----------- | --------------- | ----------------------------------------------------------------- | ------------------------------------------------------- |
| `switch-a`  | `172.30.99.11`  | snmpsim replaying a fake 4-port switch (LLDP, FDB, ARP, live counters) | v2c, community `public`                                  |
| `switch-b`  | `172.30.99.12`  | Same, LLDP-adjacent to `switch-a` (renders a topology edge)        | v2c, community `public`                                  |
| `router-v3` | `172.30.99.13`  | Real `snmpd` agent, for exercising the SNMPv3 code path            | v3 user `oneuptime`, authPriv, SHA `authpass123`, AES `privpass123` (also v2c `public`) |
| `sophos-xgs` | `172.30.99.15` | snmpsim replaying a Sophos firewall (SFOS v21): IPsec tunnel table, CPU cores, memory/disk/HA | v2c, community `public` |
| `cambium-ap` | `172.30.99.16` | snmpsim replaying a Cambium Enterprise Wi-Fi access point: radio and SSID tables | v2c, community `public` |
| `brocade-g620` | `172.30.99.18` | snmpsim replaying a Brocade G620 SAN switch (Fabric OS 9.2) with Virtual Fabrics: Fibre Channel ports, optics, sensors, FRUs | Default logical switch: v2c `public`. Logical switch FID 20: v3 user `oneuptime`, authPriv, SHA `authpass123`, AES `privpass123`, context `VF:20` |
| `cisco-mds` | `172.30.99.19` | snmpsim replaying a Cisco MDS 9396S SAN switch (NX-OS 9.4): fc interfaces, VSANs, FRUs, optics | v2c, community `public` |
| `san-switch-v3` | `172.30.99.17` | A SAN switch that sends SNMPv3 traps and informs (Net-SNMP's `snmptrap` and `snmpinform`); it answers no polls | v3 users `san-monitor` (authPriv, SHA `authpass123`, AES `privpass123`) and `fabric-monitor` (authPriv, SHA-256 `fabricauth123`, AES-256 `fabricpriv123`) |

What the fake switches serve:

- System group (`sysDescr`, `sysName`, etc.)
- `ifTable` + `ifXTable` for 3 gigabit ports (4 on `switch-a`), with
  octet/error counters that grow in real time (via snmpsim's `numeric`
  variation module), so interface bandwidth, utilization and errors-per-second
  get real values after two polls.
- `switch-a` port Gi0/3 is operationally down (tests interfaces-down counts and
  the "interface is down" alert criteria).
- LLDP `lldpRemTable`: `switch-a` and `switch-b` see each other on Gi0/2, and
  `switch-a` also sees an unregistered `core-router` (shows up as an unmanaged
  node on the Topology page).
- LLDP `lldpRemManAddrTable`: each of those neighbours also advertises a
  management address (`core-router` at `172.30.99.20`, `switch-b` at its own
  `172.30.99.12`). This is what lets the Topology page's "Add to Monitoring"
  action pre-fill a hostname instead of leaving the operator to find one.
- CDP `cdpCacheTable`: `switch-a` sees a Cisco IP phone, `SEP0011AA22BB33`
  (platform `Cisco IP Phone 8811`, address `172.30.99.21`), on Gi0/3 - a leaf
  device that speaks CDP and not LLDP, drawn as an unmanaged phone node.
  Nothing answers at that address, which is the point: it is a device the
  network reports and nobody is monitoring.
- `hrProcessorLoad` (`1.3.6.1.2.1.25.3.3.1.2.1`) oscillating slowly between
  10-90%, handy for testing custom-OID alert criteria.
- On `switch-a` only, the two tables endpoint collection reads: a BRIDGE-MIB
  forwarding database (`dot1dTpFdbTable` + `dot1dBasePortTable`) and an ARP
  cache (`ipNetToMediaTable`). Together they say a MAC `02:cc:00:00:00:13`
  answering at `172.30.99.14` was learned on access port `Gi0/4` - a
  register plugged into the switch. The forwarding database also lists
  `switch-b`'s chassis MAC on the uplink `Gi0/2`, which the server drops
  because LLDP says a switch is on that port. Nothing answers at
  `172.30.99.14`: a device registered there reads Down, and the attachment
  is drawn regardless, because it comes from the switch's tables and not
  from the device.

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
   `switch-a <-> switch-b` (mutual LLDP adjacency, matched by sysName) plus two
   unmanaged nodes hanging off `switch-a`: `core-router` (LLDP) and the IP
   phone `SEP0011AA22BB33` (CDP). Click either one: the drawer shows the
   address its neighbour advertised for it and offers **Add to Monitoring**,
   which opens the device create form pre-filled with that name, address, role
   and the site and probe `switch-a` uses.
4. **A ping-only device on its switch port** - register a device with
   **no** SNMP credentials at `172.30.99.14` (say `register-01`, role Host,
   same site as `switch-a` - or both with no site), and turn **Collect
   Connected Endpoints** on for `switch-a`. After `switch-a`'s next walk its
   ARP table fills in `register-01`'s MAC address, its forwarding table puts
   that MAC on `Gi0/4`, and the Topology page draws `switch-a -> register-01`
   as a learned (dashed) link with `register-01` beneath the switch in the
   Parent-Child view; the device's Overview page shows the same under
   **Connected to**. Nothing about `register-01` was typed but its address.
   The address must be registered on exactly one device in that site: two
   devices at one address are refused as ambiguous rather than guessed at.
5. **Discovery** - run a discovery scan with CIDR `172.30.99.0/28`, v2c,
   community `public`. It should find all three devices (and offer to import
   the unregistered ones).
6. **Traps** - the probe listens on UDP/162. Send a linkDown trap *from* a
   device container so the source IP matches the registered hostname:

   ```bash
   docker compose exec switch-a snmptrap -v 2c -c public 172.30.99.1:162 '' \
     1.3.6.1.6.3.1.1.5.3 1.3.6.1.2.1.2.2.1.1 i 3
   ```

   (`172.30.99.1` is this bridge network's gateway, i.e. the host where the
   host-networked probe is listening.)

   For SNMPv3 traps and informs, see the next section.

7. **SNMP tables and the Wi-Fi tab** - register `sophos-xgs`
   (`172.30.99.15`) and `cambium-ap` (`172.30.99.16`), v2c `public`, and turn
   on **Auto-Apply Vendor Health Template** (or pick the Sophos / Cambium
   vendor template under Settings -> SNMP Tables). After the next poll:
   - the firewall's **SNMP Tables** tab lists three IPsec tunnels -
     `HQ-Branch1` active, `HQ-Branch2` inactive and `HQ-Cloud` partially
     active, the last two marked unhealthy - and its CPU cores, numbered
     196608 and 196609 the way SFOS numbers them;
   - the access point's **Wi-Fi** tab shows the 2.4 GHz radio on channel 6
     (2437 MHz, 20 MHz wide, 14 dBm, 9 clients) and the 5 GHz radio on channel
     36 (5180 MHz, 80 MHz wide) switched off, plus the `Corp` and `Guest`
     SSIDs.

   A Network Device monitor with **SNMP Table Row Is Unhealthy** on the
   `ipsec_tunnels` table and Row `*` raises one incident for `HQ-Branch2` and
   one for `HQ-Cloud`. **Add Recommended Alerts** adds exactly that criteria.

8. **SAN switches** - register `brocade-g620` (`172.30.99.18`) and
   `cisco-mds` (`172.30.99.19`), v2c `public`, with **Auto-Apply Vendor
   Health Template** on. After the first poll:
   - the Brocade switch gets the **Brocade Fabric OS (SAN switches)**
     template: its **SNMP Tables** page shows the switch status (marginal:
     a fan has stopped), eight sensors and six FRUs by name, and its
     **Interfaces** page marks each Fibre Channel port E-Port or F-Port, says
     port 0/6 is down for "No light" and 0/7 is "Disabled", and lists the
     optics on the **Transceivers** card (0/6 receives no light at all);
   - the MDS gets the **Cisco MDS 9000 (SAN switches)** template, not the
     IOS one: power supplies (PowerSupply-2 has no input power), modules, fan
     trays and five VSANs. Its counters grow: from the second poll on, fc1/3
     takes CRC errors and invalid transmission words, about 8 a second, and
     fc1/5 loses credit and times frames out, the way a slow-draining host
     does. The **Fibre Channel Ports** card charts them per port, and the
     recommended alerts fire for both.

   For the Virtual Fabric, register `brocade-g620` a second time with SNMP
   v3 (user `oneuptime`, authPriv, SHA `authpass123`, AES `privpass123`) and
   **SNMP v3 Context** `VF:20`: it reads as logical switch
   `fabric-b-ls20`, with its own four ports 0/8 to 0/11.

## SNMPv3 traps and informs

`san-switch-v3` (`172.30.99.17`) is a SAN switch set up the way a locked-down
network sets one up: it sends SNMPv3 notifications only, authenticated and
encrypted. A probe takes an SNMPv3 trap only from a user of a device assigned
to it, so the device and its users go into OneUptime first.

1. **Start it** (the rest of the simulator can be running or not):

   ```bash
   docker compose up -d --build san-switch-v3
   ```

2. **Register the switch** - Network Devices -> add, hostname `172.30.99.17`,
   your probe, and under SNMP: version v3, user `san-monitor`, security level
   authPriv, authentication SHA with `authpass123`, privacy AES with
   `privpass123`. It answers no polls, so it reads Down; its traps arrive
   all the same.

3. **Give its site the second user** - the switch also sends as
   `fabric-monitor` (SHA-256 with `fabricauth123`, AES-256 with
   `fabricpriv123`). Save that as an SNMP Credential Profile and make it the
   default of the switch's site. A probe takes the SNMPv3 users of a device's
   own credentials, its credential profile and its site's default alike.

4. **Check the probe** - Monitors -> Settings -> Probes -> your probe: its
   **SNMP Traps** card says
   "2 users, from the devices on this probe" within a minute, and shows the
   probe's SNMPv3 engine ID.

5. **Send them**:

   ```bash
   docker compose exec san-switch-v3 send-v3-traps
   ```

   This sends an authPriv SHA / AES trap as `san-monitor`, an authPriv
   SHA-256 / AES-256 trap as `fabric-monitor`, an SNMPv3 inform and a v2c
   inform. `snmpinform` discovers the probe's engine ID by itself and prints
   "acknowledged by the probe" once the probe answers, which is what stops a
   device from sending it again. Each one shows on the switch's **Logs** and
   **Events** pages, as "SNMPv3 trap" with its user and "Authenticated and
   encrypted", and a Network Device monitor on the switch with
   **SNMP Trap Received (Trap OID)** Equal To `1.3.6.1.6.3.1.1.5.3` raises
   an incident, as it does for a v2c linkDown.

6. **See a refused one** - a trap signed with the wrong passphrase:

   ```bash
   docker compose exec san-switch-v3 send-v3-traps wrong-key
   ```

   Nothing reaches the switch's history. Within a minute the probe's
   **SNMP Traps** card says "1 SNMPv3 trap from 172.30.99.17 failed: wrong
   authentication passphrase or protocol for “san-monitor”", and the switch's
   Overview says the same, with what to change. The next trap the probe takes
   from the switch as `san-monitor` clears it.

7. **An inform with the engine ID given up front**, as Cisco IOS sends them
   (`snmp-server engineID remote`): copy the engine ID from the probe's page,
   then

   ```bash
   docker compose exec san-switch-v3 send-v3-traps inform-to <engine ID>
   ```

   A wrong one is refused as "informs from “san-monitor” sent to another
   engine ID than this probe's".

The probe listens on UDP 162; if yours listens elsewhere, set
`PROBE_TRAP_PORT` on the `san-switch-v3` service.

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

snmpsim selects the recording by SNMPv3 *context name*, and answers no v3
request in the default (empty) context. The OneUptime probe sends the
context the device names in **SNMP v3 Context**, and none otherwise - so v3
against an snmpsim switch works only with a context, as `brocade-g620`'s
`VF:20` does. That is why `router-v3` exists: it is a real net-snmp agent
and answers v3 in the default context. Use v2c for the other snmpsim
devices, a context for the Brocade logical switch, and `router-v3` for the
plain v3 path.

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
