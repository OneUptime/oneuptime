import "../TestingUtils/Init";
import { findAliasShadows } from "../../Helpers/ClickhouseAliasScan";
import CloudCost from "../../../Models/AnalyticsModels/CloudCost";
import SloHistory from "../../../Models/AnalyticsModels/SloHistory";
import Span from "../../../Models/AnalyticsModels/Span";
import ClickhouseDatabase from "../../../Server/Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import { CloudCostService } from "../../../Server/Services/CloudCostService";
import { SloHistoryService } from "../../../Server/Services/SloHistoryService";
import { SpanService } from "../../../Server/Services/SpanService";
import AggregateBy, {
  INVALID_TIMEZONE_MESSAGE,
} from "../../../Server/Types/AnalyticsDatabase/AggregateBy";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import logger from "../../../Server/Utils/Logger";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import { escapeRegExp } from "../../../Utils/RegExpEscape";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * EVERY ANALYTICS AGGREGATE STARTS ITS DAYS AT THE READER'S MIDNIGHT
 * (issue #7277), whichever service compiles it: the generic statement every
 * model without its own builder uses (SLO history, logs, audit logs, ...),
 * the span projection that serves the trace overview's duration and count
 * charts, and the cloud costs' breakdown by tag. Each takes its time bucket
 * from the one AggregateUtil statement, with the zone bound as a String
 * parameter. AnalyticsDatabaseService.aggregateBy refuses a zone the
 * Timezone list does not name with a 400 before anything is read.
 * (MetricService's five builders are pinned in MetricServiceReaderTimezone.)
 */

type Compiled = { statement: Statement; columns: Array<string> };

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000077a7",
);
const START: Date = new Date("2026-02-20T05:00:00.000Z");
const END: Date = new Date("2026-03-20T04:00:00.000Z");

const CALENDAR_UNITS: Array<[AggregationInterval, string]> = [
  [AggregationInterval.Day, "DAY"],
  [AggregationInterval.Week, "WEEK"],
  [AggregationInterval.Month, "MONTH"],
  [AggregationInterval.Year, "YEAR"],
];

function withDatabase<TService extends AnalyticsDatabaseService<any>>(
  service: TService,
): TService {
  service.database = {
    getDatasourceOptions: (): { database: string } => {
      return { database: "oneuptime" };
    },
  } as unknown as ClickhouseDatabase;

  return service;
}

/*
 * The zone bucket of `expression`, aliased to `alias`: its two parameters'
 * values, or null when the statement holds no such bucket.
 */
function zoneOf(
  compiled: Compiled,
  unit: string,
  expression: string,
  alias: string,
): [unknown, unknown] | null {
  const text: string = compiled.statement.query;
  const opening: string = `toTimeZone(toDateTime(toStartOfInterval(${expression}, INTERVAL 1 ${unit}, {`;
  const start: number = text.indexOf(opening);

  if (start < 0) {
    return null;
  }

  const rest: string = text.slice(start + opening.length);
  const match: RegExpMatchArray | null = rest.match(
    /^(p\d+):String\}\), \{(p\d+):String\}\), 'UTC'\) as (\w+)/,
  );

  if (!match || match[3] !== alias) {
    return null;
  }

  return [
    compiled.statement.query_params[match[1]!],
    compiled.statement.query_params[match[2]!],
  ];
}

beforeEach(() => {
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined!;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the generic aggregate statement (SLO history)", () => {
  function sloHistory(
    overrides: Partial<AggregateBy<SloHistory>> = {},
  ): AggregateBy<SloHistory> {
    return {
      query: {
        projectId: PROJECT_ID,
        metricName: "slo.attainment",
        bucketStart: new InBetween<Date>(START, END),
      } as unknown as AggregateBy<SloHistory>["query"],
      aggregationType: AggregationType.Avg,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "bucketStart",
      startTimestamp: START,
      endTimestamp: END,
      limit: 1000,
      skip: 0,
      sort: {
        bucketStart: SortOrder.Ascending,
      } as AggregateBy<SloHistory>["sort"],
      props: { isRoot: true },
      ...overrides,
    };
  }

  const compile: (request: AggregateBy<SloHistory>) => Compiled = (
    request: AggregateBy<SloHistory>,
  ): Compiled => {
    return withDatabase(new SloHistoryService()).toAggregateStatement(request);
  };

  for (const [interval, unit] of CALENDAR_UNITS) {
    test(`a ${unit.toLowerCase()} starts in the reader's zone, and the rows group by it`, () => {
      const compiled: Compiled = compile(
        sloHistory({
          aggregationInterval: interval,
          timezone: Timezone.AmericaNew_York,
        }),
      );

      expect(zoneOf(compiled, unit, "bucketStart", "bucketStart")).toEqual([
        Timezone.AmericaNew_York,
        Timezone.AmericaNew_York,
      ]);
      expect(compiled.statement.query).toContain("GROUP BY bucketStart");
      expect(compiled.statement.query).not.toContain("America/New_York");
    });
  }

  test("a window of a month, with no interval pinned, is days in the zone", () => {
    expect(
      zoneOf(
        compile(sloHistory({ timezone: Timezone.AsiaKolkata })),
        "DAY",
        "bucketStart",
        "bucketStart",
      ),
    ).toEqual([Timezone.AsiaKolkata, Timezone.AsiaKolkata]);
  });

  test("with no zone, its day is what it always was", () => {
    const query: string = compile(
      sloHistory({ aggregationInterval: AggregationInterval.Day }),
    ).statement.query;

    expect(query).toContain(
      "date_trunc('day', toStartOfInterval(bucketStart, INTERVAL 1 day)) as bucketStart",
    );
    expect(query).not.toContain("toTimeZone");
  });

  test("an hour and a whole window ignore the zone, word for word", () => {
    for (const interval of [
      AggregationInterval.Hour,
      AggregationInterval.ThirtyMinutes,
      AggregationInterval.Total,
    ]) {
      expect(
        compile(
          sloHistory({
            aggregationInterval: interval,
            timezone: Timezone.AsiaTokyo,
          }),
        ).statement.query,
      ).toBe(
        compile(sloHistory({ aggregationInterval: interval })).statement.query,
      );
    }
  });

  test("a zone the Timezone list does not name is a 400, even for a whole window", () => {
    for (const interval of [
      AggregationInterval.Day,
      AggregationInterval.Hour,
      AggregationInterval.Total,
    ]) {
      expect(() => {
        compile(
          sloHistory({
            aggregationInterval: interval,
            timezone: "Europe/Kyiv' --" as Timezone,
          }),
        );
      }).toThrow(new BadDataException(INVALID_TIMEZONE_MESSAGE));
    }
  });
});

describe("AnalyticsDatabaseService.aggregateBy: the zone is checked before anything is read", () => {
  function readSloHistory(timezone: unknown): {
    service: SloHistoryService;
    executed: Array<string>;
    request: AggregateBy<SloHistory>;
  } {
    const service: SloHistoryService = withDatabase(new SloHistoryService());
    const executed: Array<string> = [];

    (
      service as unknown as {
        executeQuery: (statement: Statement) => Promise<unknown>;
      }
    ).executeQuery = async (statement: Statement): Promise<unknown> => {
      executed.push(statement.query);
      return {
        json: async (): Promise<{ data: Array<unknown> }> => {
          return { data: [] };
        },
      };
    };

    return {
      service: service,
      executed: executed,
      request: {
        query: {
          projectId: PROJECT_ID,
          metricName: "slo.attainment",
        } as unknown as AggregateBy<SloHistory>["query"],
        aggregationType: AggregationType.Avg,
        aggregateColumnName: "value",
        aggregationTimestampColumnName: "bucketStart",
        startTimestamp: START,
        endTimestamp: END,
        limit: 1000,
        skip: 0,
        timezone: timezone as Timezone,
        props: { isRoot: true },
      },
    };
  }

  for (const notAZone of [
    "",
    "america/new_york",
    "Mars/Olympus_Mons",
    "UTC'), 'UTC') AS bucketStart FROM system.one --",
    330,
    { name: "UTC" },
    ["UTC"],
  ]) {
    test(`refuses ${JSON.stringify(notAZone)} with a 400, and runs nothing`, async () => {
      const read: {
        service: SloHistoryService;
        executed: Array<string>;
        request: AggregateBy<SloHistory>;
      } = readSloHistory(notAZone);

      await expect(read.service.aggregateBy(read.request)).rejects.toThrow(
        new BadDataException(INVALID_TIMEZONE_MESSAGE),
      );
      expect(read.executed).toHaveLength(0);
    });
  }

  test("no zone, or null (what an API keeps of a missing one), reads UTC's days as before", async () => {
    for (const noZone of [undefined, null]) {
      const read: {
        service: SloHistoryService;
        executed: Array<string>;
        request: AggregateBy<SloHistory>;
      } = readSloHistory(noZone);

      await read.service.aggregateBy(read.request);

      expect(read.executed).toHaveLength(1);
      expect(read.executed[0]).toContain(
        "date_trunc('day', toStartOfInterval(bucketStart, INTERVAL 1 day))",
      );
    }
  });

  test("a listed zone is read with", async () => {
    const read: {
      service: SloHistoryService;
      executed: Array<string>;
      request: AggregateBy<SloHistory>;
    } = readSloHistory(Timezone.AsiaTokyo);

    await read.service.aggregateBy(read.request);

    expect(read.executed).toHaveLength(1);
    expect(read.executed[0]).toContain(
      "toTimeZone(toDateTime(toStartOfInterval(bucketStart, INTERVAL 1 DAY, {",
    );
  });
});

describe("the span projection the trace charts read", () => {
  function spans(
    overrides: Partial<AggregateBy<Span>> = {},
    end: Date = END,
  ): AggregateBy<Span> {
    return {
      query: {
        projectId: PROJECT_ID,
        startTime: new InBetween<Date>(START, end),
      } as unknown as AggregateBy<Span>["query"],
      aggregationType: AggregationType.Count,
      aggregateColumnName: "durationUnixNano",
      aggregationTimestampColumnName: "startTime",
      startTimestamp: START,
      endTimestamp: end,
      limit: 1000,
      skip: 0,
      props: { isRoot: true },
      ...overrides,
    };
  }

  const compile: (request: AggregateBy<Span>) => Compiled = (
    request: AggregateBy<Span>,
  ): Compiled => {
    return withDatabase(new SpanService()).toAggregateStatement(request);
  };

  for (const aggregationType of [
    AggregationType.Count,
    AggregationType.Avg,
    AggregationType.P99,
  ]) {
    test(`a month of ${aggregationType} reads days that start at the reader's midnight`, () => {
      const compiled: Compiled = compile(
        spans({
          aggregationType: aggregationType,
          timezone: Timezone.AmericaNew_York,
        }),
      );

      expect(
        zoneOf(compiled, "DAY", "toStartOfMinute(startTime)", "startTime"),
      ).toEqual([Timezone.AmericaNew_York, Timezone.AmericaNew_York]);
    });
  }

  test("six months is weeks in the zone", () => {
    const end: Date = new Date(START.getTime() + 120 * 24 * 60 * 60 * 1000);

    expect(
      zoneOf(
        compile(spans({ timezone: Timezone.AsiaTokyo }, end)),
        "WEEK",
        "toStartOfMinute(startTime)",
        "startTime",
      ),
    ).toEqual([Timezone.AsiaTokyo, Timezone.AsiaTokyo]);
  });

  test("five days, read by the hour, ignore the zone, word for word", () => {
    const end: Date = new Date(START.getTime() + 5 * 24 * 60 * 60 * 1000);

    expect(
      compile(spans({ timezone: Timezone.AsiaTokyo }, end)).statement.query,
    ).toBe(compile(spans({}, end)).statement.query);
  });

  test("with no zone, its days are what they always were", () => {
    const query: string = compile(spans()).statement.query;

    expect(query).toContain(
      "date_trunc('day', toStartOfInterval(toStartOfMinute(startTime), INTERVAL 1 day)) as startTime",
    );
  });

  /*
   * The bucket is aliased startTime, and ClickHouse reads a bare name as the
   * SELECT's alias before the column: a bare startTime in the WHERE was the
   * bucket, so the window's first bucket, which starts before the window,
   * was filtered out whole. The window and every filter name the span's own
   * columns through the table's alias; GROUP BY and ORDER BY read the bucket.
   */
  describe("the window and the filters read the span's columns, not the bucket", () => {
    const SERVICE: ObjectID = new ObjectID(
      "10000000-0000-4000-8000-0000000077b1",
    );

    // Count, Avg and P99, with each filter the projections can serve.
    const REQUESTS: Array<[string, AggregateBy<Span>]> = [
      [
        "a count, with a day in New York",
        spans({ timezone: Timezone.AmericaNew_York }),
      ],
      ["a count, with UTC's days", spans()],
      [
        "a count of one service's failed root spans",
        spans({
          query: {
            projectId: PROJECT_ID,
            startTime: new InBetween<Date>(START, END),
            primaryEntityId: SERVICE,
            isRootSpan: true,
            statusCode: 2,
          } as unknown as AggregateBy<Span>["query"],
          timezone: Timezone.AsiaKolkata,
        }),
      ],
      [
        "a count of some services and statuses",
        spans({
          query: {
            projectId: PROJECT_ID,
            startTime: new InBetween<Date>(START, END),
            primaryEntityId: new Includes([SERVICE, PROJECT_ID]),
            statusCode: new Includes([0, 2]),
          } as unknown as AggregateBy<Span>["query"],
          timezone: Timezone.AsiaTokyo,
        }),
      ],
      [
        "an average of one service",
        spans({
          aggregationType: AggregationType.Avg,
          query: {
            projectId: PROJECT_ID,
            startTime: new InBetween<Date>(START, END),
            primaryEntityId: SERVICE,
          } as unknown as AggregateBy<Span>["query"],
          timezone: Timezone.AmericaNew_York,
        }),
      ],
      [
        "a P99 by the hour",
        spans(
          {
            aggregationType: AggregationType.P99,
            timezone: Timezone.AmericaNew_York,
          },
          new Date(START.getTime() + 5 * 24 * 60 * 60 * 1000),
        ),
      ],
    ];

    const COLUMNS: Array<string> = [
      "projectId",
      "startTime",
      "primaryEntityId",
      "isRootSpan",
      "statusCode",
    ];

    function whereOf(query: string): string {
      const where: number = query.indexOf(" WHERE ");
      const groupBy: number = query.indexOf(" GROUP BY ");

      expect(where).toBeGreaterThan(0);
      expect(groupBy).toBeGreaterThan(where);

      return query.slice(where, groupBy);
    }

    test.each(REQUESTS)(
      "%s: the projection compiles it, from the table under the alias s",
      (_name: string, request: AggregateBy<Span>) => {
        const query: string = compile(request).statement.query;

        expect(query).toMatch(
          /^SELECT (count\(\)|avg\(durationUnixNano\)|quantile\(0\.99\)\(durationUnixNano\)) as durationUnixNano, /,
        );
        expect(query).toContain(" AS s WHERE s.projectId = {");
        expect(query).toContain(
          " AND toStartOfMinute(s.startTime) >= toStartOfMinute({",
        );
        expect(query).toContain(
          " AND toStartOfMinute(s.startTime) <= toStartOfMinute({",
        );
      },
    );

    test.each(REQUESTS)(
      "%s: no column the WHERE reads is a bare name",
      (_name: string, request: AggregateBy<Span>) => {
        const where: string = whereOf(compile(request).statement.query);

        for (const column of COLUMNS) {
          const bare: RegExp = new RegExp(
            `(^|[^.\\w])${escapeRegExp(column)}\\b`,
          );

          expect({ column: column, bare: bare.test(where) }).toEqual({
            column: column,
            bare: false,
          });
        }
      },
    );

    test.each(REQUESTS)(
      "%s: the rows group and sort by the bucket",
      (_name: string, request: AggregateBy<Span>) => {
        const query: string = compile(request).statement.query;

        expect(query).toContain(" GROUP BY startTime ORDER BY startTime DESC");
      },
    );

    test.each(REQUESTS)(
      "%s: the alias guard's own reading finds no alias read in place of its column",
      (_name: string, request: AggregateBy<Span>) => {
        expect(findAliasShadows(compile(request).statement.query)).toEqual([]);
      },
    );

    test("each filter reads its column, with its value bound", () => {
      const one: Compiled = compile(REQUESTS[2]![1]);
      const where: string = whereOf(one.statement.query);

      expect(where).toMatch(/ AND s\.primaryEntityId = \{p\d+:\w+\}/);
      expect(where).toMatch(/ AND s\.isRootSpan = \{p\d+:\w+\}/);
      expect(where).toMatch(/ AND s\.statusCode = \{p\d+:\w+\}/);
      expect(Object.values(one.statement.query_params)).toEqual(
        expect.arrayContaining([SERVICE.toString(), true, 2]),
      );

      const some: string = whereOf(compile(REQUESTS[3]![1]).statement.query);

      expect(some).toMatch(/ AND s\.primaryEntityId IN \(\{p\d+:[^}]+\}\)/);
      expect(some).toMatch(/ AND s\.statusCode IN \(\{p\d+:[^}]+\}\)/);
    });
  });
});

describe("cloud costs, by tag and by column", () => {
  const COST_START: Date = new Date("2026-11-01T00:00:00.000Z");
  const COST_END: Date = new Date("2026-11-20T12:00:00.000Z");

  function costs(
    overrides: Partial<AggregateBy<CloudCost>> = {},
  ): AggregateBy<CloudCost> {
    return {
      query: {
        projectId: PROJECT_ID,
        currency: "USD",
        day: new InBetween<Date>(COST_START, COST_END),
      } as AggregateBy<CloudCost>["query"],
      aggregationType: AggregationType.Sum,
      aggregateColumnName: "cost",
      aggregationTimestampColumnName: "day",
      aggregationInterval: AggregationInterval.Day,
      startTimestamp: COST_START,
      endTimestamp: COST_END,
      limit: 1000,
      skip: 0,
      sort: { cost: SortOrder.Descending } as AggregateBy<CloudCost>["sort"],
      props: { isRoot: true },
      ...overrides,
    };
  }

  const compile: (request: AggregateBy<CloudCost>) => Compiled = (
    request: AggregateBy<CloudCost>,
  ): Compiled => {
    return withDatabase(new CloudCostService()).toAggregateStatement(request);
  };

  for (const timezone of [Timezone.UTC, Timezone.AmericaNew_York]) {
    test(`by tag, a day in ${timezone} is the shared bucket, the zone bound`, () => {
      expect(
        zoneOf(
          compile(
            costs({
              groupByAttributeKeys: ["team"],
              timezone: timezone,
            }),
          ),
          "DAY",
          "day",
          "day",
        ),
      ).toEqual([timezone, timezone]);
    });

    test(`by column, a day in ${timezone} is the shared bucket, the zone bound`, () => {
      expect(
        zoneOf(
          compile(
            costs({
              groupBy: { service: true } as AggregateBy<CloudCost>["groupBy"],
              timezone: timezone,
            }),
          ),
          "DAY",
          "day",
          "day",
        ),
      ).toEqual([timezone, timezone]);
    });
  }

  test("by tag with no zone, its day is what it always was", () => {
    const query: string = compile(costs({ groupByAttributeKeys: ["team"] }))
      .statement.query;

    expect(query).toContain(
      "date_trunc('day', toStartOfInterval(day, INTERVAL 1 day)) as day",
    );
  });

  test("by tag, a zone the Timezone list does not name is a 400", () => {
    expect(() => {
      compile(
        costs({
          groupByAttributeKeys: ["team"],
          timezone: "Etc/GMT+25" as Timezone,
        }),
      );
    }).toThrow(new BadDataException(INVALID_TIMEZONE_MESSAGE));
  });
});
