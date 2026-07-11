import NetworkTopology, {
  NetworkTopologyEdge,
  NetworkTopologyNode,
  NetworkTopologyNodeStatus,
} from "../../Types/Monitor/SnmpMonitor/NetworkTopology";
import LldpNeighbor from "../../Types/Monitor/SnmpMonitor/LldpNeighbor";

export interface TopologyDeviceInput {
  id: string;
  name: string;
  hostname?: string | undefined;
  sysName?: string | undefined;
  lastSeenAt?: Date | undefined;
  interfacesUp?: number | undefined;
  interfacesDown?: number | undefined;
  lldpNeighbors?: Array<LldpNeighbor> | undefined;
}

// A device not seen within this window is treated as not currently up.
const FRESH_WINDOW_MS: number = 15 * 60 * 1000;

export default class NetworkTopologyUtil {
  /*
   * Builds the topology graph from every device in a project. Nodes are the
   * devices; LLDP neighbors that match another device (by sysName or
   * hostname) become edges, and neighbors that match nothing become
   * lightweight "unmanaged" nodes so links don't dead-end. Edges are
   * undirected and deduplicated, so a link reported from both ends appears
   * once.
   */
  public static buildTopology(
    devices: Array<TopologyDeviceInput>,
    now: Date,
  ): NetworkTopology {
    const nodes: Array<NetworkTopologyNode> = [];
    const edges: Array<NetworkTopologyEdge> = [];

    // Index managed devices by the identifiers LLDP neighbors reference.
    const deviceByMatchKey: Map<string, TopologyDeviceInput> = new Map();
    for (const device of devices) {
      for (const key of NetworkTopologyUtil.matchKeysForDevice(device)) {
        deviceByMatchKey.set(key, device);
      }
    }

    for (const device of devices) {
      nodes.push({
        id: device.id,
        name: device.name,
        isManaged: true,
        status: NetworkTopologyUtil.deviceStatus(device, now),
        interfacesUp: device.interfacesUp,
        interfacesDown: device.interfacesDown,
      });
    }

    const unmanagedNodeIds: Set<string> = new Set();
    const seenEdgeKeys: Set<string> = new Set();

    for (const device of devices) {
      for (const neighbor of device.lldpNeighbors || []) {
        const matchKey: string | undefined =
          NetworkTopologyUtil.normalizeKey(neighbor.remoteSysName) ||
          NetworkTopologyUtil.normalizeKey(neighbor.remoteChassisId);

        if (!matchKey) {
          continue;
        }

        const matched: TopologyDeviceInput | undefined =
          deviceByMatchKey.get(matchKey);

        let toNodeId: string;

        if (matched) {
          if (matched.id === device.id) {
            // Self-referential neighbor entry; skip.
            continue;
          }
          toNodeId = matched.id;
        } else {
          toNodeId = `unmanaged:${matchKey}`;
          if (!unmanagedNodeIds.has(toNodeId)) {
            unmanagedNodeIds.add(toNodeId);
            nodes.push({
              id: toNodeId,
              name:
                neighbor.remoteSysName ||
                neighbor.remoteChassisId ||
                "Unknown device",
              isManaged: false,
              status: "unknown",
            });
          }
        }

        // Undirected dedupe: canonicalize the endpoint pair.
        const edgeKey: string = [device.id, toNodeId].sort().join("::");
        if (seenEdgeKeys.has(edgeKey)) {
          continue;
        }
        seenEdgeKeys.add(edgeKey);

        edges.push({
          fromNodeId: device.id,
          toNodeId: toNodeId,
          fromPort:
            neighbor.localInterfaceIndex !== undefined
              ? `if${neighbor.localInterfaceIndex}`
              : undefined,
          toPort: neighbor.remotePortId,
        });
      }
    }

    return { nodes, edges };
  }

  private static matchKeysForDevice(
    device: TopologyDeviceInput,
  ): Array<string> {
    const keys: Array<string> = [];
    const sysNameKey: string | undefined = NetworkTopologyUtil.normalizeKey(
      device.sysName,
    );
    const hostnameKey: string | undefined = NetworkTopologyUtil.normalizeKey(
      device.hostname,
    );
    if (sysNameKey) {
      keys.push(sysNameKey);
    }
    if (hostnameKey) {
      keys.push(hostnameKey);
    }
    return keys;
  }

  private static normalizeKey(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    const trimmed: string = value.trim().toLowerCase();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private static deviceStatus(
    device: TopologyDeviceInput,
    now: Date,
  ): NetworkTopologyNodeStatus {
    if (!device.lastSeenAt) {
      return "unknown";
    }
    const ageMs: number = now.getTime() - new Date(device.lastSeenAt).getTime();
    if (ageMs > FRESH_WINDOW_MS) {
      return "down";
    }
    return "up";
  }
}
