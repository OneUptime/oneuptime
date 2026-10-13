import NetworkEventAttribute from "./NetworkEventAttribute";

/*
 * WHAT HAPPENED ON THE NETWORK, IN ONE VOCABULARY.
 *
 * Every vendor words the same thing its own way: a Cisco switch logs
 * "%LINK-3-UPDOWN: Interface Gi0/1, changed state to down", an Extreme one
 * "Port 1:12 link down", a Sophos firewall interface="Port2" with the
 * message "Interface Port2 is Down", and a standard SNMP trap says linkDown.
 * All four are the same event, and a person who wants to be told when an
 * interface goes down should not have to know any of them.
 *
 * So each recognised message is stored with the name of what happened -
 * one of the types below, written to the log as the attribute `event.name`
 * (NetworkEventAttribute.Name) - and with what it happened to in the
 * attribute the type names as its subject. Searches, Logs monitors,
 * dashboards and workflows then work on "interface.down", whoever made the
 * device.
 *
 * The list is short on purpose: it holds what a network operator acts on,
 * not every line a device can write. A value here is stored in customers'
 * logs and in the filters of their monitors, so never rename one; add a new
 * one instead.
 *
 * The words people read for each type (its title and its sentence) are the
 * Dashboard's, where they are translated
 * (Components/NetworkEvents/NetworkEventCopy.ts).
 */
export enum NetworkEventType {
  // Interfaces.
  InterfaceDown = "interface.down",
  InterfaceUp = "interface.up",
  InterfaceErrorDisabled = "interface.error_disabled",

  // The device itself.
  DeviceReboot = "device.reboot",
  DeviceConfigChange = "device.config_change",
  // A device a controller manages, as its controller sees it.
  DeviceOffline = "device.offline",
  DeviceOnline = "device.online",

  // High availability: pairs, clusters, stacks.
  HaFailover = "ha.failover",
  HaStateChange = "ha.state_change",
  HaPeerDown = "ha.peer_down",
  HaPeerUp = "ha.peer_up",

  // Site-to-site tunnels.
  VpnTunnelDown = "vpn.tunnel_down",
  VpnTunnelUp = "vpn.tunnel_up",

  // Routing protocol neighbours: BGP, OSPF, EIGRP, IS-IS.
  RoutingNeighborDown = "routing.neighbor_down",
  RoutingNeighborUp = "routing.neighbor_up",

  // WAN links and SD-WAN.
  GatewayDown = "gateway.down",
  GatewayUp = "gateway.up",
  WanFailover = "wan.failover",
  SdwanSlaNotMet = "sdwan.sla_not_met",
  SdwanSlaMet = "sdwan.sla_met",

  // Hardware.
  HardwareFanFailed = "hardware.fan_failed",
  HardwareFanOk = "hardware.fan_ok",
  HardwarePowerSupplyFailed = "hardware.power_supply_failed",
  HardwarePowerSupplyOk = "hardware.power_supply_ok",
  HardwareTemperatureHigh = "hardware.temperature_high",

  // Switching.
  LoopDetected = "loop.detected",
  StpTopologyChange = "stp.topology_change",
  PoeFault = "poe.fault",

  // Signing in to the device.
  AuthLoginFailed = "auth.login_failed",
  AuthLoginSuccess = "auth.login_success",

  // Wi-Fi clients.
  WirelessClientConnected = "wireless.client_connected",
  WirelessClientDisconnected = "wireless.client_disconnected",
}

/*
 * How an event reads to someone scanning a list: something went wrong,
 * something came back, or something simply happened.
 */
export enum NetworkEventKind {
  Problem = "problem",
  Recovery = "recovery",
  Info = "info",
}

export enum NetworkEventCategory {
  Interface = "interface",
  Device = "device",
  HighAvailability = "ha",
  Vpn = "vpn",
  Routing = "routing",
  Wan = "wan",
  Hardware = "hardware",
  Switching = "switching",
  Security = "security",
  Wireless = "wireless",
}

export interface NetworkEventDefinition {
  type: NetworkEventType;
  category: NetworkEventCategory;
  kind: NetworkEventKind;
  /*
   * The attribute that names what the event is about - the interface, the
   * tunnel, the neighbour - when the type has one. A monitor that groups by
   * it raises one alert per interface, tunnel or neighbour.
   */
  subjectAttribute?: NetworkEventAttribute | undefined;
  // The event that says a problem is over, for the types that have one.
  clearedBy?: NetworkEventType | undefined;
}

export const NETWORK_EVENT_DEFINITIONS: ReadonlyArray<NetworkEventDefinition> =
  [
    {
      type: NetworkEventType.InterfaceDown,
      category: NetworkEventCategory.Interface,
      kind: NetworkEventKind.Problem,
      subjectAttribute: NetworkEventAttribute.InterfaceName,
      clearedBy: NetworkEventType.InterfaceUp,
    },
    {
      type: NetworkEventType.InterfaceUp,
      category: NetworkEventCategory.Interface,
      kind: NetworkEventKind.Recovery,
      subjectAttribute: NetworkEventAttribute.InterfaceName,
    },
    {
      type: NetworkEventType.InterfaceErrorDisabled,
      category: NetworkEventCategory.Interface,
      kind: NetworkEventKind.Problem,
      subjectAttribute: NetworkEventAttribute.InterfaceName,
    },
    {
      type: NetworkEventType.DeviceReboot,
      category: NetworkEventCategory.Device,
      kind: NetworkEventKind.Problem,
    },
    {
      type: NetworkEventType.DeviceConfigChange,
      category: NetworkEventCategory.Device,
      kind: NetworkEventKind.Info,
      subjectAttribute: NetworkEventAttribute.UserName,
    },
    {
      type: NetworkEventType.DeviceOffline,
      category: NetworkEventCategory.Device,
      kind: NetworkEventKind.Problem,
      clearedBy: NetworkEventType.DeviceOnline,
    },
    {
      type: NetworkEventType.DeviceOnline,
      category: NetworkEventCategory.Device,
      kind: NetworkEventKind.Recovery,
    },
    {
      type: NetworkEventType.HaFailover,
      category: NetworkEventCategory.HighAvailability,
      kind: NetworkEventKind.Problem,
      subjectAttribute: NetworkEventAttribute.HaRole,
    },
    {
      type: NetworkEventType.HaStateChange,
      category: NetworkEventCategory.HighAvailability,
      kind: NetworkEventKind.Info,
      subjectAttribute: NetworkEventAttribute.HaRole,
    },
    {
      type: NetworkEventType.HaPeerDown,
      category: NetworkEventCategory.HighAvailability,
      kind: NetworkEventKind.Problem,
      subjectAttribute: NetworkEventAttribute.HaPeer,
      clearedBy: NetworkEventType.HaPeerUp,
    },
    {
      type: NetworkEventType.HaPeerUp,
      category: NetworkEventCategory.HighAvailability,
      kind: NetworkEventKind.Recovery,
      subjectAttribute: NetworkEventAttribute.HaPeer,
    },
    {
      type: NetworkEventType.VpnTunnelDown,
      category: NetworkEventCategory.Vpn,
      kind: NetworkEventKind.Problem,
      subjectAttribute: NetworkEventAttribute.VpnTunnelName,
      clearedBy: NetworkEventType.VpnTunnelUp,
    },
    {
      type: NetworkEventType.VpnTunnelUp,
      category: NetworkEventCategory.Vpn,
      kind: NetworkEventKind.Recovery,
      subjectAttribute: NetworkEventAttribute.VpnTunnelName,
    },
    {
      type: NetworkEventType.RoutingNeighborDown,
      category: NetworkEventCategory.Routing,
      kind: NetworkEventKind.Problem,
      subjectAttribute: NetworkEventAttribute.PeerAddress,
      clearedBy: NetworkEventType.RoutingNeighborUp,
    },
    {
      type: NetworkEventType.RoutingNeighborUp,
      category: NetworkEventCategory.Routing,
      kind: NetworkEventKind.Recovery,
      subjectAttribute: NetworkEventAttribute.PeerAddress,
    },
    {
      type: NetworkEventType.GatewayDown,
      category: NetworkEventCategory.Wan,
      kind: NetworkEventKind.Problem,
      subjectAttribute: NetworkEventAttribute.GatewayName,
      clearedBy: NetworkEventType.GatewayUp,
    },
    {
      type: NetworkEventType.GatewayUp,
      category: NetworkEventCategory.Wan,
      kind: NetworkEventKind.Recovery,
      subjectAttribute: NetworkEventAttribute.GatewayName,
    },
    {
      type: NetworkEventType.WanFailover,
      category: NetworkEventCategory.Wan,
      kind: NetworkEventKind.Problem,
      subjectAttribute: NetworkEventAttribute.GatewayName,
    },
    {
      type: NetworkEventType.SdwanSlaNotMet,
      category: NetworkEventCategory.Wan,
      kind: NetworkEventKind.Problem,
      subjectAttribute: NetworkEventAttribute.GatewayName,
      clearedBy: NetworkEventType.SdwanSlaMet,
    },
    {
      type: NetworkEventType.SdwanSlaMet,
      category: NetworkEventCategory.Wan,
      kind: NetworkEventKind.Recovery,
      subjectAttribute: NetworkEventAttribute.GatewayName,
    },
    {
      type: NetworkEventType.HardwareFanFailed,
      category: NetworkEventCategory.Hardware,
      kind: NetworkEventKind.Problem,
      subjectAttribute: NetworkEventAttribute.HardwareName,
      clearedBy: NetworkEventType.HardwareFanOk,
    },
    {
      type: NetworkEventType.HardwareFanOk,
      category: NetworkEventCategory.Hardware,
      kind: NetworkEventKind.Recovery,
      subjectAttribute: NetworkEventAttribute.HardwareName,
    },
    {
      type: NetworkEventType.HardwarePowerSupplyFailed,
      category: NetworkEventCategory.Hardware,
      kind: NetworkEventKind.Problem,
      subjectAttribute: NetworkEventAttribute.HardwareName,
      clearedBy: NetworkEventType.HardwarePowerSupplyOk,
    },
    {
      type: NetworkEventType.HardwarePowerSupplyOk,
      category: NetworkEventCategory.Hardware,
      kind: NetworkEventKind.Recovery,
      subjectAttribute: NetworkEventAttribute.HardwareName,
    },
    {
      type: NetworkEventType.HardwareTemperatureHigh,
      category: NetworkEventCategory.Hardware,
      kind: NetworkEventKind.Problem,
    },
    {
      type: NetworkEventType.LoopDetected,
      category: NetworkEventCategory.Switching,
      kind: NetworkEventKind.Problem,
      subjectAttribute: NetworkEventAttribute.InterfaceName,
    },
    {
      type: NetworkEventType.StpTopologyChange,
      category: NetworkEventCategory.Switching,
      kind: NetworkEventKind.Info,
    },
    {
      type: NetworkEventType.PoeFault,
      category: NetworkEventCategory.Switching,
      kind: NetworkEventKind.Problem,
      subjectAttribute: NetworkEventAttribute.InterfaceName,
    },
    {
      type: NetworkEventType.AuthLoginFailed,
      category: NetworkEventCategory.Security,
      kind: NetworkEventKind.Problem,
      subjectAttribute: NetworkEventAttribute.UserName,
    },
    {
      type: NetworkEventType.AuthLoginSuccess,
      category: NetworkEventCategory.Security,
      kind: NetworkEventKind.Info,
      subjectAttribute: NetworkEventAttribute.UserName,
    },
    {
      type: NetworkEventType.WirelessClientConnected,
      category: NetworkEventCategory.Wireless,
      kind: NetworkEventKind.Info,
      subjectAttribute: NetworkEventAttribute.ClientMac,
    },
    {
      type: NetworkEventType.WirelessClientDisconnected,
      category: NetworkEventCategory.Wireless,
      kind: NetworkEventKind.Info,
      subjectAttribute: NetworkEventAttribute.ClientMac,
    },
  ];

const DEFINITIONS_BY_TYPE: Map<string, NetworkEventDefinition> = new Map(
  NETWORK_EVENT_DEFINITIONS.map(
    (
      definition: NetworkEventDefinition,
    ): [string, NetworkEventDefinition] => {
      return [definition.type, definition];
    },
  ),
);

/*
 * An event name people may write themselves, in a log pipeline: lower-case
 * words joined by dots, underscores or hyphens ("ups.on_battery"). Names of
 * this shape are kept as events of their own beside the built-in ones.
 */
const EVENT_NAME: RegExp = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export const MAX_NETWORK_EVENT_NAME_LENGTH: number = 64;

export class NetworkEventTypeUtil {
  public static getAll(): ReadonlyArray<NetworkEventDefinition> {
    return NETWORK_EVENT_DEFINITIONS;
  }

  // The definition of a built-in type, or null for any other name.
  public static get(name: unknown): NetworkEventDefinition | null {
    if (typeof name !== "string") {
      return null;
    }

    return DEFINITIONS_BY_TYPE.get(name) || null;
  }

  public static isBuiltIn(name: unknown): name is NetworkEventType {
    return NetworkEventTypeUtil.get(name) !== null;
  }

  /*
   * Whether a text can be an event's name at all - a built-in one, or one a
   * project gives its own events.
   */
  public static isValidName(name: unknown): name is string {
    return (
      typeof name === "string" &&
      name.length > 0 &&
      name.length <= MAX_NETWORK_EVENT_NAME_LENGTH &&
      EVENT_NAME.test(name)
    );
  }

  // Built-in types of a kind, in the list's order.
  public static getByKind(
    kind: NetworkEventKind,
  ): Array<NetworkEventDefinition> {
    return NETWORK_EVENT_DEFINITIONS.filter(
      (definition: NetworkEventDefinition): boolean => {
        return definition.kind === kind;
      },
    );
  }

  /*
   * How an event reads: a built-in type's own kind; a project's own event is
   * something that happened, neither a problem nor a recovery, since nothing
   * here knows what it means.
   */
  public static getKind(name: unknown): NetworkEventKind {
    return NetworkEventTypeUtil.get(name)?.kind || NetworkEventKind.Info;
  }

  // The problem a recovery event ends, if it ends one.
  public static getClearedProblem(name: unknown): NetworkEventType | null {
    for (const definition of NETWORK_EVENT_DEFINITIONS) {
      if (definition.clearedBy === name) {
        return definition.type;
      }
    }

    return null;
  }
}

export default NetworkEventType;
