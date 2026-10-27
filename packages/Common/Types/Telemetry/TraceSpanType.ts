import type Dictionary from "../Dictionary";

/*
 * Which spans the traces explorer lists - its "Span Type" choice.
 *
 *   Entry spans (the default): where a request or message enters a service -
 *     a root span, or a SERVER or CONSUMER span whatever its parent
 *     (Utils/Telemetry/EntrySpan; stored as Span.isEntrySpan).
 *   Root spans: where a trace starts (Span.isRootSpan).
 *   All spans: every operation, database calls and internal steps included.
 *
 * Entry spans are the default because both others mislead: a service behind a
 * gateway or a queue never owns a trace root, so a root-only list hides every
 * request it served, and a list of every span is mostly database calls,
 * eBPF's "in queue" / "processing" steps and Redis commands - rows that open
 * a one-span trace.
 *
 * Pure, so the URL, saved-view and request mappings are unit-tested on their
 * own (App/Tests and Common/Tests).
 */
export enum TraceSpanType {
  Entry = "entry",
  Root = "root",
  All = "all",
}

export const DEFAULT_TRACE_SPAN_TYPE: TraceSpanType = TraceSpanType.Entry;

/*
 * The explorer's URL param. `rootOnly=true` is what a link said before it,
 * and still opens Root spans.
 */
export const TRACE_SPAN_TYPE_URL_PARAM: string = "spanType";
export const LEGACY_ROOT_ONLY_URL_PARAM: string = "rootOnly";

export interface TraceSpanTypeOption {
  value: TraceSpanType;
  label: string;
  // What the spans are, in a few plain words.
  description: string;
}

// In the order the explorer offers them.
export const TRACE_SPAN_TYPE_OPTIONS: ReadonlyArray<TraceSpanTypeOption> = [
  {
    value: TraceSpanType.Entry,
    label: "Entry spans",
    description: "where a request or message enters a service",
  },
  {
    value: TraceSpanType.Root,
    label: "Root spans",
    description: "where a trace starts",
  },
  {
    value: TraceSpanType.All,
    label: "All spans",
    description: "every operation, including database calls and internal steps",
  },
];

// The one line of help the Span Type choice carries.
export const TRACE_SPAN_TYPE_HELP: string = TRACE_SPAN_TYPE_OPTIONS.map(
  (option: TraceSpanTypeOption): string => {
    return `${option.label}: ${option.description}.`;
  },
).join(" ");

export function parseTraceSpanType(value: unknown): TraceSpanType | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized: string = value.trim().toLowerCase();

  for (const option of TRACE_SPAN_TYPE_OPTIONS) {
    if (option.value === normalized) {
      return option.value;
    }
  }

  return null;
}

export function getTraceSpanTypeLabel(spanType: TraceSpanType): string {
  for (const option of TRACE_SPAN_TYPE_OPTIONS) {
    if (option.value === spanType) {
      return option.label;
    }
  }

  return spanType;
}

// Reads one query param, as URLSearchParams.get does.
export type ReadUrlParamFunction = (name: string) => string | null | undefined;

/**
 * The span type a URL names, or null when it names none - so a page that
 * only carries the choice (the Insights tab) can tell "said nothing" from
 * "said the default".
 *
 * `spanType` wins. A link from before it carries `rootOnly=true`, which
 * still opens Root spans. `rootOnly=false` was never written - it would have
 * meant the old default, every span - and says nothing here, like an
 * unknown value.
 */
export function readNamedTraceSpanTypeFromUrl(
  read: ReadUrlParamFunction,
): TraceSpanType | null {
  const named: TraceSpanType | null = parseTraceSpanType(
    read(TRACE_SPAN_TYPE_URL_PARAM),
  );

  if (named) {
    return named;
  }

  const rootOnly: string | null | undefined = read(LEGACY_ROOT_ONLY_URL_PARAM);

  if (
    typeof rootOnly === "string" &&
    rootOnly.trim().toLowerCase() === "true"
  ) {
    return TraceSpanType.Root;
  }

  return null;
}

// What the explorer opens on: what the URL names, else its default.
export function readTraceSpanTypeFromUrl(
  read: ReadUrlParamFunction,
  defaultSpanType: TraceSpanType = DEFAULT_TRACE_SPAN_TYPE,
): TraceSpanType {
  return readNamedTraceSpanTypeFromUrl(read) ?? defaultSpanType;
}

/**
 * The params that write a span type into the explorer's URL, nulls meaning
 * "remove". The default is left out, so a plain link stays plain, and the
 * old `rootOnly` is always removed: a link the explorer rewrites carries
 * `spanType` only.
 */
export function buildTraceSpanTypeUrlParams(
  spanType: TraceSpanType,
  defaultSpanType: TraceSpanType = DEFAULT_TRACE_SPAN_TYPE,
): Dictionary<string | null> {
  return {
    [TRACE_SPAN_TYPE_URL_PARAM]: spanType === defaultSpanType ? null : spanType,
    [LEGACY_ROOT_ONLY_URL_PARAM]: null,
  };
}

// What a saved view stores about the span type (TelemetrySavedViewState).
export interface TraceSpanTypeSavedViewFields {
  spanType?: unknown;
  rootOnly?: unknown;
}

/**
 * The span type a saved view opens with. A view keeps showing what it showed
 * when it was saved:
 *
 *   - `spanType`, written since the choice had three answers;
 *   - else `rootOnly`, which every view saved before held: true was Root
 *     spans, and false was every span - the list had no other way to be -
 *     so it is All spans, not the new default. A view of database calls or
 *     client spans would otherwise come back empty;
 *   - else (a view from before either, or the empty state "clear the saved
 *     view" applies) the explorer's default.
 */
export function readTraceSpanTypeFromSavedView(
  state: TraceSpanTypeSavedViewFields | null | undefined,
  defaultSpanType: TraceSpanType = DEFAULT_TRACE_SPAN_TYPE,
): TraceSpanType {
  const named: TraceSpanType | null = parseTraceSpanType(state?.spanType);

  if (named) {
    return named;
  }

  if (state?.rootOnly === true) {
    return TraceSpanType.Root;
  }

  if (state?.rootOnly === false) {
    return TraceSpanType.All;
  }

  return defaultSpanType;
}

/*
 * What a saved view stores. `rootOnly` is kept beside `spanType` for any
 * reader that only knows it (an older Dashboard during an upgrade): true
 * exactly when the view is of root spans.
 */
export function toTraceSpanTypeSavedViewFields(spanType: TraceSpanType): {
  spanType: TraceSpanType;
  rootOnly: boolean;
} {
  return {
    spanType: spanType,
    rootOnly: spanType === TraceSpanType.Root,
  };
}

/*
 * The span list's query predicate: isEntrySpan or isRootSpan, nothing for
 * every span.
 */
export function getTraceSpanTypeQuery(spanType: TraceSpanType): {
  isEntrySpan?: boolean;
  isRootSpan?: boolean;
} {
  if (spanType === TraceSpanType.Entry) {
    return { isEntrySpan: true };
  }

  if (spanType === TraceSpanType.Root) {
    return { isRootSpan: true };
  }

  return {};
}

/*
 * The same choice for the histogram, facet and analytics endpoints
 * (TraceFilters), written out in full so a payload always says which.
 */
export function getTraceSpanTypeRequestFlags(spanType: TraceSpanType): {
  rootOnly: boolean;
  entryOnly: boolean;
} {
  return {
    rootOnly: spanType === TraceSpanType.Root,
    entryOnly: spanType === TraceSpanType.Entry,
  };
}

// One bucket of a facet answer: { value: "true", count: 12 }.
export interface TraceSpanTypeFacetBucket {
  value: string;
  count: number;
}

export interface TraceSpanTypeFacetAnswer {
  isRootSpan?: Array<TraceSpanTypeFacetBucket> | undefined;
  isEntrySpan?: Array<TraceSpanTypeFacetBucket> | undefined;
}

const isTrueBucket: (bucket: TraceSpanTypeFacetBucket) => boolean = (
  bucket: TraceSpanTypeFacetBucket,
): boolean => {
  return bucket.value === "true" || bucket.value === "1";
};

const sumOf: (
  buckets: Array<TraceSpanTypeFacetBucket> | undefined,
  keep: (bucket: TraceSpanTypeFacetBucket) => boolean,
) => number = (
  buckets: Array<TraceSpanTypeFacetBucket> | undefined,
  keep: (bucket: TraceSpanTypeFacetBucket) => boolean,
): number => {
  let total: number = 0;

  for (const bucket of buckets || []) {
    if (keep(bucket)) {
      total += Number(bucket.count) || 0;
    }
  }

  return total;
};

/**
 * The Span Type facet's three rows from the facets endpoint's two exact
 * counts, both taken over the same spans with the span type itself ignored:
 * Entry spans the isEntrySpan "true" bucket, Root spans the isRootSpan "true"
 * bucket, and All spans every span (the root and non-root buckets added up,
 * or the entry and non-entry ones when only those came back). Always the
 * three rows, in the order the explorer offers them; a count that did not
 * come back is 0 (the endpoint names it in timedOutFacets).
 */
export function buildTraceSpanTypeFacetValues(
  answer: TraceSpanTypeFacetAnswer,
): Array<{ value: TraceSpanType; count: number }> {
  const allFromRoots: number = sumOf(answer.isRootSpan, () => {
    return true;
  });
  const allFromEntries: number = sumOf(answer.isEntrySpan, () => {
    return true;
  });

  const counts: Record<TraceSpanType, number> = {
    [TraceSpanType.Entry]: sumOf(answer.isEntrySpan, isTrueBucket),
    [TraceSpanType.Root]: sumOf(answer.isRootSpan, isTrueBucket),
    [TraceSpanType.All]:
      (answer.isRootSpan || []).length > 0 ? allFromRoots : allFromEntries,
  };

  return TRACE_SPAN_TYPE_OPTIONS.map(
    (option: TraceSpanTypeOption): { value: TraceSpanType; count: number } => {
      return { value: option.value, count: counts[option.value] };
    },
  );
}

/*
 * What the list's rows are called: a root span stands for its trace, so
 * root spans read as traces; entry spans and every span are spans. (Not
 * "entry spans": the total and the chart are sentences every Dashboard
 * language words, and the Span Type facet already says which spans.)
 */
export function getTraceSpanTypeItemLabel(spanType: TraceSpanType): string {
  return spanType === TraceSpanType.Root ? "traces" : "spans";
}

// The count chart's title, named like the rows it counts.
export function getTraceSpanTypeChartTitle(spanType: TraceSpanType): string {
  return spanType === TraceSpanType.Root
    ? "Traces over time"
    : "Spans over time";
}
