import { afterEach, describe, expect, jest, test } from "@jest/globals";
import LlmUsageReader, {
  LLM_USAGE_MAX_ROWS,
  LlmUsageReadQuery,
} from "../../../../Server/Utils/Telemetry/LlmUsageReader";
import MetricService from "../../../../Server/Services/MetricService";
import SpanService from "../../../../Server/Services/SpanService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  LlmUsageDimension,
  LlmUsageResponse,
  LlmUsageSource,
} from "../../../../Types/Telemetry/LlmUsageApi";
import { LlmMetricUsageRow } from "../../../../Utils/Telemetry/LlmMetricUsage";
import { LlmUsageSpanRow } from "../../../../Utils/Telemetry/LlmUsage";

/*
 * THE USAGE READ, WITHOUT A SERVER.
 *
 * App/Tests/Telemetry/LlmUsageCountingClickhouse.test.ts runs this read
 * against a real ClickHouse, under both analyzers. These pin the AI calls'
 * statement - each service's totals in rows of their own, first, with each
 * model call's figures counted once - and how the read joins it to the
 * usage metrics: the caller's scope on both, the metrics left out when the
 * caller may not read them, a budget's scopes on both, and a failed or
 * cut-short read said, never read as nothing.
 */

const PROJECT: ObjectID = new ObjectID("9900000000000000000000a1");
const SERVICE_A: ObjectID = new ObjectID("9900000000000000000000b1");
const SERVICE_B: ObjectID = new ObjectID("9900000000000000000000b2");
const START: Date = new Date("2026-11-02T00:00:00.000Z");
const END: Date = new Date("2026-11-09T00:00:00.000Z");

function query(overrides: Partial<LlmUsageReadQuery> = {}): LlmUsageReadQuery {
  return {
    projectId: PROJECT,
    startTime: START,
    endTime: END,
    dimension: LlmUsageDimension.None,
    ...overrides,
  };
}

function values(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

// The outer read's WHERE: what follows the counted-calls subqueries.
function outerWhere(sql: string): string {
  const from: number = sql.lastIndexOf("AS costCovered FROM SpanItemV3 WHERE ");

  return sql.slice(from, sql.indexOf(") GROUP BY ", from));
}

describe("the AI calls' statement", () => {
  const statement: Statement = LlmUsageReader.buildSpanStatement(
    query({ dimension: LlmUsageDimension.Employee }),
  );
  const sql: string = statement.query;

  test("reads the project's AI calls that started in the range, still retained", () => {
    const where: string = outerWhere(sql);

    expect(where).toMatch(
      / WHERE projectId = \{p\d+:String\} AND isLlmSpan = 1 AND startTime >= \{p\d+:DateTime64\(9\)\} AND startTime <= \{p\d+:DateTime64\(9\)\} AND retentionDate >= now\(\)/,
    );
    expect(values(statement)).toContain(PROJECT.toString());
  });

  test("counts the calls, the failed calls, and each model call's figures once", () => {
    expect(sql).toContain(
      "SELECT serviceKey, groupKey, count() AS calls, countIf(statusCode = 2) AS erroredCalls, " +
        "sum(if(tokensCovered, 0, llmInputTokens)) AS inputTokens, " +
        "sum(if(tokensCovered, 0, llmOutputTokens)) AS outputTokens, " +
        "sum(if(tokensCovered, 0, llmTotalTokens)) AS totalTokens, " +
        "sum(if(costCovered, 0, llmCost)) AS costUsd FROM (SELECT toString(primaryEntityId) AS serviceKey, ",
    );
  });

  // Worked out only where it matters: a call that reports nothing adds 0 either way.
  test("a call's figure is looked up only when it reports one", () => {
    expect(sql).toContain(
      "if(llmInputTokens > 0 OR llmOutputTokens > 0 OR llmTotalTokens > 0, (cityHash64(traceId, spanId, 't') IN (",
    );
    expect(sql).toContain(
      ", 0) AS tokensCovered, if(llmCost > 0, (cityHash64(traceId, spanId, 'c') IN (",
    );
    expect(sql).toContain(", 0) AS costCovered FROM SpanItemV3");
  });

  test("a person is their email, else their id", () => {
    expect(sql).toContain(
      "concat('g:', if(ifNull(llmUserEmail, '') != '', ifNull(llmUserEmail, ''), ifNull(llmUserId, ''))) AS groupKey, ",
    );
  });

  test("each service's totals are rows of their own, first, so a cut reaches only the groups", () => {
    expect(sql).toContain(
      ") GROUP BY GROUPING SETS ((serviceKey), (serviceKey, groupKey)) ORDER BY groupKey = '' DESC, costUsd DESC, serviceKey ASC, groupKey ASC LIMIT ",
    );
    expect(values(statement)).toContain(LLM_USAGE_MAX_ROWS + 1);
  });

  test("a read cut short throws, never answers an empty body", () => {
    expect(sql).toContain("max_execution_time = 45");
    expect(sql).toContain("timeout_overflow_mode = 'throw'");
    expect(sql).not.toContain("'break'");
  });

  test.each([
    [LlmUsageDimension.Team, "concat('g:', ifNull(llmTeam, '')) AS groupKey"],
    [
      LlmUsageDimension.Model,
      "concat('g:', ifNull(llmRequestModel, '')) AS groupKey",
    ],
    [
      LlmUsageDimension.Provider,
      "concat('g:', ifNull(llmSystem, '')) AS groupKey",
    ],
  ])("by %s", (dimension: LlmUsageDimension, group: string) => {
    const grouped: string = LlmUsageReader.buildSpanStatement(
      query({ dimension: dimension }),
    ).query;

    expect(grouped).toContain(group);
    expect(grouped).toContain("GROUPING SETS");
  });

  test.each([[LlmUsageDimension.None], [LlmUsageDimension.Service]])(
    "%s: the services' totals alone",
    (dimension: LlmUsageDimension) => {
      const totals: string = LlmUsageReader.buildSpanStatement(
        query({ dimension: dimension }),
      ).query;

      expect(totals).toContain("'' AS groupKey, ");
      expect(totals).toContain(") GROUP BY serviceKey, groupKey ORDER BY ");
      expect(totals).not.toContain("GROUPING SETS");
    },
  );
});

describe("the scopes", () => {
  test("the caller's services narrow the calls and the calls inside them", () => {
    const statement: Statement = LlmUsageReader.buildSpanStatement(
      query({ serviceIds: [SERVICE_A], excludedServiceIds: [SERVICE_B] }),
    );

    expect(outerWhere(statement.query)).toContain("AND primaryEntityId IN (");
    expect(outerWhere(statement.query)).toContain(
      "AND primaryEntityId NOT IN (",
    );
    // The outer read, and the two sets per figure (three reads each).
    expect(statement.query.split("AND primaryEntityId IN (").length - 1).toBe(
      9,
    );
    expect(values(statement)).toContainEqual([SERVICE_A.toString()]);
    expect(values(statement)).toContainEqual([SERVICE_B.toString()]);
  });

  /*
   * A budget on one service still sees that its agent run's calls were
   * made, and counted, by another: the budget's scopes narrow the calls it
   * adds up, never the calls inside them.
   */
  test("a budget's scopes narrow the calls added up, never the calls inside them", () => {
    const statement: Statement = LlmUsageReader.buildSpanStatement(
      query({
        serviceId: SERVICE_A,
        llmSystem: "az.ai.openai",
        llmModel: "gpt-4o",
      }),
    );
    const sql: string = statement.query;

    expect(outerWhere(sql)).toContain("AND primaryEntityId = ");
    expect(outerWhere(sql)).toContain("AND llmSystem IN (");
    expect(outerWhere(sql)).toContain("AND llmRequestModel = ");
    expect(sql.split("AND primaryEntityId = ").length - 1).toBe(1);
    expect(sql.split("AND llmSystem IN (").length - 1).toBe(1);
    expect(values(statement)).toContain(SERVICE_A.toString());
    expect(values(statement)).toContain("gpt-4o");

    const spellings: Array<string> = values(statement).find(
      (value: unknown): boolean => {
        return Array.isArray(value) && value.includes("azure.ai.openai");
      },
    ) as Array<string>;

    expect(spellings).toEqual(
      expect.arrayContaining(["azure.ai.openai", "az.ai.openai"]),
    );
  });

  test("what someone typed never reaches the SQL text", () => {
    const hostile: string = "x'); DROP TABLE SpanItemV3; --";
    const statement: Statement = LlmUsageReader.buildSpanStatement(
      query({
        dimension: LlmUsageDimension.Model,
        llmSystem: hostile,
        llmModel: hostile,
      }),
    );

    expect(statement.query).not.toContain("DROP TABLE");
    expect(values(statement)).toContain(hostile);
  });

  test("the counted-calls scope is the read's project, range and caller's scope", () => {
    expect(
      LlmUsageReader.getCountedCallsScope(
        query({
          serviceIds: [SERVICE_A],
          serviceId: SERVICE_B,
          llmModel: "gpt-4o",
        }),
      ),
    ).toEqual({
      projectId: PROJECT,
      startTime: START,
      endTime: END,
      serviceIds: [SERVICE_A],
      excludedServiceIds: undefined,
    });
  });
});

describe("the rows", () => {
  test("a total row, a group row, and every field read defensively", () => {
    expect(
      LlmUsageReader.toSpanRows([
        {
          serviceKey: SERVICE_A.toString(),
          groupKey: "",
          calls: "12",
          erroredCalls: 1,
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          costUsd: 0.5,
        },
        {
          serviceKey: SERVICE_A.toString(),
          groupKey: "g:ana@example.com",
          calls: 12,
          erroredCalls: 1,
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          costUsd: 0.5,
        },
        {
          serviceKey: 5,
          groupKey: null,
          calls: "many",
          costUsd: Infinity,
        },
      ] as unknown as Array<JSONObject>),
    ).toEqual([
      {
        service: SERVICE_A.toString(),
        isTotal: true,
        group: "",
        calls: 12,
        erroredCalls: 1,
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        costUsd: 0.5,
      },
      {
        service: SERVICE_A.toString(),
        isTotal: false,
        group: "ana@example.com",
        calls: 12,
        erroredCalls: 1,
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        costUsd: 0.5,
      },
      {
        service: "",
        isTotal: true,
        group: "",
        calls: 0,
        erroredCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      },
    ] as Array<LlmUsageSpanRow>);
  });
});

describe("read", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function answer(rows: Array<JSONObject>): unknown {
    return {
      json: async () => {
        return { data: rows };
      },
    };
  }

  function spanRow(
    service: string,
    figures: Partial<Record<string, number>>,
    group?: string,
  ): JSONObject {
    return {
      serviceKey: service,
      groupKey: group === undefined ? "" : `g:${group}`,
      calls: 0,
      erroredCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      ...figures,
    } as JSONObject;
  }

  function metricRow(
    service: string,
    value: number,
    group?: { value: string; attribute: string },
  ): JSONObject {
    return {
      metric: "claude_code.cost.usage",
      serviceKey: service,
      groupKey: group ? `g:${group.value}` : "",
      groupAttribute: group ? group.attribute : "",
      tokenType: "",
      value: value,
    };
  }

  /*
   * What a test reads back from a stubbed read: the statements it was
   * given. Typed by its shape, not as jest.SpiedFunction, which the spy
   * jest.spyOn returns is not assignable to under every jest-mock version
   * the tests are type-checked with.
   */
  interface StubbedRead {
    mock: { calls: Array<Array<unknown>> };
  }

  function mockReads(data: {
    spans?: Array<JSONObject>;
    metrics?: Array<JSONObject>;
  }): {
    spans: StubbedRead;
    metrics: StubbedRead;
  } {
    return {
      spans: jest
        .spyOn(SpanService, "executeQuery")
        .mockResolvedValue(answer(data.spans || []) as never),
      metrics: jest
        .spyOn(MetricService, "executeQuery")
        .mockResolvedValue(answer(data.metrics || []) as never),
    };
  }

  test("the apps' calls and a coding tool's metrics, each service from its signal", async () => {
    mockReads({
      spans: [spanRow("app", { calls: 40, inputTokens: 900, costUsd: 2 })],
      metrics: [metricRow("claude-code", 5), metricRow("app", 2)],
    });

    const usage: LlmUsageResponse = await LlmUsageReader.read(query());

    expect(usage.totals.calls).toBe(40);
    expect(usage.totals.costUsd).toBe(7);
    expect(usage.totals.costSource).toBe(LlmUsageSource.Both);
    expect(usage.totals.tokenSource).toBe(LlmUsageSource.Calls);
    expect(usage.metricsLeftOut).toBe(false);
    expect(usage.truncated).toBe(false);
  });

  test("the metrics are read with the caller's scope, and the read's dimension", async () => {
    const reads: ReturnType<typeof mockReads> = mockReads({});

    await LlmUsageReader.read(
      query({
        dimension: LlmUsageDimension.Employee,
        serviceIds: [SERVICE_A],
        excludedServiceIds: [SERVICE_B],
      }),
    );

    const metrics: Statement = reads.metrics.mock.calls[0]![0] as Statement;

    expect(metrics.query).toContain("FROM MetricItemV3");
    expect(metrics.query).toContain("AND primaryEntityId IN (");
    expect(metrics.query).toContain("AND primaryEntityId NOT IN (");
    expect(metrics.query).toContain("GROUPING SETS");
    expect(values(metrics)).toContainEqual([SERVICE_A.toString()]);
  });

  test("the metrics' own scope, when the caller's differs on metrics", async () => {
    const reads: ReturnType<typeof mockReads> = mockReads({});

    await LlmUsageReader.read(
      query({
        serviceIds: [SERVICE_A],
        metricFilter: { serviceIds: [SERVICE_B] },
      }),
    );

    const metrics: Statement = reads.metrics.mock.calls[0]![0] as Statement;

    expect(values(metrics)).toContainEqual([SERVICE_B.toString()]);
    expect(values(metrics)).not.toContainEqual([SERVICE_A.toString()]);
  });

  test("a caller who may not read metrics gets the calls alone, and is told", async () => {
    const reads: ReturnType<typeof mockReads> = mockReads({
      spans: [spanRow("app", { calls: 40, costUsd: 2 })],
      metrics: [metricRow("claude-code", 5)],
    });

    const usage: LlmUsageResponse = await LlmUsageReader.read(
      query({ metricFilter: null }),
    );

    expect(reads.metrics).not.toHaveBeenCalled();
    expect(usage.metricsLeftOut).toBe(true);
    expect(usage.totals.costUsd).toBe(2);
    expect(usage.totals.costSource).toBe(LlmUsageSource.Calls);
  });

  test("a budget's scopes reach both reads", async () => {
    const reads: ReturnType<typeof mockReads> = mockReads({});

    await LlmUsageReader.read(
      query({ serviceId: SERVICE_A, llmSystem: "openai", llmModel: "gpt-4o" }),
    );

    const spans: Statement = reads.spans.mock.calls[0]![0] as Statement;
    const metrics: Statement = reads.metrics.mock.calls[0]![0] as Statement;

    for (const statement of [spans, metrics]) {
      expect(statement.query).toContain("AND primaryEntityId = ");
      expect(values(statement)).toContain(SERVICE_A.toString());
      expect(values(statement)).toContainEqual(["openai", "OpenAI"]);
      expect(values(statement)).toContain("gpt-4o");
    }
  });

  test("by person, a person's calls and metrics are one row", async () => {
    mockReads({
      spans: [
        spanRow("app", { calls: 40, costUsd: 2 }),
        spanRow("app", { calls: 40, costUsd: 2 }, "ana@example.com"),
      ],
      metrics: [
        metricRow("claude-code", 5),
        metricRow("claude-code", 5, {
          value: "ana@example.com",
          attribute: "user.email",
        }),
      ],
    });

    const usage: LlmUsageResponse = await LlmUsageReader.read(
      query({ dimension: LlmUsageDimension.Employee }),
    );

    expect(usage.groups).toHaveLength(1);
    expect(usage.groups[0]!.key).toBe("ana@example.com");
    expect(usage.groups[0]!.costUsd).toBe(7);
    expect(usage.groups[0]!.calls).toBe(40);
  });

  // #6399: where a reader names people at read time.
  test("a metric group is filed under the name the caller gives it", async () => {
    mockReads({
      metrics: [
        metricRow("cursor", 7.2),
        metricRow("cursor", 7.2, {
          value: "u-7f3a",
          attribute: "cursor.user.id",
        }),
      ],
    });

    const named: Array<string> = [];
    const usage: LlmUsageResponse = await LlmUsageReader.read(
      query({
        dimension: LlmUsageDimension.Employee,
        nameMetricGroup: (row: LlmMetricUsageRow): string => {
          named.push(row.groupAttribute || "");

          return "bob@example.com";
        },
      }),
    );

    expect(named).toEqual(["cursor.user.id"]);
    expect(usage.groups[0]!.key).toBe("bob@example.com");
  });

  test("either read cut short: the groups may be incomplete, and said - never the totals", async () => {
    const spans: Array<JSONObject> = [spanRow("app", { calls: 3, costUsd: 9 })];

    for (let index: number = 0; index < LLM_USAGE_MAX_ROWS; index++) {
      spans.push(spanRow("app", { calls: 1 }, `person-${index}`));
    }

    mockReads({ spans: spans });

    const cut: LlmUsageResponse = await LlmUsageReader.read(
      query({ dimension: LlmUsageDimension.Employee }),
    );

    expect(cut.truncated).toBe(true);
    expect(cut.totals.costUsd).toBe(9);
    expect(cut.totals.calls).toBe(3);
    expect(cut.groups).toHaveLength(LLM_USAGE_MAX_ROWS - 1);

    jest.restoreAllMocks();

    const metrics: Array<JSONObject> = [metricRow("claude-code", 4)];

    for (let index: number = 0; index < LLM_USAGE_MAX_ROWS; index++) {
      metrics.push(
        metricRow("claude-code", 0.001, {
          value: `person-${index}`,
          attribute: "user.email",
        }),
      );
    }

    mockReads({ metrics: metrics });

    const metricsCut: LlmUsageResponse = await LlmUsageReader.read(
      query({ dimension: LlmUsageDimension.Employee }),
    );

    expect(metricsCut.truncated).toBe(true);
    expect(metricsCut.totals.costUsd).toBe(4);
  });

  test("a failed read throws: a 0 nobody measured would hide real spend", async () => {
    jest
      .spyOn(SpanService, "executeQuery")
      .mockRejectedValue(new Error("span timeout"));
    jest
      .spyOn(MetricService, "executeQuery")
      .mockResolvedValue(answer([]) as never);

    await expect(LlmUsageReader.read(query())).rejects.toThrow("span timeout");

    jest.restoreAllMocks();

    jest
      .spyOn(SpanService, "executeQuery")
      .mockResolvedValue(answer([]) as never);
    jest
      .spyOn(MetricService, "executeQuery")
      .mockRejectedValue(new Error("metric timeout"));

    await expect(LlmUsageReader.read(query())).rejects.toThrow(
      "metric timeout",
    );
  });
});
