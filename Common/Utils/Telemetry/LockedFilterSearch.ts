import { LockedFilterDetail } from "../../Types/Telemetry/LockedFilterDetail";
import { buildSearchTokenValue } from "../../Types/Telemetry/TelemetrySearchQuery";
import { escapeWildcards } from "../../Types/BaseDatabase/WildcardPattern";
import {
  DictionaryFilterOperator,
  detectOperatorFromValue,
} from "../../UI/Components/Dictionary/DictionaryFilterOperator";

/*
 * Turn a locked filter chip back into the search-bar syntax of the explorer
 * it belongs to, so a reader can copy the filters a resource page pinned and
 * paste them into the main Logs / Traces / Metrics page.
 *
 * The grammar is the shared one in Types/Telemetry/TelemetrySearchQuery; what
 * differs per signal is which top-level columns have a field token at all:
 *
 *   logs     @<attr>:<v>  trace:<id>  span:<id>  service:<entity id>  severity:<level>
 *   traces   @<attr>:<v>  trace:<id>  span:<id>  service:<entity id>
 *            status:<code>  kind:<enum>  hasexception:<bool>  name:<text>  statusmessage:<text>
 *   metrics  @<attr>:<v>
 *
 * `service:` carries the ENTITY ID on logs and traces — both explorers filter
 * the polymorphic `primaryEntityId` column and accept an id verbatim — and is
 * deliberately absent on metrics, whose `service:` token matches Service rows
 * by NAME and would turn an id into an empty result. Values are escaped by
 * the grammar's own {@link buildSearchTokenValue} so a literal `*`, `?`, a
 * quote or a leading operator character means itself.
 */

export type TelemetrySignal = "logs" | "traces" | "metrics";

/** Human name of each explorer, for button labels and tooltips. */
export const TELEMETRY_EXPLORER_LABELS: Readonly<
  Record<TelemetrySignal, string>
> = {
  logs: "Logs",
  traces: "Traces",
  metrics: "Metrics",
};

const ATTRIBUTE_FACET_PREFIX: string = "attributes.";

/*
 * A search token KEY is read up to the first colon, ends at whitespace and
 * cannot be quoted, and a leading `@` / `-` is grammar — so a key carrying
 * any of those cannot ride a token at all.
 */
const UNSAFE_KEY_CHARACTERS: RegExp = /[\s":]/;

/*
 * Field tokens per signal, keyed by the chip's facetKey. Only columns whose
 * value is accepted verbatim by the target explorer are listed.
 *
 * The traces columns beyond the ids are the ones a stored span query (an
 * incident's or monitor's snapshot) pins, and each takes the chip's raw
 * value as-is: `status:` resolves the numeric status code the chip carries
 * (toSpanStatusCode), `kind:` passes an OTel enum string through
 * (toSpanKind), `hasexception:` reads "true" / "false", and `name:` /
 * `statusmessage:` match a single value as a substring exactly as the stored
 * query does (TEXT_CHIP_FIELDS in TracesViewer) — several values of one
 * column match exactly on both sides too.
 */
const FIELD_TOKENS_BY_SIGNAL: Readonly<
  Record<TelemetrySignal, Readonly<Record<string, string>>>
> = {
  logs: {
    traceId: "trace",
    spanId: "span",
    severityText: "severity",
    primaryEntityId: "service",
    serviceId: "service",
  },
  traces: {
    traceId: "trace",
    spanId: "span",
    primaryEntityId: "service",
    serviceId: "service",
    statusCode: "status",
    kind: "kind",
    hasException: "hasexception",
    name: "name",
    statusMessage: "statusmessage",
  },
  metrics: {},
};

type IsSearchTokenSafeKeyFunction = (key: string) => boolean;

/** Whether an attribute key can be the key of an `@key:value` token. */
export const isSearchTokenSafeKey: IsSearchTokenSafeKeyFunction = (
  key: string,
): boolean => {
  if (key.length === 0) {
    return false;
  }

  if (UNSAFE_KEY_CHARACTERS.test(key)) {
    return false;
  }

  if (key.startsWith("@") || key.startsWith("-")) {
    return false;
  }

  return true;
};

type BuildSearchTokenForFilterFunction = (
  signal: TelemetrySignal,
  facetKey: string,
  value: string,
) => string | null;

/**
 * The search token that reproduces one chip on the explorer for `signal`, or
 * null when that explorer's grammar has no token for the chip's column (a
 * session id, a metrics service id, an unsafe attribute key, an empty value).
 */
export const buildSearchTokenForFilter: BuildSearchTokenForFilterFunction = (
  signal: TelemetrySignal,
  facetKey: string,
  value: string,
): string | null => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  if (facetKey.startsWith(ATTRIBUTE_FACET_PREFIX)) {
    const attributeKey: string = facetKey.substring(
      ATTRIBUTE_FACET_PREFIX.length,
    );

    if (!isSearchTokenSafeKey(attributeKey)) {
      return null;
    }

    return `@${attributeKey}:${buildSearchTokenValue(value)}`;
  }

  const fieldToken: string | undefined =
    FIELD_TOKENS_BY_SIGNAL[signal][facetKey];

  if (!fieldToken) {
    return null;
  }

  return `${fieldToken}:${buildSearchTokenValue(value)}`;
};

/*
 * The list grammar splits `(a OR b)` on `,` and on ` OR ` without looking at
 * quotes, so an entry carrying either cannot be spelled inside a list at all.
 */
const LIST_UNSAFE_ENTRY: RegExp = /,|\s+OR\s+/i;

const QUOTE_REGEX: RegExp = /(")/g;
const LEADING_OPERATOR_REGEX: RegExp = /^([-~!<>])/;
const WRAPPED_LIST_REGEX: RegExp = /^(\()(.*)(\))$|^(\[)(.*)(\])$/;
const WHITESPACE_REGEX: RegExp = /\s/;

type RenderGlobFunction = (glob: string) => string;

/*
 * A glob rendered as a token value: quotes, a leading operator character and
 * a wrapping bracket pair are escaped exactly as {@link buildSearchTokenValue}
 * escapes them, but `*` and `?` are LEFT ALONE — they are the point of the
 * glob. Quotes protect spaces, not wildcards, so a glob with a space is
 * quoted and still matches as a pattern.
 */
const renderGlob: RenderGlobFunction = (glob: string): string => {
  const escaped: string = glob
    .replace(QUOTE_REGEX, "\\$1")
    .replace(LEADING_OPERATOR_REGEX, "\\$1")
    .replace(WRAPPED_LIST_REGEX, "\\$&");

  return WHITESPACE_REGEX.test(escaped) ? `"${escaped}"` : escaped;
};

type RenderListFunction = (
  entries: Array<string>,
  render: (entry: string) => string,
) => string | null;

/*
 * `(a OR b)` — one entry is written bare (the parser reads a one-entry list
 * as plain equality anyway), and an entry the list grammar would split in
 * two makes the whole list unspellable.
 */
const renderList: RenderListFunction = (
  entries: Array<string>,
  render: (entry: string) => string,
): string | null => {
  const meaningful: Array<string> = entries.filter((entry: string): boolean => {
    return entry.length > 0;
  });

  if (meaningful.length === 0) {
    return null;
  }

  if (
    meaningful.some((entry: string): boolean => {
      return LIST_UNSAFE_ENTRY.test(entry);
    })
  ) {
    return null;
  }

  if (meaningful.length === 1) {
    return render(meaningful[0]!);
  }

  return `(${meaningful.map(render).join(" OR ")})`;
};

const GLOB_SEPARATOR: string = " OR ";

type SplitGlobsFunction = (value: string) => Array<string>;

/*
 * The attribute filter form stores several globs joined by " OR " (see
 * DictionaryFilterOperator.joinGlobs); the same split recovers them.
 */
const splitGlobs: SplitGlobsFunction = (value: string): Array<string> => {
  return value
    .split(GLOB_SEPARATOR)
    .map((glob: string): string => {
      return glob.trim();
    })
    .filter((glob: string): boolean => {
      return glob.length > 0;
    });
};

type BuildSearchTokenForOperatorValueFunction = (
  attributeKey: string,
  value: unknown,
) => string | null;

/**
 * The `@key:value` token — negated as `-@key:value` where the grammar puts
 * the negation on the token — that reproduces an attribute filter pinned
 * with an OPERATOR: the shape a log monitor's criteria or an incident's
 * stored query hands the viewer (`Includes`, `Search`, `NotEqual`, ...).
 *
 * Every operator the attribute filter form offers has a spelling in the
 * shared grammar, and the explorer compiles that spelling to the same
 * predicate class the form stored:
 *
 *   equals            @k:v            not equal        @k:!v
 *   contains          @k:~v           not contains     -@k:~v
 *   starts with       @k:v*           ends with        @k:*v
 *   matches           @k:g            not matches      -@k:g
 *   is any of         @k:(a OR b)     is none of       -@k:(a OR b)
 *   > >= < <=         @k:>n ...       is empty         -@k:*
 *   is not empty      @k:*
 *
 * Literal parts go through the grammar's own escaping, so a literal that
 * starts with `~` or carries a `*` still means itself; a glob keeps its
 * wildcards. Null for a shape the grammar cannot spell: an array of several
 * operators on one key, a list entry the list grammar would split, an unsafe
 * key, an empty value.
 */
export const buildSearchTokenForOperatorValue: BuildSearchTokenForOperatorValueFunction =
  (attributeKey: string, value: unknown): string | null => {
    if (!isSearchTokenSafeKey(attributeKey)) {
      return null;
    }

    if (value === undefined || value === null || Array.isArray(value)) {
      return null;
    }

    const detected: ReturnType<typeof detectOperatorFromValue> =
      detectOperatorFromValue(value);
    const literal: string = detected.rawValue;
    const entries: Array<string> = detected.rawValues || [];

    const positive: (rendered: string) => string = (
      rendered: string,
    ): string => {
      return `@${attributeKey}:${rendered}`;
    };
    const negative: (rendered: string) => string = (
      rendered: string,
    ): string => {
      return `-@${attributeKey}:${rendered}`;
    };

    switch (detected.operator) {
      case DictionaryFilterOperator.EqualTo:
        return literal.length > 0
          ? positive(buildSearchTokenValue(literal))
          : null;
      case DictionaryFilterOperator.NotEqual:
        return literal.length > 0
          ? positive(`!${buildSearchTokenValue(literal)}`)
          : null;
      case DictionaryFilterOperator.Contains:
        return literal.length > 0
          ? positive(`~${buildSearchTokenValue(literal)}`)
          : null;
      case DictionaryFilterOperator.NotContains:
        return literal.length > 0
          ? negative(`~${buildSearchTokenValue(literal)}`)
          : null;
      case DictionaryFilterOperator.StartsWith:
        return literal.length > 0
          ? positive(renderGlob(`${escapeWildcards(literal)}*`))
          : null;
      case DictionaryFilterOperator.EndsWith:
        return literal.length > 0
          ? positive(renderGlob(`*${escapeWildcards(literal)}`))
          : null;
      case DictionaryFilterOperator.Matches: {
        // The form joins several globs with " OR "; split them back apart.
        const rendered: string | null = renderList(
          splitGlobs(literal),
          renderGlob,
        );
        return rendered ? positive(rendered) : null;
      }
      case DictionaryFilterOperator.NotMatches: {
        const rendered: string | null = renderList(
          splitGlobs(literal),
          renderGlob,
        );
        return rendered ? negative(rendered) : null;
      }
      case DictionaryFilterOperator.IsAnyOf: {
        const rendered: string | null = renderList(
          entries,
          buildSearchTokenValue,
        );
        return rendered ? positive(rendered) : null;
      }
      case DictionaryFilterOperator.IsNoneOf: {
        const rendered: string | null = renderList(
          entries,
          buildSearchTokenValue,
        );
        return rendered ? negative(rendered) : null;
      }
      case DictionaryFilterOperator.GreaterThan:
        return literal.length > 0
          ? positive(`>${buildSearchTokenValue(literal)}`)
          : null;
      case DictionaryFilterOperator.GreaterThanOrEqual:
        return literal.length > 0
          ? positive(`>=${buildSearchTokenValue(literal)}`)
          : null;
      case DictionaryFilterOperator.LessThan:
        return literal.length > 0
          ? positive(`<${buildSearchTokenValue(literal)}`)
          : null;
      case DictionaryFilterOperator.LessThanOrEqual:
        return literal.length > 0
          ? positive(`<=${buildSearchTokenValue(literal)}`)
          : null;
      case DictionaryFilterOperator.IsEmpty:
        return negative("*");
      case DictionaryFilterOperator.IsNotEmpty:
        return positive("*");
      default:
        return null;
    }
  };

/** The subset of a chip this module reads. */
export interface SearchableLockedFilter {
  facetKey: string;
  value: string;
  lockedDetail?: LockedFilterDetail | undefined;
}

type BuildSearchTextForFiltersFunction = (
  signal: TelemetrySignal,
  filters: Array<SearchableLockedFilter>,
) => string;

/**
 * The search-bar text that reproduces every given locked chip at once —
 * tokens joined by single spaces, duplicates dropped, order kept.
 *
 * A chip that carries a {@link LockedFilterDetail} is trusted on its own
 * `searchToken` (present or deliberately absent — a filter the grammar
 * cannot spell has none, and re-deriving one from the chip's display text
 * would produce a token that filters on the wrong thing). A chip without one
 * falls back to the column rules above.
 */
export const buildSearchTextForFilters: BuildSearchTextForFiltersFunction = (
  signal: TelemetrySignal,
  filters: Array<SearchableLockedFilter>,
): string => {
  const tokens: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const filter of filters) {
    const token: string | null = filter.lockedDetail
      ? filter.lockedDetail.searchToken || null
      : buildSearchTokenForFilter(signal, filter.facetKey, filter.value);

    if (!token || seen.has(token)) {
      continue;
    }

    seen.add(token);
    tokens.push(token);
  }

  return tokens.join(" ");
};
