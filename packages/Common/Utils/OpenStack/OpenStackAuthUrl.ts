import { withoutTrailingSlashes } from "../TrailingRuns";
import VMwareVCenterAddress from "../VMware/VMwareVCenterAddress";

/*
 * The Keystone address a person types, and the addresses a catalog names, read the
 * one way the server, the dashboard and the probe all agree on.
 *
 * People paste what their clouds.yaml or openrc file says -
 * "https://keystone.example.com:5000/v3", "https://cloud.example.com/identity/v3/"
 * - so those are all accepted and written back in one canonical form with no version
 * on the end, because the probe adds /v3 itself. Unlike a vCenter, Keystone often
 * lives under a path, so a path stays. Everything that would make the address mean
 * something other than "this Keystone" is refused with a sentence that says what to
 * type instead:
 *
 *   - plain http: a credential is never sent unencrypted, and neither is the token
 *     it buys, which is as good as the credential until it expires;
 *   - a user name or password in the address: they have fields of their own, and an
 *     address is shown to everyone who can see the cloud;
 *   - a query or fragment;
 *   - loopback, unspecified and link-local hosts - the cloud metadata endpoint lives
 *     there - which no probe ever connects to.
 *
 * The last check reads the host as typed. The probe repeats it on every address the
 * host name resolves to (SSRFProtection) and pins its socket to those addresses, so
 * a name that resolves somewhere forbidden is refused too.
 *
 * Pure and isomorphic (WHATWG URL only), so the dashboard's form, the server's save
 * hook and the probe give the same answer.
 */

export const DEFAULT_OPENSTACK_HTTPS_PORT: number = 443;

export interface OpenStackAddress {
  // https://host[:port][/path], with no version and no trailing slash.
  url: string;
  // Lowercase host name, IPv4 address, or IPv6 address without brackets.
  host: string;
  port: number;
  // The path, with no version and no trailing slash: "" or "/identity".
  path: string;
  isIpAddress: boolean;
}

export type OpenStackAddressResult =
  | { address: OpenStackAddress; error?: undefined }
  | { address?: undefined; error: string };

const SCHEME_PATTERN: RegExp = /^([a-z][a-z0-9+.-]*):\/\//i;
const WHITESPACE_PATTERN: RegExp = /\s/;
const IPV4_PATTERN: RegExp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

// What a clouds.yaml may end its auth_url with, which the probe adds back itself.
const VERSION_SUFFIXES: ReadonlyArray<string> = ["/v3", "/v3.0", "/v2.0"];

const INVALID_ADDRESS_MESSAGE: string =
  "Enter Keystone's address as your clouds.yaml or openrc file has it, such as https://keystone.example.com:5000/v3.";

export default class OpenStackAuthUrl {
  public static normalize(
    input: string | null | undefined,
  ): OpenStackAddressResult {
    const raw: string = (input || "").trim();

    if (!raw) {
      return {
        error:
          "Enter Keystone's address, such as https://keystone.example.com:5000/v3.",
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
          "Use https://. OneUptime never sends a credential or a token unencrypted. A cloud whose APIs only speak plain HTTP needs the OpenStack agent, which runs beside it.",
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

    const host: string = OpenStackAuthUrl.readHost(parsed);

    if (!host) {
      return { error: INVALID_ADDRESS_MESSAGE };
    }

    if (VMwareVCenterAddress.isForbiddenHost(host)) {
      return {
        error:
          "Loopback, link-local and cloud metadata addresses are never used. Enter Keystone's own host name or IP address.",
      };
    }

    const port: number = parsed.port
      ? Number.parseInt(parsed.port, 10)
      : DEFAULT_OPENSTACK_HTTPS_PORT;

    let path: string = withoutTrailingSlashes(parsed.pathname);

    for (const suffix of VERSION_SUFFIXES) {
      if (path.toLowerCase().endsWith(suffix)) {
        path = withoutTrailingSlashes(
          path.substring(0, path.length - suffix.length),
        );
        break;
      }
    }

    const hostForUrl: string = host.includes(":") ? `[${host}]` : host;
    const origin: string =
      port === DEFAULT_OPENSTACK_HTTPS_PORT
        ? `https://${hostForUrl}`
        : `https://${hostForUrl}:${port}`;

    return {
      address: {
        url: `${origin}${path}`,
        host: host,
        port: port,
        path: path,
        isIpAddress: IPV4_PATTERN.test(host) || host.includes(":"),
      },
    };
  }

  /*
   * "host:port/path" of a stored (normalized) address, or null when it is not one.
   * A saved credential is bound to this: it is only ever sent to the Keystone it was
   * entered for. The path counts, because /identity on a shared host is Keystone and
   * another path there need not be.
   */
  public static getEndpointKey(url: string | null | undefined): string | null {
    const result: OpenStackAddressResult = OpenStackAuthUrl.normalize(url);

    if (!result.address) {
      return null;
    }

    return `${result.address.host}:${result.address.port}${result.address.path}`;
  }

  /*
   * The name a new cloud gets when nobody typed one: its host name, as people know
   * it from the address.
   */
  public static getDefaultName(url: string | null | undefined): string | null {
    const result: OpenStackAddressResult = OpenStackAuthUrl.normalize(url);
    return result.address ? result.address.host : null;
  }

  /*
   * Why a URL from a catalog cannot be spoken to, or null when it can. The catalog is
   * only as trustworthy as the Keystone that wrote it, and a token follows wherever
   * it says, so its URLs are held to the rules of the one a person typed.
   */
  public static getCatalogUrlRefusal(url: string): {
    code: "insecure" | "forbidden" | "invalid";
    message: string;
  } | null {
    let parsed: globalThis.URL;

    try {
      parsed = new globalThis.URL(url);
    } catch {
      return {
        code: "invalid",
        message: `The catalog names ${url}, which is not a URL.`,
      };
    }

    if (parsed.protocol === "http:") {
      return {
        code: "insecure",
        message: `The catalog names ${url}, plain HTTP. A token is never sent unencrypted.`,
      };
    }

    if (parsed.protocol !== "https:") {
      return {
        code: "invalid",
        message: `The catalog names ${url}, which is not an HTTPS URL.`,
      };
    }

    if (parsed.username || parsed.password) {
      return {
        code: "invalid",
        message: "The catalog names a URL with a user name in it.",
      };
    }

    if (VMwareVCenterAddress.isForbiddenHost(OpenStackAuthUrl.readHost(parsed))) {
      return {
        code: "forbidden",
        message: `The catalog names ${url}, a loopback, link-local or cloud metadata address, which no probe connects to.`,
      };
    }

    return null;
  }

  private static readHost(parsed: globalThis.URL): string {
    let host: string = parsed.hostname.toLowerCase();

    if (host.startsWith("[") && host.endsWith("]")) {
      host = host.slice(1, -1);
    }

    // A trailing dot names the same host, so keep one spelling of it.
    if (host.endsWith(".")) {
      host = host.slice(0, -1);
    }

    return host;
  }
}
