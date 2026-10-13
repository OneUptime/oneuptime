/*
 * The log attributes a network event is stored with.
 *
 * OpenTelemetry's names are used where it has one (event.name,
 * network.interface.name, network.peer.address, network.protocol.name,
 * user.name, client.address, hw.name); the rest follow their style. They
 * are the same for every vendor: that is the point of them.
 *
 * `event.domain` is "network" on every event of this vocabulary, so a
 * search for network events does not also find the events applications
 * send over OpenTelemetry under `event.name` (Kubernetes events carry
 * `event.domain` = "k8s" the same way).
 *
 * These keys are stored in customers' logs and in the filters and group-by
 * lists of their monitors: never rename one.
 */
enum NetworkEventAttribute {
  // "network" on every network event.
  Domain = "event.domain",
  // What happened: a NetworkEventType value, or a project's own name.
  Name = "event.name",
  // The device's own words for it, without its header and field names.
  Message = "event.message",
  // problem, recovery or info (NetworkEventKind). Built-in events only.
  Kind = "event.kind",
  // interface, vpn, ha, ... (NetworkEventCategory). Built-in events only.
  Category = "event.category",
  /*
   * Which device, in words: its name in OneUptime, else the name it gives
   * itself, else its address. On every network event, so one can be told
   * from another's - and grouped by - whether or not the device has been
   * added to OneUptime.
   */
  Device = "event.device",

  // What it happened to.
  InterfaceName = "network.interface.name",
  PeerAddress = "network.peer.address",
  ProtocolName = "network.protocol.name",
  VpnTunnelName = "vpn.tunnel.name",
  GatewayName = "network.gateway.name",
  HardwareName = "hw.name",
  HaRole = "ha.role",
  // A cluster, stack or MLAG member, as its peers name it.
  HaPeer = "ha.peer",

  // Who did it, and from where.
  UserName = "user.name",
  ClientAddress = "client.address",
  ClientMac = "client.mac",
  WifiSsid = "wifi.ssid",
}

export const NETWORK_EVENT_DOMAIN: string = "network";

// Longest value kept for the event's message.
export const MAX_NETWORK_EVENT_MESSAGE_LENGTH: number = 1024;

// Longest value kept for what an event is about (an interface, a tunnel, a user).
export const MAX_NETWORK_EVENT_SUBJECT_LENGTH: number = 256;

export default NetworkEventAttribute;
