import "../TestingUtils/Init";
import { MetricService } from "../../../Server/Services/MetricService";
import Metric from "../../../Models/AnalyticsModels/Metric";
import AggregateBy, {
  INVALID_TIMEZONE_MESSAGE,
} from "../../../Server/Types/AnalyticsDatabase/AggregateBy";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import { escapeRegExp } from "../../../Utils/RegExpEscape";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/*
 * EVERY METRIC READ STARTS ITS DAYS AT THE READER'S MIDNIGHT (issue #7277).
 *
 * MetricService has five ways to read an aggregate - the minute rollup, the
 * per-entity rollups, the raw table for a sum or an average, the raw table
 * for a percentile, and the deduplicated read of a metric OneUptime rewrites
 * - and each compiles its own SELECT. Each one's time bucket must come from
 * the one shared AggregateUtil statement, so a day, week, month or year in
 * the reader's zone is the same expression on every path, with the zone as
 * a bound String parameter. An hour and shorter, and a request with no zone,
 * compile exactly as before.
 */

type Compiled = { statement: Statement; columns: Array<string> };

const PROJECT_ID: ObjectID = ObjectID.generate();
const START: Date = new Date("2026-02-20T05:00:00.000Z");
const END: Date = new Date("2026-03-20T04:00:00.000Z");

// The bucket of `column` in a zone, its two parameters numbered from any.
function zoneBucket(unit: string, column: string): RegExp {
  return new RegExp(
    `toTimeZone\\(toDateTime\\(toStartOfInterval\\(${escapeRegExp(
      column,
    )}, INTERVAL 1 ${unit}, \\{p(\\d+):String\\}\\), \\{p(\\d+):String\\}\\), 'UTC'\\) as time`,
  );
}

// The two parameters a zone bucket binds, read from the statement.
function zoneParameters(compiled: Compiled, pattern: RegExp): Array<unknown> {
  const match: RegExpMatchArray | null =
    compiled.statement.query.match(pattern);

  expect(match).not.toBeNull();

  return [
    compiled.statement.query_params[`p${match![1]}`],
    compiled.statement.query_params[`p${match![2]}`],
  ];
}

describe("MetricService: day, week, month and year buckets in the reader's zone", () => {
  let service: MetricService;

  beforeEach(() => {
    service = new MetricService();
  });

  function aggregateBy(
    overrides: Partial<AggregateBy<Metric>> = {},
    query: Record<string, unknown> = {},
  ): AggregateBy<Metric> {
    return {
      query: {
        projectId: PROJECT_ID,
        name: "http.server.request.count",
        time: new InBetween(START, END),
        ...query,
      } as unknown as AggregateBy<Metric>["query"],
      aggregationType: AggregationType.Sum,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      startTimestamp: START,
      endTimestamp: END,
      limit: 10000,
      skip: 0,
      sort: { time: SortOrder.Ascending } as AggregateBy<Metric>["sort"],
      props: { isRoot: true },
      ...overrides,
    };
  }

  function compile(request: AggregateBy<Metric>): Compiled {
    return service.toAggregateStatement(request);
  }

  // Marks a request as one over a histogram, which skips the rollups.
  function asDistribution(request: AggregateBy<Metric>): AggregateBy<Metric> {
    (
      service as unknown as {
        pointTypeHintByAggregate: WeakMap<AggregateBy<Metric>, string | null>;
      }
    ).pointTypeHintByAggregate.set(request, "Histogram");

    return request;
  }

  const PATHS: Array<{
    name: string;
    table: string;
    column: string;
    build: (overrides: Partial<AggregateBy<Metric>>) => AggregateBy<Metric>;
  }> = [
    {
      name: "the minute rollup",
      table: "MetricItemAggMV1m",
      column: "bucketTime",
      build: (overrides: Partial<AggregateBy<Metric>>) => {
        return aggregateBy(overrides);
      },
    },
    {
      name: "the per-host rollup",
      table: "MetricItemAggMV1mByHostV2",
      column: "bucketTime",
      build: (overrides: Partial<AggregateBy<Metric>>) => {
        return aggregateBy(overrides, {
          attributes: { "resource.host.name": "web-01" },
        });
      },
    },
    {
      name: "the raw table, for a sum over a histogram",
      table: "MetricItemV3",
      column: "time",
      build: (overrides: Partial<AggregateBy<Metric>>) => {
        return asDistribution(aggregateBy(overrides));
      },
    },
    {
      name: "the raw table, grouped by an attribute",
      table: "MetricItemV3",
      column: "time",
      build: (overrides: Partial<AggregateBy<Metric>>) => {
        return aggregateBy({
          groupByAttributeKeys: ["resource.host.name"],
          ...overrides,
        });
      },
    },
    {
      name: "the raw table, for a percentile",
      table: "MetricItemV3",
      column: "time",
      build: (overrides: Partial<AggregateBy<Metric>>) => {
        return aggregateBy({
          aggregationType: AggregationType.P90,
          ...overrides,
        });
      },
    },
    {
      name: "the deduplicated read of a metric OneUptime rewrites",
      table: "mutable_metric_latest",
      column: "time",
      build: (overrides: Partial<AggregateBy<Metric>>) => {
        return aggregateBy(overrides, { name: "oneuptime.incident.count" });
      },
    },
  ];

  for (const path of PATHS) {
    describe(path.name, () => {
      it("reads where it always did", () => {
        expect(compile(path.build({})).statement.query).toContain(path.table);
      });

      for (const [interval, unit] of [
        [AggregationInterval.Day, "DAY"],
        [AggregationInterval.Week, "WEEK"],
        [AggregationInterval.Month, "MONTH"],
        [AggregationInterval.Year, "YEAR"],
      ] as Array<[AggregationInterval, string]>) {
        it(`starts each ${unit.toLowerCase()} in the reader's zone, bound as a parameter`, () => {
          const compiled: Compiled = compile(
            path.build({
              aggregationInterval: interval,
              timezone: Timezone.AmericaNew_York,
            }),
          );

          expect(
            zoneParameters(compiled, zoneBucket(unit, path.column)),
          ).toEqual([Timezone.AmericaNew_York, Timezone.AmericaNew_York]);
          expect(compiled.statement.query).not.toContain("America/New_York");
          expect(compiled.statement.query).not.toContain("date_trunc('day'");
        });
      }

      it("with no zone, compiles its day exactly as before", () => {
        const before: string = compile(
          path.build({ aggregationInterval: AggregationInterval.Day }),
        ).statement.query;

        expect(before).toContain(
          `date_trunc('day', toStartOfInterval(${path.column}, INTERVAL 1 day))`,
        );
        expect(before).not.toContain("toTimeZone");
      });

      it("ignores the zone for an hour: the same statement, word for word", () => {
        const withZone: Compiled = compile(
          path.build({
            aggregationInterval: AggregationInterval.Hour,
            timezone: Timezone.AsiaKolkata,
          }),
        );
        const withoutZone: Compiled = compile(
          path.build({ aggregationInterval: AggregationInterval.Hour }),
        );

        expect(withZone.statement.query).toBe(withoutZone.statement.query);
        expect(Object.values(withZone.statement.query_params)).not.toContain(
          Timezone.AsiaKolkata,
        );
      });

      it("reads the legacy name of a zone by its current one", () => {
        const compiled: Compiled = compile(
          path.build({
            aggregationInterval: AggregationInterval.Day,
            timezone: Timezone.AsiaCalcutta,
          }),
        );

        expect(
          zoneParameters(compiled, zoneBucket("DAY", path.column)),
        ).toEqual([Timezone.AsiaKolkata, Timezone.AsiaKolkata]);
      });

      it("refuses a zone the Timezone list does not name with a 400", () => {
        expect(() => {
          compile(
            path.build({
              aggregationInterval: AggregationInterval.Day,
              timezone: "America/New_York'), 'UTC') --" as Timezone,
            }),
          );
        }).toThrow(new BadDataException(INVALID_TIMEZONE_MESSAGE));
      });
    });
  }

  it("a window of a month, with no interval pinned, is days in the zone", () => {
    const compiled: Compiled = compile(
      aggregateBy({ timezone: Timezone.AsiaTokyo }),
    );

    expect(zoneParameters(compiled, zoneBucket("DAY", "bucketTime"))).toEqual([
      Timezone.AsiaTokyo,
      Timezone.AsiaTokyo,
    ]);
  });

  it("a whole window (Total) is no bucket: the zone changes nothing", () => {
    for (const path of PATHS) {
      const withZone: Compiled = compile(
        path.build({
          aggregationInterval: AggregationInterval.Total,
          timezone: Timezone.AmericaNew_York,
        }),
      );
      const withoutZone: Compiled = compile(
        path.build({ aggregationInterval: AggregationInterval.Total }),
      );

      expect(withZone.statement.query).toBe(withoutZone.statement.query);
      expect(withZone.statement.query).not.toContain("toTimeZone");
    }
  });
});

describe("MetricService.aggregateBy: a zone that is not one is refused before anything is read", () => {
  it("throws the 400 before the point-type lookup and before any statement runs", async () => {
    const service: MetricService = new MetricService();
    const executed: Array<string> = [];
    const pointTypeLookups: Array<unknown> = [];

    (
      service as unknown as {
        executeQuery: (statement: Statement) => Promise<unknown>;
      }
    ).executeQuery = async (statement: Statement): Promise<unknown> => {
      executed.push(statement.query);
      return {
        json: async () => {
          return { data: [] };
        },
      };
    };
    jest
      .spyOn(
        service as unknown as {
          resolveMetricPointType: (request: unknown) => Promise<string | null>;
        },
        "resolveMetricPointType",
      )
      .mockImplementation(async (request: unknown) => {
        pointTypeLookups.push(request);
        return null;
      });

    for (const timezone of [
      "america/new_york",
      "Mars/Olympus_Mons",
      "UTC'); DROP TABLE MetricItemV3 --",
      42,
    ]) {
      await expect(
        service.aggregateBy({
          query: {
            projectId: PROJECT_ID,
            name: "http.server.request.count",
            time: new InBetween(START, END),
          } as unknown as AggregateBy<Metric>["query"],
          aggregationType: AggregationType.Sum,
          aggregateColumnName: "value",
          aggregationTimestampColumnName: "time",
          startTimestamp: START,
          endTimestamp: END,
          limit: 100,
          skip: 0,
          timezone: timezone as unknown as Timezone,
          props: { isRoot: true },
        }),
      ).rejects.toThrow(new BadDataException(INVALID_TIMEZONE_MESSAGE));
    }

    expect(pointTypeLookups).toHaveLength(0);
    expect(executed).toHaveLength(0);
  });

  it("a listed zone goes on to the read", async () => {
    const service: MetricService = new MetricService();
    const executed: Array<Statement> = [];

    (
      service as unknown as {
        executeQuery: (statement: Statement) => Promise<unknown>;
      }
    ).executeQuery = async (statement: Statement): Promise<unknown> => {
      executed.push(statement);
      return {
        json: async () => {
          return { data: [] };
        },
      };
    };
    jest
      .spyOn(
        service as unknown as {
          resolveMetricPointType: (request: unknown) => Promise<string | null>;
        },
        "resolveMetricPointType",
      )
      .mockResolvedValue(null);
    jest
      .spyOn(
        service as unknown as {
          resolveServiceEntityKeysHint: (
            request: unknown,
          ) => Promise<Array<string> | null>;
        },
        "resolveServiceEntityKeysHint",
      )
      .mockResolvedValue(null);

    await service.aggregateBy({
      query: {
        projectId: PROJECT_ID,
        name: "http.server.request.count",
        time: new InBetween(START, END),
      } as unknown as AggregateBy<Metric>["query"],
      aggregationType: AggregationType.Sum,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      startTimestamp: START,
      endTimestamp: END,
      limit: 100,
      skip: 0,
      timezone: Timezone.AsiaTokyo,
      props: { isRoot: true },
    });

    expect(executed.length).toBeGreaterThan(0);
    expect(
      executed.some((statement: Statement): boolean => {
        return Object.values(statement.query_params).includes(
          Timezone.AsiaTokyo,
        );
      }),
    ).toBe(true);
  });
});
