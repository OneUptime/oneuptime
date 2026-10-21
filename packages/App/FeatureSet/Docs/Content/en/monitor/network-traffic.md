# Network Traffic (NetFlow, IPFIX and sFlow)

Routers, firewalls and switches can describe the traffic that passes through them as **flow records**: who talked to whom, over which protocol and ports, through which interfaces, and how many bytes. Point that export at a OneUptime probe and the **Traffic** pages show where your traffic goes: the busiest addresses, conversations, applications and interfaces, over any time range.

There is a Traffic page in three places:

- **Network** -> **Traffic**: the whole network, every device's flows on one page, and every address that is sending flows without being a device yet.
- A site's **Traffic** page: the devices at that site.
- A device's **Traffic** tab: that one device, with its interfaces. Packet captures run on the device's probe are listed under the flows, for when you need the packets themselves.

## What the Traffic page shows

- Four numbers for the time range: **Traffic** (bytes), **Average** and **Peak** rate, and **Flows** (how many flow records the devices sent).
- **Traffic over time**, as bits per second. Drag across the chart to zoom into a stretch; double-click it, or use **Reset zoom**, to go back.
- **Top sources** and **Top destinations**: the ten addresses that sent and received the most.
- **Top applications**: traffic by protocol and service port, named after the service usually on that port (HTTPS is TCP port 443).
- **Top interfaces** on a device's page: what came in and went out through each interface, with its name and speed from the device's SNMP walk. **Top devices** on a site's and on the network's page.
- **Top conversations**: the ten busiest pairs of addresses, drawn as a diagram from senders to receivers, or as a list.

Click any row - an address, an application, an interface, a device, a band of the diagram - and the whole page narrows to that traffic. A chip above the page says what it is narrowed to; click its x to widen the page again. **Find an IP address** narrows the page to the traffic to or from one address. The time range and the filters are kept in the page's address, so a link opens on exactly the same view.

## How flows get here

Every probe runs a flow collector. It listens on three UDP ports, and every port reads every format:

| Port     | Usually used for            |
| -------- | --------------------------- |
| UDP 2055 | NetFlow v5, NetFlow v9      |
| UDP 4739 | IPFIX                       |
| UDP 6343 | sFlow v5                    |

The probe decodes the records, multiplies sampled counts back up by the sampling rate, sums the records of one conversation every few seconds, and sends them to OneUptime. Each record is matched to a device by the address its device sends it from - for sFlow, the agent address in the datagram:

1. a device the probe polls whose hostname is that address (or resolves to it), or that lists it under **Other Addresses** on its **Settings** page;
2. on your own (custom) probe, any device in the project with that address as its hostname or among its Other Addresses;
3. otherwise, on your own probe, the flows are kept for the network's Traffic page, under **Sending flows**, until you say which device they belong to. A global probe drops them.

Flows are kept for 30 days, and one page shows at most 31 days.

## Setting it up

1. **Use a probe on the device's network.** Flows are UDP datagrams sent by your devices, so they need a [custom probe](/docs/probe/custom-probe) they can reach. A global probe on the public internet will not receive them.
2. **Let the datagrams reach the probe.** Allow UDP 2055, 4739 and 6343 from the devices to the probe. A probe in Docker started with host networking (`--network host`), as the custom probe page shows, receives them as it is; without host networking, publish the ports with `-p 2055:2055/udp -p 4739:4739/udp -p 6343:6343/udp`.
3. **Turn on flow export on the device** and send it to the probe's IP address. The commands for common devices are below. The device's own **Traffic** tab shows the same steps with the probe's ports until the first flow arrives.
4. **Check the device's address.** Records are matched by the address the device sends from. If it sends from a loopback or a management interface that is not its hostname, add that address to the device's **Other Addresses**.

The collector is on by default. Its settings are environment variables on the probe:

| Variable                            | What it does                                                        | Default |
| ----------------------------------- | ------------------------------------------------------------------- | ------- |
| PROBE_NETFLOW_RECEIVER_ENABLED      | Set to `false` to turn the flow collector off                       | true    |
| PROBE_NETFLOW_RECEIVER_PORT         | The NetFlow port; `0` stops listening on it                         | 2055    |
| PROBE_IPFIX_RECEIVER_PORT           | The IPFIX port; `0` stops listening on it                           | 4739    |
| PROBE_SFLOW_RECEIVER_PORT           | The sFlow port; `0` stops listening on it                           | 6343    |
| PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE | Datagrams accepted per minute, across every device and port         | 6000    |

### Cisco IOS XE (Flexible NetFlow)

Exports IPFIX to UDP 4739. Add the last line to every interface whose traffic you want to see: measuring traffic as it comes in on each interface counts every conversation once.

```text
flow exporter ONEUPTIME
 destination <probe-address>
 source Loopback0
 transport udp 4739
 export-protocol ipfix
 template data timeout 60
 option interface-table
 option sampler-table
!
flow monitor ONEUPTIME
 exporter ONEUPTIME
 cache timeout active 60
 record netflow ipv4 original-input
!
interface GigabitEthernet0/0/0
 ip flow monitor ONEUPTIME input
```

### Cisco IOS (NetFlow v9)

Exports NetFlow v9 to UDP 2055.

```text
ip flow-export version 9
ip flow-export destination <probe-address> 2055
ip flow-export source Loopback0
ip flow-export template timeout-rate 1
ip flow-cache timeout active 1
!
interface GigabitEthernet0/0
 ip flow ingress
```

### Arista EOS (sFlow)

Exports sFlow to UDP 6343. sFlow samples one packet in every N (16384 here), and the Traffic pages multiply the samples back up, so the numbers are estimates.

```text
sflow sample 16384
sflow destination <probe-address> 6343
sflow source-interface Loopback0
sflow run
```

### Cisco Meraki MX and Z

MX appliances and Z-series teleworker gateways export NetFlow v9 from the Meraki dashboard:

1. Open **Network-wide** > **General** and find **Reporting**.
2. Set **NetFlow traffic reporting** to **Enabled: send NetFlow traffic statistics**.
3. Enter the probe's IP address as the **NetFlow collector IP** and `2055` as the **NetFlow collector port**, then save.

An MX or Z only sees the traffic that passes through it. Traffic that a switch keeps within a VLAN never reaches it, so it is not in the export.

### Juniper (inline J-Flow)

Exports IPFIX to UDP 4739 from MX routers; use the FPC that carries the interfaces you sample.

```text
set services flow-monitoring version-ipfix template ONEUPTIME ipv4-template
set services flow-monitoring version-ipfix template ONEUPTIME flow-active-timeout 60
set services flow-monitoring version-ipfix template ONEUPTIME template-refresh-rate seconds 60
set chassis fpc 0 sampling-instance ONEUPTIME
set forwarding-options sampling instance ONEUPTIME input rate 1
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> port 4739
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> version-ipfix template ONEUPTIME
set forwarding-options sampling instance ONEUPTIME family inet output inline-jflow source-address <device-address>
set interfaces ge-0/0/0 unit 0 family inet sampling input
```

### Fortinet FortiGate

Exports NetFlow v9 to UDP 2055. On FortiOS 7.2 and later the collector is an entry under `config collectors` inside `config system netflow`.

```text
config system netflow
    set collector-ip <probe-address>
    set collector-port 2055
    set template-tx-timeout 60
end
config system interface
    edit "port1"
        set netflow-sampler both
    next
end
```

### Palo Alto Networks

1. Under **Device** > **Server Profiles** > **NetFlow**, add a profile with the probe's IP address and port `2055`, and set the **Active Timeout** to 1 minute.
2. Under **Network** > **Interfaces**, open each interface whose traffic you want to see and pick the profile as its **NetFlow Profile** on the **Advanced** tab.
3. Commit.

### MikroTik RouterOS 7

```text
/ip traffic-flow set enabled=yes interfaces=all active-flow-timeout=1m
/ip traffic-flow target add dst-address=<probe-address> port=2055 version=9
```

### pfSense and Linux hosts

On pfSense, install the **softflowd** package and, under **Services** > **softflowd**, pick the interfaces, enter the probe's IP address and port `2055`, and choose NetFlow version 9. On a Linux host, run softflowd on the interface whose traffic you want to see:

```bash
softflowd -i eth0 -n <probe-address>:2055 -v 9 -t maxlife=60
```

### Other devices

Send NetFlow v5, NetFlow v9 or IPFIX to the probe's IP address on UDP 2055 (or 4739), or sFlow v5 on UDP 6343. Set the device's active flow timeout to 60 seconds and, for NetFlow v9 and IPFIX, send its templates every 60 seconds. [Network Vendor Guides](/docs/monitor/network-vendor-guides) covers Sophos and Extreme Networks.

## Addresses that are not devices yet

Flows can arrive before the device that sends them is added to OneUptime. On your own probe they are kept, and the network's Traffic page lists their address under **Sending flows**, marked **Not a device yet**:

- **Add as device** opens Add Device with the address and the probe filled in. The flows that already arrived stay on the network's page; new ones go to the device.
- **It is one of my devices** adds the address to a device's **Other Addresses**: use it when a device you already added sends from another address, such as a loopback. Its flows go to that device from the next minute on.

Several devices behind one NAT address share that address, so their flows go to the one device that has it.

## Reading the numbers

- **Sampling.** A device that samples - sFlow always does, and NetFlow or IPFIX can - reports one packet in every N. The probe multiplies the counts by N, so the page shows estimates, and says so under the four numbers. They are accurate for heavy traffic and rough for a few packets.
- **Counted twice.** Traffic that passes through two exporting devices is reported by both. A device's page counts it once; a site's or the network's page counts it once per device that reported it.
- **Applications.** An application is the protocol and the service port, named after the service usually on that port. It is not deep packet inspection: HTTPS on port 9443 is shown as TCP port 9443. The client's short-lived port is left out, so a thousand browser connections to one server are one application.
- **Peak** is the rate of the busiest slice of the chart, so a shorter time range, with shorter slices, shows a sharper peak. **Average** is the bytes over the whole time range.
- **Time.** A flow counts in the slice it started in. A long download is reported as several flows, one for every minute it runs, which is why the devices' active timeout should be 60 seconds.

## What is not included

- **Alerts on flows.** There is no flow-based monitor yet. To alert on a busy link, use the interface utilization alerts of the [Network Device monitor](/docs/monitor/network-device-monitor), which read SNMP.
- **Application names beyond the port.** There is no deep packet inspection, and Cisco NBAR application names are not read.
- **The Meraki Dashboard API.** Meraki traffic analytics are not imported; MX and Z appliances send NetFlow to the probe instead.
- **Anomaly detection** on traffic.
- **Interface names from flow records.** Interface names and speeds come from the device's SNMP walk; a device that is not walked shows interface numbers.

## Troubleshooting

If the Traffic page still shows its set-up steps:

- **Is the probe receiving anything?** The network's Traffic page lists every address that sent flows in the last hour under **Sending flows**. If the device is there as **Not a device yet**, it sends from an address that is not its hostname: add that address to its **Other Addresses**.
- **Firewalls and Docker.** Allow UDP 2055, 4739 and 6343 from the device to the probe, and publish the ports if the probe runs in Docker.
- **The probe's log.** Once a minute the probe logs what it could not read: datagrams in an unsupported format (NetFlow v1, v6, v7 or v8, or sFlow before version 5), malformed datagrams, data waiting for a template, and datagrams dropped over `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE`.
- **Templates.** NetFlow v9 and IPFIX send the layout of their records as templates. The probe holds data that arrives before its template for up to 10 minutes; set the device to send its templates every 60 seconds so the page fills in within a minute.
- **A global probe.** A device polled by a global probe cannot send flows to it from a private network. Run a custom probe on the device's network and pick it in the device's settings.
