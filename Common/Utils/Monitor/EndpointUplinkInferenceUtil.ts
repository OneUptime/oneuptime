import { normalizeMac } from "./EndpointAttachmentUtil";
import { NetworkEndpointAttachmentSourceUtil } from "../../Types/NetworkDevice/NetworkEndpointAttachmentSource";
import { NetworkDeviceMonitoringMethodUtil } from "../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import DeviceReachabilityUtil from "../NetworkDevice/DeviceReachabilityUtil";

/*
 * Working out which switch port an ICMP-only device is plugged into —
 * OneUptime issue #3489.
 *
 * THE PROBLEM
 *
 * A switch or an access point reports its neighbours over LLDP/CDP, so the
 * topology map draws those cables by itself. A till, a VoIP handset, a KPS
 * unit or anything else watched by a Ping monitor alone reports nothing about
 * anything, so until now the ONLY way to place it on the map was for somebody
 * to hand-draw a link from it to a switch. A single site has thirty or forty
 * of them; the reporter has many sites. And a hand-drawn link is worse than
 * absent the moment somebody re-patches the device, because it goes on
 * asserting a cable that was moved months ago.
 *
 * THE OBSERVATION THIS MODULE IS BUILT ON
 *
 * The answer is already in the database. Every SNMP switch with endpoint
 * collection enabled has its bridge forwarding database walked, and each MAC
 * it learned on an access port is stored as a NetworkEndpoint row naming the
 * switch and the port. Every router walked the same way contributes the ARP
 * row that says which IP that MAC answers for. So for a device whose hostname
 * is its address — which is exactly what a subnet-sweep import writes — the
 * join from "device 10.18.166.51" to "port Gi1/0/12 of switch-03" is a
 * lookup, not a discovery protocol.
 *
 * Nothing here polls, writes or schedules. The uplinks are DERIVED on every
 * topology build from rows the walks refresh anyway, which is what makes the
 * map self-correcting: re-patch a till and the next FDB walk moves its
 * endpoint row, and the cable on the map moves with it. A stored link would
 * have needed its own retirement policy to manage the same trick, and would
 * have been wrong in the window before it ran.
 *
 * THE POSTURE
 *
 * Every rule below refuses rather than guesses, and every refusal is
 * reported rather than swallowed. This file leans on IP matching, which
 * NetworkTopologyUtil itself calls the weakest key in the system ("every
 * branch site in an estate has a 10.0.0.1"), and the whole point of the
 * feature is that an operator stops checking the cables by hand. A map that
 * omits a link is a map somebody investigates. A map that invents one is a
 * map that sends an engineer to the wrong rack.
 */

/*
 * One managed device, reduced to what correlation needs. Both ends of the
 * join come from this list: the ICMP-only devices being placed, and the
 * switches whose FDB is doing the placing.
 */
export interface UplinkInferenceDeviceInput {
  id: string;
  /*
   * The address the probe polls. Only an IPv4 LITERAL is used as a key —
   * a DNS name is not resolved, for the reason matchKeysForDevice gives:
   * a lookup here would be a per-node network call whose answer changes
   * between rebuilds.
   */
  hostname?: string | undefined;
  /*
   * The site the device belongs to. Correlation NEVER crosses one: every
   * branch of an estate reuses the same RFC1918 range, so a project-wide
   * IP index would either resolve 10.0.0.42 to whichever site's device
   * happened to be indexed first, or (with an ambiguity guard) refuse
   * every device in the estate at once.
   */
  siteId?: string | undefined;
  // Free text; read through NetworkDeviceMonitoringMethodUtil, never compared raw.
  monitoringMethod?: string | undefined;
  // Interface MACs, when the device is one something walks.
  macAddresses?: Array<string> | undefined;
  /*
   * Whether this device's walk collects ARP/FDB rows at all. Read from the
   * SWITCHES, not from the device being placed: it is the difference
   * between "this till is not in any MAC table" and "nothing in this site
   * reads MAC tables", which are the same silence and completely different
   * pieces of work.
   */
  collectEndpoints?: boolean | undefined;
  /*
   * How often this device is walked. Sizes the freshness window for the
   * rows it wrote: a switch polled every four hours cannot be held to the
   * same recency as one polled every five minutes, and holding it there
   * makes its cables blink in and out on every refresh.
   */
  pollingIntervalInMinutes?: number | undefined;
}

// One NetworkEndpoint row, reduced to what correlation needs.
export interface UplinkInferenceEndpointInput {
  id: string;
  macAddress: string;
  ipAddress?: string | undefined;
  vlanId?: number | undefined;
  attachedNetworkDeviceId?: string | undefined;
  attachedInterfaceIndex?: number | undefined;
  attachedPortName?: string | undefined;
  // Free text; read through NetworkEndpointAttachmentSourceUtil.
  attachmentSource?: string | undefined;
  /*
   * When a walk last CONFIRMED the attachment, as opposed to `lastSeenAt`,
   * which any sighting of the MAC refreshes — a router's ARP table included,
   * and that says nothing about which port the device is on. Without this
   * distinction a row can be seconds fresh and still name a port the device
   * left months ago.
   */
  attachmentLastSeenAt?: Date | undefined;
  // When a router's ARP table last confirmed the address. Same argument.
  ipAddressLastSeenAt?: Date | undefined;
  lastSeenAt?: Date | undefined;
}

// Which key decided a match. Recorded so the map can show its working.
export type UplinkMatchKind = "mac" | "ip";

/*
 * "This device hangs off that switch port, and here is why we think so."
 * The caller turns one of these into a graph edge.
 */
export interface InferredUplink {
  // The NetworkEndpoint row the conclusion came from.
  endpointId: string;
  // The ICMP-only device being placed.
  deviceId: string;
  // The switch whose forwarding database learned it.
  switchDeviceId: string;
  switchInterfaceIndex: number;
  switchPortName?: string | undefined;
  vlanId?: number | undefined;
  macAddress: string;
  ipAddress?: string | undefined;
  lastSeenAt?: Date | undefined;
  matchedOn: UplinkMatchKind;
}

/*
 * Why a monitor-backed device was NOT placed. Surfaced to the operator
 * verbatim, because the failure modes here are all fixable by them and
 * indistinguishable from each other on a map that just says nothing —
 * the same argument the link-rule warnings are built on.
 *
 * Split finely on purpose. "Nothing matched" covering four different pieces
 * of work is a warning nobody can act on, so each cause that needs a
 * different fix is its own member even where two of them look alike on the
 * map.
 */
export type UplinkRefusalReason =
  /*
   * No device in this device's site collects endpoints, so there is no MAC
   * table anywhere to look in. By far the commonest cause — the setting is
   * per-device and defaults to off — and the only one whose fix is a single
   * checkbox.
   */
  | "endpointCollectionOff"
  /*
   * The device's hostname is a DNS name, not an address, and nothing knows
   * a MAC for it. There is no key to join on at all.
   */
  | "noMatchableAddress"
  /*
   * The device has no site while other devices here do. Correlation is
   * per-site by construction, so an unfiled device cannot be matched
   * against a sited switch — which of the estate's forty 10.0.0.42s it is
   * would be a guess.
   */
  | "deviceHasNoSite"
  /*
   * There IS a key and switches here do collect endpoints, but no row
   * carries it. Usually the router that would supply the ARP binding is
   * not walked, or the device is on a VLAN the FDB walk cannot read.
   */
  | "noEndpointMatch"
  /*
   * A row matched, but a router's ARP table put it there, not a switch's
   * forwarding database. That names the router's own L3 interface — it is
   * a statement about a subnet, not about a cable.
   */
  | "arpOnlyAttachment"
  /*
   * A row matched, but it predates provenance being recorded, so we cannot
   * tell an FDB attachment from an ARP one. Self-healing: the next walk
   * that touches the row stamps it.
   */
  | "attachmentSourceUnknown"
  /*
   * A row matched, but the last walk that CONFIRMED the attachment is older
   * than the window its switch's poll interval allows. Nothing ever
   * detaches an endpoint, so a decommissioned device keeps its attachment
   * for ever; drawing from it is exactly the stale cable this feature
   * exists to stop.
   */
  | "attachmentStale"
  /*
   * The match was made on an address a router has not re-confirmed lately.
   * The address column is never cleared once learned, so a row can be fresh
   * on its port and still be carrying an address another box has taken over.
   */
  | "ipBindingStale"
  /*
   * The port carrying it has too many live MACs to be an access port. It
   * is an uplink to something that speaks neither LLDP nor CDP — an
   * unmanaged switch, a hub, a media converter — and every MAC behind it
   * would otherwise be cabled to the wrong switch at once.
   */
  | "transitPort"
  /*
   * More than one managed device resolved to the SAME switch port. Whatever
   * is on that port, it is not either of them directly — there is a hub or
   * an unmanaged switch in between — so the port cannot be attributed.
   */
  | "portHasMultipleDevices"
  /*
   * Two devices in the site claim the matched address, or two endpoint
   * rows claim it, or two endpoint rows resolve to this one device. Which
   * one is right is not decidable from here.
   */
  | "ambiguous"
  /*
   * The matched row is attached to the device itself. A device cannot be
   * plugged into its own port.
   */
  | "selfAttachment"
  /*
   * The map read a capped page of endpoint rows, so both count-based guards
   * — transit-port occupancy and two-endpoints-claim-one-address — were
   * looking at a sample. Both fail in the ACCEPTING direction when they
   * undercount, so nothing is inferred at all rather than inferred from a
   * sample.
   */
  | "endpointListTruncated";

export interface UplinkRefusal {
  deviceId: string;
  reason: UplinkRefusalReason;
  // The endpoint row involved, when a specific row was refused.
  endpointId?: string | undefined;
  // The switch the refused row named, when there was one.
  switchDeviceId?: string | undefined;
  /*
   * How many live MACs the port carried. Only set for "transitPort", where
   * the number IS the explanation.
   */
  portMacCount?: number | undefined;
}

export interface UplinkInferenceResult {
  uplinks: Array<InferredUplink>;
  /*
   * One per monitor-backed device that got no uplink. Deterministically
   * ordered by device id so a warning list does not reshuffle every poll.
   */
  refusals: Array<UplinkRefusal>;
  /*
   * Endpoint row ids that became an uplink. The caller uses this to stop
   * drawing the duplicate leaf node — the box is now on the map as the
   * device it actually is.
   */
  promotedEndpointIds: Set<string>;
}

/*
 * How many live MACs one switch port may carry before it is read as an
 * uplink to unmanaged gear rather than an access port.
 *
 * The only suppression that exists today is "an LLDP or CDP neighbour was
 * reported on this interface" (EndpointAttachmentUtil.computeEndpointAttachments).
 * A cable to something that speaks neither — an unmanaged switch under a
 * counter, a hub, a media converter, a switch with its interface walk off —
 * is therefore still classed as an access port, and the near switch learns
 * every MAC behind it on that one port.
 *
 * Eight is chosen against the real shapes rather than the theory. A handset
 * with a PC daisy-chained behind it is two; a small unmanaged desk switch is
 * a handful; a genuine inter-switch uplink is dozens to hundreds. Two would
 * be the strict L2 answer and would refuse the daisy-chain, which is a
 * completely ordinary retail wiring pattern. Eight keeps every one of those
 * and still refuses the case that would cable forty tills to the wrong
 * switch in a single refresh.
 *
 * It is a backstop, not the main guard: `portHasMultipleDevices` already
 * refuses any port that resolves to more than one MANAGED device, whatever
 * the raw MAC count. This catches the port whose forty MACs happen to
 * include only one device we manage.
 */
export const MAX_MACS_ON_ACCESS_PORT: number = 8;

const IPV4_PATTERN: RegExp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/*
 * Strict v4 test, octet bounds included. Mirrors the one in
 * NetworkTopologyUtil deliberately rather than importing it: that one is
 * private to the topology builder, and duplicating six lines is cheaper
 * than widening its surface.
 */
function isIpv4Address(value: string | undefined): boolean {
  if (!value || !IPV4_PATTERN.test(value)) {
    return false;
  }

  return value.split(".").every((octet: string) => {
    return parseInt(octet, 10) <= 255;
  });
}

function normalizeAddress(value: string | undefined): string | undefined {
  const trimmed: string = (value || "").trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

/*
 * Site partition key. Devices with no site form their OWN partition rather
 * than joining a global one: a project that has never used sites is one
 * partition and behaves exactly as an unpartitioned index would, while a
 * project that uses them cannot have an unfiled device silently matched
 * against another site's addresses.
 */
const NO_SITE: string = " no-site";

function siteKey(siteId: string | undefined): string {
  return siteId || NO_SITE;
}

// A key one device (or one endpoint row) can be recognised by, within a site.
function indexKey(site: string, kind: UplinkMatchKind, value: string): string {
  return `${site}::${kind}::${value}`;
}

function portKey(deviceId: string, interfaceIndex: number): string {
  return `${deviceId}::${interfaceIndex}`;
}

/*
 * An index that refuses rather than resolves anything two owners claim.
 * Copied in spirit from NetworkTopologyUtil's deviceByMatchKey guard, whose
 * comment states the rule this whole file follows: "a wrong cable on a
 * network map is worse than a missing one".
 */
class UniqueIndex {
  private valueByKey: Map<string, string> = new Map<string, string>();
  private contestedKeys: Set<string> = new Set<string>();

  public add(key: string, value: string): void {
    const existing: string | undefined = this.valueByKey.get(key);
    if (existing !== undefined && existing !== value) {
      this.contestedKeys.add(key);
      return;
    }
    this.valueByKey.set(key, value);
  }

  public get(key: string): string | undefined {
    if (this.contestedKeys.has(key)) {
      return undefined;
    }
    return this.valueByKey.get(key);
  }

  public isContested(key: string): boolean {
    return this.contestedKeys.has(key);
  }
}

export interface UplinkInferenceInput {
  /*
   * Every managed device on the graph — both the ICMP-only ones being
   * placed and the switches doing the placing. Filtering to one or the
   * other here would break the site lookup, which reads the SWITCH's site
   * to decide which site an endpoint row belongs to.
   */
  devices: Array<UplinkInferenceDeviceInput>;
  endpoints: Array<UplinkInferenceEndpointInput>;
  now: Date;
  /*
   * True when the caller's endpoint query hit its cap. Both count-based
   * guards below are then reading a sample, and both fail OPEN when they
   * undercount — so inference declines entirely rather than drawing cables
   * whose guards it cannot stand behind.
   */
  isEndpointListTruncated?: boolean | undefined;
  /*
   * Devices that already have a link on the map from some other source.
   * They are excluded from the refusal report — an operator who has already
   * drawn a till's cable by hand does not need to be told every sixty
   * seconds that we could not work it out ourselves.
   */
  alreadyLinkedDeviceIds?: ReadonlySet<string> | undefined;
  maxMacsOnAccessPort?: number | undefined;
}

export default class EndpointUplinkInferenceUtil {
  /*
   * Resolves NetworkEndpoint rows into uplinks for the monitor-backed
   * devices they describe.
   *
   * Deterministic: the endpoint list is walked in a fixed order and every
   * contested key is dropped rather than decided, so two builds of the same
   * data produce the same graph. That matters more here than usual — the map
   * re-polls every sixty seconds, and a cable that moves between switches on
   * alternate refreshes destroys trust in everything else on the screen.
   */
  public static infer(input: UplinkInferenceInput): UplinkInferenceResult {
    const maxMacsOnAccessPort: number =
      input.maxMacsOnAccessPort ?? MAX_MACS_ON_ACCESS_PORT;
    const alreadyLinked: ReadonlySet<string> =
      input.alreadyLinkedDeviceIds || new Set<string>();

    const deviceById: Map<string, UplinkInferenceDeviceInput> = new Map<
      string,
      UplinkInferenceDeviceInput
    >();
    for (const device of input.devices) {
      if (!deviceById.has(device.id)) {
        deviceById.set(device.id, device);
      }
    }

    /*
     * Candidates are monitor-backed devices ONLY.
     *
     * An SNMP device already has LLDP/CDP working for it, and its own FDB
     * besides. Letting a switch be placed by another switch's forwarding
     * database would add a second, weaker claim about a cable that is
     * already measured — and on a trunk it would be a claim about transit
     * traffic. The devices this issue is about are precisely the ones no
     * protocol speaks for.
     */
    const candidateByKey: UniqueIndex = new UniqueIndex();
    const candidateIds: Set<string> = new Set<string>();
    for (const device of input.devices) {
      if (
        !NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
          device.monitoringMethod,
        )
      ) {
        continue;
      }
      candidateIds.add(device.id);

      const site: string = siteKey(device.siteId);

      for (const rawMac of device.macAddresses || []) {
        const mac: string | undefined = normalizeMac(rawMac);
        if (mac) {
          candidateByKey.add(indexKey(site, "mac", mac), device.id);
        }
      }

      /*
       * Read from `hostname` only, never from `name`. A name is an
       * operator's label; one that happens to look like an address is not
       * a claim that the device answers there. matchKeysForDevice makes
       * the same distinction for the same reason.
       */
      const hostname: string | undefined = normalizeAddress(device.hostname);
      if (isIpv4Address(hostname)) {
        candidateByKey.add(indexKey(site, "ip", hostname!), device.id);
      }
    }

    const refusalByDeviceId: Map<string, UplinkRefusal> = new Map<
      string,
      UplinkRefusal
    >();

    /*
     * First refusal per device wins. Walk order is MAC-sorted, so this is
     * stable, and one clear sentence beats a list of every row that failed
     * to place the same till.
     */
    const refuse: (refusal: UplinkRefusal) => void = (
      refusal: UplinkRefusal,
    ): void => {
      if (!refusalByDeviceId.has(refusal.deviceId)) {
        refusalByDeviceId.set(refusal.deviceId, refusal);
      }
    };

    const finish: (uplinks: Array<InferredUplink>) => UplinkInferenceResult = (
      uplinks: Array<InferredUplink>,
    ): UplinkInferenceResult => {
      const placedDeviceIds: Set<string> = new Set<string>(
        uplinks.map((uplink: InferredUplink) => {
          return uplink.deviceId;
        }),
      );

      /*
       * A device that WAS placed reports nothing, even if an earlier row was
       * refused on its behalf — "your till is on switch-03 port 12, and also
       * here is why a stale row on switch-01 was ignored" is noise on a
       * screen whose job is to surface the ones that are missing. Neither
       * does a device somebody has already linked by hand: it is not
       * missing a cable, so it is not a problem to report.
       */
      const refusals: Array<UplinkRefusal> = Array.from(
        refusalByDeviceId.values(),
      )
        .filter((refusal: UplinkRefusal) => {
          return (
            !placedDeviceIds.has(refusal.deviceId) &&
            !alreadyLinked.has(refusal.deviceId)
          );
        })
        .sort((a: UplinkRefusal, b: UplinkRefusal): number => {
          return a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0;
        });

      return {
        uplinks: uplinks,
        refusals: refusals,
        promotedEndpointIds: new Set<string>(
          uplinks.map((uplink: InferredUplink) => {
            return uplink.endpointId;
          }),
        ),
      };
    };

    /*
     * A capped endpoint page cannot support ANY of the conclusions below.
     * Both count-based guards — how many MACs are on this port, how many
     * rows claim this address — undercount on a sample, and undercounting
     * makes each of them ACCEPT what it exists to refuse. Declining outright
     * is the designed failure direction, and it is reported so the operator
     * is not left thinking their switches are misconfigured.
     */
    if (input.isEndpointListTruncated) {
      for (const deviceId of Array.from(candidateIds).sort()) {
        refuse({ deviceId: deviceId, reason: "endpointListTruncated" });
      }
      return finish([]);
    }

    /*
     * How stale a fact from a given device's walk may be. Scaled by that
     * device's own poll interval through the same rule the map uses for
     * device reachability, so a switch polled every four hours does not have
     * its cables blink out between polls — which on a sixty-second refresh
     * is a graph that changes shape while somebody is looking at it.
     */
    const freshWindowMsFor: (
      device: UplinkInferenceDeviceInput | undefined,
    ) => number = (device: UplinkInferenceDeviceInput | undefined): number => {
      return (
        DeviceReachabilityUtil.getStaleWindowInMinutes(
          device?.pollingIntervalInMinutes,
        ) *
        60 *
        1000
      );
    };

    const isFresh: (at: Date | undefined, windowMs: number) => boolean = (
      at: Date | undefined,
      windowMs: number,
    ): boolean => {
      if (!at) {
        return false;
      }
      const ageMs: number = input.now.getTime() - new Date(at).getTime();
      return ageMs < windowMs;
    };

    /*
     * The endpoint side of the device ambiguity guard. Two rows cannot share
     * a MAC — the table is unique on (projectId, macAddress) — but nothing
     * stops two rows sharing an IP, and nothing ever ages a row out: a NIC
     * swap or a DHCP reassignment leaves the old MAC's row holding the
     * address for ever. Whichever of the two is right is not decidable here.
     */
    const endpointIpOwners: UniqueIndex = new UniqueIndex();
    // Live MACs per (switch, port), the transit-port evidence.
    const macsByPort: Map<string, Set<string>> = new Map<string, Set<string>>();

    for (const endpoint of input.endpoints) {
      const attachedDeviceId: string | undefined =
        endpoint.attachedNetworkDeviceId;
      if (!attachedDeviceId) {
        continue;
      }
      const attachedDevice: UplinkInferenceDeviceInput | undefined =
        deviceById.get(attachedDeviceId);
      if (!attachedDevice) {
        continue;
      }

      const site: string = siteKey(attachedDevice.siteId);
      const windowMs: number = freshWindowMsFor(attachedDevice);

      const ipAddress: string | undefined = normalizeAddress(
        endpoint.ipAddress,
      );
      if (isIpv4Address(ipAddress)) {
        endpointIpOwners.add(indexKey(site, "ip", ipAddress!), endpoint.id);
      }

      /*
       * Only LIVE attachments count towards a port's occupancy. Stale rows
       * never detach, so counting them would let a port that has hosted
       * eight tills over two years read as a trunk today.
       */
      if (endpoint.attachedInterfaceIndex === undefined) {
        continue;
      }
      if (!isFresh(endpoint.attachmentLastSeenAt, windowMs)) {
        continue;
      }
      const mac: string | undefined = normalizeMac(endpoint.macAddress);
      if (!mac) {
        continue;
      }
      const key: string = portKey(
        attachedDeviceId,
        endpoint.attachedInterfaceIndex,
      );
      const macs: Set<string> | undefined = macsByPort.get(key);
      if (macs) {
        macs.add(mac);
      } else {
        macsByPort.set(key, new Set<string>([mac]));
      }
    }

    /*
     * Deterministic walk order: normalized MAC, then row id. The result is
     * order-independent anyway (contested keys are dropped, not raced) but
     * the refusal list is user-visible and must not reshuffle.
     */
    const sortedEndpoints: Array<UplinkInferenceEndpointInput> = [
      ...input.endpoints,
    ].sort(
      (
        a: UplinkInferenceEndpointInput,
        b: UplinkInferenceEndpointInput,
      ): number => {
        const aMac: string = normalizeMac(a.macAddress) || a.macAddress;
        const bMac: string = normalizeMac(b.macAddress) || b.macAddress;
        if (aMac !== bMac) {
          return aMac < bMac ? -1 : 1;
        }
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      },
    );

    const candidates: Array<InferredUplink> = [];

    for (const endpoint of sortedEndpoints) {
      const attachedDeviceId: string | undefined =
        endpoint.attachedNetworkDeviceId;
      if (!attachedDeviceId) {
        continue;
      }
      const attachedDevice: UplinkInferenceDeviceInput | undefined =
        deviceById.get(attachedDeviceId);
      if (!attachedDevice) {
        // Attached to something outside this graph; nothing to hang it off.
        continue;
      }

      const site: string = siteKey(attachedDevice.siteId);
      const windowMs: number = freshWindowMsFor(attachedDevice);

      /*
       * Resolve the row to a device before applying the attachment gates,
       * so a refusal can name the device it is about. MAC first: it is the
       * stronger key, and it is the one an FDB entry is literally keyed on.
       */
      let matchedOn: UplinkMatchKind | undefined = undefined;
      let matchedDeviceId: string | undefined = undefined;

      const mac: string | undefined = normalizeMac(endpoint.macAddress);
      if (mac) {
        matchedDeviceId = candidateByKey.get(indexKey(site, "mac", mac));
        if (matchedDeviceId) {
          matchedOn = "mac";
        }
      }

      const ipAddress: string | undefined = normalizeAddress(
        endpoint.ipAddress,
      );
      const hasIpKey: boolean = isIpv4Address(ipAddress);

      if (!matchedDeviceId && hasIpKey) {
        const key: string = indexKey(site, "ip", ipAddress!);
        /*
         * Both halves of the IP join must be unambiguous: one device
         * claiming the address, and one endpoint row carrying it. A
         * contest is not attributed to a device here — the contest is
         * precisely over WHICH device the address belongs to — so the
         * devices it leaves unplaced report it in the per-device sweep.
         */
        if (
          !candidateByKey.isContested(key) &&
          !endpointIpOwners.isContested(key)
        ) {
          matchedDeviceId = candidateByKey.get(key);
          if (matchedDeviceId) {
            matchedOn = "ip";
          }
        }
      }

      if (!matchedDeviceId) {
        // An ordinary endpoint: a host nobody has added as a device.
        continue;
      }

      if (matchedDeviceId === attachedDeviceId) {
        refuse({
          deviceId: matchedDeviceId,
          reason: "selfAttachment",
          endpointId: endpoint.id,
        });
        continue;
      }

      /*
       * An address the map matched on has to be an address a router still
       * answers for. `ipAddress` is never cleared once learned, so without
       * this a row can be fresh on its port and carrying an address another
       * box took over months ago — and the new box, having no ARP row of
       * its own, looks unambiguous to the guard above.
       */
      if (
        matchedOn === "ip" &&
        !isFresh(endpoint.ipAddressLastSeenAt, windowMs)
      ) {
        refuse({
          deviceId: matchedDeviceId,
          reason: "ipBindingStale",
          endpointId: endpoint.id,
          switchDeviceId: attachedDeviceId,
        });
        continue;
      }

      if (!endpoint.attachmentSource) {
        /*
         * Written before provenance was recorded. Distinguished from a
         * known-ARP row because the fix is different: this one resolves
         * itself on the next walk, and telling the operator to go and
         * enable a setting that is already on would waste their time.
         */
        refuse({
          deviceId: matchedDeviceId,
          reason: "attachmentSourceUnknown",
          endpointId: endpoint.id,
          switchDeviceId: attachedDeviceId,
        });
        continue;
      }

      if (
        !NetworkEndpointAttachmentSourceUtil.isFdb(endpoint.attachmentSource) ||
        endpoint.attachedInterfaceIndex === undefined
      ) {
        /*
         * A router's ARP row, or an FDB row whose bridge port never
         * resolved to an ifIndex. Either way there is no physical port
         * here, and a cable needs one.
         */
        refuse({
          deviceId: matchedDeviceId,
          reason: "arpOnlyAttachment",
          endpointId: endpoint.id,
          switchDeviceId: attachedDeviceId,
        });
        continue;
      }

      if (!isFresh(endpoint.attachmentLastSeenAt, windowMs)) {
        refuse({
          deviceId: matchedDeviceId,
          reason: "attachmentStale",
          endpointId: endpoint.id,
          switchDeviceId: attachedDeviceId,
        });
        continue;
      }

      const occupancy: number =
        macsByPort.get(
          portKey(attachedDeviceId, endpoint.attachedInterfaceIndex),
        )?.size ?? 0;
      if (occupancy > maxMacsOnAccessPort) {
        refuse({
          deviceId: matchedDeviceId,
          reason: "transitPort",
          endpointId: endpoint.id,
          switchDeviceId: attachedDeviceId,
          portMacCount: occupancy,
        });
        continue;
      }

      candidates.push({
        endpointId: endpoint.id,
        deviceId: matchedDeviceId,
        switchDeviceId: attachedDeviceId,
        switchInterfaceIndex: endpoint.attachedInterfaceIndex,
        switchPortName: endpoint.attachedPortName,
        vlanId: endpoint.vlanId,
        macAddress: endpoint.macAddress,
        ipAddress: endpoint.ipAddress,
        lastSeenAt: endpoint.attachmentLastSeenAt || endpoint.lastSeenAt,
        matchedOn: matchedOn!,
      });
    }

    /*
     * Two guards the per-row pass cannot express, because each is about a
     * RELATIONSHIP between rows that both survived it.
     *
     * One: two different endpoint rows that both resolved to one device. A
     * till whose MAC still sits in one switch's FDB while its address
     * answers on another's is the live example — a re-patch where the old
     * entry has not aged out. Both claims are plausible and they disagree
     * about which rack to walk to.
     *
     * Two: two different managed devices that resolved to one switch PORT.
     * Whatever is on that port, it is not either of them directly: there is
     * a hub, an unmanaged switch or a daisy-chained handset in between, and
     * drawing both as cables into one socket states something that cannot
     * be true. This is the guard the MAC-count backstop cannot make, since
     * such a port may carry only two MACs.
     */
    const countByDeviceId: Map<string, number> = new Map<string, number>();
    const countByPort: Map<string, number> = new Map<string, number>();
    for (const candidate of candidates) {
      countByDeviceId.set(
        candidate.deviceId,
        (countByDeviceId.get(candidate.deviceId) || 0) + 1,
      );
      const key: string = portKey(
        candidate.switchDeviceId,
        candidate.switchInterfaceIndex,
      );
      countByPort.set(key, (countByPort.get(key) || 0) + 1);
    }

    const uplinks: Array<InferredUplink> = [];
    for (const candidate of candidates) {
      if ((countByDeviceId.get(candidate.deviceId) || 0) > 1) {
        refuse({
          deviceId: candidate.deviceId,
          reason: "ambiguous",
          endpointId: candidate.endpointId,
          switchDeviceId: candidate.switchDeviceId,
        });
        continue;
      }
      const key: string = portKey(
        candidate.switchDeviceId,
        candidate.switchInterfaceIndex,
      );
      if ((countByPort.get(key) || 0) > 1) {
        refuse({
          deviceId: candidate.deviceId,
          reason: "portHasMultipleDevices",
          endpointId: candidate.endpointId,
          switchDeviceId: candidate.switchDeviceId,
          portMacCount: countByPort.get(key),
        });
        continue;
      }
      uplinks.push(candidate);
    }

    /*
     * Finally, the devices no row spoke about at all. These are the common
     * cases in practice and the ones an operator can actually fix, so they
     * get the same treatment as an active refusal rather than silence.
     */
    const placedDeviceIds: Set<string> = new Set<string>(
      uplinks.map((uplink: InferredUplink) => {
        return uplink.deviceId;
      }),
    );

    /*
     * Which sites have a switch that reads MAC tables at all. Without this,
     * "not found in any MAC table" is the same sentence for a site nobody
     * ever enabled the walk in — which is the overwhelmingly common case,
     * since `collectEndpoints` is per-device and defaults to off.
     */
    const sitesCollectingEndpoints: Set<string> = new Set<string>();
    let anyDeviceHasSite: boolean = false;
    for (const device of input.devices) {
      if (device.siteId) {
        anyDeviceHasSite = true;
      }
      if (device.collectEndpoints === true) {
        sitesCollectingEndpoints.add(siteKey(device.siteId));
      }
    }

    for (const deviceId of Array.from(candidateIds).sort()) {
      if (placedDeviceIds.has(deviceId) || refusalByDeviceId.has(deviceId)) {
        continue;
      }
      const device: UplinkInferenceDeviceInput = deviceById.get(deviceId)!;
      const site: string = siteKey(device.siteId);
      const hostname: string | undefined = normalizeAddress(device.hostname);

      const hasMacKey: boolean = (device.macAddresses || []).some(
        (rawMac: string) => {
          return Boolean(normalizeMac(rawMac));
        },
      );
      const hasIpKey: boolean = isIpv4Address(hostname);

      if (!hasMacKey && !hasIpKey) {
        refuse({ deviceId: deviceId, reason: "noMatchableAddress" });
        continue;
      }

      /*
       * A key that exists but is claimed by more than one device reads as
       * ambiguous, not as "nothing matched" — the operator's fix is to
       * correct the duplicate hostname, which "no endpoint matched" would
       * never lead them to.
       */
      if (
        hasIpKey &&
        (candidateByKey.isContested(indexKey(site, "ip", hostname!)) ||
          endpointIpOwners.isContested(indexKey(site, "ip", hostname!)))
      ) {
        refuse({ deviceId: deviceId, reason: "ambiguous" });
        continue;
      }

      if (!sitesCollectingEndpoints.has(site)) {
        /*
         * An unfiled device in a project that DOES use sites is its own
         * problem, and a different one: it can never be matched, however
         * many switches collect endpoints, because correlation is per-site.
         * Reported separately so the fix named is assigning the site rather
         * than enabling a walk that is already on.
         */
        if (!device.siteId && anyDeviceHasSite) {
          refuse({ deviceId: deviceId, reason: "deviceHasNoSite" });
          continue;
        }
        refuse({ deviceId: deviceId, reason: "endpointCollectionOff" });
        continue;
      }

      refuse({ deviceId: deviceId, reason: "noEndpointMatch" });
    }

    return finish(uplinks);
  }
}
