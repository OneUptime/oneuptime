import LogRecordingRuleQuery, {
  LOG_RECORDING_RULE_QUERY_MAX_EXECUTION_TIME_IN_SECONDS,
  LogRecordingRulePoints,
} from "../../../../Server/Utils/Telemetry/LogRecordingRuleQuery";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import AggregationType from "../../../../Types/BaseDatabase/AggregationType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import LogRecordingRuleDefinition, {
  LOG_RECORDING_RULE_MAX_SERIES_PER_MINUTE,
  LogRecordingRuleDefinitionUtil,
} from "../../../../Types/Log/LogRecordingRuleDefinition";
import LogSeverity from "../../../../Types/Log/LogSeverity";
import ObjectID from "../../../../Types/ObjectID";
import { LogRecordingRuleWindow } from "../../../../Utils/Telemetry/LogRecordingRuleWindow";
import { describe, expect, test } from "@jest/globals";

/*
 * The one ClickHouse statement a log recording rule runs per run, and how
 * its rows become points. What the statement must get right:
 *
 *   - the aggregation, over the numeric attribute read with
 *     toFloat64OrNull, and logs whose value is missing, not a number or not
 *     finite left out by the WHERE clause - never counted as 0;
 *   - one row per minute per group-by series, the busiest series first and
 *     at most LOG_RECORDING_RULE_MAX_SERIES_PER_MINUTE of them a minute;
 *   - the window exactly: [start, end), so consecutive runs never overlap;
 *   - every value a person typed - attribute keys, filter values, the body,
 *     service ids, severities - bound as a query parameter, never spliced
 *     into the SQL, filtered the way the log explorer's own aggregations
 *     filter (LogAggregationService).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SERVICE_ID: string = "44444444-4444-4444-8444-444444444444";

const WINDOW: LogRecordingRuleWindow = {
  startTime: new Date("2026-10-07T10:00:00.000Z"),
  endTime: new Date("2026-10-07T10:03:00.000Z"),
  minutes: 3,
  skippedMinutes: 0,
};

const KEY_MATCH: string = "arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(";

const sdwanLatency: () => LogRecordingRuleDefinition =
  (): LogRecordingRuleDefinition => {
    return LogRecordingRuleDefinitionUtil.normalize({
      filter: {
        telemetryServiceIds: [SERVICE_ID],
        severityTexts: [LogSeverity.Information, LogSeverity.Warning],
        body: 'log_type="SD-WAN"',
        attributeFilters: [{ key: "log_component", value: "SLA" }],
      },
      aggregationType: AggregationType.Avg,
      valueAttribute: "latency",
      groupByAttributes: ["gw_name", "profile_name"],
      unit: "ms",
    });
  };

const count: (
  partial?: Partial<LogRecordingRuleDefinition>,
) => LogRecordingRuleDefinition = (
  partial: Partial<LogRecordingRuleDefinition> = {},
): LogRecordingRuleDefinition => {
  return LogRecordingRuleDefinitionUtil.normalize({
    filter: {},
    aggregationType: AggregationType.Count,
    ...partial,
  });
};

const build: (
  definition: LogRecordingRuleDefinition,
  window?: LogRecordingRuleWindow,
) => Statement = (
  definition: LogRecordingRuleDefinition,
  window: LogRecordingRuleWindow = WINDOW,
): Statement => {
  return LogRecordingRuleQuery.buildStatement({
    projectId: PROJECT_ID,
    definition,
    window,
  });
};

// The parameter names that hold `value`, so assertions do not depend on order.
const paramsHolding: (statement: Statement, value: unknown) => Array<string> = (
  statement: Statement,
  value: unknown,
): Array<string> => {
  return Object.entries(statement.query_params)
    .filter((entry: [string, unknown]): boolean => {
      return JSON.stringify(entry[1]) === JSON.stringify(value);
    })
    .map((entry: [string, unknown]): string => {
      return entry[0];
    });
};

const onlyParamHolding: (statement: Statement, value: unknown) => string = (
  statement: Statement,
  value: unknown,
): string => {
  const names: Array<string> = paramsHolding(statement, value);

  expect(names.length).toBeGreaterThan(0);

  return names[0]!;
};

// The SQL with every whitespace run folded, so assertions read as one line.
const sqlOf: (statement: Statement) => string = (
  statement: Statement,
): string => {
  return statement.query.replace(/\s+/g, " ");
};

describe("LogRecordingRuleQuery.buildStatement", () => {
  describe("shape", () => {
    test("reads the Log table of the project over [start, end), bucketed by minute", () => {
      const statement: Statement = build(count());
      const sql: string = sqlOf(statement);

      expect(sql).toMatch(
        /^SELECT toUnixTimestamp\(toStartOfInterval\(time, INTERVAL 1 MINUTE\)\) AS bucket, count\(\) AS matchedLogs, count\(\) AS value FROM \{p\d+:Identifier\} WHERE projectId = \{p\d+:String\} AND time >= \{p\d+:DateTime64\(9\)\} AND time < \{p\d+:DateTime64\(9\)\}/,
      );

      expect(paramsHolding(statement, "LogItemV3")).toHaveLength(1);
      expect(paramsHolding(statement, PROJECT_ID.toString())).toHaveLength(1);
      expect(statement.query_params).toEqual(
        expect.objectContaining({
          [onlyParamHolding(statement, "2026-10-07 10:00:00.000000000")]:
            "2026-10-07 10:00:00.000000000",
          [onlyParamHolding(statement, "2026-10-07 10:03:00.000000000")]:
            "2026-10-07 10:03:00.000000000",
        }),
      );

      // The end is exclusive: the next run starts where this one ends.
      expect(sql).not.toContain("time <=");
    });

    test("one row per minute, the busiest series first, capped per minute and per run", () => {
      const sql: string = sqlOf(build(count()));

      expect(sql).toContain(
        `GROUP BY bucket ORDER BY bucket ASC, matchedLogs DESC LIMIT ${LOG_RECORDING_RULE_MAX_SERIES_PER_MINUTE} BY bucket LIMIT ${LOG_RECORDING_RULE_MAX_SERIES_PER_MINUTE * WINDOW.minutes}`,
      );
    });

    test("fails a slow query instead of writing a partial aggregate", () => {
      const sql: string = sqlOf(build(count()));

      expect(sql).toContain(
        `SETTINGS max_execution_time = ${LOG_RECORDING_RULE_QUERY_MAX_EXECUTION_TIME_IN_SECONDS}`,
      );
      expect(sql).toContain("timeout_overflow_mode = 'throw'");
      expect(sql).not.toContain("timeout_overflow_mode = 'break'");
      expect(sql).toContain("max_threads = 4");
    });

    test("a count with no filter adds no predicates beyond the project and the window", () => {
      const sql: string = sqlOf(build(count()));

      for (const absent of [
        "primaryEntityId",
        "severityText",
        "ILIKE",
        "arrayExists",
        "toFloat64OrNull",
        "attributes[",
      ]) {
        expect(sql).not.toContain(absent);
      }
    });
  });

  describe("aggregations", () => {
    test.each([
      [AggregationType.Sum, "sum("],
      [AggregationType.Avg, "avg("],
      [AggregationType.Min, "min("],
      [AggregationType.Max, "max("],
      [AggregationType.P50, "quantile(0.5)("],
      [AggregationType.P75, "quantile(0.75)("],
      [AggregationType.P90, "quantile(0.9)("],
      [AggregationType.P95, "quantile(0.95)("],
      [AggregationType.P99, "quantile(0.99)("],
    ])(
      "%s aggregates the numeric attribute as a Float64 with %s",
      (aggregationType: AggregationType, functionCall: string) => {
        const statement: Statement = build(
          count({ aggregationType, valueAttribute: "latency" }),
        );
        const sql: string = sqlOf(statement);
        const keyParams: Array<string> = paramsHolding(statement, "latency");

        // In the aggregate and in the WHERE clause, bound both times.
        expect(keyParams).toHaveLength(2);
        expect(sql).toContain(
          `, count() AS matchedLogs, ${functionCall}toFloat64OrNull(attributes[{${keyParams[0]}:String}])) AS value`,
        );
      },
    );

    test("a value aggregation reads only logs whose attribute is a finite number", () => {
      const statement: Statement = build(
        count({
          aggregationType: AggregationType.Avg,
          valueAttribute: "latency",
        }),
      );
      const sql: string = sqlOf(statement);
      const [, whereKey] = paramsHolding(statement, "latency");
      const keysParam: string = onlyParamHolding(statement, ["latency"]);

      /*
       * toFloat64OrNull is NULL for a missing key ('' from the map) and for
       * text, and isFinite of NULL is not true: those logs are left out
       * rather than read as 0. nan and inf parse but are not finite.
       */
      expect(sql).toContain(
        `AND (empty(attributeKeys) OR hasAny(attributeKeys, {${keysParam}:Array(String)})) AND isFinite(toFloat64OrNull(attributes[{${whereKey}:String}]))`,
      );
      expect(sql).not.toContain("toFloat64OrZero");
      expect(sql).not.toContain("ifNull(");
    });

    test("Count reads no attribute value, even when one is set", () => {
      const statement: Statement = build(
        LogRecordingRuleDefinitionUtil.normalize({
          filter: {},
          aggregationType: AggregationType.Count,
          valueAttribute: "latency",
        }),
      );

      expect(sqlOf(statement)).not.toContain("toFloat64OrNull");
      expect(paramsHolding(statement, "latency")).toEqual([]);
    });

    test("refuses an aggregation it cannot compute rather than guessing", () => {
      expect(() => {
        build({
          filter: {},
          aggregationType: "Rate" as AggregationType,
        });
      }).toThrow(BadDataException);
    });

    test("refuses a value aggregation with no attribute to read", () => {
      expect(() => {
        build({ filter: {}, aggregationType: AggregationType.P95 });
      }).toThrow(
        "A log recording rule that aggregates a value needs its numeric attribute.",
      );
    });
  });

  describe("group by", () => {
    test("selects and groups each key by a code-owned alias, the key itself bound", () => {
      const statement: Statement = build(sdwanLatency());
      const sql: string = sqlOf(statement);
      const gateway: string = onlyParamHolding(statement, "gw_name");
      const profile: string = onlyParamHolding(statement, "profile_name");

      expect(sql).toContain(
        `AS bucket, attributes[{${gateway}:String}] AS g0, attributes[{${profile}:String}] AS g1, count() AS matchedLogs`,
      );
      expect(sql).toContain("GROUP BY bucket, g0, g1 ORDER BY");
    });

    test("the cap on series is per minute whatever the group by", () => {
      expect(sqlOf(build(sdwanLatency()))).toContain(
        `LIMIT ${LOG_RECORDING_RULE_MAX_SERIES_PER_MINUTE} BY bucket`,
      );
    });

    test("a longer window raises the run's row limit with it", () => {
      expect(
        sqlOf(
          build(count(), {
            ...WINDOW,
            endTime: new Date("2026-10-07T10:10:00.000Z"),
            minutes: 10,
          }),
        ),
      ).toContain(`LIMIT ${LOG_RECORDING_RULE_MAX_SERIES_PER_MINUTE * 10}`);
    });

    test("GroupByAlias names the result columns", () => {
      expect(LogRecordingRuleQuery.getGroupByAlias(0)).toBe("g0");
      expect(LogRecordingRuleQuery.getGroupByAlias(4)).toBe("g4");
    });
  });

  describe("filters", () => {
    test("telemetry services, the way the log explorer scopes services", () => {
      const statement: Statement = build(
        count({ filter: { telemetryServiceIds: [SERVICE_ID.toUpperCase()] } }),
      );

      const servicesParam: string = onlyParamHolding(statement, [SERVICE_ID]);

      expect(sqlOf(statement)).toContain(
        `AND primaryEntityId IN ({${servicesParam}:Array(String)})`,
      );
    });

    test("severities, as an IN over the stored severity text", () => {
      const statement: Statement = build(
        count({
          filter: {
            severityTexts: [LogSeverity.Error, LogSeverity.Fatal],
          },
        }),
      );

      const severities: string = onlyParamHolding(statement, [
        "Error",
        "Fatal",
      ]);

      expect(sqlOf(statement)).toContain(
        `AND severityText IN ({${severities}:Array(String)})`,
      );
    });

    test("the body, as a case-insensitive contains with its wildcards escaped", () => {
      const statement: Statement = build(
        count({ filter: { body: "100% of req_id \\ path" } }),
      );

      const body: string = onlyParamHolding(
        statement,
        "%100\\% of req\\_id \\\\ path%",
      );

      expect(sqlOf(statement)).toContain(`AND body ILIKE {${body}:String}`);
    });

    test("each attribute filter matches its key case-insensitively and its value exactly", () => {
      const statement: Statement = build(sdwanLatency());
      const key: string = onlyParamHolding(statement, "log_component");
      const value: string = onlyParamHolding(statement, "SLA");

      expect(sqlOf(statement)).toContain(
        `AND ${KEY_MATCH}{${key}:String}) AND v = {${value}:String}, mapKeys(attributes), mapValues(attributes))`,
      );
    });

    test("several attribute filters AND together", () => {
      const statement: Statement = build(
        count({
          filter: {
            attributeFilters: [
              { key: "log_type", value: "SD-WAN" },
              { key: "log_component", value: "SLA" },
              { key: "gw_status", value: "up" },
            ],
          },
        }),
      );

      expect(sqlOf(statement).split(`AND ${KEY_MATCH}`)).toHaveLength(4);
    });

    test("the filters of the SD-WAN rule all apply at once", () => {
      const sql: string = sqlOf(build(sdwanLatency()));

      for (const predicate of [
        "AND primaryEntityId IN (",
        "AND severityText IN (",
        "AND body ILIKE ",
        `AND ${KEY_MATCH}`,
        "AND isFinite(toFloat64OrNull(",
      ]) {
        expect(sql).toContain(predicate);
      }
    });
  });

  describe("what a person typed never reaches the SQL text", () => {
    const hostile: Array<string> = [
      "x'); DROP TABLE LogItemV3; --",
      "a' OR '1'='1",
      "back\\slash",
      "{p999:String}",
      "multi\nline",
      "`backtick`",
    ];

    test.each(hostile)(
      "an attribute filter value of %p is bound",
      (text: string) => {
        const statement: Statement = build(
          count({
            filter: { attributeFilters: [{ key: "msg", value: text }] },
          }),
        );

        expect(statement.query).not.toContain(text.trim());
        expect(paramsHolding(statement, text.trim())).toHaveLength(1);
      },
    );

    test.each(hostile)("a body filter of %p is bound", (text: string) => {
      const statement: Statement = build(count({ filter: { body: text } }));

      expect(statement.query).not.toContain(text.trim());
      expect(
        Object.values(statement.query_params).some((value: unknown) => {
          return typeof value === "string" && value.startsWith("%");
        }),
      ).toBe(true);
    });

    test("attribute keys - filter, value and group by - are bound too", () => {
      /*
       * Validation refuses these keys before a rule is saved; the builder
       * still binds whatever it is handed, so a key never becomes SQL even
       * from a row written around the service.
       */
      const evil: string = "k'] , 1) --";
      const statement: Statement = build({
        filter: { attributeFilters: [{ key: evil, value: "v" }] },
        aggregationType: AggregationType.Max,
        valueAttribute: evil,
        groupByAttributes: [evil],
      });

      expect(statement.query).not.toContain(evil);
      // Group by, aggregate, the key-presence check, WHERE value, filter key.
      expect(paramsHolding(statement, evil)).toHaveLength(4);
      expect(paramsHolding(statement, [evil])).toHaveLength(1);
    });

    test("service ids and severities are bound as lists", () => {
      const statement: Statement = build(
        count({
          filter: {
            telemetryServiceIds: [SERVICE_ID],
            severityTexts: [LogSeverity.Error],
          },
        }),
      );

      expect(statement.query).not.toContain(SERVICE_ID);
      expect(statement.query).not.toContain("'Error'");
    });
  });
});

describe("LogRecordingRuleQuery.readPoints", () => {
  const minute: (offset: number) => number = (offset: number): number => {
    return WINDOW.startTime.getTime() / 1000 + offset * 60;
  };

  const read: (
    rows: Array<JSONObject>,
    definition: LogRecordingRuleDefinition,
  ) => LogRecordingRulePoints = (
    rows: Array<JSONObject>,
    definition: LogRecordingRuleDefinition,
  ): LogRecordingRulePoints => {
    return LogRecordingRuleQuery.readPoints({
      rows,
      definition,
      window: WINDOW,
    });
  };

  test("turns each row into a point at its minute, with its series' group-by values", () => {
    const result: LogRecordingRulePoints = read(
      [
        {
          bucket: minute(0),
          g0: "WAN1",
          g1: "Branch-Internet",
          matchedLogs: "2",
          value: 11.5,
        },
        {
          bucket: minute(1),
          g0: "WAN2",
          g1: "Branch-Internet",
          matchedLogs: "1",
          value: 40,
        },
      ],
      sdwanLatency(),
    );

    expect(result.truncatedMinutes).toEqual([]);
    expect(result.points).toEqual([
      {
        bucketStart: new Date("2026-10-07T10:00:00.000Z"),
        groupValues: { gw_name: "WAN1", profile_name: "Branch-Internet" },
        value: 11.5,
        matchedLogs: 2,
      },
      {
        bucketStart: new Date("2026-10-07T10:01:00.000Z"),
        groupValues: { gw_name: "WAN2", profile_name: "Branch-Internet" },
        value: 40,
        matchedLogs: 1,
      },
    ]);
  });

  test("reads ClickHouse's quoted 64-bit numbers and a group value the logs lacked", () => {
    const result: LogRecordingRulePoints = read(
      [
        {
          bucket: String(minute(2)),
          g0: "",
          g1: null,
          matchedLogs: "7",
          value: "3",
        },
      ],
      sdwanLatency(),
    );

    expect(result.points).toEqual([
      {
        bucketStart: new Date("2026-10-07T10:02:00.000Z"),
        groupValues: { gw_name: "", profile_name: "" },
        value: 3,
        matchedLogs: 7,
      },
    ]);
  });

  test("drops a row whose value is not a finite number, never writing it as 0", () => {
    const result: LogRecordingRulePoints = read(
      [
        {
          bucket: minute(0),
          g0: "WAN1",
          g1: "p",
          matchedLogs: "1",
          value: null,
        },
        {
          bucket: minute(0),
          g0: "WAN2",
          g1: "p",
          matchedLogs: "1",
          value: "nan",
        },
        {
          bucket: minute(0),
          g0: "WAN3",
          g1: "p",
          matchedLogs: "1",
          value: "inf",
        },
        { bucket: minute(0), g0: "WAN4", g1: "p", matchedLogs: "1", value: "" },
        { bucket: minute(0), g0: "WAN5", g1: "p", matchedLogs: "1", value: 12 },
      ],
      sdwanLatency(),
    );

    expect(
      result.points.map((point: { value: number }) => {
        return point.value;
      }),
    ).toEqual([12]);
  });

  test("drops a row outside the window: that minute belongs to another run", () => {
    const result: LogRecordingRulePoints = read(
      [
        { bucket: minute(-1), matchedLogs: "4", value: 4 },
        { bucket: minute(3), matchedLogs: "4", value: 4 },
        { bucket: minute(1), matchedLogs: "4", value: 4 },
        { bucket: "not a time", matchedLogs: "4", value: 4 },
      ],
      count({
        groupByAttributes: [],
        aggregationType: AggregationType.Avg,
        valueAttribute: "latency",
      }),
    );

    expect(result.points).toHaveLength(1);
    expect(result.points[0]!.bucketStart).toEqual(
      new Date("2026-10-07T10:01:00.000Z"),
    );
  });

  test("a count with no group by writes 0 for a minute with no matching logs", () => {
    const result: LogRecordingRulePoints = read(
      [{ bucket: minute(1), matchedLogs: "5", value: "5" }],
      count(),
    );

    expect(
      result.points.map((point: { bucketStart: Date; value: number }) => {
        return [point.bucketStart.toISOString(), point.value];
      }),
    ).toEqual([
      ["2026-10-07T10:00:00.000Z", 0],
      ["2026-10-07T10:01:00.000Z", 5],
      ["2026-10-07T10:02:00.000Z", 0],
    ]);
  });

  test("an aggregation of values, or a grouped count, writes only what it saw", () => {
    expect(
      read(
        [],
        count({
          aggregationType: AggregationType.Avg,
          valueAttribute: "latency",
        }),
      ).points,
    ).toEqual([]);
    expect(read([], count({ groupByAttributes: ["gw_name"] })).points).toEqual(
      [],
    );
  });

  test("says which minutes reached the series cap", () => {
    const rows: Array<JSONObject> = Array.from(
      { length: LOG_RECORDING_RULE_MAX_SERIES_PER_MINUTE },
      (_value: unknown, index: number): JSONObject => {
        return {
          bucket: minute(2),
          g0: `client-${index}`,
          matchedLogs: "1",
          value: 1,
        };
      },
    );

    rows.push({
      bucket: minute(0),
      g0: "client-a",
      matchedLogs: "1",
      value: 1,
    });

    const result: LogRecordingRulePoints = read(
      rows,
      count({ groupByAttributes: ["client_ip"] }),
    );

    expect(result.points).toHaveLength(
      LOG_RECORDING_RULE_MAX_SERIES_PER_MINUTE + 1,
    );
    expect(result.truncatedMinutes).toEqual([
      new Date("2026-10-07T10:02:00.000Z"),
    ]);
  });
});
