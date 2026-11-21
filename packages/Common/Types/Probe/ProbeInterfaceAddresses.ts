import NetworkAddressBlockUtil from "../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  SecurityAddressScope,
  getSecurityAddressScope,
} from "../../Utils/SecurityCase/SecurityConnectionMatch";

/*
 * THE ADDRESSES ON A PROBE'S OWN NETWORK INTERFACES (#10429).
 *
 * A probe polls its network devices over SNMP, sweeps the ranges its
 * discovery scans name and checks the hosts its monitors watch, and the
 * flows the project's routers export show that traffic coming from the
 * probe's own address on the network: a LAN address, which is not the
 * address OneUptime sees the probe check in from (Probe.egressIpAddress, its
 * NAT's). So every probe lists the addresses on its network interfaces when
 * it checks in (Probe/Jobs/Alive, the same interface listing packet capture
 * offers), whatever its capture setting, and OneUptime keeps them on the
 * probe (Probe.interfaceIpAddresses). Security Events reads them to know a
 * flow is the probe's own work (TelemetryScan/ProbeOwnTraffic), and the
 * blocklist never blocks them (SecurityBlocklist/SecurityProtectedAddresses).
 *
 * What is kept of a report, here so the probe and the server agree:
 *
 *   - addresses only, without the prefix length an interface lists
 *     ("10.0.0.5/24" is 10.0.0.5), written the one way blocks are
 *     (NetworkAddressBlockUtil.canonicalAddress);
 *   - none that is no address on a network: loopback, unspecified,
 *     link-local and multicast addresses (what getSecurityAddressScope calls
 *     Local). A link-local address is unique on one link only, so another
 *     host on another segment may hold it;
 *   - each once, sorted, so the same interfaces are the same text and an
 *     unchanged report writes nothing;
 *   - at most MAX_PROBE_INTERFACE_ADDRESSES of them.
 *
 * What a probe reports is its own word: anyone holding its key can say any
 * address. That is why Security Events never sets aside traffic only for
 * its address: the traffic must also be what the probe is set to do.
 */

// The field of the probe's check-in that lists them.
export const PROBE_INTERFACE_ADDRESSES_FIELD: string =
  "probeInterfaceAddresses";

// The most addresses one probe's report keeps.
export const MAX_PROBE_INTERFACE_ADDRESSES: number = 64;

// The most entries of a report read: a report of more is cut, never read whole.
export const MAX_PROBE_INTERFACE_ADDRESS_ENTRIES_READ: number = 1024;

// How the kept addresses are written in the column: comma and space between.
export const PROBE_INTERFACE_ADDRESS_SEPARATOR: string = ", ";

// One to three digits: how an interface writes a prefix length.
function isPrefixLength(text: string): boolean {
  if (text.length < 1 || text.length > 3) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 48 || code > 57) {
      return false;
    }
  }

  return true;
}

// One entry as the address it names, or null when it names none worth keeping.
function readEntry(entry: unknown): string | null {
  if (typeof entry !== "string") {
    return null;
  }

  const text: string = entry.trim();
  const slash: number = text.indexOf("/");
  const addressText: string = slash === -1 ? text : text.slice(0, slash);

  // A prefix length is one to three digits, and nothing else follows it.
  if (slash !== -1 && !isPrefixLength(text.slice(slash + 1))) {
    return null;
  }

  const address: string | null =
    NetworkAddressBlockUtil.canonicalAddress(addressText);

  if (!address) {
    return null;
  }

  const scope: SecurityAddressScope | null = getSecurityAddressScope(address);

  if (!scope || scope === SecurityAddressScope.Local) {
    return null;
  }

  return address;
}

// IPv4 before IPv6, then in address order: the same set is the same text.
function compareAddresses(a: string, b: string): number {
  const aIsIpv4: boolean = !a.includes(":");
  const bIsIpv4: boolean = !b.includes(":");

  if (aIsIpv4 !== bIsIpv4) {
    return aIsIpv4 ? -1 : 1;
  }

  if (aIsIpv4) {
    const aParts: Array<number> = a.split(".").map(Number);
    const bParts: Array<number> = b.split(".").map(Number);

    for (let index: number = 0; index < 4; index++) {
      const difference: number = (aParts[index] || 0) - (bParts[index] || 0);

      if (difference !== 0) {
        return difference;
      }
    }

    return 0;
  }

  return a < b ? -1 : a > b ? 1 : 0;
}

export default class ProbeInterfaceAddressesUtil {
  /*
   * What a check-in reports, as the addresses kept: see the header. Null
   * when the check-in reports nothing - no field, or one that is no list -
   * which leaves what is kept as it is: a probe older than this report says
   * nothing, and is not taken to have no address. An empty list is a report
   * of no address worth keeping.
   */
  public static read(value: unknown): Array<string> | null {
    if (!Array.isArray(value)) {
      return null;
    }

    const kept: Set<string> = new Set();

    for (const entry of (value as Array<unknown>).slice(
      0,
      MAX_PROBE_INTERFACE_ADDRESS_ENTRIES_READ,
    )) {
      const address: string | null = readEntry(entry);

      if (address) {
        kept.add(address);
      }
    }

    return Array.from(kept)
      .sort(compareAddresses)
      .slice(0, MAX_PROBE_INTERFACE_ADDRESSES);
  }

  // The kept addresses as the column holds them.
  public static toText(addresses: ReadonlyArray<string>): string {
    return addresses.join(PROBE_INTERFACE_ADDRESS_SEPARATOR);
  }

  /*
   * The column's text as addresses: each entry read again the way a report
   * is, so a value written by hand or by an older release keeps only real
   * addresses.
   */
  public static fromText(text: string | null | undefined): Array<string> {
    if (!text) {
      return [];
    }

    return ProbeInterfaceAddressesUtil.read(text.split(",")) || [];
  }
}
