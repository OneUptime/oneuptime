import { DiscoveredNetworkDevice } from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DiscoveredHostNaming,
  MAX_DEVICE_DNS_NAME_LENGTH,
  buildDeviceName,
  buildFallbackDeviceName,
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

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
}): Array<RunImportedDeviceRename> {
  // Condition (d) needs both ends of the run; without them, nothing.
  const runStartedAt: number | undefined = toEpochMilliseconds(
    data.runStartedAt,
  );

  const runCompletedAt: number | undefined = toEpochMilliseconds(
    data.runCompletedAt,
  );

  const projectId: string = trimmedString(data.projectId);

  if (
    runStartedAt === undefined ||
    runCompletedAt === undefined ||
    !projectId
  ) {
    return [];
  }

  const namedHosts: Map<string, DiscoveredNetworkDevice> =
    getNamedHostsByAddress(data.hosts, data.scan);

  if (namedHosts.size === 0) {
    return [];
  }

  const eligible: Array<{
    row: RunImportedDeviceRow;
    host: DiscoveredNetworkDevice;
    hostname: string;
    name: string;
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

    // (b) An address this result reports — and reports a name for, see (e).
    const hostname: string = trimmedString(row.hostname);
    const host: DiscoveredNetworkDevice | undefined = hostname
      ? namedHosts.get(hostname)
      : undefined;

    if (!host) {
      continue;
    }

    // (c) Still named by that bare address.
    const name: string = trimmedString(row.name);

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
      hostname: hostname,
      name: name,
      createdAt: createdAt,
    });
  }

  eligible.sort(
    (
      left: { createdAt: number; hostname: string; row: RunImportedDeviceRow },
      right: { createdAt: number; hostname: string; row: RunImportedDeviceRow },
    ): number => {
      if (left.createdAt !== right.createdAt) {
        return left.createdAt - right.createdAt;
      }

      if (left.hostname !== right.hostname) {
        return left.hostname < right.hostname ? -1 : 1;
      }

      return left.row.deviceId < right.row.deviceId ? -1 : 1;
    },
  );

  return eligible.map(
    (entry: {
      row: RunImportedDeviceRow;
      host: DiscoveredNetworkDevice;
      hostname: string;
      name: string;
    }): RunImportedDeviceRename => {
      /*
       * The same two names, from the same builder, that the import itself
       * would have tried — so a renamed device is indistinguishable from one
       * imported after the name was known, short-name choice included.
       */
      const candidateNames: Array<string> = [];

      for (const candidate of [
        buildDeviceName(entry.host, data.scan),
        buildFallbackDeviceName(entry.host, data.scan),
      ]) {
        const trimmed: string = candidate.trim();

        if (!trimmed || trimmed.toLowerCase() === entry.name.toLowerCase()) {
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

      const plan: RunImportedDeviceRename = {
        deviceId: trimmedString(entry.row.deviceId),
        hostname: entry.hostname,
        fromName: entry.name,
        candidateNames: candidateNames,
      };

      /*
       * Filled only, never overwritten: a device that already has a DNS name
       * got it from a PTR record (or from an operator), and a later answer is
       * not a reason to replace it. The rename happens either way.
       */
      if (!trimmedString(entry.row.dnsName)) {
        const dnsName: string | undefined = normalizeReverseDnsName(
          entry.host.dnsHostname,
        );

        if (dnsName) {
          plan.dnsName =
            dnsName.length > MAX_DEVICE_DNS_NAME_LENGTH
              ? dnsName.substring(0, MAX_DEVICE_DNS_NAME_LENGTH)
              : dnsName;
        }
      }

      return plan;
    },
  );
}
