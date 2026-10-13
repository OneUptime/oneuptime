# Network Events (Syslog and SNMP Traps)

Routers, firewalls, switches and access points say what happens to them in their syslog: a link went down, a tunnel dropped, a firewall failed over, somebody signed in. Every vendor words it its own way. Point their syslog at a OneUptime probe and the **Events** pages show what happened in the same words whoever made the device, and alert you when it happens again.

There is an Events page in two places:

- **Network** -> **Events**: the whole network, every device's events on one page, and every address that is sending syslog without being a device yet.
- A device's **Events** tab: what that one device reported.

## What the Events page shows

- The events of the time range, newest first. Each row says what happened, on which device, to what - the interface, the tunnel, the gateway - and the device's own words.
- **Problems**, **Recoveries** and **Informational**, each with how many there are in the time range. Click one to see only those.
- The **All events** picker and, on the network's page, the **All devices** picker narrow the list further. The time range and the filters are kept in the page's address, so a link opens on exactly the same view.
- Click an event to open it: when it happened, what it is about, the message as the device sent it, and every attribute OneUptime read out of it.
- **Create alert** offers the alerts most networks want, and **Create alert for this event** makes one for the event you opened. See [Alerts](#alerts).

An event is a log. Everything on the Events page can also be searched, charted and alerted on from **Logs**: an event is a log whose attribute `event.domain` is `network`, with what happened in `event.name`.

## What OneUptime reads

Syslog in RFC 3164 and RFC 5424 form and the Common Event Format (CEF) are read from any product. On top of that, OneUptime knows what these products write:

| Vendor | Products | Events it reads | Attributes |
| --- | --- | --- | --- |
| Cisco | IOS, IOS XE, NX-OS, ASA | Interfaces, Devices, High availability, VPN, Routing, Hardware, Switching, Sign-ins | `cisco.*` |
| Sophos | Sophos Firewall (SFOS, XG, XGS) | Interfaces, Devices, High availability, VPN, WAN, Sign-ins | `sophos.*` |
| Fortinet | FortiGate (FortiOS) | Interfaces, Devices, High availability, VPN, WAN, Hardware, Sign-ins | `fortigate.*` |
| Extreme Networks | ExtremeXOS, Switch Engine | Interfaces, Devices, High availability, Routing, Hardware, Switching, Sign-ins | `extreme.*` |
| Extreme Networks | Fabric Engine, VOSS | Interfaces, Routing | `extreme.*` |
| HPE Aruba Networking | AOS-CX | Interfaces, Hardware | `aruba.*` |
| HPE Aruba Networking | AOS-Switch (ArubaOS-Switch, ProCurve) | Interfaces | `aruba.*` |
| MikroTik | RouterOS | Interfaces, Devices, Sign-ins | `mikrotik.*` |
| Cambium Networks | Enterprise Wi-Fi (cnPilot, XV, XE, XH) | Devices, VPN, Wi-Fi | `cambium.*` |
| Ubiquiti | UniFi Network | Devices, WAN, Switching, Sign-ins, Wi-Fi | `cef.*` |
| Any | Linux-based devices (kernel, hostapd, OpenSSH, Dropbear) | Interfaces, Sign-ins, Wi-Fi | - |

A message in one of these formats has its own fields stored as attributes under the prefix in the last column, so `con_name="HQ-Branch1"` on a Sophos firewall is the attribute `sophos.con_name`. A CEF message from any other product has its header and extension fields stored under `cef.*`. A message OneUptime cannot place is still stored as a log, with its syslog header read; you can name its events yourself, see [Your own events](#your-own-events).

The standard SNMP traps are read into the same events: `linkDown` and `linkUp` become **Interface down** and **Interface up**, `coldStart` and `warmStart` become **Device restarted**.

## The events

Every message OneUptime recognises is stored with one of these names in `event.name`, whoever made the device:

| Event | `event.name` | Kind | About |
| --- | --- | --- | --- |
| Interface down | `interface.down` | Problem | `network.interface.name` |
| Interface up | `interface.up` | Recovery | `network.interface.name` |
| Port shut down by the switch | `interface.error_disabled` | Problem | `network.interface.name` |
| Device restarted | `device.reboot` | Problem | - |
| Configuration changed | `device.config_change` | Informational | `user.name` |
| Device offline | `device.offline` | Problem | - |
| Device online | `device.online` | Recovery | - |
| Failover | `ha.failover` | Problem | `ha.role` |
| High availability state changed | `ha.state_change` | Informational | `ha.role` |
| High availability peer down | `ha.peer_down` | Problem | `ha.peer` |
| High availability peer up | `ha.peer_up` | Recovery | `ha.peer` |
| VPN tunnel down | `vpn.tunnel_down` | Problem | `vpn.tunnel.name` |
| VPN tunnel up | `vpn.tunnel_up` | Recovery | `vpn.tunnel.name` |
| Routing neighbor down | `routing.neighbor_down` | Problem | `network.peer.address` |
| Routing neighbor up | `routing.neighbor_up` | Recovery | `network.peer.address` |
| Gateway down | `gateway.down` | Problem | `network.gateway.name` |
| Gateway up | `gateway.up` | Recovery | `network.gateway.name` |
| WAN failover | `wan.failover` | Problem | `network.gateway.name` |
| SD-WAN link below its SLA | `sdwan.sla_not_met` | Problem | `network.gateway.name` |
| SD-WAN link back within its SLA | `sdwan.sla_met` | Recovery | `network.gateway.name` |
| Fan failed | `hardware.fan_failed` | Problem | `hw.name` |
| Fan working again | `hardware.fan_ok` | Recovery | `hw.name` |
| Power supply failed | `hardware.power_supply_failed` | Problem | `hw.name` |
| Power supply working again | `hardware.power_supply_ok` | Recovery | `hw.name` |
| Temperature too high | `hardware.temperature_high` | Problem | - |
| Loop detected | `loop.detected` | Problem | `network.interface.name` |
| Spanning tree topology change | `stp.topology_change` | Informational | - |
| PoE fault | `poe.fault` | Problem | `network.interface.name` |
| Sign-in failed | `auth.login_failed` | Problem | `user.name` |
| Signed in | `auth.login_success` | Informational | `user.name` |
| Wi-Fi client connected | `wireless.client_connected` | Informational | `client.mac` |
| Wi-Fi client disconnected | `wireless.client_disconnected` | Informational | `client.mac` |

The last column is the attribute that says what the event is about. Not every product reports every event: a switch has no VPN tunnels, and a product's syslog only says so much.

Every event also carries:

| Attribute | What it holds |
| --- | --- |
| `event.domain` | `network`, on every network event |
| `event.kind` | `problem`, `recovery` or `info` |
| `event.category` | `interface`, `device`, `ha`, `vpn`, `routing`, `wan`, `hardware`, `switching`, `security` or `wireless`, on the events above |
| `event.device` | Which device: its name in OneUptime, else the name it gives itself, else its address |
| `event.message` | What the device said, in its own words |
| `syslog.vendor`, `syslog.parser` | Whose format the message was read as |

## How events get here

Every probe listens for syslog on port 5140, over UDP and over TCP. Over TCP a message is a line, or is preceded by its length, as RFC 6587 describes. The probe forwards what it hears to OneUptime every few seconds, and OneUptime matches each message to a device by the address it came from:

1. a device the probe polls whose hostname is that address (or resolves to it), or that lists it under **Other Addresses** on its **Settings** page;
2. on your own (custom) probe, any device in the project with that address, or with the hostname the message carries when exactly one device has that name;
3. otherwise, on your own probe, the message is kept for the network's Events page, under **Sending syslog, not a device yet**, until you say which device it belongs to. A global probe drops it.

A line from an unknown address that has no syslog priority and is no event is taken for noise, and dropped.

A controller speaks for the devices it manages: a UniFi console reports on its access points and switches. When a message from a device names another device by its MAC address, its serial number, its address or the name its controller gives it, the event goes to that device, and the log keeps the name of the controller that passed it on in `syslog.relay.name`.

A log is stored at the time the probe received it. A message that was held back - its own timestamp is in RFC 5424 form, which names its time zone, and is more than 5 minutes old - keeps the device's time, up to 7 days back. Any other timestamp more than 5 minutes away from the probe's clock is not believed: the log is stored at the time it was received, and the device's time is kept in `syslog.deviceTime`.

Syslog you post to [the syslog endpoint](/docs/telemetry/syslog) over HTTPS is read by the same parsers. There a message becomes a network event when it is in a network vendor's own format, or when it names one of your network devices by MAC address, serial number, address or hostname; a server's `sshd` lines stay plain logs.

## Setting it up

1. **Use a probe on the device's network.** Syslog is sent by your devices, so they need a [custom probe](/docs/probe/custom-probe) they can reach. A global probe on the public internet will not receive it.
2. **Let syslog reach the probe.** Allow port 5140, UDP or TCP, from the devices to the probe. A probe in Docker started with host networking (`--network host`), as the custom probe page shows, receives it as it is; without host networking, publish the port with `-p 5140:5140/udp -p 5140:5140/tcp`. For a device that can only send to port 514, publish it as `-p 514:5140/udp`, or set `PROBE_SYSLOG_RECEIVER_PORT=514` on a probe with host networking.
3. **Set the probe as the device's syslog server.** The commands for common devices are below. The **Events** page shows the same steps until the first message arrives, and then turns into the list by itself.
4. **Check the device's address.** Messages are matched by the address the device sends from. If it sends from a loopback or a management interface that is not its hostname, add that address to the device's **Other Addresses**.

The syslog receiver is on by default. Its settings are environment variables on the probe:

| Variable | What it does | Default |
| --- | --- | --- |
| `PROBE_SYSLOG_RECEIVER_ENABLED` | Set to `false` to turn the syslog receiver off | `true` |
| `PROBE_SYSLOG_RECEIVER_PORT` | The port, for UDP and TCP | `5140` |
| `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` | Messages forwarded per minute, across every device | `600` |

Past the limit, the probe still forwards the messages it reads as network events, up to as many again, so a flood of routine lines cannot crowd out the one that says a link went down. A probe older than this feature listens only when it is started with `PROBE_SYSLOG_RECEIVER_ENABLED=true`, and only over UDP: update it.

### Cisco IOS, IOS XE and NX-OS

```text
logging host <probe-address> transport udp port 5140
logging trap informational
service timestamps log datetime msec
```

The second line sends informational messages and everything more serious: link changes, restarts and sign-ins are among them. On NX-OS the line is `logging server <probe-address> 6 port 5140 use-vrf management`.

### Sophos Firewall

1. In the firewall's web admin, open **System services** > **Log settings** and, under **Syslog servers**, choose **Add**.
2. Enter the probe's IP address and port `5140`, and set the severity level to **Information**. Either log format the firewall offers is read.
3. Back on **Log settings**, tick the new server for the logs to send: the system events at least, and **SD-WAN** for SLA changes. Firewall traffic logs are many, so leave them out unless you want them.

### Fortinet FortiGate

```text
config log syslogd setting
    set status enable
    set server "<probe-address>"
    set port 5140
    set mode udp
    set format default
end
```

FortiGate sends what its log settings select. Event logs carry the tunnels, links and failovers; traffic logs are many, so leave them out unless you want them.

### Extreme Networks

```text
configure syslog add <probe-address>:5140 vr VR-Default local7
enable log target syslog <probe-address>:5140 vr VR-Default local7
enable syslog
```

Change `VR-Default` to the virtual router the probe is reached through.

### HPE Aruba

```text
logging <probe-address> udp 5140 severity info
```

On AOS-CX, add `vrf mgmt` to the line when the probe is reached through the management port. On AOS-Switch the line is `logging <probe-address> udp 5140`.

### MikroTik RouterOS

```text
/system logging action set remote remote=<probe-address> remote-port=5140
/system logging add topics=info action=remote
/system logging add topics=warning action=remote
/system logging add topics=error action=remote
/system logging add topics=critical action=remote
```

The first line points the router's built-in remote action at the probe; the others choose what it sends. Leave the remote log format as it is.

### Ubiquiti UniFi

1. In UniFi Network, open **Integration** > **System Logging / SIEM** and select **SIEM Server** as the destination.
2. Enter the probe's IP address and port `5140`, and choose the log categories to export.

The console reports on the access points and switches it manages. Events land on each device's own page when the device is in OneUptime with its MAC address, and on the console's otherwise.

### Cambium Networks

1. In cnMaestro or the access point's web interface, open the system settings and find the syslog servers.
2. Enter the probe's IP address as a syslog server, with port `5140` where the form asks for a port, and set the syslog severity to **Info**.

Where there is no port to set, the access point sends to port 514: publish the probe's port there, as step 2 of [Setting it up](#setting-it-up) shows.

### Other devices

Add a remote syslog server on the device: the probe's IP address, port 5140, over UDP or TCP, sending informational messages and everything more serious. A device whose format OneUptime does not know still has its messages stored, and you can name its events yourself.

## Alerts

**Create alert** on an Events page lists the alerts most networks want. Each opens **Create Monitor** filled in, where you can change anything before you save it:

| Alert | Tells you when | One alert per | Closes when |
| --- | --- | --- | --- |
| A VPN tunnel goes down | `vpn.tunnel_down` | device and tunnel | `vpn.tunnel_up` for that tunnel |
| A firewall or switch fails over | `ha.failover` | device | 5 minutes pass without another |
| A WAN link goes down | `gateway.down` | device and gateway | `gateway.up` for that gateway |
| A routing neighbor goes down | `routing.neighbor_down` | device and neighbor | `routing.neighbor_up` for that neighbor |
| A device restarts | `device.reboot` | device | 5 minutes pass without another |
| Hardware fails | a fan, a power supply or the temperature | device and component | the same component is reported working again |
| An interface goes down | `interface.down` | device and interface | `interface.up` for that interface |
| Someone keeps failing to sign in | more than 10 `auth.login_failed` in 5 minutes | device | 5 minutes pass with 10 or fewer |

Each is a [Logs monitor](/docs/monitor/logs-monitor) that counts the event over the last 5 minutes, with **Group by Attributes** set so every tunnel, gateway or interface gets an alert of its own, and with **Resolved by Attributes** set to the event that says the problem is over. Such an alert stays open until that event arrives for the same device and the same tunnel, however long that takes; see [Resolved by a log](/docs/monitor/logs-monitor#resolved-by-a-log). OneUptime reads no event that says a temperature is back to normal, so a temperature alert stays open until you resolve it.

From a device's **Events** tab the monitors watch that device only. For any other event, open one on the Events page and click **Create alert for this event**. To send an alert somewhere, or to page someone, add an on-call policy or a workflow to the monitor as on any other.

## Addresses that are not devices yet

Syslog can arrive before the device that sends it is added to OneUptime. On your own probe it is kept, its events are on the network's Events page with the name the device gives itself, and its address is listed under **Sending syslog, not a device yet**, marked **Not a device yet**:

- **Add as device** opens **Add Device** with the address and the probe filled in. The messages that already arrived stay on the network's page; new ones go to the device.
- **It is one of my devices** adds the address to a device's **Other Addresses**: use it when a device you already added sends from another address, such as a loopback. Its messages go to that device from the next minute on.

Several devices behind one NAT address share that address, so their messages go to the one device that has it, unless a message names its own device.

## Your own events

A device whose format OneUptime does not know, or an event it does not read, takes a [log pipeline](/docs/telemetry/log-pipelines):

1. Create a pipeline whose filter matches the device's logs, such as `attributes.networkDevice.name = 'rack-ups'`.
2. Add a **Grok Parser** or a **Key=Value Parser** to pull the fields you need out of the message.
3. Add a **Category Processor** with **Target Attribute** `event.name`, and a rule per event. Name each like the events above, in lowercase with dots or underscores: `ups.on_battery`.

A log of a network device that carries such a name becomes a network event: it is on the Events pages, and **Create alert for this event** works on it. To say what it is about, add an **Attribute Remapper** that copies your field to one of the attributes in the events table, such as `hw.name`. Unless your pipeline sets `event.kind` to `problem` or `recovery`, the event is listed under **Informational**. A rule named after a built-in event, such as `interface.down`, makes the built-in event, with its kind and its alerts.

A pipeline belongs to its project. To use one in another project, create it there with the same processors.

## What is not included

- **Syslog over TLS** (RFC 5425). The probe takes plain UDP and TCP; keep the path between the devices and the probe on a network you trust.
- **Sharing parsers between projects.** A pipeline cannot be exported and imported yet.
- **Events from SNMP traps other than the four standard ones.** A vendor's own traps are stored as logs and alerted on with the **SNMP Trap Received (Trap OID)** criteria of the [Network Device monitor](/docs/monitor/network-device-monitor).
- **Cambium cnMatrix switches, Aruba mobility controllers and FortiGate in CEF mode.** Their messages are stored and searchable; no events are read out of them yet.
- **A live tail.** The Events page shows what had arrived when it was opened; use its refresh button, or the live tail of **Logs**.

## Troubleshooting

If an Events page still shows its set-up steps:

- **Is the probe receiving anything?** The network's Events page lists every address that sent syslog in the time range under **Sending syslog, not a device yet**. If the device is there, it sends from an address that is not its hostname: add that address to its **Other Addresses**.
- **Firewalls and Docker.** Allow port 5140 from the device to the probe, and publish the port if the probe runs in Docker. Many devices send to port 514 unless told otherwise.
- **The probe's log.** At startup the probe logs the port it listens on, or that it could not open it. When it drops messages over `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE`, it logs how many, once a minute.
- **A global probe.** A device polled by a global probe cannot send syslog to it from a private network. Run a custom probe on the device's network and pick it in the device's settings.
- **Messages arrive, but no events.** The page says so, and every message is on the device's **Logs** tab. Check that the device sends informational messages, not only errors, and that the product is one of those in [What OneUptime reads](#what-oneuptime-reads); otherwise name its events in a log pipeline.
