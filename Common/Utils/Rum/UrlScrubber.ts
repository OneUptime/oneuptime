/*
 * URL scrubbing for session replay.
 *
 * This is the one PII channel that text masking does not cover. Masking
 * every text node still leaves `?email=someone@example.com`,
 * `/reset-password?token=...`, and magic-link URLs intact — and URLs are
 * *worse* than a payload leak, because entryUrl / exitUrl sit in the
 * wider session-metadata ACL and render directly in the session list,
 * where anyone who can see the list sees them.
 *
 * Applied in the browser, before anything is uploaded: to the chunk url,
 * entryUrl, exitUrl, the rrweb Meta event hrefs, and every network-event
 * URL.
 *
 * Must stay dependency-free — this is bundled into the browser recorder.
 */

/*
 * Path segments that look like identifiers are replaced wholesale. A
 * bare numeric id is left alone (it is rarely PII on its own and is
 * often needed to tell one route from another), but anything that looks
 * like a uuid, an email, a long digit run (card / phone / account) or a
 * long opaque token is replaced.
 */
const UUID_SEGMENT: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* 24-char Mongo/BSON-style object id, which is what OneUptime itself uses. */
const OBJECT_ID_SEGMENT: RegExp = /^[0-9a-f]{24}$/i;

const EMAIL_SEGMENT: RegExp = /^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/;

/* 9 or more consecutive digits: card numbers, phone numbers, SSNs. */
const LONG_DIGIT_SEGMENT: RegExp = /^\d{9,}$/;

/*
 * Long high-entropy strings: session tokens, JWT parts, signed links.
 * Deliberately conservative at 32 characters so ordinary slugs survive.
 */
const OPAQUE_TOKEN_SEGMENT: RegExp = /^[A-Za-z0-9_-]{32,}$/;

const REDACTED: string = "[redacted]";

export default class UrlScrubber {
  /*
   * Reduce a URL to origin + scrubbed path. Query and fragment are
   * dropped entirely unless a parameter is explicitly allowlisted, in
   * which case its *name* is kept and its value is redacted — enough to
   * tell "this page was loaded with a coupon code" from "it wasn't",
   * without recording which code.
   *
   * Never throws: a URL that will not parse is reduced to a constant
   * rather than propagating an exception into the recorder's hot path or
   * being passed through unscrubbed. Failing closed matters more here
   * than fidelity.
   */
  public static scrub(
    rawUrl: string,
    allowlistedQueryParams?: Array<string> | undefined,
  ): string {
    if (!rawUrl) {
      return "";
    }

    let parsed: URL | undefined = undefined;

    try {
      /*
       * A base is supplied so relative URLs (which rrweb Meta events can
       * carry) still parse. The base origin is never emitted, because a
       * relative input yields a relative output below.
       */
      parsed = new URL(rawUrl, "https://redacted.invalid");
    } catch {
      return REDACTED;
    }

    const isRelativeInput: boolean =
      parsed.origin === "https://redacted.invalid" &&
      !rawUrl.startsWith("https://redacted.invalid");

    const scrubbedPath: string = UrlScrubber.scrubPath(parsed.pathname);

    const query: string = UrlScrubber.scrubQuery(
      parsed.searchParams,
      allowlistedQueryParams,
    );

    const base: string = isRelativeInput
      ? scrubbedPath
      : `${parsed.origin}${scrubbedPath}`;

    return query ? `${base}?${query}` : base;
  }

  /* Replace identifier-shaped segments, preserving route structure. */
  public static scrubPath(pathname: string): string {
    if (!pathname || pathname === "/") {
      return pathname || "/";
    }

    const segments: Array<string> = pathname.split("/");

    const scrubbed: Array<string> = segments.map((segment: string): string => {
      if (!segment) {
        return segment;
      }

      let decoded: string = segment;

      /*
       * Decode before matching so a percent-encoded email
       * (name%40example.com) is still recognised. A malformed escape
       * sequence throws, in which case the raw segment is matched.
       */
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        decoded = segment;
      }

      if (
        UUID_SEGMENT.test(decoded) ||
        OBJECT_ID_SEGMENT.test(decoded) ||
        EMAIL_SEGMENT.test(decoded) ||
        LONG_DIGIT_SEGMENT.test(decoded) ||
        OPAQUE_TOKEN_SEGMENT.test(decoded)
      ) {
        return REDACTED;
      }

      return segment;
    });

    return scrubbed.join("/");
  }

  /*
   * Keep only allowlisted parameter names, with redacted values. An
   * empty or missing allowlist drops the query string entirely.
   */
  public static scrubQuery(
    params: URLSearchParams,
    allowlistedQueryParams?: Array<string> | undefined,
  ): string {
    if (!allowlistedQueryParams || allowlistedQueryParams.length === 0) {
      return "";
    }

    const allowed: Set<string> = new Set(
      allowlistedQueryParams.map((param: string): string => {
        return param.toLowerCase();
      }),
    );

    const kept: Array<string> = [];

    params.forEach((_value: string, key: string): void => {
      if (allowed.has(key.toLowerCase())) {
        kept.push(`${encodeURIComponent(key)}=${REDACTED}`);
      }
    });

    return kept.join("&");
  }

  /*
   * Path-only form, used for the refresh-rage detector, which needs to
   * compare "the same page" across reloads without the origin.
   */
  public static getScrubbedPathname(rawUrl: string): string {
    const scrubbed: string = UrlScrubber.scrub(rawUrl);

    if (!scrubbed || scrubbed === REDACTED) {
      return REDACTED;
    }

    try {
      const parsed: URL = new URL(scrubbed, "https://redacted.invalid");
      return parsed.pathname;
    } catch {
      return REDACTED;
    }
  }
}
