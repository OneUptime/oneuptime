/*
 * What each number on the network device pages means, in plain words: the
 * device Overview hero, its interface preview and latency trend, on-demand
 * ping and traceroute, the Interfaces and Traffic tabs, the device list and
 * the Network Overview. Shown in the (i) tooltip beside a tile, column or
 * section title.
 *
 * Each text describes what the page actually computes, not what the title
 * might suggest:
 *
 *   - interface counts come from the last SUCCESSFUL SNMP walk and are kept
 *     through failed walks, so they can be older than the device's status;
 *   - rates, utilization and errors are averages between the last two walks,
 *     not live values;
 *   - the latency trend is fixed to the past hour and averaged per minute,
 *     so its "max" is the slowest minute, not the slowest ping;
 *   - flow totals are what the device exported, never scaled up for
 *     sampling, and only for flows that STARTED inside the range;
 *   - the endpoint count never shrinks - nothing ages endpoints out.
 *
 * Change the fetch, change the words.
 */

export type NetworkDeviceMetric =
  | "reachability"
  | "monitorStatus"
  | "heroInterfaces"
  | "hardwareUptime"
  | "interfacesPreview"
  | "latencyTrend"
  | "packetLossPeak"
  | "pingAverageRtt"
  | "pingMinMaxRtt"
  | "pingJitter"
  | "pingPacketLoss"
  | "tracerouteRtt"
  | "totalInterfaces"
  | "interfacesUp"
  | "interfacesDown"
  | "interfacesMonitored"
  | "interfaceStatus"
  | "interfaceSpeed"
  | "interfaceInOutRate"
  | "interfaceUtilization"
  | "interfaceErrorsPerSecond"
  | "flowTotalTraffic"
  | "flowPackets"
  | "flowCount"
  | "flowBandwidth"
  | "flowTopSources"
  | "flowTopDestinations"
  | "flowTopConversations"
  | "flowTopProtocolsPorts"
  | "deviceStatus"
  | "deviceInterfacesUpDown"
  | "devicesUp"
  | "devicesDown"
  | "devicesPending"
  | "totalInterfacesDown"
  | "fleetDevices"
  | "fleetInterfacesDown"
  | "fleetSites"
  | "fleetEndpoints"
  | "fleetByVendor";

export const NETWORK_DEVICE_METRIC_DESCRIPTIONS: Record<
  NetworkDeviceMetric,
  string
> = {
  // Device Overview hero (Components/NetworkDevice/DeviceStatusHero.tsx).
  reachability:
    "Whether this device answered its most recent check: the probe's ping, plus an SNMP walk when credentials are set, or for a monitor-backed device, whether its bound monitor reports it offline. Pending means no result yet.",
  monitorStatus:
    "The status last reported by a monitor that watches this device, such as Operational or Offline. It can differ from Reachability because a monitor may also check things like ports going down; Not monitored means no monitor has reported yet.",
  heroInterfaces:
    "Ports on this device from its last successful SNMP walk: up means enabled with a working link, down means enabled with no link. Ports an administrator switched off count in neither and fill the grey rest of the bar.",
  hardwareUptime:
    "Time since the device last restarted, worked out from the uptime counter it reported at its last successful SNMP walk. That counter also restarts with the SNMP agent and rolls over after about 497 days, so it can read short.",

  // Device Overview interface digest (DeviceInterfacesPreview.tsx).
  interfacesPreview:
    "Up to six ports: down ones first, then ports with errors, then the busiest. Each row shows inbound / outbound Mbps and utilization (the busier direction as a share of link speed), averaged between the last two SNMP walks.",

  // Latency trend (DeviceLatencyTrend.tsx) - fixed to the past hour.
  latencyTrend:
    "How long the probe's pings took to reach this device and come back over the past hour, averaged per minute. Now is the latest minute with a reply, avg the mean of those minutes, and max the slowest minute rather than the slowest single ping.",
  packetLossPeak:
    "The highest share of the probe's regular pings that went unanswered in any one minute of the past hour. 0% means every ping in the hour got a reply.",

  // On-demand ping (DeviceDiagnosticsViewModel.describePingResult).
  pingAverageRtt:
    "Average round-trip time for this test: how long a ping took to reach the device and come back, averaged over the pings the probe sent.",
  pingMinMaxRtt:
    "The fastest and the slowest round trip among the pings in this test. A wide gap between the two means the delay on the path is uneven.",
  pingJitter:
    "How much the round-trip time varied between the pings in this test, measured as the standard deviation. High jitter can disrupt calls and video even when the average looks fine.",
  pingPacketLoss:
    "The share of pings in this test that got no reply, followed by how many replies came back out of the pings sent. Any loss on a wired link is worth investigating.",

  // On-demand traceroute (TracerouteHopsTable.tsx).
  tracerouteRtt:
    "Round-trip time from the probe to this hop and back, from the first reply the hop sent. Routers often answer slowly, so one high hop matters less than a jump that carries on to the hops after it.",

  // Interfaces tab: count cards (Pages/NetworkDevice/View/Interfaces.tsx).
  totalInterfaces:
    "Every interface found on this device in its last successful SNMP walk, including virtual ones such as VLANs and loopbacks, ports an administrator switched off, and muted interfaces.",
  interfacesUp:
    "Interfaces that are enabled and have a working link, as of the last successful SNMP walk. Muted interfaces are counted too.",
  interfacesDown:
    "Interfaces that are enabled but have no link as of the last successful SNMP walk, often an unplugged cable or a fault at the other end. Ports an administrator switched off are not counted.",
  interfacesMonitored:
    "Interfaces whose metrics are recorded and checked by monitors. Muted ones are still listed but not charted or alerted on, and this count can include interfaces the latest walk no longer reports.",

  // Interfaces tab: table columns.
  interfaceStatus:
    "Up means enabled with a working link, Down means enabled with no link, and Disabled means an administrator switched the port off, as of the last successful SNMP walk.",
  interfaceSpeed:
    "The link's negotiated speed in megabits per second, as the device reports it. This is the most the port can carry and what Utilization is measured against.",
  interfaceInOutRate:
    "Average inbound / outbound traffic in megabits per second between the last two SNMP walks, from the change in the port's byte counters. A dash means no rate yet, such as after the first walk or a counter reset.",
  interfaceUtilization:
    "How busy the port is: traffic in its busier direction as a percentage of link speed, averaged between the last two SNMP walks, so short bursts in between are smoothed out.",
  interfaceErrorsPerSecond:
    "Inbound plus outbound packets per second that the port counted as errors between the last two SNMP walks. Anything above zero can point to a bad cable, a failing port or a duplex mismatch.",

  // Traffic tab (FlowTopTalkers.tsx) - the card's own time range picker.
  flowTotalTraffic:
    "Total bytes in the NetFlow records this device exported for flows that started in the selected range. If the device samples traffic, this is the sampled amount; it is not scaled up.",
  flowPackets:
    "Total packets in the NetFlow records this device exported for flows that started in the selected range, counted the same way as Total Traffic.",
  flowCount:
    "How many NetFlow records this device exported for flows that started in the selected range. Each record sums up one conversation (same addresses, protocol and ports) over a short stretch, so a long connection can produce many.",
  flowBandwidth:
    "Average megabits per second in each time slice, from the bytes in flow records that started in that slice; slices with no records count as zero. Min, Avg and Max are taken across those slices.",
  flowTopSources:
    "The 10 source IP addresses that sent the most bytes in the selected range, by this device's flow records. Bytes and Packets are each address's totals.",
  flowTopDestinations:
    "The 10 destination IP addresses that received the most bytes in the selected range, by this device's flow records. Bytes and Packets are each address's totals.",
  flowTopConversations:
    "The 10 source and destination pairs that exchanged the most bytes in the selected range, counting each direction separately. Bytes and Packets are totals for each pair.",
  flowTopProtocolsPorts:
    "The 10 protocol and destination port pairs, such as TCP 443, that carried the most bytes in the selected range. Bytes and Packets are totals for each pair.",

  // Device list columns (Pages/NetworkDevice/Devices.tsx).
  deviceStatus:
    "Whether each device answered its most recent check, the probe's ping or SNMP walk. A monitor-backed device shows its bound monitor's status instead, and Pending means no result yet.",
  deviceInterfacesUpDown:
    "Enabled ports with a working link / enabled ports with no link, from each device's last successful SNMP walk. Ports switched off by an administrator count in neither; No SNMP means the device is only pinged.",

  // Device list summary tiles (DeviceSummaryTiles.ts).
  devicesUp:
    "Devices whose most recent check reached them: ping or the SNMP walk answered, or a monitor-backed device's bound monitor does not report it offline. Counts the whole project, whatever filters are set below.",
  devicesDown:
    "Devices whose most recent check failed: neither ping nor the SNMP walk answered, or a monitor-backed device's bound monitor reports it offline. Counts the whole project, whatever filters are set below.",
  devicesPending:
    "Devices with no result yet: never polled, no probe assigned, or monitor-backed with no monitor bound or reporting. Up, Down and Pending together add up to every device in the project.",
  totalInterfacesDown:
    "Enabled ports with no link, added up across every device in the project from each one's last successful SNMP walk. It counts ports, not devices, so one switch with three dead ports adds three.",

  // Network Overview (Pages/NetworkDevice/Overview.tsx).
  fleetDevices:
    "Every network device in the project, split by its most recent check: up, down, or pending when there is no result yet. Monitor-backed devices are judged by their bound monitor.",
  fleetInterfacesDown:
    "Ports that are enabled but have no link, summed over all devices from each device's last successful SNMP walk. A switch with three dead ports adds three to this number.",
  fleetSites:
    "Network sites in the project. Unhealthy sites are those whose health, rolled up from the devices at and beneath them, is non-operational, such as Degraded or Offline; sites with no data yet are not counted as unhealthy.",
  fleetEndpoints:
    "Hosts such as PCs, phones and printers found in your switches' and routers' address tables (ARP and MAC forwarding tables) during SNMP walks. Every host found so far is counted, including ones not seen recently.",
  fleetByVendor:
    "Device counts for your six most common vendors, as each device reported over SNMP. Devices with no vendor yet, such as ping-only ones, are grouped as Unknown, and each bar is relative to the largest vendor.",
};
