import "../TestingUtils/Init";
import {
  MetricService,
  PER_SERIES_AGGREGATION_MAX_ROWS,
  PER_SERIES_ATTRIBUTE_ALIAS_PREFIX,
  PER_SERIES_BUCKET_TIME_ALIAS,
} from "../../../Server/Services/MetricService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import logger from "../../../Server/Utils/Logger";
import Query from "../../../Server/Types/AnalyticsDatabase/Query";
import Metric from "../../../Models/AnalyticsModels/Metric";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test, beforeAll, jest } from "@jest/globals";

/*
 * Unit tests for the server-side per-series aggregation path that
 * replaced the silently-truncating raw-row fetch in telemetry monitors
 * with group-by attribute keys (IoT / K8s / Docker / Host / Proxmox /
 * Ceph / Docker Swarm fleets).
 */
describe("MetricService per-series aggregation", () => {
  let service: MetricService;

  const projectId: ObjectID = ObjectID.generate();
  const windowStart: Date = new Date("2026-07-03T10:00:00.000Z");
  const windowEnd: Date = new Date("2026-07-03T10:05:00.000Z");

  const buildQuery: () => Query<Metric> = (): Query<Metric> => {
    const query: Record<string, unknown> = {
      projectId: projectId,
      time: new InBetween<Date>(windowStart, windowEnd),
      name: "system.cpu.utilization",
      attributes: {
        "resource.iot.fleet.name": "fleet-1",
      },
    };
    return query as unknown as Query<Metric>;
  };

  beforeAll(() => {
    jest.spyOn(logger, "debug").mockImplementation(() => {
      return undefined!;
    });
    service = new MetricService();
  });

  describe("toPerSeriesAggregateStatement", () => {
    test("extracts each group-by key as a scalar aliased column and groups by the aliases, never the Map column", () => {
      const { statement, columns } = service.toPerSeriesAggregateStatement({
        query: buildQuery(),
        aggregationType: AggregationType.Avg,
        groupByAttributeKeys: ["device.id", "iot.device.type"],
        limit: PER_SERIES_AGGREGATION_MAX_ROWS,
      });

      const query: string = statement.query;

      expect(query).toContain("avg(value) AS value");
      expect(query).toContain(
        `toStartOfMinute(time) AS ${PER_SERIES_BUCKET_TIME_ALIAS}`,
      );

      // Per-key scalar extraction with bound String parameters.
      expect(query).toMatch(
        new RegExp(
          `attributes\\[\\{p\\d+:String\\}\\] AS ${PER_SERIES_ATTRIBUTE_ALIAS_PREFIX}0`,
        ),
      );
      expect(query).toMatch(
        new RegExp(
          `attributes\\[\\{p\\d+:String\\}\\] AS ${PER_SERIES_ATTRIBUTE_ALIAS_PREFIX}1`,
        ),
      );

      // GROUP BY references the scalar aliases only.
      expect(query).toContain(
        `GROUP BY ${PER_SERIES_BUCKET_TIME_ALIAS}, ${PER_SERIES_ATTRIBUTE_ALIAS_PREFIX}0, ${PER_SERIES_ATTRIBUTE_ALIAS_PREFIX}1`,
      );

      /*
       * The whole point of this statement shape: the `attributes` Map
       * column must never be selected or grouped bare (the
       * @clickhouse/client Map-column GROUP BY quirk returns 0 rows).
       * Every occurrence of the column must be a subscript access.
       */
      const withoutSubscriptAccess: string = query.replace(/attributes\[/g, "");
      expect(withoutSubscriptAccess).not.toContain("attributes");

      // Both group-by keys are bound as parameters, not inlined.
      const parameterValues: Array<unknown> = Object.values(
        statement.query_params,
      );
      expect(parameterValues).toEqual(
        expect.arrayContaining(["device.id", "iot.device.type"]),
      );

      expect(columns).toEqual([
        "value",
        PER_SERIES_BUCKET_TIME_ALIAS,
        `${PER_SERIES_ATTRIBUTE_ALIAS_PREFIX}0`,
        `${PER_SERIES_ATTRIBUTE_ALIAS_PREFIX}1`,
      ]);
    });

    test("never aliases any SELECT expression as a real column name (ClickHouse substitutes aliases into WHERE)", () => {
      /*
       * Regression for the alias-shadowing defect: `toStartOfMinute(time)
       * AS time` makes ClickHouse rewrite the window predicate into
       * `toStartOfMinute(time) >= windowStart`, silently dropping every
       * raw row in the minute containing a non-minute-aligned window
       * start — i.e. the first partial minute of EVERY monitor
       * evaluation. The bucket alias must therefore never collide with
       * the `time` column (nor may any other alias shadow a queried
       * column).
       */
      expect(PER_SERIES_BUCKET_TIME_ALIAS).not.toBe("time");

      const { statement } = service.toPerSeriesAggregateStatement({
        query: buildQuery(),
        aggregationType: AggregationType.Avg,
        groupByAttributeKeys: ["device.id"],
        limit: PER_SERIES_AGGREGATION_MAX_ROWS,
      });

      expect(statement.query).not.toMatch(/AS time\b/);
    });

    test("caps execution at 45s in throw mode so a runaway scan trips the fallback instead of holding the worker", () => {
      const { statement } = service.toPerSeriesAggregateStatement({
        query: buildQuery(),
        aggregationType: AggregationType.Avg,
        groupByAttributeKeys: ["device.id"],
        limit: PER_SERIES_AGGREGATION_MAX_ROWS,
      });

      expect(statement.query).toContain("max_execution_time = 45");
      /*
       * No 'break' overflow mode: a partial GROUP BY result would
       * silently drop series from evaluation — the exact defect this
       * whole path exists to fix. Throwing (the ClickHouse default)
       * routes callers into the capped fallback, which reports its own
       * truncation loudly.
       */
      expect(statement.query).not.toContain("timeout_overflow_mode");
    });

    test("binds the time window and the row cap as parameters", () => {
      const { statement } = service.toPerSeriesAggregateStatement({
        query: buildQuery(),
        aggregationType: AggregationType.Avg,
        groupByAttributeKeys: ["device.id"],
        limit: 12345,
      });

      const query: string = statement.query;

      /*
       * The where generator binds the column name as an Identifier
       * parameter and both window bounds as DateTime64 parameters:
       *   {pN:Identifier} >= {pM:DateTime64(9)} AND {pN2:Identifier} <= ...
       */
      expect(query).toMatch(
        /\{p\d+:Identifier\} >= \{p\d+:DateTime64\(9\)\} AND \{p\d+:Identifier\} <= \{p\d+:DateTime64\(9\)\}/,
      );
      expect(query).toMatch(/LIMIT \{p\d+:Int32\}/);

      const parameterValues: Array<unknown> = Object.values(
        statement.query_params,
      );
      expect(parameterValues).toEqual(
        expect.arrayContaining([
          "time",
          OneUptimeDate.toClickhouseDateTime64(windowStart),
          OneUptimeDate.toClickhouseDateTime64(windowEnd),
          12345,
        ]),
      );
    });

    test("orders newest buckets first so the row cap keeps the data monitors evaluate", () => {
      const { statement } = service.toPerSeriesAggregateStatement({
        query: buildQuery(),
        aggregationType: AggregationType.Max,
        groupByAttributeKeys: ["device.id"],
        limit: PER_SERIES_AGGREGATION_MAX_ROWS,
      });

      expect(statement.query).toContain(
        `ORDER BY ${PER_SERIES_BUCKET_TIME_ALIAS} DESC`,
      );
    });

    test.each([
      [AggregationType.Sum, "sum(value) AS value"],
      [AggregationType.Count, "count(value) AS value"],
      [AggregationType.Min, "min(value) AS value"],
      [AggregationType.Max, "max(value) AS value"],
      [AggregationType.Avg, "avg(value) AS value"],
      [AggregationType.P50, "quantile(0.5)(value) AS value"],
      [AggregationType.P90, "quantile(0.9)(value) AS value"],
      [AggregationType.P95, "quantile(0.95)(value) AS value"],
      [AggregationType.P99, "quantile(0.99)(value) AS value"],
    ])(
      "maps aggregation type %s to the SQL expression %s",
      (aggregationType: AggregationType, expectedExpression: string) => {
        const { statement }: { statement: Statement } =
          service.toPerSeriesAggregateStatement({
            query: buildQuery(),
            aggregationType: aggregationType,
            groupByAttributeKeys: ["device.id"],
            limit: PER_SERIES_AGGREGATION_MAX_ROWS,
          });

        expect(statement.query).toContain(expectedExpression);
      },
    );

    test("unknown aggregation types fall back to Avg, mirroring the legacy JS switch", () => {
      expect(
        MetricService.getPerSeriesAggregationExpression(
          "SomethingNew" as AggregationType,
        ),
      ).toBe("avg(value)");
    });
  });

  describe("toPerSeriesAggregatedResult", () => {
    test("adapts ClickHouse rows into the AggregatedResult shape the legacy JS path produced", () => {
      const result: AggregatedResult =
        MetricService.toPerSeriesAggregatedResult({
          items: [
            {
              [PER_SERIES_BUCKET_TIME_ALIAS]: "2026-07-03 10:04:00",
              value: 91.5,
              [`${PER_SERIES_ATTRIBUTE_ALIAS_PREFIX}0`]: "device-a",
            },
            {
              [PER_SERIES_BUCKET_TIME_ALIAS]: "2026-07-03 10:04:00",
              // UInt64 aggregates (count) serialize as strings in JSON output.
              value: "17",
              [`${PER_SERIES_ATTRIBUTE_ALIAS_PREFIX}0`]: "device-b",
            },
          ],
          groupByAttributeKeys: ["device.id"],
        });

      expect(result.data).toHaveLength(2);

      const first: AggregatedModel = result.data[0]!;
      expect(first.timestamp).toBeInstanceOf(Date);
      expect(first.value).toBe(91.5);
      expect((first["attributes"] as JSONObject)["device.id"]).toBe("device-a");

      const second: AggregatedModel = result.data[1]!;
      expect(second.value).toBe(17);
      expect((second["attributes"] as JSONObject)["device.id"]).toBe(
        "device-b",
      );
    });

    test("canonicalizes missing attribute columns to empty string so series fingerprints stay stable", () => {
      const result: AggregatedResult =
        MetricService.toPerSeriesAggregatedResult({
          items: [
            {
              [PER_SERIES_BUCKET_TIME_ALIAS]: "2026-07-03 10:04:00",
              value: 3,
            },
          ],
          groupByAttributeKeys: ["device.id", "site"],
        });

      expect(result.data).toHaveLength(1);
      const attributes: JSONObject = result.data[0]![
        "attributes"
      ] as JSONObject;
      expect(attributes["device.id"]).toBe("");
      expect(attributes["site"]).toBe("");

      /*
       * Downstream, buildSeriesBreakdown fingerprints rows via
       * extractSeriesLabels — the labels a server-aggregated row yields
       * must hash identically to the labels the raw-sample JS path
       * produced for the same series (missing keys -> "").
       */
      const labels: JSONObject = MetricSeriesFingerprint.extractSeriesLabels({
        sample: result.data[0]!,
        attributeKeys: ["device.id", "site"],
      });
      expect(MetricSeriesFingerprint.computeFingerprint(labels)).toBe(
        MetricSeriesFingerprint.computeFingerprint({
          "device.id": "",
          site: "",
        }),
      );
    });

    test("skips rows without a usable time or finite numeric value", () => {
      const result: AggregatedResult =
        MetricService.toPerSeriesAggregatedResult({
          items: [
            {
              // no time bucket
              value: 5,
              [`${PER_SERIES_ATTRIBUTE_ALIAS_PREFIX}0`]: "device-a",
            },
            {
              [PER_SERIES_BUCKET_TIME_ALIAS]: "2026-07-03 10:00:00",
              // all-NULL bucket (e.g. histogram-only rows)
              value: null,
              [`${PER_SERIES_ATTRIBUTE_ALIAS_PREFIX}0`]: "device-a",
            },
            {
              [PER_SERIES_BUCKET_TIME_ALIAS]: "2026-07-03 10:00:00",
              value: "not-a-number",
              [`${PER_SERIES_ATTRIBUTE_ALIAS_PREFIX}0`]: "device-a",
            },
            {
              [PER_SERIES_BUCKET_TIME_ALIAS]: "2026-07-03 10:00:00",
              value: 2,
              [`${PER_SERIES_ATTRIBUTE_ALIAS_PREFIX}0`]: "device-a",
            },
          ],
          groupByAttributeKeys: ["device.id"],
        });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.value).toBe(2);
    });

    test("distinct attribute values fingerprint into distinct series (one incident per device, not per monitor)", () => {
      const result: AggregatedResult =
        MetricService.toPerSeriesAggregatedResult({
          items: [
            {
              [PER_SERIES_BUCKET_TIME_ALIAS]: "2026-07-03 10:04:00",
              value: 1,
              [`${PER_SERIES_ATTRIBUTE_ALIAS_PREFIX}0`]: "device-a",
            },
            {
              [PER_SERIES_BUCKET_TIME_ALIAS]: "2026-07-03 10:04:00",
              value: 2,
              [`${PER_SERIES_ATTRIBUTE_ALIAS_PREFIX}0`]: "device-b",
            },
          ],
          groupByAttributeKeys: ["device.id"],
        });

      const fingerprints: Array<string> = result.data.map(
        (row: AggregatedModel) => {
          return MetricSeriesFingerprint.computeFingerprint(
            MetricSeriesFingerprint.extractSeriesLabels({
              sample: row,
              attributeKeys: ["device.id"],
            }),
          );
        },
      );

      expect(new Set(fingerprints).size).toBe(2);
    });
  });

  describe("row cap sizing", () => {
    test("the aggregated-row cap comfortably exceeds the legacy raw-row cap that silently dropped series", () => {
      /*
       * The old path fetched at most LIMIT_PER_PROJECT (10,000) RAW
       * samples; the new path caps AGGREGATED rows (series × minutes),
       * so the effective per-evaluation capacity must be strictly
       * larger — that is the whole point of the change.
       */
      expect(PER_SERIES_AGGREGATION_MAX_ROWS).toBeGreaterThan(
        LIMIT_PER_PROJECT,
      );
    });
  });
});
