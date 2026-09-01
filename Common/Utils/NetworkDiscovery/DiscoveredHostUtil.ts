import { DiscoveredNetworkDevice } from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { normalizeReverseDnsName } from "./ReverseDnsNameUtil";

/*
 * Normalisation for a scan's stored results, shared by every reader of the
 * `discoveredDevices` jsonb column: the dashboard's Review dialog and the
 * server-side auto-import rule engine. It moved here from the Dashboard's
 * DiscoveredHostFilter when the engine appeared, for the reason spelled out
 * on normalizeDiscoveredHosts below — a server that matched raw jsonb would
 * re-hit every landmine the dialog already fixed.
 */

/*
 * What a nullish or non-object entry in the jsonb reads as: nothing. Written
 * as a type guard so the normalisation below narrows properly.
 */
function isDiscoveredHostObject(
  host: unknown,
): host is DiscoveredNetworkDevice {
  return Boolean(host) && typeof host === "object";
}

/**
 * The scan's rows, cleaned up so every rule downstream sees the same thing.
 *
 * `discoveredDevices` is jsonb written verbatim from the probe's payload, and
 * the only guard on it checks that the VALUE is an array — never that its
 * elements are shaped like hosts. Everything downstream keys off `ipAddress`,
 * so three payload shapes that a probe should never send, but that nothing
 * stops it sending, each broke something:
 *
 *   - A `null` element. Every predicate dereferences the host, so one null row
 *     threw a TypeError the moment the operator clicked a filter button —
 *     inside the modal body, during render.
 *   - A non-string address. `10` is written into the selection record as the
 *     key "10" (object keys are strings) but matched out of the imported-set
 *     with `Set.has(10)`, which does not coerce — so the host imported and
 *     then could never be retired, and pressing Import again duplicated it.
 *   - The same address on two rows with different frozen `isAlreadyRegistered`
 *     values. One checkbox governs both rows, but only one of them refused to
 *     import, so whether a device already in the inventory got created a
 *     second time depended on which order the probe happened to list them in.
 *
 * A fourth was added with reverse DNS (issue #3529) and is not a probe bug at
 * all — `dnsHostname` is a value the SCANNED NETWORK chooses, so it is
 * untrusted by construction rather than by accident, and it is normalised
 * here for the same reason: one reading of the payload for every reader.
 *
 * All of them are fixed here rather than at each call site, so the row the
 * operator sees, the badge above it, the list Import walks, and the hosts an
 * auto-import rule evaluates can never be working from different readings of
 * the same payload.
 */
export function normalizeDiscoveredHosts(
  hosts: Array<DiscoveredNetworkDevice>,
): Array<DiscoveredNetworkDevice> {
  const cleaned: Array<DiscoveredNetworkDevice> = [];

  for (const host of hosts) {
    if (!isDiscoveredHostObject(host)) {
      continue;
    }

    /*
     * Trimmed as well as stringified: " " is not an address, but it is
     * truthy, so it used to pass selectability and import as a Network Device
     * whose hostname was a single space.
     */
    const normalized: DiscoveredNetworkDevice = {
      ...host,
      ipAddress:
        host.ipAddress === undefined || host.ipAddress === null
          ? ""
          : String(host.ipAddress).trim(),
    };

    /*
     * The PTR name gets the same treatment, for a sharper version of the same
     * reason (OneUptime issue #3529): unlike every other field here, its
     * value was chosen by whoever runs DNS for the scanned subnet — routinely
     * not this project — and it is stored verbatim in jsonb. So the rules
     * about what a name may contain are applied on the way OUT of the column
     * as well as on the way in, and anything that fails them is DELETED
     * rather than blanked, so a reader that checks `if (host.dnsHostname)`
     * and a reader that checks `"dnsHostname" in host` cannot disagree.
     */
    const dnsHostname: string | undefined = normalizeReverseDnsName(
      host.dnsHostname,
    );

    if (dnsHostname) {
      normalized.dnsHostname = dnsHostname;
    } else {
      delete normalized.dnsHostname;
    }

    cleaned.push(normalized);
  }

  // An address the scan reports as registered is registered on every row.
  const registeredIpAddresses: Set<string> = new Set<string>();

  for (const host of cleaned) {
    if (host.ipAddress && host.isAlreadyRegistered) {
      registeredIpAddresses.add(host.ipAddress);
    }
  }

  if (registeredIpAddresses.size === 0) {
    return cleaned;
  }

  return cleaned.map((host: DiscoveredNetworkDevice) => {
    if (
      host.isAlreadyRegistered ||
      !registeredIpAddresses.has(host.ipAddress)
    ) {
      return host;
    }

    return { ...host, isAlreadyRegistered: true };
  });
}
