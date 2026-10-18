import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import IP from "../../Types/IP/IP";
import { HstsMaxAgeSeconds, Host, HttpProtocol } from "../EnvironmentConfig";
import { ExpressRequest } from "./Express";

/*
 * WHETHER THE BROWSER BEHIND A REQUEST IS TALKING TO ONEUPTIME OVER HTTPS
 *
 * A cookie without the Secure attribute goes with every request to its host,
 * plain HTTP included. One http:// link to the same host - typed, followed,
 * or slipped into any plain-HTTP page by someone on the network - and the
 * session cookies an HTTPS sign-in left behind cross the network in clear
 * text, before any redirect to HTTPS can answer. So every cookie OneUptime
 * sets while the browser is on HTTPS is Secure (CookieUtil), and the
 * installation's own address tells browsers to come back over HTTPS only
 * (Strict-Transport-Security, set for every response in StartServer). Both
 * ask this module.
 *
 * The app seldom ends TLS itself, so it reads two signals, and either one is
 * enough:
 *
 *   1. The scheme the ingress forwards. OneUptime's ingress sends
 *      X-Forwarded-Proto: https when it ended TLS itself (PROVISION_SSL, a
 *      status page's or dashboard's own certificate), or when the proxy in
 *      front of it said the visitor used HTTPS ($visitor_scheme in
 *      Nginx/default.conf.template). Express reads it, through the
 *      `trust proxy` hops StartServer sets, as req.secure.
 *   2. The installation's own address. HTTP_PROTOCOL=https says people reach
 *      HOST over HTTPS, whatever the proxies in front of OneUptime send. It
 *      speaks for HOST only: a status page or a dashboard on a custom domain
 *      can be served over plain HTTP by an HTTPS installation, and a browser
 *      drops a Secure cookie that arrives over plain HTTP, so that page's
 *      visitors could no longer sign in.
 *
 * Neither signal can take Secure away from a browser that is on HTTPS. A
 * header that says "https" over plain HTTP can only make the sender's own
 * cookies Secure, which its own browser then declines to keep.
 *
 * An installation served over plain HTTP - HTTP_PROTOCOL=http and nothing in
 * front of it ending TLS - sees neither signal: its cookies are what they
 * were, and its people sign in as they did.
 */

// What a Host header can hold besides a host and a port.
const NOT_A_HOST_AUTHORITY: RegExp = /[\s/?#@,\\]/;

export default class RequestTransport {
  /*
   * Whether the browser that sent this request reached OneUptime over
   * HTTPS. Without a request - never the case for a response Express made -
   * the installation's own protocol decides.
   */
  public static isHttps(req: ExpressRequest | undefined): boolean {
    const isHttpsInstallation: boolean = HttpProtocol === Protocol.HTTPS;

    if (!req) {
      return isHttpsInstallation;
    }

    if (req.secure === true) {
      return true;
    }

    return isHttpsInstallation && RequestTransport.isInstallationAddress(req);
  }

  /*
   * Whether a request is for the installation's own address (HOST), by the
   * Host header the ingress passes on - never X-Forwarded-Host, which a
   * caller can write. A port does not matter: browsers keep cookies and the
   * HTTPS-only rule by host name.
   */
  public static isInstallationAddress(
    req: ExpressRequest | undefined,
  ): boolean {
    const requestHost: string | null = RequestTransport.hostnameOf(
      RequestTransport.hostHeaderOf(req),
    );

    if (!requestHost) {
      return false;
    }

    return requestHost === RequestTransport.hostnameOf(Host);
  }

  /*
   * The Strict-Transport-Security header for a response, or null for none.
   *
   * Only for the installation's own address, and only when the installation
   * says it is served over HTTPS (HTTP_PROTOCOL=https). Browsers obey it only
   * when it reaches them over HTTPS, and then refuse plain HTTP to that host
   * name - on any port - for max-age seconds, so it is never sent for a
   * status page's or a dashboard's custom domain: whoever owns that domain
   * decides whether it is HTTPS-only. includeSubDomains is left out for the
   * same reason: the names under HOST are not OneUptime's.
   *
   * HSTS_MAX_AGE_SECONDS=0 sends max-age=0, which makes a browser forget the
   * rule at its next HTTPS visit.
   *
   * Nor is it sent when HOST is localhost, a name under .localhost or an IP
   * address (isNeverPinned).
   */
  public static getStrictTransportSecurity(
    req: ExpressRequest | undefined,
  ): string | null {
    if (HttpProtocol !== Protocol.HTTPS) {
      return null;
    }

    if (!RequestTransport.isInstallationAddress(req)) {
      return null;
    }

    if (RequestTransport.isNeverPinned(RequestTransport.hostnameOf(Host))) {
      return null;
    }

    return `max-age=${HstsMaxAgeSeconds}`;
  }

  /*
   * Whether a host name is one Strict-Transport-Security must not be pinned
   * to. localhost and the names under .localhost are what every development
   * server on a machine answers to, and a browser would refuse plain HTTP to
   * all of them, on every port, for a year: one HTTPS test of OneUptime on a
   * laptop would break every other local project there. Their traffic never
   * crosses a network either. An IP address is never pinned by a browser
   * (RFC 6797, section 8.1), so the header would only be noise.
   */
  public static isNeverPinned(hostname: string | null): boolean {
    if (!hostname) {
      return true;
    }

    if (hostname === "localhost" || hostname.endsWith(".localhost")) {
      return true;
    }

    const address: string =
      hostname.startsWith("[") && hostname.endsWith("]")
        ? hostname.slice(1, -1)
        : hostname;

    return IP.isIP(address);
  }

  /*
   * The host name of a Host header (or of HOST): lower case, no port, no
   * trailing dot. Null for anything that is not a host and an optional port.
   */
  public static hostnameOf(authority: string | undefined): string | null {
    const value: string = authority?.trim() || "";

    if (
      !value ||
      NOT_A_HOST_AUTHORITY.test(value) ||
      !Hostname.isValid(value)
    ) {
      return null;
    }

    try {
      let hostname: string = Hostname.fromAuthority(value)
        .hostname.trim()
        .toLowerCase();

      // The fully-qualified spelling of a DNS name is the same host.
      if (hostname.endsWith(".")) {
        hostname = hostname.slice(0, -1);
      }

      return hostname || null;
    } catch {
      return null;
    }
  }

  private static hostHeaderOf(
    req: ExpressRequest | undefined,
  ): string | undefined {
    const host: string | Array<string> | undefined = req?.headers?.["host"];

    if (Array.isArray(host)) {
      return host[0];
    }

    return host;
  }
}
