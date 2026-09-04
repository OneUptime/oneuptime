import Dictionary from "../../Types/Dictionary";
import { AppVersion } from "../EnvironmentConfig";

/*
 * The User-Agent this platform presents when it calls somebody else's HTTP
 * server on a project's behalf — TAXII threat-intel feeds and the external
 * Data Source connectors (Prometheus, Loki, Elasticsearch, REST API).
 *
 * This is not cosmetic. With no User-Agent of our own, axios stamps its
 * default `axios/<version>` on every request, and a bare HTTP-library UA is
 * a stock rule in most WAFs, CDNs and bot-management products: the operator
 * on the far end sees an anonymous script rather than a named product, and
 * answers 403 before the request reaches their API at all. A product token
 * plus a URL is what makes the traffic allowlistable, and what lets the far
 * end's logs and abuse contact attribute it to something.
 *
 * Shape follows RFC 9110 §10.1.5 — a product/product-version token
 * followed by a comment:
 *
 *   OneUptime/8.0.1234 (+https://oneuptime.com)
 *
 * The version is dropped rather than printed as "unknown" when APP_VERSION
 * is unset (development, and any deployment that does not inject it), so
 * the UA never advertises a version that is not one.
 */

export const OUTBOUND_USER_AGENT_HEADER_NAME: string = "User-Agent";
export const OUTBOUND_USER_AGENT_PRODUCT: string = "OneUptime";
export const OUTBOUND_USER_AGENT_URL: string = "https://oneuptime.com";

/*
 * APP_VERSION is supplied by whoever deployed the instance, and a header
 * value carrying CR/LF is a request-smuggling primitive, so the version is
 * filtered down to RFC 9110 token characters instead of being trusted. The
 * length cap keeps a junk value from becoming a multi-kilobyte header.
 */
const VERSION_DISALLOWED_CHARACTERS: RegExp = /[^A-Za-z0-9._+-]/g;
const MAX_VERSION_LENGTH: number = 64;

/*
 * EnvironmentConfig's own placeholder when APP_VERSION is unset — a
 * sentinel, not a version, so it never reaches the wire.
 */
const UNKNOWN_VERSION: string = "unknown";

export default class OutboundUserAgent {
  // The User-Agent for this running instance.
  public static get(): string {
    return this.build(AppVersion);
  }

  /*
   * Pure builder — takes the version rather than reading it, so the format
   * is testable without reaching into the process environment.
   */
  public static build(version?: string | undefined): string {
    const sanitizedVersion: string = this.sanitizeVersion(version);

    const product: string = sanitizedVersion
      ? `${OUTBOUND_USER_AGENT_PRODUCT}/${sanitizedVersion}`
      : OUTBOUND_USER_AGENT_PRODUCT;

    return `${product} (+${OUTBOUND_USER_AGENT_URL})`;
  }

  /*
   * A version safe to put in a header, or "" when there is nothing worth
   * printing (unset, the "unknown" sentinel, or nothing left after
   * filtering).
   */
  public static sanitizeVersion(version?: string | undefined): string {
    const trimmed: string = (version || "").trim();

    if (trimmed === "" || trimmed.toLowerCase() === UNKNOWN_VERSION) {
      return "";
    }

    return trimmed
      .replace(VERSION_DISALLOWED_CHARACTERS, "")
      .substring(0, MAX_VERSION_LENGTH);
  }

  /*
   * Whether the caller already set a User-Agent of its own. Header names
   * are case-insensitive on the wire, so the check is too — otherwise a
   * caller's lowercase `user-agent` would end up alongside ours rather
   * than replacing it. A present-but-blank value counts as absent: an
   * empty UA is the same anonymous-client problem this whole file exists
   * to avoid.
   */
  public static hasUserAgent(
    headers?: Dictionary<string> | undefined,
  ): boolean {
    if (!headers) {
      return false;
    }

    for (const headerName of Object.keys(headers)) {
      if (
        headerName.toLowerCase() !==
        OUTBOUND_USER_AGENT_HEADER_NAME.toLowerCase()
      ) {
        continue;
      }

      const value: string | undefined = headers[headerName];

      if (typeof value === "string" && value.trim() !== "") {
        return true;
      }
    }

    return false;
  }

  /*
   * The headers to send: the caller's, plus our User-Agent when the caller
   * did not set one. An explicit User-Agent always wins — a REST API data
   * source whose provider demands a particular UA configures it as a custom
   * header, and that must reach the wire untouched.
   *
   * Returns a new dictionary; the caller's is never mutated.
   */
  public static withDefault(
    headers?: Dictionary<string> | undefined,
  ): Dictionary<string> {
    const merged: Dictionary<string> = { ...(headers || {}) };

    if (this.hasUserAgent(merged)) {
      return merged;
    }

    /*
     * A blank `user-agent` in any casing is dropped rather than left
     * beside ours: two keys differing only in case are one header on the
     * wire, and which of them survives normalization is not something to
     * leave to the HTTP client.
     */
    for (const headerName of Object.keys(merged)) {
      if (
        headerName.toLowerCase() ===
        OUTBOUND_USER_AGENT_HEADER_NAME.toLowerCase()
      ) {
        delete merged[headerName];
      }
    }

    merged[OUTBOUND_USER_AGENT_HEADER_NAME] = this.get();

    return merged;
  }
}
