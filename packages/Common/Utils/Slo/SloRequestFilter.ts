import {
  parseSearchQuery,
  SearchToken,
  SearchTokenType,
  SearchValuePredicate,
} from "../../Types/Telemetry/TelemetrySearchQuery";
import { fillTemplate, translationKey } from "../../Types/Translator";

/*
 * WHICH OF ITS SERVICES' REQUESTS A REQUEST SLO COUNTS (#8444).
 *
 * A request SLO counts every entry span of its services. A request filter
 * narrows that to some of them - the checkout endpoint, POST requests, one
 * tenant - or leaves some out, such as health checks that inflate the good
 * count. It is written as a traces search, in the Traces explorer's own
 * grammar (Types/Telemetry/TelemetrySearchQuery), so `@http.route:/checkout*`
 * means here what it means there:
 *
 *   @http.route:/checkout*        an attribute, with a glob
 *   -@http.route:/health          leave these out
 *   @http.request.method:[POST, PUT]   any of these
 *   @http.response.status_code:>=200   a comparison
 *   name:"POST /checkout"         the span's name: its operation
 *
 * Every term must match. Free text is not a filter here - a request has no
 * message - so a term without a key is refused with what to write instead,
 * as is one of the explorer's fields other than the name (`status:error`).
 * The server compiles the terms with the span table's own statement
 * generator (Server/Utils/Slo/SloRequestCounting), so every value is a
 * typed parameter and every operator behaves as the explorer's does.
 */

export const SLO_REQUEST_FILTER_MAX_LENGTH: number = 500;

export const SLO_REQUEST_FILTER_MAX_TERMS: number = 10;

// The span's own field a filter may name, besides its attributes.
export const SLO_REQUEST_FILTER_NAME_FIELD: string = "name";

/*
 * The Traces explorer's own fields (the Dashboard's TRACE_FIELD_ALIAS_MAP,
 * which App/Tests/Dashboard/SloCreateForm holds this list to). Of these a
 * request filter takes only `name`. The others are what a request SLO
 * already decides - its services, the status that makes a request bad, the
 * threshold that makes one slow, entry spans only - so `status:error`
 * copied from the explorer is refused with what to write instead, rather
 * than read as an attribute named "status" that no span has and the SLO
 * waiting for requests that never come. `@status:` is still an attribute.
 */
export const SLO_REQUEST_FILTER_EXPLORER_FIELDS: ReadonlyArray<string> = [
  "service",
  "status",
  "name",
  "trace",
  "span",
  "kind",
  "hasexception",
  "statusmessage",
  "duration",
];

export const SLO_REQUEST_FILTER_ERRORS: {
  tooLong: string;
  tooManyTerms: string;
  freeText: string;
} = {
  tooLong: translationKey(
    "The request filter can be at most {{max}} characters long.",
  ),
  tooManyTerms: translationKey(
    "The request filter can have at most {{max}} terms.",
  ),
  freeText: translationKey(
    'The request filter takes span attributes and the span\'s name, such as @http.route:/checkout* or name:"POST /checkout". "{{text}}" is neither.',
  ),
};

// One term of a filter: an attribute, or the span's name.
export interface SloRequestFilterTerm {
  // The attribute's key ("http.route"), or "name" for the span's name.
  key: string;
  isAttribute: boolean;
  // Already negated for a leading "-": `-@k:v` is NotEquals v.
  predicate: SearchValuePredicate;
}

export interface SloRequestFilterError {
  template: string;
  values: Record<string, string | number>;
}

export interface ParsedSloRequestFilter {
  terms: Array<SloRequestFilterTerm>;
  error: SloRequestFilterError | null;
}

/*
 * The filter as stored: trimmed, or null for no filter. The fingerprint of
 * a request SLO's counting reads this, so "  " and "" count every request.
 */
export const normalizeSloRequestFilter: (
  raw: string | undefined | null,
) => string | null = (raw: string | undefined | null): string | null => {
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed: string = raw.trim();

  return trimmed.length > 0 ? trimmed : null;
};

export const parseSloRequestFilter: (
  raw: string | undefined | null,
) => ParsedSloRequestFilter = (
  raw: string | undefined | null,
): ParsedSloRequestFilter => {
  const filter: string | null = normalizeSloRequestFilter(raw);

  if (!filter) {
    return { terms: [], error: null };
  }

  if (filter.length > SLO_REQUEST_FILTER_MAX_LENGTH) {
    return {
      terms: [],
      error: {
        template: SLO_REQUEST_FILTER_ERRORS.tooLong,
        values: { max: SLO_REQUEST_FILTER_MAX_LENGTH },
      },
    };
  }

  const tokens: Array<SearchToken> = parseSearchQuery(filter, {
    knownFieldKeys: new Set(SLO_REQUEST_FILTER_EXPLORER_FIELDS),
  });

  if (tokens.length > SLO_REQUEST_FILTER_MAX_TERMS) {
    return {
      terms: [],
      error: {
        template: SLO_REQUEST_FILTER_ERRORS.tooManyTerms,
        values: { max: SLO_REQUEST_FILTER_MAX_TERMS },
      },
    };
  }

  const terms: Array<SloRequestFilterTerm> = [];

  for (const token of tokens) {
    /*
     * `name:` is the span's name. The explorer's other fields are neither
     * an attribute nor the name (see SLO_REQUEST_FILTER_EXPLORER_FIELDS),
     * and free text has nothing to search: a request has no message. Any
     * other bare `key:value` is an attribute, as the search syntax reads an
     * unknown field: only `@` is needed where a key is also a field's name.
     */
    const fieldKey: string | null =
      token.type === SearchTokenType.Field ? token.key.toLowerCase() : null;
    const isName: boolean = fieldKey === SLO_REQUEST_FILTER_NAME_FIELD;
    const isOtherExplorerField: boolean =
      fieldKey !== null &&
      !isName &&
      SLO_REQUEST_FILTER_EXPLORER_FIELDS.includes(fieldKey);

    if (token.type === SearchTokenType.FreeText || isOtherExplorerField) {
      return {
        terms: [],
        error: {
          template: SLO_REQUEST_FILTER_ERRORS.freeText,
          values: { text: token.raw },
        },
      };
    }

    terms.push({
      key: isName ? SLO_REQUEST_FILTER_NAME_FIELD : token.key,
      isAttribute: !isName,
      predicate: token.predicate,
    });
  }

  return { terms: terms, error: null };
};

/*
 * What is wrong with a filter, in English - what the API answers - or null
 * when it is a filter OneUptime can count with.
 */
export const getSloRequestFilterError: (
  raw: string | undefined | null,
) => string | null = (raw: string | undefined | null): string | null => {
  const parsed: ParsedSloRequestFilter = parseSloRequestFilter(raw);

  if (!parsed.error) {
    return null;
  }

  return fillTemplate(
    parsed.error.template,
    Object.fromEntries(
      Object.entries(parsed.error.values).map(
        ([key, value]: [string, string | number]): [string, string] => {
          return [key, String(value)];
        },
      ),
    ),
  );
};
