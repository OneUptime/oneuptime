import NetworkTopology, {
  NetworkTopologyEdge,
  NetworkTopologyEdgeEndpoint,
  NetworkTopologyLinkProtocol,
  NetworkTopologyNode,
  NetworkTopologyNodeStatus,
} from "../../Types/Monitor/SnmpMonitor/NetworkTopology";
import LldpNeighbor from "../../Types/Monitor/SnmpMonitor/LldpNeighbor";
import CdpNeighbor from "../../Types/Monitor/SnmpMonitor/CdpNeighbor";
import { normalizeMac } from "./EndpointAttachmentUtil";
import {
  classifyDeviceRole,
  classifyEndpointRole,
} from "./NetworkDeviceRoleUtil";

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
  /*
   * SNMP identity, carried purely so the node can be classified into a
   * role (router/switch/firewall/...). Neither is rendered directly.
   */
  sysDescr?: string | undefined;
  sysObjectId?: string | undefined;
  /*
   * ENTITY-MIB chassis serial. Not rendered — it is here because LLDP
   * chassis-id subtype 7 ("locally assigned") is very often exactly this
   * string, so without it a peer we already manage is drawn as a stranger.
   */
  serialNumber?: string | undefined;
  /*
   * Health as reported by a Monitor watching this device, already reduced to
   * the map's three states by the caller. Load-bearing for monitor-backed
   * devices (monitoringMethod "Monitor"): nothing ever polls them, so their
   * lastSeenAt is permanently absent and freshness alone would draw every
   * one of them as "unknown" forever.
   */
  monitorStatus?: NetworkTopologyNodeStatus | undefined;
  /*
   * Whether the device's interface walk is on. LLDP and CDP ride along with
   * it, so a device with it off can never report a neighbour — which is one
   * of the ways a device ends up drawn floating, and one the map has no
   * other way to explain.
   */
  isNeighborDiscoveryEnabled?: boolean | undefined;
  /*
   * Every interface MAC this device reports. Not rendered either: LLDP
   * chassis-id subtype 4 IS a MAC, and it is frequently the only thing a
   * peer advertises about itself.
   */
  macAddresses?: Array<string> | undefined;
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
 * One discovered endpoint row (NetworkEndpoint), reduced to what rendering
 * needs. Endpoints attach to their switch via an "fdb" edge; rows without a
 * resolvable attachment are dropped (and counted) rather than floated.
 */
export interface TopologyEndpointInput {
  id: string;
  macAddress: string;
  ipAddress?: string | undefined;
  vendor?: string | undefined;
  classification?: string | undefined;
  vlanId?: number | undefined;
  attachedNetworkDeviceId?: string | undefined;
  attachedInterfaceIndex?: number | undefined;
  attachedPortName?: string | undefined;
  lastSeenAt?: Date | undefined;
}

/*
 * One operator-declared link (NetworkDeviceLink), reduced to what the graph
 * needs. These exist for cables neither discovery protocol can see: a device
 * with LLDP/CDP disabled, one that speaks neither, or a monitor-backed device
 * that is never walked at all.
 */
export interface TopologyManualLinkInput {
  fromDeviceId: string;
  toDeviceId: string;
  name?: string | undefined;
  fromPortName?: string | undefined;
  toPortName?: string | undefined;
  // Health from a bound Monitor, already reduced by the caller.
  monitorStatus?: "up" | "down" | undefined;
}

/*
 * buildTopology's result: the wire-format NetworkTopology plus endpoint
 * bookkeeping. The extra fields are optional on the wire type, so older
 * readers are unaffected.
 */
export interface TopologyBuildResult extends NetworkTopology {
  // Endpoints skipped because they had no attachment in the graph.
  droppedEndpointCount?: number | undefined;
  // True when more attachable endpoints existed than the render cap allows.
  endpointsTruncated?: boolean | undefined;
  /*
   * Nodes removed because the project hid them. Always reported, even when
   * zero: a map that quietly drops things is the same failure as a map that
   * quietly invents them, and this is what the "N hidden — show" affordance
   * counts.
   */
  suppressedNodeCount?: number | undefined;
}

/*
 * A neighbor claim from either discovery protocol, normalized so LLDP and
 * CDP entries flow through the same match/dedupe/enrich pipeline.
 */
interface NeighborClaim {
  protocol: NetworkTopologyLinkProtocol;
  /*
   * Every identifier this report offers for the peer, strongest source
   * first — LLDP's remoteSysName ahead of its remoteChassisId, CDP's
   * remoteDeviceId on its own. Plural because a chassis id is frequently
   * the ONLY thing a peer advertises, and it names a device we already
   * manage exactly as well as a sysName does.
   */
  identifiers: Array<string>;
  displayName: string | undefined;
  // True when displayName came from an advertised name, not a chassis id.
  hasAdvertisedName: boolean;
  localInterfaceIndex: number | undefined;
  remotePortId: string | undefined;
  // CDP-only: the platform string the neighbor advertises about itself.
  remotePlatform: string | undefined;
}

/*
 * How a device can be recognized, strongest evidence first.
 *
 * "name"      — something the device answers to (sysName, hostname, or the
 *               row's own name); what both discovery protocols advertise.
 * "serial"    — the ENTITY-MIB chassis serial, which is what LLDP
 *               chassis-id subtype 7 ("locally assigned") usually carries.
 * "mac"       — an interface MAC; LLDP chassis-id subtype 4 IS a MAC.
 * "shortHost" — the first label of an FQDN, so `sw01.corp.local` and
 *               `sw01` are read as one device. Deliberately weakest: it
 *               throws information away, so it may only decide a match no
 *               stronger key could.
 */
type MatchKeyKind = "name" | "serial" | "mac" | "shortHost";

const MATCH_KEY_KINDS_STRONGEST_FIRST: ReadonlyArray<MatchKeyKind> = [
  "name",
  "serial",
  "mac",
  "shortHost",
];

/*
 * The kinds strong enough to say "these two reports describe one peer".
 *
 * shortHost is excluded on purpose: `sw01.site-a` and `sw01.site-b` share
 * one, and merging those would invent a device nobody owns. Against a
 * MANAGED device the same key is safe, because a key two devices both
 * claim is dropped from the index entirely rather than guessed at.
 */
const PEER_IDENTITY_KINDS: ReadonlySet<MatchKeyKind> = new Set<MatchKeyKind>([
  "name",
  "serial",
  "mac",
]);

interface MatchKey {
  kind: MatchKeyKind;
  value: string;
}

/*
 * One neighbor report, with its peer already resolved. Claims are resolved
 * in a pass of their own because the identity of an UNMANAGED peer is not
 * knowable from a single report: two switches can describe the same
 * stranger by different identifiers, and only the whole set says they meant
 * one box.
 */
interface ResolvedClaim {
  device: TopologyDeviceInput;
  claim: NeighborClaim;
  // Set when the claim named a device in this graph.
  matchedDeviceId: string | undefined;
  // Populated otherwise: the keys this unmanaged peer is known by.
  peerAliases: Array<MatchKey>;
}

/*
 * Hoisted so the literal is not the object of a member expression, which
 * `wrap-regex` and Prettier cannot agree on.
 */
const IPV4_PATTERN: RegExp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

// A device not seen within this window is treated as not currently up.
const FRESH_WINDOW_MS: number = 15 * 60 * 1000;

// Endpoint nodes rendered per graph; the slice is deterministic (by MAC).
const ENDPOINT_RENDER_CAP: number = 2000;

export default class NetworkTopologyUtil {
  /*
   * Builds the topology graph from every device in a project. Nodes are the
   * devices; LLDP and CDP neighbors that match another device (by name,
   * serial, interface MAC or FQDN short form — see MatchKeyKind) become
   * edges, and neighbors that match nothing become lightweight "unmanaged"
   * nodes so links don't dead-end. Reports that share an identity-grade
   * alias are one unmanaged node, however many switches saw it. Edges are
   * undirected and deduplicated — a link reported from both ends, or by
   * both protocols, appears once with the union of what each report knew
   * (ports, protocols, per-end interface state). When `interfaces` rows are
   * provided, each edge end whose interface is identifiable carries its
   * operational state (up/down, utilization, rates). When `endpoints` rows
   * are provided, each one that attaches to a device in the graph becomes an
   * "endpoint" node linked by an "fdb" edge (capped, deterministic by MAC);
   * the rest are dropped and counted in droppedEndpointCount.
   */
  public static buildTopology(
    devices: Array<TopologyDeviceInput>,
    now: Date,
    interfaces: Array<TopologyInterfaceInput> = [],
    endpoints: Array<TopologyEndpointInput> = [],
    manualLinks: Array<TopologyManualLinkInput> = [],
    suppressedNodeKeys: ReadonlySet<string> = new Set<string>(),
  ): TopologyBuildResult {
    const nodes: Array<NetworkTopologyNode> = [];

    /*
     * Index managed devices by every identifier a neighbor entry could
     * reference. A key TWO devices both claim is deleted rather than
     * resolved: last-writer-wins would quietly draw the link to whichever
     * device happened to be indexed second, and a wrong cable on a network
     * map is worse than a missing one.
     */
    const deviceByMatchKey: Map<string, TopologyDeviceInput> = new Map();
    const ambiguousMatchKeyIds: Set<string> = new Set<string>();
    for (const device of devices) {
      for (const key of NetworkTopologyUtil.matchKeysForDevice(device)) {
        const keyId: string = NetworkTopologyUtil.matchKeyId(key);
        const existing: TopologyDeviceInput | undefined =
          deviceByMatchKey.get(keyId);
        if (existing && existing.id !== device.id) {
          ambiguousMatchKeyIds.add(keyId);
          continue;
        }
        deviceByMatchKey.set(keyId, device);
      }
    }
    for (const keyId of ambiguousMatchKeyIds) {
      deviceByMatchKey.delete(keyId);
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

    // Kept aside so the diagnostics pass below can read it back per node.
    const isNeighborDiscoveryEnabledById: Map<string, boolean | undefined> =
      new Map<string, boolean | undefined>();

    for (const device of devices) {
      isNeighborDiscoveryEnabledById.set(
        device.id,
        device.isNeighborDiscoveryEnabled,
      );
      nodes.push({
        id: device.id,
        name: device.name,
        isManaged: true,
        kind: "device",
        role: classifyDeviceRole({
          sysDescr: device.sysDescr,
          sysObjectId: device.sysObjectId,
          vendor: device.vendor,
          deviceModel: device.deviceModel,
          name: device.name,
          sysName: device.sysName || device.hostname,
        }),
        status: NetworkTopologyUtil.deviceStatus(device, now),
        interfacesUp: device.interfacesUp,
        interfacesDown: device.interfacesDown,
        sysName: device.sysName,
        vendor: device.vendor,
        deviceModel: device.deviceModel,
      });
    }

    const edgeByKey: Map<string, NetworkTopologyEdge> = new Map();

    /*
     * Resolve every neighbor report before drawing anything.
     *
     * A managed match is decidable from one report, but the IDENTITY of an
     * unmanaged peer is not: the switch at one end may know its neighbor's
     * sysName while the switch at the other end knows only its chassis MAC,
     * and only the whole set of reports says those two describe one box.
     */
    const resolvedClaims: Array<ResolvedClaim> = [];
    for (const device of devices) {
      for (const claim of NetworkTopologyUtil.neighborClaimsForDevice(device)) {
        const candidates: Array<MatchKey> =
          NetworkTopologyUtil.candidateKeysForClaim(claim);
        if (candidates.length === 0) {
          continue;
        }

        // Candidates arrive strongest-first, so the first hit is the best one.
        let matched: TopologyDeviceInput | undefined = undefined;
        for (const candidate of candidates) {
          matched = deviceByMatchKey.get(
            NetworkTopologyUtil.matchKeyId(candidate),
          );
          if (matched) {
            break;
          }
        }

        if (matched) {
          if (matched.id === device.id) {
            // Self-referential neighbor entry; skip.
            continue;
          }
          resolvedClaims.push({
            device: device,
            claim: claim,
            matchedDeviceId: matched.id,
            peerAliases: [],
          });
          continue;
        }

        resolvedClaims.push({
          device: device,
          claim: claim,
          matchedDeviceId: undefined,
          peerAliases: candidates.filter((candidate: MatchKey) => {
            return PEER_IDENTITY_KINDS.has(candidate.kind);
          }),
        });
      }
    }

    const peerNodeIdByClaim: Map<ResolvedClaim, string> =
      NetworkTopologyUtil.buildUnmanagedPeerNodes(resolvedClaims, nodes);

    for (const resolved of resolvedClaims) {
      const device: TopologyDeviceInput = resolved.device;
      const claim: NeighborClaim = resolved.claim;
      const matchedId: string | undefined = resolved.matchedDeviceId;
      const toNodeId: string | undefined =
        matchedId || peerNodeIdByClaim.get(resolved);
      if (!toNodeId) {
        continue;
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
      if (matchedId && claim.remotePortId) {
        const remotePortKey: string | undefined =
          NetworkTopologyUtil.normalizeKey(claim.remotePortId);
        const remoteInterface: TopologyInterfaceInput | undefined =
          remotePortKey
            ? interfaceByDeviceAndName.get(`${matchedId}::${remotePortKey}`)
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
      const existing: NetworkTopologyEdge | undefined = edgeByKey.get(edgeKey);

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
      if (existing.protocols && !existing.protocols.includes(claim.protocol)) {
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

    const deviceNodeIds: Set<string> = new Set(
      devices.map((device: TopologyDeviceInput) => {
        return device.id;
      }),
    );

    /*
     * --- Operator-declared links ---
     *
     * Merged into the SAME edge map the discovery protocols write to, so a
     * cable somebody drew by hand and the same cable LLDP later reports are
     * one line carrying both protocols — not two lines between one pair of
     * boxes, which is exactly the duplicate an operator would read as a
     * second physical link.
     *
     * Ends outside this graph are skipped rather than drawn: a link to a
     * device in another site (or one since archived) has nothing to attach
     * to here.
     */
    for (const link of manualLinks) {
      if (
        !deviceNodeIds.has(link.fromDeviceId) ||
        !deviceNodeIds.has(link.toDeviceId) ||
        link.fromDeviceId === link.toDeviceId
      ) {
        continue;
      }

      const edgeKey: string = [link.fromDeviceId, link.toDeviceId]
        .sort()
        .join("::");
      const existing: NetworkTopologyEdge | undefined = edgeByKey.get(edgeKey);

      if (!existing) {
        edgeByKey.set(edgeKey, {
          fromNodeId: link.fromDeviceId,
          toNodeId: link.toDeviceId,
          fromPort: link.fromPortName,
          toPort: link.toPortName,
          protocols: ["manual"],
          monitorState: link.monitorStatus,
          name: link.name,
        });
        continue;
      }

      if (existing.protocols && !existing.protocols.includes("manual")) {
        existing.protocols.push("manual");
      }

      /*
       * Discovered data wins on the shared fields — it is measured, and the
       * hand-typed port is a best recollection. The operator's name and the
       * monitor's verdict have no discovered counterpart, so they always
       * apply.
       */
      if (existing.fromNodeId === link.fromDeviceId) {
        existing.fromPort = existing.fromPort || link.fromPortName;
        existing.toPort = existing.toPort || link.toPortName;
      } else {
        existing.toPort = existing.toPort || link.fromPortName;
        existing.fromPort = existing.fromPort || link.toPortName;
      }
      existing.name = existing.name || link.name;
      existing.monitorState = existing.monitorState ?? link.monitorStatus;
    }

    const edges: Array<NetworkTopologyEdge> = Array.from(edgeByKey.values());

    /*
     * --- Why a device has no links ---
     *
     * Attached to every managed node, so the detail panel can answer "the
     * router is not linked to anything" with a cause instead of a shrug.
     * Built from the claims that were just resolved: the unmatched ones are
     * the actionable evidence — a renamed peer, a device nobody has added
     * yet — and they are otherwise thrown away here.
     */
    const reportedNeighborCountByDeviceId: Map<string, number> = new Map<
      string,
      number
    >();
    const unmatchedIdentifiersByDeviceId: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    for (const resolved of resolvedClaims) {
      const deviceId: string = resolved.device.id;
      reportedNeighborCountByDeviceId.set(
        deviceId,
        (reportedNeighborCountByDeviceId.get(deviceId) || 0) + 1,
      );

      if (resolved.matchedDeviceId) {
        continue;
      }

      const identifier: string | undefined =
        resolved.claim.displayName || resolved.claim.identifiers[0];
      if (!identifier) {
        continue;
      }
      const bucket: Array<string> | undefined =
        unmatchedIdentifiersByDeviceId.get(deviceId);
      if (bucket) {
        if (!bucket.includes(identifier)) {
          bucket.push(identifier);
        }
      } else {
        unmatchedIdentifiersByDeviceId.set(deviceId, [identifier]);
      }
    }

    for (const node of nodes) {
      if (node.kind !== "device") {
        continue;
      }
      node.diagnostics = {
        isNeighborDiscoveryEnabled: isNeighborDiscoveryEnabledById.get(node.id),
        reportedNeighborCount:
          reportedNeighborCountByDeviceId.get(node.id) || 0,
        unmatchedNeighborIdentifiers:
          unmatchedIdentifiersByDeviceId.get(node.id) || [],
      };
    }

    // --- Endpoint nodes + fdb edges ---

    /*
     * Deterministic render order: by normalized MAC, then id, so the capped
     * slice is stable across rebuilds regardless of query order.
     */
    const sortedEndpoints: Array<TopologyEndpointInput> = [...endpoints].sort(
      (a: TopologyEndpointInput, b: TopologyEndpointInput) => {
        const aMac: string = normalizeMac(a.macAddress) || a.macAddress;
        const bMac: string = normalizeMac(b.macAddress) || b.macAddress;
        if (aMac !== bMac) {
          return aMac < bMac ? -1 : 1;
        }
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      },
    );

    let droppedEndpointCount: number = 0;
    let renderedEndpointCount: number = 0;
    let endpointsTruncated: boolean = false;

    for (const endpoint of sortedEndpoints) {
      if (
        !endpoint.attachedNetworkDeviceId ||
        !deviceNodeIds.has(endpoint.attachedNetworkDeviceId)
      ) {
        // No attachment in this graph — nothing to hang the node off.
        droppedEndpointCount++;
        continue;
      }

      if (renderedEndpointCount >= ENDPOINT_RENDER_CAP) {
        endpointsTruncated = true;
        continue;
      }
      renderedEndpointCount++;

      const nodeId: string = `endpoint:${endpoint.id}`;
      const endpointName: string =
        endpoint.classification ||
        endpoint.vendor ||
        endpoint.ipAddress ||
        endpoint.macAddress;
      nodes.push({
        id: nodeId,
        name: endpointName,
        isManaged: false,
        kind: "endpoint",
        role: classifyEndpointRole({
          classification: endpoint.classification,
          vendor: endpoint.vendor,
          name: endpointName,
        }),
        status: NetworkTopologyUtil.statusFromLastSeen(
          endpoint.lastSeenAt,
          now,
        ),
        vendor: endpoint.vendor,
        macAddress: endpoint.macAddress,
        ipAddress: endpoint.ipAddress,
        classification: endpoint.classification,
        vlanId: endpoint.vlanId,
      });

      // Port label + interface state on the switch end, when identifiable.
      let switchInterface: TopologyInterfaceInput | undefined = undefined;
      if (endpoint.attachedInterfaceIndex !== undefined) {
        switchInterface = interfaceByDeviceAndIndex.get(
          `${endpoint.attachedNetworkDeviceId}::${endpoint.attachedInterfaceIndex}`,
        );
      }
      let fromPort: string | undefined =
        endpoint.attachedPortName || switchInterface?.name;
      if (!fromPort && endpoint.attachedInterfaceIndex !== undefined) {
        fromPort = `if${endpoint.attachedInterfaceIndex}`;
      }

      edges.push({
        fromNodeId: endpoint.attachedNetworkDeviceId,
        toNodeId: nodeId,
        fromPort: fromPort,
        protocols: ["fdb"],
        fromInterface: switchInterface
          ? {
              interfaceIndex: switchInterface.interfaceIndex,
              interfaceName: switchInterface.name,
              isOperationallyUp: switchInterface.isOperationallyUp,
              isAdministrativelyUp: switchInterface.isAdministrativelyUp,
              utilizationPercent: switchInterface.utilizationPercent,
              inRateMbps: switchInterface.inRateMbps,
              outRateMbps: switchInterface.outRateMbps,
              errorsPerSecond: switchInterface.errorsPerSecond,
            }
          : undefined,
      });
    }

    /*
     * --- Hidden nodes ---
     *
     * Applied last, on the finished graph, so a suppressed node cannot
     * change how anything else resolved. Hiding a switch must not silently
     * re-route its neighbours' links or turn its peers into strangers — it
     * takes the box off the map and nothing more. Its edges go with it,
     * because a line to a node that is not drawn is a line into empty space.
     */
    if (suppressedNodeKeys.size === 0) {
      return {
        nodes,
        edges,
        droppedEndpointCount,
        endpointsTruncated,
        suppressedNodeCount: 0,
      };
    }

    const visibleNodes: Array<NetworkTopologyNode> = nodes.filter(
      (node: NetworkTopologyNode) => {
        return !suppressedNodeKeys.has(node.id);
      },
    );
    const visibleNodeIds: Set<string> = new Set<string>(
      visibleNodes.map((node: NetworkTopologyNode) => {
        return node.id;
      }),
    );

    return {
      nodes: visibleNodes,
      edges: edges.filter((edge: NetworkTopologyEdge) => {
        return (
          visibleNodeIds.has(edge.fromNodeId) &&
          visibleNodeIds.has(edge.toNodeId)
        );
      }),
      droppedEndpointCount,
      endpointsTruncated,
      suppressedNodeCount: nodes.length - visibleNodes.length,
    };
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
      /*
       * Both identifiers are carried, not just the first non-empty one.
       * The chassis id used to be a fallback that only applied when the
       * peer advertised no sysName; it is in fact an identifier in its own
       * right — a MAC or a serial — and the device it names is very often
       * one we already manage.
       */
      const identifiers: Array<string> = [];
      if (neighbor.remoteSysName) {
        identifiers.push(neighbor.remoteSysName);
      }
      if (neighbor.remoteChassisId) {
        identifiers.push(neighbor.remoteChassisId);
      }

      claims.push({
        protocol: "lldp",
        identifiers: identifiers,
        displayName: neighbor.remoteSysName || neighbor.remoteChassisId,
        hasAdvertisedName: Boolean(neighbor.remoteSysName),
        localInterfaceIndex: neighbor.localInterfaceIndex,
        remotePortId: neighbor.remotePortId,
        remotePlatform: undefined,
      });
    }

    for (const neighbor of device.cdpNeighbors || []) {
      claims.push({
        protocol: "cdp",
        identifiers: neighbor.remoteDeviceId ? [neighbor.remoteDeviceId] : [],
        displayName: neighbor.remoteDeviceId,
        hasAdvertisedName: Boolean(neighbor.remoteDeviceId),
        localInterfaceIndex: neighbor.localInterfaceIndex,
        remotePortId: neighbor.remotePortId,
        remotePlatform: neighbor.remotePlatform,
      });
    }

    return claims;
  }

  /*
   * Every key a claim could be resolved by, strongest kind first and, within
   * a kind, strongest SOURCE first (an advertised sysName ahead of a chassis
   * id). Sorting by kind before source is deliberate: a MAC read off a
   * chassis id identifies a box far more precisely than the first label of
   * somebody's FQDN, whichever field it arrived in.
   */
  private static candidateKeysForClaim(claim: NeighborClaim): Array<MatchKey> {
    const byKind: Map<MatchKeyKind, Array<MatchKey>> = new Map<
      MatchKeyKind,
      Array<MatchKey>
    >();
    const seen: Set<string> = new Set<string>();

    for (const identifier of claim.identifiers) {
      for (const key of NetworkTopologyUtil.candidateKeysForIdentifier(
        identifier,
      )) {
        const keyId: string = NetworkTopologyUtil.matchKeyId(key);
        if (seen.has(keyId)) {
          continue;
        }
        seen.add(keyId);
        const bucket: Array<MatchKey> | undefined = byKind.get(key.kind);
        if (bucket) {
          bucket.push(key);
        } else {
          byKind.set(key.kind, [key]);
        }
      }
    }

    const ordered: Array<MatchKey> = [];
    for (const kind of MATCH_KEY_KINDS_STRONGEST_FIRST) {
      ordered.push(...(byKind.get(kind) || []));
    }
    return ordered;
  }

  /*
   * One identifier string, offered as every kind it could be.
   *
   * A chassis id is just bytes on the wire — nothing in the protocol says
   * whether it is a name, a serial or a MAC — so it is offered as all of
   * them, and only a key some device actually published can match.
   */
  private static candidateKeysForIdentifier(
    raw: string | undefined,
  ): Array<MatchKey> {
    const normalized: string | undefined =
      NetworkTopologyUtil.normalizeKey(raw);
    if (!normalized) {
      return [];
    }

    const keys: Array<MatchKey> = [
      { kind: "name", value: normalized },
      { kind: "serial", value: normalized },
    ];

    const mac: string | undefined = normalizeMac(normalized);
    if (mac) {
      keys.push({ kind: "mac", value: mac });
    }

    const shortHost: string | undefined =
      NetworkTopologyUtil.shortHostKey(normalized);
    if (shortHost) {
      keys.push({ kind: "shortHost", value: shortHost });
    }

    return keys;
  }

  /*
   * The first label of a hostname, or undefined when taking one would be
   * nonsense. An IPv4 literal would shorten to "10" and a MAC to its first
   * octet pair — both of which would collide half the estate into one node,
   * so both are refused outright.
   */
  private static shortHostKey(normalized: string): string | undefined {
    if (IPV4_PATTERN.test(normalized) || normalizeMac(normalized)) {
      return undefined;
    }
    const firstLabel: string = normalized.split(".")[0] || "";
    return firstLabel.length > 0 ? firstLabel : undefined;
  }

  private static matchKeyId(key: MatchKey): string {
    /*
     * A NUL separator, because every kind shares one namespace and a
     * hostname may legitimately contain a colon-ish character.
     */
    return `${key.kind}\u0000${key.value}`;
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

  /*
   * Every key this device answers to.
   *
   * Unlike a claim's candidates, these are NOT speculative: we know which
   * column each value came from, so a serial is only ever registered as a
   * serial. That asymmetry is the whole point — a claim may offer its
   * chassis id as a name, a serial and a MAC, but only the kind a device
   * actually published can be the one that matches.
   */
  private static matchKeysForDevice(
    device: TopologyDeviceInput,
  ): Array<MatchKey> {
    const keys: Array<MatchKey> = [];
    const seen: Set<string> = new Set<string>();

    const add: (key: MatchKey) => void = (key: MatchKey): void => {
      const keyId: string = NetworkTopologyUtil.matchKeyId(key);
      if (seen.has(keyId)) {
        return;
      }
      seen.add(keyId);
      keys.push(key);
    };

    // sysName / hostname / name — what both protocols advertise.
    for (const candidate of [device.sysName, device.hostname, device.name]) {
      const normalized: string | undefined =
        NetworkTopologyUtil.normalizeKey(candidate);
      if (!normalized) {
        continue;
      }
      add({ kind: "name", value: normalized });
      /*
       * The short form is registered for EVERY name, dotted or not, so the
       * two halves of the comparison meet: an FQDN on the wire has to be
       * able to find a bare sysName here, and a bare name on the wire has
       * to be able to find an FQDN.
       */
      const shortHost: string | undefined =
        NetworkTopologyUtil.shortHostKey(normalized);
      if (shortHost) {
        add({ kind: "shortHost", value: shortHost });
      }
    }

    const serial: string | undefined = NetworkTopologyUtil.normalizeKey(
      device.serialNumber,
    );
    if (serial) {
      add({ kind: "serial", value: serial });
    }

    for (const rawMac of device.macAddresses || []) {
      const mac: string | undefined = normalizeMac(rawMac);
      if (mac) {
        add({ kind: "mac", value: mac });
      }
    }

    return keys;
  }

  /*
   * Turns the unmatched claims into unmanaged peer NODES, one per box.
   *
   * Reports are merged when they share any identity-grade alias, so the
   * neighbor one switch knows as "ap-lobby" and another knows only by its
   * chassis MAC lands on a single node instead of the two strangers the map
   * used to draw. Appends the nodes it mints to `nodes` and returns the node
   * id each claim should draw its edge to.
   */
  private static buildUnmanagedPeerNodes(
    resolvedClaims: Array<ResolvedClaim>,
    nodes: Array<NetworkTopologyNode>,
  ): Map<ResolvedClaim, string> {
    const unmanagedClaims: Array<ResolvedClaim> = resolvedClaims.filter(
      (resolved: ResolvedClaim) => {
        return !resolved.matchedDeviceId && resolved.peerAliases.length > 0;
      },
    );

    const rootByAliasId: Map<string, string> =
      NetworkTopologyUtil.groupPeerAliases(unmanagedClaims);

    // Claims per peer, in first-encounter order so the output is stable.
    const claimsByRoot: Map<string, Array<ResolvedClaim>> = new Map<
      string,
      Array<ResolvedClaim>
    >();
    for (const resolved of unmanagedClaims) {
      const root: string | undefined = rootByAliasId.get(
        NetworkTopologyUtil.matchKeyId(resolved.peerAliases[0]!),
      );
      if (!root) {
        continue;
      }
      const bucket: Array<ResolvedClaim> | undefined = claimsByRoot.get(root);
      if (bucket) {
        bucket.push(resolved);
      } else {
        claimsByRoot.set(root, [resolved]);
      }
    }

    const nodeIdByClaim: Map<ResolvedClaim, string> = new Map<
      ResolvedClaim,
      string
    >();
    const usedNodeIds: Set<string> = new Set<string>();

    for (const groupClaims of claimsByRoot.values()) {
      /*
       * The nicest label anyone reported: a name the peer advertises about
       * itself beats a bare chassis id, whichever report arrived first.
       */
      let displayName: string | undefined = undefined;
      let platform: string | undefined = undefined;
      for (const resolved of groupClaims) {
        if (!displayName && resolved.claim.hasAdvertisedName) {
          displayName = resolved.claim.displayName;
        }
        if (!platform && resolved.claim.remotePlatform) {
          platform = resolved.claim.remotePlatform;
        }
      }
      if (!displayName) {
        for (const resolved of groupClaims) {
          if (resolved.claim.displayName) {
            displayName = resolved.claim.displayName;
            break;
          }
        }
      }

      /*
       * The id keeps its historic `unmanaged:<value>` shape — it is the key
       * saved arrangements are stored under, so changing it would scatter
       * every pinned peer on the map. It is named after the label wherever
       * that label is one of the peer's own aliases, so merging a report
       * that knew a sysName with one that knew only a chassis MAC still
       * produces `unmanaged:ap-lobby` rather than an id made of hex.
       */
      const nodeId: string = NetworkTopologyUtil.uniqueNodeId(
        `unmanaged:${NetworkTopologyUtil.canonicalPeerValue(
          groupClaims,
          displayName,
        )}`,
        usedNodeIds,
      );
      usedNodeIds.add(nodeId);

      const unmanagedName: string = displayName || "Unknown device";
      nodes.push({
        id: nodeId,
        name: unmanagedName,
        isManaged: false,
        kind: "unmanaged",
        /*
         * Classified from the whole group rather than from whichever
         * report happened to be first: the platform string is usually the
         * only real evidence about a peer, and it may well arrive on the
         * second report of it.
         */
        role: classifyDeviceRole({
          platform: platform,
          name: unmanagedName,
        }),
        status: "unknown",
        deviceModel: platform,
      });

      for (const resolved of groupClaims) {
        nodeIdByClaim.set(resolved, nodeId);
      }
    }

    return nodeIdByClaim;
  }

  /*
   * The alias a merged peer is named after.
   *
   * The chosen label wins whenever it is genuinely one of the peer's own
   * aliases; otherwise the strongest kind present decides, and within it
   * the lexicographically smallest value, so the id never depends on which
   * switch happened to be polled first.
   */
  private static canonicalPeerValue(
    groupClaims: Array<ResolvedClaim>,
    displayName: string | undefined,
  ): string {
    const valuesByKind: Map<MatchKeyKind, Array<string>> = new Map<
      MatchKeyKind,
      Array<string>
    >();
    for (const resolved of groupClaims) {
      for (const alias of resolved.peerAliases) {
        const bucket: Array<string> | undefined = valuesByKind.get(alias.kind);
        if (bucket) {
          if (!bucket.includes(alias.value)) {
            bucket.push(alias.value);
          }
        } else {
          valuesByKind.set(alias.kind, [alias.value]);
        }
      }
    }

    const preferred: string | undefined =
      NetworkTopologyUtil.normalizeKey(displayName);
    if (preferred && (valuesByKind.get("name") || []).includes(preferred)) {
      return preferred;
    }

    for (const kind of MATCH_KEY_KINDS_STRONGEST_FIRST) {
      const values: Array<string> | undefined = valuesByKind.get(kind);
      if (values && values.length > 0) {
        return [...values].sort()[0]!;
      }
    }

    return "unknown-peer";
  }

  /*
   * Two peers could in principle canonicalize to the same string (one by
   * name, one by serial). Suffixing rather than merging keeps them the
   * distinct boxes they are.
   */
  private static uniqueNodeId(
    preferred: string,
    used: ReadonlySet<string>,
  ): string {
    if (!used.has(preferred)) {
      return preferred;
    }
    let suffix: number = 2;
    while (used.has(`${preferred}#${suffix}`)) {
      suffix++;
    }
    return `${preferred}#${suffix}`;
  }

  /*
   * Union-find over peer aliases: two reports that share ANY identity-grade
   * alias describe one box. Returns the representative alias id for every
   * alias seen.
   */
  private static groupPeerAliases(
    unmanagedClaims: Array<ResolvedClaim>,
  ): Map<string, string> {
    const parent: Map<string, string> = new Map<string, string>();

    const find: (key: string) => string = (key: string): string => {
      let root: string = key;
      let next: string | undefined = parent.get(root);
      while (next !== undefined && next !== root) {
        root = next;
        next = parent.get(root);
      }
      // Path compression, so repeated lookups stay flat.
      let cursor: string = key;
      while (cursor !== root) {
        const following: string = parent.get(cursor) || root;
        parent.set(cursor, root);
        cursor = following;
      }
      return root;
    };

    const union: (a: string, b: string) => void = (
      a: string,
      b: string,
    ): void => {
      const rootA: string = find(a);
      const rootB: string = find(b);
      if (rootA === rootB) {
        return;
      }
      // Lexicographic tie-break, so the result ignores input order.
      if (rootA < rootB) {
        parent.set(rootB, rootA);
      } else {
        parent.set(rootA, rootB);
      }
    };

    for (const resolved of unmanagedClaims) {
      const aliasIds: Array<string> = resolved.peerAliases.map(
        (alias: MatchKey) => {
          return NetworkTopologyUtil.matchKeyId(alias);
        },
      );
      for (const aliasId of aliasIds) {
        if (!parent.has(aliasId)) {
          parent.set(aliasId, aliasId);
        }
      }
      for (let index: number = 1; index < aliasIds.length; index++) {
        union(aliasIds[0]!, aliasIds[index]!);
      }
    }

    const rootByAliasId: Map<string, string> = new Map<string, string>();
    for (const aliasId of parent.keys()) {
      rootByAliasId.set(aliasId, find(aliasId));
    }
    return rootByAliasId;
  }

  private static normalizeKey(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    const trimmed: string = value.trim().toLowerCase();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  /*
   * A stamped monitor status beats SNMP freshness, and freshness is the
   * fallback — the same precedence SiteStatusRollupUtil already applies when
   * it rolls devices up into a site, so a device cannot read "up" on the map
   * and "down" on the site card above it.
   */
  private static deviceStatus(
    device: TopologyDeviceInput,
    now: Date,
  ): NetworkTopologyNodeStatus {
    if (device.monitorStatus) {
      return device.monitorStatus;
    }
    return NetworkTopologyUtil.statusFromLastSeen(device.lastSeenAt, now);
  }

  // The shared freshness rule: seen within the window = up, stale = down.
  private static statusFromLastSeen(
    lastSeenAt: Date | undefined,
    now: Date,
  ): NetworkTopologyNodeStatus {
    if (!lastSeenAt) {
      return "unknown";
    }
    const ageMs: number = now.getTime() - new Date(lastSeenAt).getTime();
    if (ageMs > FRESH_WINDOW_MS) {
      return "down";
    }
    return "up";
  }
}
