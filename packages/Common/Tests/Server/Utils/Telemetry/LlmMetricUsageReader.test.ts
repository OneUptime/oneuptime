import { afterEach, describe, expect, jest, test } from "@jest/globals";
import LlmMetricUsageReader, {
  LLM_METRIC_USAGE_MAX_ROWS,
  LlmMetricUsageReadQuery,
} from "../../../../Server/Utils/Telemetry/LlmMetricUsageReader";
import MetricService from "../../../../Server/Services/MetricService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import {
  LlmMetricUsageDimension,
  LlmMetricUsageResponse,
} from "../../../../Types/Telemetry/LlmMetricUsageApi";
import {
  LlmMetricModelAttributeKeys,
  LlmMetricUserAttributeKeys,
  LlmTokenTypeAttributeKeys,
} from "../../../../Types/Telemetry/LlmMetricConventions";
import LlmMetricUsageUtil from "../../../../Utils/Telemetry/LlmMetricUsage";

/*
 * THE METRIC USAGE READ, WITHOUT A SERVER.
 *
 * App/Tests/Telemetry/LlmMetricUsageClickhouse.test.ts runs this statement
 * against a real ClickHouse with each coding tool's OTLP data points in
 * both temporalities. These pin what a reader of the SQL would otherwise
 * have to re-derive: a cumulative series counts what it grew by - never the
 * sum of its running totals - and a delta series the sum of its points;
 * series are told apart by every attribute and their start time; the group
 * and the token type are each the first key a point carries; the caller's
 * scope and a budget's scopes are WHEREs; and a read cut short throws.
 */

const PROJECT: ObjectID = new ObjectID("9900000000000000000000a1");
const SERVICE_A: ObjectID = new ObjectID("9900000000000000000000b1");
const SERVICE_B: ObjectID = new ObjectID("9900000000000000000000b2");
const START: Date = new Date("2026-10-28T00:00:00.000Z");
const END: Date = new Date("2026-11-04T00:00:00.000Z");

function query(
  overrides: Partial<LlmMetricUsageReadQuery> = {},
): LlmMetricUsageReadQuery {
  return {
    projectId: PROJECT,
    startTime: START,
    endTime: END,
    dimension: LlmMetricUsageDimension.None,
    ...overrides,
  };
}

function paramValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

describe("the statement", () => {
  const statement: Statement = LlmMetricUsageReader.buildStatement(
    query({ dimension: LlmMetricUsageDimension.Employee }),
  );
  const sql: string = statement.query;

  test("reads the project's GenAI metrics in the range, still retained", () => {
    expect(sql).toContain("FROM MetricItemV3 WHERE projectId = ");
    expect(sql).toContain("AND name IN (");
    expect(sql).toContain("AND time >= ");
    expect(sql).toContain("AND time <= ");
    expect(sql).toContain("AND retentionDate >= now()");
    expect(paramValues(statement)).toContain(PROJECT.toString());
    expect(paramValues(statement)).toContainEqual(
      LlmMetricUsageUtil.getMetricNames(),
    );
  });

  /*
   * THE FIX. A cumulative counter's points are running totals; adding them
   * up counted a session's spend once per export.
   */
  test("a cumulative series counts what it grew by, a delta series its sum", () => {
    expect(sql).toContain(
      "if(aggregationTemporality = 'Cumulative', greatest(max(value) - if(min(startTime) >= ",
    );
    expect(sql).toContain(", 0, min(value)), 0), sum(value)) AS increase");
  });

  test("a cumulative series is one attribute set and one start time", () => {
    expect(sql).toContain(
      "if(aggregationTemporality = 'Cumulative', cityHash64(mapKeys(attributes), mapValues(attributes)), 0)",
    );
    expect(sql).toContain(
      "if(aggregationTemporality = 'Cumulative', startTimeUnixNano, 0)",
    );
  });

  test("series are added up per metric, group and token type", () => {
    expect(sql).toContain(
      "SELECT metric, groupKey, tokenType, sum(increase) AS value FROM (SELECT name AS metric, ",
    );
    expect(sql).toContain(") GROUP BY metric, groupKey, tokenType ORDER BY value DESC");
  });

  test("the group is the first of the dimension's keys a point carries", () => {
    for (const key of LlmMetricUserAttributeKeys) {
      expect(paramValues(statement)).toContain(key);
    }

    expect(sql).toContain("coalesce(nullIf(attributes[");
    expect(sql).toContain(" AS groupKey, ");
  });

  test("the token type is the first token type key a point carries", () => {
    for (const key of LlmTokenTypeAttributeKeys) {
      expect(paramValues(statement)).toContain(key);
    }

    expect(sql).toContain(" AS tokenType, ");
  });

  test("an ungrouped read groups by nothing", () => {
    const ungrouped: string = LlmMetricUsageReader.buildStatement(query())
      .query;

    expect(ungrouped).toContain("SELECT name AS metric, '' AS groupKey, ");
  });

  test("a read cut short throws, never answers an empty body", () => {
    expect(sql).toContain("max_execution_time = 45");
    expect(sql).toContain("timeout_overflow_mode = 'throw'");
    expect(sql).not.toContain("'break'");
  });

  test("it reads one more row than it returns, to know it was cut", () => {
    expect(paramValues(statement)).toContain(LLM_METRIC_USAGE_MAX_ROWS + 1);
  });
});

describe("the scopes", () => {
  test("the caller's services are a WHERE", () => {
    const statement: Statement = LlmMetricUsageReader.buildStatement(
      query({ serviceIds: [SERVICE_A], excludedServiceIds: [SERVICE_B] }),
    );
    const where: string = statement.query.slice(
      0,
      statement.query.indexOf(" GROUP BY "),
    );

    expect(where).toContain("AND primaryEntityId IN (");
    expect(where).toContain("AND primaryEntityId NOT IN (");
    expect(paramValues(statement)).toContainEqual([SERVICE_A.toString()]);
    expect(paramValues(statement)).toContainEqual([SERVICE_B.toString()]);
  });

  test("a budget's service", () => {
    const statement: Statement = LlmMetricUsageReader.buildStatement(
      query({ serviceId: SERVICE_A }),
    );

    expect(statement.query).toContain("AND primaryEntityId = ");
    expect(paramValues(statement)).toContain(SERVICE_A.toString());
  });

  test("a provider matches every spelling, on either provider key", () => {
    const statement: Statement = LlmMetricUsageReader.buildStatement(
      query({ llmSystem: "az.ai.openai" }),
    );

    expect(statement.query).toContain(
      "AND (attributes['gen_ai.system'] IN (",
    );
    expect(statement.query).toContain(
      "OR attributes['gen_ai.provider.name'] IN (",
    );

    const spellings: Array<string> = paramValues(statement).find(
      (value: unknown): boolean => {
        return Array.isArray(value) && value.includes("azure.ai.openai");
      },
    ) as Array<string>;

    expect(spellings).toEqual(
      expect.arrayContaining(["azure.ai.openai", "az.ai.openai"]),
    );
  });

  test("a model is the first model key a point carries", () => {
    const statement: Statement = LlmMetricUsageReader.buildStatement(
      query({ llmModel: "claude-sonnet-4-5" }),
    );

    for (const key of LlmMetricModelAttributeKeys) {
      expect(paramValues(statement)).toContain(key);
    }

    expect(paramValues(statement)).toContain("claude-sonnet-4-5");
  });

  test("what someone typed never reaches the SQL text", () => {
    const hostile: string = "x'); DROP TABLE MetricItemV3; --";
    const statement: Statement = LlmMetricUsageReader.buildStatement(
      query({
        llmSystem: hostile,
        llmModel: hostile,
        llmUser: hostile,
        llmTeam: hostile,
      }),
    );

    expect(statement.query).not.toContain("DROP TABLE");
    expect(paramValues(statement)).toContain(hostile);
  });
});

describe("the rows", () => {
  test("every field is read defensively", () => {
    expect(
      LlmMetricUsageReader.toRows([
        {
          metric: "claude_code.cost.usage",
          groupKey: "ana@example.com",
          tokenType: "",
          value: 1.5,
        },
        { metric: 5, groupKey: null, tokenType: {}, value: "not a number" },
      ] as unknown as Array<JSONObject>),
    ).toEqual([
      {
        metric: "claude_code.cost.usage",
        group: "ana@example.com",
        tokenType: "",
        value: 1.5,
      },
      { metric: "", group: "", tokenType: "", value: 0 },
    ]);
  });
});

describe("read", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function answer(rows: Array<JSONObject>): void {
    jest.spyOn(MetricService, "executeQuery").mockResolvedValue({
      json: async () => {
        return { data: rows };
      },
    } as never);
  }

  test("folds what ClickHouse answered into totals and groups", async () => {
    answer([
      {
        metric: "claude_code.cost.usage",
        groupKey: "ana@example.com",
        tokenType: "",
        value: 12.5,
      },
      {
        metric: "claude_code.token.usage",
        groupKey: "ana@example.com",
        tokenType: "cacheRead",
        value: 40000,
      },
      {
        metric: "codex.turn.cost_microusd",
        groupKey: "bo@example.com",
        tokenType: "",
        value: 2500000,
      },
    ]);

    const usage: LlmMetricUsageResponse = await LlmMetricUsageReader.read(
      query({ dimension: LlmMetricUsageDimension.Employee }),
    );

    expect(usage.totals.costUsd).toBeCloseTo(15, 10);
    expect(usage.totals.inputTokens).toBe(40000);
    expect(usage.groups.map((group: { key: string }) => group.key)).toEqual([
      "ana@example.com",
      "bo@example.com",
    ]);
    expect(usage.truncated).toBe(false);
  });

  test("an ungrouped read returns no groups", async () => {
    answer([
      {
        metric: "claude_code.cost.usage",
        groupKey: "",
        tokenType: "",
        value: 1,
      },
    ]);

    const usage: LlmMetricUsageResponse = await LlmMetricUsageReader.read(
      query(),
    );

    expect(usage.groups).toEqual([]);
    expect(usage.totals.costUsd).toBe(1);
  });

  test("more rows than one read returns: the rest is left out, and said", async () => {
    const rows: Array<JSONObject> = [];

    for (let index: number = 0; index <= LLM_METRIC_USAGE_MAX_ROWS; index++) {
      rows.push({
        metric: "claude_code.cost.usage",
        groupKey: `person-${index}`,
        tokenType: "",
        value: 1,
      });
    }

    answer(rows);

    const usage: LlmMetricUsageResponse = await LlmMetricUsageReader.read(
      query({ dimension: LlmMetricUsageDimension.Employee }),
    );

    expect(usage.truncated).toBe(true);
    expect(usage.groups).toHaveLength(LLM_METRIC_USAGE_MAX_ROWS);
  });

  test("a failed read throws: a 0 nobody measured would hide real spend", async () => {
    jest
      .spyOn(MetricService, "executeQuery")
      .mockRejectedValue(new Error("Timeout exceeded"));

    await expect(LlmMetricUsageReader.read(query())).rejects.toThrow(
      "Timeout exceeded",
    );
  });
});
