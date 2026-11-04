import "../TestingUtils/Init";
import {
  MetricSeriesArrivalRow,
  MetricService,
} from "../../../Server/Services/MetricService";
import Metric from "../../../Models/AnalyticsModels/Metric";
import Query from "../../../Server/Types/AnalyticsDatabase/Query";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, it, beforeEach } from "@jest/globals";

/*
 * WHEN A QUERY'S SERIES GOT THEIR DATA (#4912's follow-up).
 *
 * MetricService.readSeriesArrivals reads, per series of a monitor's query,
 * what its rows' createdAt (the second OneUptime wrote each one) and time
 * (the moment its source measured) say: the newest and oldest arrival, the
 * minutes something arrived in, and the newest data point's arrival and
 * time. These pin the statement - the raw table, never a rollup (they keep
 * no createdAt); the query's own filters and window; every value bound as a
 * parameter; one row a series, or one for an ungrouped query - and how its
 * rows are read.
 */

describe("MetricService.readSeriesArrivals", () => {
  const projectId: ObjectID = ObjectID.generate();
  const startDate: Date = new Date("2026-11-04T11:45:00.000Z");
  const endDate: Date = new Date("2026-11-04T12:00:00.000Z");

  let service: MetricService;

  beforeEach(() => {
    service = new MetricService();
  });

  function queryOf(attributes?: Record<string, string>): Query<Metric> {
    return {
      projectId: projectId,
      name: "k8s.pod.cpu.utilization",
      time: new InBetween(startDate, endDate),
      ...(attributes ? { attributes } : {}),
    } as Query<Metric>;
  }

  function statementOf(input: {
    attributeGroupKeys: Array<string>;
    attributes?: Record<string, string>;
    limit?: number;
  }): Statement {
    return service.toSeriesArrivalsStatement({
      query: queryOf(input.attributes),
      attributeGroupKeys: input.attributeGroupKeys,
      limit: input.limit ?? 50000,
    });
  }

  function paramValues(statement: Statement): Array<unknown> {
    return Object.values(statement.query_params);
  }

  describe("the statement", () => {
    it("folds each series' rows into its arrivals, one row a series of the grouped keys", () => {
      const statement: Statement = statementOf({
        attributeGroupKeys: ["resource.k8s.pod.name"],
      });
      const query: string = statement.query;

      expect(query).toContain(
        "SELECT toUnixTimestamp(max(createdAt)) AS __arrival_newest, toUnixTimestamp(min(createdAt)) AS __arrival_oldest, uniq(toStartOfMinute(createdAt)) AS __arrival_minutes, toUnixTimestamp(argMax(createdAt, time)) AS __arrival_newest_point, toUnixTimestamp64Milli(max(time)) AS __arrival_newest_point_time",
      );
      // The grouped keys come back as the map a grouped read's rows carry.
      expect(query).toContain(", map(");
      expect(query).toContain(") AS attributes");
      expect(query).toContain("SELECT createdAt, time, attributes[");
      expect(query).toContain("AS __attr_grp_0");
      expect(query).toContain("GROUP BY __attr_grp_0");
      expect(query).not.toContain("HAVING");
      expect(paramValues(statement)).toContain("resource.k8s.pod.name");
    });

    it("an ungrouped query reads one row, and none for an empty window", () => {
      const query: string = statementOf({ attributeGroupKeys: [] }).query;

      expect(query).not.toContain("GROUP BY");
      expect(query).not.toContain("map(");
      expect(query).not.toContain("__attr_grp_");
      expect(query).toContain("HAVING count() > 0");
    });

    it("groups by every key, in order", () => {
      const query: string = statementOf({
        attributeGroupKeys: [
          "resource.k8s.namespace.name",
          "resource.k8s.pod.name",
        ],
      }).query;

      expect(query).toContain("GROUP BY __attr_grp_0, __attr_grp_1");
    });

    it("reads the raw table with the query's own window and filters, and only rows still kept", () => {
      const statement: Statement = statementOf({
        attributeGroupKeys: ["resource.k8s.pod.name"],
        attributes: { "resource.k8s.cluster.name": "prod" },
      });
      const query: string = statement.query;

      expect(query).toContain(`.${new Metric().tableName} WHERE TRUE`);
      expect(query).not.toContain("MetricItemAggMV");
      expect(query).toContain("retentionDate >= now()");
      expect(paramValues(statement)).toEqual(
        expect.arrayContaining([
          projectId.toString(),
          "k8s.pod.cpu.utilization",
          "resource.k8s.cluster.name",
          "prod",
        ]),
      );
      // The window's two ends, inside the rows' read.
      const inner: string = query.slice(query.indexOf("FROM ("));
      expect(inner.split("DateTime64(9)}").length - 1).toBe(2);
      expect(inner).toContain(">= {");
      expect(inner).toContain("<= {");
    });

    it("binds every value: a key's text never reaches the query", () => {
      const key: string = "pod') OR 1=1 --";
      const statement: Statement = statementOf({ attributeGroupKeys: [key] });

      expect(statement.query).not.toContain(key);
      expect(paramValues(statement)).toContain(key);
    });

    it("is cut at the limit, bound too, and fails loud on a timeout", () => {
      const statement: Statement = statementOf({
        attributeGroupKeys: ["resource.k8s.pod.name"],
        limit: 1234,
      });

      expect(statement.query).toContain("LIMIT");
      expect(paramValues(statement)).toContain(1234);
      expect(statement.query).toContain("max_execution_time");
      expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
    });
  });

  describe("reading it", () => {
    function answer(rows: Array<Record<string, unknown>>): Array<string> {
      const statements: Array<string> = [];

      (
        service as unknown as {
          executeQuery: (statement: Statement) => Promise<unknown>;
        }
      ).executeQuery = async (statement: Statement): Promise<unknown> => {
        statements.push(statement.query);

        return {
          json: async (): Promise<{ data: Array<Record<string, unknown>> }> => {
            return { data: rows };
          },
        };
      };

      return statements;
    }

    it("hands back each series' grouped keys and its arrivals in milliseconds", async () => {
      const statements: Array<string> = answer([
        {
          attributes: { "resource.k8s.pod.name": "checkout-1" },
          __arrival_newest: 1762257590,
          __arrival_oldest: 1762256710,
          // 64-bit numbers come back as text.
          __arrival_minutes: "15",
          __arrival_newest_point: 1762257590,
          __arrival_newest_point_time: "1762257570123",
        },
      ]);

      const rows: Array<MetricSeriesArrivalRow> =
        await service.readSeriesArrivals({
          query: queryOf(),
          groupByAttributeKeys: ["resource.k8s.pod.name"],
          limit: 50000,
          props: { isRoot: true },
        });

      expect(statements).toHaveLength(1);
      expect(statements[0]).toContain("__arrival_newest");
      expect(rows).toEqual([
        {
          attributes: { "resource.k8s.pod.name": "checkout-1" },
          aggregates: {
            newestArrivalMs: 1762257590000,
            oldestArrivalMs: 1762256710000,
            arrivalMinuteCount: 15,
            newestPointArrivalMs: 1762257590000,
            newestPointTimeMs: 1762257570123,
          },
        },
      ]);
    });

    it("an ungrouped query's row has no keys", async () => {
      answer([
        {
          __arrival_newest: 1762257590,
          __arrival_oldest: 1762257590,
          __arrival_minutes: "1",
          __arrival_newest_point: 1762257590,
          __arrival_newest_point_time: "1762257589000",
        },
      ]);

      const rows: Array<MetricSeriesArrivalRow> =
        await service.readSeriesArrivals({
          query: queryOf(),
          limit: 50000,
          props: { isRoot: true },
        });

      expect(rows).toHaveLength(1);
      expect(rows[0]!.attributes).toEqual({});
    });

    it("nothing in the window: no rows", async () => {
      answer([]);

      expect(
        await service.readSeriesArrivals({
          query: queryOf(),
          limit: 50000,
          props: { isRoot: true },
        }),
      ).toEqual([]);
    });

    it("drops blank and repeated keys, and refuses more keys than a grouped read takes", async () => {
      const statements: Array<string> = answer([]);

      await service.readSeriesArrivals({
        query: queryOf(),
        groupByAttributeKeys: [
          " ",
          "resource.k8s.pod.name",
          "resource.k8s.pod.name",
        ],
        limit: 50000,
        props: { isRoot: true },
      });

      expect(statements[0]).toContain("GROUP BY __attr_grp_0");
      expect(statements[0]).not.toContain("__attr_grp_1");

      await expect(
        service.readSeriesArrivals({
          query: queryOf(),
          groupByAttributeKeys: Array.from(
            { length: 11 },
            (_: unknown, index: number) => {
              return `key.${index}`;
            },
          ),
          limit: 50000,
          props: { isRoot: true },
        }),
      ).rejects.toBeInstanceOf(BadDataException);
    });

    it("reads only for a caller who may read the rows: no one signed in is refused before anything runs", async () => {
      const statements: Array<string> = answer([]);

      await expect(
        service.readSeriesArrivals({
          query: queryOf(),
          limit: 50000,
          props: {},
        }),
      ).rejects.toThrow();
      expect(statements).toHaveLength(0);
    });
  });
});
