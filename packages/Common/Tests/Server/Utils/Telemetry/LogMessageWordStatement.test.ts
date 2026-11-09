import { ClickhouseAppInstance } from "../../../../Server/Infrastructure/ClickhouseDatabase";
import LogAggregationService, {
  AnalyticsRequest,
  FacetRequest,
  HistogramRequest,
} from "../../../../Server/Services/LogAggregationService";
import AnalyticsModelPermission from "../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import {
  QualifiedColumn,
  SQL,
  Statement,
} from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import {
  appendLogMessageWordFilters,
  getLogMessageWordConditions,
  getLogMessageWordStatement,
} from "../../../../Server/Utils/Telemetry/LogMessageWordStatement";
import "../../TestingUtils/Init";
import Log from "../../../../Models/AnalyticsModels/Log";
import Span from "../../../../Models/AnalyticsModels/Span";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  getLogMessageWordNeedles,
  getLogMessageWordPattern,
} from "../../../../Utils/Telemetry/LogMessageWord";
import {
  SecurityTelemetryValueShape,
  getTelemetryMessageNeedles,
  getTelemetryMessagePattern,
} from "../../../../Utils/SecurityCase/SecurityTelemetrySearch";
import { describe, expect, test } from "@jest/globals";

/*
 * "Word in message" on the server: the conditions a word adds to the Logs
 * explorer's list (StatementGenerator, the `bodyWords` / `excludedBodyWords`
 * query keys) and to the chart, the facet counts, the analytics and the
 * export (LogAggregationService, the same request fields) - built in one
 * place, LogMessageWordStatement, the way Connected Signals counts a value
 * In the message. App's LogMessageWordsClickhouse runs them in a real
 * ClickHouse.
 */

const WHITESPACE: RegExp = /\s+/g;

const normalized: (statement: Statement) => string = (
  statement: Statement,
): string => {
  return statement.query.replace(WHITESPACE, " ").trim();
};

const paramValues: (statement: Statement) => Array<unknown> = (
  statement: Statement,
): Array<unknown> => {
  return Object.values(statement.query_params);
};

const PROJECT_ID: ObjectID = new ObjectID(
  "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
);

describe("one word's test on the message", () => {
  test("its spellings first, then its pattern, each bound as a parameter", () => {
    const statement: Statement | null = getLogMessageWordStatement({
      word: "10.0.0.1",
    });

    expect(statement).not.toBeNull();
    expect(statement!.query).toBe(
      "(multiSearchAnyCaseInsensitive(ifNull({p0:Identifier}, ''), {p1:Array(String)}) AND match(ifNull({p2:Identifier}, ''), {p3:String}))",
    );
    expect(statement!.query_params).toStrictEqual({
      p0: "body",
      p1: getLogMessageWordNeedles("10.0.0.1"),
      p2: "body",
      p3: getLogMessageWordPattern("10.0.0.1"),
    });
  });

  test("the very needles and pattern Connected Signals counts In the message with", () => {
    for (const [value, shape] of [
      ["203.0.113.7", SecurityTelemetryValueShape.Ipv4Address],
      ["2001:0DB8:0:0:0:0:0:7", SecurityTelemetryValueShape.Ipv6Address],
      ["evil.example", SecurityTelemetryValueShape.Name],
    ] as Array<[string, SecurityTelemetryValueShape]>) {
      const statement: Statement = getLogMessageWordStatement({
        word: value,
      })!;

      expect(paramValues(statement)).toContainEqual(
        getTelemetryMessageNeedles(value, shape),
      );
      expect(paramValues(statement)).toContain(
        getTelemetryMessagePattern(value, shape),
      );
    }
  });

  test("on a table read under an alias, the column is qualified", () => {
    const statement: Statement = getLogMessageWordStatement({
      word: "Cart",
      column: new QualifiedColumn("l", "body"),
    })!;

    expect(statement.query).toContain(
      "ifNull({p0_t:Identifier}.{p0_c:Identifier}, '')",
    );
    expect(statement.query_params).toMatchObject({ p0_t: "l", p0_c: "body" });
  });

  test("text that is no word has no test", () => {
    expect(getLogMessageWordStatement({ word: "   " })).toBeNull();
    expect(getLogMessageWordStatement({ word: "a\u0000b" })).toBeNull();
  });
});

describe("the conditions a query's or a request's words add", () => {
  test("AND for each word kept, AND NOT for each word left out", () => {
    const conditions: Array<Statement> = getLogMessageWordConditions({
      words: ["10.0.0.1", "Cart"],
      excludedWords: ["healthcheck"],
    });

    expect(
      conditions.map((condition: Statement): string => {
        return normalized(condition).split(" (")[0]!;
      }),
    ).toEqual(["AND", "AND", "AND NOT"]);
    expect(paramValues(conditions[2]!)).toContainEqual(["healthcheck"]);
  });

  test("text that is no word adds nothing: a malformed field never narrows a read to nothing", () => {
    expect(
      getLogMessageWordConditions({ words: ["", 42, null], excludedWords: {} }),
    ).toEqual([]);
    expect(getLogMessageWordConditions({})).toEqual([]);

    const statement: Statement = new Statement();
    appendLogMessageWordFilters(statement, { words: "  " });

    expect(statement.query).toBe("");
  });

  test("onto a WHERE that holds others, each after a space", () => {
    const statement: Statement = SQL`WHERE projectId = 1`;
    appendLogMessageWordFilters(statement, {
      words: ["Cart"],
      excludedWords: ["Card"],
    });

    expect(normalized(statement)).toMatch(
      /^WHERE projectId = 1 AND \(multiSearch[\s\S]* AND NOT \(multiSearch/,
    );
  });
});

describe("the list: StatementGenerator's message word keys", () => {
  const logs: StatementGenerator<Log> = new StatementGenerator<Log>({
    modelType: Log,
    database: ClickhouseAppInstance,
  });

  test("a word kept and a word left out, beside a column filter", () => {
    const statement: Statement = logs.toWhereStatement({
      severityText: "Error",
      bodyWords: ["10.0.0.1"],
      excludedBodyWords: ["healthcheck"],
    } as never);
    const text: string = normalized(statement);

    expect(text).toMatch(/^AND \{p0:Identifier\} = \{p1:String\} AND \(/);
    expect(text).toContain(
      "AND (multiSearchAnyCaseInsensitive(ifNull({p2:Identifier}, ''), {p3:Array(String)}) AND match(ifNull({p4:Identifier}, ''), {p5:String}))",
    );
    expect(text).toContain(" AND NOT (multiSearchAnyCaseInsensitive(");
    expect(paramValues(statement)).toContain(
      getLogMessageWordPattern("10.0.0.1"),
    );
    expect(paramValues(statement)).toContain(
      getLogMessageWordPattern("healthcheck"),
    );
    // Never a column of their own.
    expect(paramValues(statement)).not.toContain("bodyWords");
    expect(paramValues(statement)).not.toContain("excludedBodyWords");
  });

  test("words alone open the WHERE themselves", () => {
    const statement: Statement = logs.toWhereStatement({
      bodyWords: ["Cart", "loaded"],
    } as never);

    expect(normalized(statement).startsWith("AND (")).toBe(true);
    expect(normalized(statement)).toContain(") AND (multiSearch");
  });

  test("text that is no word filters nothing, never everything away", () => {
    expect(
      logs.toWhereStatement({ bodyWords: ["", "   "] } as never).query,
    ).toBe("");
    expect(
      logs.toWhereStatement({ bodyWords: "lone" } as never).query,
    ).toContain("multiSearchAnyCaseInsensitive");
  });

  test("a model with no message ignores them", () => {
    const spans: StatementGenerator<Span> = new StatementGenerator<Span>({
      modelType: Span,
      database: ClickhouseAppInstance,
    });

    expect(spans.toWhereStatement({ bodyWords: ["x"] } as never).query).toBe(
      "",
    );
  });
});

describe("a reader filters by the words only as far as they read the message", () => {
  const userId: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

  function props(
    permissions: Array<Permission>,
  ): DatabaseCommonInteractionProps {
    return {
      userId: userId,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          projectId: PROJECT_ID,
          permissions: permissions.map((permission: Permission) => {
            return {
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
              _type: "UserPermission" as const,
            };
          }),
          _type: "UserTenantAccessPermission",
        },
      },
    };
  }

  /*
   * The query gate is private; its public entry point resolves tenant and
   * owner scopes against real services first. What is under test is which
   * column the words are held to, so the gate is called directly.
   */
  function checkQuery(
    modelType: typeof Log | typeof Span,
    query: Record<string, unknown>,
    permissions: Array<Permission>,
  ): unknown {
    const gate: (
      modelType: typeof Log | typeof Span,
      query: Record<string, unknown>,
      props: DatabaseCommonInteractionProps,
    ) => void = (
      AnalyticsModelPermission as unknown as Record<string, unknown>
    )["checkQueryPermission"] as (
      modelType: typeof Log | typeof Span,
      query: Record<string, unknown>,
      props: DatabaseCommonInteractionProps,
    ) => void;

    try {
      gate.call(AnalyticsModelPermission, modelType, query, props(permissions));
      return null;
    } catch (error) {
      return error;
    }
  }

  test("the keys are held to the message column's read permission", () => {
    expect(AnalyticsModelPermission.getQueryKeyColumn("bodyWords")).toBe(
      "body",
    );
    expect(
      AnalyticsModelPermission.getQueryKeyColumn("excludedBodyWords"),
    ).toBe("body");
    expect(AnalyticsModelPermission.getQueryKeyColumn("severityText")).toBe(
      null,
    );
  });

  test("a reader of the message may filter by its words", () => {
    expect(
      checkQuery(Log, { bodyWords: ["10.0.0.1"], excludedBodyWords: ["x"] }, [
        Permission.ProjectOwner,
      ]),
    ).toBeNull();
    expect(
      checkQuery(Log, { bodyWords: ["10.0.0.1"] }, [
        Permission.ReadTelemetryServiceLog,
      ]),
    ).toBeNull();
  });

  test("a reader who may not read the message is refused, by the message's name", () => {
    const refusal: unknown = checkQuery(Log, { bodyWords: ["10.0.0.1"] }, [
      Permission.ReadTelemetryServiceTraces,
    ]);

    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toContain("body");
    expect((refusal as Error).message).not.toContain("bodyWords");
  });

  test("on a table with no message, the words are no column", () => {
    const refusal: unknown = checkQuery(Span, { bodyWords: ["x"] }, [
      Permission.ProjectOwner,
    ]);

    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toContain("Column does not exist");
  });
});

describe("the chart, the facet counts and the analytics read the same words", () => {
  const window: {
    projectId: ObjectID;
    startTime: Date;
    endTime: Date;
  } = {
    projectId: PROJECT_ID,
    startTime: new Date("2026-06-01T00:00:00.000Z"),
    endTime: new Date("2026-06-01T01:00:00.000Z"),
  };

  const histogram: (overrides: Partial<HistogramRequest>) => Statement = (
    overrides: Partial<HistogramRequest>,
  ): Statement => {
    return (LogAggregationService as any).buildHistogramStatement({
      ...window,
      bucketSizeInMinutes: 1,
      ...overrides,
    });
  };

  test("the chart leaves out the lines the list leaves out", () => {
    const statement: Statement = histogram({
      bodyWords: ["10.0.0.1"],
      excludedBodyWords: ["healthcheck"],
    });
    const text: string = normalized(statement);

    expect(text).toContain(" AND (multiSearchAnyCaseInsensitive(ifNull(");
    expect(text).toContain(" AND NOT (multiSearchAnyCaseInsensitive(ifNull(");
    expect(paramValues(statement)).toContain(
      getLogMessageWordPattern("10.0.0.1"),
    );
  });

  test("a chart that reads words reads the lines, never the severity projection", () => {
    expect(
      (LogAggregationService as any).histogramScansBaseTable({
        ...window,
        bucketSizeInMinutes: 1,
        bodyWords: ["10.0.0.1"],
      }),
    ).toBe(true);
    expect(
      (LogAggregationService as any).histogramScansBaseTable({
        ...window,
        bucketSizeInMinutes: 1,
        bodyWords: ["   "],
      }),
    ).toBe(false);
  });

  test("the facet counts and the analytics hold them too", () => {
    const facet: Statement = (LogAggregationService as any).buildFacetStatement(
      {
        ...window,
        facetKey: "severityText",
        limit: 50,
        bodyWords: ["Cart"],
      } as FacetRequest,
    );

    expect(normalized(facet)).toContain("multiSearchAnyCaseInsensitive(");
    expect(paramValues(facet)).toContain(getLogMessageWordPattern("Cart"));

    const analytics: Statement = (
      LogAggregationService as any
    ).buildAnalyticsTimeseriesStatement({
      ...window,
      bucketSizeInMinutes: 1,
      chartType: "timeseries",
      aggregation: "count",
      excludedBodyWords: ["Cart"],
    } as AnalyticsRequest);

    expect(normalized(analytics)).toContain(
      " AND NOT (multiSearchAnyCaseInsensitive(",
    );
  });
});
