import { DiscoveredNetworkDevice } from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DEVICE_NAME_SOURCES_BEST_FIRST,
  DeviceNameSource,
  getDeviceNameSourceRank,
  isBetterDeviceNameSource,
  readDeviceNameSource,
} from "../../Types/NetworkDevice/DeviceNameSource";
import { isDeviceStillNamedByDiscovery } from "../NetworkDevice/DeviceNameRule";
import {
  DiscoveredHostNaming,
  MAX_DEVICE_DNS_NAME_LENGTH,
  buildDeviceName,
  buildFallbackDeviceName,
  getDiscoveredHostNameSource,
} from "./DiscoveredDeviceBuilder";
import { normalizeDiscoveredHosts } from "./DiscoveredHostUtil";
import { normalizeReverseDnsName } from "./ReverseDnsNameUtil";
import {
  MAX_DISCOVERED_HOST_ADDRESS_LENGTH,
  toEpochMilliseconds,
} from "./RunImportedDeviceNaming";

/*
 * Improving the names discovery gave devices, when a later scan finds a
 * better one (OneUptime issue #4518).
 *
 * WHY. Discovery names a device by the best name it can find — its own name,
 * then its DNS name, then its address (Utils/NetworkDevice/DeviceNameRule.ts)
 * — but a scan does not always find the best one the first time. A Windows
 * host's NetBIOS reply is lost, or its scan ran before the lookup was turned
 * on; a partial snapshot of a running sweep carries no names at all; a host
 * gets an SNMP agent a month after it was imported by address. Each of those
 * devices would keep the worse name forever, while the Review dialog showed
 * the better one beside it.
 *
 * WHAT IS RENAMED. A device is renamed only when ALL of these hold:
 *
 *   (a) It belongs to the scan's project — checked here as well as in the
 *       engine's query, because a rename across a tenant boundary is the one
 *       mistake this must never make.
 *   (b) Its hostname is an address this result reports, so the result is
 *       talking about the host the device is.
 *   (c) It is still called exactly the name discovery gave it
 *       (isDeviceStillNamedByDiscovery): a readable discoveredNameSource, and
 *       a name equal to discoveredName, case included. Any rename by a
 *       person — or by the Shorten Names to Hostname action — breaks that,
 *       and the name is theirs from then on. Devices imported before #4518
 *       carry no source and are never touched here.
 *   (d) The result names the host from a strictly BETTER source than the one
 *       the device's name came from. A name is improved, never merely
 *       changed: a device keeps its name when its DNS record changes, and a
 *       NetBIOS reply that arrives one scan and is lost the next cannot make
 *       its name flap.
 *
 * WHAT A RENAME IS. The name a fresh import of this host would get — the same
 * builder, under the scan's naming choice — or the import's address-suffixed
 * fallback when another device already has that name, or nothing when both
 * are taken (the engine decides, against the rest of the project). The new
 * name's source and the name itself are recorded, so the device stays
 * discovery-named and can be improved again; its DNS Name is filled in when
 * it has none.
 *
 * Pure, like RunImportedDeviceNaming, so every condition is tested without a
 * database; the rule engine does the reads, the collision checks and the
 * writes (NetworkDeviceAutoImportRuleEngineService).
 */

/*
 * The sources a device's name can be improved FROM: every source but the
 * best, since nothing ranks above a device's SNMP name. The engine asks only
 * for devices named from these, so an estate of SNMP-named devices costs the
 * rename pass no rows at all.
 */
export const IMPROVABLE_DEVICE_NAME_SOURCES: ReadonlyArray<DeviceNameSource> =
  DEVICE_NAME_SOURCES_BEST_FIRST.slice(1);

/*
 * The device columns the plan reads. Every field is re-checked at runtime,
 * because a row read with a narrower select arrives with fields undefined, and
 * undefined must read as "do not rename", never as a match.
 */
export interface DiscoveredNameDeviceRow {
  deviceId: string;
  projectId?: string | null | undefined;
  name?: string | null | undefined;
  hostname?: string | null | undefined;
  dnsName?: string | null | undefined;
  discoveredName?: string | null | undefined;
  discoveredNameSource?: string | null | undefined;
  // Only orders the plans: the device imported first keeps the plain name.
  createdAt?: Date | string | null | undefined;
}

export interface DiscoveredNameUpgrade {
  deviceId: string;
  // The device's address, which is also the host's.
  hostname: string;
  // The device's current name — the one discovery gave it.
  fromName: string;
  // Where that name came from.
  fromSource: DeviceNameSource;
  /*
   * The names to try, in order: the name a fresh import would give the host,
   * then the address-suffixed fallback. The engine takes the first one no
   * OTHER device already holds — the device's own current name never counts
   * against it, so a name that only changes case is still free.
   */
  candidateNames: Array<string>;
  // Where the new name comes from; recorded with it.
  discoveredNameSource: DeviceNameSource;
  /*
   * The PTR name to store as the device's DNS Name. Present only when the
   * device has none and the host has a usable one, as at import.
   */
  dnsName?: string | undefined;
}

interface BestNamedHost {
  host: DiscoveredNetworkDevice;
  source: DeviceNameSource;
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Each address in a result, with the row that names it best.
 *
 * Read through normalizeDiscoveredHosts, the same reading of the jsonb every
 * other reader uses. When an address is on more than one row (normal: see
 * the import engine), the row whose name comes from the best source wins, and
 * the first such row on a tie — so a row the NetBIOS lookup missed cannot
 * shadow one it answered for. Accepts `unknown`: "not an array" means "no
 * hosts", never a throw inside a worker.
 */
export function getBestNamedHostsByAddress(
  hosts: unknown,
): Map<string, BestNamedHost> {
  const best: Map<string, BestNamedHost> = new Map<string, BestNamedHost>();

  if (!Array.isArray(hosts)) {
    return best;
  }

  for (const host of normalizeDiscoveredHosts(
    hosts as Array<DiscoveredNetworkDevice>,
  )) {
    const address: string = host.ipAddress;

    if (!address || address.length > MAX_DISCOVERED_HOST_ADDRESS_LENGTH) {
      continue;
    }

    const source: DeviceNameSource | undefined =
      getDiscoveredHostNameSource(host);

    if (!source) {
      continue;
    }

    const current: BestNamedHost | undefined = best.get(address);

    if (
      !current ||
      getDeviceNameSourceRank(source) > getDeviceNameSourceRank(current.source)
    ) {
      best.set(address, { host: host, source: source });
    }
  }

  return best;
}

/**
 * The addresses whose devices this result could improve: those it names
 * from anything better than an address. The engine looks devices up by these.
 */
export function getImprovableHostAddresses(hosts: unknown): Array<string> {
  const addresses: Array<string> = [];

  for (const [address, named] of getBestNamedHostsByAddress(hosts)) {
    if (named.source !== DeviceNameSource.Address) {
      addresses.push(address);
    }
  }

  return addresses;
}

/**
 * The renames one result calls for, in a deterministic order: oldest device
 * first (then by address, then by id), so when two devices would take the
 * same name, the one imported first gets the plain name.
 *
 * Plans only — the collision checks against the rest of the project need the
 * database. See DiscoveredNameUpgrade.candidateNames.
 */
export function planDiscoveredNameUpgrades(data: {
  projectId: string;
  hosts: unknown;
  devices: Array<DiscoveredNameDeviceRow>;
  scan: DiscoveredHostNaming;
}): Array<DiscoveredNameUpgrade> {
  const projectId: string = trimmedString(data.projectId);

  if (!projectId || !Array.isArray(data.devices)) {
    return [];
  }

  const bestHosts: Map<string, BestNamedHost> = getBestNamedHostsByAddress(
    data.hosts,
  );

  if (bestHosts.size === 0) {
    return [];
  }

  const eligible: Array<{
    plan: DiscoveredNameUpgrade;
    createdAt: number;
  }> = [];

  const seenDeviceIds: Set<string> = new Set<string>();

  for (const row of data.devices) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const deviceId: string = trimmedString(row.deviceId);

    // One plan per device, however many times a caller's reads returned it.
    if (!deviceId || seenDeviceIds.has(deviceId)) {
      continue;
    }

    // (a) The scan's project, and only the scan's project.
    if (trimmedString(row.projectId) !== projectId) {
      continue;
    }

    // (b) An address this result reports.
    const hostname: string = trimmedString(row.hostname);
    const named: BestNamedHost | undefined = hostname
      ? bestHosts.get(hostname)
      : undefined;

    if (!named) {
      continue;
    }

    // (c) Still called exactly what discovery named it.
    if (!isDeviceStillNamedByDiscovery(row)) {
      continue;
    }

    const fromSource: DeviceNameSource = readDeviceNameSource(
      row.discoveredNameSource,
    )!;

    // (d) A strictly better source.
    if (!isBetterDeviceNameSource(named.source, fromSource)) {
      continue;
    }

    const candidateNames: Array<string> = [];

    for (const candidate of [
      buildDeviceName(named.host, data.scan),
      buildFallbackDeviceName(named.host, data.scan),
    ]) {
      const trimmed: string = candidate.trim();

      if (!trimmed) {
        continue;
      }

      const alreadyListed: boolean = candidateNames.some(
        (listed: string): boolean => {
          return listed.toLowerCase() === trimmed.toLowerCase();
        },
      );

      if (!alreadyListed) {
        candidateNames.push(trimmed);
      }
    }

    if (candidateNames.length === 0) {
      continue;
    }

    seenDeviceIds.add(deviceId);

    const plan: DiscoveredNameUpgrade = {
      deviceId: deviceId,
      hostname: hostname,
      fromName: trimmedString(row.name),
      fromSource: fromSource,
      candidateNames: candidateNames,
      discoveredNameSource: named.source,
    };

    /*
     * Filled only, never overwritten: a device that already has a DNS name
     * got it from a PTR record or from a person, and a later answer is not a
     * reason to replace it.
     */
    if (!trimmedString(row.dnsName)) {
      const dnsName: string | undefined = normalizeReverseDnsName(
        named.host.dnsHostname,
      );

      if (dnsName) {
        plan.dnsName =
          dnsName.length > MAX_DEVICE_DNS_NAME_LENGTH
            ? dnsName.substring(0, MAX_DEVICE_DNS_NAME_LENGTH)
            : dnsName;
      }
    }

    eligible.push({
      plan: plan,
      // A row without a readable date sorts after every dated one.
      createdAt: toEpochMilliseconds(row.createdAt) ?? Number.MAX_SAFE_INTEGER,
    });
  }

  eligible.sort(
    (
      left: { plan: DiscoveredNameUpgrade; createdAt: number },
      right: { plan: DiscoveredNameUpgrade; createdAt: number },
    ): number => {
      if (left.createdAt !== right.createdAt) {
        return left.createdAt - right.createdAt;
      }

      if (left.plan.hostname !== right.plan.hostname) {
        return left.plan.hostname < right.plan.hostname ? -1 : 1;
      }

      return left.plan.deviceId < right.plan.deviceId ? -1 : 1;
    },
  );

  return eligible.map(
    (entry: { plan: DiscoveredNameUpgrade }): DiscoveredNameUpgrade => {
      return entry.plan;
    },
  );
}
