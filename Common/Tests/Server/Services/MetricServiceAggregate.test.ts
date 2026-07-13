import "../TestingUtils/Init";
import { MetricService } from "../../../Server/Services/MetricService";
import Metric from "../../../Models/AnalyticsModels/Metric";
import AggregateBy from "../../../Server/Types/AnalyticsDatabase/AggregateBy";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";

describe("MetricService aggregate statement generation", () => {
  const projectId: ObjectID = ObjectID.generate();
  const startDate: Date = new Date("2026-07-09T19:08:00.000Z");
  const endDate: Date = new Date("2026-07-09T19:13:00.000Z");

  let service: MetricService;

  beforeEach(() => {
    service = new MetricService();
  });

  type BuildAggregateByFunction = (
    overrides?: Partial<AggregateBy<Metric>>,
  ) => AggregateBy<Metric>;

  const buildAggregateBy: BuildAggregateByFunction = (
    overrides?: Partial<AggregateBy<Metric>>,
  ): AggregateBy<Metric> => {
    return {
      query: {
        projectId: projectId,
        name: "http.client.request.duration",
        time: new InBetween(startDate, endDate),
      } as AggregateBy<Metric>["query"],
      aggregationType: AggregationType.Avg,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      startTimestamp: startDate,
      endTimestamp: endDate,
      limit: 10000,
      skip: 0,
      sort: { time: SortOrder.Ascending } as AggregateBy<Metric>["sort"],
      props: { isRoot: true },
      ...overrides,
    };
  };

  type GetQueryFunction = (aggregateBy: AggregateBy<Metric>) => string;

  const getQuery: GetQueryFunction = (
    aggregateBy: AggregateBy<Metric>,
  ): string => {
    const result: { statement: Statement; columns: Array<string> } =
      service.toAggregateStatement(aggregateBy);
    return result.statement.query;
  };

  describe("scalar aggregations", () => {
    it("routes plain Avg (no filters, no group-by, no distribution hint) to the minute MV", () => {
      const query: string = getQuery(buildAggregateBy());
      expect(query).toContain("MetricItemAggMV1m");
    });

    it("skips the MVs and uses count-weighted expressions when the metric is a distribution (histogram) metric", () => {
      const aggregateBy: AggregateBy<Metric> = buildAggregateBy();
      (
        service as unknown as {
          pointTypeHintByAggregate: WeakMap<AggregateBy<Metric>, string | null>;
        }
      ).pointTypeHintByAggregate.set(aggregateBy, "Histogram");

      const query: string = getQuery(aggregateBy);

      expect(query).not.toContain("MetricItemAggMV1m");
      /*
       * Avg must be count-weighted (sum of observation totals divided
       * by sum of observation counts) — NOT avg(value), which for
       * histogram rows averages per-export-interval sums.
       */
      expect(query).toContain("sum(multiIf(isNotNull(count)");
      expect(query).toContain("toFloat64(count)");
      expect(query).not.toContain("avg(value)");
    });

    it("uses count-weighted expressions on the base table when an attribute filter blocks the MVs", () => {
      const aggregateBy: AggregateBy<Metric> = buildAggregateBy({
        query: {
          projectId: projectId,
          name: "http.client.request.duration",
          time: new InBetween(startDate, endDate),
          attributes: { "oneuptime.service.name": "starship-web" },
        } as unknown as AggregateBy<Metric>["query"],
      });

      const query: string = getQuery(aggregateBy);

      expect(query).not.toContain("MetricItemAggMV1m");
      expect(query).toContain("sum(multiIf(isNotNull(count)");
    });

    it("groups by individual attribute keys, not the whole attributes map", () => {
      const aggregateBy: AggregateBy<Metric> = buildAggregateBy({
        groupByAttributeKeys: ["oneuptime.service.name"],
      });

      const result: { statement: Statement; columns: Array<string> } =
        service.toAggregateStatement(aggregateBy);
      const query: string = result.statement.query;

      // Key extraction is parameter-bound and aliased...
      expect(query).toMatch(/attributes\[\{p\d+:String\}\] AS __attr_grp_0/);
      // ...regrouped rows re-project the selected keys as a compact map...
      expect(query).toMatch(
        /map\(\{p\d+:String\}, __attr_grp_0\) AS attributes/,
      );
      // ...grouping happens on the extracted key, never the Map column.
      expect(query).toContain("GROUP BY time, __attr_grp_0");
      expect(query).not.toContain("GROUP BY time, attributes");

      // The selected key reaches the query only as a bound parameter.
      const parameterValues: Array<unknown> = Object.values(
        result.statement.query_params,
      );
      expect(
        parameterValues.filter((value: unknown) => {
          return value === "oneuptime.service.name";
        }),
      ).toHaveLength(2); // extraction + map key

      expect(result.columns).toContain("attributes");
    });

    it("drops a legacy whole-map attributes group-by when key-scoped grouping is requested", () => {
      const aggregateBy: AggregateBy<Metric> = buildAggregateBy({
        groupBy: { attributes: true } as AggregateBy<Metric>["groupBy"],
        groupByAttributeKeys: ["oneuptime.service.name"],
      });

      const query: string = getQuery(aggregateBy);

      expect(query).toContain("GROUP BY time, __attr_grp_0");
      expect(query).not.toContain("GROUP BY time, attributes");
    });

    it("rejects more than 10 group-by attribute keys", () => {
      const aggregateBy: AggregateBy<Metric> = buildAggregateBy({
        groupByAttributeKeys: Array.from(
          { length: 11 },
          (_: unknown, i: number) => {
            return `key.${i}`;
          },
        ),
      });

      expect(() => {
        return service.toAggregateStatement(aggregateBy);
      }).toThrow(BadDataException);
    });
  });

  describe("percentile aggregations", () => {
    it("keeps the histogram bucket fanout and pools by selected attribute keys", () => {
      const aggregateBy: AggregateBy<Metric> = buildAggregateBy({
        aggregationType: AggregationType.P90,
        groupByAttributeKeys: ["oneuptime.service.name"],
      });

      const result: { statement: Statement; columns: Array<string> } =
        service.toAggregateStatement(aggregateBy);
      const query: string = result.statement.query;

      expect(query).toContain("quantileExactWeighted(0.9)");
      expect(query).toMatch(/attributes\[\{p\d+:String\}\] AS __attr_grp_0/);
      expect(query).toMatch(
        /map\(\{p\d+:String\}, __attr_grp_0\) AS attributes/,
      );
      expect(query).toContain("GROUP BY time, __attr_grp_0");
      expect(result.columns).toContain("attributes");
    });

    it("does not group when no attribute keys are selected (regression: whole-map fragmentation)", () => {
      const aggregateBy: AggregateBy<Metric> = buildAggregateBy({
        aggregationType: AggregationType.P90,
      });

      const query: string = getQuery(aggregateBy);

      expect(query).toContain("quantileExactWeighted(0.9)");
      expect(query).not.toContain("__attr_grp_0");
      expect(query).toContain("GROUP BY time");
    });
  });

  /*
   * The `aggregationInterval` override lets callers pin the time bucket
   * independent of the query window (the two scenarios from the customer
   * thread: "daily uptime per host over a week" and "one weekly average
   * per host"). The buildAggregateBy window is 5 minutes, so its
   * window-derived interval is Minute — every assertion below proves the
   * override wins over that default.
   */
  describe("explicit aggregationInterval override", () => {
    it("pins a Day bucket over the window-derived Minute (per-host daily)", () => {
      const aggregateBy: AggregateBy<Metric> = buildAggregateBy({
        aggregationInterval: AggregationInterval.Day,
        groupByAttributeKeys: ["host.name"],
      });

      const query: string = getQuery(aggregateBy);

      expect(query).toContain(
        "date_trunc('day', toStartOfInterval(time, INTERVAL 1 day))",
      );
      expect(query).toContain("GROUP BY time, __attr_grp_0");
      // The 5-minute window's default Minute bucket must NOT leak through.
      expect(query).not.toContain("date_trunc('minute'");
    });

    it("honors an explicit Day interval on the minute MV fast path", () => {
      const aggregateBy: AggregateBy<Metric> = buildAggregateBy({
        aggregationInterval: AggregationInterval.Day,
      });

      const query: string = getQuery(aggregateBy);

      expect(query).toContain("MetricItemAggMV1m");
      expect(query).toContain("date_trunc('day'");
    });

    it("honors an explicit Day interval on the percentile path", () => {
      const aggregateBy: AggregateBy<Metric> = buildAggregateBy({
        aggregationType: AggregationType.P90,
        aggregationInterval: AggregationInterval.Day,
        groupByAttributeKeys: ["host.name"],
      });

      const query: string = getQuery(aggregateBy);

      expect(query).toContain("quantileExactWeighted(0.9)");
      expect(query).toContain("date_trunc('day'");
      expect(query).toContain("GROUP BY time, __attr_grp_0");
    });

    it("reproduces the window-derived bucket SQL when omitted (regression)", () => {
      /*
       * Distribution hint forces the base scalar builder (skips the MVs).
       * The 5-minute window must still derive a Minute bucket, unchanged.
       */
      const aggregateBy: AggregateBy<Metric> = buildAggregateBy();
      (
        service as unknown as {
          pointTypeHintByAggregate: WeakMap<AggregateBy<Metric>, string | null>;
        }
      ).pointTypeHintByAggregate.set(aggregateBy, "Histogram");

      const query: string = getQuery(aggregateBy);

      expect(query).toContain(
        "date_trunc('minute', toStartOfInterval(time, INTERVAL 1 minute))",
      );
      expect(query).toContain("GROUP BY time");
      expect(query).not.toContain("min(time) as time");
      expect(query).not.toContain("HAVING count() > 0");
    });
  });

  /*
   * `Total` = no time bucketing: the entire window collapses into a single
   * aggregate per group. The bucket timestamp becomes `min(time)` (an
   * aggregate, not a group key), so `time` must drop out of GROUP BY —
   * and the clause disappears entirely when nothing else is grouped.
   */
  describe("Total (whole-window) aggregation", () => {
    it("collapses the window into one row per host (scalar Avg)", () => {
      const aggregateBy: AggregateBy<Metric> = buildAggregateBy({
        aggregationInterval: AggregationInterval.Total,
        groupByAttributeKeys: ["host.name"],
      });

      const query: string = getQuery(aggregateBy);

      expect(query).toContain("min(time) as time");
      expect(query).not.toContain("date_trunc");
      expect(query).toContain("GROUP BY __attr_grp_0");
      expect(query).not.toContain("GROUP BY time");
    });

    it("emits a single global aggregate with no GROUP BY when nothing is grouped", () => {
      const aggregateBy: AggregateBy<Metric> = buildAggregateBy({
        aggregationInterval: AggregationInterval.Total,
        /*
         * An attribute filter (not a host filter) blocks every MV and
         * routes to the base scalar builder without a group-by.
         */
        query: {
          projectId: projectId,
          name: "http.client.request.duration",
          time: new InBetween(startDate, endDate),
          attributes: { "oneuptime.service.name": "starship-web" },
        } as unknown as AggregateBy<Metric>["query"],
      });

      const query: string = getQuery(aggregateBy);

      expect(query).not.toContain("MetricItemAggMV1m");
      expect(query).toContain("min(time) as time");
      expect(query).not.toContain("GROUP BY");
      // The phantom row an empty window would return is suppressed.
      expect(query).toContain("HAVING count() > 0");
    });

    it("falls back from the minute MV to the base table for Total", () => {
      const aggregateBy: AggregateBy<Metric> = buildAggregateBy({
        aggregationInterval: AggregationInterval.Total,
      });

      const query: string = getQuery(aggregateBy);

      // The time-bucketed MV cannot serve a whole-window aggregation.
      expect(query).not.toContain("MetricItemAggMV1m");
      expect(query).toContain("min(time) as time");
      expect(query).not.toContain("GROUP BY");
      expect(query).toContain("HAVING count() > 0");
    });

    it("keeps a model-column groupBy while dropping the time bucket (Total)", () => {
      const aggregateBy: AggregateBy<Metric> = buildAggregateBy({
        aggregationInterval: AggregationInterval.Total,
        groupBy: { metricPointType: true } as AggregateBy<Metric>["groupBy"],
      });

      const query: string = getQuery(aggregateBy);

      expect(query).toContain("min(time) as time");
      // The model column survives as the sole grouping key...
      expect(query).toContain("GROUP BY metricPointType");
      // ...and the time bucket is gone (it is now an aggregate).
      expect(query).not.toContain("GROUP BY time");
      expect(query).not.toContain("date_trunc");
      // A grouped query never emits the empty-window guard.
      expect(query).not.toContain("HAVING count() > 0");
    });

    it("collapses the window into one row per host on the percentile path", () => {
      const aggregateBy: AggregateBy<Metric> = buildAggregateBy({
        aggregationType: AggregationType.P90,
        aggregationInterval: AggregationInterval.Total,
        groupByAttributeKeys: ["host.name"],
      });

      const query: string = getQuery(aggregateBy);

      expect(query).toContain("quantileExactWeighted(0.9)");
      expect(query).toContain("min(time) as time");
      expect(query).toContain("GROUP BY __attr_grp_0");
      expect(query).not.toContain("date_trunc");
    });
  });
});
