# Network Device Monitor

Network Device monitoring covers switches, routers, firewalls, access points, PDUs, cameras, printers — anything with an address on your network, whether or not it speaks SNMP.

Adding a device takes its address and a probe — a name and a site too, if you want them. From that moment the probe **pings** the device on its schedule and the device has an up/down status, appears on the network map and votes in its site's health rollup. Everything else is an upgrade on top of that same device:

- **Add SNMP credentials** — on the device, or by pointing it at a reusable credential profile, or by setting a default profile on its site — and the same probe starts **walking** it as well: interfaces and the optics in them, hardware inventory, LLDP/CDP neighbours, health OIDs.
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
- **Alert policies** — write down once what a whole _set_ of devices should be alerted on, rather than per device. (Definitions ship now; the engine that turns them into monitors does not yet — see [Alert Policies](#alert-policies).)
- **Network Device monitors** — the alerting layer: evaluate each device poll and trap against criteria and open incidents or alerts.
- **SNMP tables** — lists a device keeps (IPsec tunnels, Wi-Fi radios, SSIDs, fabric neighbours, fans, power supplies) walked whole on every poll, charted per row and alertable per row. See [SNMP Tables](#snmp-tables).
- **Transceiver health** — the SFP, SFP+ and QSFP optics in a device's ports: present or pulled, their temperature, voltage, bias current and light levels against the device's own thresholds, and a month of received power. See [Transceivers](#transceivers).
- **SNMP traps** — probes run a trap receiver, so link-down events raise incidents in seconds instead of waiting for the next poll.
- **Topology view** — a live network map built from LLDP neighbour data, complemented by CDP on Cisco estates.

## The Network Overview

**Network** -> **Overview** is where the Network area opens, and it starts with the answer: one sentence that says whether your network is healthy and, when it is not, what is wrong — worst news first:

| What it says | When |
| ------------ | ---- |
| **3 devices are down** | A device's probe or monitor cannot reach it. Red. |
| **2 sites need attention** | Every device answers, but a site's health is not operational. |
| **5 interfaces are down** | Every device answers, but ports are dark. |
| **2 devices are not reporting their details** | They answer ping, but their SNMP walk is failing, so their interfaces and health are not being refreshed — usually credentials. |
| **Waiting for the first check** | Devices were added and their probe has not checked them yet. |
| **All 40 devices are up** | Every device answers. Devices still waiting for their first check are counted in a line of their own, never hidden. |

Under it, one line says whether anything raises an incident when a device goes down: how many [alert policies](#alert-policies) are on, or — with none — a **Set up alerts** link. The **Add Device** and **Discover Devices** buttons beside it open those forms straight away. The tiles and lists below (devices and sites needing attention, the fleet by vendor, recent scans) carry the detail.

Before anything is added, the Overview shows the two ways in instead: **Discover devices** (scan an address range and pick what to add — best for a whole network or a new site) and **Add one device** (by its IP address or hostname).

The Network menu keeps what you open every day in view — **Overview**, **Devices**, **Sites**, **Map** and **Discovery** — and folds the rest: **Topology** (Device Topology, Endpoints, Latency Matrix, Site Links, Device Links), **Rules** (auto import, site assignment, owner, label and link rules) and **Settings** (Alert Policies, SNMP Credentials, Device Roles, Site Types, OID Collection Templates). A folded section opens by itself when you are on one of its pages.

## Adding a Network Device

1. Go to **Network** -> **Devices** and click **Add Device** — or click **Add Device** on the Network **Overview**, which opens the same form
2. Type the device's **Hostname**: its IP address or hostname
3. Click **Add Device**

That is all most devices need. The form is one page — the hostname, a name, the site and the probe — with **SNMP** and **More fields** folded underneath. There is no "how is this device monitored?" question on the form. Every device you add is polled by its probe; the bound-monitor override lives on the device's **Settings** page for the few devices that need it.

Once added, the device is pinged by its probe within a couple of minutes. If it has credentials, its Overview page also fills in with system identity, interfaces and health data on the first successful walk.

A device's details — its name, description, role, site, labels and address — are edited in one place afterwards: the **Device Settings** card on its **Settings** page. The **Device Details** card on its Overview shows them, with an **Edit in Settings** link.

### The device

| Field    | Description                                                                                                                                                                                                                          | Required |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Hostname | The IP address or hostname the probe pings — and walks over SNMP once the device has credentials                                                                                                                                     | Yes      |
| Name     | A friendly name (e.g., core-switch-01). Leave it empty and the device is named after its hostname. The API does the same: a device created with no name is named after its hostname.                                                 | No       |
| Site     | The [Network Site](/docs/monitor/network-sites) the device sits in. The site's health rolls up from the devices in it, and a site with a default probe fills in the Probe below.                                                     | No       |
| Probe    | Which probe pings this device, walks it over SNMP when it has credentials, and receives its traps, syslog and NetFlow. It must be able to reach the device directly — a probe on the public internet cannot reach a private address. | Yes      |

The Probe field fills itself in where it can: a project with exactly one custom probe starts on that one, and picking a site replaces it with the [site's default probe](#site-monitoring-defaults). It never overwrites a probe you chose yourself. Set a default probe on your sites and a device can be added by its address alone.

### More fields (folded)

| Field                                    | Description                                                                                                                                                                                                                                                                                                                 | Required |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Description                              | Free text                                                                                                                                                                                                                                                                                                                   | No       |
| Device Role                              | Device role (core switch, access switch, firewall …) — drives topology tiering and alert-policy scoping                                                                                                                                                                                                                     | No       |
| MAC Address                              | The device's own MAC. Lets the topology map put a device that speaks neither LLDP nor CDP on the switch port that learned it — see [Network Topology](#network-topology). Usually learned for you from a router's ARP table.                                                                                                | No       |
| Also create a Ping monitor for incidents | The probe already pings the device and gives it a status; this is what turns failed pings into an **incident**. Tick it and a Ping monitor is created on the hostname above and bound to the device when you save. It counts towards your plan, and incidents are off on it until you turn them on from the monitor's page. | No       |

Ticking the Ping monitor opt-in reveals a **Ping from probes** field for the monitor's own probes — they have to be able to reach the device's network, and leaving it empty uses the project's default probes. To alert on many devices at once, use [alert policies](#alert-policies) instead.

### SNMP (folded, optional)

**Leave it folded and the device is pinged only.** While nothing is set, the folded section says so in one sentence. The device still has a status from its first poll, still sits in its site and on the map — it simply has no interfaces, inventory or health OIDs until credentials appear. Open it to type a community string or a v3 user, or to pick a saved credential profile.

| Field                   | Description                                                         | Required                   |
| ----------------------- | ------------------------------------------------------------------- | -------------------------- |
| SNMP Credential Profile | A reusable credential set to use instead of typing credentials here | No                         |
| SNMP Version            | Protocol version: V1, V2c, or V3                                    | Yes (defaulted to V2c)     |
| SNMP Port               | UDP port for SNMP queries (default: 161)                            | No                         |
| SNMP Community String   | The v1/v2c community string (e.g., "public")                        | No — empty means ping only |

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

## Changing Many Devices at Once

A discovery scan of a customer's network brings in dozens of devices that all belong in one site, share one role and come from one vendor. You do not open each of them: select them on the **Devices** list — tick the rows, or **Select All** to take every device the filters match — and open **Bulk Actions**.

| Action | What it does |
| ------ | ------------ |
| **Set Site** / **Clear Site** | Moves every selected device into the site you pick, where it counts toward the site's health; a device without a probe of its own picks up the [site's default probe](#site-monitoring-defaults). **Clear Site** takes them out of their sites. A device a site assignment rule matches goes back to that rule's site on its next poll, so for devices discovery keeps finding, add a rule under **Network** -> **Rules** -> **Site Assignment Rules** instead — the **Set Site** dialog links to it. |
| **Set Device Role** / **Clear Device Role** | Gives every selected device one role — the twenty switches that are all "Access Switch". Roles are the project's own, under **Network** -> **Settings** -> **Device Roles**, which the dialog links to. **Clear Device Role** has each device's role worked out from its SNMP identity again. |
| **Apply Vendor Template** | Adds a [vendor template](#vendor-health-templates)'s health OIDs and SNMP tables to every selected device. **Match each device's vendor**, the dialog's first choice, picks each device's own template from what its SNMP walk reports, so a mixed selection gets the right one everywhere; or pick one template for all of them. |

Each action is one dialog and one save for the whole selection, and every device goes through the same checks as an edit on its own Settings page: permissions, the label and owner scope of your role, and the limits on what a device may collect.

**Apply Vendor Template** shows what it will do before it does anything: how many devices get which template, and how many it leaves alone and why. It adds to what each device already collects and removes nothing; a device that already has everything in the template is not written again. It leaves alone a device that is monitor-backed (nothing polls it, so it would collect nothing), one linked to an [OID Collection Template](#oid-collection-templates) (the template decides what it collects — add the vendor's OIDs there instead), and, when matching, one that has not been walked over SNMP yet or whose vendor has no template.

When an action finishes, it lists how many devices changed, which failed and why — a device your role may not edit, a list over its limit — and which it **did not change** and why: a device already in that site or role, or one the vendor template leaves alone.

The other bulk actions are described where they belong: **Set OID Collection Template** under [OID Collection Templates](#oid-collection-templates), **Set SNMP Credential Profile** and **Switch to Probe Polling** under [In bulk](#in-bulk), and **Shorten Names to Hostname** under [How discovered devices are named](#how-discovered-devices-are-named).

## What a Poll Actually Does

Every poll of a probe-polled device is a **ping**. When the device has usable SNMP credentials, the probe also runs a **full SNMP walk** — the two run in parallel, and the walk is never gated on the ping answering, so SNMP gear behind an ICMP-filtering ACL still reports Up.

What each poll writes back:

|                                        | Ping-only device           | Device with SNMP credentials                               |
| -------------------------------------- | -------------------------- | ---------------------------------------------------------- |
| Status (Up / Down)                     | From the ping              | From the ping **or** the walk — either answering is enough |
| Ping round-trip time and packet loss   | Recorded as device metrics | Recorded as device metrics                                 |
| SNMP response time                     | —                          | The walk's time (never the ping's RTT)                     |
| Interfaces, neighbours, endpoints      | —                          | From a successful walk                                     |
| System identity, vendor, model, serial | —                          | From a successful walk                                     |
| Health OIDs                            | —                          | From a successful walk                                     |

"Usable credentials" means a v1/v2c set with a **non-empty community string**, or a v3 set with a **non-empty username** — resolved through the [credential chain](#snmp-credentials-and-credential-profiles). An empty credential set is skipped, not used, so a device never gets walked with a guessed default community.

Ping round-trip time and packet loss are recorded as device metrics on every poll. Packet loss reuses the [Ping monitor](/docs/monitor/ping-monitor)'s series so the vocabulary is the same across the product; round-trip time gets a series of its own (`oneuptime.monitor.ping.round.trip.time`), because on a Network Device the plain "response time" is the SNMP walk's. The device's **Metrics** tab charts interface utilization and polled health OIDs; the ping series are recorded alongside them but are not drawn on that tab yet.

### "SNMP failing" is not "Down"

A device that answers ping but whose walk fails is **Up**, tagged **SNMP failing**. That is a deliberate distinction, and both halves matter:

- It is **Up** because it is: something is answering at that address. Painting it red would put a device that is running fine into your incident count.
- It is **SNMP failing** because its interfaces, inventory and health OIDs have stopped refreshing — almost always credentials, a disabled SNMP agent, or an ACL. Nothing else on the page would tell you that the numbers you are looking at are frozen.

A device whose ping **and** walk both fail is simply Down. The "SNMP failing" tag can only ever sit beside a green pill.

### Reading a device's status

Every surface that shows a device — the Devices list, a site's Devices tab, the Overview hero, the map — uses the same three verdicts and the same qualifiers beside them.

| Verdict     | Means                                                                          |
| ----------- | ------------------------------------------------------------------------------ |
| **Up**      | The last poll (ping or SNMP), or the bound monitor, reached the device         |
| **Down**    | The last poll (ping or SNMP), or the bound monitor, could not reach the device |
| **Pending** | No verdict yet — never polled, no probe assigned, or no monitor bound          |

| Qualifier        | Shown when                                                                                     | What to do                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Stale**        | No poll has been attempted for well over the device's interval                                 | Check the device's probe is online and keeping up with its fleet — this qualifies the verdict, it does not replace it |
| **No probe**     | The device is probe-polled but has no probe assigned, or polling is switched off               | Assign a probe that can reach it. Nothing polls it until then                                                         |
| **No monitor**   | The device uses the [bound-monitor override](#the-bound-monitor-override) and nothing is bound | Bind a monitor, or switch it back to probe polling                                                                    |
| **SNMP failing** | Up on ping, but the last SNMP walk failed                                                      | Check credentials, the SNMP agent, or an ACL                                                                          |

The Devices list also carries an **SNMP** filter chip with three values — **OK** (last walk succeeded), **Failing** (last walk failed), **Not configured** (pinged only, no credentials, or never polled) — so "which of my devices have credentials that stopped working" is one click. The **Interfaces** column reads **No SNMP** rather than `0 / 0` for a device that is pinged and never walked: zero working ports is a different and wrong claim.

## SNMP Credentials and Credential Profiles

A device is walked with the **first usable credential set** found in this order, and the search stops at the first hit:

1. **The device's own credentials** — typed on the device (Device -> **Settings** -> **SNMP Credentials**).
2. **The device's credential profile** — a profile selected on the device.
3. **The site's default credential profile** — the profile on the device's own site, picked up by every device in it.

With none of the three, the device is pinged only.

The site step is the device's **own** site only: a device in a Unit does not pick up a profile set on the Region above it. (The site's default _probe_ does inherit down the tree — see [Site Monitoring Defaults](#site-monitoring-defaults) — because a probe is copied onto the device once, while credentials are re-read on every poll.)

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

| Setting                             | Effect                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Default Probe**                   | The probe devices in this site are polled by unless a device names its own. A device created into the site with no probe inherits it, and so does a device moved into the site without one. |
| **Default SNMP Credential Profile** | The credentials devices in this site are walked with when neither the device nor its own profile carries any.                                                                               |

Both are **copy-at-write for the probe and live for the credentials**, and the difference is deliberate:

- The probe is resolved and written onto the device when it is created into (or moved into) the site. Changing a site's default probe afterwards does **not** re-point devices that already have one — change those on the devices themselves. A device's probe is a fact about network reachability, and silently moving polling to a different probe across a whole site is not something to do from an unrelated form.
- The credential profile is resolved on **every poll**, so setting one on a site starts walking every credential-less device in it on its next poll, with no per-device edit.

The two also reach different distances down the site tree. If a site has no default **probe** of its own, the chain is walked up its ancestors and the nearest site with one wins — so a probe set on a Region covers the Markets and Units beneath it. The **credential profile** is read from the device's own site and no further: a device in a Unit does not inherit the Region's profile.

## The Bound-Monitor Override

Some gear no probe can reach or usefully ping: a device behind a NAT, an appliance whose health is genuinely better judged by an HTTP check, a service whose real signal is a port check. For those, Device -> **Settings** -> **Monitoring Method** offers:

| Method              | What it means                                                                           |
| ------------------- | --------------------------------------------------------------------------------------- |
| **Probe** (default) | Pinged by the assigned probe on its schedule; walked over SNMP when credentials are set |
| **Bound monitor**   | An existing monitor's status **is** this device's status                                |

Switching a device to **Bound monitor** stops polling it: the probe, interval and polling toggle disappear from the Polling card, the device's stale poll results are cleared, and its status comes from the monitor you bind. The binding itself is optional — a device with the override and nothing bound reads Pending, tagged **No monitor**, until one is bound.

Switching back to **Probe** restores polling and asks for a probe. The device's status comes from its own polls again; a monitor that was bound stays bound and goes on alerting, it just no longer decides the device's status.

Most devices do not want this. Reachability is a built-in capability of every probe-polled device, so binding a Ping monitor purely to get an up/down status is no longer a thing you need to do — bind one when you want that monitor's _incidents_.

## Polling & Data Collection

Polling settings live on the device (Device -> **Settings** -> **Polling & Data Collection**). Defaults are sensible, so a freshly registered device needs no tuning:

| Setting                     | Description                                                                                                                                                                                                                                                                                                                                                                  | Default |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Polling Enabled             | The assigned probe polls this device on the schedule below. Disable to pause polling without deleting the device.                                                                                                                                                                                                                                                            | On      |
| Polling Interval (Minutes)  | How often the probe polls the device. Minimum 1 minute.                                                                                                                                                                                                                                                                                                                      | 5       |
| Walk Interfaces             | Walk the interface tables (IF-MIB) on each poll — per-interface status, bandwidth, utilization and errors — plus LLDP/CDP neighbours for the topology map. Needs credentials.                                                                                                                                                                                                | On      |
| Collect Connected Endpoints | Also walk the device's ARP and bridge-forwarding tables to discover endpoints attached to it (POS terminals, printers, phones, laptops), and — on a router, or any device whose walk returns an ARP table — fill in the MAC address of registered devices found there, which is what puts a ping-only device on its switch port on the map. Costs extra SNMP walks per poll. | Off     |
| OID Collection Template     | A reusable, named OID list this device collects. Editing the template changes every device linked to it on its next poll.                                                                                                                                                                                                                                                    | None    |
| Device-Specific Health OIDs | Extra SNMP OIDs only this device collects, on top of its template. Recorded as device metrics.                                                                                                                                                                                                                                                                               | None    |
| Device-Specific SNMP Tables | Extra [SNMP tables](#snmp-tables) only this device walks, on top of its template's. A table with the same key as a template table replaces it on this device.                                                                                                                                                                                                                | None    |

Everything from **Walk Interfaces** downwards needs SNMP credentials to do anything: on a ping-only device those settings are stored and simply have no walk to apply to.

### Interface Walking

With **Walk Interfaces** on (the default) and credentials resolved, every poll tracks per interface:

- Operational and administrative status
- Bandwidth in/out and link utilization
- Errors and discards per second

Individual interfaces can be muted from the device's **Interfaces** tab — useful for lab ports or intentionally unplugged links. Muted interfaces stay in the inventory but are excluded from alerting and metrics. Interface walking is also what collects LLDP/CDP neighbour data for the topology view.

A failed walk never half-clears what was collected before: the stored interface snapshot stays, and the device is tagged **SNMP failing** so nobody mistakes a frozen inventory for a current one.

### Vendor Health Templates

In the **Health OIDs** editor, the **Vendor Health Template** dropdown applies a prebuilt set of CPU, memory and temperature OIDs for your device's vendor. Several also ship [SNMP tables](#snmp-tables), added from the **SNMP Tables** editor's _Add a vendor's tables_ dropdown:

| Vendor template                                                                                                                                                                 | Health OIDs                                                                        | SNMP tables                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Generic (Host Resources MIB)                                                                                                                                                    | CPU load, memory, load average                                                     | CPU cores (one row per core, whatever the platform numbers them)                                                  |
| Arista EOS, Cisco IOS / IOS-XE, Dell Force10, Fortinet FortiGate, HPE / Aruba ProCurve, Huawei VRP, Juniper Junos, MikroTik RouterOS, Palo Alto PAN-OS, Ubiquiti EdgeOS / EdgeSwitch / UniFi Switches | CPU, memory, temperature (and fans / power supplies where the platform has them)   | —                                                                                                                 |
| Cambium Networks Enterprise Wi-Fi (cnPilot, XV, XE, XH)                                                                                                                         | CPU, memory, Wi-Fi clients, cnMaestro connection                                   | Wi-Fi radios (band, channel, width, TX power, clients, noise floor, airtime, state), SSIDs                        |
| Cambium Networks cnMatrix                                                                                                                                                       | CPU, RAM, flash, temperature, supply voltage                                       | Fans, PoE ports, redundant power supply                                                                           |
| Extreme Networks EXOS / Switch Engine                                                                                                                                           | CPU, temperature, over-temperature alarm, power state                              | Power supplies, fans, memory per slot, stack members                                                              |
| Extreme Networks Fabric Engine / VOSS                                                                                                                                           | vIST session, I-SID count                                                          | Fabric (IS-IS) adjacencies named by neighbour, CPU and memory per slot, temperature sensors, fans, power supplies |
| Sophos Firewall (SFOS / XGS)                                                                                                                                                    | Memory, disk, swap, HA state and peer state, IPsec service, CPU temperature (v22+) | IPsec tunnels (status needs SFOS v20+), CPU cores                                                                 |
| Ubiquiti UniFi Access Points | Load average, memory, isolated state | Wi-Fi radios (band, airtime), SSIDs (band, channel, clients, TX power, connection quality), CPU cores |
| HPE Aruba Instant (AOS 8) | Cluster name, firmware version, conductor | Access points (status, model, CPU, memory), Wi-Fi radios named by access point (channel, TX power, noise floor, utilization, clients, state), SSIDs (clients) |
| HPE Aruba Mobility Controller (AOS 8) | Access points, Wi-Fi clients, controller role | Access points (status, model, AP group), Wi-Fi radios named by access point (band, channel, TX power, utilization, clients, mode), SSIDs (clients, access points up and down), processors, memory |
| Extreme Networks IQ Engine (HiveOS) Access Points | CPU, memory, Wi-Fi clients, temperature | Wi-Fi radios (channel, TX power, noise floor), SSIDs |
| Extreme Networks Wireless Controller (XIQ-C, ExtremeWireless) | Access points, active access points, Wi-Fi clients | Access points (state, clients, address, software), Wi-Fi radios (band, channel, width, noise floor, busy airtime), WLANs (SSID, clients) |
| TP-Link Omada Access Points (EAP) | Wi-Fi clients | — |

The template's OIDs are **copied** into the OID list below the dropdown, where you can prune or extend them. After the first poll identifies the device's vendor, the device page suggests the matching template. Matching uses the device's `sysObjectID`, and its `sysDescr` where one enterprise number hosts two operating systems: Extreme Fabric Engine on universal hardware reports the same enterprise (1916) as EXOS, and only its description (`…-FabricEngine (9.0.4.0)`) tells them apart. UniFi access points are told from Ubiquiti's routers the same way (`U6-Pro 6.6.50.15098`), also when older firmware answers with Net-SNMP's arc, and IQ Engine access points from the Aerohive switches that share their arc (`AP230, HiveOS 8.2r1`). Devices with **Auto-Apply Vendor Health Template** on get the template's OIDs **and** tables on their first poll: devices an auto import rule brings in, and devices imported from **Review Results** with its vendor template switch on, which it is unless you turn it off.

To give many devices their template at once — a whole discovered fleet that predates the switch, say — select them on the **Devices** list and use **Apply Vendor Template** (see [Changing Many Devices at Once](#changing-many-devices-at-once)).

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
every port on every poll, with no OIDs configured at all (see _Interface
Walking_ above), and they are already alertable per port. Templates are for the
things that are **not** per-port: CPU, memory, temperature, fans, power
supplies, BGP peers.

Coming from Zabbix, the mapping is:

| Zabbix                                                                             | OneUptime                                                                   |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Template                                                                           | OID Collection Template                                                     |
| Item                                                                               | An OID on that template                                                     |
| Discovery rule "Network interfaces by SNMP" + item prototypes                      | Built in and always on for the interface counters below — nothing to author |
| Trigger                                                                            | Monitor criteria                                                            |
| Trigger prototype (one per discovered interface)                                   | A criteria with **Interface** = `*`, which fans out per port                |
| Discovery rule over any other SNMP table (tunnels, radios, fans) + item prototypes | An [SNMP table](#snmp-tables) on the template                               |
| Trigger prototype on such a table                                                  | An SNMP Table Value or Row Is Unhealthy criteria with **Row** = `*`         |
| Host group                                                                         | Labels                                                                      |
| "Link template on host discovery" action                                           | Auto Import Rule -> **OID Collection Template**                             |
| Action on a host group ("alert on every switch")                                   | [Alert Policy](#alert-policies)                                             |

The `*` wildcard applies to the interface criteria and to the
[SNMP table](#snmp-tables) criteria. An OID criteria names one OID.

**OIDs versus tables.** An OID on a template is collected as written, so an
OID naming one row of a table (`…ifSpeed.3`) collects that row only, and
follows whatever sits at index 3 the day it is polled. Anything that is a
_list_ — tunnels, radios, fans, neighbours — belongs in an
[SNMP table](#snmp-tables) instead, which walks every row and follows rows as
they come and go (the Zabbix equivalent is a low-level discovery rule with item
prototypes). Per-port interface data needs neither: the interface walk covers
operational status, in/out bits per second, utilization and a _combined_
errors-per-second rate; per-direction errors, discards, admin status and link
speed are collected into the device's interface inventory but are not yet time
series, so they cannot be alerted on today.

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

### SNMP Tables

Some of what a device knows is a **list**: one row per IPsec tunnel, Wi-Fi
radio, SSID, fabric neighbour, fan or power supply. An SNMP table is defined by
its **columns**, and every row is walked on every poll — a tunnel that is added,
renamed or deleted is followed without anyone editing anything.

A table definition lists:

| Field        | What it does                                                                                                                                                                                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name and key | What the table is called. The key (letters, digits and underscores, derived from the name if left blank) is what criteria, metrics and template variables refer to, so renaming a table never breaks an alert.                                                                                                                         |
| Kind         | What the rows are — VPN tunnels, Wi-Fi access points, Wi-Fi radios, Wi-Fi SSIDs, routing neighbours, hardware, or generic. Wi-Fi kinds drive the device's [Wi-Fi tab](#the-wi-fi-tab).                                                                                                                                                 |
| Columns      | The **column OIDs** to collect (the table entry's OID plus the column number, for example `1.3.6.1.4.1.2604.5.1.6.1.1.1.1.9` for a Sophos tunnel's status), each with a name and optionally a unit, a role (status, band, channel, channel width, TX power, clients, noise floor, utilization, SSID), value labels and healthy values. |
| Row names    | Optional columns whose values name each row — a tunnel's connection name, a radio's band. Without them rows are named by their index. A name column can come from a sibling table that shares the index (Fabric Engine names IS-IS adjacencies from `rcIsisAdjHostName`), or from a parent table whose index starts this table's (Aruba Instant names each radio by its access point). A table indexed by a name (ArubaOS indexes its SSIDs by the SSID) is named by its decoded index. |
| Row limit    | How many rows to keep, 100 by default, 250 at most.                                                                                                                                                                                                                                                                                    |

**Values.** Numbers are read as numbers, and text that _starts_ with a number is
read as that number — `"36"`, `"-95 dBm"`, `"80MHz"` — because plenty of
vendors put numbers in strings (Cambium's channel, EXOS's memory). Set a
column's value type to **Text only** for values that merely look numeric.
**Value labels** turn enumerations into words (`0=inactive, 1=active`): the raw
value is still what is charted and compared numerically, the label is what is
shown. **Healthy values** (`1`) say which values mean "fine": they colour the
row on the device's **SNMP Tables** tab and drive the
**SNMP Table Row Is Unhealthy** criteria.

Some vendor template columns also **adjust** the number they read, for MIBs
that keep a value in a unit of their own: ArubaOS reports transmit power
doubled (read × 0.5), Aruba Instant the noise floor without its sign (× −1),
Aerohive the noise floor plus 256 (− 256), Extreme's controller the channel
width in 20 MHz steps (× 20). The adjusted number is what is shown, charted
and compared — so **Noise Floor Greater Than -80** means the same on every
vendor — and the table editor shows the arithmetic under the column.

**Where tables come from.** On an [OID Collection Template](#oid-collection-templates)
(shared by every linked device, up to 10 tables) or on the device itself under
Settings → **Polling & Data Collection** → **SNMP Tables** (up to 10 more). They
merge by key on every poll, template first; a device table with the same key
replaces the template's. Both editors offer **Add a vendor's tables**.

**What a poll does with them.** The probe walks each column as a subtree, within
a 30-second budget shared by every table on the device. A table that cannot be
walked reports why and never fails the poll: the device's **SNMP Tables** tab
keeps its last good rows and says the latest walk failed, while criteria judge
only what _this_ walk produced, so a timeout is never mistaken for an empty
table. Every numeric cell is recorded as the metric
`oneuptime.monitor.snmp.table.value`, with the attributes `snmpTableKey`,
`snmpTableName`, `snmpTableColumn`, `snmpTableColumnOid`, `snmpTableRow` and
`snmpTableRowIndex` — so a dashboard can chart every tunnel's status or every
radio's transmit power, and a Metrics monitor can **Group By** `snmpTableRow`.

### The Wi-Fi Tab

A device whose walk includes a Wi-Fi table — access points, radios or SSIDs,
as the Wi-Fi vendor templates bring them — gets a **Wi-Fi** tab: access points
up (on a controller), radios on, clients and SSIDs at a glance; then every
access point a controller manages, with its state, radios and clients; every
radio's band, channel, **frequency**, channel width, transmit power, clients,
noise floor and airtime; and every SSID with its band and clients. Columns are
found by their role, so any vendor's tables that tag their columns render the
same way.

Vendors split these facts differently, and the tab puts them back together:

- Frequency is worked out from the band and channel using the 802.11 channel
  plan (2.4, 5 and 6 GHz). A controller that reports the frequency where its
  MIB says channel (Extreme's) is read the other way round.
- A radio that reports no band is placed by its channel: 1–14 is 2.4 GHz,
  32–177 is 5 GHz, and a number only 6 GHz uses (37, 53, 181…) is 6 GHz.
- UniFi reports channel, transmit power and clients per SSID: a radio takes
  them from the SSIDs on its band.
- Aruba counts clients per radio: an access point's clients are its radios'.
- An interface that broadcasts no network (IQ Engine lists every interface,
  N/A for those) is not listed as an SSID.

A device that reports no Wi-Fi yet has the tab name its vendor's template —
matched from the last poll the way auto-apply matches it — and apply it with
**Apply Template**; the radios appear after the next poll.

### Supported Wi-Fi Vendors

What each Wi-Fi vendor reports over SNMP, and what only its cloud has:

| Vendor | Access points and controllers | Vendor template | Read over SNMP | Needs the vendor's cloud API (not built) |
| --- | --- | --- | --- | --- |
| Cambium Networks | Enterprise Wi-Fi access points (cnPilot, XV, XE, XH) | Cambium Networks Enterprise Wi-Fi (cnPilot, XV, XE, XH) | Every radio's band, channel, width, TX power, clients, noise floor, airtime and state; SSIDs; CPU, memory | Fleet views in cnMaestro |
| Ubiquiti UniFi | UniFi access points (UAP, U6, U7, UK) | Ubiquiti UniFi Access Points | Every radio's band and airtime; every SSID's channel, clients and TX power; CPU per core, memory | Per-client data and site views in the UniFi Network application |
| HPE Aruba | Instant clusters (AOS 8), through their virtual controller | HPE Aruba Instant (AOS 8) | Every access point's status, CPU and memory; every radio's channel, TX power, noise floor, utilization, clients and state; SSIDs with clients | — |
| HPE Aruba | Mobility Controllers (AOS 8) | HPE Aruba Mobility Controller (AOS 8) | Every managed access point's status; every radio's band, channel, TX power, utilization and clients; SSIDs with clients; the controller's CPU and memory | — |
| HPE Aruba | Access points on AOS 10, managed by Aruba Central | — | Reachability (ping) | Radios, SSIDs and clients: the Aruba Central API |
| Extreme Networks | IQ Engine (HiveOS) access points | Extreme Networks IQ Engine (HiveOS) Access Points | Every radio's channel, TX power and noise floor; SSIDs; CPU, memory, clients, temperature | Client and fleet views in ExtremeCloud IQ |
| Extreme Networks | ExtremeCloud IQ Controller (formerly Extreme Campus Controller) and ExtremeWireless controllers | Extreme Networks Wireless Controller (XIQ-C, ExtremeWireless) | Every access point's state and clients; every radio's band, channel, width, noise floor and busy airtime; WLANs with clients | — |
| TP-Link | Omada access points (EAP) | TP-Link Omada Access Points (EAP) | The client count, on firmware with TP-Link's EAP client MIB | Radios, channels and SSIDs: the Omada Controller API |
| Juniper | Mist access points | — | Reachability (ping); access point up and down through Mist's webhooks | Everything else: the Mist cloud API |

The templates are matched from each device's `sysObjectID` and `sysDescr`,
so auto-apply, the **Apply Vendor Template** bulk action's _Match each
device's vendor_ and the Wi-Fi tab pick them without being told — except
TP-Link's, which you apply by hand. Turning SNMP on, per vendor:

- **Cambium**: in cnMaestro SNMP is set per AP Group (Configuration → Wi-Fi
  Profiles → AP Groups → Management → SNMP), with a v2c community or a v3
  user. Add each access point.
- **Ubiquiti UniFi**: turn on SNMP in the UniFi Network application, which
  sets it on the devices it manages. Add each access point.
- **HPE Aruba Instant**: turn SNMP on for the cluster and add its virtual
  controller's address as one device — it answers for every access point.
- **HPE Aruba Mobility Controller**: add the controller; campus access points
  do not answer SNMP themselves.
- **Extreme IQ Engine**: turn SNMP on in the network policy ExtremeCloud IQ
  pushes to the access points, and add each access point.
- **Extreme wireless controllers**: turn SNMP on in the controller's
  administration settings and add the controller.
- **TP-Link Omada**: turn SNMP on for the site in the Omada Controller
  (Network Config → SNMP), add the access points, and apply the template from
  their Settings or with **Apply Vendor Template**.
- **Juniper Mist**: Mist access points do not answer SNMP. Add them as
  ping-only devices for reachability, and send Mist's _device-updowns_
  webhook to an [Incoming Request monitor](/docs/monitor/incoming-request-monitor)
  to turn an access point going offline into an incident.

A controller's table keeps up to 250 rows: on a controller with more than 250
access points, or radios, the rest are not listed, and the table says so. Its
access point and client counts are health OIDs, and count everything.

### Transceivers

The SFP, SFP+, SFP28 and QSFP optics in a device's ports are read on every poll that walks interfaces — there is nothing to switch on and no template to apply. For each optic OneUptime keeps:

- **What it is** — vendor, part number, serial number, revision, type and wavelength, as the optic itself reports them. Third-party optics (FS.com, FLEXOPTIX, Carritech and the rest) read the same as the switch vendor's own.
- **Its readings** — temperature, supply voltage, laser bias current, and transmit and received power, from its digital optical monitoring (DOM, also called DDM). A QSFP reports power and bias per lane.
- **The device's own thresholds** — the low and high warning and alarm limits the switch reports for each reading. An optic is judged against those and nothing else: OneUptime never invents limits of its own.
- **A month of received power** — the daily average of the weakest lane over the last 30 days. A dirty connector, a bent fibre or an optic wearing out shows up here weeks before the link drops.

The device's **Interfaces** tab opens with a **Transceivers** card: problems first, then one row per optic with its port, what it is, a status in words and its readings. A reading past a threshold is coloured and named (**Low alarm**, **High warning**), and a small chart of the month's received power sits beside the RX value; a QSFP's row shows its worst lane. Click a row for every lane against every threshold, the received power trend with its best day, and the optic's identity. A device that reports no optics — copper ports only, or an agent that does not expose them — shows no card at all.

| Status        | Means                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Healthy       | Every reading the device has thresholds for is inside them.                                                                    |
| Warning       | A reading is at or past a warning threshold.                                                                                   |
| Alarm         | A reading is at or past an alarm threshold, or the device flags a loss of signal or a transmitter fault.                      |
| Not detected  | The port had an optic and no longer reports one, while the port is still enabled. The page still names what used to be there. |
| No thresholds | The optic reports readings, but the device reports no limits to judge them by. Alert on them with **SNMP Transceiver Reading**. |
| Detected      | The optic reports no diagnostics at all — usual for copper SFPs and direct-attach cables.                                      |
| Port disabled | The port is administratively shut, so its laser is off by design: its readings are shown but never judged.                    |

**Where the readings come from.** The device's `sysObjectId` picks the MIB — the vendor's own table first where it carries what the standard one does not, ENTITY-SENSOR-MIB as the fallback:

| Devices                                   | Read from                                                                          | Thresholds |
| ----------------------------------------- | ---------------------------------------------------------------------------------- | ---------- |
| Cisco                                     | CISCO-ENTITY-SENSOR-MIB, matched to ports through ENTITY-MIB                       | Yes        |
| Arista                                    | ENTITY-SENSOR-MIB, with ARISTA-ENTITY-SENSOR-MIB thresholds                        | Yes        |
| Juniper                                   | JUNIPER-DOM-MIB, with per-lane readings for multi-lane optics                      | Yes        |
| HPE Comware and H3C                       | HH3C-TRANSCEIVER-INFO-MIB                                                          | Yes        |
| HPE Aruba ProCurve / ArubaOS-Switch       | HP-ICF-TRANSCEIVER-MIB                                                             | Yes        |
| MikroTik RouterOS                         | MIKROTIK-MIB (`mtxrOpticalTable`), with loss of signal and transmitter fault flags | No         |
| Cambium Networks cnMatrix (4.5 and later) | CAMBIUM-NETWORKS-TRANSCEIVER-MIB                                                   | No         |
| Every other device                        | ENTITY-SENSOR-MIB (RFC 3433), matched to ports through ENTITY-MIB                  | No         |

**What it costs.** The first poll reads everything. Every later poll reads only what changes — the readings, and the serial numbers that tell a swapped optic apart — and the rest (thresholds, identity, which optic sits in which port) is read again when an optic is inserted, removed or swapped, and at least once an hour. A device with none of these MIBs costs one request per MIB tried. The read has its own 20-second budget, and a read that times out or is cut short keeps the device's last good optics rather than reporting them gone.

**Not detected, carefully.** An optic missing from an enabled port shows as **Not detected** on the page straight away, and counts as missing for alerting after two polls in a row, so an agent that answers empty once pages nobody. An optic pulled out of a port that is shut is simply forgotten. A muted interface keeps its optic on the page and is never alerted on.

**Metrics.** Every reading is also a device metric, one series per port and lane, in the units the page shows: `oneuptime.monitor.snmp.transceiver.temperature` (°C), `oneuptime.monitor.snmp.transceiver.voltage` (V), `oneuptime.monitor.snmp.transceiver.bias.current` (mA), `oneuptime.monitor.snmp.transceiver.tx.power` and `oneuptime.monitor.snmp.transceiver.rx.power` (dBm), with the attributes `interfaceName`, `interfaceIndex` and `lane`. A dashboard can chart a link's light over months, and a Metrics monitor can alert on it.

**OneUptime AI.** An investigation of an incident or alert raised by a Network Device monitor starts with the optics of the ports it is about — still detected or not, every reading against the device's thresholds, and the received power of the last weeks — and the AI can read any device's optics when you ask about them.

### Device Identity

After the first successful **walk**, OneUptime reads the SNMPv2 system group and (where supported) the ENTITY-MIB, and fills in the device record automatically: system name, description, location, contact, uptime, vendor, model, serial number and firmware version. The vendor's registered enterprise OID (`sysObjectId`) is used as the device fingerprint to derive the vendor name and suggest a matching vendor OID template.

A ping-only device keeps the name and address you (or a discovery scan) gave it — there is no SNMP agent to ask for anything better.

## Discovering Devices with a Network Scan

Instead of adding devices one at a time, you can sweep a range of addresses:

1. Go to **Network** -> **Discovery** and click **Start Scan** — or click **Discover Devices** on the Network **Overview**, which opens the same form
2. On the first step, **Scan Target**, type the range, check the **Probe**, and decide whether to **Check SNMP on hosts that answer**
3. With SNMP on, the second step, **SNMP Credentials**, asks for the credentials to try. With it off there is no second step: the scan is a [ping-only scan](#ping-only-scans) and **Start Scan** is on the first page
4. Click **Start Scan**

| Field                                            | Description                                                                                                                                                                                                                                                            | Required            |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Scan Target                                      | The address space to scan, in [CIDR or octet-range notation](#scan-target-notation)                                                                                                                                                                                    | Yes                 |
| Probe                                            | Which probe should run the sweep. A project with exactly one custom probe starts on that one                                                                                                                                                                           | Yes                 |
| Check SNMP on hosts that answer                  | A scan normally starts by pinging the range; this decides whether the hosts that answer are then queried over SNMP for their name and vendor. Turn it off for a [ping-only scan](#ping-only-scans). Chosen when the scan is created and fixed after that (default: on) | No                  |
| SNMP credentials                                 | The second step. Same fields as on a device (v1/v2c community string, or the full v3 credential set) — tried against every host in the range                                                                                                                           | If Check SNMP is on |

Folded under **More fields** on the first step, for the scans that need them:

| Field                                            | Description                                                                                                                                                                                                                | Required |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Name                                             | What the scan is for, so you can tell it apart from other scans. The list shows the scan target when this is empty                                                                                                         | No       |
| Look up Windows names (NetBIOS)                  | Ask each host that has no SNMP system name for its NetBIOS name — its Windows computer name — over UDP port 137. That name is used ahead of the host's reverse-DNS name. Private addresses and custom probes only — see [NetBIOS names](#how-discovered-devices-are-named) (default: on) | No       |
| Name devices by their short hostname             | Name imported devices by the first part of a fully qualified hostname — `core-sw-01` instead of `core-sw-01.corp.example.com`. See [how discovered devices are named](#how-discovered-devices-are-named) (default: off)    | No       |
| Repeat this scan                                 | Re-run the scan on an interval (**Rescan Interval (Minutes)**) to keep discovery continuous — see [auto import rules](#importing-automatically-with-auto-import-rules) (default: off)                                       | No       |

The scan runs from the selected probe and reports how many hosts were scanned and how many answered — how many responded to SNMP, or, on a ping-only scan, how many answered ping. Click **Review Results** on a completed scan, select the devices you want, and click **Import Selected**.

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

**Every host a scan finds imports as a probe-polled device**, with the scan's probe assigned and polling on, so it has a status from its first poll. What differs between hosts is not _how_ they are monitored but _what rides along_:

- **Hosts that answered SNMP** import with the responding IP as the hostname, the device's reported system name as the display name, and the scan's SNMP credentials — so a v3 scan imports ready-to-walk v3 devices that start collecting interfaces and inventory immediately.
- **Hosts that answered ping but no SNMP** — every host a [ping-only scan](#ping-only-scans) finds, and the ICMP-alive hosts an SNMP scan could not identify — import with no credentials. The probe pings them on their schedule; add SNMP credentials (or a credential profile on the device or its site) later and the same probe starts walking them as well.

Devices that are already registered are flagged and skipped. Bind a [Ping](/docs/monitor/ping-monitor) or [IP](/docs/monitor/ip-monitor) monitor to an imported device only if you want that monitor's incidents — an [alert policy](#alert-policies) is usually the better answer at fleet scale.

**Vendor templates on import.** When a scan found SNMP hosts, **Review Results** offers **Apply each SNMP host's vendor template on its first poll (recommended)**, on by default: each imported SNMP device gets the [vendor template](#vendor-health-templates) for what its first walk reports — its health OIDs and SNMP tables — as devices an auto import rule brings in do. A device whose vendor has no template is left as it is. Turn the switch off for a batch that should start without.

### How discovered devices are named

A discovered host is named by its own name first, then by its DNS name, then by its address — the first of these it has:

1. **SNMP system name** (`sysName`) — the name the device reports for itself. A placeholder such as `localhost`, or an IP address, does not count as a name.
2. **NetBIOS name** — the computer name a Windows or Samba host reports for itself, when the scan has **Look up Windows names (NetBIOS)** on. It keeps the case the host reports: `WB0024KDS03`.
3. **Reverse-DNS name** — the host's PTR record, which the probe looks up after the sweep.
4. **IP address** — when it has none of the above.

The device's own names come first because they are the names the people who run it use: a Windows host called `WB0024KDS03` keeps that name even when its reverse zone calls it `wb-0024-kds03.wbhq.com`. The reverse-DNS name is not lost: **Review Results** shows it beside the address, and the device keeps it as its **DNS Name**. NetBIOS cuts a computer name to 15 characters, so a NetBIOS name that is the start of a longer reverse-DNS name (`WB-0024-KITCHEN` for `wb-0024-kitchen-display-03.wbhq.com`) gives way to the reverse-DNS name. Label and owner rules match on the device name, so a pattern written against DNS names (`*.wbhq.com`) does not match a device named by its own name; site assignment rules also try the DNS Name, so they keep matching.

**Review Results** shows that name, and the device gets the same name whether you import it from there or an [auto import rule](#importing-automatically-with-auto-import-rules) does. The device's hostname is always the IP address.

**Short names.** Turn on **Name devices by their short hostname** and a fully qualified name is cut to its first label: `core-sw-01.corp.example.com` imports as `core-sw-01`. This applies to a reverse-DNS name and to a sysName that is a fully qualified hostname. Anything else — `Core Switch`, `ubuntu-22.04`, an IP address — is left as it is. The option changes only what devices are called, so it needs no rescan: Review Results and auto import rules use it the next time they name a host, and devices already imported keep their names. Label and owner rules match on the device name, so a pattern written against full names (`*.corp.example.com`) will not match short names.

**DNS Name.** A device imported from a host with a reverse-DNS name keeps the full name as its **DNS Name**, whether or not the scan uses short names. It is shown on the device's Overview, the **Devices** list search matches it, and site assignment rules match hostname patterns against it — so a `*.store-0660.corp.example.com` rule keeps placing a device whose name has lost its domain. A NetBIOS name is never stored as a DNS Name: the host reports it about itself, and it is not a DNS record.

**Shortening devices you already imported.** Select them on the **Devices** list and use **Shorten Names to Hostname**. The confirmation shows how many devices will be renamed, with examples. A device with no DNS Name keeps its full name as its DNS Name, unless that name is also its SNMP system name or is long enough to have been cut short at import. A device is skipped when another device already has its short name, when two selected devices would get the same short name, or when its name changed after you selected it. Site assignment rules run again for every renamed device; label and owner rules do not — use [Run Now](/docs/configuration/run-rules-now) on a rule that matches device names. Existing Ping monitors keep their names, and metric series labelled with the device name start a new series under the new name.

**NetBIOS names.** Windows and Samba hosts often have no SNMP agent, so without this they are listed by a reverse-DNS name that may not be the name their owners use, or by address. With **Look up Windows names (NetBIOS)** on, the probe asks each host that has no SNMP system name for its NetBIOS name after the sweep, with an NBSTAT query to UDP port 137 — hosts with no reverse-DNS name first. The option is on for new scans and off for scans created before it existed. Turning it on or off keeps the scan's results and takes effect the next time the scan runs. It is best-effort:

- Only hosts at private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) and carrier-grade NAT (`100.64.0.0/10`) addresses are asked. Public addresses never are.
- Global probes never send the queries, whatever the scan says. Run the scan from a [custom probe](/docs/probe/custom-probe) inside the network, and allow UDP 137 from the probe and the replies back — the custom probe page has the firewall details.
- The name keeps the case the host reports (`FILESRV01`), and is used only when it is 1–15 characters, a valid hostname label, and contains a letter. **Name devices by their short hostname** has nothing to cut from it.
- The lookup asks at most 2,000 hosts per scan, hosts with no reverse-DNS name first, and adds up to about a minute to the end of the scan (a custom probe can raise both with `PROBE_DISCOVERY_NETBIOS_MAX_HOSTS`). When the cap or that time limit stops it short, the scan's status message says how many hosts were left unasked. A host that does not answer keeps its reverse-DNS name, or its IP address, as its name.
- NBSTAT queries to many hosts can trip intrusion detection rules. Turn the option off on scans of networks where that matters, or tell your security team first.

**When a host has no name.** A host listed by its address in **Review Results** shows **No name found** and an (i) beside it. Hover or focus the (i) to see what each way of naming it came back with:

- **SNMP** — the scan did not check SNMP, the host did not answer it, or it answered with no system name, or with one that is not usable as a name (such as `localhost` or an IP address).
- **NetBIOS** — the option is off for the scan, the scan ran on a global probe, the address was not asked (a public address, or the host or time limit was reached), or the host did not answer on UDP 137.
- **Reverse DNS** — the probe's DNS server has no PTR record for the address, returned a record that is not a valid hostname, did not answer in time, answered with a server failure (SERVFAIL), refused the query, or could not be reached. Or the address was never looked up, because the scan ran out of time for name lookups or the probe's DNS server was not answering at all.

The probe looks names up through its own DNS servers — the ones in `/etc/resolv.conf` where it runs: the host's for the bundled Docker Compose probes, the cluster's DNS for a probe in Kubernetes. They may not be the servers your workstation asks, so when a host you know has a PTR record shows "no PTR record", run `nslookup <address>` from inside the probe's container or pod to compare. The first attempt asks the first nameserver listed there. A lookup that times out or fails is retried once while the scan's time for name lookups lasts, asking each configured nameserver in turn (up to three), and only the first nameserver's "no PTR record" is taken as final. When lookups still fail, the scan's status message says for how many hosts, and a rescan tries again. Names in the probe's `/etc/hosts` are used before DNS is asked.

**Better names found later.** A scan does not always find a host's best name the first time. The partial results a running scan uploads carry no names, because reverse-DNS and NetBIOS names are looked up once, after the sweep, so a host imported from them — by an auto import rule, or from Review Results while the scan is In Progress — is named by its IP address at first. A NetBIOS reply can be lost, and a host can get an SNMP agent after it was imported. So a device discovery names remembers where its name came from, and when a completed scan of its address finds a better one — its SNMP system name or NetBIOS name instead of its reverse-DNS name, any name instead of its IP address — the device is renamed to the name an import would give it now, and its DNS Name is filled in if it has none. If another device already has that name, the device is named with its address in brackets (`FILESRV01 (10.0.0.5)`), and if that is taken too it keeps its name. A name is only ever improved: a device keeps its name when its DNS record changes, or when a later scan gets no NetBIOS reply. A device that has a DNS name is renamed only by a scan that finds that same DNS name at its address, so when the address now belongs to another machine (a DHCP lease that moved, say) the device is not given that machine's name. While a device's name is still the one discovery gave it, its **Overview** shows where it came from as **Name Source**. A device you renamed — on its Settings page, through the API, or with **Shorten Names to Hostname** — is never renamed by a scan. Devices imported before discovery recorded where names came from keep their names, except that one a still-running scan imported by its IP address is renamed when that scan completes.

### Importing Automatically with Auto Import Rules

Reviewing every scan by hand does not scale past the first few subnets.
**Network** -> **Rules** -> **Auto Import Rules** is where you write the
import down once: a rule says which discovered hosts to claim (a host IP range,
and optional system name, description and sysObjectID patterns), and optionally
which [Monitor Template](#alert-policies) and [OID Collection
Template](#oid-collection-templates) the devices it imports are given. A rule
marked as an **exclusion** claims nothing and vetoes the others, which is how
printers and phones are carved out of a broad subnet rule.

Rules have no schedule of their own, and do not need one. Enabled rules run by
themselves against each scan's results as they arrive — including the partial
results a long sweep uploads while it is still running, so hosts are
importable within a minute of being found rather than at the end of the range.
Turn on **Repeat this scan** on a discovery scan and the pair becomes a
standing arrangement: the scan re-sweeps its range on your interval, and every
new host it finds is imported without anyone pressing anything.

Saving a rule also applies it to the results the project _already_ has. A rule
you write or enable today reaches hosts discovered in the last 24 hours within
about a minute, so a rule written after a one-shot scan is not left waiting for
a scan that will never run again. Results older than that are left alone —
importing an estate discovered last month is a decision, not a side effect of
saving a rule — and the buttons below are how you make it.

Two buttons on a rule reach _every_ scan in the project, however old:

- **Dry Run** evaluates every completed scan and reports what the rule would
  import and monitor. Nothing is written, so it is the safe way to answer "what
  would this claim" before enabling a rule against a live estate. A disabled
  rule can be dry-run; only a real run requires it to be enabled. That is why
  a rule created from the dashboard starts with **Enabled** off: dry-run it,
  then switch it on.
- **Run Rule** does the same evaluation and performs the import.

**Who may run a rule.** A run reaches every scan of the project, so pressing **Dry Run** or **Run Rule** takes permissions that reach the whole project: permission to edit the rule, to create network devices and - when the rule has a Monitor Template - to create monitors, each scoped to all resources in the project. A permission restricted to labels or to owned devices is not enough, and a team's block with labels on creating devices or monitors refuses the run. A site assignment or device label rule's **Run Now** takes permission to edit the rule and to edit network devices, reaching the whole project the same way (see [Run Rules on Existing Resources](/docs/configuration/run-rules-now#before-you-begin), which names each permission).

**Large estates import in paced batches.** Device and monitor creation each run
the full service pipeline — site assignment, owners, labels, and for monitors
the plan, status and status-page machinery — so a run creates a few hundred of
each at a time rather than tens of thousands in one burst. One press of **Run
Rule** drives as many of those batches as the estate needs and reports the
total, so a scan of 900 routers is one press, not two. If a run does stop with
work outstanding, the report says exactly how much is left ("Stopped at the run
cap with 409 active Network Device monitors still to create") and pressing the
button again continues — hosts already imported and monitors already created
are skipped, so re-running is never additive.

Two counts in that report are worth reading together. Devices and monitors are
separate work with separate limits: a rule that gains a Monitor Template after
its devices were already imported creates **no** devices at all and only
monitors, and reports itself that way.

### Ping-Only Scans

Turn **Check SNMP on hosts that answer** off and the scan becomes a plain ICMP sweep: it pings every address in the range, reports the ones that answered, and sends no SNMP packet at all. The SNMP Credentials step disappears from the form — it is one page, with **Start Scan** on it — so no version, community string or v3 credential is asked for, and none is stored on the scan.

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

**The recommended policy.** With no policies yet, the page offers to create one for you: a _Network device alert pack (recommended)_ monitor template — the [alert pack](#recommended-alert-pack) below — plus an _Alert on every device_ policy that applies it to the whole project. The template is found again by a marker in its description, so the action never mints a second copy. That template is a real, editable monitor template you can use for hand-built monitors today, whether or not the policy beside it is provisioning anything. Narrow the policy's scope afterwards if the whole project is too much.

### One device at a time

The quickest path: open the device's page and click **Create Monitor** on the "Monitors alerting on this device" card. The monitor create form opens with the Network Device type and the device pre-selected, and the [Recommended Alert Pack](#recommended-alert-pack) criteria pre-filled — review, adjust severities and on-call policies, and save.

Or by hand:

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Network Device** as the monitor type
4. Pick the registered **Network Device** to alert on — everything about data collection (hostname, credentials, polling schedule, interface walks, health OIDs) comes from the device; the monitor only chooses what to alert on via its criteria

Network Device monitors have no polling interval of their own: they are evaluated server-side every time the device's poll results arrive, and every time a matching trap arrives.

### Custom Field Defaults

If your project defines Monitor Custom Fields (**Monitors** -> **Settings** -> **Custom Fields**) — Vendor, Configuration Item, owning service, whatever your CMDB needs — a monitor template can fill them in for you. **Monitors** -> **Settings** -> **Templates** -> open a template -> **Custom Field Defaults**.

Every monitor made from that template afterwards is created carrying those values — the ones a person creates with **Create Monitor from Template**, and, the case this exists for, the ones an auto-import rule creates when a [discovery scan](#discovering-devices-with-a-network-scan) brings in a thousand devices at once. Without defaults, those thousand monitors arrive with every custom field empty and the only way to fill them is one monitor at a time.

Two things to know:

- **A field left blank on the template is not a default.** A blank leaves each monitor to answer that field for itself, so a template can default Vendor across a whole switch fleet while Configuration Item stays a per-device answer.
- **Defaults apply at creation time.** They do not reach monitors that already exist — which is exactly the fleet you have if you set them up after a scan has already run. **Sync Custom Fields to Linked Monitors**, on that same card, is what pushes them onto the existing fleet. It overwrites the fields the template defaults, including values somebody typed in by hand, and the confirmation names those fields before it runs. Fields the template leaves blank are still left alone, so a sync can never blank a value.

Custom field defaults are the one thing a plain **Sync from Template** leaves alone: pushing criteria or an interval never rewrites the values on your monitors.

## Monitoring Criteria

You can set up criteria to check poll results and trigger alerts or incidents.

### Available Filter Types

| Filter Type                        | Description                                                                                                                               | On a ping-only poll |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| SNMP Device Is Online              | Whether the device is reachable — by ping **or** SNMP. This is the same verdict as the status pill.                                       | Evaluated           |
| SNMP Walk Is Succeeding            | Whether the last SNMP walk succeeded. False is the "SNMP failing" state: reachable, but interfaces and inventory have stopped refreshing. | Not evaluated       |
| SNMP Response Time (in ms)         | The **walk's** response time in milliseconds — never the ping's RTT                                                                       | Not evaluated       |
| SNMP OID Value                     | Check the value returned by a specific OID                                                                                                | Not evaluated       |
| SNMP OID Exists                    | Check if an OID returns a value (not null)                                                                                                | Not evaluated       |
| SNMP Interface Is Down             | True when any administratively-enabled interface is operationally down                                                                    | Not evaluated       |
| SNMP Interface Utilization (in %)  | Check the busiest interface's link utilization                                                                                            | Not evaluated       |
| SNMP Interface Errors (per second) | Check the worst interface's error rate                                                                                                    | Not evaluated       |
| SNMP Table Value                   | Compare one column of an [SNMP table](#snmp-tables) row by row; met when any row in scope matches. Row `*` raises one alert per row       | Not evaluated       |
| SNMP Table Row Is Unhealthy        | True when a row in scope has a status outside its column's healthy values. Row `*` raises one alert per row                               | Not evaluated       |
| SNMP Table Row Count               | Compare how many rows a table (or the rows in scope) has                                                                                  | Not evaluated       |
| SNMP Transceiver Not Detected      | True when a port that had an optic has not reported one for two polls in a row, while the port is enabled                                | Not evaluated       |
| SNMP Transceiver Past Alarm Threshold | True when an optic's reading is at or past an alarm threshold the device reports, or the device flags a loss of signal or a transmitter fault | Not evaluated |
| SNMP Transceiver Past Warning Threshold | The same at the warning thresholds; an optic past an alarm threshold counts too                                                      | Not evaluated       |
| SNMP Transceiver Reading           | Compare one reading — RX or TX power (dBm), temperature (°C), supply voltage (V) or bias current (mA) — with a value of your own; met when any lane of any optic in scope matches. For devices that report no thresholds | Not evaluated |
| SNMP Transceiver RX Power Drop (in dB) | How far an optic's received power is below its best daily average of the last 30 days                                               | Not evaluated       |
| SNMP Trap Received (Trap OID)      | Matches when a trap with the given OID arrives from the device                                                                            | n/a — trap-driven   |
| SNMP Trap Varbind Value            | Compare the values a trap carries, optionally one varbind                                                                                 | n/a — trap-driven   |

"Not evaluated" is exactly that, and it matters: on a poll where no walk ran, those criteria return **no verdict** rather than a failing one. A criteria that would open an incident when SNMP response time exceeds a threshold cannot fire on a device that is only pinged, so a ping-only device watched by walk-based criteria is harmless rather than a false-alarm generator.

The interface checks require **Walk Interfaces** to be on in the device's polling settings (it is by default). The OID checks evaluate the device's configured **Health OIDs**. Administratively disabled interfaces are intentionally down and never count as failures.

**SNMP table criteria** pick a table, a column (for Table Value) and a row scope:
empty evaluates every row as one combined alert, `*` raises a separate alert
for every row (each resolves on its own, and its title names the row), and
anything else names one row by its name or index. Numbers compare as numbers;
text compares against both the raw value and its label, so `Not Equal To
active` and `Not Equal To 1` both catch a Sophos tunnel that is down. A table
whose walk failed on this poll is not evaluated, rather than read as empty.
Table criteria judge the current walk only — they are not evaluated over time.

**Transceiver criteria** are scoped like the interface checks: empty judges
every optic as one combined alert, `*` raises a separate alert for every port
with an optic (each resolves on its own, and its title names the port), and
anything else names one port by its name or alias. They judge the device's
[transceivers](#transceivers) as of this poll, which already carry their
history — how many polls an optic has been missing, a month of received power
— so they are not evaluated over time either. A poll whose transceiver read
failed leaves them judging the last good read, so an open alert does not
resolve on a poll that could not look.

### Recommended Alert Pack

Click **Add Recommended Alerts** on the criteria form to append a prebuilt set of criteria — the alerts most network operators want, without hand-building them each time. They are pre-filled automatically when you create the monitor from the device's page, and they are what the [recommended alert policy](#alert-policies)'s monitor template carries.

| Criteria            | Fires when                                                    | Creates  |
| ------------------- | ------------------------------------------------------------- | -------- |
| Device unreachable  | The device stops answering **ping and SNMP**                  | Incident |
| SNMP walk failing   | The device answers ping but its SNMP walk is failing          | Alert    |
| Interface down      | An administratively-enabled interface goes operationally down | Incident |
| Interface saturated | An interface runs above 80% utilization                       | Alert    |
| Interface errors    | An interface logs more than 1 error per second                | Alert    |
| Transceiver not detected | An optic is no longer detected in a port that is still enabled, for two polls in a row | Alert |
| Transceiver past its alarm threshold | An optic's reading is past an alarm threshold the device reports, or the device flags a loss of signal or a transmitter fault | Alert |
| Transceiver RX power dropping | An optic receives at least 2 dB less light than on its best day of the last 30 | Alert |

When the device walks [SNMP tables](#snmp-tables) that declare healthy values,
the pack also adds one **SNMP Table Row Is Unhealthy** criteria per such table,
with Row `*` — an **incident** per row for tunnels, routing neighbours and a
controller's access points ("IPsec Tunnels: row unhealthy", "Access Points: row
unhealthy" for an access point gone from its controller), an **alert** per row
for hardware tables and radios.

The three transceiver criteria raise one alert per port (`*`) and are alerts
rather than incidents for the same reason as the walk: a dark optic already
takes its interface down, and **Interface down** pages for that — these say
why, or warn before it happens. 2 dB is about a third of the light gone: well
past the few tenths of a dB a healthy link wobbles by from day to day, and
early enough to clean a connector before the link loses its margin. None of
them can fire on a device that reports no optics.

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

#### Example: tell apart events that share one trap OID

Some vendors send every event as the same trap and put the event in a text
varbind — every Sophos Firewall notification is `sfosNotification`
(`1.3.6.1.4.1.2604.5.1.8.1.1`) with the message in `sfosTrapMessage`
(`1.3.6.1.4.1.2604.5.1.8.1.2`). Combine the two in one criteria:

- **SNMP Trap Received (Trap OID)** — Equal To `1.3.6.1.4.1.2604.5.1.8.1.1`
- **SNMP Trap Varbind Value** — Varbind OID `1.3.6.1.4.1.2604.5.1.8.1.2`, Contains `IPSec`

A negative filter (Not Contains, Not Equal To, Is Empty) is met only when **no**
varbind in scope matches its positive form. Leave the varbind OID empty to
search every varbind the trap carries.

## Template Variables for Alerts

When creating incident or alert templates, you can use the following variables:

| Variable                                                                | Description                                                                                                     |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `{{isOnline}}`                                                          | Whether the device is reachable by ping or SNMP (true/false)                                                    |
| `{{responseTimeInMs}}`                                                  | SNMP walk time in milliseconds                                                                                  |
| `{{failureCause}}`                                                      | Error message if the SNMP walk failed                                                                           |
| `{{oidResponses}}`                                                      | Array of OID response objects                                                                                   |
| `{{OID_NAME}}`                                                          | Value of a specific OID by name (e.g., `{{sysUpTime}}`)                                                         |
| `{{sysName}}`                                                           | Device name from the SNMP system group                                                                          |
| `{{sysDescr}}`                                                          | Device description from the SNMP system group                                                                   |
| `{{sysObjectId}}`                                                       | Vendor's registered enterprise OID (device fingerprint)                                                         |
| `{{sysLocation}}`                                                       | Device location from the SNMP system group                                                                      |
| `{{downInterfaces}}`                                                    | Array of {name, alias, interfaceIndex} for admin-up but oper-down interfaces                                    |
| `{{interfacesTotal}}`                                                   | Total number of interfaces walked                                                                               |
| `{{interfacesUp}}`                                                      | Interfaces that are administratively and operationally up                                                       |
| `{{interfacesDown}}`                                                    | Interfaces that are administratively up but operationally down                                                  |
| `{{interfaceWalkFailure}}`                                              | Error message when the interface walk failed                                                                    |
| `{{trapOid}}`                                                           | Trap OID — set on trap-triggered checks only                                                                    |
| `{{trapSourceIp}}`                                                      | Source IP the trap came from — set on trap-triggered checks only                                                |
| `{{trapVarbinds}}`                                                      | Array of {oid, value} varbinds carried by the trap                                                              |
| `{{tables.<key>.rowCount}}`                                             | Rows walked in an [SNMP table](#snmp-tables), by its key (for example `{{tables.ipsec_tunnels.rowCount}}`)      |
| `{{tables.<key>.unhealthyRowCount}}` / `{{tables.<key>.unhealthyRows}}` | Rows with a status outside their healthy values, each with `name`, `index` and `values.<column>`                |
| `{{tables.<key>.rows}}`                                                 | Every row (up to 50), each with `name`, `index` and `values.<column>` (column names lower-cased, spaces as `_`) |
| `{{snmpTable}}` / `{{snmpTableRow}}`                                    | On a per-row alert (Row `*`), the table and the row it is about                                                 |

`{{isOnline}}` is filled in on every poll. **Every other variable in that table comes from the SNMP walk**, so on a ping-only poll they are all empty — write templates that lead with `{{isOnline}}` and the device name if a policy's scope might include devices without credentials. The interface and system variables additionally require interface walking to be enabled on the device; the trap variables are only set when the check was triggered by a trap. An incident title like:

```
{{downInterfaces.0.name}} on {{sysName}} is down
```

renders as "Gi0/1 on core-switch-01 is down". See [Incident & Alert Templating](/docs/monitor/incident-alert-templating) for how templating works in general.

## Network Topology

Go to **Network** -> **Topology** -> **Device Topology** for a live map of your network, built from LLDP neighbour data collected during interface walks and complemented by CDP on Cisco estates. Managed devices are filled; unmanaged LLDP peers are hollow. Node colour reflects device status, and clicking a managed device opens it.

For the map to populate:

- Give the devices SNMP credentials — neighbour tables come from the walk, so a ping-only device appears on the map but reports no neighbours of its own
- Keep **Walk Interfaces** on in the device's polling settings — the neighbour tables are walked alongside the interfaces
- Enable LLDP (or CDP on Cisco devices) on the devices themselves

Clicking an unmanaged peer offers **Add to Monitoring**, which registers it as a probe-polled device: it inherits the probe its neighbours agree on, so it is pinged from its first poll, and you add credentials afterwards if it turns out to have them.

### Export the map as a PDF

**Export PDF**, at the top of the map, downloads the map you are looking at as a PDF you can attach to an assessment, a change request or an incident review, or read offline. Every view of the device map has it: **Device Topology**, a site on the **Map**, and the **Network** tab of **Topology**.

The PDF holds:

- **The whole map**, not only the part on screen, drawn as vectors so it stays sharp at any zoom. Every device has its name, its shape for its type and its colour for its status (Up, Down or Unknown). Every link is drawn in its state, and devices with no links are grouped under **Not linked to anything**.
- **Your view of it**: the layout you chose, the devices you dragged, and your filters — hidden node types, the endpoint VLAN, a health filter, or a search, which fades the devices that do not match. The header says which filters were on.
- **The legend**, and a header with the project, the site and the time of the export.
- **Two tables**: every device (type, kind, status, vendor and model, address, interfaces and number of links), and every connection (the port at each end, its state, its utilization and how it was found).

A small site fits on one A4 page. A larger network gets a larger first page, so device names stay readable when you zoom in, and the tables follow on A4 pages. The PDF is always light, whichever theme you use, and is made in your browser from the map on screen. Its text is in English. Names in scripts its built-in font cannot draw, such as Chinese, Japanese or Cyrillic, are replaced, and the PDF says so.

### Ping and traceroute from the map

Clicking a managed device on the map opens its drawer, and the drawer's **Connectivity** section answers the two questions that usually follow "is it up?": how has it been, and can I reach it right now.

- **Round-trip time, past hour** is a sparkline of the device's ping round-trip time from its own polls, with the current, average and peak values under it and the hour's worst packet loss beside them. It reads the same series the device's Metrics page charts, and **Open metrics** takes you there. A device that has not been pinged in the last hour shows "No ping data in the last hour."
- **Ping** sends five ICMP echo requests to the device and reports whether it answered, the minimum, average and maximum round-trip time, the jitter, and the packet loss. A device that answers some but not all of them is reported as reachable with packet loss.
- **Traceroute** reports the hop-by-hop path from the probe to the device — the hop number, the host that answered and its round-trip time — with timed-out hops marked `* * *` and the hop the route broke at named when it did not reach the device.

Both run from the device's **assigned probe** (Device -> **Settings**), not from the OneUptime server, so the answer is the view from where the device is actually monitored. The probe picks the request up within about ten seconds and the result appears in the drawer as soon as it reports back; if the probe has not answered within two minutes the drawer says so and suggests checking that the probe is online and running a version that supports on-demand diagnostics. A device with no probe assigned shows a note pointing at Settings instead of the buttons. Running a diagnostic needs the **Create Network Device Diagnostic** permission (project members have it); without it the buttons are not shown, though the round-trip trend still is.

Results are transient: each run is kept for two days and then deleted.

The same tools are on the device's Overview page, in the **Connectivity tools** card, for when you arrive at the device rather than at the map.

### Ping-only devices and their switch port

A register, a handset, a kiosk or a camera speaks neither LLDP nor CDP, so nothing it reports can place it on the map. Its switch knows, though: every walked switch reports its forwarding table — which MAC it learned on which port — and the map uses that to draw the device's cable, from the switch to the device's own node, with the port and VLAN it was learned on. The link is worked out each time the map loads from the latest walk, so when the device is moved to another port or another switch the map follows on the next poll; nothing has to be redrawn.

For that to happen the map has to know which learned MAC is the device's. Two ways, and you normally need neither by hand:

- **From an ARP table.** When a router at the site — or any walked device whose walk returns an ARP table — has **Collect Connected Endpoints** on, that table binds each address to a MAC, and a registered device whose hostname is that address has its **MAC Address** filled in automatically. A MAC learned this way is corrected when a later walk binds the address to a different MAC (the unit was swapped, or the row was stale); a MAC you typed in is never touched. Devices registered by IP, which is what a discovery import does, need nothing else.
- **By typing it.** Set **MAC Address** on the device (Device -> **Settings**, or the Overview card) when its hostname is a DNS name, or when no router at the site is walked. Any of the usual spellings is accepted.

The switch the device hangs off needs **Collect Connected Endpoints** on as well — that is where the port comes from. The match is made within the device's site: every branch has a `10.0.0.5`, so an address is only ever matched to a device in the same site as the switch that learned it. A MAC matches regardless of site.

Where to see it: the device's Overview page has a **Connected to** card naming the switch, port and VLAN; on the map, the device's drawer shows the same under **Connected to**, and the link's drawer explains that it was learned from the switch's forwarding table. In the Parent-Child view the device is drawn beneath its switch. A link you drew by hand under **Device Links** for the same pair merges with the learned one rather than doubling it — the learned port replaces a mistyped one, and a parent you declared on the hand-drawn link is kept.

![Parent-Child topology view drawing a ping-only register beneath its switch over a learned link](/docs/static/images/NetworkTopologyLearnedLink.png)

![The link drawer explaining that the switch learned the device's MAC address on port Gi0/4](/docs/static/images/NetworkTopologyLearnedLinkDrawer.png)

![The Connected to card on a device's Overview page naming the switch, port and VLAN](/docs/static/images/NetworkDeviceConnectedToCard.png)

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

### Ping-only device is not attached to its switch

The map draws a ping-only device's cable from its switch's forwarding table, which needs three things to line up:

- **The switch collects endpoints** — **Collect Connected Endpoints** on in the switch's polling settings, with credentials that let the walk succeed. The device's own Overview page shows a **Connected to** card once a switch has learned it.
- **The device's MAC is known.** Either the **MAC Address** field is set, or a router at the site collects endpoints and the device's hostname is the IP address that router's ARP table binds. A device registered by DNS name with no MAC cannot be matched — type the MAC in.
- **Same site.** An address is only matched to a device in the same site as the switch that learned it. A device with no site matches by address only when the switch that learned it has no site either; if the switch is on a site, put the device on the same one (a MAC matches regardless of site).

If the device sits behind an unmanaged switch or a hub, the managed switch learns every MAC behind it on one port, and that is the port the map draws — the physical truth from the managed switch's point of view.

### Only some discovered devices were imported

The run report is the answer, and it is on the modal that appears when a run
finishes rather than in a log. A run that stopped at its batch limit says so and
names the remainder — press **Run Rule** again and it continues from where it
stopped. A run that finished but claimed fewer hosts than you expected reports
which bucket the rest fell into: vetoed by an exclusion rule, already registered
at that address, or simply not matched by the rule's criteria.

Watch for the case where the devices are all present but the monitors are not.
Devices and monitors are separate work, so a rule that had a Monitor Template
attached _after_ its devices were imported reports zero devices imported and
only monitors created — that is the rule doing exactly the work that was left,
not a failed import. See [Auto Import
Rules](#importing-automatically-with-auto-import-rules).

### An SNMP table shows no rows

- The device returned nothing under those column OIDs. Walk one from the probe's network (`snmpwalk -v2c -c <community> <device> <column OID>`) — a column the device does not implement simply has no rows.
- The SNMP view your credentials use may not include that subtree; a restricted v3 user often sees only the system group and IF-MIB.
- Sophos tunnel status needs SFOS v20 or later; Cambium client counts read 0 before firmware 6.5.3.
- A Wi-Fi table stays empty until SNMP is turned on where the vendor sets it (see [Supported Wi-Fi Vendors](#supported-wi-fi-vendors)); Juniper Mist access points and Aruba Central's AOS 10 access points do not answer SNMP at all.
- A table listed under **Waiting for the first walk** has not been walked yet — it appears after the device's next successful SNMP poll.

### The Transceivers card does not appear

- The device reports no optics, or none it exposes over SNMP: walk ENTITY-SENSOR-MIB from the probe's network (`snmpwalk -v2c -c <community> <device> 1.3.6.1.2.1.99.1.1.1.1`) — no rows means the agent does not report sensors that way.
- **Walk Interfaces** is off in the device's polling settings: transceivers are read with the interface walk and matched to the ports it finds.
- The SNMP view your credentials use may not include ENTITY-MIB or the vendor's transceiver table; a restricted v3 user often sees only the system group and IF-MIB.
- A Cambium cnMatrix switch reports its transceivers from firmware 4.5 on.

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
9. **Turn on Collect Connected Endpoints on each site's switches and its router** — the switches put every ping-only device on the port it is plugged into, and the router fills in the MAC addresses that make the match, so a site's registers and handsets are cabled on the map without a single link drawn by hand.
10. **Use descriptive OID names** — makes alert messages and template variables easier to read.
11. **Reserve the bound-monitor override for gear a probe genuinely cannot reach** — it turns polling off, and with it interfaces, inventory and the device's own metrics.
