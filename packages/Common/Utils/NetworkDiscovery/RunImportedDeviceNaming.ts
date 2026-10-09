import { DiscoveredNetworkDevice } from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DeviceNameSource,
  readDeviceNameSource,
} from "../../Types/NetworkDevice/DeviceNameSource";
import {
  DiscoveredHostNaming,
  MAX_DEVICE_DNS_NAME_LENGTH,
  buildDeviceName,
  buildFallbackDeviceName,
  getDiscoveredHostNameSource,
} from "./DiscoveredDeviceBuilder";
import { normalizeDiscoveredHosts } from "./DiscoveredHostUtil";
import { normalizeReverseDnsName } from "./ReverseDnsNameUtil";

/*
 * Naming the devices a discovery run imported BEFORE it knew their names
 * (part of OneUptime issue #3677, "hosts show up only as raw IP").
 *
 * WHY THIS EXISTS. A discovery sweep reports incrementally: the probe uploads
 * what it has found every 30 seconds while it is still sweeping, and the
 * auto-import worker imports from those partial snapshots within a minute of
 * them landing (issue #3599). But reverse DNS runs ONCE, after the sweep —
 * so a partial snapshot never carries a `dnsHostname`, and a host with no
 * SNMP sysName (a ping-only host, or one whose community string was wrong) is
 * imported from it named by its bare address. The Review dialog has the same
 * gap: an operator who imports while the scan is still running gets the same
 * address-named devices.
 *
 * When the run's final, Completed result arrives, it DOES carry the PTR names.
 * Nothing used them: the import engine skips every host whose address is
 * already registered, by design, so the device that was imported ten minutes
 * earlier as "10.18.166.51" stayed "10.18.166.51" forever, while the Review
 * dialog showed "kds01.wbhq.com" beside it.
 *
 * This module decides which devices to rename after that final result, and
 * to what. It is pure so every condition below is tested without a database;
 * the rule engine (NetworkDeviceAutoImportRuleEngineService) does the reads,
 * the server-side collision checks and the writes.
 *
 * A device is renamed only when ALL of these hold, and each one guards a way
 * of renaming something nobody asked to have renamed:
 *
 *   (a) It belongs to the scan's project. The engine's query already says so;
 *       it is checked again here because a rename across a tenant boundary is
 *       the one mistake this must never make, whatever a future caller passes.
 *   (b) Its hostname is an address this result reports. The address is the
 *       device's identity (see DiscoveredDeviceBuilder on `hostname`), so this
 *       is what ties the device to the host whose name is being applied.
 *   (c) It is still named by that bare address — its name, trimmed and without
 *       case, IS its hostname. A device an operator renamed, or one that was
 *       imported with a sysName or PTR name, is not touched.
 *   (d) It was created during THIS run: `startedAt <= createdAt <= completedAt`.
 *       This is what keeps the fix from mass-renaming an estate on upgrade.
 *       Plenty of long-standing devices are named by their address on
 *       purpose, or were imported before reverse DNS existed at all, and a
 *       project that had lived with those names for a year would otherwise
 *       find them all renamed by the first scan after the upgrade — silently,
 *       on the one path nobody reviews. Only a device the run itself could
 *       have created mid-sweep is fair game. No `startedAt`, no renames.
 *
 *       The upper bound matters as much as the lower one. The same Completed
 *       result can be processed more than once — saving an auto-import rule
 *       re-arms recent scans, and a capped import resumes on later ticks — and
 *       a device created AFTER the run finished (added by hand as its address,
 *       or deleted and re-added) was never this run's partial import. Without
 *       the bound, a re-armed result would rename it. No `completedAt`, no
 *       renames either.
 *   (e) The host now HAS a name: the name the builder gives it under the
 *       scan's naming choice is something other than the address. A result
 *       with no sysName and no usable PTR record names the host by its address
 *       again, and "renaming" a device to its own name is nothing to do. The
 *       name is whatever buildDeviceName decides, never a source list of this
 *       module's own, so any name the builder learns to read — one the probe
 *       also resolves only after the sweep included — is applied here too.
 *
 * What is left over is, precisely, a device this run imported by address
 * because the name had not been resolved yet — which is the device the
 * operator would have got had the import waited for the final result.
 *
 * SINCE ISSUE #4518 this is the fallback for devices that do not say how
 * they were named. A device discovery imports now records the source of its
 * name (NetworkDevice.discoveredNameSource), and those devices are improved
 * by DiscoveredNameUpgrade.ts — on any later scan, not only the run that
 * imported them, and whenever a better source names them, not only when they
 * were named by address. A row that carries a source is therefore skipped
 * here; what remains is a device imported by an older dashboard or engine
 * mid-run, which this keeps renaming exactly as before. The rename records
 * the source of the new name, so such a device is an ordinary
 * discovery-named one from then on.
 */

/*
 * The longest address worth looking up. The address becomes the device's
 * varchar(100) hostname, so a longer "address" can never match a device and
 * is junk — the same ceiling the import engine refuses such rows at.
 */
export const MAX_DISCOVERED_HOST_ADDRESS_LENGTH: number = 100;

/*
 * The device columns the plan reads. The engine maps its NetworkDevice rows
 * onto this; every field is re-checked at runtime anyway, because a row read
 * with a narrower select arrives with fields undefined, and undefined must
 * read as "do not rename", never as a match.
 */
export interface RunImportedDeviceRow {
  deviceId: string;
  projectId?: string | null | undefined;
  name?: string | null | undefined;
  hostname?: string | null | undefined;
  dnsName?: string | null | undefined;
  createdAt?: Date | string | null | undefined;
  /*
   * Where the device's name came from, when discovery recorded it (#4518).
   * A row with a readable source belongs to DiscoveredNameUpgrade.ts.
   */
  discoveredNameSource?: string | null | undefined;
}

export interface RunImportedDeviceRename {
  deviceId: string;
  // The device's address, which is also the host's.
  hostname: string;
  // The device's current name — its address, give or take case/whitespace.
  fromName: string;
  /*
   * The names to try, in order: the name the device would have been created
   * under had the import waited for this result, then the address-suffixed
   * collision fallback the import itself would retry with. The caller takes
   * the first one no other device already holds, and skips the device when
   * both are taken — exactly the import's own collision protocol.
   */
  candidateNames: Array<string>;
  /*
   * Where the new name comes from — what the builder would have recorded at
   * create. Stored with whichever candidate is taken, so the device can be
   * improved by a later scan like any device discovery named.
   */
  discoveredNameSource?: DeviceNameSource | undefined;
  /*
   * The PTR name to store as the device's dnsName. Present only when the
   * device has none and the host has a usable one: the same value the builder
   * would have set at create, and never an overwrite of a name already there.
   */
  dnsName?: string | undefined;
}

/*
 * A Date, or a date string out of a row, as epoch milliseconds — or undefined
 * when it is neither. Undefined never compares as "after the run started", so
 * a junk timestamp leaves the device alone.
 */
export function toEpochMilliseconds(value: unknown): number | undefined {
  if (value instanceof Date) {
    const time: number = value.getTime();
    return Number.isNaN(time) ? undefined : time;
  }

  if (typeof value === "string" && value.trim()) {
    const time: number = new Date(value.trim()).getTime();
    return Number.isNaN(time) ? undefined : time;
  }

  return undefined;
}

/*
 * A row's text field, trimmed, or "" for anything that is not text — which is
 * how both rename planners (this one and DiscoveredNameUpgrade.ts) read every
 * field of a device row and every id they are handed.
 */
export function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The names a rename of the device at `host`'s address tries, in order: the
 * name a fresh import of the host would get under the scan's naming choice,
 * then the import's own address-suffixed collision fallback — the same two
 * names, from the same builder, that the import itself tries, so a renamed
 * device is indistinguishable from one imported after the name was known,
 * short-name choice included.
 *
 * Trimmed, blanks dropped, each listed once whatever its case. `exceptName`,
 * when given, is left out as well (compared without case): the device's own
 * current name, for a planner to which a rename that changes only the case is
 * no rename at all.
 */
export function buildRenameCandidateNames(data: {
  host: DiscoveredNetworkDevice;
  scan: DiscoveredHostNaming;
  exceptName?: string | undefined;
}): Array<string> {
  const candidateNames: Array<string> = [];
  const exceptName: string = readTrimmedString(data.exceptName).toLowerCase();

  for (const candidate of [
    buildDeviceName(data.host, data.scan),
    buildFallbackDeviceName(data.host, data.scan),
  ]) {
    const trimmed: string = candidate.trim();

    if (!trimmed || (exceptName && trimmed.toLowerCase() === exceptName)) {
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

  return candidateNames;
}

/**
 * The PTR name a rename stores as the device's DNS Name — the value the
 * builder sets at create, clamped the same way — or undefined when the
 * device already has a DNS Name or the host has no usable PTR name.
 *
 * Filled only, never overwritten: a device that already has a DNS name got it
 * from a PTR record or from a person, and a later answer is not a reason to
 * replace it. The rename happens either way.
 */
export function getDnsNameToFill(
  currentDnsName: unknown,
  host: DiscoveredNetworkDevice,
): string | undefined {
  if (readTrimmedString(currentDnsName)) {
    return undefined;
  }

  const dnsName: string | undefined = normalizeReverseDnsName(host.dnsHostname);

  if (!dnsName) {
    return undefined;
  }

  return dnsName.length > MAX_DEVICE_DNS_NAME_LENGTH
    ? dnsName.substring(0, MAX_DEVICE_DNS_NAME_LENGTH)
    : dnsName;
}

/*
 * The fields renames are ordered by. `createdAt` is epoch milliseconds.
 */
export interface RenameOrderKey {
  createdAt: number;
  hostname: string;
  deviceId: string;
}

/**
 * The order both planners hand their renames over in: oldest device first,
 * then by address, then by id. When two devices would take the same name,
 * the one imported first gets the plain name, and the outcome never depends
 * on the order the database returned the rows in.
 */
export function compareRenameOrder(
  left: RenameOrderKey,
  right: RenameOrderKey,
): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt;
  }

  if (left.hostname !== right.hostname) {
    return left.hostname < right.hostname ? -1 : 1;
  }

  if (left.deviceId !== right.deviceId) {
    return left.deviceId < right.deviceId ? -1 : 1;
  }

  return 0;
}

/**
 * The hosts in a scan result that have a NAME, keyed by address.
 *
 * Read through normalizeDiscoveredHosts — the same reading of the jsonb the
 * Review dialog and the import engine use — so null rows, numeric addresses,
 * non-string sysNames and unusable PTR names are dealt with once, the same
 * way. Accepts `unknown` because the value is the jsonb column as stored, and
 * "not an array" has to mean "no hosts" rather than a throw inside a worker.
 *
 * When an address is listed on more than one row, the FIRST row that names it
 * wins. Duplicate rows are normal (see the import engine), and a row without
 * a name must not shadow a later row with one.
 */
export function getNamedHostsByAddress(
  hosts: unknown,
  scan: DiscoveredHostNaming,
): Map<string, DiscoveredNetworkDevice> {
  const namedHosts: Map<string, DiscoveredNetworkDevice> = new Map<
    string,
    DiscoveredNetworkDevice
  >();

  if (!Array.isArray(hosts)) {
    return namedHosts;
  }

  const normalized: Array<DiscoveredNetworkDevice> = normalizeDiscoveredHosts(
    hosts as Array<DiscoveredNetworkDevice>,
  );

  for (const host of normalized) {
    const address: string = host.ipAddress;

    if (!address || address.length > MAX_DISCOVERED_HOST_ADDRESS_LENGTH) {
      continue;
    }

    if (namedHosts.has(address)) {
      continue;
    }

    // Condition (e): the host is called something other than its address.
    const name: string = buildDeviceName(host, scan).trim();

    if (!name || name.toLowerCase() === address.toLowerCase()) {
      continue;
    }

    namedHosts.set(address, host);
  }

  return namedHosts;
}

/**
 * The renames one Completed result calls for, in a deterministic order:
 * oldest device first (then by address, then by id), so when two devices
 * would take the same name, the one imported first keeps the plain name and
 * the outcome does not depend on the order the database returned rows in.
 *
 * Plans only — no collision checks against the rest of the project, which
 * need the database. See RunImportedDeviceRename.candidateNames.
 */
export function planRunImportedDeviceRenames(data: {
  projectId: string;
  hosts: unknown;
  devices: Array<RunImportedDeviceRow>;
  scan: DiscoveredHostNaming;
  runStartedAt: Date | string | null | undefined;
  runCompletedAt: Date | string | null | undefined;
  /*
   * getNamedHostsByAddress(hosts, scan), when the caller has already read it
   * — the engine reads it once for its device lookup, and reading a large
   * result again here would name every host twice. `hosts` is not read when
   * this is given.
   */
  namedHosts?: Map<string, DiscoveredNetworkDevice> | undefined;
}): Array<RunImportedDeviceRename> {
  // Condition (d) needs both ends of the run; without them, nothing.
  const runStartedAt: number | undefined = toEpochMilliseconds(
    data.runStartedAt,
  );

  const runCompletedAt: number | undefined = toEpochMilliseconds(
    data.runCompletedAt,
  );

  const projectId: string = readTrimmedString(data.projectId);

  if (
    runStartedAt === undefined ||
    runCompletedAt === undefined ||
    !projectId ||
    !Array.isArray(data.devices)
  ) {
    return [];
  }

  const namedHosts: Map<string, DiscoveredNetworkDevice> =
    data.namedHosts ?? getNamedHostsByAddress(data.hosts, data.scan);

  if (namedHosts.size === 0) {
    return [];
  }

  const eligible: Array<{
    row: RunImportedDeviceRow;
    host: DiscoveredNetworkDevice;
    deviceId: string;
    hostname: string;
    name: string;
    createdAt: number;
  }> = [];

  const seenDeviceIds: Set<string> = new Set<string>();

  for (const row of data.devices) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const deviceId: string = readTrimmedString(row.deviceId);

    // One plan per device, however many times a caller's reads returned it.
    if (!deviceId || seenDeviceIds.has(deviceId)) {
      continue;
    }

    // (a) The scan's project, and only the scan's project.
    if (readTrimmedString(row.projectId) !== projectId) {
      continue;
    }

    /*
     * A device that records how discovery named it is improved by
     * DiscoveredNameUpgrade.ts, under its own rules; renaming it here too
     * would plan the same device twice.
     */
    if (readDeviceNameSource(row.discoveredNameSource)) {
      continue;
    }

    // (b) An address this result reports — and reports a name for, see (e).
    const hostname: string = readTrimmedString(row.hostname);
    const host: DiscoveredNetworkDevice | undefined = hostname
      ? namedHosts.get(hostname)
      : undefined;

    if (!host) {
      continue;
    }

    // (c) Still named by that bare address.
    const name: string = readTrimmedString(row.name);

    if (!name || name.toLowerCase() !== hostname.toLowerCase()) {
      continue;
    }

    /*
     * (d) Created during this run. Equal counts at both ends: the claim stamps
     * startedAt and the final upload stamps completedAt, and a device created
     * in the same millisecond as either is still this run's.
     */
    const createdAt: number | undefined = toEpochMilliseconds(row.createdAt);

    if (
      createdAt === undefined ||
      createdAt < runStartedAt ||
      createdAt > runCompletedAt
    ) {
      continue;
    }

    seenDeviceIds.add(deviceId);
    eligible.push({
      row: row,
      host: host,
      deviceId: deviceId,
      hostname: hostname,
      name: name,
      createdAt: createdAt,
    });
  }

  eligible.sort(compareRenameOrder);

  return eligible.map(
    (entry: {
      row: RunImportedDeviceRow;
      host: DiscoveredNetworkDevice;
      deviceId: string;
      hostname: string;
      name: string;
    }): RunImportedDeviceRename => {
      const plan: RunImportedDeviceRename = {
        deviceId: entry.deviceId,
        hostname: entry.hostname,
        fromName: entry.name,
        // Its current name is its address: never a name to rename it to.
        candidateNames: buildRenameCandidateNames({
          host: entry.host,
          scan: data.scan,
          exceptName: entry.name,
        }),
      };

      const discoveredNameSource: DeviceNameSource | undefined =
        getDiscoveredHostNameSource(entry.host);

      if (discoveredNameSource) {
        plan.discoveredNameSource = discoveredNameSource;
      }

      const dnsName: string | undefined = getDnsNameToFill(
        entry.row.dnsName,
        entry.host,
      );

      if (dnsName) {
        plan.dnsName = dnsName;
      }

      return plan;
    },
  );
}
