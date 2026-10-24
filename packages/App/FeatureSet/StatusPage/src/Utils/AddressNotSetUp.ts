/*
 * What the status page app says when nothing is set up at the address it was
 * opened at.
 *
 * OneUptime serves its own pages - sign-up, the dashboard - only at the
 * address in HOST. Every other address is taken for a status page's custom
 * domain, so it reaches this app, which asks the API for the status page with
 * that domain. When there is none, the page used to say "Status Page ID not
 * found" and nothing else. That is what a newcomer saw when they opened a new
 * install at the server's IP address while HOST was still localhost, or at a
 * name their proxy rewrote - the commonest way a self-hosted install failed
 * (issues #1425, #2418, #1291, #2195, #2376, #853, #1659).
 *
 * So it says which of these it is, and what to do:
 *
 *   - NotHost: a self-hosted OneUptime opened at an address other than HOST.
 *     Set HOST to it (the line to copy), or open OneUptime where it is set
 *     up. HOST is no secret: every page's env.js carries it.
 *   - ProxyRewroteHost: the address opened IS HOST, yet the request reached
 *     the server under another host name - which only a proxy in front of
 *     OneUptime that does not pass the Host header on can do.
 *   - NoStatusPage: OneUptime Cloud, where nobody visiting can change HOST:
 *     only that no status page has this domain.
 *
 * And, when the address is a domain name (an IP address or localhost cannot
 * be one), how a status page's custom domain gets there.
 *
 * React-free, so the server, the tests and the app can all read it.
 */

export enum AddressNotSetUpKind {
  NotHost = "not-host",
  ProxyRewroteHost = "proxy-rewrote-host",
  NoStatusPage = "no-status-page",
}

export interface AddressNotSetUpInput {
  // The address the page was opened at, with its port: window.location.host.
  visitedHost: string;
  // HOST, as the app's env.js carries it.
  configuredHost: string;
  // HTTP_PROTOCOL, as the app's env.js carries it.
  configuredProtocol: string;
  // A self-hosted OneUptime (billing off), whose operator can change HOST.
  isSelfHosted: boolean;
}

export interface AddressNotSetUpFacts {
  kind: AddressNotSetUpKind;
  visitedHost: string;
  configuredHost: string;
  // The line that makes the opened address OneUptime's own: HOST=<it>.
  hostLine: string;
  /*
   * Where OneUptime opens, as a link, when another computer can open it:
   * never for localhost, which is the reader's own computer.
   */
  configuredUrl: string | null;
  /*
   * Whether the opened address can be a status page's custom domain: a
   * domain name, and not OneUptime's own address.
   */
  canBeStatusPageDomain: boolean;
  /*
   * Whether that is the likelier reason it is here, so the page says it
   * first: a domain name opened on an install whose HOST is a real address
   * of its own (a second name is more often a status page's than a new
   * HOST). With HOST still localhost, setting HOST comes first.
   */
  isStatusPageDomainLikelier: boolean;
}

// The lines a proxy needs to pass the Host header on, by proxy.
export const PASS_HOST_HEADER_LINES: ReadonlyArray<{
  proxy: string;
  line: string;
}> = [
  { proxy: "Nginx", line: "proxy_set_header Host $host;" },
  { proxy: "Apache", line: "ProxyPreserveHost On" },
];

const LOOPBACK_HOSTNAMES: ReadonlyArray<string> = [
  "localhost",
  "127.0.0.1",
  "[::1]",
];

const IPV4_ADDRESS: RegExp = /^\d{1,3}(\.\d{1,3}){3}$/;
const PORT_SUFFIX: RegExp = /:\d+$/;

// A host without its port: "example.com:8080" -> "example.com", "[::1]:80" -> "[::1]".
export const hostnameOf: (host: string) => string = (host: string): string => {
  const text: string = host.trim().toLowerCase();

  if (text.startsWith("[")) {
    const end: number = text.indexOf("]");

    return end === -1 ? text : text.slice(0, end + 1);
  }

  // An IPv6 address without brackets has no port to take off.
  if (text.indexOf(":") !== text.lastIndexOf(":")) {
    return text;
  }

  return text.replace(PORT_SUFFIX, "");
};

export const isLoopbackHost: (host: string) => boolean = (
  host: string,
): boolean => {
  return LOOPBACK_HOSTNAMES.includes(hostnameOf(host));
};

export const isIpAddressHost: (host: string) => boolean = (
  host: string,
): boolean => {
  const hostname: string = hostnameOf(host);

  return IPV4_ADDRESS.test(hostname) || hostname.includes(":");
};

export const getAddressNotSetUpFacts: (
  input: AddressNotSetUpInput,
) => AddressNotSetUpFacts = (
  input: AddressNotSetUpInput,
): AddressNotSetUpFacts => {
  const visitedHost: string = input.visitedHost.trim();
  const configuredHost: string = input.configuredHost.trim();
  const protocol: string =
    input.configuredProtocol.trim() === "https" ? "https" : "http";

  let kind: AddressNotSetUpKind = AddressNotSetUpKind.NoStatusPage;

  if (input.isSelfHosted) {
    const isConfiguredHost: boolean =
      configuredHost.length > 0 &&
      visitedHost.toLowerCase() === configuredHost.toLowerCase();

    kind = isConfiguredHost
      ? AddressNotSetUpKind.ProxyRewroteHost
      : AddressNotSetUpKind.NotHost;
  }

  const configuredUrl: string | null =
    configuredHost && !isLoopbackHost(configuredHost)
      ? `${protocol}://${configuredHost}`
      : null;
  const canBeStatusPageDomain: boolean =
    kind !== AddressNotSetUpKind.ProxyRewroteHost &&
    Boolean(visitedHost) &&
    !isLoopbackHost(visitedHost) &&
    !isIpAddressHost(visitedHost);

  return {
    kind: kind,
    visitedHost: visitedHost,
    configuredHost: configuredHost,
    hostLine: `HOST=${visitedHost}`,
    configuredUrl: configuredUrl,
    canBeStatusPageDomain: canBeStatusPageDomain,
    isStatusPageDomainLikelier:
      canBeStatusPageDomain &&
      (kind === AddressNotSetUpKind.NoStatusPage || configuredUrl !== null),
  };
};

/*
 * Thrown by the master page when the API answers that no status page has the
 * domain the page was opened at - an answer, unlike a request that failed.
 */
export class AddressNotSetUpError extends Error {
  public constructor() {
    super("No status page has the domain this page was opened at.");
    this.name = "AddressNotSetUpError";
    // instanceof holds whatever the build targets.
    Object.setPrototypeOf(this, AddressNotSetUpError.prototype);
  }
}
