/*
 * The address a person types for a vCenter, read the one way the server, the
 * dashboard and the probe all agree on.
 *
 * People paste what their browser shows - "vcsa.example.com",
 * "https://vcsa.example.com/ui/", "https://vcsa.example.com:443/sdk" - so
 * those are all accepted and written back as the one canonical
 * "https://host[:port]" the probe connects to (the probe appends /sdk itself).
 * Everything that would make the address mean something other than "this
 * vCenter" is refused with a sentence that says what to type instead:
 *
 *   - plain http: vCenter only serves its API over HTTPS, and a password is
 *     never sent unencrypted;
 *   - a user name or password in the address: they have fields of their own,
 *     and an address is shown to everyone who can see the vCenter;
 *   - a path, query or fragment other than vCenter's own /sdk or /ui;
 *   - loopback, unspecified and link-local hosts - the cloud metadata
 *     endpoint lives there - which no probe ever connects to.
 *
 * The last check reads the host as typed. The probe repeats it on every
 * address the host name resolves to (SSRFProtection), and pins its socket to
 * those addresses, so a name that resolves somewhere forbidden is refused too.
 *
 * Pure and isomorphic (WHATWG URL only), so the dashboard's form, the server's
 * save hook and the probe give the same answer.
 */

export const DEFAULT_VCENTER_HTTPS_PORT: number = 443;

export interface VCenterAddress {
  // https://host[:port] - the port only when it is not 443.
  url: string;
  // Lowercase host name, IPv4 address, or IPv6 address without brackets.
  host: string;
  port: number;
  isIpAddress: boolean;
}

export type VCenterAddressResult =
  | { address: VCenterAddress; error?: undefined }
  | { address?: undefined; error: string };

const SCHEME_PATTERN: RegExp = /^([a-z][a-z0-9+.-]*):\/\//i;
const WHITESPACE_PATTERN: RegExp = /\s/;
const IPV4_PATTERN: RegExp = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const TRAILING_SLASHES_PATTERN: RegExp = /\/+$/;

/*
 * The paths a browser shows for vCenter - its SDK and the vSphere Client - and
 * an empty one. Anything else is not vCenter's address.
 */
const ACCEPTED_PATHS: ReadonlyArray<string> = ["/", "/sdk", "/ui"];

/*
 * Host names that name this machine or a cloud metadata service. IP literals
 * are classified by range below; these are the names that reach the same
 * places without one.
 */
const FORBIDDEN_HOST_NAMES: ReadonlyArray<string> = [
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
];

const FORBIDDEN_IP_ADDRESSES: ReadonlyArray<string> = [
  // AWS IMDS over IPv6, and Alibaba Cloud's metadata service.
  "fd00:ec2::254",
  "100.100.100.200",
];

const INVALID_ADDRESS_MESSAGE: string =
  "Enter vCenter's address as you open it in a browser, such as https://vcsa.example.com.";

export default class VMwareVCenterAddress {
  public static normalize(
    input: string | null | undefined,
  ): VCenterAddressResult {
    const raw: string = (input || "").trim();

    if (!raw) {
      return {
        error:
          "Enter vCenter's address, such as vcsa.example.com or https://10.0.0.20.",
      };
    }

    if (WHITESPACE_PATTERN.test(raw)) {
      return { error: INVALID_ADDRESS_MESSAGE };
    }

    const schemeMatch: RegExpMatchArray | null = raw.match(SCHEME_PATTERN);
    const scheme: string | undefined = schemeMatch?.[1]?.toLowerCase();

    if (scheme === "http") {
      return {
        error:
          "Use https://. vCenter serves its API over HTTPS only, and OneUptime never sends a password unencrypted.",
      };
    }

    if (scheme && scheme !== "https") {
      return { error: INVALID_ADDRESS_MESSAGE };
    }

    const candidate: string = scheme
      ? raw
      : raw.startsWith("//")
        ? `https:${raw}`
        : `https://${raw}`;

    let parsed: globalThis.URL;
    try {
      parsed = new globalThis.URL(candidate);
    } catch {
      return { error: INVALID_ADDRESS_MESSAGE };
    }

    if (parsed.username || parsed.password || raw.includes("@")) {
      return {
        error:
          "Leave the user name and password out of the address. They have fields of their own.",
      };
    }

    if (raw.includes("?") || raw.includes("#")) {
      return { error: INVALID_ADDRESS_MESSAGE };
    }

    const path: string = parsed.pathname
      .replace(TRAILING_SLASHES_PATTERN, "")
      .toLowerCase();

    if (path && !ACCEPTED_PATHS.includes(path)) {
      return {
        error:
          "Enter only vCenter's address, without a path - such as https://vcsa.example.com.",
      };
    }

    let host: string = parsed.hostname.toLowerCase();

    if (host.startsWith("[") && host.endsWith("]")) {
      host = host.slice(1, -1);
    }

    // A trailing dot names the same host; keep one spelling of it.
    if (host.endsWith(".")) {
      host = host.slice(0, -1);
    }

    if (!host) {
      return { error: INVALID_ADDRESS_MESSAGE };
    }

    if (VMwareVCenterAddress.isForbiddenHost(host)) {
      return {
        error:
          "Loopback, link-local and cloud metadata addresses are never used. Enter vCenter's own host name or IP address.",
      };
    }

    const port: number = parsed.port
      ? Number.parseInt(parsed.port, 10)
      : DEFAULT_VCENTER_HTTPS_PORT;

    const isIpAddress: boolean = IPV4_PATTERN.test(host) || host.includes(":");
    const hostForUrl: string = host.includes(":") ? `[${host}]` : host;

    return {
      address: {
        url:
          port === DEFAULT_VCENTER_HTTPS_PORT
            ? `https://${hostForUrl}`
            : `https://${hostForUrl}:${port}`,
        host: host,
        port: port,
        isIpAddress: isIpAddress,
      },
    };
  }

  /*
   * "host:port" of a stored (normalized) address, or null when it is not one.
   * A saved password is bound to this: it is only ever sent to the host and
   * port it was entered for.
   */
  public static getEndpointKey(url: string | null | undefined): string | null {
    const result: VCenterAddressResult = VMwareVCenterAddress.normalize(url);

    if (!result.address) {
      return null;
    }

    return `${result.address.host}:${result.address.port}`;
  }

  /*
   * The name a new vCenter gets when nobody typed one: its host name, as
   * people know it from the browser's address bar.
   */
  public static getDefaultName(url: string | null | undefined): string | null {
    const result: VCenterAddressResult = VMwareVCenterAddress.normalize(url);

    if (!result.address) {
      return null;
    }

    return result.address.host;
  }

  public static isForbiddenHost(hostInput: string): boolean {
    let host: string = hostInput.trim().toLowerCase();

    if (host.startsWith("[") && host.endsWith("]")) {
      host = host.slice(1, -1);
    }

    if (host.endsWith(".")) {
      host = host.slice(0, -1);
    }

    if (!host) {
      return true;
    }

    if (FORBIDDEN_HOST_NAMES.includes(host) || host.endsWith(".localhost")) {
      return true;
    }

    if (FORBIDDEN_IP_ADDRESSES.includes(host)) {
      return true;
    }

    const ipv4: RegExpMatchArray | null = host.match(IPV4_PATTERN);

    if (ipv4) {
      return VMwareVCenterAddress.isForbiddenIpv4(
        ipv4.slice(1, 5).map((part: string): number => {
          return Number.parseInt(part, 10);
        }),
      );
    }

    if (host.includes(":")) {
      return VMwareVCenterAddress.isForbiddenIpv6(host);
    }

    return false;
  }

  private static isForbiddenIpv4(octets: Array<number>): boolean {
    const [a, b]: Array<number> = octets;

    // 0.0.0.0/8 (this network), 127.0.0.0/8 (loopback), 169.254.0.0/16 (link-local).
    return a === 0 || a === 127 || (a === 169 && b === 254);
  }

  private static isForbiddenIpv6(address: string): boolean {
    const lower: string = address.toLowerCase();

    if (lower === "::" || lower === "::1") {
      return true;
    }

    // fe80::/10 - link-local (fe80 to febf).
    const firstGroup: string = lower.split(":")[0] || "";

    if (firstGroup.length === 4 && firstGroup.startsWith("fe")) {
      const second: number = Number.parseInt(firstGroup.substring(2, 3), 16);

      if (second >= 8 && second <= 11) {
        return true;
      }
    }

    /*
     * An IPv4-mapped address (::ffff:a.b.c.d, which WHATWG writes as
     * ::ffff:xxxx:yyyy) reaches the IPv4 address it maps.
     */
    const mappedPrefix: string = "::ffff:";

    if (lower.startsWith(mappedPrefix)) {
      const rest: string = lower.substring(mappedPrefix.length);
      const dotted: RegExpMatchArray | null = rest.match(IPV4_PATTERN);

      if (dotted) {
        return VMwareVCenterAddress.isForbiddenIpv4(
          dotted.slice(1, 5).map((part: string): number => {
            return Number.parseInt(part, 10);
          }),
        );
      }

      const groups: Array<string> = rest.split(":");

      if (groups.length === 2) {
        const high: number = Number.parseInt(groups[0] || "", 16);
        const low: number = Number.parseInt(groups[1] || "", 16);

        if (Number.isFinite(high) && Number.isFinite(low)) {
          return VMwareVCenterAddress.isForbiddenIpv4([
            Math.floor(high / 256),
            high % 256,
            Math.floor(low / 256),
            low % 256,
          ]);
        }
      }
    }

    return false;
  }
}
