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
 * Each choice says so in one sentence (TRACE_SPAN_TYPE_OPTIONS' description),
 * behind the (i) beside the choice's title and on its own option - never as
 * a paragraph under the title, which pushed the options down the sidebar.
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

/*
 * Marks an English sentence as a key of the Dashboard's locales - the same
 * marker as Common/UI/Utils/TranslateTemplate's translationKey, kept here so
 * this file stays free of the UI. It returns the text unchanged.
 *
 * The Dashboard's locale extractor reads this file for what it marks and
 * nothing else (a "keys" root of its SOURCE_ROOTS,
 * App/FeatureSet/Dashboard/scripts/i18n/ExtractStrings.ts): what each span
 * type is reads in the reader's language, while the choices' names read
 * "Entry spans", "Root spans" and "All spans" in every language, as the
 * translated docs quote them.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

export interface TraceSpanTypeOption {
  value: TraceSpanType;
  // The choice's name, drawn as written in every language.
  label: string;
  /*
   * What the spans are, as one plain sentence (English, a locale key). The
   * Span Type choice never spells it out under its title: the (i) beside the
   * title lists each choice's, and each choice says its own on hover and
   * keyboard focus, in the reader's language.
   */
  description: string;
}

// In the order the explorer offers them.
export const TRACE_SPAN_TYPE_OPTIONS: ReadonlyArray<TraceSpanTypeOption> = [
  {
    value: TraceSpanType.Entry,
    label: "Entry spans",
    description: translationKey("Where a request or message enters a service."),
  },
  {
    value: TraceSpanType.Root,
    label: "Root spans",
    description: translationKey("Where a trace starts."),
  },
  {
    value: TraceSpanType.All,
    label: "All spans",
    description: translationKey(
      "Every operation, including database calls and internal steps.",
    ),
  },
];

/*
 * Each choice's sentence, by value: the Span Type choice's
 * valueDescriptionMap (UI/Components/TelemetryViewer FacetConfig).
 */
export function getTraceSpanTypeDescriptions(): Record<string, string> {
  return Object.fromEntries(
    TRACE_SPAN_TYPE_OPTIONS.map(
      (option: TraceSpanTypeOption): [string, string] => {
        return [option.value, option.description];
      },
    ),
  );
}

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
