import { describe, expect, test } from "@jest/globals";
import Dictionary from "../../../Types/Dictionary";
import TelemetrySavedViewState from "../../../Types/Telemetry/TelemetrySavedViewState";
import {
  DEFAULT_TRACE_SPAN_TYPE,
  LEGACY_ROOT_ONLY_URL_PARAM,
  TRACE_SPAN_TYPE_HELP,
  TRACE_SPAN_TYPE_OPTIONS,
  TRACE_SPAN_TYPE_URL_PARAM,
  TraceSpanType,
  TraceSpanTypeOption,
  buildTraceSpanTypeFacetValues,
  buildTraceSpanTypeUrlParams,
  getTraceSpanTypeChartTitle,
  getTraceSpanTypeItemLabel,
  getTraceSpanTypeLabel,
  getTraceSpanTypeQuery,
  getTraceSpanTypeRequestFlags,
  parseTraceSpanType,
  readNamedTraceSpanTypeFromUrl,
  readTraceSpanTypeFromSavedView,
  readTraceSpanTypeFromUrl,
  toTraceSpanTypeSavedViewFields,
} from "../../../Types/Telemetry/TraceSpanType";

/*
 * The traces explorer's Span Type: Entry spans (the default), Root spans or
 * All spans. What is pinned here is everything that has to read the same
 * choice the same way:
 *
 *   - the URL: `spanType=entry|root|all`, the default left out, and a link
 *     from before the choice (`rootOnly=true`) still opening Root spans;
 *   - saved views: a view keeps showing what it showed when it was saved -
 *     `rootOnly: false` was every span, so it is All spans, not the new
 *     default - and the empty state a cleared view applies is the default;
 *   - the list query, the aggregation payloads and the facet's three counts.
 */

const ALL_TYPES: Array<TraceSpanType> = [
  TraceSpanType.Entry,
  TraceSpanType.Root,
  TraceSpanType.All,
];

type ReaderFunction = (name: string) => string | null;

// The explorer reads its URL through URLSearchParams.get.
const urlReader: (query: string) => ReaderFunction = (
  query: string,
): ReaderFunction => {
  const params: URLSearchParams = new URLSearchParams(query);
  return (name: string): string | null => {
    return params.get(name);
  };
};

// What a written set of params reads back as, through a real URL.
const roundTrip: (
  params: Dictionary<string | null>,
  defaultSpanType?: TraceSpanType,
) => TraceSpanType = (
  params: Dictionary<string | null>,
  defaultSpanType?: TraceSpanType,
): TraceSpanType => {
  const query: URLSearchParams = new URLSearchParams();
  for (const name of Object.keys(params)) {
    const value: string | null = params[name] ?? null;
    if (value !== null) {
      query.set(name, value);
    }
  }
  return readTraceSpanTypeFromUrl(
    urlReader(`?${query.toString()}`),
    defaultSpanType,
  );
};

describe("the choice", () => {
  test("Entry spans is the default", () => {
    expect(DEFAULT_TRACE_SPAN_TYPE).toBe(TraceSpanType.Entry);
  });

  test("three options, in the order the explorer offers them, each with its label", () => {
    expect(
      TRACE_SPAN_TYPE_OPTIONS.map((option: TraceSpanTypeOption) => {
        return [option.value, option.label];
      }),
    ).toEqual([
      ["entry", "Entry spans"],
      ["root", "Root spans"],
      ["all", "All spans"],
    ]);

    for (const option of TRACE_SPAN_TYPE_OPTIONS) {
      expect(getTraceSpanTypeLabel(option.value)).toBe(option.label);
    }
  });

  test("one plain-language line of help names all three", () => {
    expect(TRACE_SPAN_TYPE_HELP).toBe(
      "Entry spans: where a request or message enters a service. Root spans: where a trace starts. All spans: every operation, including database calls and internal steps.",
    );
  });

  test("parses its own values, in any case, and nothing else", () => {
    expect(parseTraceSpanType("entry")).toBe(TraceSpanType.Entry);
    expect(parseTraceSpanType("ROOT")).toBe(TraceSpanType.Root);
    expect(parseTraceSpanType(" All ")).toBe(TraceSpanType.All);

    for (const value of [
      "",
      "entries",
      "true",
      "false",
      "child",
      null,
      undefined,
      1,
      {},
    ]) {
      expect(parseTraceSpanType(value)).toBeNull();
    }
  });
});

describe("the URL", () => {
  test("a link that says nothing opens the default", () => {
    expect(readTraceSpanTypeFromUrl(urlReader(""))).toBe(TraceSpanType.Entry);
    expect(readTraceSpanTypeFromUrl(urlReader("?range=Past+one+hour"))).toBe(
      TraceSpanType.Entry,
    );
    expect(readNamedTraceSpanTypeFromUrl(urlReader(""))).toBeNull();
  });

  test("a page's own default is what a silent link opens", () => {
    expect(readTraceSpanTypeFromUrl(urlReader(""), TraceSpanType.All)).toBe(
      TraceSpanType.All,
    );
  });

  test.each(ALL_TYPES)("spanType=%s opens it", (spanType: TraceSpanType) => {
    expect(readTraceSpanTypeFromUrl(urlReader(`?spanType=${spanType}`))).toBe(
      spanType,
    );
  });

  test("REGRESSION: an old rootOnly=true link still opens Root spans", () => {
    expect(readTraceSpanTypeFromUrl(urlReader("?rootOnly=true"))).toBe(
      TraceSpanType.Root,
    );
    expect(readTraceSpanTypeFromUrl(urlReader("?rootOnly=TRUE"))).toBe(
      TraceSpanType.Root,
    );
    expect(readNamedTraceSpanTypeFromUrl(urlReader("?rootOnly=true"))).toBe(
      TraceSpanType.Root,
    );
  });

  test("an old link with rootOnly=true and the page's own default still opens Root spans", () => {
    expect(
      readTraceSpanTypeFromUrl(urlReader("?rootOnly=true"), TraceSpanType.All),
    ).toBe(TraceSpanType.Root);
  });

  test("rootOnly=false, which no link was ever written with, says nothing", () => {
    expect(
      readNamedTraceSpanTypeFromUrl(urlReader("?rootOnly=false")),
    ).toBeNull();
    expect(readTraceSpanTypeFromUrl(urlReader("?rootOnly=false"))).toBe(
      TraceSpanType.Entry,
    );
  });

  test("spanType wins over an old rootOnly beside it", () => {
    expect(
      readTraceSpanTypeFromUrl(urlReader("?spanType=all&rootOnly=true")),
    ).toBe(TraceSpanType.All);
  });

  test("an unknown spanType falls back to rootOnly, then the default", () => {
    expect(
      readTraceSpanTypeFromUrl(urlReader("?spanType=nonsense&rootOnly=true")),
    ).toBe(TraceSpanType.Root);
    expect(readTraceSpanTypeFromUrl(urlReader("?spanType=nonsense"))).toBe(
      TraceSpanType.Entry,
    );
  });

  test("the default is left out of the URL, and the others are written", () => {
    expect(buildTraceSpanTypeUrlParams(TraceSpanType.Entry)).toEqual({
      spanType: null,
      rootOnly: null,
    });
    expect(buildTraceSpanTypeUrlParams(TraceSpanType.Root)).toEqual({
      spanType: "root",
      rootOnly: null,
    });
    expect(buildTraceSpanTypeUrlParams(TraceSpanType.All)).toEqual({
      spanType: "all",
      rootOnly: null,
    });
  });

  test("a page whose default is All spans writes Entry spans, and leaves All out", () => {
    expect(
      buildTraceSpanTypeUrlParams(TraceSpanType.Entry, TraceSpanType.All),
    ).toEqual({ spanType: "entry", rootOnly: null });
    expect(
      buildTraceSpanTypeUrlParams(TraceSpanType.All, TraceSpanType.All),
    ).toEqual({ spanType: null, rootOnly: null });
  });

  test("the writer always removes the old rootOnly, so a rewritten link carries spanType only", () => {
    for (const spanType of ALL_TYPES) {
      const params: Dictionary<string | null> =
        buildTraceSpanTypeUrlParams(spanType);
      expect(Object.keys(params).sort()).toEqual(
        [LEGACY_ROOT_ONLY_URL_PARAM, TRACE_SPAN_TYPE_URL_PARAM].sort(),
      );
      expect(params[LEGACY_ROOT_ONLY_URL_PARAM]).toBeNull();
    }
  });

  test.each(ALL_TYPES)(
    "%s survives being written and read back, under either default",
    (spanType: TraceSpanType) => {
      for (const defaultSpanType of [TraceSpanType.Entry, TraceSpanType.All]) {
        expect(
          roundTrip(
            buildTraceSpanTypeUrlParams(spanType, defaultSpanType),
            defaultSpanType,
          ),
        ).toBe(spanType);
      }
    },
  );
});

describe("saved views", () => {
  test.each(ALL_TYPES)(
    "a view saved with spanType %s opens it",
    (spanType: TraceSpanType) => {
      const state: TelemetrySavedViewState = {
        ...toTraceSpanTypeSavedViewFields(spanType),
      };
      expect(readTraceSpanTypeFromSavedView(state)).toBe(spanType);
    },
  );

  test("what a view stores: spanType, and rootOnly true exactly for Root spans", () => {
    expect(toTraceSpanTypeSavedViewFields(TraceSpanType.Entry)).toEqual({
      spanType: "entry",
      rootOnly: false,
    });
    expect(toTraceSpanTypeSavedViewFields(TraceSpanType.Root)).toEqual({
      spanType: "root",
      rootOnly: true,
    });
    expect(toTraceSpanTypeSavedViewFields(TraceSpanType.All)).toEqual({
      spanType: "all",
      rootOnly: false,
    });
  });

  test("REGRESSION: a view saved with root spans only (rootOnly: true) opens Root spans", () => {
    expect(readTraceSpanTypeFromSavedView({ rootOnly: true })).toBe(
      TraceSpanType.Root,
    );
  });

  test("a view saved before the choice with root spans off showed every span, and still does", () => {
    /*
     * Not the new default: a saved view of database calls or of Client spans
     * would open empty under Entry spans.
     */
    expect(
      readTraceSpanTypeFromSavedView({
        search: "kind:client",
        filters: [["kind", "SPAN_KIND_CLIENT"]],
        rootOnly: false,
      } as TelemetrySavedViewState),
    ).toBe(TraceSpanType.All);
  });

  test("the empty state a cleared view applies, and a view from before either field, open the default", () => {
    expect(readTraceSpanTypeFromSavedView({})).toBe(TraceSpanType.Entry);
    expect(readTraceSpanTypeFromSavedView(undefined)).toBe(TraceSpanType.Entry);
    expect(readTraceSpanTypeFromSavedView(null)).toBe(TraceSpanType.Entry);
    expect(
      readTraceSpanTypeFromSavedView({
        pageSize: 50,
      } as TelemetrySavedViewState),
    ).toBe(TraceSpanType.Entry);
    expect(readTraceSpanTypeFromSavedView({}, TraceSpanType.All)).toBe(
      TraceSpanType.All,
    );
  });

  test("spanType wins over the rootOnly written beside it, and a broken one falls back to rootOnly", () => {
    expect(
      readTraceSpanTypeFromSavedView({ spanType: "entry", rootOnly: false }),
    ).toBe(TraceSpanType.Entry);
    expect(
      readTraceSpanTypeFromSavedView({ spanType: "unknown", rootOnly: true }),
    ).toBe(TraceSpanType.Root);
    // Not a real boolean: says nothing, like a view without it.
    expect(readTraceSpanTypeFromSavedView({ rootOnly: "false" })).toBe(
      TraceSpanType.Entry,
    );
  });

  test("what a view stores reads back as what it was saved with, and an older reader sees root-only right", () => {
    for (const spanType of ALL_TYPES) {
      const stored: { spanType: TraceSpanType; rootOnly: boolean } =
        toTraceSpanTypeSavedViewFields(spanType);

      expect(readTraceSpanTypeFromSavedView(stored)).toBe(spanType);
      expect(stored.rootOnly).toBe(spanType === TraceSpanType.Root);
    }
  });
});

describe("what the choice asks the server for", () => {
  test("the list query: isEntrySpan, isRootSpan, or nothing", () => {
    expect(getTraceSpanTypeQuery(TraceSpanType.Entry)).toEqual({
      isEntrySpan: true,
    });
    expect(getTraceSpanTypeQuery(TraceSpanType.Root)).toEqual({
      isRootSpan: true,
    });
    expect(getTraceSpanTypeQuery(TraceSpanType.All)).toEqual({});
  });

  test("the chart, facet and analytics payloads say both flags, always", () => {
    expect(getTraceSpanTypeRequestFlags(TraceSpanType.Entry)).toEqual({
      rootOnly: false,
      entryOnly: true,
    });
    expect(getTraceSpanTypeRequestFlags(TraceSpanType.Root)).toEqual({
      rootOnly: true,
      entryOnly: false,
    });
    expect(getTraceSpanTypeRequestFlags(TraceSpanType.All)).toEqual({
      rootOnly: false,
      entryOnly: false,
    });
  });
});

describe("the Span Type facet's three counts", () => {
  test("entry from isEntrySpan, root from isRootSpan, all from every span", () => {
    expect(
      buildTraceSpanTypeFacetValues({
        isEntrySpan: [
          { value: "true", count: 40 },
          { value: "false", count: 960 },
        ],
        isRootSpan: [
          { value: "true", count: 25 },
          { value: "false", count: 975 },
        ],
      }),
    ).toEqual([
      { value: TraceSpanType.Entry, count: 40 },
      { value: TraceSpanType.Root, count: 25 },
      { value: TraceSpanType.All, count: 1000 },
    ]);
  });

  test("reads a Bool bucket written as 1", () => {
    expect(
      buildTraceSpanTypeFacetValues({
        isEntrySpan: [{ value: "1", count: 3 }],
        isRootSpan: [
          { value: "1", count: 2 },
          { value: "0", count: 8 },
        ],
      }),
    ).toEqual([
      { value: TraceSpanType.Entry, count: 3 },
      { value: TraceSpanType.Root, count: 2 },
      { value: TraceSpanType.All, count: 10 },
    ]);
  });

  test("all spans from the entry buckets when only those came back", () => {
    expect(
      buildTraceSpanTypeFacetValues({
        isEntrySpan: [
          { value: "true", count: 4 },
          { value: "false", count: 6 },
        ],
      }),
    ).toEqual([
      { value: TraceSpanType.Entry, count: 4 },
      { value: TraceSpanType.Root, count: 0 },
      { value: TraceSpanType.All, count: 10 },
    ]);
  });

  test("always the three rows, 0 where a count did not come back", () => {
    expect(buildTraceSpanTypeFacetValues({})).toEqual([
      { value: TraceSpanType.Entry, count: 0 },
      { value: TraceSpanType.Root, count: 0 },
      { value: TraceSpanType.All, count: 0 },
    ]);
  });
});

describe("what the list and its chart are called", () => {
  test("root spans are traces; entry spans and every span are spans, in words every language has", () => {
    expect(getTraceSpanTypeItemLabel(TraceSpanType.Root)).toBe("traces");
    expect(getTraceSpanTypeItemLabel(TraceSpanType.Entry)).toBe("spans");
    expect(getTraceSpanTypeItemLabel(TraceSpanType.All)).toBe("spans");

    expect(getTraceSpanTypeChartTitle(TraceSpanType.Root)).toBe(
      "Traces over time",
    );
    expect(getTraceSpanTypeChartTitle(TraceSpanType.Entry)).toBe(
      "Spans over time",
    );
    expect(getTraceSpanTypeChartTitle(TraceSpanType.All)).toBe(
      "Spans over time",
    );
  });
});
