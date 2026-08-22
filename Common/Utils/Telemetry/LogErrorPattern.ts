/*
 * Error-message clustering for the Logs Insights surface.
 *
 * "30 x connection refused" is only a useful headline if the thirty raw
 * bodies — each carrying its own timestamp, request id, port and latency —
 * collapse onto one row. That collapse is a normalization: every span of
 * text that varies per occurrence is rewritten to a placeholder, and what
 * remains is the pattern the occurrences share.
 *
 * The rule table below is the single source of truth for that rewrite. It
 * is consumed twice:
 *
 *   - by `normalizeLogBodyToErrorPattern` here, in plain JavaScript, for
 *     client-side previews and for the test suite; and
 *   - by Common/Server/Utils/Telemetry/LogErrorPatternSql, which compiles
 *     the same rules into a nest of ClickHouse `replaceRegexpAll` calls so
 *     the GROUP BY happens in the database over the whole window rather
 *     than over a sampled page of rows.
 *
 * Because both readers share this table they cannot drift apart, and every
 * pattern here is therefore restricted to the syntax BOTH engines accept:
 * RE2 (ClickHouse) has no lookaround and no backreferences, so rules use
 * only character classes, quantifiers, alternation and `\b`.
 *
 * Rule ORDER is part of the contract — rules apply in sequence, each over
 * the output of the last:
 *
 *   1. timestamps first, because their digits and dashes would otherwise be
 *      shredded by the numeric rule into an unrecognizable shape;
 *   2. URLs before emails and IPs, so `https://user@10.0.0.1/x` collapses
 *      to one `<url>` instead of three overlapping placeholders;
 *   3. long hex runs before numbers, so a trace id stays one token;
 *   4. numbers last of the value rules, as the catch-all;
 *   5. whitespace collapse at the end, which is also what flattens a
 *      multi-line stack trace into a single groupable line.
 */

export interface LogErrorPatternRule {
  /** Stable identifier — used by tests and by the SQL compiler's comments. */
  name: string;
  /**
   * Regular expression source accepted by BOTH the JavaScript engine and
   * RE2. Applied globally (every match is replaced).
   */
  pattern: string;
  /** Literal replacement text. Never contains `$` or `\` — see below. */
  replacement: string;
}

/**
 * The normalization rules, in application order. See the file header for
 * why the order matters.
 *
 * Replacements are deliberately plain literals: `String.replace` treats
 * `$&`/`$1` in a replacement specially and ClickHouse treats `\1`
 * specially, so keeping them free of both characters means the two engines
 * substitute identical text.
 */
export const LOG_ERROR_PATTERN_RULES: Array<LogErrorPatternRule> = [
  {
    name: "timestamp",
    pattern:
      "\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:?\\d{2})?",
    replacement: "<timestamp>",
  },
  {
    name: "uuid",
    pattern:
      "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
    replacement: "<uuid>",
  },
  {
    /*
     * Before `email` and `ip`: a URL can contain both, and the whole URL is
     * the varying part.
     */
    name: "url",
    pattern: "[a-zA-Z][a-zA-Z0-9+.-]*://[^\\s\"'<>]+",
    replacement: "<url>",
  },
  {
    name: "email",
    pattern: "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}",
    replacement: "<email>",
  },
  {
    name: "ip",
    pattern: "\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}",
    replacement: "<ip>",
  },
  {
    /*
     * Trace ids, span ids, content hashes, object ids. 16 is the shortest
     * run this fires on so ordinary hex-looking words ("deadbeef", "cafe")
     * survive as themselves.
     */
    name: "hex",
    pattern: "\\b[0-9a-fA-F]{16,}\\b",
    replacement: "<hex>",
  },
  /*
   * DELIBERATELY NO "mask any quoted span" RULE HERE.
   *
   * A `"[^"]*"` -> `"<str>"` rule looks reasonable on prose like
   * `unknown field "customerRef"`, and it is catastrophic on structured
   * logs. In JSON and logfmt — the two commonest shapes there are — the
   * human-readable message IS a quoted value, so such a rule masks the only
   * part that identifies the error:
   *
   *   {"level":"error","msg":"connection refused","attempt":3}
   *   {"level":"error","msg":"permission denied","attempt":3}
   *
   * would both collapse to `{"<str>":"<str>","<str>":"<str>","<str>":<num>}`,
   * summing two unrelated failures into one Top Errors row headed by
   * whichever sample body argMax happened to pick.
   *
   * Nothing is lost by leaving it out: every quoted span that genuinely
   * VARIES is a uuid, number, ip, url, timestamp, hex id or email, and the
   * rules above already mask those — more informatively, since `"<uuid>"`
   * says more than `"<str>"`. All such a rule uniquely added was collapsing
   * quoted WORDS, which is exactly the destructive case. Two different
   * quoted field names therefore stay two rows: under-collapsing is the
   * safe direction, because a split incident is still visible while a
   * merged one is hidden.
   */
  {
    name: "number",
    pattern: "\\d+(\\.\\d+)?",
    replacement: "<num>",
  },
  {
    /*
     * Last: collapses the newlines and indentation of a stack trace onto
     * one line so the truncation below keeps the exception type and the
     * top frames — the part that identifies the error.
     */
    name: "whitespace",
    pattern: "\\s+",
    replacement: " ",
  },
];

/**
 * Longest pattern kept, in characters.
 *
 * A stack trace normalizes to a very long single line; grouping on the
 * whole thing would split occurrences whose tails differ (different frame
 * counts, different truncation by the emitting library) while adding
 * nothing to what identifies the error. 300 characters comfortably covers
 * an exception type plus its first frames.
 */
export const LOG_ERROR_PATTERN_MAX_LENGTH: number = 300;

/**
 * The placeholders the rules can emit. Exported so consumers (the deep-link
 * builder below, the UI's pattern renderer) can recognize the variable
 * spans without re-deriving them from the rule table.
 */
export const LOG_ERROR_PATTERN_PLACEHOLDERS: Array<string> =
  LOG_ERROR_PATTERN_RULES.filter((rule: LogErrorPatternRule): boolean => {
    return rule.replacement.startsWith("<") && rule.replacement.endsWith(">");
  }).map((rule: LogErrorPatternRule): string => {
    return rule.replacement;
  });

/*
 * Any placeholder token, for splitting a pattern back into its literal
 * spans. Matches the shape every rule's replacement uses rather than being
 * built from the table itself, so a rule added later is understood here
 * without a second edit.
 */
const PLACEHOLDER_TOKEN: RegExp = /<[a-z]+>/g;

/**
 * Collapse one raw log body to its error pattern.
 *
 * Non-string input (a log row can arrive with a null/absent body) yields
 * the empty string rather than throwing, because this runs over rows the
 * caller did not construct.
 */
export function normalizeLogBodyToErrorPattern(
  body: string | undefined | null,
): string {
  if (typeof body !== "string" || body.length === 0) {
    return "";
  }

  let normalized: string = body;

  for (const rule of LOG_ERROR_PATTERN_RULES) {
    /*
     * A replacer function rather than the literal string: it makes the `$`
     * substitution rules of String.replace unreachable, so the replacement
     * text is inserted verbatim exactly as ClickHouse inserts it.
     */
    normalized = normalized.replace(
      new RegExp(rule.pattern, "g"),
      (): string => {
        return rule.replacement;
      },
    );
  }

  normalized = normalized.trim();

  if (normalized.length > LOG_ERROR_PATTERN_MAX_LENGTH) {
    normalized = normalized.slice(0, LOG_ERROR_PATTERN_MAX_LENGTH).trim();
  }

  return normalized;
}

export interface ErrorPatternSearchTextOptions {
  /** Literal runs shorter than this are not selective enough to be useful. */
  minimumLength?: number | undefined;
  /**
   * A real body from the group, when the caller has one. Used to CHECK a
   * candidate rather than to produce it — see below.
   */
  sampleBody?: string | undefined;
}

/*
 * Leading punctuation a placeholder leaves behind — `to <ip>:<num>` splits
 * into `to ` and `:` — so the search text comes out as words, not as the
 * glue between them.
 */
const LEADING_GLUE: RegExp = /^[\s"':,;=([{]+/;

/*
 * Named rather than inlined at the use sites: an inline literal used as
 * `/\s/.test(x)` trips eslint's wrap-regex, whose fix prettier then undoes
 * (the same fight CrossSignalScope documents).
 */
const ANY_WHITESPACE: RegExp = /\s/;
const WHITESPACE_RUN: RegExp = /\s+/;

/**
 * A literal run from the pattern that can be handed to a substring search.
 *
 * This is what turns "Insights says this happened 30 times" into a Logs
 * viewer deep link that actually lists those 30 rows: the viewer filters
 * `body` with a contains-match, which a pattern containing `<num>` would
 * never satisfy.
 *
 * The subtlety is that a pattern is NOT a substring of the body it came
 * from, even between placeholders. The last normalization rule collapses
 * `\s+` to a single space, so any run spanning a line break in the original
 * — every stack trace — reads `is null at com.example.Service.process(` in
 * the pattern where the body has `is null\n\tat com.example...`. Handing
 * that to `body ILIKE '%...%'` matches nothing, landing the user on an
 * empty list: the precise failure this function exists to avoid.
 *
 * So the candidates are ranked longest-first and the first SAFE one wins:
 *
 *  - a whitespace-free token is always safe, because there was no
 *    whitespace inside it to collapse;
 *  - a longer multi-word run is used only when `sampleBody` proves it
 *    survived the collapse verbatim.
 *
 * Returns "" when nothing usable survives (an all-placeholder pattern, or
 * runs too short to be selective), which callers read as "no body filter"
 * rather than as a filter matching everything.
 */
export function getErrorPatternSearchText(
  pattern: string | undefined | null,
  options: ErrorPatternSearchTextOptions | number = {},
): string {
  /*
   * Number form kept for the original `(pattern, minimumLength)` callers.
   */
  const resolved: ErrorPatternSearchTextOptions =
    typeof options === "number" ? { minimumLength: options } : options;

  const minimumLength: number = resolved.minimumLength ?? 4;
  const sampleBody: string =
    typeof resolved.sampleBody === "string" ? resolved.sampleBody : "";

  if (typeof pattern !== "string" || pattern.length === 0) {
    return "";
  }

  const candidates: Array<string> = [];

  for (const segment of pattern.split(PLACEHOLDER_TOKEN)) {
    const run: string = segment.replace(LEADING_GLUE, "").trim();

    if (run.length > 0) {
      // The multi-word run: strongest, but only safe when verified.
      candidates.push(run);
    }

    /*
     * ...and every whitespace-free token inside it, which needs no
     * verification at all.
     */
    for (const token of segment.split(WHITESPACE_RUN)) {
      const trimmed: string = token.replace(LEADING_GLUE, "").trim();

      if (trimmed.length > 0) {
        candidates.push(trimmed);
      }
    }
  }

  candidates.sort((a: string, b: string): number => {
    return b.length - a.length;
  });

  for (const candidate of candidates) {
    if (candidate.length < minimumLength) {
      // Sorted longest-first, so everything after this is too short too.
      break;
    }

    const isSingleToken: boolean = !ANY_WHITESPACE.test(candidate);

    if (isSingleToken) {
      return candidate;
    }

    if (sampleBody.length > 0 && sampleBody.includes(candidate)) {
      return candidate;
    }
  }

  return "";
}

/**
 * A short, single-line label for a pattern, for list rows and chips.
 * Truncation is by characters with an ellipsis; the full pattern stays
 * available for tooltips and for the detail panel.
 */
export function truncateErrorPattern(
  pattern: string | undefined | null,
  maxLength: number,
): string {
  if (typeof pattern !== "string") {
    return "";
  }

  const collapsed: string = pattern.replace(/\s+/g, " ").trim();

  if (maxLength <= 0 || collapsed.length <= maxLength) {
    return collapsed;
  }

  return `${collapsed.slice(0, maxLength).trim()}...`;
}
