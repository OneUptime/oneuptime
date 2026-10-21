/**
 * Redirect URIs
 *
 * The redirect URI is where an authorization code is delivered, so it is the
 * one piece of what a client says about itself that decides who can end up
 * holding a member's access. Two rules follow, and this file is both of them:
 * which URIs a client may register at all, and whether the URI on a request
 * is one of the URIs it registered.
 */

/*
 * The three spellings of "this machine" a native client may use (RFC 8252
 * section 7.3, plus `localhost`, which that RFC discourages but which real
 * clients - Claude Code among them - declare).
 */
const LOOPBACK_HOSTNAMES: Set<string> = new Set<string>([
  "localhost",
  "127.0.0.1",
  "[::1]",
]);

/*
 * Schemes that are never a place to send a browser carrying a code.
 *
 * The first group runs or renders something in the page that navigates to
 * it - the consent screen sends the browser to the redirect URI, so one of
 * these there is script running in OneUptime's own origin. The rest name a
 * local resource or a non-web transport and are simply not somewhere a code
 * can be collected.
 */
const FORBIDDEN_SCHEMES: Set<string> = new Set<string>([
  "javascript:",
  "data:",
  "vbscript:",
  "blob:",
  "about:",
  "view-source:",
  "file:",
  "filesystem:",
  "jar:",
  "resource:",
  "chrome:",
  "ftp:",
  "ws:",
  "wss:",
  "mailto:",
  "tel:",
  "sms:",
]);

/*
 * Printable ASCII with no spaces. The URL parser silently strips tabs and
 * newlines and trims whitespace, which would let two different strings name
 * the same URI; anything outside this set is refused before it is parsed, so
 * what was registered is what gets compared. An internationalised host is
 * sent in punycode.
 */
const ALLOWED_CHARACTERS_PATTERN: RegExp = /^[\x21-\x7E]+$/;

export const MAX_REDIRECT_URI_LENGTH: number = 1024;

export default class RedirectUri {
  /*
   * Why a URI may not be registered, or null when it may.
   *
   *   https            - anywhere.
   *   http             - this machine only. A native client listens on a
   *                      loopback port; plain http to any other host would
   *                      put the code on the wire in the clear.
   *   a private scheme - `cursor://…`, `com.example.app:/callback`: how a
   *                      desktop or mobile app has the operating system hand
   *                      the browser back to it (RFC 8252 section 7.1).
   *
   * Never a fragment (RFC 6749 section 3.1.2), never credentials in the URL.
   */
  public static getRegistrationProblem(value: unknown): string | null {
    if (typeof value !== "string" || !value) {
      return "A redirect URI must be a non-empty string.";
    }

    if (value.length > MAX_REDIRECT_URI_LENGTH) {
      return `A redirect URI cannot be longer than ${MAX_REDIRECT_URI_LENGTH} characters.`;
    }

    if (!ALLOWED_CHARACTERS_PATTERN.test(value)) {
      return "A redirect URI must contain only printable ASCII characters and no spaces.";
    }

    if (value.includes("#")) {
      return "A redirect URI must not contain a fragment.";
    }

    let parsed: globalThis.URL;

    try {
      parsed = new globalThis.URL(value);
    } catch {
      return "A redirect URI must be an absolute URI.";
    }

    if (FORBIDDEN_SCHEMES.has(parsed.protocol)) {
      return `A redirect URI cannot use the ${parsed.protocol} scheme.`;
    }

    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      if (!parsed.hostname) {
        return "A redirect URI must name a host.";
      }

      if (parsed.username || parsed.password) {
        return "A redirect URI must not contain credentials.";
      }

      if (
        parsed.protocol === "http:" &&
        !LOOPBACK_HOSTNAMES.has(parsed.hostname)
      ) {
        return "A redirect URI must use https, unless it points at this machine (localhost, 127.0.0.1 or [::1]).";
      }
    }

    return null;
  }

  /*
   * Whether the redirect URI on a request is one the client registered.
   *
   * An exact string match, with the one exception RFC 8252 section 7.3
   * requires: a loopback URI matches on ANY port, because a native client is
   * given its port by the operating system when it starts listening and
   * cannot know it in advance. Only the port is relaxed - scheme, host, path
   * and query still have to agree, and `localhost` does not match
   * `127.0.0.1`.
   */
  public static matches(requested: string, registered: string): boolean {
    if (requested === registered) {
      return true;
    }

    /*
     * The same character rule as registration, applied to the request: the
     * parser below would otherwise forgive whitespace the exact comparison
     * above did not.
     */
    if (
      !ALLOWED_CHARACTERS_PATTERN.test(requested) ||
      requested.includes("#")
    ) {
      return false;
    }

    let requestedUrl: globalThis.URL;
    let registeredUrl: globalThis.URL;

    try {
      requestedUrl = new globalThis.URL(requested);
      registeredUrl = new globalThis.URL(registered);
    } catch {
      return false;
    }

    if (
      !RedirectUri.isLoopbackUrl(requestedUrl) ||
      !RedirectUri.isLoopbackUrl(registeredUrl)
    ) {
      return false;
    }

    return (
      requestedUrl.protocol === registeredUrl.protocol &&
      requestedUrl.hostname === registeredUrl.hostname &&
      requestedUrl.pathname === registeredUrl.pathname &&
      requestedUrl.search === registeredUrl.search &&
      !requestedUrl.username &&
      !requestedUrl.password
    );
  }

  public static matchesAny(
    requested: string,
    registered: Array<string>,
  ): boolean {
    return registered.some((candidate: string): boolean => {
      return RedirectUri.matches(requested, candidate);
    });
  }

  // True when the URI points back at the machine the browser is running on.
  public static isLoopback(value: string): boolean {
    try {
      return RedirectUri.isLoopbackUrl(new globalThis.URL(value));
    } catch {
      return false;
    }
  }

  /*
   * What to tell a person about where they will be sent: the host for a web
   * address, the scheme for an app. Shown on the consent screen, where it is
   * the most reliable statement about the client that the client itself
   * cannot write.
   */
  public static getDisplayTarget(value: string): string {
    try {
      const parsed: globalThis.URL = new globalThis.URL(value);

      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        return parsed.host;
      }

      return `${parsed.protocol}//${parsed.host}`.replace(/\/\/$/, "");
    } catch {
      return value;
    }
  }

  /*
   * The redirect URI with response parameters added, existing query intact.
   * Parameters set to undefined are left out.
   */
  public static withParameters(
    redirectUri: string,
    parameters: Record<string, string | undefined>,
  ): string {
    const url: globalThis.URL = new globalThis.URL(redirectUri);

    for (const [name, value] of Object.entries(parameters)) {
      if (value !== undefined) {
        url.searchParams.set(name, value);
      }
    }

    return url.toString();
  }

  private static isLoopbackUrl(url: globalThis.URL): boolean {
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      LOOPBACK_HOSTNAMES.has(url.hostname)
    );
  }
}
