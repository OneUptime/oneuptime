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

/*
 * An email-shaped path segment. Each run is length-bounded (a local part, a
 * domain and a trailing label, the sizes RFC 5321 allows), and anchored, so a
 * segment of any length is read once from end to end - the recorder runs this
 * in the browser over whatever URL the page navigated to.
 */
const EMAIL_SEGMENT: RegExp = /^[^@\s/]{1,64}@[^@\s/]{1,253}\.[^@\s/]{1,63}$/;

/* 9 or more consecutive digits: card numbers, phone numbers, SSNs. */
const LONG_DIGIT_SEGMENT: RegExp = /^\d{9,}$/;

/*
 * Long high-entropy strings: session tokens, JWT parts, signed links.
 * Deliberately conservative at 32 characters so ordinary slugs survive.
 * In base64url, or in standard base64 (#8489): its "+" and "/" (a "/" only
 * escaped, as "%2F", or it would end the segment), and up to two "=" of
 * padding at its end.
 */
const OPAQUE_TOKEN_SEGMENT: RegExp = /^[A-Za-z0-9_+/-]{32,}={0,2}$/;

/*
 * A JSON Web Token, signed, unsigned or encrypted (#8385): a header of
 * base64url JSON, so it starts "eyJ" ('{"'), and one to four more parts
 * joined by dots. The dots kept a whole one out of OPAQUE_TOKEN_SEGMENT,
 * and its payload is a person's claims, readable by anyone. A file name
 * ("report-2026-11-15.pdf") does not start so. Anchored at both ends of one
 * segment, and no part can hold a dot, so a segment is read once.
 */
const JWT_SEGMENT: RegExp = /^eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*){1,4}$/;

const REDACTED: string = "[redacted]";

/*
 * A fragment that is a route rather than an in-page anchor. Hash routers
 * (Angular's HashLocationStrategy, React's HashRouter, Vue's hash mode,
 * every "#/"-routed admin tool) keep the whole route there:
 * "https://shop.example.com/#/orders/42", or "#!/orders/42".
 */
const HASH_ROUTE_PATTERN: RegExp = /^#!?\//;

/* One escaped byte: "%c3", "%2F". */
const ESCAPED_BYTE: RegExp = /^%[0-9A-Fa-f]{2}$/;

/*
 * Text with no ASCII in it. An escaped character is written composed only
 * when it stays beyond ASCII composed: NFC turns three into ASCII, U+037E
 * into ";", U+1FEF into "`" and U+212A into "K".
 */
const BEYOND_ASCII: RegExp = /^[\u0080-\uffff]+$/;

/* An escape, or a character beyond ASCII: a path with a spelling to settle. */
const SPELLED_CHARACTER: RegExp = /[%\u0080-\uffff]/;

/* Characters beyond ASCII, which the URL parser escapes. */
const NON_ASCII_RUN: RegExp = /[\u0080-\uffff]+/g;

export default class UrlScrubber {
  /*
   * Reduce a URL to origin + scrubbed path. Query and fragment are
   * dropped entirely unless a parameter is explicitly allowlisted, in
   * which case its *name* is kept and its value is redacted — enough to
   * tell "this page was loaded with a coupon code" from "it wasn't",
   * without recording which code.
   *
   * The one fragment kept is a hash router's route (scrubHashRoute): it
   * is the page, as much as the path is. Without it every page of a
   * hash-routed app was stored as "https://shop.example.com/", and the
   * app reported one page per session. Any other fragment - an anchor
   * ("#pricing"), a token ("#access_token=...") - is still dropped.
   *
   * The browser recorder and the ingest both run this, the ingest again
   * over whatever the recorder sent, so it has to keep what it keeps
   * when it runs over its own output.
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

    let origin: string = parsed.origin;
    let scrubbedPath: string = UrlScrubber.scrubPath(parsed.pathname);

    /*
     * A scheme the URL standard gives no origin: URL.origin is the string
     * "null". The React Native recorder names every screen
     * "app://<app id>/<route>", and each was stored as "null/<route>", its
     * app lost (#8384). Such a URL keeps its scheme and host as written (a
     * user name and password are dropped, as origin drops them). One with no
     * path from the root (data:, mailto:, about:) is no page, and can be
     * content ("data:text/plain,<anything>"): its path is redacted.
     */
    if (origin === "null") {
      origin = parsed.protocol + (parsed.host && `//${parsed.host}`);

      if (parsed.pathname && parsed.pathname.charAt(0) !== "/") {
        scrubbedPath = REDACTED;
      }
    }

    const query: string = UrlScrubber.scrubQuery(
      parsed.searchParams,
      allowlistedQueryParams,
    );

    const base: string = isRelativeInput
      ? scrubbedPath
      : `${origin}${scrubbedPath}`;

    const hashRoute: string = UrlScrubber.scrubHashRoute(parsed.hash);

    return `${query ? `${base}?${query}` : base}${hashRoute}`;
  }

  /*
   * A hash router's route, scrubbed as a path is: "#/orders/42?token=x" ->
   * "#/orders/42", "#!/u/someone@example.com" -> "#!/u/[redacted]". Empty
   * for any other fragment, which is dropped.
   */
  public static scrubHashRoute(hash: string): string {
    const route: string | null = UrlScrubber.getHashRoute(hash);

    if (route === null) {
      return "";
    }

    return `${hash.slice(0, hash.indexOf("/"))}${UrlScrubber.scrubPath(route)}`;
  }

  /*
   * The path of a hash router's route, without the query a route can
   * carry inside the fragment: "#/orders/42?tab=open" and "#!/orders/42"
   * are "/orders/42". Null when the fragment is not a route.
   */
  public static getHashRoute(hash: string): string | null {
    if (!HASH_ROUTE_PATTERN.test(hash)) {
      return null;
    }

    const route: string = hash.slice(hash.indexOf("/"));
    const queryIndex: number = route.indexOf("?");

    return queryIndex === -1 ? route : route.slice(0, queryIndex);
  }

  /*
   * A path in the one spelling the URL parser writes for its words.
   *
   * The parser escapes every character beyond ASCII as UTF-8 in upper-case
   * hex ("/café" is "/caf%C3%A9"), but keeps an escape it is given as
   * written. So one page reached through a link to "/caf%c3%a9" (lower-case
   * hex, as .NET's HttpUtility.UrlEncode and WordPress write it), or
   * through "/café" with its accent decomposed (an "e" and U+0301, as macOS
   * writes file names: "/cafe%CC%81"), was stored, and shown on User Flows,
   * as two or three pages, each named "/café". Here every escape is written
   * in upper-case hex (RFC 3986, 6.2.2.1), and the escaped characters
   * beyond ASCII are decoded, composed (NFC) and escaped again as the
   * parser escapes them: all three are "/caf%C3%A9".
   *
   * Nothing that can name another page is merged. Every other escape keeps
   * its place: an escaped "/", "?", "#" or "%" ("/a%2Fb" is not "/a/b") and
   * any other escape of an ASCII character, bytes that are not UTF-8, and
   * the three characters NFC would turn into ASCII (BEYOND_ASCII), so an
   * escape never passes for a character the parser writes plainly. Each
   * also ends the text an accent is composed with, so it never takes one
   * ("%2F" and U+0307 would compose the "F" into U+1E1E). Case outside
   * escapes stays: "/Cart" is not "/cart". (User Flows draws the words
   * decoded for a person: getUserFlowPageText.)
   *
   * No Unicode property escape decides it: the recorder inlines this
   * module, and a browser that cannot parse one would not load it at all.
   *
   * Running it over its own result changes nothing, so the ingest's second
   * scrub keeps the recorder's spelling.
   *
   * `asRead` leaves the words decoded ("/caf%c3%a9" and "/cafe%CC%81" are
   * "/café"), and writes every other escape as above: the spelling a page
   * pattern is compared in, so "/café" written as a person reads it matches
   * the page it names (#8195), and "/a%2Fb" still is not "/a/b".
   */
  public static normalizePathSpelling(path: string, asRead?: boolean): string {
    if (!SPELLED_CHARACTER.test(path)) {
      return path;
    }

    try {
      let spelled: string = "";
      // The words since the last escape kept as written, decoded.
      let words: string = "";
      let index: number = 0;

      while (index < path.length) {
        const escape: string = path.slice(index, index + 3);

        if (!ESCAPED_BYTE.test(escape)) {
          words += path.charAt(index);
          index += 1;
          continue;
        }

        // A character's escapes: 2 to 4 bytes, as many as its first says.
        const lead: number = parseInt(escape.slice(1), 16);
        const length: number =
          lead < 0xc2 ? 0 : lead < 0xe0 ? 6 : lead < 0xf0 ? 9 : 12;
        let character: string = "";

        try {
          character = length
            ? decodeURIComponent(path.slice(index, index + length))
            : "";
        } catch {
          // Not UTF-8: cut short, written too long, a surrogate.
        }

        if (BEYOND_ASCII.test(character.normalize("NFC"))) {
          words += character;
          index += length;
          continue;
        }

        spelled += UrlScrubber.spellWords(words, asRead) + escape.toUpperCase();
        words = "";
        index += 3;
      }

      return spelled + UrlScrubber.spellWords(words, asRead);
    } catch {
      // A lone surrogate, which only a path the parser never read holds.
      return path;
    }
  }

  // Composed, and every character beyond ASCII escaped as the parser does.
  private static spellWords(words: string, asRead?: boolean): string {
    const composed: string = words.normalize("NFC");

    return asRead
      ? composed
      : composed.replace(NON_ASCII_RUN, (run: string): string => {
          return encodeURIComponent(run);
        });
  }

  /*
   * Replace identifier-shaped segments, preserving route structure, in
   * the path's one spelling (normalizePathSpelling).
   */
  public static scrubPath(pathname: string): string {
    if (!pathname || pathname === "/") {
      return pathname || "/";
    }

    const segments: Array<string> =
      UrlScrubber.normalizePathSpelling(pathname).split("/");

    const scrubbed: Array<string> = segments.map((segment: string): string => {
      let decoded: string = segment;

      /*
       * Decode before matching so a percent-encoded email
       * (name%40example.com) is still recognised, and once more, so one an
       * application escaped twice (name%2540example.com) is too (#8385). A
       * malformed escape sequence throws, in which case the text is matched
       * as it is.
       */
      for (let pass: number = 0; pass < 2; pass++) {
        try {
          decoded = decodeURIComponent(decoded);
        } catch {
          // Matched as it is.
        }

        if (
          UUID_SEGMENT.test(decoded) ||
          OBJECT_ID_SEGMENT.test(decoded) ||
          EMAIL_SEGMENT.test(decoded) ||
          LONG_DIGIT_SEGMENT.test(decoded) ||
          OPAQUE_TOKEN_SEGMENT.test(decoded) ||
          JWT_SEGMENT.test(decoded)
        ) {
          return REDACTED;
        }
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
   * The page a URL is, without its origin or query: the scrubbed path and,
   * for a hash router, the route scrub keeps ("/#/orders/[redacted]",
   * "/app/#!/cart"). The refresh-rage log compares it across page loads,
   * and the support bundle names the page by it.
   *
   * The path alone was the page before: every route of a hash-routed app
   * has the path "/", so a full load of #/a and then of #/b was counted as
   * two reloads of one page, and raised refresh rage.
   */
  public static getScrubbedPage(rawUrl: string): string {
    const scrubbed: string = UrlScrubber.scrub(rawUrl);

    if (!scrubbed || scrubbed === REDACTED) {
      return REDACTED;
    }

    try {
      const parsed: URL = new URL(scrubbed, "https://redacted.invalid");
      return parsed.pathname + parsed.hash;
    } catch {
      return REDACTED;
    }
  }
}
