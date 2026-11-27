import XcpNgConnectionType from "../../Types/XcpNg/XcpNgConnectionType";
import { withoutTrailingSlashes } from "../TrailingRuns";
import VMwareVCenterAddress from "../VMware/VMwareVCenterAddress";

/*
 * The address a person types for an XCP-ng connection - Xen Orchestra's, or
 * a pool master's - read the one way the server, the dashboard and the
 * probe all agree on. The rules a vCenter's address is held to
 * (VMwareVCenterAddress), in the words of what is being connected:
 *
 *   - what a browser shows is accepted and written back as the canonical
 *     "https://host[:port]": "xo.example.com", "https://xo.example.com/v6/",
 *     "https://xo.example.com/#/home" (Xen Orchestra 5's own pages),
 *     "https://10.0.0.10/jsonrpc";
 *   - plain http is refused: OneUptime never sends a secret unencrypted. The
 *     XCP-ng Agent may read a lab's Xen Orchestra over http; a probe does
 *     not;
 *   - a user name or password in the address, a query, or any other path is
 *     refused, with what to type instead;
 *   - loopback, unspecified and link-local hosts - the cloud metadata
 *     endpoint lives there - are refused, here as the host is typed, and by
 *     the probe again on every address the name resolves to.
 *
 * Pure and isomorphic (WHATWG URL only).
 */

export const DEFAULT_XCP_NG_HTTPS_PORT: number = 443;

export interface XcpNgAddress {
  // https://host[:port] - the port only when it is not 443.
  url: string;
  // Lowercase host name, IPv4 address, or IPv6 address without brackets.
  host: string;
  port: number;
  isIpAddress: boolean;
}

export type XcpNgAddressResult =
  | { address: XcpNgAddress; error?: undefined }
  | { address?: undefined; error: string };

const SCHEME_PATTERN: RegExp = /^([a-z][a-z0-9+.-]*):\/\//i;
const WHITESPACE_PATTERN: RegExp = /\s/;
const IPV4_PATTERN: RegExp = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/*
 * The paths a browser or an API client shows for each, and an empty one.
 * Xen Orchestra: its two web interfaces, the plugin's endpoint and the REST
 * API. XAPI: its JSON-RPC endpoint.
 */
const ACCEPTED_PATHS: Record<XcpNgConnectionType, ReadonlyArray<string>> = {
  [XcpNgConnectionType.XenOrchestra]: [
    "/",
    "/v5",
    "/v6",
    "/openmetrics",
    "/openmetrics/metrics",
    "/rest/v0",
  ],
  [XcpNgConnectionType.Xapi]: ["/", "/jsonrpc"],
};

interface AddressWords {
  empty: string;
  invalid: string;
  path: string;
  forbidden: string;
}

const WORDS: Record<XcpNgConnectionType, AddressWords> = {
  [XcpNgConnectionType.XenOrchestra]: {
    empty:
      "Enter Xen Orchestra's address, such as xo.example.com or https://10.0.0.5.",
    invalid:
      "Enter Xen Orchestra's address as you open it in a browser, such as https://xo.example.com.",
    path: "Enter only Xen Orchestra's address, without a path - such as https://xo.example.com.",
    forbidden:
      "Loopback, link-local and cloud metadata addresses are never used. Enter Xen Orchestra's own host name or IP address.",
  },
  [XcpNgConnectionType.Xapi]: {
    empty:
      "Enter the pool master's address, such as xcp-01.example.com or https://10.0.0.10.",
    invalid:
      "Enter the pool master's address, such as https://10.0.0.10: the host XAPI answers on.",
    path: "Enter only the pool master's address, without a path - such as https://10.0.0.10.",
    forbidden:
      "Loopback, link-local and cloud metadata addresses are never used. Enter the pool master's own host name or IP address.",
  },
};

export default class XcpNgConnectionAddress {
  public static normalize(
    input: string | null | undefined,
    type: XcpNgConnectionType,
  ): XcpNgAddressResult {
    const words: AddressWords =
      WORDS[type] || WORDS[XcpNgConnectionType.XenOrchestra];
    let raw: string = (input || "").trim();

    if (!raw) {
      return { error: words.empty };
    }

    if (WHITESPACE_PATTERN.test(raw)) {
      return { error: words.invalid };
    }

    /*
     * A fragment never reaches the server: Xen Orchestra 5's pages live
     * behind one (https://xo.example.com/#/home), so it is dropped.
     */
    const hashAt: number = raw.indexOf("#");
    if (hashAt >= 0) {
      raw = raw.substring(0, hashAt);
    }

    const schemeMatch: RegExpMatchArray | null = raw.match(SCHEME_PATTERN);
    const scheme: string | undefined = schemeMatch?.[1]?.toLowerCase();

    if (scheme === "http") {
      return {
        error:
          "Use https://. A probe reads XCP-ng over HTTPS only, and OneUptime never sends a secret unencrypted.",
      };
    }

    if (scheme && scheme !== "https") {
      return { error: words.invalid };
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
      return { error: words.invalid };
    }

    if (parsed.username || parsed.password || raw.includes("@")) {
      return {
        error:
          "Leave the user name, password and secrets out of the address. They have fields of their own.",
      };
    }

    if (raw.includes("?")) {
      return { error: words.invalid };
    }

    const path: string = withoutTrailingSlashes(parsed.pathname).toLowerCase();
    const accepted: ReadonlyArray<string> =
      ACCEPTED_PATHS[type] || ACCEPTED_PATHS[XcpNgConnectionType.XenOrchestra];

    if (path && !accepted.includes(path)) {
      return { error: words.path };
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
      return { error: words.invalid };
    }

    if (VMwareVCenterAddress.isForbiddenHost(host)) {
      return { error: words.forbidden };
    }

    const port: number = parsed.port
      ? Number.parseInt(parsed.port, 10)
      : DEFAULT_XCP_NG_HTTPS_PORT;

    const isIpAddress: boolean = IPV4_PATTERN.test(host) || host.includes(":");
    const hostForUrl: string = host.includes(":") ? `[${host}]` : host;

    return {
      address: {
        url:
          port === DEFAULT_XCP_NG_HTTPS_PORT
            ? `https://${hostForUrl}`
            : `https://${hostForUrl}:${port}`,
        host: host,
        port: port,
        isIpAddress: isIpAddress,
      },
    };
  }

  /*
   * "host:port" of a stored (normalized) address, or null when it is not
   * one. A saved secret is bound to this: it is only ever sent to the host
   * and port it was entered for.
   */
  public static getEndpointKey(
    url: string | null | undefined,
    type: XcpNgConnectionType,
  ): string | null {
    const result: XcpNgAddressResult = XcpNgConnectionAddress.normalize(
      url,
      type,
    );

    if (!result.address) {
      return null;
    }

    return `${result.address.host}:${result.address.port}`;
  }

  /*
   * The name a new connection gets when nobody typed one: its host name, as
   * people know it from the browser's address bar.
   */
  public static getDefaultName(
    url: string | null | undefined,
    type: XcpNgConnectionType,
  ): string | null {
    const result: XcpNgAddressResult = XcpNgConnectionAddress.normalize(
      url,
      type,
    );

    if (!result.address) {
      return null;
    }

    return result.address.host;
  }

  /*
   * A host address XAPI reports for a pool member (host.address: an IP, or
   * a name), as https://host - or null when it is not one a probe may
   * connect to. The pool's own report is no more trusted than a person's
   * typing: the same forbidden hosts are refused.
   */
  public static getXapiHostUrl(
    address: string | null | undefined,
  ): string | null {
    const raw: string = (address || "").trim();

    if (!raw || WHITESPACE_PATTERN.test(raw) || SCHEME_PATTERN.test(raw)) {
      return null;
    }

    const result: XcpNgAddressResult = XcpNgConnectionAddress.normalize(
      !raw.startsWith("[") && isBareIpv6(raw) ? `[${raw}]` : raw,
      XcpNgConnectionType.Xapi,
    );

    return result.address ? result.address.url : null;
  }
}

// An IPv6 literal without brackets: two or more colons, as XAPI writes one.
function isBareIpv6(value: string): boolean {
  return (value.match(/:/g) || []).length >= 2;
}
