# Network Device Monitor

Network Device monitoring covers switches, routers, firewalls, access points, PDUs, cameras, printers — anything with an address on your network, whether or not it speaks SNMP.

Registering a device takes a name, an address, a site and a probe. From that moment the probe **pings** the device on its schedule and the device has an up/down status, appears on the network map and votes in its site's health rollup. Everything else is an upgrade on top of that same device:

- **Add SNMP credentials** — on the device, or by pointing it at a reusable credential profile, or by setting a default profile on its site — and the same probe starts **walking** it as well: interfaces, hardware inventory, LLDP/CDP neighbours, health OIDs.
- **Add a monitor** and the device's polls raise **incidents and alerts**. [Alert policies](#alert-policies) are where the same intent is written once for a whole set of devices.
- **Bind a monitor** on the device's Settings page as an **override**, for the rare device no probe can reach at all.

The split of responsibilities is worth stating plainly:

- **The device collects.** A registered Network Device is polled by its assigned probe on the device's own schedule — no monitor required. Every poll records reachability, ping round-trip time and packet loss; a poll with credentials also fills in system identity and inventory, walks interfaces, collects topology neighbours and (optionally) attached endpoints, and records health OIDs.
- **The monitor alerts.** A Network Device monitor references a registered device and evaluates criteria against every poll result and incoming trap — reachability, walk health, interface problems, OID thresholds, trap OIDs. Create one when you want incidents and alerts; skip it if you only want status, inventory, charts and the topology map.

## Overview

The Network Devices product is made up of:

- **Device inventory** — register each device once with its address, site, probe and (optionally) SNMP credentials. The assigned probe polls it on schedule, and OneUptime enriches the record with the device's system identity (name, description, location, vendor, model, serial number), interfaces and health metrics as soon as it has credentials to do so.
- **Network discovery** — sweep a subnet (CIDR) or an octet range (`10.16-22.0-255.51-66`) from a probe and import what answers, in bulk. A scan can ping the range only, or ping it and then probe the responders over SNMP — so a range you hold no SNMP credentials for is still worth sweeping. Everything imports as a probe-polled device and starts getting polled immediately.
- **SNMP credential profiles** — one named credential set that many devices and sites share, so rotating a community string is one edit rather than one per device.
- **Alert policies** — write down once what a whole *set* of devices should be alerted on, rather than per device. (Definitions ship now; the engine that turns them into monitors does not yet — see [Alert Policies](#alert-policies).)
- **Network Device monitors** — the alerting layer: evaluate each device poll and trap against criteria and open incidents or alerts.
- **SNMP traps** — probes run a trap receiver, so link-down events raise incidents in seconds instead of waiting for the next poll.
- **Topology view** — a live network map built from LLDP neighbour data, complemented by CDP on Cisco estates.

## Registering a Network Device

1. Go to **Network** -> **Devices** in the OneUptime Dashboard
2. Click **Create Network Device**
3. Fill in the device details, its probe and site, and — optionally — SNMP credentials

There is no "how is this device monitored?" question on the form. Every device you create is polled by its probe; the bound-monitor override lives on the device's **Settings** page for the few devices that need it.

Once registered, the device is pinged by the probe you assigned within a couple of minutes. If it has credentials, its Overview page also fills in with system identity, interfaces and health data on the first successful walk.

### Device Details

| Field       | Description                                                      | Required |
| ----------- | ---------------------------------------------------------------- | -------- |
| Name        | A friendly name for the device (e.g., core-switch-01)            | Yes      |
| Hostname    | IP address or hostname the probe pings, and walks over SNMP      | Yes      |
| Description | Free text                                                        | No       |
| Role        | Device role (core switch, access switch, firewall …) — drives topology tiering and alert-policy scoping | No |

### Probe & Site

| Field | Description                                                                                                                                                                          | Required |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Probe | Which probe pings this device, walks it over SNMP when it has credentials, and receives its traps, syslog and NetFlow. It must be able to reach the device directly — a probe on the public internet cannot reach a private address. | Yes      |
| Site  | The [Network Site](/docs/monitor/network-sites) the device sits in. The site's health rolls up from the devices in it.                                                                | No       |
| Also create a Ping monitor for incidents | The probe already pings the device and gives it a status; this is what turns failed pings into an **incident**. Tick it and a Ping monitor is created on the hostname above and bound to the device when you save. It counts towards your plan, and incidents are off on it until you turn them on from the monitor's page. | No |

The Probe field fills itself in where it can: a project with exactly one custom probe starts on that one, and picking a site replaces it with the [site's default probe](#site-monitoring-defaults). It never overwrites a probe you chose yourself. Set a default probe on your sites and a device can be added by name and address alone.

Ticking the Ping monitor opt-in reveals a **Ping from probes** field for the monitor's own probes — they have to be able to reach the device's network, and leaving it empty uses the project's default probes.

### SNMP (Optional)

**Leave this step empty and the device is pinged only.** It still has a status from its first poll, still sits in its site and on the map — it simply has no interfaces, inventory or health OIDs until credentials appear.

| Field                 | Description                                                        | Required                  |
| --------------------- | ------------------------------------------------------------------ | ------------------------- |
| SNMP Credential Profile | A reusable credential set to use instead of typing credentials here | No                      |
| SNMP Version          | Protocol version: V1, V2c, or V3                                    | Yes (defaulted to V2c)    |
| SNMP Port             | UDP port for SNMP queries (default: 161)                            | No                        |
| SNMP Community String | The v1/v2c community string (e.g., "public")                        | No — empty means ping only |

For SNMPv3, the security level decides which of the remaining fields are asked for:

| Field                           | Description                                       | Required                     |
| ------------------------------- | ------------------------------------------------- | ---------------------------- |
| SNMP v3 Security Level          | No Auth No Priv, Auth No Priv, or Auth Priv       | Yes                          |
| SNMP v3 Username                | The security name (user) configured on the device | Yes — empty means ping only  |
| SNMP v3 Authentication Protocol | MD5, SHA, SHA-256, or SHA-512                     | If Auth No Priv or Auth Priv |
| SNMP v3 Authentication Key      | Authentication password                           | If Auth No Priv or Auth Priv |
| SNMP v3 Privacy Protocol        | DES, AES, or AES-256                              | If Auth Priv                 |
| SNMP v3 Privacy Key             | Privacy/encryption password                       | If Auth Priv                 |

Credentials on a **credential profile** are encrypted at rest and readable only by the roles that may read a device's credentials. Credentials typed onto a device itself are guarded by the same read permissions, but are stored as ordinary columns rather than encrypted — one more reason to keep shared credentials on a profile.

## What a Poll Actually Does

Every poll of a probe-polled device is a **ping**. When the device has usable SNMP credentials, the probe also runs a **full SNMP walk** — the two run in parallel, and the walk is never gated on the ping answering, so SNMP gear behind an ICMP-filtering ACL still reports Up.

What each poll writes back:

| | Ping-only device | Device with SNMP credentials |
| --- | --- | --- |
| Status (Up / Down) | From the ping | From the ping **or** the walk — either answering is enough |
| Ping round-trip time and packet loss | Recorded as device metrics | Recorded as device metrics |
| SNMP response time | — | The walk's time (never the ping's RTT) |
| Interfaces, neighbours, endpoints | — | From a successful walk |
| System identity, vendor, model, serial | — | From a successful walk |
| Health OIDs | — | From a successful walk |

"Usable credentials" means a v1/v2c set with a **non-empty community string**, or a v3 set with a **non-empty username** — resolved through the [credential chain](#snmp-credentials-and-credential-profiles). An empty credential set is skipped, not used, so a device never gets walked with a guessed default community.

Ping round-trip time and packet loss are recorded as device metrics on every poll. Packet loss reuses the [Ping monitor](/docs/monitor/ping-monitor)'s series so the vocabulary is the same across the product; round-trip time gets a series of its own (`oneuptime.monitor.ping.round.trip.time`), because on a Network Device the plain "response time" is the SNMP walk's. The device's **Metrics** tab charts interface utilization and polled health OIDs; the ping series are recorded alongside them but are not drawn on that tab yet.

### "SNMP failing" is not "Down"

A device that answers ping but whose walk fails is **Up**, tagged **SNMP failing**. That is a deliberate distinction, and both halves matter:

- It is **Up** because it is: something is answering at that address. Painting it red would put a device that is running fine into your incident count.
- It is **SNMP failing** because its interfaces, inventory and health OIDs have stopped refreshing — almost always credentials, a disabled SNMP agent, or an ACL. Nothing else on the page would tell you that the numbers you are looking at are frozen.

A device whose ping **and** walk both fail is simply Down. The "SNMP failing" tag can only ever sit beside a green pill.

### Reading a device's status

Every surface that shows a device — the Devices list, a site's Devices tab, the Overview hero, the map — uses the same three verdicts and the same qualifiers beside them.

| Verdict | Means |
| ------- | ----- |
| **Up** | The last poll (ping or SNMP), or the bound monitor, reached the device |
| **Down** | The last poll (ping or SNMP), or the bound monitor, could not reach the device |
| **Pending** | No verdict yet — never polled, no probe assigned, or no monitor bound |

| Qualifier | Shown when | What to do |
| --------- | ---------- | ---------- |
| **Stale** | No poll has been attempted for well over the device's interval | Check the device's probe is online and keeping up with its fleet — this qualifies the verdict, it does not replace it |
| **No probe** | The device is probe-polled but has no probe assigned, or polling is switched off | Assign a probe that can reach it. Nothing polls it until then |
| **No monitor** | The device uses the [bound-monitor override](#the-bound-monitor-override) and nothing is bound | Bind a monitor, or switch it back to probe polling |
| **SNMP failing** | Up on ping, but the last SNMP walk failed | Check credentials, the SNMP agent, or an ACL |

The Devices list also carries an **SNMP** filter chip with three values — **OK** (last walk succeeded), **Failing** (last walk failed), **Not configured** (pinged only, no credentials, or never polled) — so "which of my devices have credentials that stopped working" is one click. The **Interfaces** column reads **No SNMP** rather than `0 / 0` for a device that is pinged and never walked: zero working ports is a different and wrong claim.

## SNMP Credentials and Credential Profiles

A device is walked with the **first usable credential set** found in this order, and the search stops at the first hit:

1. **The device's own credentials** — typed on the device (Device -> **Settings** -> **SNMP Credentials**).
2. **The device's credential profile** — a profile selected on the device.
3. **The site's default credential profile** — the profile on the device's own site, picked up by every device in it.

With none of the three, the device is pinged only.

The site step is the device's **own** site only: a device in a Unit does not pick up a profile set on the Region above it. (The site's default *probe* does inherit down the tree — see [Site Monitoring Defaults](#site-monitoring-defaults) — because a probe is copied onto the device once, while credentials are re-read on every poll.)

### The SNMP Credentials page

**Network** -> **Settings** -> **SNMP Credentials** holds the project's reusable credential profiles. A profile is one named set — a v1/v2c community string, or a v3 user with its security level, protocols and keys — that any number of devices and sites point at. Nothing is copied onto the device, so rotating a community string is one edit here rather than one per device, and every device that uses the profile picks up the new value on its next poll.

Secrets on a profile are encrypted at rest, and only roles that may read a device's own credentials may read them here. A device or site listing that shows its profile shows the profile's name and version — never its secrets.

A profile that any device or site still points at **cannot be deleted**: the delete is refused with a count of what is in the way. Move those devices and sites onto another profile, or clear the profile on them, and then delete it. Silently dropping a profile out from under its devices would turn every one of them into a ping-only device on its next poll, with nothing anywhere to say why.

### Turning a device back into a ping-only device

Device -> **Settings** -> **SNMP Credentials** has a **Ping only** checkbox that clears the device's own community string and v3 username on save. It exists because "empty the right field" is not discoverable: a v3 device stays walkable while its username survives, whatever else you blank.

Clearing the device's own credentials does not clear a profile. If the device or its site still names a credential profile, the device keeps being walked with that. Clear the profile too if you want the device pinged only.

### In bulk

Select devices on the **Devices** list and use:

- **Set SNMP Credential Profile** / **Clear SNMP Credential Profile** — attach or detach a profile across a selection.
- **Switch to Probe Polling** — for devices left on the bound-monitor override: pick a probe and each selected device is pinged on its schedule from then on (and walked, once it has credentials). Any monitor already bound stays bound; the device's status simply comes from the probe now.

The Devices page shows a banner when the project holds devices that are on the bound-monitor override with nothing bound — devices nothing polls and nothing reports on. It links straight into the selection that fixes them.

## Site Monitoring Defaults

A [Network Site](/docs/monitor/network-sites) carries two defaults, under Site -> **Settings** -> **Monitoring Defaults**:

| Setting | Effect |
| ------- | ------ |
| **Default Probe** | The probe devices in this site are polled by unless a device names its own. A device created into the site with no probe inherits it, and so does a device moved into the site without one. |
| **Default SNMP Credential Profile** | The credentials devices in this site are walked with when neither the device nor its own profile carries any. |

Both are **copy-at-write for the probe and live for the credentials**, and the difference is deliberate:

- The probe is resolved and written onto the device when it is created into (or moved into) the site. Changing a site's default probe afterwards does **not** re-point devices that already have one — change those on the devices themselves. A device's probe is a fact about network reachability, and silently moving polling to a different probe across a whole site is not something to do from an unrelated form.
- The credential profile is resolved on **every poll**, so setting one on a site starts walking every credential-less device in it on its next poll, with no per-device edit.

The two also reach different distances down the site tree. If a site has no default **probe** of its own, the chain is walked up its ancestors and the nearest site with one wins — so a probe set on a Region covers the Markets and Units beneath it. The **credential profile** is read from the device's own site and no further: a device in a Unit does not inherit the Region's profile.

## The Bound-Monitor Override

Some gear no probe can reach or usefully ping: a device behind a NAT, an appliance whose health is genuinely better judged by an HTTP check, a service whose real signal is a port check. For those, Device -> **Settings** -> **Monitoring Method** offers:

| Method | What it means |
| ------ | ------------- |
| **Probe** (default) | Pinged by the assigned probe on its schedule; walked over SNMP when credentials are set |
| **Bound monitor** | An existing monitor's status **is** this device's status |

Switching a device to **Bound monitor** stops polling it: the probe, interval and polling toggle disappear from the Polling card, the device's stale poll results are cleared, and its status comes from the monitor you bind. The binding itself is optional — a device with the override and nothing bound reads Pending, tagged **No monitor**, until one is bound.

Switching back to **Probe** restores polling and asks for a probe. The device's status comes from its own polls again; a monitor that was bound stays bound and goes on alerting, it just no longer decides the device's status.

Most devices do not want this. Reachability is a built-in capability of every probe-polled device, so binding a Ping monitor purely to get an up/down status is no longer a thing you need to do — bind one when you want that monitor's *incidents*.

## Polling & Data Collection

Polling settings live on the device (Device -> **Settings** -> **Polling & Data Collection**). Defaults are sensible, so a freshly registered device needs no tuning:

| Setting                     | Description                                                                                                                                                                | Default |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Polling Enabled             | The assigned probe polls this device on the schedule below. Disable to pause polling without deleting the device.                                                           | On      |
| Polling Interval (Minutes)  | How often the probe polls the device. Minimum 1 minute.                                                                                                                    | 5       |
| Walk Interfaces             | Walk the interface tables (IF-MIB) on each poll — per-interface status, bandwidth, utilization and errors — plus LLDP/CDP neighbours for the topology map. Needs credentials. | On      |
| Collect Connected Endpoints | Also walk the device's ARP and bridge-forwarding tables to discover endpoints attached to it (POS terminals, printers, phones, laptops). Costs extra SNMP walks per poll.    | Off     |
| OID Collection Template     | A reusable, named OID list this device collects. Editing the template changes every device linked to it on its next poll.                                                   | None    |
| Device-Specific Health OIDs | Extra SNMP OIDs only this device collects, on top of its template. Recorded as device metrics.                                                                              | None    |

Everything from **Walk Interfaces** downwards needs SNMP credentials to do anything: on a ping-only device those settings are stored and simply have no walk to apply to.

### Interface Walking

With **Walk Interfaces** on (the default) and credentials resolved, every poll tracks per interface:

- Operational and administrative status
- Bandwidth in/out and link utilization
- Errors and discards per second

Individual interfaces can be muted from the device's **Interfaces** tab — useful for lab ports or intentionally unplugged links. Muted interfaces stay in the inventory but are excluded from alerting and metrics. Interface walking is also what collects LLDP/CDP neighbour data for the topology view.

A failed walk never half-clears what was collected before: the stored interface snapshot stays, and the device is tagged **SNMP failing** so nobody mistakes a frozen inventory for a current one.

### Vendor Health Templates

In the **Health OIDs** editor, the **Vendor Health Template** dropdown applies a prebuilt set of CPU, memory and temperature OIDs for your device's vendor:

- Cisco IOS / IOS-XE
- MikroTik RouterOS
- Ubiquiti EdgeOS / UniFi
- Generic (Host Resources MIB)

The template's OIDs are **copied** into the OID list below the dropdown, where you can prune or extend them. After the first poll identifies the device's vendor, the device page suggests the matching template.

This is a one-shot copy and it forgets where it came from — editing nothing propagates afterwards. For anything beyond a single device, use an **OID Collection Template** below instead; the vendor profiles are offered as a starting point when you create one.

### OID Collection Templates

Configuring health OIDs one device at a time does not scale past a handful of
devices. An **OID Collection Template** (Network -> **Settings** -> **OID
Collection Templates**) is a named OID list — usually named after a device type,
like "Cisco Catalyst 9300" or "MikroTik CCR" — that any number of devices link
to.

**The link is live, not a copy.** A device's OID list is assembled fresh on
every poll, so editing a template changes what every linked device collects on
its next poll. There is no sync step and no per-device rewrite; a template edit
touches one row no matter how many devices use it.

**Before you build one, check you need it.** Per-interface bits in/out,
operational status, errors per second and utilization are already collected for
every port on every poll, with no OIDs configured at all (see *Interface
Walking* above), and they are already alertable per port. Templates are for the
things that are **not** per-port: CPU, memory, temperature, fans, power
supplies, BGP peers.

Coming from Zabbix, the mapping is:

| Zabbix                                                        | OneUptime                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| Template                                                      | OID Collection Template                                      |
| Item                                                          | An OID on that template                                      |
| Discovery rule "Network interfaces by SNMP" + item prototypes | Built in and always on for the interface counters below — nothing to author |
| Trigger                                                       | Monitor criteria                                             |
| Trigger prototype (one per discovered interface)              | A criteria with **Interface** = `*`, which fans out per port |
| Host group                                                    | Labels                                                       |
| "Link template on host discovery" action                      | Auto Import Rule -> **OID Collection Template**              |
| Action on a host group ("alert on every switch")              | [Alert Policy](#alert-policies)                              |

Note that the `*` wildcard applies to the three *interface* criteria only.
There is no wildcard for OIDs today: an OID criteria names one OID.

**What templates do not do.** A template is a fixed list of OIDs, applied as
written. There is no per-instance expansion, so an OID naming one row of a
table (`…ifSpeed.3`) collects that row only, and follows whatever port holds
index 3 the day it is polled. That is why per-port data belongs to the
interface walk rather than to a template. The walk covers operational status,
in/out bits per second, utilization and a *combined* errors-per-second rate;
per-direction errors, discards, admin status and link speed are collected into
the device's interface inventory but are not yet time series, so they cannot be
alerted on today.

**Linking devices.** Three ways, and you will usually want the second:

- One device at a time, from Device -> **Settings** -> **Polling & Data
  Collection**.
- In bulk, by selecting devices on the **Devices** list and using **Set OID
  Collection Template**. The Devices list has a **Template** column and filter,
  so you can select every device of a type and link them in one action.
- Automatically, by setting an OID Collection Template on an **Auto Import
  Rule**, so every device a discovery scan imports is linked the moment it is
  created. On a fleet that is discovered continuously this is the one that
  matters — without it, every scan leaves devices for somebody to link by hand.

**Precedence.** A device collects its template's OIDs first, then its own
Device-Specific Health OIDs. If both name the same OID it is collected once,
with the device's name and description winning. Template entries keep their
position, so device-specific additions can never displace them.

**Limits.** A device polls at most 200 health OIDs. A template holds up to 150,
and a device linked to one may add up to 50 of its own — the two compose, so a
linked device can never exceed the 200 it is allowed to poll, and going over is
a validation error when you save rather than a silent truncation at poll time.
A device with **no** template keeps the full 200 for its own list; the tighter
50 is what linking costs, applied at the moment you link, so this never
retroactively invalidates a device you already had. Linking a device that
already carries more than 50 of its own is refused with a message saying how
many to trim, rather than accepted and silently truncated later.

A template that devices are still linked to cannot be deleted — unlink them
first (the **Clear OID Collection Template** bulk action does this), so a delete
can never quietly stop collection across a fleet.

### Custom OIDs

Add any OIDs you want collected on every poll, either on a template or as
device-specific additions. For each OID you can specify:

| Field       | Description                                  | Required |
| ----------- | -------------------------------------------- | -------- |
| OID         | The numeric OID (e.g., 1.3.6.1.2.1.1.1.0)    | Yes      |
| Name        | A friendly name for the OID (e.g., sysDescr) | No       |
| Description | A description of what this OID represents    | No       |

Collected values are charted on the device's **Metrics** tab and can be alerted
on through monitor criteria (**SNMP OID Value** and **SNMP OID Exists**). The
OID picker on those criteria lists the OIDs the selected device actually
collects — its template's plus its own — so there is nothing to type.

Long OID lists are split across several SNMP GET requests so they fit inside a
UDP datagram. A device configured with more OIDs than fit in one packet used to
answer `tooBig` and be reported **offline**; if you are upgrading from an older
release and had to keep your OID lists short for that reason, you no longer do.

### Device Identity

After the first successful **walk**, OneUptime reads the SNMPv2 system group and (where supported) the ENTITY-MIB, and fills in the device record automatically: system name, description, location, contact, uptime, vendor, model, serial number and firmware version. The vendor's registered enterprise OID (`sysObjectId`) is used as the device fingerprint to derive the vendor name and suggest a matching vendor OID template.

A ping-only device keeps the name and address you (or a discovery scan) gave it — there is no SNMP agent to ask for anything better.

## Discovering Devices with a Network Scan

Instead of registering devices one at a time, you can sweep a range of addresses:

1. Go to **Network** -> **Discovery** -> **Discovery Scans**
2. Click **Create Discovery Scan**
3. Configure the scan:

| Field                           | Description                                                                                                                                                                                                                                                            | Required            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Scan Target                     | The address space to scan, in [CIDR or octet-range notation](#scan-target-notation)                                                                                                                                                                                    | Yes                 |
| Probe                           | Which probe should run the sweep                                                                                                                                                                                                                                       | Yes                 |
| Check SNMP on hosts that answer | A scan normally starts by pinging the range; this decides whether the hosts that answer are then queried over SNMP for their name and vendor. Turn it off for a [ping-only scan](#ping-only-scans). Chosen when the scan is created and fixed after that (default: on) | No                  |
| SNMP credentials                | Same fields as device registration (v1/v2c community string, or the full v3 credential set) — tried against every host in the range                                                                                                                                    | If Check SNMP is on |

4. The scan runs from the selected probe and reports how many hosts were scanned and how many answered — how many responded to SNMP, or, on a ping-only scan, how many answered ping
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

Rules:

- Each octet is a number from 0 to 255, or a range whose lower bound comes first. `10.22-16.0.1` is rejected as a reversed range rather than quietly scanning nothing.
- A bare address (`10.0.0.5`) is a valid target that scans exactly that host.
- A single scan may cover at most **32,768 addresses**. Larger targets are rejected when you save the scan — split them into several scans, or narrow the ranges.

Targets are validated when the scan is created, so a typo is reported on the form rather than minutes later as a failed scan.

Octet ranges exist for networks that are not shaped like CIDR blocks. `10.16-22.0-255.51-66` sweeps `.51` through `.66` in every `/24` from `10.16` to `10.22` — 28,672 addresses. Expressing the same thing in CIDR takes 1,792 separate scans, and the smallest CIDR block that contains it (`10.16.0.0/13`) is 512k addresses, 98% of which are not worth probing.

### What a scan imports

**Every host a scan finds imports as a probe-polled device**, with the scan's probe assigned and polling on, so it has a status from its first poll. What differs between hosts is not *how* they are monitored but *what rides along*:

- **Hosts that answered SNMP** import with the responding IP as the hostname, the device's reported system name as the display name, and the scan's SNMP credentials — so a v3 scan imports ready-to-walk v3 devices that start collecting interfaces and inventory immediately.
- **Hosts that answered ping but no SNMP** — every host a [ping-only scan](#ping-only-scans) finds, and the ICMP-alive hosts an SNMP scan could not identify — import with no credentials. The probe pings them on their schedule; add SNMP credentials (or a credential profile on the device or its site) later and the same probe starts walking them as well.

Devices that are already registered are flagged and skipped. Bind a [Ping](/docs/monitor/ping-monitor) or [IP](/docs/monitor/ip-monitor) monitor to an imported device only if you want that monitor's incidents — an [alert policy](#alert-policies) is usually the better answer at fleet scale.

### Ping-Only Scans

Turn **Check SNMP on hosts that answer** off and the scan becomes a plain ICMP sweep: it pings every address in the range, reports the ones that answered, and sends no SNMP packet at all. The SNMP step disappears from the create form, so no version, community string or v3 credential is asked for — and none is stored on the scan.

**Check SNMP on hosts that answer** is chosen when the scan is created and cannot be changed afterwards. There is no toggle for it on a saved scan and no re-run button: a scan created ping-only stays ping-only for its whole life, including every run of a recurring one. To scan the same range the other way, create a second scan.

Reach for it when:

- **You have no SNMP credentials for the range** — a lab, a tenant network, a subnet you inherited. A ping-only scan tells you what is alive there without you first having to guess a community string.
- **You want an inventory sweep rather than an identity check** — what answers on this range, not what model it is. It is also the quicker of the two, because it skips the SNMP probe: there is no per-host SNMP timeout to wait out on the hosts that answer ping but will not talk SNMP to you.

Two things to know before running one:

- **The probe needs a runtime that permits ICMP.** The sweep shells out to the operating system's `ping` binary, so the probe container needs both the `NET_RAW` capability and that binary present. OneUptime's shipped deployments already provide both — `docker-compose.base.yml` and the Helm chart's `probeContainerSecurityContext` add `NET_RAW` explicitly, and the stock probe image installs `iputils-ping` — so a failure here usually means a hardened Kubernetes `securityContext` or a capability drop removed `NET_RAW`, or a custom probe image left `ping` out. Either way a ping-only scan has nothing left to try, so it fails with a message saying exactly that, rather than reporting an empty range that reads like a subnet with nothing on it. (If ping stops working partway through, after some hosts were already confirmed, the scan keeps those and says the range was not fully checked.)
- **Everything it finds imports as a probe-polled device with no credentials.** The scan's probe pings each one on its schedule, so every imported device has a status from its first poll. Add SNMP credentials, or a credential profile on the device or its site, whenever you have them and the probe starts walking the device as well.

A ping-only scan can only find hosts that answer ICMP echo. Hosts that drop ping — Windows hosts do by default, and management VLANs often do — stay invisible to it even when they are up and answering SNMP. An SNMP scan covers that case: when its ICMP-gated pass finds no SNMP responder at all, it goes back and probes the ICMP-silent addresses over SNMP as well. So if you expect managed devices in a range and a ping-only scan comes back empty, create a new scan over the same range with **Check SNMP on hosts that answer** on.

## Alerting

Polling gives you status, inventory and charts. Alerting — incidents, alerts, on-call — needs a monitor. There are two ways to get one, and they differ in how many devices you are covering at a time.

### Alert Policies

**Network** -> **Settings** -> **Alert Policies** is where a fleet's alerting intent is written down once. A policy says **which** devices (a scope of sites, device roles and labels) and **what** they are alerted on (a Network Device monitor template), so that "every warehouse switch raises an incident when it goes unreachable" is one row rather than two hundred monitors.

> **Provisioning is not switched on yet.** A policy you save today records the intent and validates it — the scope, the template, the ownership rules below — but nothing yet turns it into monitors, so its **Covered Devices** column reads "Not counted yet" and its **Last Sync** stays empty. Keep using per-device monitors for alerting until the provisioning engine ships; the policies you write now are what it will act on.

**Scope** is AND across kinds and OR within a kind: a device must match the sites list **and** the roles list **and** the labels list, where "in site A or site B" and "carrying label X or label Y" are each satisfied by any one member. An empty kind matches everything, so a policy with every kind empty covers **every device in the project** — the table says "All devices" against it so nobody misreads the reach.

Only probe-polled devices that have a probe are in scope. A device on the bound-monitor override already has a monitor of its own, and an archived device is left alone.

**A policy will provision one monitor per matching device, and every one of those monitors counts towards your plan.** An unscoped policy in a large estate is a lot of monitors from one form submit, so the confirmation on the "create the recommended policy" action names the project's active device count before it creates anything.

A template can back **one** policy, and cannot at the same time be selected by an auto-import rule. A provisioned monitor's provenance is the pair (device, template), so a template shared by two owners would leave both claiming the same monitor; the form refuses those selections with a sentence rather than a constraint error. Deleting a template does not delete the policies that used it — they lose their template and show with none, so you can repair rather than rebuild them.

**The recommended policy.** With no policies yet, the page offers to create one for you: a *Network device alert pack (recommended)* monitor template — the [alert pack](#recommended-alert-pack) below — plus an *Alert on every device* policy that applies it to the whole project. The template is found again by a marker in its description, so the action never mints a second copy. That template is a real, editable monitor template you can use for hand-built monitors today, whether or not the policy beside it is provisioning anything. Narrow the policy's scope afterwards if the whole project is too much.

### One device at a time

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

| Filter Type                        | Description                                                            | On a ping-only poll |
| ---------------------------------- | ---------------------------------------------------------------------- | ------------------- |
| SNMP Device Is Online              | Whether the device is reachable — by ping **or** SNMP. This is the same verdict as the status pill. | Evaluated |
| SNMP Walk Is Succeeding            | Whether the last SNMP walk succeeded. False is the "SNMP failing" state: reachable, but interfaces and inventory have stopped refreshing. | Not evaluated |
| SNMP Response Time (in ms)         | The **walk's** response time in milliseconds — never the ping's RTT     | Not evaluated       |
| SNMP OID Value                     | Check the value returned by a specific OID                             | Not evaluated       |
| SNMP OID Exists                    | Check if an OID returns a value (not null)                             | Not evaluated       |
| SNMP Interface Is Down             | True when any administratively-enabled interface is operationally down | Not evaluated       |
| SNMP Interface Utilization (in %)  | Check the busiest interface's link utilization                         | Not evaluated       |
| SNMP Interface Errors (per second) | Check the worst interface's error rate                                 | Not evaluated       |
| SNMP Trap Received (Trap OID)      | Matches when a trap with the given OID arrives from the device         | n/a — trap-driven   |

"Not evaluated" is exactly that, and it matters: on a poll where no walk ran, those criteria return **no verdict** rather than a failing one. A criteria that would open an incident when SNMP response time exceeds a threshold cannot fire on a device that is only pinged, so a ping-only device watched by walk-based criteria is harmless rather than a false-alarm generator.

The interface checks require **Walk Interfaces** to be on in the device's polling settings (it is by default). The OID checks evaluate the device's configured **Health OIDs**. Administratively disabled interfaces are intentionally down and never count as failures.

### Recommended Alert Pack

Click **Add Recommended Alerts** on the criteria form to append a prebuilt set of criteria — the alerts most network operators want, without hand-building them each time. They are pre-filled automatically when you create the monitor from the device's page, and they are what the [recommended alert policy](#alert-policies)'s monitor template carries.

| Criteria            | Fires when                                                     | Creates  |
| ------------------- | -------------------------------------------------------------- | -------- |
| Device unreachable  | The device stops answering **ping and SNMP**                    | Incident |
| SNMP walk failing   | The device answers ping but its SNMP walk is failing            | Alert    |
| Interface down      | An administratively-enabled interface goes operationally down   | Incident |
| Interface saturated | An interface runs above 80% utilization                         | Alert    |
| Interface errors    | An interface logs more than 1 error per second                  | Alert    |

"SNMP walk failing" is an alert rather than an incident on purpose: the device is not down, so waking somebody at 2am for it would be wrong — but its inventory has stopped refreshing and somebody should fix the credentials. It never fires on a ping-only device, because the criterion is not evaluated when no walk ran.

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

Trap matching is by address, not by credentials, so a **ping-only device can still receive traps** — a device you hold no read credentials for can still be configured to send them. Register the device with the IP address it sends traps from. SNMPv1 generic traps (coldStart, linkDown, linkUp, ...) are normalized to their standard SNMPv2 notification OIDs — for example, linkDown matches trap OID `1.3.6.1.6.3.1.1.5.3` regardless of SNMP version.

#### Example: raise an incident on linkDown

- **Filter Type**: SNMP Trap Received (Trap OID)
- **Filter Condition**: Equal To
- **Value**: 1.3.6.1.6.3.1.1.5.3

The filter also supports Contains / Starts With / Ends With, so a single criteria can match a family of enterprise traps by OID prefix.

## Template Variables for Alerts

When creating incident or alert templates, you can use the following variables:

| Variable                   | Description                                                                  |
| -------------------------- | ---------------------------------------------------------------------------- |
| `{{isOnline}}`             | Whether the device is reachable by ping or SNMP (true/false)                 |
| `{{responseTimeInMs}}`     | SNMP walk time in milliseconds                                               |
| `{{failureCause}}`         | Error message if the SNMP walk failed                                        |
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

`{{isOnline}}` is filled in on every poll. **Every other variable in that table comes from the SNMP walk**, so on a ping-only poll they are all empty — write templates that lead with `{{isOnline}}` and the device name if a policy's scope might include devices without credentials. The interface and system variables additionally require interface walking to be enabled on the device; the trap variables are only set when the check was triggered by a trap. An incident title like:

```
{{downInterfaces.0.name}} on {{sysName}} is down
```

renders as "Gi0/1 on core-switch-01 is down". See [Incident & Alert Templating](/docs/monitor/incident-alert-templating) for how templating works in general.

## Network Topology

Go to **Network** -> **Network Map** -> **Topology** for a live map of your network, built from LLDP neighbour data collected during interface walks and complemented by CDP on Cisco estates. Managed devices are filled; unmanaged LLDP peers are hollow. Node colour reflects device status, and clicking a managed device opens it.

For the map to populate:

- Give the devices SNMP credentials — neighbour tables come from the walk, so a ping-only device appears on the map but reports no neighbours of its own
- Keep **Walk Interfaces** on in the device's polling settings — the neighbour tables are walked alongside the interfaces
- Enable LLDP (or CDP on Cisco devices) on the devices themselves

Clicking an unmanaged peer offers **Add to Monitoring**, which registers it as a probe-polled device: it inherits the probe its neighbours agree on, so it is pinged from its first poll, and you add credentials afterwards if it turns out to have them.

## Troubleshooting

### Device stays Pending

A device shows **Pending** while nothing has reported on it yet. Read the qualifier beside the pill:

- **No probe** — assign a probe (or turn Polling Enabled back on). Nothing polls the device until you do.
- **No monitor** — the device is on the [bound-monitor override](#the-bound-monitor-override) with nothing bound. Bind a monitor, or use **Switch to Probe Polling** to have its probe ping it instead.
- **No qualifier at all** — the device has a probe and is waiting for its first poll. On a large fleet a probe hands out a bounded number of devices per cycle, so the first poll can take longer than the device's interval.

**If a ping-only device stays Pending for hours while credentialed devices on the same probe are fine, check that probe's version.** A probe from before ping-first polling has no way to ping a device, and handing it a credential-less device would make it walk with a default community string and report a healthy device Down. Rather than do that, the server **withholds ping-only devices from an old probe** and logs one warning per batch naming the probe and how many devices were withheld. Those devices stay Pending — visibly waiting, never wrongly Down — until the probe is upgraded. Upgrade the probe and they start reporting on the next cycle with no further action.

### Device is Up but tagged "SNMP failing"

The device answers ping and its SNMP walk does not. In order of likelihood:

- The credentials are wrong or have been rotated. Check the [credential chain](#snmp-credentials-and-credential-profiles) — the device's own credentials win over its profile, which wins over the site's.
- SNMP is not enabled on the device, or the agent has stopped.
- An ACL or firewall is blocking UDP 161 from the probe.
- For v3: the username, auth protocol/key, priv protocol/key or security level does not match the device.

The device keeps its last-collected interfaces and inventory while this lasts — they are frozen, not cleared, which is exactly what the tag is there to tell you.

### Interfaces column reads "No SNMP"

The device has been polled and no walk was attempted, because no usable credentials were found anywhere in its chain. Add credentials on the device, point it at a credential profile, or set a default profile on its site. This is a normal state for a phone, a camera or a PDU — not every device needs to be walked.

### Interfaces not showing on a credentialed device

- Confirm **Walk Interfaces** is on in the device's polling settings
- Check the `{{interfaceWalkFailure}}` template variable / monitor logs — the device may restrict the IF-MIB subtree for your credentials

### Traps not arriving

- Publish/allow UDP port 162 through to the probe (or the custom `PROBE_SNMP_TRAP_RECEIVER_PORT`)
- Confirm the device's registered hostname is the IP address it sends traps from — that is how traps are matched to devices
- Check the probe logs for bind errors (port in use, or missing privileges for ports below 1024)

### Testing SNMP Connectivity

Before adding credentials to a device, you can test SNMP connectivity using command-line tools from the probe's own network:

```bash
# SNMP v2c
snmpget -v2c -c public 192.168.1.1 1.3.6.1.2.1.1.1.0

# SNMP v3 (authPriv)
snmpget -v3 -u username -l authPriv -a SHA -A authpassword -x AES -X privpassword 192.168.1.1 1.3.6.1.2.1.1.1.0
```

## Best Practices

1. **Register everything, credential what you can** — a device with no SNMP credentials still has a status, a site and a place on the map, so there is no reason to leave gear out of the inventory while you hunt for a community string.
2. **Set monitoring defaults on your sites** — a default probe and a default credential profile per site mean a new device can be added by name and address alone, and a site-wide credential rotation is one edit.
3. **Use credential profiles rather than per-device credentials** — rotating a community string then touches one row instead of hundreds.
4. **Use SNMPv3 when possible** — it provides authentication and encryption for better security.
5. **Discover, then import** — a discovery scan is faster and less error-prone than registering devices by hand, and everything it finds is polled from the moment it is imported.
6. **Write the fleet's alerting intent down as a policy** — even while [provisioning is off](#alert-policies), a policy records what a set of devices should be alerted on, which is the part hand-built monitors never capture: they cover the devices you had, not the ones you are about to discover.
7. **Register devices by the IP they send traps from** — trap-to-monitor matching is by source IP.
8. **Keep interface walking on for switches and routers** — it powers interface alerts, utilization data and the topology map.
9. **Use descriptive OID names** — makes alert messages and template variables easier to read.
10. **Reserve the bound-monitor override for gear a probe genuinely cannot reach** — it turns polling off, and with it interfaces, inventory and the device's own metrics.
