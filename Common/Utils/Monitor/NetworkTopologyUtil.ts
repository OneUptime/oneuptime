import NetworkTopology, {
  NetworkTopologyEdge,
  NetworkTopologyEdgeEndpoint,
  NetworkTopologyLinkProtocol,
  NetworkTopologyNode,
  NetworkTopologyNodeStatus,
} from "../../Types/Monitor/SnmpMonitor/NetworkTopology";
import LldpNeighbor from "../../Types/Monitor/SnmpMonitor/LldpNeighbor";
import CdpNeighbor from "../../Types/Monitor/SnmpMonitor/CdpNeighbor";

export interface TopologyDeviceInput {
  id: string;
  name: string;
  hostname?: string | undefined;
  sysName?: string | undefined;
  lastSeenAt?: Date | undefined;
  interfacesUp?: number | undefined;
  interfacesDown?: number | undefined;
  vendor?: string | undefined;
  deviceModel?: string | undefined;
  lldpNeighbors?: Array<LldpNeighbor> | undefined;
  cdpNeighbors?: Array<CdpNeighbor> | undefined;
}

/*
 * One NetworkInterface row, reduced to what edge enrichment needs. The
 * caller queries interfaces for all devices in the graph in one go and
 * passes them here; matching happens in memory.
 */
export interface TopologyInterfaceInput {
  networkDeviceId: string;
  interfaceIndex: number;
  name?: string | undefined;
  isOperationallyUp?: boolean | undefined;
  isAdministrativelyUp?: boolean | undefined;
  utilizationPercent?: number | undefined;
  inRateMbps?: number | undefined;
  outRateMbps?: number | undefined;
  errorsPerSecond?: number | undefined;
}

/*
 * A neighbor claim from either discovery protocol, normalized so LLDP and
 * CDP entries flow through the same match/dedupe/enrich pipeline.
 */
interface NeighborClaim {
  protocol: NetworkTopologyLinkProtocol;
  matchKey: string | undefined;
  displayName: string | undefined;
  localInterfaceIndex: number | undefined;
  remotePortId: string | undefined;
  // CDP-only: the platform string the neighbor advertises about itself.
  remotePlatform: string | undefined;
}

// A device not seen within this window is treated as not currently up.
const FRESH_WINDOW_MS: number = 15 * 60 * 1000;

export default class NetworkTopologyUtil {
  /*
   * Builds the topology graph from every device in a project. Nodes are the
   * devices; LLDP and CDP neighbors that match another device (by sysName,
   * hostname or name) become edges, and neighbors that match nothing become
   * lightweight "unmanaged" nodes so links don't dead-end. Edges are
   * undirected and deduplicated — a link reported from both ends, or by
   * both protocols, appears once with the union of what each report knew
   * (ports, protocols, per-end interface state). When `interfaces` rows are
   * provided, each edge end whose interface is identifiable carries its
   * operational state (up/down, utilization, rates).
   */
  public static buildTopology(
    devices: Array<TopologyDeviceInput>,
    now: Date,
    interfaces: Array<TopologyInterfaceInput> = [],
  ): NetworkTopology {
    const nodes: Array<NetworkTopologyNode> = [];

    // Index managed devices by the identifiers neighbor entries reference.
    const deviceByMatchKey: Map<string, TopologyDeviceInput> = new Map();
    for (const device of devices) {
      for (const key of NetworkTopologyUtil.matchKeysForDevice(device)) {
        deviceByMatchKey.set(key, device);
      }
    }

    // Index interface rows by (device, index) and by (device, name).
    const interfaceByDeviceAndIndex: Map<string, TopologyInterfaceInput> =
      new Map();
    const interfaceByDeviceAndName: Map<string, TopologyInterfaceInput> =
      new Map();
    for (const row of interfaces) {
      interfaceByDeviceAndIndex.set(
        `${row.networkDeviceId}::${row.interfaceIndex}`,
        row,
      );
      const nameKey: string | undefined = NetworkTopologyUtil.normalizeKey(
        row.name,
      );
      if (nameKey) {
        interfaceByDeviceAndName.set(`${row.networkDeviceId}::${nameKey}`, row);
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
        sysName: device.sysName,
        vendor: device.vendor,
        deviceModel: device.deviceModel,
      });
    }

    const unmanagedNodeById: Map<string, NetworkTopologyNode> = new Map();
    const edgeByKey: Map<string, NetworkTopologyEdge> = new Map();

    for (const device of devices) {
      for (const claim of NetworkTopologyUtil.neighborClaimsForDevice(device)) {
        if (!claim.matchKey) {
          continue;
        }

        const matched: TopologyDeviceInput | undefined = deviceByMatchKey.get(
          claim.matchKey,
        );

        let toNodeId: string;

        if (matched) {
          if (matched.id === device.id) {
            // Self-referential neighbor entry; skip.
            continue;
          }
          toNodeId = matched.id;
        } else {
          toNodeId = `unmanaged:${claim.matchKey}`;
          const existingUnmanaged: NetworkTopologyNode | undefined =
            unmanagedNodeById.get(toNodeId);
          if (!existingUnmanaged) {
            const unmanagedNode: NetworkTopologyNode = {
              id: toNodeId,
              name: claim.displayName || "Unknown device",
              isManaged: false,
              status: "unknown",
              deviceModel: claim.remotePlatform,
            };
            unmanagedNodeById.set(toNodeId, unmanagedNode);
            nodes.push(unmanagedNode);
          } else if (!existingUnmanaged.deviceModel && claim.remotePlatform) {
            // A later CDP claim may know the platform the first one didn't.
            existingUnmanaged.deviceModel = claim.remotePlatform;
          }
        }

        // The reporting device's own end, enriched from its interface row.
        let localEndpoint: NetworkTopologyEdgeEndpoint | undefined = undefined;
        let localPortLabel: string | undefined = undefined;
        if (claim.localInterfaceIndex !== undefined) {
          const localInterface: TopologyInterfaceInput | undefined =
            interfaceByDeviceAndIndex.get(
              `${device.id}::${claim.localInterfaceIndex}`,
            );
          localEndpoint = {
            interfaceIndex: claim.localInterfaceIndex,
            interfaceName: localInterface?.name,
            isOperationallyUp: localInterface?.isOperationallyUp,
            isAdministrativelyUp: localInterface?.isAdministrativelyUp,
            utilizationPercent: localInterface?.utilizationPercent,
            inRateMbps: localInterface?.inRateMbps,
            outRateMbps: localInterface?.outRateMbps,
            errorsPerSecond: localInterface?.errorsPerSecond,
          };
          localPortLabel =
            localInterface?.name || `if${claim.localInterfaceIndex}`;
        }

        /*
         * The far end: best-effort — the advertised remote port id often
         * matches the remote device's interface name (e.g. "GigabitEthernet
         * 0/1"). Only attach data when it does; a bare port id string stays
         * in toPort.
         */
        let remoteEndpoint: NetworkTopologyEdgeEndpoint | undefined = undefined;
        if (matched && claim.remotePortId) {
          const remotePortKey: string | undefined =
            NetworkTopologyUtil.normalizeKey(claim.remotePortId);
          const remoteInterface: TopologyInterfaceInput | undefined =
            remotePortKey
              ? interfaceByDeviceAndName.get(`${matched.id}::${remotePortKey}`)
              : undefined;
          if (remoteInterface) {
            remoteEndpoint = {
              interfaceIndex: remoteInterface.interfaceIndex,
              interfaceName: remoteInterface.name,
              isOperationallyUp: remoteInterface.isOperationallyUp,
              isAdministrativelyUp: remoteInterface.isAdministrativelyUp,
              utilizationPercent: remoteInterface.utilizationPercent,
              inRateMbps: remoteInterface.inRateMbps,
              outRateMbps: remoteInterface.outRateMbps,
              errorsPerSecond: remoteInterface.errorsPerSecond,
            };
          }
        }

        // Undirected dedupe: canonicalize the endpoint pair.
        const edgeKey: string = [device.id, toNodeId].sort().join("::");
        const existing: NetworkTopologyEdge | undefined =
          edgeByKey.get(edgeKey);

        if (!existing) {
          edgeByKey.set(edgeKey, {
            fromNodeId: device.id,
            toNodeId: toNodeId,
            fromPort: localPortLabel,
            toPort: claim.remotePortId,
            protocols: [claim.protocol],
            fromInterface: localEndpoint,
            toInterface: remoteEndpoint,
          });
          continue;
        }

        /*
         * Same link reported again — from the other end, or by the other
         * protocol. Merge instead of dropping so both ends keep the best
         * data anyone reported about them.
         */
        if (
          existing.protocols &&
          !existing.protocols.includes(claim.protocol)
        ) {
          existing.protocols.push(claim.protocol);
        }

        if (existing.fromNodeId === device.id) {
          existing.fromPort = existing.fromPort || localPortLabel;
          existing.toPort = existing.toPort || claim.remotePortId;
          existing.fromInterface = NetworkTopologyUtil.mergeEndpoints(
            existing.fromInterface,
            localEndpoint,
          );
          existing.toInterface = NetworkTopologyUtil.mergeEndpoints(
            existing.toInterface,
            remoteEndpoint,
          );
        } else {
          existing.toPort = existing.toPort || localPortLabel;
          existing.fromPort = existing.fromPort || claim.remotePortId;
          existing.toInterface = NetworkTopologyUtil.mergeEndpoints(
            existing.toInterface,
            localEndpoint,
          );
          existing.fromInterface = NetworkTopologyUtil.mergeEndpoints(
            existing.fromInterface,
            remoteEndpoint,
          );
        }
      }
    }

    return { nodes, edges: Array.from(edgeByKey.values()) };
  }

  /*
   * Both protocols' neighbor entries, normalized. LLDP first so its
   * (usually richer) identifiers win the first-report slots; CDP then
   * fills gaps or dedupes into the same edge.
   */
  private static neighborClaimsForDevice(
    device: TopologyDeviceInput,
  ): Array<NeighborClaim> {
    const claims: Array<NeighborClaim> = [];

    for (const neighbor of device.lldpNeighbors || []) {
      claims.push({
        protocol: "lldp",
        matchKey:
          NetworkTopologyUtil.normalizeKey(neighbor.remoteSysName) ||
          NetworkTopologyUtil.normalizeKey(neighbor.remoteChassisId),
        displayName: neighbor.remoteSysName || neighbor.remoteChassisId,
        localInterfaceIndex: neighbor.localInterfaceIndex,
        remotePortId: neighbor.remotePortId,
        remotePlatform: undefined,
      });
    }

    for (const neighbor of device.cdpNeighbors || []) {
      claims.push({
        protocol: "cdp",
        matchKey: NetworkTopologyUtil.normalizeKey(neighbor.remoteDeviceId),
        displayName: neighbor.remoteDeviceId,
        localInterfaceIndex: neighbor.localInterfaceIndex,
        remotePortId: neighbor.remotePortId,
        remotePlatform: neighbor.remotePlatform,
      });
    }

    return claims;
  }

  // Existing fields win; the incoming report only fills what's missing.
  private static mergeEndpoints(
    existing: NetworkTopologyEdgeEndpoint | undefined,
    incoming: NetworkTopologyEdgeEndpoint | undefined,
  ): NetworkTopologyEdgeEndpoint | undefined {
    if (!existing) {
      return incoming;
    }
    if (!incoming) {
      return existing;
    }
    return {
      interfaceIndex: existing.interfaceIndex ?? incoming.interfaceIndex,
      interfaceName: existing.interfaceName ?? incoming.interfaceName,
      isOperationallyUp:
        existing.isOperationallyUp ?? incoming.isOperationallyUp,
      isAdministrativelyUp:
        existing.isAdministrativelyUp ?? incoming.isAdministrativelyUp,
      utilizationPercent:
        existing.utilizationPercent ?? incoming.utilizationPercent,
      inRateMbps: existing.inRateMbps ?? incoming.inRateMbps,
      outRateMbps: existing.outRateMbps ?? incoming.outRateMbps,
      errorsPerSecond: existing.errorsPerSecond ?? incoming.errorsPerSecond,
    };
  }

  private static matchKeysForDevice(
    device: TopologyDeviceInput,
  ): Array<string> {
    /*
     * sysName / hostname / name — the identifiers LLDP remoteSysName and
     * CDP remoteDeviceId advertise. Order matters only across devices
     * (last writer wins on a collision), not within one device.
     */
    const keys: Array<string> = [];
    for (const candidate of [device.sysName, device.hostname, device.name]) {
      const key: string | undefined =
        NetworkTopologyUtil.normalizeKey(candidate);
      if (key && !keys.includes(key)) {
        keys.push(key);
      }
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
