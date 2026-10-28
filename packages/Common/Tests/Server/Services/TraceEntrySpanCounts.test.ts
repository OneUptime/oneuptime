import { afterEach, describe, expect, jest, test } from "@jest/globals";

import TraceAggregationService, {
  MultiFacetRequest,
} from "../../../Server/Services/TraceAggregationService";
import SpanService from "../../../Server/Services/SpanService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * The traces explorer lists entry spans by default - a root span, or a
 * SERVER or CONSUMER span - and its Span Type facet offers Entry spans, Root
 * spans and All spans with a count each. What is pinned here:
 *
 *   - entryOnly narrows every aggregation the list's chart and facets read
 *     (the histogram, the other facets' counts) to `isEntrySpan = 1`, the
 *     same rows as the list, and rootOnly still narrows to roots;
 *   - the Span Type facet's own counts ignore the span type the reader
 *     chose (a facet does not filter by its own dimension), so the Entry,
 *     Root and All counts describe one set of spans, with every other filter
 *     still applied;
 *   - the entry counts read isEntrySpan over the root counts' minute-aligned
 *     window, and read its buckets however ClickHouse writes a Bool.
 */

type SpyInstance = ReturnType<typeof jest.spyOn>;

const projectId: ObjectID = ObjectID.generate();
const startTime: Date = new Date("2026-10-27T08:00:00.000Z");
const endTime: Date = new Date("2026-10-27T09:00:00.000Z");
const WHITESPACE: RegExp = /\s+/g;

const stubQuery: (rows: Array<JSONObject>) => SpyInstance = (
  rows: Array<JSONObject>,
): SpyInstance => {
  const fakeResult: Results = {
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;

  return jest
    .spyOn(SpanService, "executeQuery")
    .mockResolvedValue(fakeResult as never);
};

const capturedQuery: (spy: SpyInstance) => string = (
  spy: SpyInstance,
): string => {
  const statement: Statement = spy.mock.calls[0]![0] as Statement;
  return statement.query.replace(WHITESPACE, " ");
};

const facetRequest: (
  filters: Partial<MultiFacetRequest>,
) => MultiFacetRequest = (
  filters: Partial<MultiFacetRequest>,
): MultiFacetRequest => {
  return {
    projectId,
    startTime,
    endTime,
    facetKeys: ["isEntrySpan"],
    ...filters,
  };
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("entryOnly narrows the chart and the other facets to the list's rows", () => {
  test("the histogram counts entry spans only", async () => {
    const spy: SpyInstance = stubQuery([]);

    await TraceAggregationService.getHistogram({
      projectId,
      startTime,
      endTime,
      bucketSizeInMinutes: 1,
      entryOnly: true,
    });

    const query: string = capturedQuery(spy);
    expect(query).toContain(" AND isEntrySpan = 1");
    expect(query).not.toContain("isRootSpan = 1");
  });

  test("root spans only narrows to roots, as before", async () => {
    const spy: SpyInstance = stubQuery([]);

    await TraceAggregationService.getHistogram({
      projectId,
      startTime,
      endTime,
      bucketSizeInMinutes: 1,
      rootOnly: true,
    });

    const query: string = capturedQuery(spy);
    expect(query).toContain(" AND isRootSpan = 1");
    expect(query).not.toContain("isEntrySpan");
  });

  test("all spans: neither", async () => {
    const spy: SpyInstance = stubQuery([]);

    await TraceAggregationService.getHistogram({
      projectId,
      startTime,
      endTime,
      bucketSizeInMinutes: 1,
      rootOnly: false,
      entryOnly: false,
    });

    const query: string = capturedQuery(spy);
    expect(query).not.toContain("isEntrySpan");
    expect(query).not.toContain("isRootSpan");
  });

  test("the has-exception counts follow the span type, like every facet but its own", async () => {
    const spy: SpyInstance = stubQuery([]);

    await TraceAggregationService.getHasExceptionCounts(
      facetRequest({ facetKeys: ["hasException"], entryOnly: true }),
    );

    expect(capturedQuery(spy)).toContain(" AND isEntrySpan = 1");
  });
});

describe("the Span Type facet's counts ignore the span type chosen", () => {
  test("entry counts: one GROUP BY over isEntrySpan, whatever span type the list shows", async () => {
    const spy: SpyInstance = stubQuery([]);

    await TraceAggregationService.getEntrySpanCounts(
      facetRequest({ entryOnly: true, rootOnly: true }),
    );

    const query: string = capturedQuery(spy);
    expect(query).toContain(
      "SELECT isEntrySpan, count() AS cnt FROM SpanItemV3",
    );
    expect(query).toContain(" GROUP BY isEntrySpan");
    expect(query).not.toContain("isEntrySpan = 1");
    expect(query).not.toContain("isRootSpan = 1");
  });

  test("root counts do not narrow to entry spans either, so All spans is every span", async () => {
    const spy: SpyInstance = stubQuery([]);

    await TraceAggregationService.getRootSpanCounts(
      facetRequest({ facetKeys: ["isRootSpan"], entryOnly: true }),
    );

    const query: string = capturedQuery(spy);
    expect(query).toContain(" GROUP BY isRootSpan");
    expect(query).not.toContain("isEntrySpan");
    expect(query).not.toContain("isRootSpan = 1");
  });

  test("entry counts read the root counts' minute-aligned window, so entry is never fewer than root", async () => {
    const entrySpy: SpyInstance = stubQuery([]);
    await TraceAggregationService.getEntrySpanCounts(facetRequest({}));
    const entryQuery: string = capturedQuery(entrySpy);
    jest.restoreAllMocks();

    const rootSpy: SpyInstance = stubQuery([]);
    await TraceAggregationService.getRootSpanCounts(
      facetRequest({ facetKeys: ["isRootSpan"] }),
    );
    const rootQuery: string = capturedQuery(rootSpy);

    const window: (query: string) => string = (query: string): string => {
      return query.substring(
        query.indexOf(" WHERE "),
        query.indexOf(" GROUP BY "),
      );
    };

    expect(window(entryQuery)).toBe(window(rootQuery));
    expect(entryQuery).toContain(
      "toStartOfMinute(startTime) >= toStartOfMinute(",
    );
    expect(entryQuery).toContain(
      "toStartOfMinute(startTime) <= toStartOfMinute(",
    );
  });

  test("every other filter still narrows the counts", async () => {
    const spy: SpyInstance = stubQuery([]);

    await TraceAggregationService.getEntrySpanCounts(
      facetRequest({ statusCodes: [2], spanKinds: ["SPAN_KIND_SERVER"] }),
    );

    const query: string = capturedQuery(spy);
    expect(query).toContain("statusCode IN (");
    expect(query).toContain("toString(kind) IN (");
  });

  test("stops with an error at its time limit rather than answer part of a count", async () => {
    const spy: SpyInstance = stubQuery([]);

    await TraceAggregationService.getEntrySpanCounts(facetRequest({}));

    expect(capturedQuery(spy)).toContain("timeout_overflow_mode = 'throw'");
  });

  test("reads the buckets however ClickHouse writes a Bool", async () => {
    stubQuery([
      { isEntrySpan: true, cnt: "4" },
      { isEntrySpan: 1, cnt: 3 },
      { isEntrySpan: "1", cnt: "2" },
      { isEntrySpan: "true", cnt: 1 },
      { isEntrySpan: false, cnt: "10" },
      { isEntrySpan: 0, cnt: 20 },
      { isEntrySpan: "0", cnt: "30" },
    ]);

    await expect(
      TraceAggregationService.getEntrySpanCounts(facetRequest({})),
    ).resolves.toEqual({ entryCount: 10, nonEntryCount: 60 });
  });

  test("no rows: no entry spans and no others", async () => {
    stubQuery([]);

    await expect(
      TraceAggregationService.getEntrySpanCounts(facetRequest({})),
    ).resolves.toEqual({ entryCount: 0, nonEntryCount: 0 });
  });
});
