# Network Vendor Guides: Sophos, Extreme and Cambium

How to monitor three common estates end to end with OneUptime: **Sophos Firewall** (XGS, SFOS) for IPsec tunnels, WAN links and SD-WAN; **Extreme Networks** switches (EXOS / Switch Engine and Fabric Engine / VOSS) including the fabric; and **Cambium Networks** cnMatrix switches and Enterprise Wi-Fi access points, down to each radio's channel and transmit power.

Every guide builds on the same pieces:

- A [Network Device](/docs/monitor/network-device-monitor) per box, polled by a probe that can reach it, with a **vendor template** that brings the right health OIDs and [SNMP tables](/docs/monitor/network-device-monitor#snmp-tables).
- A **Network Device monitor** per device for alerting. Create it from the device page so the [recommended alerts](/docs/monitor/network-device-monitor#recommended-alert-pack) — including one per-row alert for each table that knows what healthy looks like — are filled in for you.
- For anything a vendor only reports in its logs: syslog to the probe, a [log pipeline](/docs/telemetry/log-pipelines) to turn the line into attributes, [Logs monitors with Group By](/docs/monitor/logs-monitor#per-group-alerting-group-by) to alert once per tunnel or gateway, and [log recording rules](/docs/telemetry/log-recording-rules) to chart the numbers in those logs.

## Sophos Firewall (XGS / SFOS)

| What you want to see                                                        | Where it comes from                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------------ |
| Firewall health — memory, disk, swap, HA state, IPsec service, CPU per core | SNMP, **Sophos Firewall (SFOS / XGS)** vendor template |
| Every IPsec tunnel's status, by name                                        | SNMP table `ipsec_tunnels` (SFOS v20 and later)        |
| Each WAN link's status, throughput, utilization and errors                  | SNMP interface walk of the WAN ports                   |
| Each WAN link's latency, packet loss and jitter                             | Ping monitors and device polls from OneUptime probes   |
| Gateway up/down, SD-WAN SLA met / not met, SD-WAN route changes             | The firewall's syslog                                  |
| SD-WAN latency, jitter and packet loss per gateway, as charts               | Log recording rules over the SD-WAN SLA logs           |

Sophos does not report gateway or SD-WAN health over SNMP, in any SFOS version. That information exists only in the firewall's logs (and in Sophos Central's alerts), which is why the last three rows go through syslog.

### 1. Register the firewall

1. On the firewall, enable SNMP under **Administration → SNMP**: add an SNMPv3 user (or a v2c community) and allow the probe's address to query it.
2. In OneUptime, go to **Network → Devices → Add Device**, enter the firewall's management address, pick a probe that can reach it, and add the SNMP credentials under **SNMP**.
3. Under the device's **Settings → Polling & Data Collection**, apply the **Sophos Firewall (SFOS / XGS)** template from the _Vendor Health Template_ dropdown and add its tables from _Add a vendor's tables_ — or turn on **Auto-Apply Vendor Health Template** and the first poll does both.

After the next poll the device's **SNMP Tables** tab lists every IPsec connection with its status (active, inactive, partially active) and the CPU cores. SFOS numbers its cores from 196608, which is why CPU comes from a table rather than from a single `hrProcessorLoad.1`.

### 2. Alert on every IPsec tunnel

On the device page, choose **Create Monitor**. The recommended alerts include **IPsec Tunnels: row unhealthy**: an **SNMP Table Row Is Unhealthy** criteria on the `ipsec_tunnels` table with Row `*`, which opens one incident per tunnel that is not active and resolves each one when its tunnel comes back. The incident title names the tunnel.

A tunnel that Sophos reports as active only has its security associations up. To prove traffic actually crosses it, add a [Ping monitor](/docs/monitor/ping-monitor) from a probe at one site to a host on the far side of each tunnel, and draw the tunnel as a [Site Link](/docs/monitor/network-sites) between the two sites bound to that monitor — the link on the network map then takes the monitor's color.

### 3. WAN links

- **Port health.** The interface walk already measures every WAN port's status, bits in and out, utilization and errors. On the firewall's monitor, an **SNMP Interface Is Down** or **SNMP Interface Utilization** criteria with Interface set to the WAN port's name (or `*` for every port) alerts per link.
- **Path quality.** Each link's latency, packet loss and jitter are measured from outside the firewall: a Ping monitor from the OneUptime cloud probes to each WAN link's public address, and a Ping monitor from a probe at the site to each ISP's gateway. Packet Loss and Jitter criteria on those monitors alert per link, and the **Latency Matrix** (**Network → Topology → Latency Matrix**) shows every probe against every device at a glance.
- **Traffic.** SFOS exports NetFlow v5, which the probe receives when `PROBE_NETFLOW_RECEIVER_ENABLED=true` (UDP 2055 by default); top talkers appear on the device's **Traffic** tab.

### 4. Gateways and SD-WAN from syslog

1. **Turn on the probe's syslog receiver.** Set `PROBE_SYSLOG_RECEIVER_ENABLED=true` on the probe (it listens on UDP 5140 by default; `PROBE_SYSLOG_RECEIVER_PORT` changes it) and publish the port if the probe runs in Docker. Messages are matched to the network device whose hostname equals the sender's IP address, and appear on the device's **Logs** tab.
2. **Send the logs.** On the firewall, under **System services → Log settings**, add a syslog server pointing at the probe and that port, and tick the **Event** log types for IPsec and gateways and the **SD-WAN** log type (the SLA logs are off until it is ticked).
3. **Parse them.** Under **Logs → Settings → Pipelines**, create a pipeline whose filter matches the firewall's logs — `attributes.networkDevice.name = 'hq-firewall'` — and add a **Key=Value Parser** processor with Target Prefix `sophos`. Paste a line from the firewall into the processor's tester to see the exact attribute names your SFOS version produces.
4. **Alert per tunnel and per gateway.** Create [Logs monitors](/docs/monitor/logs-monitor) scoped to the firewall's logs, each with **Group by Attributes** so every tunnel or gateway alerts on its own:

| Alert                   | Logs to count                                                          | Group by             |
| ----------------------- | ---------------------------------------------------------------------- | -------------------- |
| IPsec tunnel terminated | attribute `sophos.log_component` = `IPSec`, body contains `terminated` | `sophos.con_name`    |
| Gateway down            | attribute `sophos.log_component` = `Gateway`, body contains `is Down`  | `sophos.gatewayname` |
| SD-WAN SLA not met      | attribute `sophos.log_type` = `SD-WAN`, body contains `SLA not met`    | `sophos.gw_name`     |

Set each monitor's criteria to **Log Count greater than 0** over a few minutes. The syslog events are complementary to the SNMP table: they arrive the moment a tunnel drops, while the table also catches a tunnel that never came up.

5. **Chart SD-WAN quality.** With SD-WAN logging on, the firewall writes an SLA summary per profile and gateway (`latency`, `jitter`, `packet_loss`). Under **Logs → Settings → Recording Rules**, create one rule per number — for example the **average** of `sophos.latency`, grouped by `sophos.gw_name` and `sophos.profile_name` — and chart the results, or alert on them with a [Metrics monitor](/docs/monitor/metrics-monitor) that groups by gateway. [Log Recording Rules](/docs/telemetry/log-recording-rules) walks through this example.

### 5. Traps

Every Sophos notification is the same trap, `sfosNotification` (`1.3.6.1.4.1.2604.5.1.8.1.1`), with the event as text in `sfosTrapMessage` (`1.3.6.1.4.1.2604.5.1.8.1.2`). To alert on one kind of event, combine **SNMP Trap Received (Trap OID)** Equal To `1.3.6.1.4.1.2604.5.1.8.1.1` with **SNMP Trap Varbind Value** on that varbind, for example Contains `IPSec`. Configure the trap destination on the firewall as SNMP v2c: the probe's trap receiver accepts v1 and v2c traps.

## Extreme Networks (EXOS / Switch Engine and Fabric Engine / VOSS)

| What you want to see                                                                                         | Where it comes from                                |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| EXOS: CPU, temperature and alarm, power state, power supplies, fans, memory per slot, stack members          | **Extreme Networks EXOS / Switch Engine** template |
| Fabric Engine: CPU and memory per slot, temperature sensors, fans, power supplies, vIST session, I-SID count | **Extreme Networks Fabric Engine / VOSS** template |
| Every Fabric Connect (IS-IS) adjacency, named by its neighbour                                               | Fabric Engine template, table `isis_adjacencies`   |
| Ports, LLDP neighbours, the network map                                                                      | The interface walk, on both                        |

**Which template.** Fabric Engine on Extreme's universal hardware (5000 and 7000 series) reports the same enterprise number as EXOS — only its system description (`7520-48Y-8C-FabricEngine (9.0.4.0)`) says which operating system is running. OneUptime reads both, so auto-apply and the vendor banner pick the right template; older VSP switches report the Avaya/Nortel arc and are recognised as Fabric Engine directly.

**Fabric alerts.** The recommended alerts on a Fabric Engine switch include **Fabric Adjacencies (IS-IS): row unhealthy**, an incident per neighbour whose adjacency is not up. Fabric Engine also sends a trap when an adjacency changes, `rcnIsisPlsbAdjStateTrap` (`1.3.6.1.4.1.2272.1.21.0.281`); an **SNMP Trap Received** criteria on it alerts within seconds, before the next poll.

**Hardware alerts.** Power supplies, fans, temperature sensors and stack members are tables with their healthy values declared, so each gets a per-row alert in the recommended pack.

EXOS and Fabric Engine export flows as sFlow and IPFIX, which the probe does not ingest; the device's **Traffic** tab stays empty for them.

**Extreme's Wi-Fi.** IQ Engine (HiveOS) access points and ExtremeCloud IQ Controller have vendor templates of their own, which fill the device's **Wi-Fi** tab — see [Supported Wi-Fi Vendors](/docs/monitor/network-device-monitor#supported-wi-fi-vendors), which also covers Ubiquiti UniFi, HPE Aruba, TP-Link Omada and Juniper Mist.

## Cambium Networks (Enterprise Wi-Fi and cnMatrix)

### Access points

1. **Enable SNMP on the access points.** In cnMaestro, SNMP is set per AP Group: **Configuration → Wi-Fi Profiles → AP Groups → Management → SNMP**. Enable it with a v2c read community or an SNMPv3 user.
2. **Register the access points** with their management addresses and those credentials, and apply the **Cambium Networks Enterprise Wi-Fi (cnPilot, XV, XE, XH)** template (or turn on auto-apply).
3. **Open the device's Wi-Fi tab.** It shows how many radios are on, the clients and SSIDs, then every radio's band, channel, **frequency**, channel width, transmit power, clients, noise floor and airtime, and every SSID with its clients. Frequency is worked out from the band and channel; the access point does not report it.

Useful alerts, all on the `wifi_radios` table with Row `*` so each radio alerts on its own:

| Alert                  | Criteria                                                               |
| ---------------------- | ---------------------------------------------------------------------- |
| A radio switched off   | **SNMP Table Row Is Unhealthy** (included in the recommended alerts)   |
| Transmit power changed | **SNMP Table Value**, column TX Power, Not Equal To your planned power |
| A crowded radio        | **SNMP Table Value**, column Clients, Greater Than your limit          |
| A noisy channel        | **SNMP Table Value**, column Noise Floor, Greater Than `-80`           |

Every numeric radio value is also a metric (`oneuptime.monitor.snmp.table.value`, one series per radio and column), so channel, power and clients can be charted over time on a dashboard — a channel that keeps changing is DFS at work.

Cambium reports the total client count only on firmware 6.5.3 and later; earlier firmware returns 0.

### cnMatrix switches

The **Cambium Networks cnMatrix** template collects CPU, RAM, flash, temperature and supply voltage, plus fans, the redundant power supply and per-port PoE draw as tables. Ports and LLDP neighbours come from the interface walk as on any switch.

### cnMaestro alarms

cnMaestro can send its alarms (an access point offline, for example) to an HTTPS webhook. Point it at an [Incoming Request monitor](/docs/monitor/incoming-request-monitor) to turn those alarms into OneUptime incidents alongside the SNMP data.
