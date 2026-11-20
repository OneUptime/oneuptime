import LogQLClickhouseSource, {
  DETECTED_LEVEL_SQL,
  LOGQL_MAX_RESULT_BYTES,
  buildLogQLBucketsStatement,
  buildLogQLRowsStatement,
  countedLabelsOf,
  isResultLimitError,
  pushedDownMatchers,
  toLogQLLogRow,
} from "../../../../Server/Utils/LogQL/LogQLClickhouseSource";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { LogQLLogSelector, LogQLQuery } from "../../../../Utils/LogQL/LogQLAst";
import {
  LogQLBucketCount,
  LogQLDirection,
} from "../../../../Utils/LogQL/LogQLEngine";
import { parseLogQL } from "../../../../Utils/LogQL/LogQLParser";
import {
  PromQLLabelMatcher,
  PromQLMatchType,
} from "../../../../Utils/PromQL/PromQLAst";
import PromQLError, {
  PromQLErrorType,
} from "../../../../Utils/PromQL/PromQLError";
import { describe, expect, test } from "@jest/globals";

/*
 * How the LogQL engine's reads are written for ClickHouse (issue #7700):
 * always the caller's project, services, range and retention first; the
 * matchers that name a value, and the line filters before any stage that
 * rewrites the line, checked there; every value bound, never written into
 * the SQL. A real ClickHouse runs them in LogQLClickhouseIntegration.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5a6d3b1c-7f8e-4a2b-9c0d-1e2f3a4b5c6d",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "0f1e2d3c-4b5a-4968-8776-655443322110",
);
const NS: bigint = BigInt(1000000000);
const START_NS: bigint = BigInt(1763632800) * NS;
const END_NS: bigint = START_NS + BigInt(3600) * NS;

const selectorOf: (query: string) => LogQLLogSelector = (
  query: string,
): LogQLLogSelector => {
  const parsed: LogQLQuery = parseLogQL(query);

  if (parsed.kind !== "LogQuery") {
    throw new Error("not a log query");
  }

  return parsed.selector;
};

const rowsStatement: (
  query: string,
  direction?: LogQLDirection,
) => Statement = (query: string, direction?: LogQLDirection): Statement => {
  return buildLogQLRowsStatement({
    projectId: PROJECT_ID,
    serviceFilter: { serviceIds: [SERVICE_ID] },
    selector: selectorOf(query),
    startNs: START_NS,
    endNs: END_NS,
    startInclusive: true,
    direction,
    limit: 101,
  });
};

const valuesOf: (statement: Statement) => Array<unknown> = (
  statement: Statement,
): Array<unknown> => {
  return Object.values(statement.query_params);
};

describe("a read of lines", () => {
  test("is the caller's project, services, range and retention, newest first", () => {
    const statement: Statement = rowsStatement(
      '{service_name="checkout"}',
      LogQLDirection.Backward,
    );

    expect(valuesOf(statement)).toContain(PROJECT_ID.toString());
    expect(valuesOf(statement)).toContainEqual([SERVICE_ID.toString()]);
    expect(valuesOf(statement)).toContain(START_NS.toString());
    expect(valuesOf(statement)).toContain(END_NS.toString());
    expect(valuesOf(statement)).toContain(101);
    expect(statement.query).toContain("FROM LogItemV3 WHERE projectId = ");
    expect(statement.query).toContain("AND timeUnixNano >= ");
    expect(statement.query).toContain("AND timeUnixNano < ");
    expect(statement.query).toContain("retentionDate >= now()");
    expect(statement.query).toContain("primaryEntityId IN (");
    expect(statement.query).toContain("ORDER BY time DESC, timeUnixNano DESC");
    expect(statement.query).toContain("max_execution_time = 30");
    expect(statement.query).toContain(
      `max_result_bytes = ${LOGQL_MAX_RESULT_BYTES}`,
    );
    expect(statement.query).toContain("result_overflow_mode = 'throw'");
  });

  test("checks a matcher that names a value on the label it reads as, every value bound", () => {
    const statement: Statement = rowsStatement(
      '{service_name="checkout", http_method=~"GET|POST", team!="ops"}',
    );

    expect(valuesOf(statement)).toEqual(
      expect.arrayContaining([
        "checkout",
        "service_name",
        "^(?s:GET|POST)$",
        "http_method",
      ]),
    );
    // != keeps logs without the label: the engine checks it.
    expect(valuesOf(statement)).not.toContain("ops");
    expect(statement.query).not.toContain("checkout");
    expect(statement.query).toMatch(
      /arrayExists\(\(k, v\) -> v = \{p\d+:String\} AND /,
    );
    expect(statement.query).toMatch(
      /arrayExists\(\(k, v\) -> match\(v, \{p\d+:String\}\) AND /,
    );
  });

  test("checks detected_level on the level the log reads as", () => {
    const statement: Statement = rowsStatement(
      '{service_name="checkout", detected_level="error"}',
    );

    expect(statement.query).toContain(`AND ${DETECTED_LEVEL_SQL} = `);
    expect(valuesOf(statement)).toContain("error");
  });

  test("checks the line filters before any stage that rewrites the line, as text or RE2", () => {
    const statement: Statement = rowsStatement(
      '{service_name="checkout"} |= "pay" != "health" |~ "5[0-9]{2}" | json | line_format "{{.path}}" |= "late"',
    );

    expect(valuesOf(statement)).toEqual(
      expect.arrayContaining(["pay", "health", "5[0-9]{2}"]),
    );
    // After line_format, the line is another: the engine checks it.
    expect(valuesOf(statement)).not.toContain("late");
    expect(statement.query).toContain("AND (position(body, ");
    expect(statement.query).toContain("AND NOT (position(body, ");
    expect(statement.query).toContain("AND (match(body, ");
  });

  test("a filter of several values is one OR", () => {
    const statement: Statement = rowsStatement(
      '{service_name="checkout"} |= "pay" or "cart"',
    );

    expect(statement.query).toMatch(
      /AND \(position\(body, \{p\d+:String\}\) > 0 OR position\(body, \{p\d+:String\}\) > 0\)/,
    );
  });

  test("the matchers that name a value are the ones pushed down", () => {
    const matchers: Array<PromQLLabelMatcher> = [
      { name: "a", type: PromQLMatchType.Equal, value: "x" },
      { name: "b", type: PromQLMatchType.Equal, value: "" },
      { name: "c", type: PromQLMatchType.RegexMatch, value: "x.*" },
      { name: "d", type: PromQLMatchType.RegexMatch, value: ".*" },
      { name: "e", type: PromQLMatchType.NotEqual, value: "x" },
      { name: "f", type: PromQLMatchType.RegexNoMatch, value: "x" },
    ];

    expect(
      pushedDownMatchers(matchers).map((matcher: PromQLLabelMatcher) => {
        return matcher.name;
      }),
    ).toEqual(["a", "c"]);
  });

  test("a row is read as the engine reads a log: its labels, nanoseconds and line", () => {
    expect(
      toLogQLLogRow({
        timeNs: "1763632800000000123",
        body: "GET /cart 200",
        severityText: "Information",
        severityNumber: "0",
        attributes: {
          "resource.service.name": "checkout",
          "http.method": "GET",
        },
      }),
    ).toEqual({
      timeNs: "1763632800000000123",
      line: "GET /cart 200",
      labels: {
        service_name: "checkout",
        http_method: "GET",
        detected_level: "info",
      },
    });
    expect(
      toLogQLLogRow({ timeNs: "1", body: null, attributes: {} }).line,
    ).toBe("");
  });
});

describe("a count where the logs are", () => {
  test("counts by bucket and by the labels read and matched, after the origin", () => {
    const selector: LogQLLogSelector = selectorOf('{service_name="checkout"}');
    const request: {
      selector: LogQLLogSelector;
      originNs: bigint;
      bucketNs: bigint;
      endNs: bigint;
      labels: Array<string>;
      limit: number;
    } = {
      selector,
      originNs: START_NS,
      bucketNs: BigInt(60) * NS,
      endNs: END_NS,
      labels: ["detected_level"],
      limit: 1000,
    };

    expect(countedLabelsOf(request)).toEqual([
      "detected_level",
      "service_name",
    ]);

    const statement: Statement = buildLogQLBucketsStatement({
      projectId: PROJECT_ID,
      serviceFilter: {},
      request,
    });

    expect(statement.query).toContain(
      "AS bucket, count() AS lines, sum(length(body)) AS bytes",
    );
    expect(statement.query).toContain(`${DETECTED_LEVEL_SQL} AS label_0`);
    expect(statement.query).toContain("AS label_1");
    expect(statement.query).toContain("GROUP BY bucket, label_0, label_1");
    // A window is open at its start.
    expect(statement.query).toContain("AND timeUnixNano > ");
    expect(statement.query).toContain("AND timeUnixNano <= ");
  });

  test("checks every matcher again on the labels each count was made by", async () => {
    const statements: Array<Statement> = [];
    const source: LogQLClickhouseSource = new LogQLClickhouseSource({
      projectId: PROJECT_ID,
      serviceFilter: {},
      readRows: async (statement: Statement): Promise<Array<JSONObject>> => {
        statements.push(statement);
        return [
          {
            bucket: "1",
            lines: "3",
            bytes: "39",
            label_0: "info",
            label_1: "checkout",
          },
          // A resource's service name read before the log's own: not checkout.
          {
            bucket: "1",
            lines: "2",
            bytes: "20",
            label_0: "error",
            label_1: "billing",
          },
        ];
      },
    });

    const counted: { groups: Array<LogQLBucketCount>; reachedLimit: boolean } =
      await source.countBuckets({
        selector: selectorOf('{service_name="checkout"}'),
        originNs: START_NS,
        bucketNs: BigInt(60) * NS,
        endNs: END_NS,
        labels: ["detected_level"],
        limit: 1000,
      });

    expect(counted).toEqual({
      groups: [
        { labels: { detected_level: "info" }, bucket: 1, count: 3, bytes: 39 },
      ],
      reachedLimit: false,
    });
    expect(statements).toHaveLength(1);
  });
});

describe("what a read hands back is bounded", () => {
  test("a read over max_result_bytes is refused in words a reader can act on", async () => {
    const source: LogQLClickhouseSource = new LogQLClickhouseSource({
      projectId: PROJECT_ID,
      serviceFilter: {},
      readRows: async (): Promise<Array<JSONObject>> => {
        throw Object.assign(new Error("Limit for result exceeded"), {
          code: "396",
          type: "TOO_MANY_ROWS_OR_BYTES",
        });
      },
    });

    let thrown: unknown;

    try {
      await source.readLines({
        selector: selectorOf('{service_name="checkout"}'),
        startNs: START_NS,
        endNs: END_NS,
        direction: LogQLDirection.Backward,
        limit: 100,
      });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PromQLError);
    expect((thrown as PromQLError).errorType).toBe(PromQLErrorType.Execution);
    expect((thrown as PromQLError).message).toBe(
      "the logs this query reads are more than 64 MB. Ask for fewer lines (a lower limit), a shorter time range, or add label matchers or line filters.",
    );
  });

  test("only that error is told so; any other is the server's", () => {
    expect(isResultLimitError({ code: "396" })).toBe(true);
    expect(isResultLimitError({ type: "TOO_MANY_ROWS_OR_BYTES" })).toBe(true);
    expect(isResultLimitError({ code: "159" })).toBe(false);
    expect(isResultLimitError(new Error("down"))).toBe(false);
  });

  test("a lookup of the levels present reads a bounded number of rows", async () => {
    const statements: Array<Statement> = [];
    const source: LogQLClickhouseSource = new LogQLClickhouseSource({
      projectId: PROJECT_ID,
      serviceFilter: { serviceIds: [SERVICE_ID] },
      readRows: async (statement: Statement): Promise<Array<JSONObject>> => {
        statements.push(statement);
        return [{ level: "warn" }, { level: "" }];
      },
    });

    expect(
      await source.readDetectedLevels({ startNs: START_NS, endNs: END_NS }),
    ).toEqual(["warn"]);
    expect(statements[0]!.query).toContain(
      `SELECT DISTINCT ${DETECTED_LEVEL_SQL} AS level FROM LogItemV3`,
    );
    expect(statements[0]!.query).toContain("max_rows_to_read = 1000000");
    expect(statements[0]!.query).toContain("read_overflow_mode = 'break'");
    expect(valuesOf(statements[0]!)).toContainEqual([SERVICE_ID.toString()]);
  });
});
