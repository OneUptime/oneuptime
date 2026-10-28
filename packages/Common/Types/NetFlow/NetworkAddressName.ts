/*
 * WHAT AN ADDRESS IS CALLED on the Traffic pages (issue #5340).
 *
 * The pages count traffic by address. An address the project knows
 * something about is shown by its name first - "mumbai-fs01", "Payroll
 * SaaS" - with the address beside it, still there for people who think in
 * addresses. Where a name comes from, the first source that has one wins:
 *
 *   1. A name someone gave this exact address (Network > Settings >
 *      Address Names): the most deliberate thing anyone said about it.
 *   2. The project's own inventory, a record that holds the address: a
 *      network device (the address it is polled at, or one of its Other
 *      Addresses), a host (the addresses its agent reports), a cloud
 *      resource (the addresses its cloud lists), a Kubernetes node or pod.
 *      Records the project keeps itself come first, the ones it reads from
 *      elsewhere after them, and a pod - whose address goes to the next pod
 *      within minutes - last. A record names traffic of a time it was there.
 *   3. DNS: the name the address had when its flows arrived, as the probe
 *      that received them looked it up on the network it sits in - and only
 *      when that name points back to the address, so a stale or forged
 *      reverse record names nothing.
 *
 * A name someone gave a SUBNET is not the address's name: "Mumbai office"
 * says where an address is, for all of its addresses at once. It is shown
 * beside the address, never in place of a name.
 *
 * Pure and shared: the server that resolves names, the dashboard that draws
 * them and the tests read the order here.
 */

export enum NetworkAddressNameSource {
  AddressName = "address-name",
  NetworkDevice = "network-device",
  Host = "host",
  CloudResource = "cloud-resource",
  KubernetesNode = "kubernetes-node",
  KubernetesPod = "kubernetes-pod",
  Dns = "dns",
}

// The order names are picked in: the first source that names an address wins.
export const NETWORK_ADDRESS_NAME_SOURCES: ReadonlyArray<NetworkAddressNameSource> =
  [
    NetworkAddressNameSource.AddressName,
    NetworkAddressNameSource.NetworkDevice,
    NetworkAddressNameSource.Host,
    NetworkAddressNameSource.CloudResource,
    NetworkAddressNameSource.KubernetesNode,
    NetworkAddressNameSource.KubernetesPod,
    NetworkAddressNameSource.Dns,
  ];

// The longest name a page shows (an Address Name's own limit, and DNS's 253 cut to it).
export const MAX_NETWORK_ADDRESS_NAME_LENGTH: number = 100;

/*
 * The most addresses one page asks names for: its top lists, both ends of
 * its conversations, its filters and the exporters that are no device yet
 * come to well under this. Anything past it is shown by address.
 */
export const MAX_NAMED_ADDRESSES_PER_PAGE: number = 200;

// One thing that could name an address.
export interface NetworkAddressNameCandidate {
  source: NetworkAddressNameSource;
  name: string;
  // The record the name is, for a link: a device's, a host's, a cloud resource's ID.
  resourceId?: string | undefined;
}

// What a page knows about one address.
export interface NetworkTrafficAddressName {
  // What to call it. Absent when only a subnet it is in has a name.
  name?: string | undefined;
  source?: NetworkAddressNameSource | undefined;
  // The record the name is (a network device, a host, a cloud resource).
  resourceId?: string | undefined;
  // The most specific subnet someone named that holds the address.
  subnetName?: string | undefined;
  // That subnet, as written canonically: "10.18.167.0/24".
  subnet?: string | undefined;
}

// A page's names, by address (each address as the page's rows write it).
export type NetworkTrafficAddressNames = Record<
  string,
  NetworkTrafficAddressName
>;

function sourceRank(source: NetworkAddressNameSource): number {
  const rank: number = NETWORK_ADDRESS_NAME_SOURCES.indexOf(source);
  return rank === -1 ? NETWORK_ADDRESS_NAME_SOURCES.length : rank;
}

/*
 * Control characters (C0, DEL, C1), and the marks that turn text around or
 * hide in it (zero-width ones, bidi embeddings, overrides and isolates):
 * none belongs in a name drawn on one line.
 */
function isUnwantedCharacter(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

export class NetworkAddressNameUtil {
  /*
   * The candidate that names an address: the first by source, and between
   * two of one source (two hosts report the address) the one whose name
   * sorts first, so the same page always says the same thing.
   */
  public static pick(
    candidates: ReadonlyArray<NetworkAddressNameCandidate>,
  ): NetworkAddressNameCandidate | null {
    let best: NetworkAddressNameCandidate | null = null;

    for (const candidate of candidates) {
      if (!candidate || !candidate.name) {
        continue;
      }

      if (!best) {
        best = candidate;
        continue;
      }

      const byRank: number =
        sourceRank(candidate.source) - sourceRank(best.source);

      if (
        byRank < 0 ||
        (byRank === 0 &&
          candidate.name.localeCompare(best.name, "en", {
            sensitivity: "base",
          }) < 0)
      ) {
        best = candidate;
      }
    }

    return best;
  }

  /*
   * A name as a page may show it: one line, trimmed, runs of white space
   * as one space, nothing that is not text, at most
   * MAX_NETWORK_ADDRESS_NAME_LENGTH characters. Null when nothing is left -
   * the address is shown instead.
   */
  public static cleanName(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }

    let cleaned: string = "";
    let pendingSpace: boolean = false;

    for (const character of value) {
      const code: number = character.codePointAt(0) || 0;

      if (
        character === " " ||
        character === "\t" ||
        character === "\n" ||
        character === "\r" ||
        code === 0xa0
      ) {
        pendingSpace = cleaned.length > 0;
        continue;
      }

      if (isUnwantedCharacter(code)) {
        continue;
      }

      if (pendingSpace) {
        cleaned += " ";
        pendingSpace = false;
      }

      cleaned += character;
    }

    if (!cleaned) {
      return null;
    }

    const characters: Array<string> = Array.from(cleaned);

    return characters.length > MAX_NETWORK_ADDRESS_NAME_LENGTH
      ? characters.slice(0, MAX_NETWORK_ADDRESS_NAME_LENGTH).join("").trim()
      : cleaned;
  }

  // Whether a page's names say anything about an address (a name or a subnet).
  public static isKnown(
    name: NetworkTrafficAddressName | undefined | null,
  ): boolean {
    return Boolean(name && (name.name || name.subnetName));
  }
}
