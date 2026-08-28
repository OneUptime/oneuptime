import {
  NetworkTopologyDeviceRole,
  NetworkTopologyEdge,
  NetworkTopologyLinkProtocol,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import NetworkDeviceMonitoringMethod from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import {
  MAX_DEVICE_DESCRIPTION_LENGTH,
  MAX_DEVICE_NAME_LENGTH,
} from "Common/Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import { parseDeviceRoleOverride } from "Common/Utils/Monitor/NetworkDeviceRoleUtil";
import { normalizeMac } from "Common/Utils/Monitor/EndpointAttachmentUtil";
import ColumnLength from "Common/Types/Database/ColumnLength";

/*
 * Turning an unmanaged neighbour on the topology map into a NetworkDevice
 * the project actually monitors — issue #3435.
 *
 * The map already knows what these boxes are: LLDP and CDP report a name, a
 * platform string, the switch port they hang off and (once the probe reads
 * the management-address tables) an address. Until now the only thing an
 * operator could do with any of it was read it, then retype it into
 * Network > Devices > Create. This module is the recipe for going straight
 * from the one to the other.
 *
 * Pure and react-free on purpose, the same way NetworkTopologyMeta and
 * TopologyLayout are: every rule below is a judgement call about somebody's
 * network — which end of a cable is the managed one, whether a phone should
 * be SNMP-polled, whether the map will still draw the link afterwards — and
 * those are worth testing directly rather than through a rendered form.
 */

/*
 * One cable between the peer being adopted and a device we already manage.
 *
 * Only managed ends are collected, because they are the only ones with
 * anything to say: they carry the site and the probe worth inheriting, and
 * a name worth putting in front of the operator. A cable between two
 * strangers is drawn on the map and tells the create form nothing.
 */
export interface AdoptableNeighborLink {
  // The MANAGED end.
  deviceId: string;
  deviceName: string;
  /*
   * Port on the MANAGED end, as the map labels it — "GigabitEthernet1/0/12",
   * the thing an operator would walk over and look at. The peer's own port
   * is deliberately not carried: on the leaf devices this flow is mostly
   * about, it is a label like "Port 1" that identifies nothing.
   */
  devicePortName?: string | undefined;
  protocols: Array<NetworkTopologyLinkProtocol>;
}

/* Everything the "Add to Monitoring" form opens pre-filled with. */
export interface NeighborAdoptionDraft {
  /*
   * The advertised identifier, VERBATIM apart from a length trim.
   *
   * Load-bearing, and the reason nothing here decorates it: the topology
   * builder re-matches a neighbour report to a managed device by comparing
   * the advertised string against the device's name, hostname and sysName
   * after nothing more forgiving than trim-and-lowercase. Append " (10.0.0.5)"
   * to disambiguate and the peer does not collapse into the new device — the
   * map grows a second, floating node instead and keeps the stranger.
   */
  name: string;
  // "" when nothing worth pre-filling was discovered; the field is required.
  hostname: string;
  // Omitted when the classifier committed to nothing; "unknown" is not a role.
  deviceRole?: NetworkTopologyDeviceRole | undefined;
  description: string;
  monitoringMethod: NetworkDeviceMonitoringMethod;
  links: Array<AdoptableNeighborLink>;
  /* One sentence for the dialog: where this device came from. */
  provenance: string;
  /*
   * Things the operator should know BEFORE submitting, not after. Empty for
   * the ordinary case where a neighbour advertised an address and a name
   * that both fit.
   */
  warnings: Array<string>;
}

/*
 * Roles that are never SNMP-walkable in practice — a desk phone, a printer,
 * a camera, a plain host. Defaulting those to SNMP would create a device
 * that queues a walk it can only fail, and leave the operator reading
 * "pending" forever wondering which credential they got wrong.
 *
 * Everything else, INCLUDING an unclassified peer, defaults to SNMP: an
 * unidentified box hanging off a switch's uplink port is far more often a
 * switch nobody has added yet than it is a kiosk.
 */
const MONITOR_BACKED_ROLES: ReadonlySet<NetworkTopologyDeviceRole> =
  new Set<NetworkTopologyDeviceRole>(["phone", "printer", "camera", "host"]);

const IPV4_PATTERN: RegExp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/*
 * A dotted name made only of hostname-legal characters. Deliberately strict:
 * a CDP platform string ("cisco WS-C3750X-48") and a Cisco device id with
 * its serial in brackets ("switch(FDO1234X5YZ)") both contain characters no
 * resolver would accept, and pre-filling either as an address would hand the
 * probe something guaranteed to fail.
 */
const HOSTNAME_PATTERN: RegExp =
  /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;

/*
 * A last label made only of digits. No resolver will answer for one — the
 * top-level label of a real name is never all-numeric — and it is what
 * distinguishes a name from a partially-typed address ("10.0.0" would
 * otherwise pass every other check here).
 */
const NUMERIC_LAST_LABEL_PATTERN: RegExp = /\.\d+$/;

/*
 * The hostname column is ShortText. Truncating an address is not an option
 * the way truncating a NAME is: a shortened name is still a label somebody
 * can read, and a shortened address is a different address.
 */
const MAX_HOSTNAME_LENGTH: number = ColumnLength.ShortText;

const PROTOCOL_LABELS: Record<NetworkTopologyLinkProtocol, string> = {
  lldp: "LLDP",
  cdp: "CDP",
  fdb: "the forwarding database",
  manual: "a declared link",
};

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.substring(0, maxLength) : value;
}

/*
 * Whether this node is one an operator can bring into monitoring.
 *
 * Managed nodes already are one. Endpoint nodes are deliberately excluded:
 * they are ARP/FDB-learned hosts that already have a NetworkEndpoint row of
 * their own, and creating a NetworkDevice beside one would draw the same box
 * on the map twice — the endpoint node is keyed on its MAC and would survive
 * the adoption untouched. That is a separate piece of work, not a smaller
 * version of this one.
 */
export function isAdoptableNode(node: NetworkTopologyNode): boolean {
  if (node.isManaged) {
    return false;
  }

  /*
   * Older payloads carry no `kind` at all and are read as unmanaged, which
   * is the documented rule on the wire type — so only an explicit "endpoint"
   * disqualifies a node here.
   */
  return node.kind !== "endpoint";
}

/*
 * The peer's links to devices we already manage, in map order.
 *
 * An unmanaged node is always the FAR end of a discovered edge — the report
 * came from the managed switch — but both orientations are handled anyway:
 * an operator-declared link can be drawn either way round, and reading the
 * wrong end would attribute the switch's port to the phone.
 */
export function managedLinksForNode(
  node: NetworkTopologyNode,
  edges: Array<NetworkTopologyEdge>,
  nodeById: Map<string, NetworkTopologyNode>,
): Array<AdoptableNeighborLink> {
  const links: Array<AdoptableNeighborLink> = [];

  for (const edge of edges) {
    const isFromEnd: boolean = edge.fromNodeId === node.id;
    const isToEnd: boolean = edge.toNodeId === node.id;
    if (!isFromEnd && !isToEnd) {
      continue;
    }

    const otherId: string = isFromEnd ? edge.toNodeId : edge.fromNodeId;
    const other: NetworkTopologyNode | undefined = nodeById.get(otherId);

    /*
     * A node the payload does not carry cannot be named, and an unmanaged
     * one has no row to link to. Both are skipped rather than guessed at.
     */
    if (!other || !other.isManaged) {
      continue;
    }

    links.push({
      deviceId: otherId,
      deviceName: other.name,
      devicePortName: isFromEnd ? edge.toPort : edge.fromPort,
      protocols: edge.protocols || [],
    });
  }

  return links;
}

/*
 * The address to pre-fill.
 *
 * First choice is the management address the neighbours advertised, which is
 * the whole point of reading cdpCacheAddress and lldpRemManAddrTable. Second
 * is the advertised NAME, but only when it is shaped like something a
 * resolver could answer for — "dist-sw-02.example.com" is an address as well
 * as an identity, "SEP6026AAF2B46B" is only an identity.
 */
export function hostnameForNode(node: NetworkTopologyNode): string {
  const advertisedAddress: string = (node.ipAddress || "").trim();
  if (advertisedAddress) {
    return advertisedAddress;
  }

  const name: string = (node.name || "").trim();

  if (IPV4_PATTERN.test(name)) {
    return name;
  }

  /*
   * Everything a dotted name has to survive to be offered as an address.
   *
   * A MAC is the trap worth naming: Cisco gear with no configured hostname
   * reports its chassis MAC as the CDP device id, in dotted-hex form
   * ("0060.5c15.3d02"), which is hostname-legal in every character and
   * resolves nowhere. So is a partial address ("10.0.0"), which the
   * dotted-label check alone would wave through. And a name too long for
   * the column cannot be shortened, because a shortened address is a
   * different address — better to hand the operator an empty required
   * field and say why.
   */
  if (
    HOSTNAME_PATTERN.test(name) &&
    !normalizeMac(name) &&
    !NUMERIC_LAST_LABEL_PATTERN.test(name) &&
    name.length <= MAX_HOSTNAME_LENGTH
  ) {
    return name;
  }

  return "";
}

/*
 * The single id every neighbour that has one agrees on, or undefined.
 *
 * Used to inherit a site and a probe from the switches the peer hangs off: a
 * device on a switch port is on that switch's network, so its probe reaches
 * it and its site contains it. Disagreement returns undefined rather than a
 * majority — a device silently filed in the wrong site is worse than an
 * empty field the operator fills in, and a probe that cannot reach the
 * device produces a monitored device that is permanently down.
 */
export function unanimousId(
  ids: Array<string | undefined>,
): string | undefined {
  let agreed: string | undefined = undefined;

  for (const id of ids) {
    if (!id) {
      continue;
    }
    if (!agreed) {
      agreed = id;
      continue;
    }
    if (agreed !== id) {
      return undefined;
    }
  }

  return agreed;
}

/* The protocols that reported this peer, named for a human. */
function protocolLabelsForLinks(links: Array<AdoptableNeighborLink>): string {
  const labels: Array<string> = [];

  for (const link of links) {
    for (const protocol of link.protocols) {
      const label: string | undefined = PROTOCOL_LABELS[protocol];
      if (label && !labels.includes(label)) {
        labels.push(label);
      }
    }
  }

  if (labels.length === 0) {
    return "the network map";
  }

  return labels.join(" and ");
}

/* "UN1289LANSWI01 (GigabitEthernet1/0/12)", or just the device name. */
function describeLink(link: AdoptableNeighborLink): string {
  return link.devicePortName
    ? `${link.deviceName} (${link.devicePortName})`
    : link.deviceName;
}

/*
 * Where this device came from, as one sentence — the provenance the issue
 * asks the form to carry over instead of making the operator retype it.
 */
export function provenanceForLinks(
  links: Array<AdoptableNeighborLink>,
): string {
  /*
   * A peer with no managed neighbour left is not a normal state — the map
   * drew it because SOMETHING reported it — but it is reachable (the other
   * end has since been archived, or the link was filtered out of the view),
   * and a sentence that names no protocol is better than one that names the
   * map as its own source.
   */
  if (links.length === 0) {
    return "Discovered on the network map.";
  }

  const described: Array<string> = links.map(describeLink);

  return `Discovered by ${protocolLabelsForLinks(
    links,
  )} as a neighbour of ${described.join(", ")}.`;
}

/*
 * Everything the create form opens with, worked out from the map alone.
 *
 * The form stays fully editable — this is a head start, not a decision. What
 * it must not do is quietly change any value the topology builder matches
 * on, which is why the name is copied verbatim and the warnings below say so
 * whenever that was impossible.
 */
export function buildNeighborAdoptionDraft(data: {
  node: NetworkTopologyNode;
  edges: Array<NetworkTopologyEdge>;
  nodeById: Map<string, NetworkTopologyNode>;
}): NeighborAdoptionDraft {
  const node: NetworkTopologyNode = data.node;

  const links: Array<AdoptableNeighborLink> = managedLinksForNode(
    node,
    data.edges,
    data.nodeById,
  );

  const advertisedName: string = (node.name || "").trim();
  const name: string = truncate(advertisedName, MAX_DEVICE_NAME_LENGTH);
  const hostname: string = hostnameForNode(node);
  const role: NetworkTopologyDeviceRole | undefined = parseDeviceRoleOverride(
    node.role,
  );
  const monitoringMethod: NetworkDeviceMonitoringMethod =
    role && MONITOR_BACKED_ROLES.has(role)
      ? NetworkDeviceMonitoringMethod.Monitor
      : NetworkDeviceMonitoringMethod.Snmp;

  const provenance: string = provenanceForLinks(links);

  /*
   * The platform string leads, because it is the most specific thing anyone
   * knows about the box, and because `deviceModel` cannot be written at
   * create time at all — this is its only home until the probe walks the
   * device itself.
   */
  const description: string = truncate(
    node.deviceModel ? `${node.deviceModel}. ${provenance}` : provenance,
    MAX_DEVICE_DESCRIPTION_LENGTH,
  );

  const warnings: Array<string> = [];

  if (!hostname) {
    warnings.push(
      "No management address was discovered for this device, so you will need to enter one. LLDP and CDP report an address only when the neighbour is configured to advertise it.",
    );
  }

  if (name !== advertisedName) {
    warnings.push(
      `The name this device advertises is too long to store, so it has been shortened to "${name}". The map re-matches on the name and the hostname, so set the hostname to something this device answers to or it will stay on the map as a separate unmanaged node.`,
    );
  }

  return {
    name: name,
    hostname: hostname,
    /*
     * Only for a device nothing will ever walk.
     *
     * `deviceRole` is not a hint, it is an OVERRIDE: once set, the topology
     * builder returns it and never runs the classifier again. The role we
     * have here came from classifying a peer on its advertised name and, at
     * best, a CDP platform string — for an LLDP-only peer that is a
     * hostname convention and nothing else, so "gw-floor3-sw2" arrives as
     * "router". Writing that onto a device the probe is about to walk would
     * permanently outrank the sysDescr and sysObjectID that would have
     * answered correctly. A monitor-backed device has no such future: it is
     * never walked, so a guess from its neighbours is the only evidence
     * there will ever be, and the field's own help text says to set it.
     */
    deviceRole:
      monitoringMethod === NetworkDeviceMonitoringMethod.Monitor
        ? role
        : undefined,
    description: description,
    monitoringMethod: monitoringMethod,
    links: links,
    provenance: provenance,
    warnings: warnings,
  };
}
