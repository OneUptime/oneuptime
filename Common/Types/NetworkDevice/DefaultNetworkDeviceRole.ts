import { NetworkTopologyDeviceRole } from "../Monitor/SnmpMonitor/NetworkTopology";
import { NetworkTopologyNodeShape } from "../Monitor/SnmpMonitor/NetworkTopology";

/*
 * The device roles seeded into every project.
 *
 * Device roles used to be a fixed union (NetworkTopologyDeviceRole) with the
 * label, the silhouette and the "is this a core device?" flag each hardcoded
 * in a different module. They are now the per-project NetworkDeviceRole
 * lookup table, so a project can rename "Wireless AP" to "Access Point",
 * change what a firewall is drawn as, or add a role of its own.
 *
 * This file is the single source of truth for the DEFAULTS, shared by
 * ProjectService (which seeds new projects) and the BackfillNetworkDeviceRoles
 * data migration (which seeds projects that predate the table), so the two can
 * never disagree about what a fresh project starts with.
 *
 * `key` is deliberately the built-in NetworkTopologyDeviceRole value. The SNMP
 * classifier speaks that vocabulary and always will — it is evidence-driven
 * and cannot invent a project's custom role — so matching its answer back to a
 * configured row is a lookup by this key. That is also why the key is stable
 * and the name is not: renaming a role must not stop the classifier finding it.
 */
export interface DefaultNetworkDeviceRole {
  key: NetworkTopologyDeviceRole;
  name: string;
  description: string;
  topologyShape: NetworkTopologyNodeShape;
  isCoreLayer: boolean;
  isSnmpWalkable: boolean;
}

/*
 * Ordered exactly as the map legend lists them, because the seeded `order`
 * column is this array's index — a fresh project's settings page and its map
 * legend therefore read in the same sequence.
 *
 * The shapes reproduce the renderer's historical SHAPE_BY_ROLE map and the
 * isCoreLayer flags reproduce its CORE_DEVICE_ROLES set, so a project seeded
 * from this list draws exactly the map it drew before roles were configurable.
 *
 * "unknown" is not here on purpose. It is not a role an operator assigns; it
 * is the classifier saying it has no answer, and offering it as a choice would
 * mean "stop classifying this device forever" rather than "I don't know".
 */
export const DEFAULT_NETWORK_DEVICE_ROLES: ReadonlyArray<DefaultNetworkDeviceRole> =
  [
    {
      key: "router",
      name: "Router",
      description:
        "Moves traffic between networks. Sits at the top of the topology with the other core devices.",
      topologyShape: "circle",
      isCoreLayer: true,
      isSnmpWalkable: true,
    },
    {
      key: "switch",
      name: "Switch",
      description:
        "Access or distribution switching. Endpoints hang off it, and it hangs off a core device.",
      topologyShape: "rounded-square",
      isCoreLayer: false,
      isSnmpWalkable: true,
    },
    {
      key: "firewall",
      name: "Firewall",
      description:
        "Security appliance at a network boundary. Drawn at core level.",
      topologyShape: "diamond",
      isCoreLayer: true,
      isSnmpWalkable: true,
    },
    {
      key: "wirelessAccessPoint",
      name: "Wireless AP",
      description: "Wireless access point serving client devices.",
      topologyShape: "triangle",
      isCoreLayer: false,
      isSnmpWalkable: true,
    },
    {
      key: "loadBalancer",
      name: "Load balancer",
      description:
        "Distributes traffic across a pool of servers. Drawn at core level.",
      topologyShape: "hexagon",
      isCoreLayer: true,
      isSnmpWalkable: true,
    },
    {
      key: "server",
      name: "Server",
      description: "A general purpose server or compute node.",
      topologyShape: "tower",
      isCoreLayer: false,
      isSnmpWalkable: true,
    },
    {
      key: "storage",
      name: "Storage",
      description: "A NAS, SAN or other storage appliance.",
      topologyShape: "cylinder",
      isCoreLayer: false,
      isSnmpWalkable: true,
    },
    {
      key: "printer",
      name: "Printer",
      description: "A network printer or multifunction device.",
      topologyShape: "rect",
      isCoreLayer: false,
      isSnmpWalkable: false,
    },
    {
      key: "camera",
      name: "Camera",
      description: "An IP camera or other video endpoint.",
      topologyShape: "rect",
      isCoreLayer: false,
      isSnmpWalkable: false,
    },
    {
      key: "phone",
      name: "IP phone",
      description: "A VoIP handset or conference phone.",
      topologyShape: "rect",
      isCoreLayer: false,
      isSnmpWalkable: false,
    },
    {
      key: "host",
      name: "Host",
      description:
        "Anything plugged into an access port that is not one of the roles above.",
      topologyShape: "rect",
      isCoreLayer: false,
      isSnmpWalkable: false,
    },
  ];

export default DEFAULT_NETWORK_DEVICE_ROLES;
