/*
 * TWO SITES' DEVICES AT ONE ADDRESS (OneUptime issue #9677).
 *
 * Every branch can have a 10.0.0.5. A network device's address names one
 * host within its site - and a device in no site is in the project's
 * network outside its sites - never one host across the whole project, as
 * the Discovered Devices list and the topology map already read it. So
 * wherever OneUptime asks which device an address is, it asks from where:
 *
 *   - a discovery scan's host (Review Results, the import it starts, an
 *     auto import rule's run) is seen through the scan's probe;
 *   - a monitor someone made (tied to its device as it is created, when its
 *     address changes, and by the one-time backfill of the monitors made
 *     before issue #9545) is seen through the probes it runs on.
 *
 * WHERE PROBES LOOK (their reach): into the sites they poll devices in, and
 * the sites that name one of them their default probe (their own, or the
 * one they inherit). Probes that are no site's - they poll only devices in
 * no site - look into the network outside the sites. Probes that poll no
 * device and are no site's default probe look somewhere OneUptime cannot
 * know.
 *
 * THE DEVICE AN ADDRESS IS, SEEN FROM THE PROBES (pickDeviceSeenFrom):
 *
 *   1. the device at the address the probes poll: they reach it there;
 *   2. else the device at the address in a site they look into;
 *   3. else none: the host they see at that address is another network's,
 *      whatever device another site has there.
 *
 * Two devices that fit a step alike cannot be told apart: no device is
 * picked, and the address is ambiguous rather than free.
 *
 * WHEN THE PROBES' REACH CANNOT BE KNOWN, each path does what cannot hurt it
 * (WhenReachUnknown):
 *
 *   - a scan's host is the one device at the address, wherever it is, as
 *     before: an import never adds a box twice, and several devices there
 *     are ambiguous, never a free address;
 *   - a monitor is tied to the one device at the address only when that
 *     device is in no site: a monitor nothing places in a site is never
 *     counted as one site's device's monitor. A person can still tie it.
 *
 * EACH ANSWER SAYS WHY (issues #9903, #9904, #9905): which step picked the
 * device, why none is the host the probes see, or why the devices there
 * cannot be told apart, with the devices that cannot. Review Results says
 * so beside a host at a shared address, and a device's page beside a
 * monitor that checks its address but is tied to no device.
 *
 * Pure: the server reads the devices at an address and what the probes
 * reach (NetworkDeviceService), the backfill works the same facts out from
 * every device and site it holds (buildProbeReachIndex), and both decide
 * here.
 */

type IdLike = { toString(): string } | string | null | undefined;

// What "no site" is filed under among site keys.
export const NO_SITE_KEY: string = "";

// An id as the rule compares it: trimmed and lower-cased, "" for none.
export function toIdKey(id: IdLike): string {
  if (id === null || id === undefined) {
    return "";
  }

  return id.toString().trim().toLowerCase();
}

// A device's site as the rule files it: its id, or NO_SITE_KEY for none.
export function getSiteKey(siteId: IdLike): string {
  return toIdKey(siteId);
}

// What the rule reads of a device at an address. A NetworkDevice is one.
export interface DeviceAtAddressLike {
  id?: IdLike;
  siteId?: IdLike;
  probeId?: IdLike;
}

// Where a scan's or a monitor's probes look.
export interface ProbeReach {
  // The probes, by id key.
  probeIds: ReadonlySet<string>;
  /*
   * The sites they look into, among those asked about, by site key:
   * NO_SITE_KEY for the network outside the sites.
   */
  siteKeys: ReadonlySet<string>;
  // False when they poll no device and are no site's default probe.
  isKnown: boolean;
}

/*
 * What a reach is worked out from, the same whether the server reads it from
 * the database or the backfill from the rows it holds.
 */
export interface ProbeReachFacts {
  probeIds: ReadonlyArray<IdLike>;
  /*
   * Each site asked about (never NO_SITE_KEY): whether the probes poll a
   * device in it, and whether its default probe, its own or inherited, is
   * one of them.
   */
  sites: ReadonlyArray<{
    siteKey: string;
    hasDevicePolled: boolean;
    hasProbeAsDefault: boolean;
  }>;
  // Whether the probes poll a device in any site.
  pollsDeviceInASite: boolean;
  // Whether the probes poll a device in no site.
  pollsDeviceInNoSite: boolean;
  // Whether any site names one of the probes its own default probe.
  isDefaultProbeOfASite: boolean;
}

export function getProbeIdKeys(probeIds: ReadonlyArray<IdLike>): Set<string> {
  const keys: Set<string> = new Set<string>();

  for (const probeId of probeIds) {
    const key: string = toIdKey(probeId);

    if (key) {
      keys.add(key);
    }
  }

  return keys;
}

export function toProbeReach(facts: ProbeReachFacts): ProbeReach {
  const probeIds: Set<string> = getProbeIdKeys(facts.probeIds);
  const siteKeys: Set<string> = new Set<string>();

  if (probeIds.size === 0) {
    return { probeIds: probeIds, siteKeys: siteKeys, isKnown: false };
  }

  let isInASite: boolean =
    facts.pollsDeviceInASite || facts.isDefaultProbeOfASite;

  for (const site of facts.sites) {
    const siteKey: string = getSiteKey(site.siteKey);

    if (siteKey && (site.hasDevicePolled || site.hasProbeAsDefault)) {
      siteKeys.add(siteKey);
      isInASite = true;
    }
  }

  /*
   * Probes that are a site's look into that site, and reach the devices in
   * no site they poll themselves (step 1). Only probes that are no site's
   * look into the network outside the sites: otherwise one site's probe,
   * polling a device nobody has put in a site yet, would read every other
   * unplaced device in the project as its own.
   */
  if (facts.pollsDeviceInNoSite && !isInASite) {
    siteKeys.add(NO_SITE_KEY);
  }

  return {
    probeIds: probeIds,
    siteKeys: siteKeys,
    isKnown: isInASite || facts.pollsDeviceInNoSite,
  };
}

/*
 * What an address is matched to when the probes' reach cannot be known (see
 * the top of this file).
 */
export enum WhenReachUnknown {
  // A scan's host: the one device at the address, wherever it is.
  OnlyDeviceAnywhere = "OnlyDeviceAnywhere",
  // A monitor: the one device at the address, when it is in no site.
  OnlyDeviceInNoSite = "OnlyDeviceInNoSite",
}

// Which step picked the device the probes see at the address.
export enum SeenDeviceReason {
  // Step 1: they poll it.
  PolledByTheProbes = "PolledByTheProbes",
  // Step 2: it is the only device at the address in a site they look into.
  OnlyOneInTheirSites = "OnlyOneInTheirSites",
  // Where they look cannot be known: it is the only device at the address.
  OnlyOneAtTheAddress = "OnlyOneAtTheAddress",
}

// Why no device at the address is the host the probes see there.
export enum NoDeviceReason {
  // No device in the project has the address.
  NoneAtTheAddress = "NoneAtTheAddress",
  /*
   * Devices have the address, but none they poll and none in a site they
   * look into: the host they see is another network's.
   */
  NoneInTheirSites = "NoneInTheirSites",
  /*
   * Where they look cannot be known, and the one device at the address is in
   * a site (WhenReachUnknown.OnlyDeviceInNoSite): a monitor is never counted
   * as one site's device's on a guess.
   */
  ReachUnknownDeviceInASite = "ReachUnknownDeviceInASite",
}

// Why the devices at the address cannot be told apart from where they look.
export enum AmbiguousAddressReason {
  // They poll more than one device at the address.
  PollSeveral = "PollSeveral",
  // More than one device at the address is in sites they look into.
  SeveralInTheirSites = "SeveralInTheirSites",
  /*
   * They poll no device and are no site's default probe, so where they look
   * cannot be known, and more than one device has the address.
   */
  ReachUnknown = "ReachUnknown",
}

export type DeviceSeenFrom<T> =
  | { kind: "device"; device: T; reason: SeenDeviceReason }
  // No device at the address is the host the probes see there.
  | { kind: "none"; reason: NoDeviceReason }
  /*
   * Devices at the address that cannot be told apart from where they look:
   * `devices` are the ones that fit the deciding step alike.
   */
  | { kind: "ambiguous"; devices: Array<T>; reason: AmbiguousAddressReason };

function none(reason: NoDeviceReason): {
  kind: "none";
  reason: NoDeviceReason;
} {
  return { kind: "none", reason: reason };
}

function ambiguous<T>(
  devices: Array<T>,
  reason: AmbiguousAddressReason,
): { kind: "ambiguous"; devices: Array<T>; reason: AmbiguousAddressReason } {
  return { kind: "ambiguous", devices: devices, reason: reason };
}

// The same device read twice (two spellings of one address) is one.
function eachDeviceOnce<T extends DeviceAtAddressLike>(
  devices: ReadonlyArray<T>,
): Array<T> {
  const seen: Set<string> = new Set<string>();
  const once: Array<T> = [];

  for (const device of devices) {
    const id: string = toIdKey(device.id);

    if (id && seen.has(id)) {
      continue;
    }

    if (id) {
      seen.add(id);
    }

    once.push(device);
  }

  return once;
}

/*
 * The device at an address (`candidates`, every device the project has
 * there) that the probes see, by the steps at the top of this file.
 */
export function pickDeviceSeenFrom<T extends DeviceAtAddressLike>(data: {
  candidates: ReadonlyArray<T>;
  reach: ProbeReach;
  whenReachUnknown: WhenReachUnknown;
}): DeviceSeenFrom<T> {
  const candidates: Array<T> = eachDeviceOnce(data.candidates);

  if (candidates.length === 0) {
    return none(NoDeviceReason.NoneAtTheAddress);
  }

  // 1. A device the probes poll is the host they reach at its address.
  const polled: Array<T> = candidates.filter((device: T): boolean => {
    const probeId: string = toIdKey(device.probeId);

    return Boolean(probeId) && data.reach.probeIds.has(probeId);
  });

  if (polled.length === 1) {
    return {
      kind: "device",
      device: polled[0]!,
      reason: SeenDeviceReason.PolledByTheProbes,
    };
  }

  if (polled.length > 1) {
    return ambiguous(polled, AmbiguousAddressReason.PollSeveral);
  }

  // 2. A device in a site the probes look into; 3. else none.
  if (data.reach.isKnown) {
    const inReach: Array<T> = candidates.filter((device: T): boolean => {
      return data.reach.siteKeys.has(getSiteKey(device.siteId));
    });

    if (inReach.length === 1) {
      return {
        kind: "device",
        device: inReach[0]!,
        reason: SeenDeviceReason.OnlyOneInTheirSites,
      };
    }

    return inReach.length > 1
      ? ambiguous(inReach, AmbiguousAddressReason.SeveralInTheirSites)
      : none(NoDeviceReason.NoneInTheirSites);
  }

  // Where the probes look cannot be known.
  if (candidates.length > 1) {
    return ambiguous(candidates, AmbiguousAddressReason.ReachUnknown);
  }

  const only: T = candidates[0]!;

  if (
    data.whenReachUnknown === WhenReachUnknown.OnlyDeviceInNoSite &&
    getSiteKey(only.siteId) !== NO_SITE_KEY
  ) {
    return none(NoDeviceReason.ReachUnknownDeviceInASite);
  }

  return {
    kind: "device",
    device: only,
    reason: SeenDeviceReason.OnlyOneAtTheAddress,
  };
}

/*
 * Whether `deviceId` is one of the devices the probes see at the address:
 * the one they pick, or one of those they cannot tell apart. A monitor that
 * sees another device there, or none, checks another network's host.
 */
export function isAmongDevicesSeen<T extends DeviceAtAddressLike>(data: {
  seen: DeviceSeenFrom<T>;
  deviceId: IdLike;
}): boolean {
  const deviceKey: string = toIdKey(data.deviceId);

  if (!deviceKey) {
    return false;
  }

  if (data.seen.kind === "device") {
    return toIdKey(data.seen.device.id) === deviceKey;
  }

  if (data.seen.kind === "ambiguous") {
    return data.seen.devices.some((device: T): boolean => {
      return toIdKey(device.id) === deviceKey;
    });
  }

  return false;
}

// The site keys of these devices, each once, for asking what probes reach.
export function getSiteKeysOf(
  devices: ReadonlyArray<DeviceAtAddressLike>,
): Array<string> {
  return Array.from(
    new Set<string>(
      devices.map((device: DeviceAtAddressLike): string => {
        return getSiteKey(device.siteId);
      }),
    ),
  );
}

/*
 * Whether the probes poll one of these devices themselves: then step 1
 * decides, with no need to ask where else they look.
 */
export function isDecidedByPolledDevice(data: {
  candidates: ReadonlyArray<DeviceAtAddressLike>;
  probeIds: ReadonlyArray<IdLike>;
}): boolean {
  const probeIds: Set<string> = getProbeIdKeys(data.probeIds);

  return data.candidates.some((device: DeviceAtAddressLike): boolean => {
    const probeId: string = toIdKey(device.probeId);

    return Boolean(probeId) && probeIds.has(probeId);
  });
}

// ---- The same facts, from every device and site of one project.

// A site as the reach reads it: its default probe, and the site above it.
export interface SiteForReach {
  id?: IdLike;
  probeId?: IdLike;
  parentSiteId?: IdLike;
}

/*
 * One project's devices and sites, filed for working out what any set of
 * probes reaches without reading them again.
 */
export interface ProbeReachIndex {
  // By probe: the site keys of the devices it polls.
  siteKeysPolledByProbe: Map<string, Set<string>>;
  // By probe: the sites that name it their own default probe.
  siteKeysWithProbeAsOwnDefault: Map<string, Set<string>>;
  // By site key: its default probe, its own or the nearest ancestor's.
  defaultProbeBySiteKey: Map<string, string>;
}

// How far up the sites above one are followed: a loop never runs forever.
const MAX_SITE_DEPTH: number = 64;

export function buildProbeReachIndex(data: {
  devices: ReadonlyArray<DeviceAtAddressLike>;
  sites: ReadonlyArray<SiteForReach>;
}): ProbeReachIndex {
  const siteKeysPolledByProbe: Map<string, Set<string>> = new Map();
  const siteKeysWithProbeAsOwnDefault: Map<string, Set<string>> = new Map();
  const defaultProbeBySiteKey: Map<string, string> = new Map();

  for (const device of data.devices) {
    const probeId: string = toIdKey(device.probeId);

    if (!probeId) {
      continue;
    }

    const siteKeys: Set<string> =
      siteKeysPolledByProbe.get(probeId) || new Set<string>();
    siteKeys.add(getSiteKey(device.siteId));
    siteKeysPolledByProbe.set(probeId, siteKeys);
  }

  const siteByKey: Map<string, SiteForReach> = new Map();

  for (const site of data.sites) {
    const siteKey: string = getSiteKey(site.id);

    if (siteKey) {
      siteByKey.set(siteKey, site);
    }

    const probeId: string = toIdKey(site.probeId);

    if (siteKey && probeId) {
      const siteKeys: Set<string> =
        siteKeysWithProbeAsOwnDefault.get(probeId) || new Set<string>();
      siteKeys.add(siteKey);
      siteKeysWithProbeAsOwnDefault.set(probeId, siteKeys);
    }
  }

  // As NetworkSiteService.resolveDefaultProbeIdForSite: nearest one up.
  for (const siteKey of siteByKey.keys()) {
    let current: SiteForReach | undefined = siteByKey.get(siteKey);
    const visited: Set<string> = new Set<string>();

    for (let depth: number = 0; current && depth < MAX_SITE_DEPTH; depth++) {
      const currentKey: string = getSiteKey(current.id);

      if (visited.has(currentKey)) {
        break;
      }

      visited.add(currentKey);

      const probeId: string = toIdKey(current.probeId);

      if (probeId) {
        defaultProbeBySiteKey.set(siteKey, probeId);
        break;
      }

      const parentKey: string = getSiteKey(current.parentSiteId);
      current = parentKey ? siteByKey.get(parentKey) : undefined;
    }
  }

  return {
    siteKeysPolledByProbe: siteKeysPolledByProbe,
    siteKeysWithProbeAsOwnDefault: siteKeysWithProbeAsOwnDefault,
    defaultProbeBySiteKey: defaultProbeBySiteKey,
  };
}

// What these probes reach, asked about these sites, from a project's index.
export function readProbeReachFacts(data: {
  index: ProbeReachIndex;
  probeIds: ReadonlyArray<IdLike>;
  siteKeys: ReadonlyArray<string>;
}): ProbeReachFacts {
  const probeIds: Set<string> = getProbeIdKeys(data.probeIds);
  const polledSiteKeys: Set<string> = new Set<string>();
  let isDefaultProbeOfASite: boolean = false;

  for (const probeId of probeIds) {
    for (const siteKey of data.index.siteKeysPolledByProbe.get(probeId) || []) {
      polledSiteKeys.add(siteKey);
    }

    if (
      (data.index.siteKeysWithProbeAsOwnDefault.get(probeId)?.size || 0) > 0
    ) {
      isDefaultProbeOfASite = true;
    }
  }

  const askedSiteKeys: Array<string> = Array.from(
    new Set<string>(data.siteKeys.map(getSiteKey)),
  ).filter((siteKey: string): boolean => {
    return siteKey !== NO_SITE_KEY;
  });

  return {
    probeIds: Array.from(probeIds),
    sites: askedSiteKeys.map(
      (
        siteKey: string,
      ): {
        siteKey: string;
        hasDevicePolled: boolean;
        hasProbeAsDefault: boolean;
      } => {
        const defaultProbeId: string =
          data.index.defaultProbeBySiteKey.get(siteKey) || "";

        return {
          siteKey: siteKey,
          hasDevicePolled: polledSiteKeys.has(siteKey),
          hasProbeAsDefault:
            Boolean(defaultProbeId) && probeIds.has(defaultProbeId),
        };
      },
    ),
    pollsDeviceInASite: Array.from(polledSiteKeys).some(
      (siteKey: string): boolean => {
        return siteKey !== NO_SITE_KEY;
      },
    ),
    pollsDeviceInNoSite: polledSiteKeys.has(NO_SITE_KEY),
    isDefaultProbeOfASite: isDefaultProbeOfASite,
  };
}
