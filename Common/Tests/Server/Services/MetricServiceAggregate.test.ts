import "../TestingUtils/Init";
import { MetricService } from "../../../Server/Services/MetricService";
import Metric from "../../../Models/AnalyticsModels/Metric";
import AggregateBy from "../../../Server/Types/AnalyticsDatabase/AggregateBy";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  keyForHost,
  keyForKubernetesCluster,
  keyForService,
} from "../../../Utils/Telemetry/EntityKey";
import { keyForContainer } from "../../../Server/Utils/Telemetry/TelemetryEntity";
import TelemetryEntityService from "../../../Server/Services/TelemetryEntityService";
import TelemetryEntity from "../../../Models/DatabaseModels/TelemetryEntity";

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

  /*
   * The sub-hour tiers (FiveMinutes/FifteenMinutes/ThirtyMinutes) are NOT
   * valid ClickHouse date_trunc units — they must compile through the
   * shared AggregateUtil expression map to `toStartOfInterval(col,
   * INTERVAL n MINUTE)`, never to `date_trunc('fiveminutes', ...)`.
   */
  describe("sub-hour interval tiers", () => {
    const windowStart: Date = new Date("2026-07-09T00:00:00.000Z");

    type BuildWindowedFunction = (
      hours: number,
      overrides?: Partial<AggregateBy<Metric>>,
    ) => AggregateBy<Metric>;

    const buildWindowed: BuildWindowedFunction = (
      hours: number,
      overrides?: Partial<AggregateBy<Metric>>,
    ): AggregateBy<Metric> => {
      const windowEnd: Date = new Date(
        windowStart.getTime() + hours * 60 * 60 * 1000,
      );
      return buildAggregateBy({
        query: {
          projectId: projectId,
          name: "http.client.request.duration",
          time: new InBetween(windowStart, windowEnd),
        } as AggregateBy<Metric>["query"],
        startTimestamp: windowStart,
        endTimestamp: windowEnd,
        ...overrides,
      });
    };

    it("serves a 4h window from the minute MV at 5-minute buckets", () => {
      const query: string = getQuery(buildWindowed(4));

      expect(query).toContain("MetricItemAggMV1m");
      expect(query).toContain(
        "toStartOfInterval(bucketTime, INTERVAL 5 MINUTE) as time",
      );
      expect(query).not.toContain("date_trunc");
    });

    it("serves an 18h window at 15-minute buckets and a 2d window at 30-minute buckets", () => {
      const query18h: string = getQuery(buildWindowed(18));
      expect(query18h).toContain(
        "toStartOfInterval(bucketTime, INTERVAL 15 MINUTE) as time",
      );

      const query2d: string = getQuery(buildWindowed(48));
      expect(query2d).toContain(
        "toStartOfInterval(bucketTime, INTERVAL 30 MINUTE) as time",
      );
    });

    it("keeps the legacy date_trunc form for windows <= 3h", () => {
      const query: string = getQuery(buildWindowed(2));

      expect(query).toContain(
        "date_trunc('minute', toStartOfInterval(bucketTime, INTERVAL 1 minute))",
      );
      expect(query).not.toContain("INTERVAL 5 MINUTE");
    });

    it("compiles 5-minute buckets on the base scalar builder (distribution metric)", () => {
      const aggregateBy: AggregateBy<Metric> = buildWindowed(4);
      (
        service as unknown as {
          pointTypeHintByAggregate: WeakMap<AggregateBy<Metric>, string | null>;
        }
      ).pointTypeHintByAggregate.set(aggregateBy, "Histogram");

      const query: string = getQuery(aggregateBy);

      expect(query).not.toContain("MetricItemAggMV1m");
      expect(query).toContain(
        "toStartOfInterval(time, INTERVAL 5 MINUTE) as time",
      );
      expect(query).not.toContain("fiveminutes");
    });

    it("compiles 5-minute buckets on the percentile path", () => {
      const query: string = getQuery(
        buildWindowed(4, { aggregationType: AggregationType.P90 }),
      );

      expect(query).toContain("quantileExactWeighted(0.9)");
      expect(query).toContain(
        "toStartOfInterval(time, INTERVAL 5 MINUTE) as time",
      );
    });

    it("compiles 5-minute buckets on the per-host MV path", () => {
      const query: string = getQuery(
        buildWindowed(4, {
          query: {
            projectId: projectId,
            name: "http.client.request.duration",
            time: new InBetween(
              windowStart,
              new Date(windowStart.getTime() + 4 * 60 * 60 * 1000),
            ),
            attributes: { "resource.host.name": "web-01" },
          } as unknown as AggregateBy<Metric>["query"],
        }),
      );

      expect(query).toContain("MetricItemAggMV1mByHostV2");
      expect(query).toContain(
        "toStartOfInterval(bucketTime, INTERVAL 5 MINUTE) as time",
      );
    });

    it("honors an explicit FiveMinutes override independent of the window", () => {
      // The default 5-minute window derives Minute; the override pins 5m.
      const query: string = getQuery(
        buildAggregateBy({
          aggregationInterval: AggregationInterval.FiveMinutes,
        }),
      );

      expect(query).toContain(
        "toStartOfInterval(bucketTime, INTERVAL 5 MINUTE) as time",
      );
    });
  });

  describe("execution-time cap settings", () => {
    const expectCapped: (query: string) => void = (query: string): void => {
      expect(query).toContain("max_execution_time = 45");
      expect(query).toContain("timeout_overflow_mode = 'break'");
    };

    it("caps the minute MV path", () => {
      expectCapped(getQuery(buildAggregateBy()));
    });

    it("caps the base scalar path", () => {
      expectCapped(
        getQuery(
          buildAggregateBy({
            groupByAttributeKeys: ["host.name"],
          }),
        ),
      );
    });

    it("caps the percentile path", () => {
      expectCapped(
        getQuery(buildAggregateBy({ aggregationType: AggregationType.P90 })),
      );
    });

    it("caps the per-host MV path", () => {
      expectCapped(
        getQuery(
          buildAggregateBy({
            query: {
              projectId: projectId,
              name: "http.client.request.duration",
              time: new InBetween(startDate, endDate),
              attributes: { "resource.host.name": "web-01" },
            } as unknown as AggregateBy<Metric>["query"],
          }),
        ),
      );
    });
  });

  /*
   * Server-side Top-K: grouped aggregations rank groups over the whole
   * window in an IN-subquery, restrict the bucketed aggregation to the
   * winners, and carry the pre-trim group count as `__total_groups`.
   */
  describe("server-side Top-K", () => {
    it("restricts a grouped scalar aggregation to the top K groups (rankBy max)", () => {
      const result: { statement: Statement; columns: Array<string> } =
        service.toAggregateStatement(
          buildAggregateBy({
            groupByAttributeKeys: ["host.name"],
            topK: { count: 10, rankBy: "max" },
          }),
        );
      const query: string = result.statement.query;

      expect(query).toContain(") IN (SELECT ");
      expect(query).toContain("ORDER BY max(value) DESC");
      expect(query).toContain("uniqExact(");
      expect(query).toContain("AS __total_groups");
      // topK.count only reaches the SQL as a bound parameter.
      expect(query).not.toContain("LIMIT 10)");
      expect(
        Object.values(result.statement.query_params).filter(
          (value: unknown) => {
            return value === 10;
          },
        ).length,
      ).toBeGreaterThanOrEqual(1);
    });

    it("ranks by avg when requested", () => {
      const query: string = getQuery(
        buildAggregateBy({
          groupByAttributeKeys: ["host.name"],
          topK: { count: 5, rankBy: "avg" },
        }),
      );

      expect(query).toContain("ORDER BY avg(value) DESC");
      expect(query).not.toContain("ORDER BY max(value) DESC");
    });

    it("applies Top-K to grouped percentile aggregations (p95-by-host)", () => {
      const query: string = getQuery(
        buildAggregateBy({
          aggregationType: AggregationType.P95,
          groupByAttributeKeys: ["host.name"],
          topK: { count: 10, rankBy: "max" },
        }),
      );

      expect(query).toContain("quantileExactWeighted(0.95)");
      expect(query).toContain(") IN (SELECT ");
      expect(query).toContain("ORDER BY max(value) DESC");
      expect(query).toContain("AS __total_groups");
    });

    it("applies Top-K to model-column group-bys on the scalar path", () => {
      const query: string = getQuery(
        buildAggregateBy({
          groupBy: { metricPointType: true } as AggregateBy<Metric>["groupBy"],
          topK: { count: 3, rankBy: "max" },
        }),
      );

      expect(query).toContain("metricPointType) IN (SELECT metricPointType");
      expect(query).toContain("uniqExact(metricPointType)");
    });

    it("ignores topK for ungrouped aggregations", () => {
      const query: string = getQuery(
        buildAggregateBy({
          // Attribute filter forces the base scalar builder, no grouping.
          query: {
            projectId: projectId,
            name: "http.client.request.duration",
            time: new InBetween(startDate, endDate),
            attributes: { "oneuptime.service.name": "starship-web" },
          } as unknown as AggregateBy<Metric>["query"],
          topK: { count: 10, rankBy: "max" },
        }),
      );

      expect(query).not.toContain("__total_groups");
      expect(query).not.toContain(") IN (SELECT ");
    });

    it("rejects a non-positive topK.count", () => {
      expect(() => {
        return service.toAggregateStatement(
          buildAggregateBy({
            groupByAttributeKeys: ["host.name"],
            topK: { count: 0, rankBy: "max" },
          }),
        );
      }).toThrow(BadDataException);
    });

    it("rejects an unknown topK.rankBy", () => {
      expect(() => {
        return service.toAggregateStatement(
          buildAggregateBy({
            groupByAttributeKeys: ["host.name"],
            topK: {
              count: 10,
              rankBy: "sum(1); DROP TABLE x" as unknown as "max",
            },
          }),
        );
      }).toThrow(BadDataException);
    });

    it("applies Top-K to grouped mutable-metric aggregations over the deduped rows", () => {
      // "oneuptime.incident.count" is a registered mutable metric name.
      const buildMutable: (
        overrides?: Partial<AggregateBy<Metric>>,
      ) => AggregateBy<Metric> = (
        overrides?: Partial<AggregateBy<Metric>>,
      ): AggregateBy<Metric> => {
        return buildAggregateBy({
          query: {
            projectId: projectId,
            name: "oneuptime.incident.count",
            time: new InBetween(startDate, endDate),
          } as AggregateBy<Metric>["query"],
          groupBy: {
            primaryEntityType: true,
          } as AggregateBy<Metric>["groupBy"],
          ...overrides,
        });
      };

      const result: { statement: Statement; columns: Array<string> } =
        service.toAggregateStatement(
          buildMutable({ topK: { count: 5, rankBy: "max" } }),
        );
      const query: string = result.statement.query;

      // Routed to the mutable table (bound as an identifier parameter).
      expect(Object.values(result.statement.query_params)).toContain(
        "MutableMetricItem",
      );
      expect(query).toContain(
        "primaryEntityType) IN (SELECT primaryEntityType",
      );
      expect(query).toContain("ORDER BY max(value) DESC");
      expect(query).toContain("uniqExact(primaryEntityType)");
      expect(query).toContain("AS __total_groups");
      // Ranking must run over the argMax-deduped rows, not raw versions.
      expect(
        query.split("argMax(value, version) AS value").length - 1,
      ).toBeGreaterThanOrEqual(3);

      // Without topK the mutable statement stays free of Top-K artifacts.
      const plainQuery: string = getQuery(buildMutable());
      expect(plainQuery).not.toContain("__total_groups");
      expect(plainQuery).not.toContain(") IN (SELECT ");
    });

    it("emits an identical statement when topK is absent vs explicitly undefined", () => {
      const withoutField: { statement: Statement; columns: Array<string> } =
        service.toAggregateStatement(
          buildAggregateBy({ groupByAttributeKeys: ["host.name"] }),
        );
      const withUndefined: { statement: Statement; columns: Array<string> } =
        service.toAggregateStatement(
          buildAggregateBy({
            groupByAttributeKeys: ["host.name"],
            topK: undefined,
          }),
        );

      expect(withoutField.statement.query).toBe(withUndefined.statement.query);
      expect(withoutField.statement.query_params).toStrictEqual(
        withUndefined.statement.query_params,
      );
      // And no Top-K artifacts leak into the plain grouped statement.
      expect(withoutField.statement.query).not.toContain("__total_groups");
      expect(withoutField.statement.query).not.toContain(") IN (SELECT ");
    });
  });

  /*
   * Result assembly: `__total_groups` is lifted off the first row into
   * AggregatedResult.totalGroups, and `truncated` flags both row-limit
   * saturation (heuristic) and Top-K group truncation (exact).
   */
  describe("aggregate result assembly (truncated / totalGroups)", () => {
    type MockRowsFunction = (rows: Array<Record<string, unknown>>) => void;

    const mockExecuteQuery: MockRowsFunction = (
      rows: Array<Record<string, unknown>>,
    ): void => {
      (
        service as unknown as {
          executeQuery: (statement: Statement) => Promise<unknown>;
        }
      ).executeQuery = async (): Promise<unknown> => {
        return {
          json: async (): Promise<{ data: Array<Record<string, unknown>> }> => {
            return { data: rows };
          },
        };
      };
    };

    const bucketRow: (
      overrides?: Record<string, unknown>,
    ) => Record<string, unknown> = (
      overrides?: Record<string, unknown>,
    ): Record<string, unknown> => {
      return {
        time: "2026-07-09T19:10:00.000Z",
        value: 42,
        attributes: { "host.name": "web-01" },
        ...overrides,
      };
    };

    it("returns truncated=false and no totalGroups on an unsaturated non-topK result", async () => {
      mockExecuteQuery([bucketRow()]);

      const result: AggregatedResult = await service.aggregateBy(
        buildAggregateBy({ groupByAttributeKeys: ["host.name"] }),
      );

      expect(result.data).toHaveLength(1);
      expect(result.truncated).toBe(false);
      expect(result.totalGroups).toBeUndefined();
    });

    it("flags truncated=true when the row count hits the applied limit", async () => {
      mockExecuteQuery([
        bucketRow(),
        bucketRow({ time: "2026-07-09T19:11:00.000Z" }),
      ]);

      const result: AggregatedResult = await service.aggregateBy(
        buildAggregateBy({
          groupByAttributeKeys: ["host.name"],
          limit: 2,
        }),
      );

      expect(result.data).toHaveLength(2);
      expect(result.truncated).toBe(true);
    });

    it("lifts __total_groups into totalGroups and flags Top-K truncation", async () => {
      mockExecuteQuery([
        bucketRow({ __total_groups: "25" }),
        bucketRow({
          time: "2026-07-09T19:11:00.000Z",
          __total_groups: "25",
        }),
      ]);

      const result: AggregatedResult = await service.aggregateBy(
        buildAggregateBy({
          groupByAttributeKeys: ["host.name"],
          topK: { count: 10, rankBy: "max" },
        }),
      );

      expect(result.totalGroups).toBe(25);
      expect(result.truncated).toBe(true);
      // The helper column never reaches the per-row payload.
      expect(result.data[0]!["__total_groups"]).toBeUndefined();
    });

    it("reports truncated=false when every group fit inside topK.count", async () => {
      mockExecuteQuery([bucketRow({ __total_groups: "3" })]);

      const result: AggregatedResult = await service.aggregateBy(
        buildAggregateBy({
          groupByAttributeKeys: ["host.name"],
          topK: { count: 10, rankBy: "max" },
        }),
      );

      expect(result.totalGroups).toBe(3);
      expect(result.truncated).toBe(false);
    });
  });

  /*
   * Entity-scoped MV routing (tryBuildEntityAggregateMVStatement): each
   * branch of the routing decision table either routes to the matching
   * per-entity rollup with a key predicate at least as selective as (and
   * no more lossy than) the raw predicate it replaces, or bails to the
   * raw path. When in doubt the builder must NOT route.
   */
  describe("entity-scoped MV routing", () => {
    type BuildEntityQueryFunction = (
      entityFilter: Record<string, unknown>,
      overrides?: Partial<AggregateBy<Metric>>,
    ) => AggregateBy<Metric>;

    const buildEntityAggregate: BuildEntityQueryFunction = (
      entityFilter: Record<string, unknown>,
      overrides?: Partial<AggregateBy<Metric>>,
    ): AggregateBy<Metric> => {
      return buildAggregateBy({
        query: {
          projectId: projectId,
          name: "http.client.request.duration",
          time: new InBetween(startDate, endDate),
          ...entityFilter,
        } as unknown as AggregateBy<Metric>["query"],
        ...overrides,
      });
    };

    describe("attribute-equality routes", () => {
      it("routes a k8s.cluster.name filter to the per-cluster MV with the derived key", () => {
        const result: { statement: Statement; columns: Array<string> } =
          service.toAggregateStatement(
            buildEntityAggregate({
              attributes: { "resource.k8s.cluster.name": "Prod-EU-1" },
            }),
          );
        const query: string = result.statement.query;

        expect(query).toContain("MetricItemAggMV1mByK8sCluster");
        expect(query).toMatch(/ AND k8sClusterEntityKey = \{p\d+:String\}/);
        // Avg merges the stored sum/count states.
        expect(query).toContain(
          "sumMerge(valueSumState) / countMerge(valueCountState)",
        );
        // The key reaches SQL only as a bound parameter, byte-identical
        // to what ingest stamps (canonicalized inside keyForKubernetesCluster).
        expect(Object.values(result.statement.query_params)).toContain(
          keyForKubernetesCluster(projectId.toString(), "Prod-EU-1"),
        );
      });

      it("routes a container.id filter to the per-container MV with the derived key", () => {
        const result: { statement: Statement; columns: Array<string> } =
          service.toAggregateStatement(
            buildEntityAggregate({
              attributes: { "resource.container.id": "abc123def456" },
            }),
          );
        const query: string = result.statement.query;

        expect(query).toContain("MetricItemAggMV1mByContainer");
        expect(query).toMatch(/ AND containerEntityKey = \{p\d+:String\}/);
        expect(Object.values(result.statement.query_params)).toContain(
          keyForContainer(projectId.toString(), "abc123def456"),
        );
      });

      it("keeps routing a resource.host.name filter to the per-host MV (regression)", () => {
        const result: { statement: Statement; columns: Array<string> } =
          service.toAggregateStatement(
            buildEntityAggregate({
              attributes: { "resource.host.name": "web-01" },
            }),
          );
        const query: string = result.statement.query;

        expect(query).toContain("MetricItemAggMV1mByHostV2");
        expect(query).toMatch(/ AND hostEntityKey = \{p\d+:String\}/);
        expect(Object.values(result.statement.query_params)).toContain(
          keyForHost(projectId.toString(), "web-01"),
        );
      });

      it("merges the matching state per aggregation type", () => {
        const cases: Array<[AggregationType, string]> = [
          [AggregationType.Sum, "sumMerge(valueSumState) as value"],
          [AggregationType.Count, "countMerge(valueCountState) as value"],
          [AggregationType.Min, "minMerge(valueMinState) as value"],
          [AggregationType.Max, "maxMerge(valueMaxState) as value"],
        ];
        for (const [aggregationType, expected] of cases) {
          const query: string = getQuery(
            buildEntityAggregate(
              {
                attributes: { "resource.k8s.cluster.name": "prod-eu-1" },
              },
              { aggregationType },
            ),
          );
          expect(query).toContain("MetricItemAggMV1mByK8sCluster");
          expect(query).toContain(expected);
        }
      });

      it("caps execution time on the entity MV paths", () => {
        const query: string = getQuery(
          buildEntityAggregate({
            attributes: { "resource.k8s.cluster.name": "prod-eu-1" },
          }),
        );
        expect(query).toContain("max_execution_time = 45");
        expect(query).toContain("timeout_overflow_mode = 'break'");
      });
    });

    describe("service route (registry key set)", () => {
      const setServiceKeysHint: (
        aggregateBy: AggregateBy<Metric>,
        keys: Array<string>,
      ) => void = (
        aggregateBy: AggregateBy<Metric>,
        keys: Array<string>,
      ): void => {
        (
          service as unknown as {
            serviceEntityKeysHintByAggregate: WeakMap<
              AggregateBy<Metric>,
              Array<string>
            >;
          }
        ).serviceEntityKeysHintByAggregate.set(aggregateBy, keys);
      };

      it("falls back to raw without a registry hint (sync caller / registry miss)", () => {
        const query: string = getQuery(
          buildEntityAggregate({
            attributes: { "resource.service.name": "checkout" },
          }),
        );

        expect(query).not.toContain("MetricItemAggMV1mByService");
        // Raw scalar path: distribution-aware expressions over the base table.
        expect(query).toContain("sum(multiIf(isNotNull(count)");
      });

      it("routes with serviceEntityKey IN (<keys>) when the registry resolved several variants", () => {
        const keys: Array<string> = [
          "1111222233334444",
          keyForService(projectId.toString(), "checkout"),
        ].sort();
        const aggregateBy: AggregateBy<Metric> = buildEntityAggregate({
          attributes: { "resource.service.name": "checkout" },
        });
        setServiceKeysHint(aggregateBy, keys);

        const result: { statement: Statement; columns: Array<string> } =
          service.toAggregateStatement(aggregateBy);
        const query: string = result.statement.query;

        expect(query).toContain("MetricItemAggMV1mByService");
        expect(query).toMatch(
          / AND serviceEntityKey IN \{p\d+:Array\(String\)\}/,
        );
        expect(Object.values(result.statement.query_params)).toContainEqual(
          keys,
        );
      });

      it("routes a single-key registry hit as a plain equality", () => {
        const keys: Array<string> = [
          keyForService(projectId.toString(), "checkout"),
        ];
        const aggregateBy: AggregateBy<Metric> = buildEntityAggregate({
          attributes: { "resource.service.name": "checkout" },
        });
        setServiceKeysHint(aggregateBy, keys);

        const query: string = getQuery(aggregateBy);

        expect(query).toContain("MetricItemAggMV1mByService");
        expect(query).toMatch(/ AND serviceEntityKey = \{p\d+:String\}/);
      });

      it("never routes an empty hint (belt-and-braces for the raw fallback)", () => {
        const aggregateBy: AggregateBy<Metric> = buildEntityAggregate({
          attributes: { "resource.service.name": "checkout" },
        });
        setServiceKeysHint(aggregateBy, []);

        expect(getQuery(aggregateBy)).not.toContain(
          "MetricItemAggMV1mByService",
        );
      });
    });

    describe("entityScope routes", () => {
      it("routes a verified single-key host entityScope (Host Metrics tab shape)", () => {
        const hostKey: string = keyForHost(projectId.toString(), "web-01");
        const result: { statement: Statement; columns: Array<string> } =
          service.toAggregateStatement(
            buildEntityAggregate({
              entityScope: {
                entityKeys: [hostKey],
                attributeKey: "resource.host.name",
                attributeValue: "web-01",
              },
            }),
          );
        const query: string = result.statement.query;

        expect(query).toContain("MetricItemAggMV1mByHostV2");
        expect(query).toMatch(/ AND hostEntityKey = \{p\d+:String\}/);
        expect(Object.values(result.statement.query_params)).toContain(hostKey);
      });

      it("routes a verified single-key k8s cluster entityScope (Kubernetes Metrics tab shape)", () => {
        const clusterKey: string = keyForKubernetesCluster(
          projectId.toString(),
          "prod-eu-1",
        );
        const query: string = getQuery(
          buildEntityAggregate({
            entityScope: {
              entityKeys: [clusterKey],
              attributeKey: "resource.k8s.cluster.name",
              attributeValue: "prod-eu-1",
            },
          }),
        );

        expect(query).toContain("MetricItemAggMV1mByK8sCluster");
        expect(query).toMatch(/ AND k8sClusterEntityKey = \{p\d+:String\}/);
      });

      it("routes a verified single-key container entityScope", () => {
        const containerKey: string = keyForContainer(
          projectId.toString(),
          "abc123def456",
        );
        const query: string = getQuery(
          buildEntityAggregate({
            entityScope: {
              entityKeys: [containerKey],
              attributeKey: "resource.container.id",
              attributeValue: "abc123def456",
            },
          }),
        );

        expect(query).toContain("MetricItemAggMV1mByContainer");
        expect(query).toMatch(/ AND containerEntityKey = \{p\d+:String\}/);
      });

      it("bails when the scope key does not byte-match the derived key", () => {
        const query: string = getQuery(
          buildEntityAggregate({
            entityScope: {
              entityKeys: ["ffffffffffffffff"],
              attributeKey: "resource.host.name",
              attributeValue: "web-01",
            },
          }),
        );

        expect(query).not.toContain("MetricItemAggMV1mByHostV2");
      });

      it("bails on a multi-key scope (hasAny over foreign keys is not translatable)", () => {
        const hostKey: string = keyForHost(projectId.toString(), "web-01");
        const query: string = getQuery(
          buildEntityAggregate({
            entityScope: {
              entityKeys: [hostKey, "ffffffffffffffff"],
              attributeKey: "resource.host.name",
              attributeValue: "web-01",
            },
          }),
        );

        expect(query).not.toContain("MetricItemAggMV1mByHostV2");
      });

      it("bails on a service entityScope (namespace variants make the bare key lossy)", () => {
        const query: string = getQuery(
          buildEntityAggregate({
            entityScope: {
              entityKeys: [keyForService(projectId.toString(), "checkout")],
              attributeKey: "resource.service.name",
              attributeValue: "checkout",
            },
          }),
        );

        expect(query).not.toContain("MetricItemAggMV1mByService");
      });

      it("bails on an unknown scope attributeKey (e.g. k8s pod — composite identity)", () => {
        const query: string = getQuery(
          buildEntityAggregate({
            entityScope: {
              entityKeys: ["1234123412341234"],
              attributeKey: "resource.k8s.pod.name",
              attributeValue: "api-7f9c",
            },
          }),
        );

        expect(query).not.toMatch(/MetricItemAggMV1mBy/);
      });
    });

    describe("attribute + entityScope combined (sparkline shape)", () => {
      it("routes when the scope is redundant with the attribute filter", () => {
        const query: string = getQuery(
          buildEntityAggregate({
            attributes: { "resource.host.name": "web-01" },
            entityScope: {
              entityKeys: [keyForHost(projectId.toString(), "web-01")],
              attributeKey: "resource.host.name",
              attributeValue: "web-01",
            },
          }),
        );

        expect(query).toContain("MetricItemAggMV1mByHostV2");
        expect(query).toMatch(/ AND hostEntityKey = \{p\d+:String\}/);
      });

      it("bails when the scope disagrees on the attribute value (two genuine filters)", () => {
        const query: string = getQuery(
          buildEntityAggregate({
            attributes: { "resource.host.name": "web-01" },
            entityScope: {
              entityKeys: [keyForHost(projectId.toString(), "web-02")],
              attributeKey: "resource.host.name",
              attributeValue: "web-02",
            },
          }),
        );

        expect(query).not.toContain("MetricItemAggMV1mByHostV2");
      });

      it("bails when the scope filters a different entity type than the attribute", () => {
        const query: string = getQuery(
          buildEntityAggregate({
            attributes: { "resource.host.name": "web-01" },
            entityScope: {
              entityKeys: [
                keyForKubernetesCluster(projectId.toString(), "prod-eu-1"),
              ],
              attributeKey: "resource.k8s.cluster.name",
              attributeValue: "prod-eu-1",
            },
          }),
        );

        expect(query).not.toContain("MetricItemAggMV1mByHostV2");
        expect(query).not.toContain("MetricItemAggMV1mByK8sCluster");
      });

      it("bails on service + entityScope even when they agree", () => {
        const query: string = getQuery(
          buildEntityAggregate({
            attributes: { "resource.service.name": "checkout" },
            entityScope: {
              entityKeys: [keyForService(projectId.toString(), "checkout")],
              attributeKey: "resource.service.name",
              attributeValue: "checkout",
            },
          }),
        );

        expect(query).not.toContain("MetricItemAggMV1mByService");
      });
    });

    describe("bail conditions shared by every entity route", () => {
      const clusterFilter: Record<string, unknown> = {
        attributes: { "resource.k8s.cluster.name": "prod-eu-1" },
      };

      it("bails on group-by attribute keys (legend series need the raw table)", () => {
        const query: string = getQuery(
          buildEntityAggregate(clusterFilter, {
            groupByAttributeKeys: ["k8s.node.name"],
          }),
        );

        expect(query).not.toContain("MetricItemAggMV1mByK8sCluster");
        expect(query).toContain("__attr_grp_0");
      });

      it("bails on a model-column group-by", () => {
        const query: string = getQuery(
          buildEntityAggregate(clusterFilter, {
            groupBy: {
              metricPointType: true,
            } as AggregateBy<Metric>["groupBy"],
          }),
        );

        expect(query).not.toContain("MetricItemAggMV1mByK8sCluster");
      });

      it("bails on percentile aggregations", () => {
        const query: string = getQuery(
          buildEntityAggregate(clusterFilter, {
            aggregationType: AggregationType.P90,
          }),
        );

        expect(query).not.toContain("MetricItemAggMV1mByK8sCluster");
        expect(query).toContain("quantileExactWeighted(0.9)");
      });

      it("bails on distribution metrics (states collapse the histogram sum)", () => {
        const aggregateBy: AggregateBy<Metric> =
          buildEntityAggregate(clusterFilter);
        (
          service as unknown as {
            pointTypeHintByAggregate: WeakMap<
              AggregateBy<Metric>,
              string | null
            >;
          }
        ).pointTypeHintByAggregate.set(aggregateBy, "Histogram");

        const query: string = getQuery(aggregateBy);

        expect(query).not.toContain("MetricItemAggMV1mByK8sCluster");
        expect(query).toContain("sum(multiIf(isNotNull(count)");
      });

      it("bails when a second attribute filter is present", () => {
        const query: string = getQuery(
          buildEntityAggregate({
            attributes: {
              "resource.k8s.cluster.name": "prod-eu-1",
              "k8s.namespace.name": "default",
            },
          }),
        );

        expect(query).not.toContain("MetricItemAggMV1mByK8sCluster");
      });

      it("bails when the query carries a column the MV does not have", () => {
        const query: string = getQuery(
          buildEntityAggregate({
            attributes: { "resource.k8s.cluster.name": "prod-eu-1" },
            metricPointType: "Sum",
          }),
        );

        expect(query).not.toContain("MetricItemAggMV1mByK8sCluster");
      });

      it("bails on Total (whole-window) aggregations", () => {
        const query: string = getQuery(
          buildEntityAggregate(clusterFilter, {
            aggregationInterval: AggregationInterval.Total,
          }),
        );

        expect(query).not.toContain("MetricItemAggMV1mByK8sCluster");
        expect(query).toContain("min(time) as time");
      });

      it("bails without a projectId (entity keys are tenant-scoped)", () => {
        const query: string = getQuery(
          buildAggregateBy({
            query: {
              name: "http.client.request.duration",
              time: new InBetween(startDate, endDate),
              attributes: { "resource.k8s.cluster.name": "prod-eu-1" },
            } as unknown as AggregateBy<Metric>["query"],
          }),
        );

        expect(query).not.toContain("MetricItemAggMV1mByK8sCluster");
      });

      it("bails on a non-string attribute value", () => {
        const query: string = getQuery(
          buildEntityAggregate({
            attributes: { "resource.k8s.cluster.name": 42 },
          }),
        );

        expect(query).not.toContain("MetricItemAggMV1mByK8sCluster");
      });

      it("bails on a non-resource attribute spelling (datapoint attrs do not stamp entity keys)", () => {
        const query: string = getQuery(
          buildEntityAggregate({
            attributes: { "k8s.cluster.name": "prod-eu-1" },
          }),
        );

        expect(query).not.toContain("MetricItemAggMV1mByK8sCluster");
      });
    });

    /*
     * The async half of the service route: aggregateBy() resolves the
     * key set from the TelemetryEntity registry (short-TTL cached) and
     * hands it to the synchronous builder via the WeakMap hint.
     */
    describe("service registry lookup plumbing (aggregateBy)", () => {
      type CapturedStatements = Array<{
        query: string;
        params: Record<string, unknown>;
      }>;

      const captureExecuteQuery: () => CapturedStatements = () => {
        const captured: CapturedStatements = [];
        (
          service as unknown as {
            executeQuery: (statement: Statement) => Promise<unknown>;
          }
        ).executeQuery = async (statement: Statement): Promise<unknown> => {
          captured.push({
            query: statement.query,
            params: statement.query_params,
          });
          return {
            json: async (): Promise<{
              data: Array<Record<string, unknown>>;
            }> => {
              return { data: [] };
            },
          };
        };
        return captured;
      };

      const buildServiceAggregate: () => AggregateBy<Metric> =
        (): AggregateBy<Metric> => {
          return buildAggregateBy({
            query: {
              projectId: projectId,
              name: "http.client.request.duration",
              time: new InBetween(startDate, endDate),
              attributes: { "resource.service.name": "Checkout" },
            } as unknown as AggregateBy<Metric>["query"],
          });
        };

      const originalFindBy: typeof TelemetryEntityService.findBy =
        TelemetryEntityService.findBy;

      afterEach(() => {
        TelemetryEntityService.findBy = originalFindBy;
      });

      it("routes with the registry keys unioned with the bare-name key", async () => {
        const namespacedKey: string = keyForService(
          projectId.toString(),
          "checkout",
          "prod",
        );
        TelemetryEntityService.findBy = jest.fn(
          async (): Promise<Array<TelemetryEntity>> => {
            return [
              {
                entityKey: namespacedKey,
                identifyingAttributes: {
                  "service.name": "checkout",
                  "service.namespace": "prod",
                },
              } as unknown as TelemetryEntity,
            ];
          },
        ) as typeof TelemetryEntityService.findBy;

        const captured: CapturedStatements = captureExecuteQuery();
        await service.aggregateBy(buildServiceAggregate());

        // Statement 1 is the point-type lookup; statement 2 the aggregate.
        const aggregateStatement: { query: string } | undefined =
          captured[captured.length - 1];
        expect(aggregateStatement!.query).toContain(
          "MetricItemAggMV1mByService",
        );
        const expectedKeys: Array<string> = [
          namespacedKey,
          keyForService(projectId.toString(), "Checkout"),
        ].sort();
        expect(
          Object.values(captured[captured.length - 1]!.params),
        ).toContainEqual(expectedKeys);
      });

      it("falls back to raw on a registry miss", async () => {
        TelemetryEntityService.findBy = jest.fn(
          async (): Promise<Array<TelemetryEntity>> => {
            return [];
          },
        ) as typeof TelemetryEntityService.findBy;

        const captured: CapturedStatements = captureExecuteQuery();
        await service.aggregateBy(buildServiceAggregate());

        const aggregateStatement: { query: string } | undefined =
          captured[captured.length - 1];
        expect(aggregateStatement!.query).not.toContain(
          "MetricItemAggMV1mByService",
        );
      });

      it("ignores registry rows whose identity is not this service.name (displayName collision guard)", async () => {
        TelemetryEntityService.findBy = jest.fn(
          async (): Promise<Array<TelemetryEntity>> => {
            return [
              {
                entityKey: "1234123412341234",
                identifyingAttributes: { "foo.name": "checkout" },
              } as unknown as TelemetryEntity,
            ];
          },
        ) as typeof TelemetryEntityService.findBy;

        const captured: CapturedStatements = captureExecuteQuery();
        await service.aggregateBy(buildServiceAggregate());

        const aggregateStatement: { query: string } | undefined =
          captured[captured.length - 1];
        expect(aggregateStatement!.query).not.toContain(
          "MetricItemAggMV1mByService",
        );
      });

      it("caches the key set per (project, canonical name)", async () => {
        const findBySpy: jest.Mock = jest.fn(
          async (): Promise<Array<TelemetryEntity>> => {
            return [
              {
                entityKey: keyForService(projectId.toString(), "checkout"),
                identifyingAttributes: { "service.name": "checkout" },
              } as unknown as TelemetryEntity,
            ];
          },
        );
        TelemetryEntityService.findBy =
          findBySpy as unknown as typeof TelemetryEntityService.findBy;

        captureExecuteQuery();
        await service.aggregateBy(buildServiceAggregate());
        await service.aggregateBy(buildServiceAggregate());

        expect(findBySpy).toHaveBeenCalledTimes(1);
      });
    });
  });
});
