import { Host, HttpProtocol } from "../EnvironmentConfig";
import { URL as NodeURL } from "url";

/*
 * WHETHER A BROWSER SENT THIS REQUEST FROM A PAGE THAT IS NOT THIS
 * INSTANCE'S OWN.
 *
 * The API answers every origin (Access-Control-Allow-Origin: *, and cors()
 * approves any preflight), so any website can have a visitor's browser send
 * a request to an anonymous route - an auto-submitted <form method=POST>
 * needs no preflight at all - from the visitor's own network address. For a
 * route that trusts where a request comes from (an IP allowlist, a
 * per-address budget), every visitor inside the allowed network becomes a
 * relay for whoever wrote that page.
 *
 * A browser says where a request came from, in two headers no page can set,
 * and the request is refused when either says it came from somewhere else:
 *
 *   - Sec-Fetch-Site (sent over HTTPS and to localhost): only "same-origin",
 *     or "none" for a request the visitor made themselves (the address bar,
 *     a bookmark), passes; "same-site" and "cross-site" are another page.
 *
 *   - Origin (sent with every POST, and with every cross-origin request):
 *     must be this instance's origin as it is configured - HTTP_PROTOCOL
 *     and HOST, from which the dashboard and the Accounts pages build the
 *     API's address, and with which the passkey sign-in compares a
 *     browser's Origin too. A HOST with a port (localhost:3000 in
 *     development) keeps it, as the browser's Origin does. It is read even
 *     when Sec-Fetch-Site says "same-origin", because that only says the
 *     page is on the host the request went to, and this app answers for
 *     more hosts than its own: a status page on its owner's domain, and a
 *     DNS-rebinding page whose name was pointed at this server, both call
 *     their requests to it "same-origin". "null" - an opaque origin, such as
 *     a sandboxed frame's - is never this instance.
 *
 * The Host header is not compared: it names whatever host the browser went
 * to - the rebinding page's own name included - and our nginx forwards it
 * without the port.
 *
 * A request with neither header did not come from a browser page (curl, a
 * server-side client) and is not refused here: it still faces everything
 * else in front of the route. What this stops is a browser being made to
 * send it.
 */

const SAME_ORIGIN_FETCH_SITES: ReadonlyArray<string> = ["same-origin", "none"];

// The one media type another site cannot have a browser send unpreflighted.
const JSON_MEDIA_TYPE: string = "application/json";

export interface BrowserRequestHeaders {
  "sec-fetch-site"?: string | Array<string> | undefined;
  origin?: string | Array<string> | undefined;
}

type HeaderValueFunction = (
  value: string | Array<string> | undefined,
) => string;

/*
 * A header as one string, "" when it was not sent. A header sent twice is
 * joined, so it matches no accepted value and is refused: this is an access
 * decision, and every doubt is a no.
 */
const headerValue: HeaderValueFunction = (
  value: string | Array<string> | undefined,
): string => {
  if (value === undefined) {
    return "";
  }

  return (Array.isArray(value) ? value.join(",") : value).trim();
};

type OriginOfFunction = (url: string) => string | null;

/*
 * The origin an http(s) URL names, written the way a browser writes one in
 * an Origin header: scheme and host in lower case, an IDN in punycode, the
 * scheme's default port left out. Null for anything else.
 */
const originOf: OriginOfFunction = (url: string): string | null => {
  try {
    const parsed: NodeURL = new NodeURL(url);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed.origin;
  } catch {
    return null;
  }
};

export default class SameOriginRequest {
  /**
   * This instance's origin as it is configured (see above). Null when HOST
   * is not set, or names no host.
   */
  public static getInstanceOrigin(): string | null {
    if (!Host) {
      return null;
    }

    return originOf(`${HttpProtocol}${Host}`);
  }

  /**
   * True when a browser sent the request from a page that is not this
   * instance's own (see above). With no configured origin to compare, a
   * request carrying an Origin is refused: it cannot be shown to be ours.
   */
  public static isForeignPageRequest(data: {
    headers: BrowserRequestHeaders;
    // getInstanceOrigin(), passed in so the rule can be tested on its own.
    instanceOrigin: string | null;
  }): boolean {
    const fetchSite: string = headerValue(
      data.headers["sec-fetch-site"],
    ).toLowerCase();

    if (fetchSite !== "" && !SAME_ORIGIN_FETCH_SITES.includes(fetchSite)) {
      return true;
    }

    const origin: string = headerValue(data.headers.origin);

    if (origin === "") {
      return false;
    }

    const requestOrigin: string | null =
      origin === "null" ? null : originOf(origin);

    return (
      !requestOrigin ||
      !data.instanceOrigin ||
      requestOrigin !== data.instanceOrigin
    );
  }

  /**
   * Whether a request's Content-Type is JSON ("application/json", with or
   * without parameters such as a charset). Another site's page can have a
   * browser send a urlencoded, multipart or plain text body without a
   * preflight; a JSON one it cannot, and the request that follows the
   * preflight carries the Origin isForeignPageRequest reads.
   */
  public static isJsonContentType(
    value: string | Array<string> | undefined,
  ): boolean {
    const mediaType: string = headerValue(value)
      .split(";")[0]!
      .trim()
      .toLowerCase();

    return mediaType === JSON_MEDIA_TYPE;
  }
}
