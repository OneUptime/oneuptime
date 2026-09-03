/*
 * Origin allowlist matching and validation, shared by every surface that has
 * to decide "is this browser allowed to write into this project?".
 *
 * This module is deliberately PURE and isomorphic - no server imports, no
 * Redis, no models - because the same rules have to hold in three places that
 * cannot share a runtime:
 *
 *   1. the ingest path, where a forged request is rejected,
 *   2. the Dashboard form, where a customer types a pattern and must be told
 *      immediately that it will never match anything,
 *   3. tests, which need to pin the semantics without booting a server.
 *
 * The matching half is NOT new behaviour. It is lifted verbatim from
 * SessionReplayGateCache.isOriginAllowed, which now delegates here, so the
 * two surfaces cannot drift apart - a browser ingestion key that accepts an
 * origin the session-replay gate refuses (or the reverse) would be a
 * confusing and exploitable split.
 *
 * ONE THING IS DELIBERATELY NOT IN HERE: the "empty allowlist means what?"
 * decision. `matches` answers false for an empty list and lets the caller
 * decide, because the two callers need OPPOSITE defaults and encoding either
 * one here would silently break the other:
 *
 *   - session replay ships with an empty allowlist and treats it as "any
 *     origin", so that the feature works the moment a customer pastes the
 *     snippet (see the long comment in SessionReplayGateCache);
 *   - a Browser telemetry ingestion key REQUIRES a non-empty allowlist and
 *     treats empty as "nothing is allowed", because a public key with no
 *     origin binding is exactly the credential we are trying to stop
 *     shipping.
 */
/*
 * Hoisted rather than written inline at each call site: none carries the `g`
 * flag, so `.test` is stateless and one compiled instance is safe to share,
 * and a named constant reads better at the branch than a bare literal.
 */
const WHITESPACE_ANYWHERE: RegExp = /\s/;
const DIGITS_ONLY: RegExp = /^[0-9]+$/;
const HOST_LABEL_CHARACTERS: RegExp = /^[a-z0-9-]+$/;

export default class OriginAllowList {
  /*
   * Canonical form for comparison: trimmed, lowercased, with trailing
   * slashes removed.
   *
   * The trailing-slash strip is here because browsers and hand-written config
   * disagree about it. `window.location.origin` and the `Origin` request
   * header never carry one, but a customer copying a URL out of the address
   * bar almost always pastes "https://app.example.com/". Treating those as
   * different origins produces a silent, total ingest failure whose only
   * symptom is a missing character, which is a miserable thing to debug.
   *
   * All trailing slashes are stripped rather than exactly one: "https://x//"
   * is malformed either way, and collapsing it costs nothing.
   */
  public static normalizeOrigin(origin: string): string {
    if (typeof origin !== "string") {
      return "";
    }

    const trimmed: string = origin.trim().toLowerCase();

    if (!trimmed) {
      return "";
    }

    return trimmed.replace(/\/+$/, "");
  }

  /*
   * Is `origin` covered by `allowList`?
   *
   * Exact origin match, case-insensitive, plus a single leading "*." host
   * wildcard so a customer with per-tenant subdomains does not have to
   * enumerate thousands of them. Deliberately no scheme wildcard and no path
   * matching: an allowlist entry is an origin, and anything looser would
   * defeat the point of having one. The port is part of the origin and must
   * match, so "https://example.com" does not cover "https://example.com:8443".
   *
   * Returns false for an empty allowlist and for a missing/blank origin. The
   * empty-list answer is NOT a policy statement (see the class comment) - it
   * is "this list matched nothing", and the caller decides what that means.
   */
  public static matches(
    origin: string | undefined | null,
    allowList: ReadonlyArray<string>,
  ): boolean {
    if (!allowList || allowList.length === 0) {
      return false;
    }

    if (!origin) {
      return false;
    }

    const normalizedOrigin: string = this.normalizeOrigin(origin);

    if (!normalizedOrigin) {
      return false;
    }

    for (const allowed of allowList) {
      if (typeof allowed !== "string") {
        continue;
      }

      const normalizedAllowed: string = this.normalizeOrigin(allowed);

      if (!normalizedAllowed) {
        continue;
      }

      if (normalizedAllowed === normalizedOrigin) {
        return true;
      }

      const wildcardIndex: number = normalizedAllowed.indexOf("://*.");

      if (wildcardIndex === -1) {
        continue;
      }

      const scheme: string = normalizedAllowed.substring(0, wildcardIndex + 3);
      const suffix: string = normalizedAllowed.substring(wildcardIndex + 4);

      /*
       * `suffix` keeps its leading dot, and the length check requires at
       * least one character of subdomain in front of it. Those two details
       * are the whole security value of this branch:
       *
       *   - keeping the dot stops "https://*.example.com" from matching
       *     "https://evilexample.com", an attacker-registrable domain;
       *   - the length check stops it from matching the bare apex
       *     "https://example.com", which the customer did not list.
       *
       * Do not "simplify" either of them away.
       */
      if (
        normalizedOrigin.startsWith(scheme) &&
        normalizedOrigin.endsWith(suffix) &&
        normalizedOrigin.length > scheme.length + suffix.length
      ) {
        return true;
      }
    }

    return false;
  }

  /*
   * Validate one allowlist PATTERN at the point a human types it, and return
   * a human-readable reason it will never work - or null when it is fine.
   *
   * This is intentionally stricter than `matches` needs it to be. `matches`
   * is a hot-path predicate that quietly answers false for garbage; that is
   * correct at ingest time but terrible at configuration time, where a
   * mistyped entry looks exactly like a working one until production
   * telemetry disappears. Everything below is a case where the customer
   * plainly meant something we will not do.
   *
   * ACCEPTED
   *   https://app.example.com          exact origin
   *   http://localhost:3000            http and an explicit port
   *   https://*.example.com            single leading host wildcard
   *   https://*.example.com:8443       wildcard plus port
   *   https://app.example.com/         one trailing slash (stripped)
   *   http://127.0.0.1:8080            IPv4 literal
   *   http://*.localhost               single-label suffix (dev setups are
   *                                    real; no public-suffix check is
   *                                    attempted because it is wrong more
   *                                    often than right on internal TLDs)
   *
   * REJECTED
   *   ""  /  "   "                     empty
   *   app.example.com                  no scheme - ambiguous, and an origin
   *                                    without a scheme is not an origin
   *   ftp://example.com                non-http(s) scheme
   *   ws://example.com                 ditto - browsers do not send these as
   *                                    the Origin of an ingest request
   *   https://user@example.com         userinfo; the authority must be host
   *                                    (+ optional port) and nothing else
   *   https://example.com/path         path - an Origin header never has one,
   *                                    so this can only ever fail to match
   *   https://example.com?a=b          query
   *   https://example.com#frag         fragment
   *   https://example.com//            more than one trailing slash
   *   https://*                        bare wildcard - "allow the entire
   *                                    internet" is never what was meant, and
   *                                    if it were, the honest way to say it is
   *                                    to leave the list empty
   *   https://*.                       wildcard with no suffix, same problem
   *   https://a.*.example.com          wildcard outside the first label - not
   *                                    supported by `matches`, so it would
   *                                    silently match nothing
   *   https://*example.com             wildcard not followed by a dot; this is
   *                                    the "evilexample.com" trap and is
   *                                    rejected rather than reinterpreted
   *   https://exa mple.com             whitespace inside
   *   https://example.com:0            port out of range
   *   https://example.com:70000        port out of range
   *   https://example.com:abc          non-numeric port
   *   https://example..com             empty label
   *   https://-example.com             label starting or ending with "-"
   *   https://exa_mple.com             character not legal in a hostname
   */
  public static validateOriginPattern(pattern: string): string | null {
    if (typeof pattern !== "string") {
      return "Origin must be text.";
    }

    const trimmed: string = pattern.trim();

    if (!trimmed) {
      return "Origin cannot be empty.";
    }

    /*
     * Whitespace is checked on the TRIMMED value, so surrounding spaces are
     * forgiven (normalizeOrigin drops them anyway) while interior spaces -
     * which are always a typo or a paste of two entries into one field - are
     * refused.
     */
    if (WHITESPACE_ANYWHERE.test(trimmed)) {
      return `"${trimmed}" cannot contain spaces. Enter one origin per entry.`;
    }

    const value: string = trimmed.toLowerCase();

    const schemeSeparatorIndex: number = value.indexOf("://");

    if (schemeSeparatorIndex === -1) {
      return `"${trimmed}" must start with http:// or https://.`;
    }

    const scheme: string = value.substring(0, schemeSeparatorIndex);

    if (scheme !== "http" && scheme !== "https") {
      return `"${trimmed}" must use the http:// or https:// scheme.`;
    }

    let authority: string = value.substring(schemeSeparatorIndex + 3);

    /*
     * Exactly one trailing slash is tolerated and dropped here. Anything else
     * after the authority is rejected below rather than ignored: silently
     * discarding a path would accept "https://example.com/only-this-app" and
     * then match the whole origin, which is looser than what was written.
     */
    if (authority.endsWith("/")) {
      authority = authority.substring(0, authority.length - 1);
    }

    if (!authority) {
      return `"${trimmed}" is missing a host.`;
    }

    if (authority.includes("/")) {
      return `"${trimmed}" must not contain a path. Use just the origin, for example https://app.example.com.`;
    }

    if (authority.includes("?")) {
      return `"${trimmed}" must not contain a query string.`;
    }

    if (authority.includes("#")) {
      return `"${trimmed}" must not contain a fragment.`;
    }

    if (authority.includes("@")) {
      return `"${trimmed}" must not contain a username or password.`;
    }

    let host: string = authority;

    /*
     * Split on the LAST colon so a future IPv6 literal fails on the host
     * charset check below with a clear message, rather than being silently
     * chopped in half at its first colon and reported as a bad port.
     */
    const portSeparatorIndex: number = authority.lastIndexOf(":");

    if (portSeparatorIndex !== -1) {
      host = authority.substring(0, portSeparatorIndex);

      const portText: string = authority.substring(portSeparatorIndex + 1);

      if (!DIGITS_ONLY.test(portText)) {
        return `"${trimmed}" has an invalid port. The port must be a number between 1 and 65535.`;
      }

      const port: number = Number(portText);

      if (port < 1 || port > 65535) {
        return `"${trimmed}" has a port outside the valid range 1-65535.`;
      }
    }

    if (!host) {
      return `"${trimmed}" is missing a host.`;
    }

    let hostWithoutWildcard: string = host;

    if (host.startsWith("*.")) {
      hostWithoutWildcard = host.substring(2);

      if (!hostWithoutWildcard) {
        return `"${trimmed}" needs a domain after the wildcard, for example https://*.example.com.`;
      }
    }

    /*
     * Any remaining "*" is either a bare wildcard host, a wildcard that is not
     * followed by a dot, or a wildcard in a later label. `matches` supports
     * none of those, so accepting them would hand the customer an allowlist
     * entry that matches nothing at all.
     */
    if (hostWithoutWildcard.includes("*")) {
      return `"${trimmed}" may only use a wildcard as the first label, written as "*." - for example https://*.example.com.`;
    }

    const labels: Array<string> = hostWithoutWildcard.split(".");

    for (const label of labels) {
      if (!label) {
        return `"${trimmed}" has an empty part in its host name.`;
      }

      if (!HOST_LABEL_CHARACTERS.test(label)) {
        return `"${trimmed}" contains a character that is not valid in a host name.`;
      }

      if (label.startsWith("-") || label.endsWith("-")) {
        return `"${trimmed}" has a host name part that starts or ends with "-".`;
      }
    }

    return null;
  }
}
