import { withoutTrailingSlashes } from "../TrailingRuns";
import VMwareVCenterAddress from "../VMware/VMwareVCenterAddress";

/*
 * The address a person types for a storage management server (Unisphere
 * for PowerMax), read the one way the server, the dashboard and the probe
 * all agree on - VMware's rules (VMwareVCenterAddress), with the server's
 * own port and paths:
 *
 *   - accepted as a browser shows it ("unisphere.example.com",
 *     "https://unisphere.example.com:8443/univmax/") and written back as
 *     the one canonical https://host:port the probe connects to;
 *   - plain http refused: a password is never sent unencrypted;
 *   - no user name or password in the address, no query, no other path;
 *   - loopback, link-local and cloud metadata hosts refused, as typed here
 *     and again by the probe on every address the name resolves to.
 *
 * Pure and isomorphic (WHATWG URL only).
 */

export interface StorageArrayConnectionAddressShape {
  // The port when the address names none.
  defaultPort: number;
  // The paths a browser shows for the server, accepted and dropped.
  acceptedPaths: ReadonlyArray<string>;
}

export interface StorageArrayAddress {
  // https://host:port - the port always written, since it is rarely 443.
  url: string;
  // Lowercase host name, IPv4 address, or IPv6 address without brackets.
  host: string;
  port: number;
  isIpAddress: boolean;
}

export type StorageArrayAddressResult =
  | { address: StorageArrayAddress; error?: undefined }
  | { address?: undefined; error: string };

const SCHEME_PATTERN: RegExp = /^([a-z][a-z0-9+.-]*):\/\//i;
const WHITESPACE_PATTERN: RegExp = /\s/;
const IPV4_PATTERN: RegExp = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export const STORAGE_ARRAY_INVALID_ADDRESS_MESSAGE: string =
  "Enter the server's address as you open it in a browser, such as https://unisphere.example.com:8443.";

export default class StorageArrayConnectionAddress {
  public static normalize(
    input: string | null | undefined,
    shape: StorageArrayConnectionAddressShape,
  ): StorageArrayAddressResult {
    const raw: string = (input || "").trim();

    if (!raw) {
      return {
        error:
          "Enter the server's address, such as unisphere.example.com or https://10.0.0.20:8443.",
      };
    }

    if (WHITESPACE_PATTERN.test(raw)) {
      return { error: STORAGE_ARRAY_INVALID_ADDRESS_MESSAGE };
    }

    const schemeMatch: RegExpMatchArray | null = raw.match(SCHEME_PATTERN);
    const scheme: string | undefined = schemeMatch?.[1]?.toLowerCase();

    if (scheme === "http") {
      return {
        error:
          "Use https://. The server's API is served over HTTPS, and OneUptime never sends a password unencrypted.",
      };
    }

    if (scheme && scheme !== "https") {
      return { error: STORAGE_ARRAY_INVALID_ADDRESS_MESSAGE };
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
      return { error: STORAGE_ARRAY_INVALID_ADDRESS_MESSAGE };
    }

    if (parsed.username || parsed.password || raw.includes("@")) {
      return {
        error:
          "Leave the user name and password out of the address. They have fields of their own.",
      };
    }

    if (raw.includes("?") || raw.includes("#")) {
      return { error: STORAGE_ARRAY_INVALID_ADDRESS_MESSAGE };
    }

    const path: string = withoutTrailingSlashes(parsed.pathname).toLowerCase();

    if (path && path !== "/" && !shape.acceptedPaths.includes(path)) {
      return {
        error:
          "Enter only the server's address, without a path - such as https://unisphere.example.com:8443.",
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
      return { error: STORAGE_ARRAY_INVALID_ADDRESS_MESSAGE };
    }

    if (VMwareVCenterAddress.isForbiddenHost(host)) {
      return {
        error:
          "Loopback, link-local and cloud metadata addresses are never used. Enter the server's own host name or IP address.",
      };
    }

    /*
     * WHATWG URL drops a port equal to the scheme's default (443), so an
     * explicit :443 reads as no port: that is the address, written so.
     */
    const port: number = parsed.port
      ? Number.parseInt(parsed.port, 10)
      : raw.match(/:443(?:[/]|$)/)
        ? 443
        : shape.defaultPort;

    const isIpAddress: boolean = IPV4_PATTERN.test(host) || host.includes(":");
    const hostForUrl: string = host.includes(":") ? `[${host}]` : host;

    return {
      address: {
        url: `https://${hostForUrl}:${port}`,
        host: host,
        port: port,
        isIpAddress: isIpAddress,
      },
    };
  }

  /*
   * "host:port" of a stored (normalized) address, or null when it is not
   * one. A saved password is bound to this: it is only ever sent to the
   * host and port it was entered for.
   */
  public static getEndpointKey(
    url: string | null | undefined,
    shape: StorageArrayConnectionAddressShape,
  ): string | null {
    const result: StorageArrayAddressResult =
      StorageArrayConnectionAddress.normalize(url, shape);
    if (!result.address) {
      return null;
    }
    return `${result.address.host}:${result.address.port}`;
  }

  // A connection's default name: the host it reaches.
  public static getDefaultName(
    url: string | null | undefined,
    shape: StorageArrayConnectionAddressShape,
  ): string | null {
    const result: StorageArrayAddressResult =
      StorageArrayConnectionAddress.normalize(url, shape);
    return result.address ? result.address.host : null;
  }
}
