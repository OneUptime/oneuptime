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
  /*
   * Present when the device's FDB learned the MAC on an access port, or a
   * network controller reports the client on one. A controller names a port
   * and knows no ifIndex.
   */
  attachment?:
    | {
        interfaceIndex?: number | undefined;
        portName?: string | undefined;
        vlanId?: number | undefined;
      }
    | undefined;
  // Present when the device's ARP table binds the MAC to an IP.
  ipBinding?:
    | {
        ipAddress: string;
        routerInterfaceIndex?: number | undefined;
      }
    | undefined;
  /*
   * Present when a network controller reported this client rather than a
   * walk finding it: which controller, what it calls the client, and when
   * it last saw it.
   */
  controller?:
    | {
        // A NetworkControllerProvider.
        source: string;
        hostname?: string | undefined;
        seenAt: Date;
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
  hostname?: string | undefined;
  // Set when a network controller, not a walk, placed the row where it is.
  attachmentSource?: string | undefined;
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
 * How long a sighting a network controller reported stays current. A walk
 * sees an endpoint every few minutes; a controller's client list is read
 * every two hours (MerakiTrafficReader), so a row of one would read as gone
 * for most of the time between two reads on a walk's window. Three reads'
 * worth, so one failed read is no cliff.
 *
 * It also bounds how long a controller's placement outranks a walk: see
 * decideUpsert.
 */
export const CONTROLLER_SIGHTING_CURRENT_FOR_MS: number = 6 * 60 * 60 * 1000;

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
  /*
   * What a write leaves in attachmentSource: the controller's, or nothing -
   * a walk that writes to a row has taken it over.
   */
  attachmentSource?: string | undefined;
  // What a controller calls the client. Undefined never clears a stored name.
  hostname?: string | undefined;
  /*
   * When a controller last saw the client, for the row's lastSeenAt; a walk
   * saw it just now, which is what undefined means.
   */
  lastSeenAt?: Date | undefined;
}

/*
 * Multicast/broadcast MACs (group bit set in the first octet) are traffic
 * artifacts, not endpoints — e.g. 01:00:5e:… IPv4 multicast and the
 * ff:ff:ff:ff:ff:ff broadcast rows some ARP tables carry.
 */
const GROUP_ADDRESS_BIT: number = 0x01;

/*
 * Hoisted out of the call site so the literal is not the object of a member
 * expression, which `wrap-regex` and Prettier cannot agree on.
 */
const MAC_HEX_PATTERN: RegExp = /^[0-9a-f]{12}$/;

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
    if (!MAC_HEX_PATTERN.test(hex)) {
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
   *  - A network controller's report outranks a walk: it always takes the
   *    row, and while its sighting is current a walk changes nothing on it.
   *    The controller names the access port of a client it manages, where a
   *    forwarding table cannot tell an access port from an uplink that
   *    speaks no LLDP - so without this, the next walk of the switch next
   *    door would move the client back onto its uplink for two hours. Once
   *    the controller stops reporting the client, the walk takes the row
   *    over; lastSeenAt is not refreshed meanwhile, or it never could.
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

    if (
      !incoming.controller &&
      existing &&
      context &&
      EndpointAttachmentUtil.isHeldByController(existing, context.now)
    ) {
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

    if (incoming.controller) {
      decision.attachmentSource = incoming.controller.source;
      decision.hostname = incoming.controller.hostname;
      /*
       * Never backwards: a walk may have seen the client since the
       * controller did, and the list can be two hours old by now.
       */
      decision.lastSeenAt =
        existing?.lastSeenAt &&
        new Date(existing.lastSeenAt) > incoming.controller.seenAt
          ? new Date(existing.lastSeenAt)
          : incoming.controller.seenAt;
      /*
       * The port a walk named by its ifIndex is the same port only while it
       * goes by the same name. Kept then, so the link keeps its counters;
       * dropped when the client moved, or it would carry the old port's.
       */
      if (
        existing &&
        existing.attachedNetworkDeviceId === incoming.deviceId &&
        existing.attachedPortName === incoming.attachment?.portName
      ) {
        decision.attachedInterfaceIndex = existing.attachedInterfaceIndex;
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
   * still needs the firstSeenAt backfill, a row we have never seen a
   * timestamp for) falls through to a real write.
   *
   * A sighting older than the row's lastSeenAt refreshes nothing either.
   * That is an older poll processed after a newer one (OneUptime issue
   * #7389), or a row stamped by a clock a little ahead. The write never
   * moves lastSeenAt backwards (NetworkEndpointService keeps the later of
   * the two), so writing it would change nothing.
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
    if (ageMs >= refreshMs) {
      return false;
    }

    if (
      decision.setIpAddress &&
      decision.ipAddress &&
      decision.ipAddress !== existing.ipAddress
    ) {
      return false;
    }

    // A write that hands the row from a controller to a walk, or back.
    if (
      (decision.attachmentSource || "") !== (existing.attachmentSource || "")
    ) {
      return false;
    }

    if (decision.hostname && decision.hostname !== existing.hostname) {
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

  /*
   * True while a network controller's placement of this row stands. A row
   * with no controller behind it, or none current, is a walk's to write.
   */
  private static isHeldByController(
    existing: EndpointExistingRowSnapshot,
    now: Date,
  ): boolean {
    if (!existing.attachmentSource || !existing.lastSeenAt) {
      return false;
    }

    const ageMs: number =
      now.getTime() - new Date(existing.lastSeenAt).getTime();

    return ageMs <= CONTROLLER_SIGHTING_CURRENT_FOR_MS;
  }

  /*
   * How long a sighting is evidence, by who saw it: `walkWindowMs` for a walk,
   * which sees an endpoint every few minutes, and longer for a controller,
   * which is read every two hours. The map and the "Connected to" card both
   * ask here, so they cannot disagree about whether a row is current.
   */
  public static getSightingWindowMs(
    attachmentSource: string | undefined,
    walkWindowMs: number,
  ): number {
    return attachmentSource
      ? Math.max(CONTROLLER_SIGHTING_CURRENT_FOR_MS, walkWindowMs)
      : walkWindowMs;
  }

  private static isGroupMac(normalizedMac: string): boolean {
    const firstOctet: number = parseInt(normalizedMac.substring(0, 2), 16);
    return (firstOctet & GROUP_ADDRESS_BIT) !== 0;
  }
}

export const normalizeMac: (value: string | undefined) => string | undefined =
  EndpointAttachmentUtil.normalizeMac;
