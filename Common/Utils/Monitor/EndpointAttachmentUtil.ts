import ArpEntry from "../../Types/Monitor/SnmpMonitor/ArpEntry";
import CdpNeighbor from "../../Types/Monitor/SnmpMonitor/CdpNeighbor";
import FdbEntry from "../../Types/Monitor/SnmpMonitor/FdbEntry";
import LldpNeighbor from "../../Types/Monitor/SnmpMonitor/LldpNeighbor";

/*
 * Pure helpers that turn ONE device's ARP/FDB walk snapshot into endpoint
 * attachments (which MAC sits on which switch port) and IP bindings (which
 * MAC answers for which IP on a router). Everything here is deterministic
 * and side-effect free so it can run — and be tested — anywhere; persistence
 * lives in NetworkEndpointService, which consumes this output.
 */

// One interface row from the walk, reduced to what attachment needs.
export interface EndpointWalkInterface {
  interfaceIndex: number;
  name?: string | undefined;
  macAddress?: string | undefined;
}

// Everything one device's walk knows that endpoint discovery cares about.
export interface EndpointWalkSnapshot {
  deviceId: string;
  fdbEntries?: Array<FdbEntry> | undefined;
  arpEntries?: Array<ArpEntry> | undefined;
  lldpNeighbors?: Array<LldpNeighbor> | undefined;
  cdpNeighbors?: Array<CdpNeighbor> | undefined;
  interfaces?: Array<EndpointWalkInterface> | undefined;
}

// "This MAC was learned on this access port of the walked device."
export interface EndpointAttachment {
  macAddress: string;
  attachedInterfaceIndex: number;
  attachedPortName?: string | undefined;
  vlanId?: number | undefined;
}

// "This MAC answers for this IP in the walked device's ARP table."
export interface EndpointIpBinding {
  macAddress: string;
  ipAddress: string;
  routerInterfaceIndex: number;
}

export interface EndpointAttachmentResult {
  /*
   * Interfaces with an LLDP/CDP neighbor on them. MACs learned there are
   * transit traffic from the rest of the network, not local endpoints.
   */
  uplinkInterfaceIndexes: Array<number>;
  // The device's own interface MACs — never endpoints.
  selfMacs: Array<string>;
  attachments: Array<EndpointAttachment>;
  ipBindings: Array<EndpointIpBinding>;
}

/*
 * What the persistence layer should do for one (existing row, new
 * observation) pair. Kept as plain data so the precedence rules are
 * exhaustively unit-testable without a database.
 */
export interface EndpointIncomingObservation {
  macAddress: string;
  // The walked device (switch and/or router) that saw this MAC.
  deviceId: string;
  // Present when the device's FDB learned the MAC on an access port.
  attachment?:
    | {
        interfaceIndex: number;
        portName?: string | undefined;
        vlanId?: number | undefined;
      }
    | undefined;
  // Present when the device's ARP table binds the MAC to an IP.
  ipBinding?:
    | {
        ipAddress: string;
        routerInterfaceIndex: number;
      }
    | undefined;
}

/*
 * The stored row, as far as the precedence rules care. Everything past
 * attachedNetworkDeviceId exists so decideUpsert can tell a genuinely
 * new observation from a re-sighting of an endpoint that has not moved
 * since the last poll (see ENDPOINT_LAST_SEEN_REFRESH_MS).
 */
export interface EndpointExistingRowSnapshot {
  attachedNetworkDeviceId?: string | undefined;
  attachedInterfaceIndex?: number | undefined;
  attachedPortName?: string | undefined;
  vlanId?: number | undefined;
  ipAddress?: string | undefined;
  siteId?: string | undefined;
  firstSeenAt?: Date | undefined;
  lastSeenAt?: Date | undefined;
}

/*
 * How stale a row's lastSeenAt is allowed to get before an otherwise
 * unchanged observation is written purely to refresh it.
 *
 * Freshness is load-bearing: NetworkTopologyUtil calls an endpoint
 * "down" once lastSeenAt is older than 15 minutes. Suppressing the
 * refresh entirely would mark every stable endpoint down, so the real
 * bound is that stored lastSeenAt may lag reality by at most
 * (refresh threshold + poll interval). At 5 minutes that stays inside
 * the 15-minute window for any poll interval up to 10 minutes, and for
 * slower polls the threshold simply stops suppressing anything (age is
 * always past it) and the behaviour degrades back to write-every-poll —
 * so the optimisation can never make a device look down.
 */
export const ENDPOINT_LAST_SEEN_REFRESH_MS: number = 5 * 60 * 1000;

/*
 * Caller-supplied context for the "has anything actually changed?"
 * check. Optional: without it decideUpsert keeps its original
 * write-on-every-sighting behaviour.
 */
export interface EndpointUpsertContext {
  now: Date;
  // Site of the observing device, when the caller knows it.
  siteId?: string | undefined;
  lastSeenRefreshMs?: number | undefined;
}

export interface EndpointUpsertDecision {
  action: "create" | "update" | "none";
  /*
   * When true, write attachedNetworkDeviceId (the observing device),
   * attachedInterfaceIndex, and — when defined — attachedPortName / vlanId.
   * Undefined port/vlan never clear previously stored values.
   */
  setAttachment: boolean;
  attachedInterfaceIndex?: number | undefined;
  attachedPortName?: string | undefined;
  vlanId?: number | undefined;
  setIpAddress: boolean;
  ipAddress?: string | undefined;
}

/*
 * Multicast/broadcast MACs (group bit set in the first octet) are traffic
 * artifacts, not endpoints — e.g. 01:00:5e:… IPv4 multicast and the
 * ff:ff:ff:ff:ff:ff broadcast rows some ARP tables carry.
 */
const GROUP_ADDRESS_BIT: number = 0x01;

type MacCandidate = {
  entry: FdbEntry;
  interfaceIndex: number;
};

export default class EndpointAttachmentUtil {
  /*
   * Normalizes any common MAC spelling — AA-BB-CC-DD-EE-FF,
   * aabb.ccdd.eeff (Cisco dot form), aa:bb:cc:dd:ee:ff, bare hex, with or
   * without an 0x prefix — to lowercase colon form. Returns undefined for
   * anything that isn't exactly 12 hex digits once separators are removed.
   */
  public static normalizeMac(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    let hex: string = value.trim().toLowerCase();
    if (hex.startsWith("0x")) {
      hex = hex.substring(2);
    }
    hex = hex.replace(/[:\-.\s]/g, "");
    if (!/^[0-9a-f]{12}$/.test(hex)) {
      return undefined;
    }
    const pairs: Array<string> = [];
    for (let i: number = 0; i < 12; i += 2) {
      pairs.push(hex.substring(i, i + 2));
    }
    return pairs.join(":");
  }

  public static computeEndpointAttachments(
    snapshot: EndpointWalkSnapshot,
  ): EndpointAttachmentResult {
    /*
     * Uplinks: any interface an LLDP or CDP neighbor claims sits on. This
     * is the same local-port linkage NetworkTopologyUtil uses to draw
     * device-to-device edges — both protocols report the local ifIndex
     * directly on the neighbor entry.
     */
    const uplinkSet: Set<number> = new Set();
    for (const neighbor of snapshot.lldpNeighbors || []) {
      if (neighbor.localInterfaceIndex !== undefined) {
        uplinkSet.add(neighbor.localInterfaceIndex);
      }
    }
    for (const neighbor of snapshot.cdpNeighbors || []) {
      if (neighbor.localInterfaceIndex !== undefined) {
        uplinkSet.add(neighbor.localInterfaceIndex);
      }
    }

    const selfMacSet: Set<string> = new Set();
    const interfaceNameByIndex: Map<number, string> = new Map();
    for (const walkInterface of snapshot.interfaces || []) {
      const selfMac: string | undefined = EndpointAttachmentUtil.normalizeMac(
        walkInterface.macAddress,
      );
      if (selfMac) {
        selfMacSet.add(selfMac);
      }
      if (walkInterface.name) {
        interfaceNameByIndex.set(
          walkInterface.interfaceIndex,
          walkInterface.name,
        );
      }
    }

    /*
     * FDB → attachments. An entry qualifies when:
     *  - its MAC normalizes, is unicast, and is not one of the device's own,
     *  - its status (when reported) is "learned" — "self"/"mgmt" rows are
     *    the bridge talking about itself,
     *  - its bridge port resolved to an ifIndex (without one we cannot rule
     *    out an uplink, and misattaching every transit MAC to this switch
     *    is worse than skipping the entry), and
     *  - that ifIndex is not an uplink.
     */
    const candidatesByMac: Map<string, Array<MacCandidate>> = new Map();
    for (const entry of snapshot.fdbEntries || []) {
      const mac: string | undefined = EndpointAttachmentUtil.normalizeMac(
        entry.macAddress,
      );
      if (!mac || EndpointAttachmentUtil.isGroupMac(mac)) {
        continue;
      }
      if (selfMacSet.has(mac)) {
        continue;
      }
      if (
        entry.status !== undefined &&
        entry.status.toLowerCase() !== "learned"
      ) {
        continue;
      }
      if (entry.interfaceIndex === undefined) {
        continue;
      }
      if (uplinkSet.has(entry.interfaceIndex)) {
        continue;
      }
      const candidates: Array<MacCandidate> = candidatesByMac.get(mac) || [];
      candidates.push({ entry, interfaceIndex: entry.interfaceIndex });
      candidatesByMac.set(mac, candidates);
    }

    const attachments: Array<EndpointAttachment> = [];
    for (const mac of Array.from(candidatesByMac.keys()).sort()) {
      /*
       * One attachment per MAC. Duplicates (Q-BRIDGE reports the same MAC
       * per VLAN) collapse deterministically: lowest ifIndex, then lowest
       * VLAN (undefined last), then lowest bridge port.
       */
      const candidates: Array<MacCandidate> = candidatesByMac.get(mac)!;
      candidates.sort((a: MacCandidate, b: MacCandidate) => {
        if (a.interfaceIndex !== b.interfaceIndex) {
          return a.interfaceIndex - b.interfaceIndex;
        }
        const aVlan: number = a.entry.vlanId ?? Number.MAX_SAFE_INTEGER;
        const bVlan: number = b.entry.vlanId ?? Number.MAX_SAFE_INTEGER;
        if (aVlan !== bVlan) {
          return aVlan - bVlan;
        }
        return a.entry.bridgePort - b.entry.bridgePort;
      });
      const chosen: MacCandidate = candidates[0]!;
      attachments.push({
        macAddress: mac,
        attachedInterfaceIndex: chosen.interfaceIndex,
        attachedPortName: interfaceNameByIndex.get(chosen.interfaceIndex),
        vlanId: chosen.entry.vlanId,
      });
    }

    /*
     * ARP → IP bindings. Self and group MACs are excluded, as are rows the
     * device itself marked invalid. Duplicates for one MAC collapse to the
     * lexicographically smallest IP (then lowest ifIndex) so repeated walks
     * always report the same binding.
     */
    const bindingsByMac: Map<string, Array<ArpEntry>> = new Map();
    for (const entry of snapshot.arpEntries || []) {
      const mac: string | undefined = EndpointAttachmentUtil.normalizeMac(
        entry.macAddress,
      );
      if (!mac || EndpointAttachmentUtil.isGroupMac(mac)) {
        continue;
      }
      if (selfMacSet.has(mac)) {
        continue;
      }
      if (
        entry.entryType !== undefined &&
        entry.entryType.toLowerCase() === "invalid"
      ) {
        continue;
      }
      if (!entry.ipAddress) {
        continue;
      }
      const rows: Array<ArpEntry> = bindingsByMac.get(mac) || [];
      rows.push(entry);
      bindingsByMac.set(mac, rows);
    }

    const ipBindings: Array<EndpointIpBinding> = [];
    for (const mac of Array.from(bindingsByMac.keys()).sort()) {
      const rows: Array<ArpEntry> = bindingsByMac.get(mac)!;
      rows.sort((a: ArpEntry, b: ArpEntry) => {
        if (a.ipAddress !== b.ipAddress) {
          return a.ipAddress < b.ipAddress ? -1 : 1;
        }
        return a.interfaceIndex - b.interfaceIndex;
      });
      const chosen: ArpEntry = rows[0]!;
      ipBindings.push({
        macAddress: mac,
        ipAddress: chosen.ipAddress,
        routerInterfaceIndex: chosen.interfaceIndex,
      });
    }

    return {
      uplinkInterfaceIndexes: Array.from(uplinkSet).sort(
        (a: number, b: number) => {
          return a - b;
        },
      ),
      selfMacs: Array.from(selfMacSet).sort(),
      attachments,
      ipBindings,
    };
  }

  /*
   * The precedence rules for persisting one observation onto one
   * (projectId, macAddress) row:
   *
   *  - A switch-FDB attachment always wins: the FDB says which physical
   *    port the endpoint hangs off, which no ARP row can know.
   *  - An ARP-only observation always refreshes ipAddress, but only claims
   *    the attachment (pointing at the router's own interface) when the row
   *    has no attachment yet or is already attached to that same router —
   *    it must never steal an attachment a switch reported.
   *  - Rows are created for both kinds; every observation counts as a
   *    "touch" (the caller bumps lastSeenAt on any create/update action).
   *
   * When `context` is supplied, an update that would write nothing but a
   * lastSeenAt already refreshed within lastSeenRefreshMs collapses to
   * "none" — a stable 4096-MAC switch must not issue 4096 writes a poll
   * just to bump a timestamp nobody reads that precisely.
   */
  public static decideUpsert(
    existing: EndpointExistingRowSnapshot | null,
    incoming: EndpointIncomingObservation,
    context?: EndpointUpsertContext | undefined,
  ): EndpointUpsertDecision {
    if (!incoming.attachment && !incoming.ipBinding) {
      return {
        action: "none",
        setAttachment: false,
        setIpAddress: false,
      };
    }

    const decision: EndpointUpsertDecision = {
      action: existing ? "update" : "create",
      setAttachment: false,
      setIpAddress: false,
    };

    if (incoming.ipBinding) {
      decision.setIpAddress = true;
      decision.ipAddress = incoming.ipBinding.ipAddress;
    }

    if (incoming.attachment) {
      decision.setAttachment = true;
      decision.attachedInterfaceIndex = incoming.attachment.interfaceIndex;
      decision.attachedPortName = incoming.attachment.portName;
      decision.vlanId = incoming.attachment.vlanId;
    } else {
      // ARP-only from here on — incoming.ipBinding is set (guard above).
      const attachedElsewhere: boolean = Boolean(
        existing?.attachedNetworkDeviceId &&
          existing.attachedNetworkDeviceId !== incoming.deviceId,
      );
      if (!attachedElsewhere) {
        decision.setAttachment = true;
        decision.attachedInterfaceIndex =
          incoming.ipBinding!.routerInterfaceIndex;
      }
    }

    if (
      existing &&
      context &&
      EndpointAttachmentUtil.isUnchangedSighting(
        existing,
        decision,
        incoming.deviceId,
        context,
      )
    ) {
      return {
        action: "none",
        setAttachment: false,
        setIpAddress: false,
      };
    }

    return decision;
  }

  /*
   * True when applying `decision` to `existing` would change nothing a
   * reader can observe, and lastSeenAt is fresh enough that skipping the
   * refresh is safe. Deliberately conservative — any doubt (a row that
   * still needs the firstSeenAt backfill, a row whose lastSeenAt sits in
   * the future because of clock skew, a row we have never seen a
   * timestamp for) falls through to a real write.
   */
  private static isUnchangedSighting(
    existing: EndpointExistingRowSnapshot,
    decision: EndpointUpsertDecision,
    incomingDeviceId: string,
    context: EndpointUpsertContext,
  ): boolean {
    // Rows predating first-seen tracking still owe us a backfill.
    if (!existing.firstSeenAt || !existing.lastSeenAt) {
      return false;
    }

    const refreshMs: number =
      context.lastSeenRefreshMs ?? ENDPOINT_LAST_SEEN_REFRESH_MS;
    const ageMs: number =
      context.now.getTime() - new Date(existing.lastSeenAt).getTime();
    if (ageMs < 0 || ageMs >= refreshMs) {
      return false;
    }

    if (
      decision.setIpAddress &&
      decision.ipAddress &&
      decision.ipAddress !== existing.ipAddress
    ) {
      return false;
    }

    if (decision.setAttachment) {
      if (existing.attachedNetworkDeviceId !== incomingDeviceId) {
        return false;
      }
      if (
        decision.attachedInterfaceIndex !== undefined &&
        decision.attachedInterfaceIndex !== existing.attachedInterfaceIndex
      ) {
        return false;
      }
      /*
       * Undefined port/vlan never clear a stored value, so "the walk did
       * not report one" is not a change.
       */
      if (
        decision.attachedPortName !== undefined &&
        decision.attachedPortName !== existing.attachedPortName
      ) {
        return false;
      }
      if (
        decision.vlanId !== undefined &&
        decision.vlanId !== existing.vlanId
      ) {
        return false;
      }
      if (context.siteId !== undefined && context.siteId !== existing.siteId) {
        return false;
      }
    }

    return true;
  }

  private static isGroupMac(normalizedMac: string): boolean {
    const firstOctet: number = parseInt(normalizedMac.substring(0, 2), 16);
    return (firstOctet & GROUP_ADDRESS_BIT) !== 0;
  }
}

export const normalizeMac: (value: string | undefined) => string | undefined =
  EndpointAttachmentUtil.normalizeMac;
