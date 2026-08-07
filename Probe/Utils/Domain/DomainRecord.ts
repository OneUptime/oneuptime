import DomainLookupMethod from "Common/Types/Monitor/DomainMonitor/DomainLookupMethod";

const WHITESPACE_PATTERN: RegExp = /\s/;
const LOWERCASE_WORD_PATTERN: RegExp = /^[a-z]+$/;
const IPV4_PATTERN: RegExp = /^[0-9.]+$/;
const URL_PATTERN: RegExp = /\bhttps?:\/\/\S+/gi;
const COMPACT_DATE_PATTERN: RegExp = /^(\d{4})(\d{2})(\d{2})$/;
const DAY_FIRST_DATE_PATTERN: RegExp =
  /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

const NOT_REGISTERED_STATUSES: Set<string> = new Set<string>([
  "free",
  "available",
  "notregistered",
  "noobjectfound",
  "nomatch",
  "notfound",
  "nonexistent",
]);

/*
 * EPP statuses (RFC 5731) and the registry-specific phrases seen in the wild,
 * spelled out the way RDAP and the phrase-emitting WHOIS servers write them.
 * Longest first so a greedy scan consumes the most specific match.
 */
const SPELLED_OUT_STATUS_PHRASES: Array<string> = [
  "client delete prohibited",
  "client hold",
  "client renew prohibited",
  "client transfer prohibited",
  "client update prohibited",
  "server delete prohibited",
  "server hold",
  "server renew prohibited",
  "server transfer prohibited",
  "server update prohibited",
  "pending create",
  "pending delete",
  "pending renew",
  "pending restore",
  "pending transfer",
  "pending update",
  "add period",
  "auto renew period",
  "redemption period",
  "renew period",
  "transfer period",
  "associated",
  "paid and in zone",
  "sponsoring registrar change forbidden",
  "delete candidate",
  "not delegated",
  "no object found",
  "in transit",
  "outzone",
  "expired",
  "inactive",
  "active",
  "connect",
  "ok",
  "free",
]
  .slice()
  .sort((a: string, b: string) => {
    return b.length - a.length;
  });

/*
 * The registration facts a domain monitor cares about, normalized away from
 * whichever protocol produced them. RDAP and WHOIS both reduce to this shape
 * so that a monitor's criteria keep matching when Auto flips between the two
 * (which it does per-TLD, and on fallback).
 */
export interface DomainRecord {
  domainName?: string | undefined;
  registrar?: string | undefined;
  registrarUrl?: string | undefined;
  createdDate?: string | undefined;
  updatedDate?: string | undefined;
  expiresDate?: string | undefined;
  nameServers?: Array<string> | undefined;
  dnssec?: string | undefined;
  domainStatus?: Array<string> | undefined;
}

export interface DomainLookupResult {
  record: DomainRecord;
  lookupMethod: DomainLookupMethod;
  // Only set when RDAP answered - which registry endpoint served the record.
  rdapServerUrl?: string | undefined;
}

export class DomainRecordUtil {
  /*
   * A WHOIS server that has been retired but is still listening answers with
   * boilerplate - "TLD is not supported.", a terms-of-use blob - and no
   * registration fields at all. That parses without throwing, which is how an
   * unmonitorable domain used to be reported as a healthy one. A response
   * carrying none of these fields is not a registration record.
   */
  public static hasRegistrationData(record: DomainRecord): boolean {
    /*
     * DENIC and friends answer an unregistered name with the name echoed
     * back plus "Status: free". That has fields, but it is the opposite of a
     * registration - reporting it as healthy would reproduce the very bug
     * this guard exists to catch, on a domain that has actually been lost.
     */
    if (DomainRecordUtil.isNotRegisteredStatus(record.domainStatus)) {
      return false;
    }

    return Boolean(
      record.domainName ||
        record.registrar ||
        record.createdDate ||
        record.updatedDate ||
        record.expiresDate ||
        (record.nameServers && record.nameServers.length > 0) ||
        (record.domainStatus && record.domainStatus.length > 0),
    );
  }

  /*
   * Statuses that mean "there is no registration here". Registries word this
   * differently - DENIC "free", others "available", "No Object Found" - and
   * whois-json may hand any of them over as separate tokens, so the joined
   * form is checked too.
   */
  public static isNotRegisteredStatus(
    statuses: Array<string> | undefined,
  ): boolean {
    if (!statuses || statuses.length === 0) {
      return false;
    }

    const joined: string = statuses.join("").toLowerCase();

    if (NOT_REGISTERED_STATUSES.has(joined)) {
      return true;
    }

    return statuses.some((status: string) => {
      return NOT_REGISTERED_STATUSES.has(status.toLowerCase());
    });
  }

  /*
   * Dates are stored as strings and read back with `new Date(...)` by the
   * expiry criteria. WHOIS emits a dozen formats and RDAP emits RFC 3339, so
   * everything is normalized to ISO 8601 here.
   *
   * A value that cannot be parsed is DROPPED rather than passed through.
   * Handing the criteria a string they turn into an Invalid Date is worse
   * than having no date at all: NaN comparisons are all false, so
   * "expires in less than 30 days" would never fire and "is expired = false"
   * would answer "not expired" forever, on a domain that had already lapsed.
   */
  public static normalizeDate(value: unknown): string | undefined {
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? undefined : value.toISOString();
    }

    if (typeof value !== "string") {
      return undefined;
    }

    const trimmed: string = value.trim();

    if (!trimmed) {
      return undefined;
    }

    // registro.br appends a record id: "19960424 #7137".
    const cleaned: string = trimmed.replace(/\s+#\S+$/, "");

    const parsed: Date = new Date(cleaned);

    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }

    const fallback: Date | null = DomainRecordUtil.parseRegistryDate(cleaned);

    return fallback ? fallback.toISOString() : undefined;
  }

  /*
   * Only reached for strings the built-in parser already rejected, so these
   * patterns cannot change the meaning of anything it accepts. Both are
   * unambiguous: YYYYMMDD (registro.br) and day-first with a 4-digit year
   * (.hk "16-11-2035", .fi "31.8.2027 00:00:00").
   */
  private static parseRegistryDate(value: string): Date | null {
    const compact: RegExpExecArray | null = COMPACT_DATE_PATTERN.exec(value);

    if (compact) {
      return DomainRecordUtil.buildUtcDate({
        year: Number(compact[1]),
        month: Number(compact[2]),
        day: Number(compact[3]),
      });
    }

    const dayFirst: RegExpExecArray | null = DAY_FIRST_DATE_PATTERN.exec(value);

    if (dayFirst) {
      return DomainRecordUtil.buildUtcDate({
        year: Number(dayFirst[3]),
        month: Number(dayFirst[2]),
        day: Number(dayFirst[1]),
        hour: dayFirst[4] ? Number(dayFirst[4]) : 0,
        minute: dayFirst[5] ? Number(dayFirst[5]) : 0,
        second: dayFirst[6] ? Number(dayFirst[6]) : 0,
      });
    }

    return null;
  }

  private static buildUtcDate(parts: {
    year: number;
    month: number;
    day: number;
    hour?: number;
    minute?: number;
    second?: number;
  }): Date | null {
    if (
      parts.month < 1 ||
      parts.month > 12 ||
      parts.day < 1 ||
      parts.day > 31
    ) {
      return null;
    }

    const date: Date = new Date(
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour || 0,
        parts.minute || 0,
        parts.second || 0,
      ),
    );

    // Date.UTC rolls over out-of-range days (Feb 31 -> Mar 3); reject those.
    if (
      date.getUTCFullYear() !== parts.year ||
      date.getUTCMonth() !== parts.month - 1 ||
      date.getUTCDate() !== parts.day
    ) {
      return null;
    }

    return date;
  }

  public static normalizeNameServers(
    values: Array<string | undefined>,
  ): Array<string> {
    const hosts: Set<string> = new Set<string>();

    for (const value of values) {
      if (!value) {
        continue;
      }

      const host: string = value.trim().toLowerCase().replace(/\.$/, "");

      // Registries pad the host with its glue addresses on the same line.
      if (!host || DomainRecordUtil.looksLikeIpAddress(host)) {
        continue;
      }

      hosts.add(host);
    }

    return Array.from(hosts);
  }

  /*
   * RDAP publishes EPP statuses spelled out with spaces ("client transfer
   * prohibited") while WHOIS emits the EPP name itself
   * ("clientTransferProhibited https://icann.org/epp#..."). Criteria are plain
   * string comparisons, so both are folded to the EPP name - otherwise the
   * same monitor would stop matching the moment Auto picked the other
   * protocol.
   */
  public static normalizeDomainStatus(value: string): string {
    // Drop the EPP status URL that registries append.
    const withoutUrl: string = value.replace(/\bhttps?:\/\/\S+/gi, "").trim();

    if (!withoutUrl) {
      return "";
    }

    if (!WHITESPACE_PATTERN.test(withoutUrl)) {
      return withoutUrl;
    }

    return withoutUrl
      .split(/\s+/)
      .map((word: string, index: number) => {
        const lower: string = word.toLowerCase();

        if (index === 0) {
          return lower;
        }

        return lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join("");
  }

  public static normalizeDomainStatuses(
    values: Array<string | undefined>,
  ): Array<string> {
    const statuses: Set<string> = new Set<string>();

    for (const value of values) {
      if (!value) {
        continue;
      }

      const normalized: string = DomainRecordUtil.normalizeDomainStatus(value);

      if (normalized) {
        statuses.add(normalized);
      }
    }

    return Array.from(statuses);
  }

  /*
   * WHOIS status arrives as one blob: whois-json joins every repeated
   * "Domain Status:" line with a space, so several statuses share a segment.
   * Two shapes have to come out of that correctly:
   *
   *   gTLD    "clientDeleteProhibited https://... clientTransferProhibited https://..."
   *   ccTLD   "paid and in zone server delete prohibited"   (two CZ.NIC lines)
   *
   * The first is recovered by cutting at the EPP status URLs that separate
   * the entries. The second cannot be cut on whitespace - that would fuse or
   * shred it - so spelled-out statuses are matched greedily against a table
   * of the phrases registries actually emit.
   */
  public static parseWhoisDomainStatus(
    value: string | Array<string> | undefined,
  ): Array<string> {
    if (!value) {
      return [];
    }

    const segments: Array<string> = Array.isArray(value)
      ? value
      : value.split(/[\n,;]+/);

    const phrases: Array<string> = [];

    for (const segment of segments) {
      /*
       * Parentheses hold a separate status (".ee: ok (paid and in zone)"),
       * and every EPP URL marks the end of the entry before it.
       */
      const pieces: Array<string> = segment
        .replace(URL_PATTERN, " ")
        .replace(/[()[\]]/g, " ")
        .split(" ");

      for (const piece of pieces) {
        phrases.push(...DomainRecordUtil.splitStatusPiece(piece));
      }
    }

    return DomainRecordUtil.normalizeDomainStatuses(phrases);
  }

  private static splitStatusPiece(piece: string): Array<string> {
    let remaining: string = piece.trim().replace(/\s+/g, " ");

    if (!remaining) {
      return [];
    }

    const found: Array<string> = [];

    /*
     * Consume known spelled-out phrases from the front, longest first, so
     * "paid and in zone server delete prohibited" yields two statuses rather
     * than one nonsense value.
     */
    let matchedSomething: boolean = true;

    while (remaining && matchedSomething) {
      matchedSomething = false;

      for (const phrase of SPELLED_OUT_STATUS_PHRASES) {
        const lower: string = remaining.toLowerCase();

        if (lower === phrase || lower.startsWith(`${phrase} `)) {
          found.push(remaining.slice(0, phrase.length));
          remaining = remaining.slice(phrase.length).trim();
          matchedSomething = true;
          break;
        }
      }
    }

    if (!remaining) {
      return found;
    }

    const tokens: Array<string> = remaining.split(" ");

    /*
     * Whatever is left is either a run of EPP names ("clientDeleteProhibited
     * clientTransferProhibited") or one unknown lowercase phrase. Keep the
     * old heuristic for that tail.
     */
    const isSpelledOutPhrase: boolean =
      tokens.length > 1 &&
      tokens.every((token: string) => {
        return LOWERCASE_WORD_PATTERN.test(token);
      });

    if (isSpelledOutPhrase) {
      found.push(remaining);
    } else {
      found.push(...tokens);
    }

    return found;
  }

  public static parseWhoisNameServers(
    value: string | Array<string> | undefined,
  ): Array<string> {
    if (!value) {
      return [];
    }

    const tokens: Array<string> = Array.isArray(value)
      ? value.flatMap((entry: string) => {
          return entry.split(/[\s,]+/);
        })
      : value.split(/[\s,]+/);

    return DomainRecordUtil.normalizeNameServers(tokens);
  }

  private static looksLikeIpAddress(value: string): boolean {
    // IPv4, or anything with a colon (IPv6 / host:port), is glue, not a host.
    return IPV4_PATTERN.test(value) || value.includes(":");
  }
}
