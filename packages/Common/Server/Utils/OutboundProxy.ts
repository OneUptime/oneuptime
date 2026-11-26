/*
 * THE OUTBOUND PROXY A REQUEST GOES THROUGH (issue #8932).
 *
 * Axios sends every request of the server through the proxy the
 * environment names - <scheme>_proxy (HTTPS_PROXY for an https URL,
 * HTTP_PROXY for an http one), or ALL_PROXY, in lower or upper case, the
 * lower one first - apart from the hosts NO_PROXY names. Node's own http
 * client reads none of them, so a request sent with it (external calendars,
 * MCP servers, backups, OIDC) never used a proxy, and on a server that
 * reaches the internet only through one, each failed.
 *
 * getProxyFor gives axios's answer for any URL, so a request sent with
 * Node's client goes through the proxy, or not, exactly as one sent with
 * axios would. Axios reads the variables in two steps, and so does this:
 *
 *   1. proxy-from-env's getProxyForUrl: the proxy for the URL's scheme or
 *      ALL_PROXY (a value without a scheme takes the URL's), unless NO_PROXY
 *      names the host: "*", the host itself, ".example.com" or
 *      "*example.com" for what ends so, each with an optional ":port";
 *   2. axios's own reading of NO_PROXY (lib/helpers/shouldBypassProxy.js),
 *      which also skips the proxy for an address in a CIDR range
 *      ("10.0.0.0/8", "fd00::/8"), an IPv6 address with or without
 *      brackets, an IPv4 address written as IPv6 (::ffff:10.0.0.5), a name
 *      with a trailing dot, an IPv4 address written in shorthand, octal or
 *      hex, and any loopback address for a loopback entry ("localhost").
 *
 * OutboundProxyParity.test.ts runs axios's own code over every kind of
 * entry and URL and holds this to its answers, so an axios upgrade that
 * reads them differently fails there.
 */

const DEFAULT_PORTS: Record<string, number> = {
  http: 80,
  https: 443,
  ws: 80,
  wss: 443,
  ftp: 21,
  gopher: 70,
};

// The parts of an IPv4 address, as a URL parser reads them.
const HEX_PART: RegExp = /^0[xX][0-9a-fA-F]+$/;
const OCTAL_PART: RegExp = /^0[0-7]+$/;
const LEADING_ZERO_DECIMAL_PART: RegExp = /^0[0-9]+$/;
const DECIMAL_PART: RegExp = /^[0-9]+$/;
const IPV4_SHAPED: RegExp = /^[0-9.xXa-fA-F]+$/;
const DIGITS: RegExp = /^\d+$/;
const DOTTED_OCTET: RegExp = /^(?:0|[1-9]\d{0,2})$/;

// The groups of an IPv6 address.
const ZERO_GROUP: RegExp = /^0{1,4}$/;
const ZEROS: RegExp = /^0+$/;
const ONE_GROUP: RegExp = /^0*1$/;
const HEX_GROUP: RegExp = /^[0-9a-f]{1,4}$/i;

const IPV4_MAPPED_LOOPBACK_DOTTED: RegExp = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;
const IPV4_MAPPED_LOOPBACK_HEX: RegExp =
  /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;
const IPV4_MAPPED_DOTTED: RegExp =
  /^(?:::|(?:0{1,4}:){1,4}:|(?:0{1,4}:){5})ffff:(\d+\.\d+\.\d+\.\d+)$/i;
const IPV4_MAPPED_HEX: RegExp =
  /^(?:::|(?:0{1,4}:){1,4}:|(?:0{1,4}:){5})ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;

// NO_PROXY's entries.
const CIDR_ENTRY: RegExp = /^(.+)\/(0|[1-9]\d{0,2})$/;
const ENTRY_WITH_PORT: RegExp = /^(.+):(\d+)$/;
const WILDCARD_ENTRY: RegExp = /^[.*]/;
const PROXY_FROM_ENV_SEPARATORS: RegExp = /[,\s]/;
const AXIOS_SEPARATORS: RegExp = /[\s,]+/;

// The value of a variable, read as proxy-from-env reads it: lower case first.
function readVariable(name: string): string {
  return (
    process.env[name.toLowerCase()] || process.env[name.toUpperCase()] || ""
  );
}

function trimTrailingDots(value: string): string {
  let end: number = value.length;

  while (end > 0 && value.charAt(end - 1) === ".") {
    end--;
  }

  return value.slice(0, end);
}

/*
 * One part of an IPv4 address as a URL parser reads it: 0x for hex, a
 * leading 0 for octal, decimal otherwise. Null for anything else, a decimal
 * with a leading zero included ("08").
 */
function readIpv4Part(text: string): number | null {
  let value: number | null = null;

  if (HEX_PART.test(text)) {
    value = parseInt(text.slice(2), 16);
  } else if (text.length > 1 && OCTAL_PART.test(text)) {
    value = parseInt(text, 8);
  } else if (text.length > 1 && LEADING_ZERO_DECIMAL_PART.test(text)) {
    return null;
  } else if (DECIMAL_PART.test(text)) {
    value = parseInt(text, 10);
  }

  return value !== null && Number.isFinite(value) ? value : null;
}

function isOctet(value: number | null): boolean {
  return value !== null && value >= 0 && value <= 255;
}

/*
 * An IPv4 address in shorthand, octal or hex ("127.1", "0177.0.0.1",
 * "0x7f.0.0.1") as the dotted address it is; anything else as given. Two to
 * four parts: one part alone is left as given, as axios leaves it.
 */
function normalizeIpv4(host: string): string {
  if (!host || host.includes(":")) {
    return host;
  }

  let text: string = host;

  if (text.startsWith("[") && text.endsWith("]")) {
    text = text.slice(1, -1);
  }

  text = trimTrailingDots(text);

  if (!IPV4_SHAPED.test(text)) {
    return host;
  }

  const parts: Array<string> = text.split(".");

  if (
    parts.some((part: string): boolean => {
      return part === "";
    })
  ) {
    return host;
  }

  if (parts.length === 4) {
    const octets: Array<number | null> = parts.map(readIpv4Part);

    return octets.every(isOctet) ? octets.join(".") : host;
  }

  if (parts.length === 1 || parts.length > 4) {
    return host;
  }

  // The last part fills the octets the others leave, from the right.
  const leading: Array<number | null> = parts.slice(0, -1).map(readIpv4Part);
  const slots: number = 4 - leading.length;
  const last: number | null = readIpv4Part(parts[parts.length - 1]!);

  if (last === null || last < 0 || last > Math.pow(256, slots) - 1) {
    return host;
  }

  if (!leading.every(isOctet)) {
    return host;
  }

  const filled: Array<number> = [];
  let rest: number = last;

  for (let slot: number = 0; slot < slots; slot++) {
    filled.unshift(rest % 256);
    rest = Math.floor(rest / 256);
  }

  return [...(leading as Array<number>), ...filled].join(".");
}

function isIpv4Loopback(host: string): boolean {
  const parts: Array<string> = host.split(".");

  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((part: string): boolean => {
      return DIGITS.test(part) && Number(part) <= 255;
    })
  );
}

function isZeroGroup(group: string): boolean {
  return ZERO_GROUP.test(group);
}

function isIpv6Unspecified(host: string): boolean {
  if (host === "::") {
    return true;
  }

  const gap: number = host.indexOf("::");

  if (gap !== -1) {
    if (gap !== host.lastIndexOf("::")) {
      return false;
    }

    const before: string = host.slice(0, gap);
    const after: string = host.slice(gap + 2);
    const left: Array<string> = before ? before.split(":") : [];
    const right: Array<string> = after ? after.split(":") : [];

    return (
      left.length + right.length < 8 &&
      left.every(isZeroGroup) &&
      right.every(isZeroGroup)
    );
  }

  const groups: Array<string> = host.split(":");

  return groups.length === 8 && groups.every(isZeroGroup);
}

function isIpv6Loopback(host: string): boolean {
  if (host === "::1") {
    return true;
  }

  const mappedDotted: RegExpMatchArray | null = host.match(
    IPV4_MAPPED_LOOPBACK_DOTTED,
  );

  if (mappedDotted) {
    return isIpv4Loopback(mappedDotted[1]!);
  }

  const mappedHex: RegExpMatchArray | null = host.match(
    IPV4_MAPPED_LOOPBACK_HEX,
  );

  if (mappedHex) {
    const high: number = parseInt(mappedHex[1]!, 16);
    return high >= 0x7f00 && high <= 0x7fff;
  }

  const groups: Array<string> = host.split(":");

  return (
    groups.length === 8 &&
    groups.slice(0, 7).every((group: string): boolean => {
      return ZEROS.test(group);
    }) &&
    ONE_GROUP.test(groups[7]!)
  );
}

// This machine, by any name or address: an entry for one is an entry for all.
function isLoopback(host: string): boolean {
  if (!host) {
    return false;
  }

  return (
    host === "localhost" ||
    host === "0.0.0.0" ||
    isIpv4Loopback(host) ||
    isIpv6Unspecified(host) ||
    isIpv6Loopback(host)
  );
}

// An IPv4 address written as IPv6 (::ffff:10.0.0.5) as that IPv4 address.
function unmapIpv4(host: string): string {
  if (!host.includes(":")) {
    return host;
  }

  const dotted: RegExpMatchArray | null = host.match(IPV4_MAPPED_DOTTED);

  if (dotted) {
    return dotted[1]!;
  }

  const hex: RegExpMatchArray | null = host.match(IPV4_MAPPED_HEX);

  if (hex) {
    const high: number = parseInt(hex[1]!, 16);
    const low: number = parseInt(hex[2]!, 16);

    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
  }

  return host;
}

// A host name or an entry's host, as NO_PROXY compares them.
function normalizeHost(value: string): string {
  if (!value) {
    return value;
  }

  let host: string = value;

  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }

  const trimmed: string = trimTrailingDots(host);
  const ipv4: string = normalizeIpv4(trimmed);

  return ipv4 !== trimmed ? ipv4 : unmapIpv4(trimmed);
}

function ipv4ToBytes(host: string): Array<number> | null {
  const parts: Array<string> = host.split(".");

  return parts.length === 4 &&
    parts.every((part: string): boolean => {
      return DOTTED_OCTET.test(part) && Number(part) <= 255;
    })
    ? parts.map(Number)
    : null;
}

function ipv6ToBytes(host: string): Array<number> | null {
  const halves: Array<string> = host.split("::");

  if (halves.length > 2) {
    return null;
  }

  const groups: Array<string> = halves[0] ? halves[0].split(":") : [];

  if (halves.length === 2) {
    const rear: Array<string> = halves[1] ? halves[1].split(":") : [];
    const missing: number = 8 - groups.length - rear.length;

    if (missing < 1) {
      return null;
    }

    groups.push(...new Array<string>(missing).fill("0"), ...rear);
  }

  if (
    groups.length !== 8 ||
    groups.some((group: string): boolean => {
      return !HEX_GROUP.test(group);
    })
  ) {
    return null;
  }

  return groups.flatMap((group: string): Array<number> => {
    const value: number = parseInt(group, 16);
    return [(value >> 8) & 0xff, value & 0xff];
  });
}

function ipToBytes(host: string): Array<number> | null {
  if (!host) {
    return null;
  }

  return host.includes(":") ? ipv6ToBytes(host) : ipv4ToBytes(host);
}

interface CidrRange {
  bytes: Array<number>;
  prefix: number;
}

/*
 * The range a CIDR entry names, null for one that names none, and undefined
 * for an entry that is no CIDR at all (it has no "/").
 */
function readCidr(entry: string): CidrRange | null | undefined {
  if (!entry.includes("/")) {
    return undefined;
  }

  const match: RegExpExecArray | null = CIDR_ENTRY.exec(entry);

  if (!match) {
    return null;
  }

  let base: string = match[1]!;
  let prefix: number = Number(match[2]);
  const startsBracket: boolean = base.startsWith("[");
  const endsBracket: boolean = base.endsWith("]");

  if (startsBracket || endsBracket) {
    if (!startsBracket || !endsBracket) {
      return null;
    }

    base = base.slice(1, -1);

    if (!base.includes(":") || base.includes("[") || base.includes("]")) {
      return null;
    }
  } else if (base.includes("[") || base.includes("]")) {
    return null;
  }

  if (!base || base.endsWith(".")) {
    return null;
  }

  const wasIpv6: boolean = base.includes(":");

  if (wasIpv6) {
    try {
      base = new URL(`http://[${base}]/`).hostname.slice(1, -1);
    } catch {
      return null;
    }
  } else {
    base = normalizeIpv4(base);

    if (!ipv4ToBytes(base)) {
      return null;
    }
  }

  base = unmapIpv4(base);

  // An IPv4-mapped range (::ffff:10.0.0.0/104) is the IPv4 range it maps.
  if (wasIpv6 && !base.includes(":")) {
    if (prefix < 96) {
      return null;
    }

    prefix -= 96;
  }

  const bytes: Array<number> | null = ipToBytes(base);

  if (!bytes || prefix > bytes.length * 8) {
    return null;
  }

  return { bytes, prefix };
}

function isInRange(address: Array<number>, range: CidrRange): boolean {
  const wholeBytes: number = range.prefix >> 3;

  for (let index: number = 0; index < wholeBytes; index++) {
    if (address[index] !== range.bytes[index]) {
      return false;
    }
  }

  const remainingBits: number = range.prefix & 7;

  if (remainingBits) {
    const mask: number = (0xff << (8 - remainingBits)) & 0xff;

    if ((address[wholeBytes]! & mask) !== (range.bytes[wholeBytes]! & mask)) {
      return false;
    }
  }

  return true;
}

// An entry's host and port: "host:8080" and "[::1]:8080" carry one.
function readEntry(entry: string): [string, number] {
  if (entry.startsWith("[")) {
    const close: number = entry.indexOf("]");

    if (close !== -1) {
      const rest: string = entry.slice(close + 1);
      const port: number =
        rest.startsWith(":") && DIGITS.test(rest.slice(1))
          ? parseInt(rest.slice(1), 10)
          : 0;

      return [entry.slice(1, close), port];
    }
  }

  const first: number = entry.indexOf(":");
  const last: number = entry.lastIndexOf(":");

  if (first !== -1 && first === last && DIGITS.test(entry.slice(last + 1))) {
    return [entry.slice(0, last), parseInt(entry.slice(last + 1), 10)];
  }

  return [entry, 0];
}

export default class OutboundProxy {
  /*
   * The proxy a request to `url` goes through, as axios picks it from the
   * environment, or null to connect directly: no proxy is set for its
   * scheme, NO_PROXY names its host, or it is not an http or https URL.
   * Throws, as axios does, when the variable holds no URL at all.
   */
  public static getProxyFor(url: URL): URL | null {
    const scheme: string = url.protocol.replace(/:$/, "").toLowerCase();

    if (scheme !== "http" && scheme !== "https") {
      return null;
    }

    const port: number =
      Number.parseInt(url.port, 10) || DEFAULT_PORTS[scheme] || 0;

    if (OutboundProxy.isNamedByProxyFromEnv(url.hostname, port)) {
      return null;
    }

    let proxy: string =
      readVariable(`${scheme}_proxy`) || readVariable("all_proxy");

    if (!proxy) {
      return null;
    }

    if (!proxy.includes("://")) {
      proxy = `${scheme}://${proxy}`;
    }

    if (OutboundProxy.isNamedByAxios(url, port)) {
      return null;
    }

    return new URL(proxy);
  }

  /*
   * Whether `noProxy` - a NO_PROXY value; the environment's when left out -
   * names the URL's host, so that a request to it goes directly whatever
   * proxy is set. Both readings getProxyFor makes are applied, proxy-from-
   * env's and axios's own, so an entry means here what it means to every
   * other request of the server.
   *
   * For a client that picks its proxy by a rule of its own and honors
   * NO_PROXY as axios does: the synthetic runtime's egress proxy sends a
   * monitor's browser through the one proxy it was always sent through,
   * apart from the hosts NO_PROXY names.
   */
  public static isNamedByNoProxy(
    url: URL,
    noProxy?: string | undefined,
  ): boolean {
    const scheme: string = url.protocol.replace(/:$/, "").toLowerCase();
    const port: number =
      Number.parseInt(url.port, 10) || DEFAULT_PORTS[scheme] || 0;

    return (
      OutboundProxy.isNamedByProxyFromEnv(url.hostname, port, noProxy) ||
      OutboundProxy.isNamedByAxios(url, port, noProxy)
    );
  }

  /*
   * Whether NO_PROXY names the host as proxy-from-env reads it. `hostname`
   * is the URL's, an IPv6 address in its brackets. `value` stands in for
   * the environment's NO_PROXY when given.
   */
  private static isNamedByProxyFromEnv(
    hostname: string,
    port: number,
    value?: string | undefined,
  ): boolean {
    const noProxy: string = (value ?? readVariable("no_proxy")).toLowerCase();

    if (!noProxy) {
      return false;
    }

    if (noProxy === "*") {
      return true;
    }

    return !noProxy
      .split(PROXY_FROM_ENV_SEPARATORS)
      .every((entry: string): boolean => {
        if (!entry) {
          return true;
        }

        const withPort: RegExpMatchArray | null = entry.match(ENTRY_WITH_PORT);
        let entryHost: string = withPort ? withPort[1]! : entry;
        const entryPort: number = withPort ? parseInt(withPort[2]!, 10) : 0;

        if (entryPort && entryPort !== port) {
          return true;
        }

        if (!WILDCARD_ENTRY.test(entryHost)) {
          return hostname !== entryHost;
        }

        if (entryHost.startsWith("*")) {
          entryHost = entryHost.slice(1);
        }

        return !hostname.endsWith(entryHost);
      });
  }

  /*
   * Whether NO_PROXY names the URL's host as axios reads it on its own.
   * `value` stands in for the environment's NO_PROXY when given.
   */
  private static isNamedByAxios(
    url: URL,
    port: number,
    value?: string | undefined,
  ): boolean {
    const noProxy: string = (
      value ??
      (process.env["no_proxy"] || process.env["NO_PROXY"] || "")
    ).toLowerCase();

    if (!noProxy) {
      return false;
    }

    if (noProxy === "*") {
      return true;
    }

    const hostname: string = normalizeHost(url.hostname.toLowerCase());
    const hostnameBytes: Array<number> | null = ipToBytes(hostname);

    return noProxy.split(AXIOS_SEPARATORS).some((entry: string): boolean => {
      if (!entry) {
        return false;
      }

      if (entry === "*") {
        return true;
      }

      const range: CidrRange | null | undefined = readCidr(entry);

      if (range !== undefined) {
        return (
          range !== null &&
          hostnameBytes !== null &&
          hostnameBytes.length === range.bytes.length &&
          isInRange(hostnameBytes, range)
        );
      }

      const [writtenHost, entryPort] = readEntry(entry);
      let entryHost: string = normalizeHost(writtenHost);

      if (!entryHost) {
        return false;
      }

      if (entryPort && entryPort !== port) {
        return false;
      }

      if (entryHost.startsWith("*")) {
        entryHost = entryHost.slice(1);
      }

      if (entryHost.startsWith(".")) {
        return hostname.endsWith(entryHost);
      }

      return (
        hostname === entryHost ||
        (isLoopback(hostname) && isLoopback(entryHost))
      );
    });
  }
}
