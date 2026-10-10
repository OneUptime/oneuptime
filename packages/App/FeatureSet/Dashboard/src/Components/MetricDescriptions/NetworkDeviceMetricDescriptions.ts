/*
 * What each number on the network device pages means, in plain words: the
 * device Overview hero, its interface preview and latency trend, on-demand
 * ping and traceroute, the Interfaces tab, the device list, the Network
 * Overview, the Probe Latency Matrix and the Discovery Scans list. Shown in
 * the (i) tooltip beside a tile, column or section title. (The Traffic
 * pages' own texts are TILE_HELP and TRAFFIC_HELP in
 * Components/NetworkTraffic.)
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
 *   - the endpoint count never shrinks - nothing ages endpoints out;
 *   - the latency matrix is each monitor's LATEST check per probe, and only
 *     the project's own probes get a column - global probes are not
 *     project rows, so the endpoint never lists them;
 *   - a discovery scan's "responded" hosts are the SNMP responders on an
 *     SNMP scan (ping-only hosts are counted beside them), and the ping
 *     responders on a ping-only scan.
 *
 * Change the fetch, change the words.
 */

import { translationKey } from "Common/UI/Utils/TranslateTemplate";

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
  | "fleetByVendor"
  | "latencyMatrix"
  | "discoveryRespondedHosts";

export const NETWORK_DEVICE_METRIC_DESCRIPTIONS: Record<
  NetworkDeviceMetric,
  string
> = {
  // Device Overview hero (Components/NetworkDevice/DeviceStatusHero.tsx).
  reachability: translationKey(
    "Whether this device answered its most recent check: the probe's ping, plus an SNMP walk when credentials are set, or for a monitor-backed device, whether its bound monitor reports it offline. Pending means no result yet.",
  ),
  monitorStatus: translationKey(
    "The status last reported by a monitor that watches this device, such as Operational or Offline. It can differ from Reachability because a monitor may also check things like ports going down; Not monitored means no monitor has reported yet.",
  ),
  heroInterfaces: translationKey(
    "Ports on this device from its last successful SNMP walk: up means enabled with a working link, down means enabled with no link. Ports an administrator switched off count in neither and fill the grey rest of the bar.",
  ),
  // Also the Inventory card's Uptime (DeviceInventoryCard.tsx): same column.
  hardwareUptime: translationKey(
    "Time since the device last restarted, worked out from the uptime counter it reported at its last successful SNMP walk. That counter also restarts with the SNMP agent and rolls over after about 497 days, so it can read short.",
  ),

  // Device Overview interface digest (DeviceInterfacesPreview.tsx).
  interfacesPreview: translationKey(
    "Up to six ports: down ones first, then ports with errors, then the busiest. Each row shows inbound / outbound Mbps and utilization (the busier direction as a share of link speed), averaged between the last two SNMP walks.",
  ),

  // Latency trend (DeviceLatencyTrend.tsx) - fixed to the past hour.
  latencyTrend: translationKey(
    "How long the probe's pings took to reach this device and come back over the past hour, averaged per minute. Now is the latest minute with a reply, avg the mean of those minutes, and max the slowest minute rather than the slowest single ping.",
  ),
  packetLossPeak: translationKey(
    "The highest share of the probe's regular pings that went unanswered in any one minute of the past hour. 0% means every ping in the hour got a reply.",
  ),

  // On-demand ping (DeviceDiagnosticsViewModel.describePingResult).
  pingAverageRtt: translationKey(
    "Average round-trip time for this test: how long a ping took to reach the device and come back, averaged over the pings the probe sent.",
  ),
  pingMinMaxRtt: translationKey(
    "The fastest and the slowest round trip among the pings in this test. A wide gap between the two means the delay on the path is uneven.",
  ),
  pingJitter: translationKey(
    "How much the round-trip time varied between the pings in this test, measured as the standard deviation. High jitter can disrupt calls and video even when the average looks fine.",
  ),
  pingPacketLoss: translationKey(
    "The share of pings in this test that got no reply, followed by how many replies came back out of the pings sent. Any loss on a wired link is worth investigating.",
  ),

  // On-demand traceroute (TracerouteHopsTable.tsx).
  tracerouteRtt: translationKey(
    "Round-trip time from the probe to this hop and back, from the first reply the hop sent. Routers often answer slowly, so one high hop matters less than a jump that carries on to the hops after it.",
  ),

  // Interfaces tab: count cards (Pages/NetworkDevice/View/Interfaces.tsx).
  totalInterfaces: translationKey(
    "Every interface found on this device in its last successful SNMP walk, including virtual ones such as VLANs and loopbacks, ports an administrator switched off, and muted interfaces.",
  ),
  interfacesUp: translationKey(
    "Interfaces that are enabled and have a working link, as of the last successful SNMP walk. Muted interfaces are counted too.",
  ),
  interfacesDown: translationKey(
    "Interfaces that are enabled but have no link as of the last successful SNMP walk, often an unplugged cable or a fault at the other end. Ports an administrator switched off are not counted.",
  ),
  interfacesMonitored: translationKey(
    "Interfaces whose metrics are recorded and checked by monitors. Muted ones are still listed but not charted or alerted on, and this count can include interfaces the latest walk no longer reports.",
  ),

  // Interfaces tab: table columns.
  interfaceStatus: translationKey(
    "Up means enabled with a working link, Down means enabled with no link, and Disabled means an administrator switched the port off, as of the last successful SNMP walk.",
  ),
  interfaceSpeed: translationKey(
    "The link's negotiated speed in megabits per second, as the device reports it. This is the most the port can carry and what Utilization is measured against.",
  ),
  interfaceInOutRate: translationKey(
    "Average inbound / outbound traffic in megabits per second between the last two SNMP walks, from the change in the port's byte counters. A dash means no rate yet, such as after the first walk or a counter reset.",
  ),
  interfaceUtilization: translationKey(
    "How busy the port is: traffic in its busier direction as a percentage of link speed, averaged between the last two SNMP walks, so short bursts in between are smoothed out.",
  ),
  interfaceErrorsPerSecond: translationKey(
    "Inbound plus outbound packets per second that the port counted as errors between the last two SNMP walks. Anything above zero can point to a bad cable, a failing port or a duplex mismatch.",
  ),

  // Device list columns (Pages/NetworkDevice/Devices.tsx).
  deviceStatus: translationKey(
    "Whether each device answered its most recent check, the probe's ping or SNMP walk. A monitor-backed device shows its bound monitor's status instead, and Pending means no result yet.",
  ),
  // Also the site's Devices tab (Pages/NetworkSite/View/Devices.tsx).
  deviceInterfacesUpDown: translationKey(
    "Enabled ports with a working link / enabled ports with no link, from each device's last successful SNMP walk. Ports switched off by an administrator count in neither; No SNMP means the device is only pinged.",
  ),

  // Device list summary tiles (DeviceSummaryTiles.ts).
  devicesUp: translationKey(
    "Devices whose most recent check reached them: ping or the SNMP walk answered, or a monitor-backed device's bound monitor does not report it offline. Counts the whole project, whatever filters are set below.",
  ),
  devicesDown: translationKey(
    "Devices whose most recent check failed: neither ping nor the SNMP walk answered, or a monitor-backed device's bound monitor reports it offline. Counts the whole project, whatever filters are set below.",
  ),
  devicesPending: translationKey(
    "Devices with no result yet: never polled, no probe assigned, or monitor-backed with no monitor bound or reporting. Up, Down and Pending together add up to every device in the project.",
  ),
  totalInterfacesDown: translationKey(
    "Enabled ports with no link, added up across every device in the project from each one's last successful SNMP walk. It counts ports, not devices, so one switch with three dead ports adds three.",
  ),

  // Network Overview (Pages/NetworkDevice/Overview.tsx).
  fleetDevices: translationKey(
    "Every network device in the project, split by its most recent check: up, down, or pending when there is no result yet. Monitor-backed devices are judged by their bound monitor.",
  ),
  fleetInterfacesDown: translationKey(
    "Ports that are enabled but have no link, summed over all devices from each device's last successful SNMP walk. A switch with three dead ports adds three to this number.",
  ),
  fleetSites: translationKey(
    "Network sites in the project. Unhealthy sites are those whose health, rolled up from the devices at and beneath them, is non-operational, such as Degraded or Offline; sites with no data yet are not counted as unhealthy.",
  ),
  fleetEndpoints: translationKey(
    "Hosts such as PCs, phones and printers found in your switches' and routers' address tables (ARP and MAC forwarding tables) during SNMP walks. Every host found so far is counted, including ones not seen recently.",
  ),
  fleetByVendor: translationKey(
    "Device counts for your six most common vendors, as each device reported over SNMP. Devices with no vendor yet, such as ping-only ones, are grouped as Unknown, and each bar is relative to the largest vendor.",
  ),

  // Probe Latency Matrix (Pages/NetworkDevice/LatencyMatrix.tsx).
  latencyMatrix: translationKey(
    "How long each monitor's latest check took from each of your probes, such as a ping's round trip or a website's response time. Offline means that check failed, a dash means no result, and faded cells are over 10 minutes old. Global probes are not shown.",
  ),

  // Discovery Scans list (Pages/NetworkDevice/Discovery.tsx).
  discoveryRespondedHosts: translationKey(
    "Hosts that answered SNMP out of the addresses swept, with hosts that answered only ping counted separately as alive without SNMP. On a ping-only scan it is the hosts that answered ping. While a scan runs, both cover only what has been swept so far.",
  ),
};
