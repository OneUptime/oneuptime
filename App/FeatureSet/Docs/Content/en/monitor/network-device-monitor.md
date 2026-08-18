# Network Device Monitor

Network Device monitoring lets you monitor switches, routers, firewalls, access points, and other SNMP-capable network infrastructure.

The split of responsibilities is simple:

- **The device collects.** A registered Network Device is polled by its assigned probe on the device's own schedule — no monitor required. Each poll fills in the device's identity and inventory, walks its interfaces, collects topology neighbors and (optionally) attached endpoints, and records health metrics.
- **The monitor alerts.** A Network Device monitor references a registered device and evaluates criteria against every poll result and incoming trap — reachability, interface problems, OID thresholds, trap OIDs. Create one when you want incidents and alerts; skip it if you only want inventory, charts, and the topology map.

## Overview

The Network Devices product is made up of:

- **Device inventory** — register each device once with its hostname, SNMP credentials, and polling settings. The assigned probe polls it on schedule and OneUptime enriches the record with the device's system identity (name, description, location, vendor, model, serial number), interfaces, and health metrics.
- **Network discovery** — sweep a subnet (CIDR) or an octet range (`10.16-22.0-255.51-66`) for SNMP devices from a probe and import the responders in bulk. Imported devices start getting polled immediately.
- **Network Device monitors** — the alerting layer: evaluate each device poll and trap against criteria and open incidents or alerts.
- **SNMP traps** — probes run a trap receiver, so link-down events raise incidents in seconds instead of waiting for the next poll.
- **Topology view** — a live network map built from LLDP neighbor data, complemented by CDP on Cisco estates.

## Registering a Network Device

1. Go to **Network** -> **Devices** in the OneUptime Dashboard
2. Click **Create Network Device**
3. Configure the device as described below

Once registered, the device is polled by the probe you assigned — within a couple of minutes its Overview page fills in with system identity, interfaces, and health data.

### Basic Settings

| Field        | Description                                                                  | Required |
| ------------ | ---------------------------------------------------------------------------- | -------- |
| Name         | A friendly name for the device (e.g., core-switch-01)                        | Yes      |
| Hostname     | IP address or hostname the probe will poll via SNMP                          | Yes      |
| Probe        | Which probe polls this device (also receives its traps, syslog, and NetFlow) | Yes      |
| SNMP Version | Protocol version: V1, V2c, or V3                                             | Yes      |
| SNMP Port    | UDP port for SNMP queries (default: 161)                                     | No       |

### SNMP v1/v2c

For SNMP v1 and v2c, you only need a community string:

| Field                 | Description                                | Required |
| --------------------- | ------------------------------------------ | -------- |
| SNMP Community String | The SNMP community string (e.g., "public") | Yes      |

The community string is stored encrypted.

### SNMP v3

SNMPv3 provides authentication and encryption:

| Field                           | Description                                       | Required                     |
| ------------------------------- | ------------------------------------------------- | ---------------------------- |
| SNMP v3 Security Level          | No Auth No Priv, Auth No Priv, or Auth Priv       | Yes                          |
| SNMP v3 Username                | The security name (user) configured on the device | Yes                          |
| SNMP v3 Authentication Protocol | MD5, SHA, SHA-256, or SHA-512                     | If Auth No Priv or Auth Priv |
| SNMP v3 Authentication Key      | Authentication password (stored encrypted)        | If Auth No Priv or Auth Priv |
| SNMP v3 Privacy Protocol        | DES, AES, or AES-256                              | If Auth Priv                 |
| SNMP v3 Privacy Key             | Privacy/encryption password (stored encrypted)    | If Auth Priv                 |

## Polling & Data Collection

Polling settings live on the device (Device → **Settings** → **Polling & Data Collection**). Defaults are sensible, so a freshly registered device needs no tuning:

| Setting                     | Description                                                                                                                                                               | Default |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Polling Enabled             | The assigned probe polls this device on the schedule below. Disable to pause polling without deleting the device.                                                         | On      |
| Polling Interval (Minutes)  | How often the probe polls the device. Minimum 1 minute.                                                                                                                   | 5       |
| Walk Interfaces             | Walk the interface tables (IF-MIB) on each poll — per-interface status, bandwidth, utilization, and errors — plus LLDP/CDP neighbors for the topology map.                | On      |
| Collect Connected Endpoints | Also walk the device's ARP and bridge-forwarding tables to discover endpoints attached to it (POS terminals, printers, phones, laptops). Costs extra SNMP walks per poll. | Off     |
| Health OIDs                 | SNMP OIDs (CPU, memory, temperature, or any custom OID) collected on each poll and recorded as device metrics.                                                            | None    |

### Interface Walking

With **Walk Interfaces** on (the default), every poll tracks per interface:

- Operational and administrative status
- Bandwidth in/out and link utilization
- Errors and discards per second

Individual interfaces can be muted from the device's **Interfaces** tab — useful for lab ports or intentionally unplugged links. Muted interfaces stay in the inventory but are excluded from alerting and metrics. Interface walking is also what collects LLDP/CDP neighbor data for the topology view.

### Vendor Health Templates

In the **Health OIDs** editor, the **Vendor Health Template** dropdown applies a prebuilt set of CPU, memory, and temperature OIDs for your device's vendor:

- Cisco IOS / IOS-XE
- MikroTik RouterOS
- Ubiquiti EdgeOS / UniFi
- Generic (Host Resources MIB)

The template's OIDs are added to the OID list below the dropdown, where you can prune or extend them. After the first poll identifies the device's vendor, the device page suggests the matching template.

### Custom OIDs

Add any OIDs you want collected on every poll. For each OID you can specify:

| Field       | Description                                  | Required |
| ----------- | -------------------------------------------- | -------- |
| OID         | The numeric OID (e.g., 1.3.6.1.2.1.1.1.0)    | Yes      |
| Name        | A friendly name for the OID (e.g., sysDescr) | No       |
| Description | A description of what this OID represents    | No       |

Collected values are charted on the device's **Metrics** tab and can be alerted on through monitor criteria (**SNMP OID Value**).

### Device Identity

After the first successful poll, OneUptime reads the SNMPv2 system group and (where supported) the ENTITY-MIB, and fills in the device record automatically: system name, description, location, contact, uptime, vendor, model, serial number, and firmware version. The vendor's registered enterprise OID (`sysObjectId`) is used as the device fingerprint to derive the vendor name and suggest a matching vendor OID template.

## Discovering Devices with a Network Scan

Instead of registering devices one at a time, you can sweep a range of addresses:

1. Go to **Network** -> **Discovery** -> **Discovery Scans**
2. Click **Create Discovery Scan**
3. Configure the scan:

| Field            | Description                                                                                                                         | Required |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Scan Target      | The address space to scan, in [CIDR or octet-range notation](#scan-target-notation)                                                 | Yes      |
| Probe            | Which probe should run the sweep                                                                                                    | Yes      |
| SNMP credentials | Same fields as device registration (v1/v2c community string, or the full v3 credential set) — tried against every host in the range | Yes      |

4. The scan runs from the selected probe and reports how many hosts were scanned and how many responded to SNMP
5. Click **Review Results** on a completed scan, select the devices you want, and click **Import Selected**

### Scan Target Notation

The scan target accepts two notations. Both are IPv4-only.

**CIDR** — a contiguous subnet:

```
192.168.1.0/24
10.0.5.0/28
```

The network and broadcast addresses are skipped, so a `/24` sweeps 254 hosts. `/31` and `/32` have no network or broadcast address to skip, so every address in them is scanned.

**Octet range** — any of the four octets may be an inclusive `low-high` range instead of a single number:

```
10.16-22.0-255.51-66
10.48-50.0-255.51-66
192.168.1.10-40
10.0.0.5
```

Every address in the resulting product is scanned; nothing is treated as a network or broadcast address, because there is no prefix length from which one could be derived. `10.0.0.0-255` therefore includes `10.0.0.0` and `10.0.0.255`.

Octet ranges exist for networks that are not shaped like CIDR blocks. `10.16-22.0-255.51-66` sweeps `.51` through `.66` in every `/24` from `10.16` to `10.22` — 28,672 addresses. Expressing the same thing in CIDR takes 1,792 separate scans, and the smallest CIDR block that contains it (`10.16.0.0/13`) is 512k addresses, 98% of which are not worth probing.

Rules:

- Each octet is a number from 0 to 255, or a range whose lower bound comes first. `10.22-16.0.1` is rejected as a reversed range rather than quietly scanning nothing.
- A bare address (`10.0.0.5`) is a valid target that scans exactly that host.
- A single scan may cover at most **32,768 addresses**. Larger targets are rejected when you save the scan — split them into several scans, or narrow the ranges.

Targets are validated when the scan is created, so a typo is reported on the form rather than minutes later as a failed scan.

Imported devices are created with the responding IP as the hostname, the device's reported system name as the display name, and the scan's probe and SNMP credentials — so a v3 scan imports ready-to-poll v3 devices that start getting polled immediately. Devices that are already registered are flagged and skipped.

## Creating a Network Device Monitor

A monitor is only needed for alerting — the device is already being polled and inventoried without one.

The quickest path: open the device's page and click **Create Monitor** on the "Monitors alerting on this device" card. The monitor create form opens with the Network Device type and the device pre-selected, and the [Recommended Alert Pack](#recommended-alert-pack) criteria pre-filled — review, adjust severities and on-call policies, and save.

Or by hand:

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Network Device** as the monitor type
4. Pick the registered **Network Device** to alert on — everything about data collection (hostname, credentials, polling schedule, interface walks, health OIDs) comes from the device; the monitor only chooses what to alert on via its criteria

Network Device monitors have no polling interval of their own: they are evaluated server-side every time the device's poll results arrive, and every time a matching trap arrives.

## Monitoring Criteria

You can set up criteria to check poll results and trigger alerts or incidents.

### Available Filter Types

| Filter Type                        | Description                                                            |
| ---------------------------------- | ---------------------------------------------------------------------- |
| SNMP Device Is Online              | Check if the device responds to SNMP queries                           |
| SNMP Response Time (in ms)         | Check the query response time in milliseconds                          |
| SNMP OID Value                     | Check the value returned by a specific OID                             |
| SNMP OID Exists                    | Check if an OID returns a value (not null)                             |
| SNMP Interface Is Down             | True when any administratively-enabled interface is operationally down |
| SNMP Interface Utilization (in %)  | Check the busiest interface's link utilization                         |
| SNMP Interface Errors (per second) | Check the worst interface's error rate                                 |
| SNMP Trap Received (Trap OID)      | Matches when a trap with the given OID arrives from the device         |

The interface checks require **Walk Interfaces** to be on in the device's polling settings (it is by default). The OID checks evaluate the device's configured **Health OIDs**. Administratively disabled interfaces are intentionally down and never count as failures.

### Recommended Alert Pack

Click **Add Recommended Alerts** on the criteria form to append a prebuilt set of criteria — the alerts most network operators want, without hand-building them each time (these are pre-filled automatically when you create the monitor from the device's page):

| Criteria            | Fires when                                                    | Creates  |
| ------------------- | ------------------------------------------------------------- | -------- |
| Device unreachable  | The device stops answering SNMP                               | Incident |
| Interface down      | An administratively-enabled interface goes operationally down | Incident |
| Interface saturated | An interface runs above 80% utilization                       | Alert    |
| Interface errors    | An interface logs more than 1 error per second                | Alert    |

After applying the pack, pick severities and on-call policies for each criteria as usual — the thresholds are editable like any hand-built criteria.

## SNMP Traps

Polling catches problems on the next poll; traps catch them in seconds. Every probe runs an SNMP trap receiver that listens for v1 and v2c traps/informs and forwards them to your OneUptime instance.

### Enabling the Trap Receiver

The receiver is on by default and listens on UDP port 162. Configure it on the probe with environment variables:

| Environment Variable                  | Description                                    | Default |
| ------------------------------------- | ---------------------------------------------- | ------- |
| PROBE_SNMP_TRAP_RECEIVER_ENABLED      | Set to `false` to turn the trap receiver off   | true    |
| PROBE_SNMP_TRAP_RECEIVER_PORT         | UDP port the receiver binds                    | 162     |
| PROBE_SNMP_TRAP_RATE_LIMIT_PER_MINUTE | Max traps forwarded per minute before dropping | 300     |

If the probe runs in Docker, publish the UDP port so traps can reach it:

```bash
docker run ... -p 162:162/udp oneuptime/probe
```

Outside Docker, binding ports below 1024 requires elevated privileges — either run the probe with those privileges or set `PROBE_SNMP_TRAP_RECEIVER_PORT` to a port above 1024 (and configure your devices to send traps to that port). A failed bind is logged and never affects polling.

Then point your devices' trap destination at the probe, for example on Cisco IOS:

```
snmp-server host <probe-ip> traps version 2c <community>
```

### How Traps Map to Monitors

Traps are matched through the device inventory:

1. A trap arrives at a probe's receiver and is forwarded to OneUptime
2. OneUptime looks up registered Network Devices assigned to that probe whose **hostname equals the trap's source IP address**
3. The trap is logged to the device's trap history, and every Network Device monitor that references a matching device evaluates the trap against its criteria — typically an **SNMP Trap Received (Trap OID)** filter

For matching to work, register the device with the IP address it sends traps from. SNMPv1 generic traps (coldStart, linkDown, linkUp, ...) are normalized to their standard SNMPv2 notification OIDs — for example, linkDown matches trap OID `1.3.6.1.6.3.1.1.5.3` regardless of SNMP version.

#### Example: raise an incident on linkDown

- **Filter Type**: SNMP Trap Received (Trap OID)
- **Filter Condition**: Equal To
- **Value**: 1.3.6.1.6.3.1.1.5.3

The filter also supports Contains / Starts With / Ends With, so a single criteria can match a family of enterprise traps by OID prefix.

## Template Variables for Alerts

When creating incident or alert templates, you can use the following variables:

| Variable                   | Description                                                                  |
| -------------------------- | ---------------------------------------------------------------------------- |
| `{{isOnline}}`             | Whether the device is online (true/false)                                    |
| `{{responseTimeInMs}}`     | Query response time in milliseconds                                          |
| `{{failureCause}}`         | Error message if the query failed                                            |
| `{{oidResponses}}`         | Array of OID response objects                                                |
| `{{OID_NAME}}`             | Value of a specific OID by name (e.g., `{{sysUpTime}}`)                      |
| `{{sysName}}`              | Device name from the SNMP system group                                       |
| `{{sysDescr}}`             | Device description from the SNMP system group                                |
| `{{sysObjectId}}`          | Vendor's registered enterprise OID (device fingerprint)                      |
| `{{sysLocation}}`          | Device location from the SNMP system group                                   |
| `{{downInterfaces}}`       | Array of {name, alias, interfaceIndex} for admin-up but oper-down interfaces |
| `{{interfacesTotal}}`      | Total number of interfaces walked                                            |
| `{{interfacesUp}}`         | Interfaces that are administratively and operationally up                    |
| `{{interfacesDown}}`       | Interfaces that are administratively up but operationally down               |
| `{{interfaceWalkFailure}}` | Error message when the interface walk failed                                 |
| `{{trapOid}}`              | Trap OID — set on trap-triggered checks only                                 |
| `{{trapSourceIp}}`         | Source IP the trap came from — set on trap-triggered checks only             |
| `{{trapVarbinds}}`         | Array of {oid, value} varbinds carried by the trap                           |

The interface and system variables require interface walking to be enabled on the device; the trap variables are only set when the check was triggered by a trap. So an incident title like:

```
{{downInterfaces.0.name}} on {{sysName}} is down
```

renders as "Gi0/1 on core-switch-01 is down". See [Incident & Alert Templating](/docs/monitor/incident-alert-templating) for how templating works in general.

## Network Topology

Go to **Network** -> **Network Map** -> **Topology** for a live map of your network, built from LLDP neighbor data collected during interface walks and complemented by CDP on Cisco estates. Managed devices are filled; unmanaged LLDP peers are hollow. Node color reflects device status, and clicking a managed device opens it.

For the map to populate:

- Keep **Walk Interfaces** on in the device's polling settings — the neighbor tables are walked alongside the interfaces
- Enable LLDP (or CDP on Cisco devices) on the devices themselves

## Troubleshooting

### Device not responding

- Verify the device IP/hostname is correct
- Check that SNMP is enabled on the device
- Verify firewall rules allow UDP port 161 from the probe
- Confirm the community string is correct
- Confirm **Polling Enabled** is on in the device's settings and the assigned probe is connected

### Authentication failures (v3)

- Verify username, auth protocol, and auth key
- Ensure the security level matches the device configuration
- Check that priv protocol and key are correct for the Auth Priv level

### Interfaces not showing

- Confirm **Walk Interfaces** is on in the device's polling settings
- Check the `{{interfaceWalkFailure}}` template variable / monitor logs — the device may restrict the IF-MIB subtree for your credentials

### Traps not arriving

- Publish/allow UDP port 162 through to the probe (or the custom `PROBE_SNMP_TRAP_RECEIVER_PORT`)
- Confirm the device's registered hostname is the IP address it sends traps from — that is how traps are matched to devices
- Check the probe logs for bind errors (port in use, or missing privileges for ports below 1024)

### Testing SNMP Connectivity

Before registering a device, you can test SNMP connectivity using command-line tools:

```bash
# SNMP v2c
snmpget -v2c -c public 192.168.1.1 1.3.6.1.2.1.1.1.0

# SNMP v3 (authPriv)
snmpget -v3 -u username -l authPriv -a SHA -A authpassword -x AES -X privpassword 192.168.1.1 1.3.6.1.2.1.1.1.0
```

## Best Practices

1. **Use SNMPv3 when possible** - It provides authentication and encryption for better security
2. **Discover, then import** - A discovery scan is faster and less error-prone than registering devices by hand
3. **Register devices by the IP they send traps from** - Trap-to-monitor matching is by source IP
4. **Create monitors from the device page** - The type, device, and recommended alert pack come pre-filled
5. **Keep interface walking on for switches and routers** - It powers interface alerts, utilization data, and the topology map
6. **Use descriptive OID names** - Makes alert messages and template variables easier to read
