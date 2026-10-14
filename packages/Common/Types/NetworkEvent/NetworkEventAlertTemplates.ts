import Dictionary from "../Dictionary";
import NetworkEventAttribute, {
  NETWORK_EVENT_DOMAIN,
} from "./NetworkEventAttribute";
import NetworkEventType, {
  NetworkEventCategory,
  NetworkEventDefinition,
  NetworkEventKind,
  NetworkEventTypeUtil,
} from "./NetworkEventType";

/*
 * BEING TOLD WHEN SOMETHING HAPPENS ON THE NETWORK, ONE CLICK AWAY.
 *
 * Each template is a Logs monitor ready to create: which events it counts,
 * how they are grouped into alerts, and which event says a group has
 * recovered. The Network product's Events page lists the featured ones;
 * picking one opens Create Monitor filled in, where everything can still
 * be changed before saving. Any other event - a built-in one, or one a
 * project named itself in a log pipeline - gets a monitor built the same
 * way from what is known of it.
 *
 * The rules they follow:
 *
 *   - One alert per device, and per thing on it when the event names one:
 *     an interface that flaps is one alert, not one per flap, and two
 *     tunnels down on one firewall are two.
 *   - A problem that has a recovery event stays open until the device
 *     reports the recovery. "The tunnel went down" is over when the device
 *     says the tunnel is up, not when it has said nothing for five
 *     minutes.
 *   - An event with no recovery - a reboot, a failover - closes on its own
 *     once it has been quiet for the monitor's window.
 *
 * The values are not persisted as templates: a created monitor owns its
 * copy. The words of each template are the Dashboard's
 * (Components/NetworkEvents/NetworkEventAlertTemplateCopy.ts).
 */

export enum NetworkEventAlertTemplateId {
  VpnTunnelDown = "vpn-tunnel-down",
  HaFailover = "ha-failover",
  WanGatewayDown = "wan-gateway-down",
  RoutingNeighborDown = "routing-neighbor-down",
  DeviceReboot = "device-reboot",
  HardwareFailure = "hardware-failure",
  InterfaceDown = "interface-down",
  FailedLogins = "failed-logins",
}

export type NetworkEventAlertTemplateSeverity = "Critical" | "Warning";

// How long a Logs monitor on an event looks back: five minutes.
export const NETWORK_EVENT_ALERT_WINDOW_IN_SECONDS: number = 300;

// Failed sign-ins on one device, within the window, before it is worth an alert.
export const FAILED_LOGINS_ALERT_THRESHOLD: number = 10;

export interface NetworkEventAlertTemplate {
  /*
   * A featured template's id, or - for a monitor built from an event alone
   * - the event's name.
   */
  id: string;
  // The event it is about. Absent on a template that counts several.
  event?: string | undefined;
  // The attributes of the logs it counts.
  attributes: Dictionary<string>;
  /*
   * The attributes of the log that says a group has recovered. Empty when
   * the event has no recovery: the group then resolves when its logs stop.
   */
  resolvedByAttributes: Dictionary<string>;
  // One alert per distinct combination of these attributes' values.
  groupByAttributes: Array<string>;
  windowInSeconds: number;
  // Alerts when a group has more than this many logs in the window.
  moreThan: number;
  severity: NetworkEventAlertTemplateSeverity;
}

function eventAttributes(event: string): Dictionary<string> {
  return {
    [NetworkEventAttribute.Domain]: NETWORK_EVENT_DOMAIN,
    [NetworkEventAttribute.Name]: event,
  };
}

/*
 * A monitor for one event, from what the vocabulary knows of it: grouped
 * by the device and by the event's subject, and resolved by the event that
 * clears it. A project's own event is grouped by device alone.
 */
function forEvent(
  event: string,
  overrides: Partial<NetworkEventAlertTemplate> = {},
): NetworkEventAlertTemplate {
  const definition: NetworkEventDefinition | null =
    NetworkEventTypeUtil.get(event);

  const groupByAttributes: Array<string> = [NetworkEventAttribute.Device];

  /*
   * Only a problem is alerted on per subject. Something that merely
   * happened - a client joining Wi-Fi - would otherwise raise one alert
   * per client.
   */
  if (
    definition?.subjectAttribute &&
    definition.kind === NetworkEventKind.Problem
  ) {
    groupByAttributes.push(definition.subjectAttribute);
  }

  return {
    id: event,
    event: event,
    attributes: eventAttributes(event),
    resolvedByAttributes: definition?.clearedBy
      ? eventAttributes(definition.clearedBy)
      : {},
    groupByAttributes: groupByAttributes,
    windowInSeconds: NETWORK_EVENT_ALERT_WINDOW_IN_SECONDS,
    moreThan: 0,
    severity: "Warning",
    ...overrides,
  };
}

/*
 * The featured templates, in the order the page shows them: what takes a
 * site or a path down first, then what is worth knowing, then the noisy.
 */
const FEATURED: ReadonlyArray<NetworkEventAlertTemplate> = [
  forEvent(NetworkEventType.VpnTunnelDown, {
    id: NetworkEventAlertTemplateId.VpnTunnelDown,
    severity: "Critical",
  }),
  forEvent(NetworkEventType.HaFailover, {
    id: NetworkEventAlertTemplateId.HaFailover,
    // One alert per pair: the role a unit took is not what is alerted on.
    groupByAttributes: [NetworkEventAttribute.Device],
    severity: "Critical",
  }),
  forEvent(NetworkEventType.GatewayDown, {
    id: NetworkEventAlertTemplateId.WanGatewayDown,
    severity: "Critical",
  }),
  forEvent(NetworkEventType.RoutingNeighborDown, {
    id: NetworkEventAlertTemplateId.RoutingNeighborDown,
    severity: "Critical",
  }),
  forEvent(NetworkEventType.DeviceReboot, {
    id: NetworkEventAlertTemplateId.DeviceReboot,
  }),
  {
    /*
     * Every hardware problem - a fan, a power supply, the temperature -
     * as one monitor, by category: a failed component is resolved by the
     * same component reported working again.
     */
    id: NetworkEventAlertTemplateId.HardwareFailure,
    attributes: {
      [NetworkEventAttribute.Domain]: NETWORK_EVENT_DOMAIN,
      [NetworkEventAttribute.Category]: NetworkEventCategory.Hardware,
      [NetworkEventAttribute.Kind]: NetworkEventKind.Problem,
    },
    resolvedByAttributes: {
      [NetworkEventAttribute.Domain]: NETWORK_EVENT_DOMAIN,
      [NetworkEventAttribute.Category]: NetworkEventCategory.Hardware,
      [NetworkEventAttribute.Kind]: NetworkEventKind.Recovery,
    },
    groupByAttributes: [
      NetworkEventAttribute.Device,
      NetworkEventAttribute.HardwareName,
    ],
    windowInSeconds: NETWORK_EVENT_ALERT_WINDOW_IN_SECONDS,
    moreThan: 0,
    severity: "Critical",
  },
  forEvent(NetworkEventType.InterfaceDown, {
    id: NetworkEventAlertTemplateId.InterfaceDown,
  }),
  forEvent(NetworkEventType.AuthLoginFailed, {
    id: NetworkEventAlertTemplateId.FailedLogins,
    /*
     * A burst on one device, whoever the name tried: one mistyped
     * password is not an alert, and a guessing run tries many names.
     */
    groupByAttributes: [NetworkEventAttribute.Device],
    moreThan: FAILED_LOGINS_ALERT_THRESHOLD,
  }),
];

export default class NetworkEventAlertTemplates {
  // The templates the Events page offers, in its order.
  public static getFeatured(): ReadonlyArray<NetworkEventAlertTemplate> {
    return FEATURED;
  }

  public static isFeatured(id: unknown): id is NetworkEventAlertTemplateId {
    return FEATURED.some((template: NetworkEventAlertTemplate): boolean => {
      return template.id === id;
    });
  }

  /*
   * A featured template by its id, or the monitor for an event by the
   * event's name - a built-in one or a project's own. Null for anything
   * that is neither.
   */
  public static get(id: unknown): NetworkEventAlertTemplate | null {
    if (typeof id !== "string") {
      return null;
    }

    const featured: NetworkEventAlertTemplate | undefined = FEATURED.find(
      (template: NetworkEventAlertTemplate): boolean => {
        return template.id === id;
      },
    );

    if (featured) {
      return NetworkEventAlertTemplates.copyOf(featured);
    }

    if (!NetworkEventTypeUtil.isValidName(id)) {
      return null;
    }

    return forEvent(id);
  }

  /*
   * The same template, for the events of one device only. The device is
   * named by its id, which a rename does not change.
   */
  public static forDevice(
    template: NetworkEventAlertTemplate,
    networkDeviceId: string,
  ): NetworkEventAlertTemplate {
    const scoped: NetworkEventAlertTemplate =
      NetworkEventAlertTemplates.copyOf(template);

    scoped.attributes["networkDevice.id"] = networkDeviceId;

    if (Object.keys(scoped.resolvedByAttributes).length > 0) {
      scoped.resolvedByAttributes["networkDevice.id"] = networkDeviceId;
    }

    return scoped;
  }

  // A copy a caller may change: the featured ones are shared.
  private static copyOf(
    template: NetworkEventAlertTemplate,
  ): NetworkEventAlertTemplate {
    return {
      ...template,
      attributes: { ...template.attributes },
      resolvedByAttributes: { ...template.resolvedByAttributes },
      groupByAttributes: [...template.groupByAttributes],
    };
  }
}
