import TraceAggregationService, {
  TraceAnalyticsRequest,
  TraceAnalyticsTableRow,
  TraceAnalyticsTimeseriesRow,
  TraceAnalyticsTopItem,
} from "../../../Server/Services/TraceAggregationService";
import SpanService from "../../../Server/Services/SpanService";
import ResourceFacetResolver, {
  ResolvedFacetValue,
  ResourceFacetSpec,
} from "../../../Server/Utils/Telemetry/ResourceFacetResolver";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Resource group-by dimensions (rumApplicationId, hostId, ...) come out of
 * ClickHouse as bare internal ObjectIDs, and nothing downstream of the trace
 * analytics endpoints turns those into names — the raw id would otherwise land
 * in a dashboard TraceChart legend or a TraceTable cell. getAnalyticsTimeseries
 * and getAnalyticsTable therefore run their rows through
 * ResourceFacetResolver before returning.
 *
 * getAnalyticsTopList deliberately does NOT: its values are fed straight back
 * into the timeseries query as an `IN` filter and the AI latency detectors
 * match on them, so a display name there would silently break both.
 *
 * WHICH keys get rewritten is NOT a single membership check — it is the
 * INTERSECTION of two sets that genuinely differ, and both halves are pinned
 * by tests below:
 *
 *   TraceAggregationService.RESOURCE_FACET_KEYS.has(key)
 *     && ResourceFacetResolver.isResourceFacet(key)
 *
 * - `proxmoxClusterId` / `cephClusterId` are resource dimensions in the
 *   aggregation service but have NO branch in ResourceFacetResolver.resolveOne
 *   (it returns [] for them). They must not cost a resolve round-trip, and
 *   their ids stay raw.
 * - `primaryEntityId` / `serviceId` are resolvable by the resolver but are
 *   deliberately not resource dimensions here — the traces explorer resolves
 *   that service split client-side, so the server leaves them alone.
 */

const projectId: ObjectID = ObjectID.generate();
const startTime: Date = new Date("2026-07-14T11:00:00.000Z");
const endTime: Date = new Date("2026-07-14T12:00:00.000Z");

const checkoutAppId: string = ObjectID.generate().toString();
const marketingAppId: string = ObjectID.generate().toString();
const deletedAppId: string = ObjectID.generate().toString();
const hostId: string = ObjectID.generate().toString();
const proxmoxClusterId: string = ObjectID.generate().toString();
const cephClusterId: string = ObjectID.generate().toString();
const serviceEntityId: string = ObjectID.generate().toString();
/*
 * Every resource dimension reads out of the SAME primaryEntityId column, so
 * one raw id can legitimately arrive under two different resource keys in one
 * result set — and must resolve independently under each.
 */
const sharedEntityId: string = ObjectID.generate().toString();

const analyticsRequest: (
  overrides: Partial<TraceAnalyticsRequest>,
) => TraceAnalyticsRequest = (
  overrides: Partial<TraceAnalyticsRequest>,
): TraceAnalyticsRequest => {
  return {
    projectId,
    startTime,
    endTime,
    bucketSizeInMinutes: 5,
    chartType: "timeseries",
    metric: "count",
    ...overrides,
  };
};

/*
 * getAnalyticsTimeseries issues TWO ClickHouse queries when a groupBy is
 * present — the top-list pre-pass that caps the series count, then the
 * timeseries itself. Dispatch on the SELECT alias so each gets its own rows.
 *
 * BRITTLE SEAM — deliberately coupled to two private implementation details,
 * because there is no public seam that separates the two queries:
 *
 * 1. The dispatch sniffs the SQL text for `" AS dim,"`, which is the top-list
 *    SELECT alias in buildAnalyticsTopListStatement. A behaviour-preserving
 *    rename of that alias (or dropping the trailing comma by reordering the
 *    SELECT list) makes `isTopList` false for BOTH queries, so the stub serves
 *    `main` rows to the top-list pre-pass too. Symptom: series-cap assertions
 *    start seeing bucket rows, and `dim` reads as "" so the cap silently
 *    disappears — tests fail confusingly rather than at the rename.
 * 2. The raw row keys below hardcode TraceAggregationService's private
 *    `groupByAlias` scheme: resource + top-level keys alias to themselves,
 *    every other (attribute) key aliases to `attr_<groupBy index>_<key with
 *    non-alphanumerics replaced by _>`. Change that scheme — or reorder a
 *    groupBy so an attribute key lands on a different index — and the row
 *    lookup misses, yielding "" group values instead of the fixture data.
 *
 * If either changes, update the fixtures here; do not relax the assertions.
 */
const stubQuery: (rows: {
  main?: Array<JSONObject> | undefined;
  topList?: Array<JSONObject> | undefined;
}) => jest.SpyInstance = (rows: {
  main?: Array<JSONObject> | undefined;
  topList?: Array<JSONObject> | undefined;
}): jest.SpyInstance => {
  return jest.spyOn(SpanService, "executeQuery").mockImplementation(((
    statement: Statement,
  ): Promise<Results> => {
    const isTopList: boolean = statement.query.includes(" AS dim,");
    const data: Array<JSONObject> =
      (isTopList ? rows.topList : rows.main) || [];

    const fakeResult: Results = {
      json: (): Promise<unknown> => {
        return Promise.resolve({
          data: data,
          statistics: { elapsed: 0.004, rows_read: 10, bytes_read: 100 },
        });
      },
    } as unknown as Results;

    return Promise.resolve(fakeResult);
  }) as never);
};

const stubResolver: (
  resolved: Record<string, Array<ResolvedFacetValue>>,
) => jest.SpyInstance = (
  resolved: Record<string, Array<ResolvedFacetValue>>,
): jest.SpyInstance => {
  return jest
    .spyOn(ResourceFacetResolver, "resolve")
    .mockResolvedValue(resolved as never);
};

const failingResolver: () => jest.SpyInstance = (): jest.SpyInstance => {
  return jest
    .spyOn(ResourceFacetResolver, "resolve")
    .mockRejectedValue(new Error("postgres unavailable") as never);
};

const valuesFor: (
  rows: Array<{ groupValues: Record<string, string> }>,
  key: string,
) => Array<string> = (
  rows: Array<{ groupValues: Record<string, string> }>,
  key: string,
): Array<string> => {
  return rows.map((row: { groupValues: Record<string, string> }): string => {
    return row.groupValues[key] ?? "<missing>";
  });
};

const specsPassedTo: (spy: jest.SpyInstance) => Array<ResourceFacetSpec> = (
  spy: jest.SpyInstance,
): Array<ResourceFacetSpec> => {
  return spy.mock.calls[0]![1] as Array<ResourceFacetSpec>;
};

describe("TraceAggregationService.getAnalyticsTimeseries (resource display names)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("rewrites a rumApplicationId group-by from raw ObjectIDs to display names", async () => {
    stubQuery({
      topList: [{ dim: checkoutAppId, val: "12", cnt: "12" }],
      main: [
        {
          bucket: "2026-07-14 11:00:00",
          val: "12",
          rumApplicationId: checkoutAppId,
        },
        {
          bucket: "2026-07-14 11:05:00",
          val: "7",
          rumApplicationId: checkoutAppId,
        },
      ],
    });
    stubResolver({
      rumApplicationId: [
        { value: checkoutAppId, count: 2, displayName: "Checkout Web" },
      ],
    });

    const rows: Array<TraceAnalyticsTimeseriesRow> =
      await TraceAggregationService.getAnalyticsTimeseries(
        analyticsRequest({ groupBy: ["rumApplicationId"] }),
      );

    expect(rows).toHaveLength(2);
    expect(valuesFor(rows, "rumApplicationId")).toEqual([
      "Checkout Web",
      "Checkout Web",
    ]);
    // The metric payload must survive the rewrite untouched.
    expect(
      rows.map((row: TraceAnalyticsTimeseriesRow): number => {
        return row.value;
      }),
    ).toEqual([12, 7]);
  });

  test("maps each distinct id in one result set to its own display name", async () => {
    stubQuery({
      topList: [
        { dim: checkoutAppId, val: "12", cnt: "12" },
        { dim: marketingAppId, val: "5", cnt: "5" },
      ],
      main: [
        {
          bucket: "2026-07-14 11:00:00",
          val: "12",
          rumApplicationId: checkoutAppId,
        },
        {
          bucket: "2026-07-14 11:00:00",
          val: "5",
          rumApplicationId: marketingAppId,
        },
      ],
    });
    stubResolver({
      rumApplicationId: [
        { value: marketingAppId, count: 1, displayName: "Marketing Site" },
        { value: checkoutAppId, count: 1, displayName: "Checkout Web" },
      ],
    });

    const rows: Array<TraceAnalyticsTimeseriesRow> =
      await TraceAggregationService.getAnalyticsTimeseries(
        analyticsRequest({ groupBy: ["rumApplicationId"] }),
      );

    expect(rows).toHaveLength(2);
    expect(valuesFor(rows, "rumApplicationId")).toEqual([
      "Checkout Web",
      "Marketing Site",
    ]);
  });

  test("an id the resolver does not return keeps its RAW value", async () => {
    stubQuery({
      topList: [
        { dim: checkoutAppId, val: "12", cnt: "12" },
        { dim: deletedAppId, val: "3", cnt: "3" },
      ],
      main: [
        {
          bucket: "2026-07-14 11:00:00",
          val: "12",
          rumApplicationId: checkoutAppId,
        },
        {
          bucket: "2026-07-14 11:00:00",
          val: "3",
          rumApplicationId: deletedAppId,
        },
      ],
    });
    // Deleted app / past the resolver's page size — absent from the response.
    stubResolver({
      rumApplicationId: [
        { value: checkoutAppId, count: 1, displayName: "Checkout Web" },
      ],
    });

    const rows: Array<TraceAnalyticsTimeseriesRow> =
      await TraceAggregationService.getAnalyticsTimeseries(
        analyticsRequest({ groupBy: ["rumApplicationId"] }),
      );

    expect(rows).toHaveLength(2);
    // The row must not vanish and must not blank — it falls back to the id.
    expect(valuesFor(rows, "rumApplicationId")).toEqual([
      "Checkout Web",
      deletedAppId,
    ]);
  });

  test("an empty display name does not blank out the row", async () => {
    stubQuery({
      topList: [{ dim: checkoutAppId, val: "12", cnt: "12" }],
      main: [
        {
          bucket: "2026-07-14 11:00:00",
          val: "12",
          rumApplicationId: checkoutAppId,
        },
      ],
    });
    stubResolver({
      rumApplicationId: [{ value: checkoutAppId, count: 1, displayName: "" }],
    });

    const rows: Array<TraceAnalyticsTimeseriesRow> =
      await TraceAggregationService.getAnalyticsTimeseries(
        analyticsRequest({ groupBy: ["rumApplicationId"] }),
      );

    expect(rows).toHaveLength(1);
    expect(valuesFor(rows, "rumApplicationId")).toEqual([checkoutAppId]);
  });

  test("a row whose group value is the empty string survives and is not asked about", async () => {
    /*
     * A span with no primaryEntityId makes toString(primaryEntityId) "" for
     * the dimension. getAnalyticsTimeseries charts those as one "(empty)"
     * series on purpose, so the row must not be dropped or blanked — and the
     * two `if (raw)` guards in applyResourceDisplayValues must keep "" out of
     * the spec counts (asking Postgres for the empty id is pure waste).
     */
    stubQuery({
      topList: [{ dim: checkoutAppId, val: "12", cnt: "12" }],
      main: [
        {
          bucket: "2026-07-14 11:00:00",
          val: "12",
          rumApplicationId: checkoutAppId,
        },
        { bucket: "2026-07-14 11:00:00", val: "4", rumApplicationId: "" },
      ],
    });
    const resolveSpy: jest.SpyInstance = stubResolver({
      rumApplicationId: [
        { value: checkoutAppId, count: 1, displayName: "Checkout Web" },
        // A stray "" mapping must not be applied either.
        { value: "", count: 1, displayName: "SHOULD NOT APPEAR" },
      ],
    });

    const rows: Array<TraceAnalyticsTimeseriesRow> =
      await TraceAggregationService.getAnalyticsTimeseries(
        analyticsRequest({ groupBy: ["rumApplicationId"] }),
      );

    expect(rows).toHaveLength(2);
    expect(valuesFor(rows, "rumApplicationId")).toEqual(["Checkout Web", ""]);
    expect(
      rows.map((row: TraceAnalyticsTimeseriesRow): number => {
        return row.value;
      }),
    ).toEqual([12, 4]);

    expect(resolveSpy).toHaveBeenCalledTimes(1);

    const specs: Array<ResourceFacetSpec> = specsPassedTo(resolveSpy);
    expect(specs).toHaveLength(1);

    const counts: Record<string, number> = Object.fromEntries(
      specs[0]!.counts.entries(),
    );
    expect(counts).toEqual({ [checkoutAppId]: 1 });
    expect(specs[0]!.counts.has("")).toBe(false);
  });

  test("a non-resource group-by is passed through untouched and never hits the resolver", async () => {
    stubQuery({
      topList: [{ dim: "GET /checkout", val: "12", cnt: "12" }],
      main: [
        { bucket: "2026-07-14 11:00:00", val: "12", name: "GET /checkout" },
        { bucket: "2026-07-14 11:05:00", val: "4", name: "GET /cart" },
      ],
    });
    const resolveSpy: jest.SpyInstance = stubResolver({
      name: [{ value: "GET /checkout", count: 1, displayName: "NOPE" }],
    });

    const rows: Array<TraceAnalyticsTimeseriesRow> =
      await TraceAggregationService.getAnalyticsTimeseries(
        analyticsRequest({ groupBy: ["name"] }),
      );

    expect(rows).toHaveLength(2);
    expect(valuesFor(rows, "name")).toEqual(["GET /checkout", "GET /cart"]);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  test("a query with no groupBy does not call the resolver", async () => {
    stubQuery({
      main: [
        { bucket: "2026-07-14 11:00:00", val: "12" },
        { bucket: "2026-07-14 11:05:00", val: "9" },
      ],
    });
    const resolveSpy: jest.SpyInstance = stubResolver({});

    const rows: Array<TraceAnalyticsTimeseriesRow> =
      await TraceAggregationService.getAnalyticsTimeseries(
        analyticsRequest({}),
      );

    expect(rows).toHaveLength(2);
    expect(
      rows.map((row: TraceAnalyticsTimeseriesRow): number => {
        return row.value;
      }),
    ).toEqual([12, 9]);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  test("zero rows does not call the resolver", async () => {
    stubQuery({ topList: [], main: [] });
    const resolveSpy: jest.SpyInstance = stubResolver({
      rumApplicationId: [
        { value: checkoutAppId, count: 1, displayName: "Checkout Web" },
      ],
    });

    const rows: Array<TraceAnalyticsTimeseriesRow> =
      await TraceAggregationService.getAnalyticsTimeseries(
        analyticsRequest({ groupBy: ["rumApplicationId"] }),
      );

    expect(rows).toEqual([]);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  test("asks the resolver for one spec per resource key, counting exactly the distinct raw ids present", async () => {
    stubQuery({
      topList: [
        { dim: checkoutAppId, val: "12", cnt: "12" },
        { dim: marketingAppId, val: "5", cnt: "5" },
      ],
      main: [
        {
          bucket: "2026-07-14 11:00:00",
          val: "12",
          rumApplicationId: checkoutAppId,
        },
        {
          bucket: "2026-07-14 11:05:00",
          val: "8",
          rumApplicationId: checkoutAppId,
        },
        {
          bucket: "2026-07-14 11:05:00",
          val: "5",
          rumApplicationId: marketingAppId,
        },
      ],
    });
    const resolveSpy: jest.SpyInstance = stubResolver({ rumApplicationId: [] });

    await TraceAggregationService.getAnalyticsTimeseries(
      analyticsRequest({ groupBy: ["rumApplicationId"] }),
    );

    expect(resolveSpy).toHaveBeenCalledTimes(1);

    const resolvedProjectId: ObjectID = resolveSpy.mock
      .calls[0]![0] as ObjectID;
    expect(resolvedProjectId.toString()).toBe(projectId.toString());

    const specs: Array<ResourceFacetSpec> = specsPassedTo(resolveSpy);
    expect(specs).toHaveLength(1);
    expect(specs[0]!.facetKey).toBe("rumApplicationId");

    const counts: Record<string, number> = Object.fromEntries(
      specs[0]!.counts.entries(),
    );
    expect(counts).toEqual({
      [checkoutAppId]: 2,
      [marketingAppId]: 1,
    });
  });

  test("a resolver failure returns raw ids instead of failing the whole query", async () => {
    stubQuery({
      topList: [{ dim: checkoutAppId, val: "12", cnt: "12" }],
      main: [
        {
          bucket: "2026-07-14 11:00:00",
          val: "12",
          rumApplicationId: checkoutAppId,
        },
      ],
    });
    const resolveSpy: jest.SpyInstance = failingResolver();

    const rows: Array<TraceAnalyticsTimeseriesRow> =
      await TraceAggregationService.getAnalyticsTimeseries(
        analyticsRequest({ groupBy: ["rumApplicationId"] }),
      );

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(valuesFor(rows, "rumApplicationId")).toEqual([checkoutAppId]);
  });
});

describe("TraceAggregationService.getAnalyticsTable (resource display names)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("rewrites a rumApplicationId group-by from raw ObjectIDs to display names", async () => {
    stubQuery({
      main: [
        { rumApplicationId: checkoutAppId, cnt: "120", p95_ms: "410" },
        { rumApplicationId: marketingAppId, cnt: "40", p95_ms: "180" },
      ],
    });
    stubResolver({
      rumApplicationId: [
        { value: checkoutAppId, count: 1, displayName: "Checkout Web" },
        { value: marketingAppId, count: 1, displayName: "Marketing Site" },
      ],
    });

    const rows: Array<TraceAnalyticsTableRow> =
      await TraceAggregationService.getAnalyticsTable(
        analyticsRequest({ chartType: "table", groupBy: ["rumApplicationId"] }),
      );

    expect(rows).toHaveLength(2);
    expect(valuesFor(rows, "rumApplicationId")).toEqual([
      "Checkout Web",
      "Marketing Site",
    ]);
    // The stat columns must be untouched by the rewrite.
    expect(
      rows.map((row: TraceAnalyticsTableRow): number => {
        return row.count;
      }),
    ).toEqual([120, 40]);
  });

  test("resolves a non-RUM resource key (hostId) the same way", async () => {
    stubQuery({ main: [{ hostId: hostId, cnt: "9" }] });
    const resolveSpy: jest.SpyInstance = stubResolver({
      hostId: [{ value: hostId, count: 1, displayName: "prod-web-01" }],
    });

    const rows: Array<TraceAnalyticsTableRow> =
      await TraceAggregationService.getAnalyticsTable(
        analyticsRequest({ chartType: "table", groupBy: ["hostId"] }),
      );

    expect(rows).toHaveLength(1);
    expect(valuesFor(rows, "hostId")).toEqual(["prod-web-01"]);

    // One batched resolve for the whole group-by, not one call per key.
    expect(resolveSpy).toHaveBeenCalledTimes(1);

    const specs: Array<ResourceFacetSpec> = specsPassedTo(resolveSpy);
    expect(specs).toHaveLength(1);
    expect(specs[0]!.facetKey).toBe("hostId");
  });

  test("a group-by with TWO resource dimensions resolves each key independently", async () => {
    /*
     * Both dimensions read out of primaryEntityId, so the SAME raw id shows up
     * under both keys — and each key must be resolved against its OWN spec.
     * One spec per resource key, no cross-key leakage of display names.
     */
    stubQuery({
      main: [
        {
          rumApplicationId: sharedEntityId,
          hostId: sharedEntityId,
          cnt: "30",
        },
      ],
    });
    const resolveSpy: jest.SpyInstance = stubResolver({
      rumApplicationId: [
        { value: sharedEntityId, count: 1, displayName: "Checkout Web" },
      ],
      hostId: [{ value: sharedEntityId, count: 1, displayName: "prod-web-01" }],
    });

    const rows: Array<TraceAnalyticsTableRow> =
      await TraceAggregationService.getAnalyticsTable(
        analyticsRequest({
          chartType: "table",
          groupBy: ["rumApplicationId", "hostId"],
        }),
      );

    expect(rows).toHaveLength(1);
    // Same raw id in, two DIFFERENT names out — neither key wins both cells.
    expect(valuesFor(rows, "rumApplicationId")).toEqual(["Checkout Web"]);
    expect(valuesFor(rows, "hostId")).toEqual(["prod-web-01"]);

    expect(resolveSpy).toHaveBeenCalledTimes(1);

    // Every resource dimension is asked about, not just the first one.
    const specs: Array<ResourceFacetSpec> = specsPassedTo(resolveSpy);
    expect(specs).toHaveLength(2);
    expect(
      specs.map((spec: ResourceFacetSpec): string => {
        return spec.facetKey;
      }),
    ).toEqual(["rumApplicationId", "hostId"]);

    const secondCounts: Record<string, number> = Object.fromEntries(
      specs[1]!.counts.entries(),
    );
    expect(secondCounts).toEqual({ [sharedEntityId]: 1 });
  });

  test("proxmoxClusterId / cephClusterId are resource dimensions the resolver cannot resolve — no round-trip, ids stay raw", async () => {
    /*
     * Both keys live in TraceAggregationService.RESOURCE_FACET_KEYS but have
     * no branch in ResourceFacetResolver.resolveOne (it returns [] for them),
     * so asking would burn a Postgres round-trip and still leave the cell raw.
     * applyResourceDisplayValues takes the INTERSECTION of the two sets, so
     * the resolver must not be touched at all.
     */
    stubQuery({
      main: [
        {
          proxmoxClusterId: proxmoxClusterId,
          cephClusterId: cephClusterId,
          cnt: "4",
        },
      ],
    });
    const resolveSpy: jest.SpyInstance = stubResolver({
      proxmoxClusterId: [
        { value: proxmoxClusterId, count: 1, displayName: "NOPE" },
      ],
      cephClusterId: [{ value: cephClusterId, count: 1, displayName: "NOPE" }],
    });

    const rows: Array<TraceAnalyticsTableRow> =
      await TraceAggregationService.getAnalyticsTable(
        analyticsRequest({
          chartType: "table",
          groupBy: ["proxmoxClusterId", "cephClusterId"],
        }),
      );

    expect(rows).toHaveLength(1);
    expect(valuesFor(rows, "proxmoxClusterId")).toEqual([proxmoxClusterId]);
    expect(valuesFor(rows, "cephClusterId")).toEqual([cephClusterId]);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  test("primaryEntityId / serviceId are resolvable but are NOT resource dimensions here — left alone", async () => {
    /*
     * The other half of the intersection: the resolver knows both keys, but
     * they select the OpenTelemetry-service slot, which the traces explorer
     * already renames client-side. Rewriting them server-side would change an
     * existing surface, so neither is resolved.
     */
    stubQuery({
      main: [
        {
          primaryEntityId: serviceEntityId,
          attr_1_serviceId: serviceEntityId,
          cnt: "7",
        },
      ],
    });
    const resolveSpy: jest.SpyInstance = stubResolver({
      primaryEntityId: [
        { value: serviceEntityId, count: 1, displayName: "NOPE" },
      ],
      serviceId: [{ value: serviceEntityId, count: 1, displayName: "NOPE" }],
    });

    const rows: Array<TraceAnalyticsTableRow> =
      await TraceAggregationService.getAnalyticsTable(
        analyticsRequest({
          chartType: "table",
          groupBy: ["primaryEntityId", "serviceId"],
        }),
      );

    expect(rows).toHaveLength(1);
    expect(valuesFor(rows, "primaryEntityId")).toEqual([serviceEntityId]);
    expect(valuesFor(rows, "serviceId")).toEqual([serviceEntityId]);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  test("an attribute group-by (resource.browser.platform) is passed through and never hits the resolver", async () => {
    stubQuery({
      main: [
        { attr_0_resource_browser_platform: "macOS", cnt: "90" },
        { attr_0_resource_browser_platform: "Windows", cnt: "60" },
      ],
    });
    const resolveSpy: jest.SpyInstance = stubResolver({});

    const rows: Array<TraceAnalyticsTableRow> =
      await TraceAggregationService.getAnalyticsTable(
        analyticsRequest({
          chartType: "table",
          groupBy: ["resource.browser.platform"],
        }),
      );

    expect(rows).toHaveLength(2);
    expect(valuesFor(rows, "resource.browser.platform")).toEqual([
      "macOS",
      "Windows",
    ]);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  test("in a mixed group-by only the resource dimension is rewritten", async () => {
    stubQuery({
      main: [
        {
          rumApplicationId: checkoutAppId,
          attr_1_app_route: "/checkout/payment",
          cnt: "30",
        },
      ],
    });
    const resolveSpy: jest.SpyInstance = stubResolver({
      rumApplicationId: [
        { value: checkoutAppId, count: 1, displayName: "Checkout Web" },
      ],
    });

    const rows: Array<TraceAnalyticsTableRow> =
      await TraceAggregationService.getAnalyticsTable(
        analyticsRequest({
          chartType: "table",
          groupBy: ["rumApplicationId", "app.route"],
        }),
      );

    expect(rows).toHaveLength(1);
    expect(valuesFor(rows, "rumApplicationId")).toEqual(["Checkout Web"]);
    expect(valuesFor(rows, "app.route")).toEqual(["/checkout/payment"]);

    // One batched resolve for the whole group-by, not one call per key.
    expect(resolveSpy).toHaveBeenCalledTimes(1);

    // No spec is requested for the attribute dimension.
    const specs: Array<ResourceFacetSpec> = specsPassedTo(resolveSpy);
    expect(specs).toHaveLength(1);
    expect(specs[0]!.facetKey).toBe("rumApplicationId");
  });

  test("zero rows does not call the resolver", async () => {
    stubQuery({ main: [] });
    const resolveSpy: jest.SpyInstance = stubResolver({
      rumApplicationId: [
        { value: checkoutAppId, count: 1, displayName: "Checkout Web" },
      ],
    });

    const rows: Array<TraceAnalyticsTableRow> =
      await TraceAggregationService.getAnalyticsTable(
        analyticsRequest({ chartType: "table", groupBy: ["rumApplicationId"] }),
      );

    expect(rows).toEqual([]);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  test("a resolver failure returns raw ids instead of failing the whole query", async () => {
    stubQuery({ main: [{ rumApplicationId: checkoutAppId, cnt: "120" }] });
    const resolveSpy: jest.SpyInstance = failingResolver();

    const rows: Array<TraceAnalyticsTableRow> =
      await TraceAggregationService.getAnalyticsTable(
        analyticsRequest({ chartType: "table", groupBy: ["rumApplicationId"] }),
      );

    // Without this the test also passes if the table path never resolves at all.
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(valuesFor(rows, "rumApplicationId")).toEqual([checkoutAppId]);
  });
});

/*
 * The top list is the odd one out ON PURPOSE. getAnalyticsTimeseries feeds
 * these values back into its own query as an `IN (...)` predicate against
 * toString(primaryEntityId), and the AI latency detectors key off them. A
 * display name here would match zero spans and silently empty the chart.
 */
describe("TraceAggregationService.getAnalyticsTopList (raw ids preserved)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("does NOT resolve display names for a rumApplicationId group-by", async () => {
    stubQuery({
      topList: [
        { dim: checkoutAppId, val: "12", cnt: "12" },
        { dim: marketingAppId, val: "5", cnt: "5" },
      ],
    });
    const resolveSpy: jest.SpyInstance = stubResolver({
      rumApplicationId: [
        { value: checkoutAppId, count: 12, displayName: "Checkout Web" },
        { value: marketingAppId, count: 5, displayName: "Marketing Site" },
      ],
    });

    const items: Array<TraceAnalyticsTopItem> =
      await TraceAggregationService.getAnalyticsTopList(
        analyticsRequest({
          chartType: "toplist",
          groupBy: ["rumApplicationId"],
        }),
      );

    expect(items).toHaveLength(2);
    expect(
      items.map((item: TraceAnalyticsTopItem): string => {
        return item.value;
      }),
    ).toEqual([checkoutAppId, marketingAppId]);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  test("the series cap the timeseries applies is built from raw ids, not display names", async () => {
    const querySpy: jest.SpyInstance = stubQuery({
      topList: [{ dim: checkoutAppId, val: "12", cnt: "12" }],
      main: [
        {
          bucket: "2026-07-14 11:00:00",
          val: "12",
          rumApplicationId: checkoutAppId,
        },
      ],
    });
    stubResolver({
      rumApplicationId: [
        { value: checkoutAppId, count: 1, displayName: "Checkout Web" },
      ],
    });

    await TraceAggregationService.getAnalyticsTimeseries(
      analyticsRequest({ groupBy: ["rumApplicationId"] }),
    );

    expect(querySpy).toHaveBeenCalledTimes(2);

    const timeseriesStatement: Statement = querySpy.mock
      .calls[1]![0] as Statement;
    // The `IN (...)` value binds as an array param — flatten before matching.
    const params: Array<unknown> = Object.values(
      timeseriesStatement.query_params,
    ).flat();

    // The IN filter carries the raw id; a display name would match no spans.
    expect(params).toContain(checkoutAppId);
    expect(params).not.toContain("Checkout Web");
  });
});
