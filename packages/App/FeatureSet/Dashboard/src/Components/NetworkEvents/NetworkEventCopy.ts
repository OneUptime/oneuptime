import NetworkEventType, {
  NetworkEventKind,
  NetworkEventTypeUtil,
} from "Common/Types/NetworkEvent/NetworkEventType";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of each network event (NetworkEventType in Common holds what
 * it is): what the Events pages call it, and one sentence saying what a
 * device reported. Wrapped in translationKey() so the extractor finds
 * them; looked up where they are shown, in the reader's language.
 *
 * A title is what happened, the way a person would say it when reading a
 * list aloud: "Interface down", not "interface.down".
 */

export interface NetworkEventCopy {
  title: string;
  description: string;
}

export const NETWORK_EVENT_COPY: Record<NetworkEventType, NetworkEventCopy> = {
  [NetworkEventType.InterfaceDown]: {
    title: translationKey("Interface down"),
    description: translationKey("A device reported that a link went down."),
  },
  [NetworkEventType.InterfaceUp]: {
    title: translationKey("Interface up"),
    description: translationKey("A device reported that a link came up."),
  },
  [NetworkEventType.InterfaceErrorDisabled]: {
    title: translationKey("Port shut down by the switch"),
    description: translationKey(
      "A switch disabled a port to protect the network, for example after a loop or a security violation.",
    ),
  },
  [NetworkEventType.DeviceReboot]: {
    title: translationKey("Device restarted"),
    description: translationKey(
      "A device reported that it rebooted or started up.",
    ),
  },
  [NetworkEventType.DeviceConfigChange]: {
    title: translationKey("Configuration changed"),
    description: translationKey(
      "A device reported that its configuration was changed.",
    ),
  },
  [NetworkEventType.DeviceOffline]: {
    title: translationKey("Device offline"),
    description: translationKey(
      "A controller reported that a device it manages went offline.",
    ),
  },
  [NetworkEventType.DeviceOnline]: {
    title: translationKey("Device online"),
    description: translationKey(
      "A controller reported that a device it manages came back online.",
    ),
  },
  [NetworkEventType.HaFailover]: {
    title: translationKey("Failover"),
    description: translationKey(
      "A high-availability pair, cluster or stack reported that another unit took over.",
    ),
  },
  [NetworkEventType.HaStateChange]: {
    title: translationKey("High availability state changed"),
    description: translationKey(
      "A device reported a change in its high-availability role or state.",
    ),
  },
  [NetworkEventType.HaPeerDown]: {
    title: translationKey("High availability peer down"),
    description: translationKey(
      "A device reported that it lost its high-availability peer or a stack member.",
    ),
  },
  [NetworkEventType.HaPeerUp]: {
    title: translationKey("High availability peer up"),
    description: translationKey(
      "A device reported that its high-availability peer or a stack member is back.",
    ),
  },
  [NetworkEventType.VpnTunnelDown]: {
    title: translationKey("VPN tunnel down"),
    description: translationKey(
      "A device reported that a site-to-site VPN tunnel went down.",
    ),
  },
  [NetworkEventType.VpnTunnelUp]: {
    title: translationKey("VPN tunnel up"),
    description: translationKey(
      "A device reported that a site-to-site VPN tunnel came up.",
    ),
  },
  [NetworkEventType.RoutingNeighborDown]: {
    title: translationKey("Routing neighbor down"),
    description: translationKey(
      "A router reported that it lost a BGP, OSPF, EIGRP or IS-IS neighbor.",
    ),
  },
  [NetworkEventType.RoutingNeighborUp]: {
    title: translationKey("Routing neighbor up"),
    description: translationKey(
      "A router reported that a BGP, OSPF, EIGRP or IS-IS neighbor is back.",
    ),
  },
  [NetworkEventType.GatewayDown]: {
    title: translationKey("Gateway down"),
    description: translationKey(
      "A device reported that a gateway or WAN link went down.",
    ),
  },
  [NetworkEventType.GatewayUp]: {
    title: translationKey("Gateway up"),
    description: translationKey(
      "A device reported that a gateway or WAN link came back up.",
    ),
  },
  [NetworkEventType.WanFailover]: {
    title: translationKey("WAN failover"),
    description: translationKey(
      "A device reported that traffic moved to another WAN link.",
    ),
  },
  [NetworkEventType.SdwanSlaNotMet]: {
    title: translationKey("SD-WAN link below its SLA"),
    description: translationKey(
      "A device reported that a WAN link no longer meets its SD-WAN performance targets.",
    ),
  },
  [NetworkEventType.SdwanSlaMet]: {
    title: translationKey("SD-WAN link back within its SLA"),
    description: translationKey(
      "A device reported that a WAN link meets its SD-WAN performance targets again.",
    ),
  },
  [NetworkEventType.HardwareFanFailed]: {
    title: translationKey("Fan failed"),
    description: translationKey("A device reported a failed fan."),
  },
  [NetworkEventType.HardwareFanOk]: {
    title: translationKey("Fan working again"),
    description: translationKey(
      "A device reported that a fan is working again.",
    ),
  },
  [NetworkEventType.HardwarePowerSupplyFailed]: {
    title: translationKey("Power supply failed"),
    description: translationKey(
      "A device reported a failed power supply or lost power input.",
    ),
  },
  [NetworkEventType.HardwarePowerSupplyOk]: {
    title: translationKey("Power supply working again"),
    description: translationKey(
      "A device reported that a power supply is working again.",
    ),
  },
  [NetworkEventType.HardwareTemperatureHigh]: {
    title: translationKey("Temperature too high"),
    description: translationKey(
      "A device reported that it is running too hot.",
    ),
  },
  [NetworkEventType.LoopDetected]: {
    title: translationKey("Loop detected"),
    description: translationKey("A switch reported a network loop on a port."),
  },
  [NetworkEventType.StpTopologyChange]: {
    title: translationKey("Spanning tree topology change"),
    description: translationKey(
      "A switch reported a spanning tree topology change.",
    ),
  },
  [NetworkEventType.PoeFault]: {
    title: translationKey("PoE fault"),
    description: translationKey(
      "A switch reported a Power over Ethernet problem on a port.",
    ),
  },
  [NetworkEventType.AuthLoginFailed]: {
    title: translationKey("Sign-in failed"),
    description: translationKey("Someone failed to sign in to a device."),
  },
  [NetworkEventType.AuthLoginSuccess]: {
    title: translationKey("Signed in"),
    description: translationKey("Someone signed in to a device."),
  },
  [NetworkEventType.WirelessClientConnected]: {
    title: translationKey("Wi-Fi client connected"),
    description: translationKey("A client joined a Wi-Fi network."),
  },
  [NetworkEventType.WirelessClientDisconnected]: {
    title: translationKey("Wi-Fi client disconnected"),
    description: translationKey("A client left a Wi-Fi network."),
  },
};

// What a list filter calls each kind of event.
export const NETWORK_EVENT_KIND_TITLES: Record<NetworkEventKind, string> = {
  [NetworkEventKind.Problem]: translationKey("Problem"),
  [NetworkEventKind.Recovery]: translationKey("Recovery"),
  /*
   * Not "Information": that is the log severity's label, a key of its own
   * that the docs of every language name as their Dashboard draws it.
   */
  [NetworkEventKind.Info]: translationKey("Informational"),
};

/*
 * The copy of an event by its name, or null for a name that is not a
 * built-in event: a project's own event has no words here, and is shown by
 * its name.
 */
export function getNetworkEventCopy(name: unknown): NetworkEventCopy | null {
  if (!NetworkEventTypeUtil.isBuiltIn(name)) {
    return null;
  }

  return NETWORK_EVENT_COPY[name];
}

/*
 * What a list calls an event: the vocabulary's words for a built-in one,
 * in the reader's language, and its own name for one a project defined.
 */
export function getNetworkEventTitle(
  name: string,
  translator: Translator,
): string {
  const copy: NetworkEventCopy | null = getNetworkEventCopy(name);

  return copy ? translator.translateText(copy.title) || copy.title : name;
}
