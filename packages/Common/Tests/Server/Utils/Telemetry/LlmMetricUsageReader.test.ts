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
  LlmMetricProviderAttributeKeys,
  LlmMetricUserAttributeKeys,
  LlmTokenTypeAttributeKeys,
} from "../../../../Types/Telemetry/LlmMetricConventions";
import LlmMetricUsageUtil, {
  LlmMetricUsageRow,
} from "../../../../Utils/Telemetry/LlmMetricUsage";

/*
 * THE METRIC USAGE READ, WITHOUT A SERVER.
 *
 * App/Tests/Telemetry/LlmMetricUsageClickhouse.test.ts and
 * LlmUsageCountingClickhouse.test.ts run this statement against a real
 * ClickHouse, under both analyzers, with each coding tool's OTLP data
 * points in both temporalities and with counters that restart. These pin
 * what a reader of the SQL would otherwise have to re-derive: a cumulative
 * series counts its steps up, a step down read as a restart (Prometheus'
 * increase()), and a delta series the sum of its points; series are told
 * apart by every attribute and their start time; each service's totals are
 * rows of their own, sorted first, so a cut reaches only the groups; the
 * group and the token type are each the first key a point carries, and the
 * row says which group key; the caller's scope and a budget's scopes are
 * WHEREs; and a read cut short throws.
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
   * A cumulative counter's points are running totals: adding them up
   * counted a session's spend once per export. Reading max - min counted a
   * counter that restarted (10, 15, 2, 5) as 13 where it is 10.
   */
  test("a cumulative series counts each step up, and after a step down the value itself", () => {
    expect(sql).toContain(
      "arraySort(groupArrayIf((timeUnixNano, ifNull(value, 0)), ifNull(aggregationTemporality, '') = 'Cumulative')) AS seriesPoints",
    );
    expect(sql).toContain(
      "arraySum(arrayMap((current, previous) -> if(current >= previous, current - previous, greatest(current, 0)), " +
        "arrayPopFront(arrayMap(seriesPoint -> seriesPoint.2, seriesPoints)), " +
        "arrayPopBack(arrayMap(seriesPoint -> seriesPoint.2, seriesPoints))))",
    );
    expect(sql).not.toContain("max(value) - ");
  });

  test("a series that started in the range counts its first point from zero", () => {
    expect(sql).toContain("if(ifNull(min(startTime) >= ");
    expect(sql).toContain(
      ", 0), greatest(ifNull(seriesPoints[1].2, 0), 0), 0)",
    );
  });

  test("a delta series, or one that names no temporality, counts its sum", () => {
    expect(sql).toContain(
      ", sum(ifNull(value, 0))) AS seriesIncrease FROM MetricItemV3",
    );
    expect(sql).toContain(
      "if(ifNull(aggregationTemporality, '') = 'Cumulative', ",
    );
  });

  test("a cumulative series is one attribute set and one start time", () => {
    expect(sql).toContain(
      "if(ifNull(aggregationTemporality, '') = 'Cumulative', cityHash64(mapKeys(attributes), mapValues(attributes)), 0)",
    );
    expect(sql).toContain(
      "if(ifNull(aggregationTemporality, '') = 'Cumulative', ifNull(startTimeUnixNano, 0), 0)",
    );
  });

  test("series are added up per metric, service, group and token type", () => {
    expect(sql).toContain(
      "SELECT metric, serviceKey, groupKey, groupAttribute, tokenType, sum(seriesIncrease) AS value FROM (SELECT name AS metric, toString(primaryEntityId) AS serviceKey, ",
    );
  });

  /*
   * The totals are rows of their own, sorted before every group, so a read
   * that hits the row limit cuts groups and never a service's total.
   */
  test("each service's totals are rows of their own, first", () => {
    expect(sql).toContain(
      ") GROUP BY GROUPING SETS ((metric, serviceKey, tokenType), (metric, serviceKey, groupKey, groupAttribute, tokenType)) ORDER BY groupKey = '' DESC, value DESC",
    );
  });

  test("the group is the first of the dimension's keys a point carries, and says which", () => {
    for (const key of LlmMetricUserAttributeKeys) {
      expect(paramValues(statement)).toContain(key);
    }

    expect(sql).toContain("concat('g:', coalesce(nullIf(attributes[");
    expect(sql).toContain(" AS groupKey, multiIf(attributes[");
    expect(sql).toContain(" AS groupAttribute, ");
  });

  test("the token type is the first token type key a point carries", () => {
    for (const key of LlmTokenTypeAttributeKeys) {
      expect(paramValues(statement)).toContain(key);
    }

    expect(sql).toContain(" AS tokenType, ");
  });

  test("an ungrouped read groups by nothing but the service", () => {
    const ungrouped: string =
      LlmMetricUsageReader.buildStatement(query()).query;

    expect(ungrouped).toContain("'' AS groupKey, '' AS groupAttribute, ");
    expect(ungrouped).toContain(
      ") GROUP BY metric, serviceKey, groupKey, groupAttribute, tokenType ORDER BY",
    );
    expect(ungrouped).not.toContain("GROUPING SETS");
  });

  // A service is every row's own: its totals are the whole answer.
  test("by service, the read is the services' totals", () => {
    const byService: string = LlmMetricUsageReader.buildStatement(
      query({ dimension: LlmMetricUsageDimension.Service }),
    ).query;

    expect(byService).toContain("'' AS groupKey, '' AS groupAttribute, ");
    expect(byService).not.toContain("GROUPING SETS");
  });

  test("by provider, the group is the first provider key a point carries", () => {
    const byProvider: Statement = LlmMetricUsageReader.buildStatement(
      query({ dimension: LlmMetricUsageDimension.Provider }),
    );

    for (const key of LlmMetricProviderAttributeKeys) {
      expect(paramValues(byProvider)).toContain(key);
    }

    expect(byProvider.query).toContain("GROUPING SETS");
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

    expect(statement.query).toContain("AND (attributes['gen_ai.system'] IN (");
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
        dimension: LlmMetricUsageDimension.Employee,
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
  test("a total row, a group row, and every field read defensively", () => {
    expect(
      LlmMetricUsageReader.toRows([
        {
          metric: "claude_code.cost.usage",
          serviceKey: SERVICE_A.toString(),
          groupKey: "",
          groupAttribute: "",
          tokenType: "",
          value: 3,
        },
        {
          metric: "claude_code.cost.usage",
          serviceKey: SERVICE_A.toString(),
          groupKey: "g:ana@example.com",
          groupAttribute: "user.email",
          tokenType: "",
          value: 1.5,
        },
        // A group that named nobody: still a group, the unattributed one.
        {
          metric: "claude_code.cost.usage",
          serviceKey: SERVICE_A.toString(),
          groupKey: "g:",
          groupAttribute: "",
          tokenType: "",
          value: 1.5,
        },
        {
          metric: 5,
          serviceKey: 7,
          groupKey: null,
          groupAttribute: [],
          tokenType: {},
          value: "not a number",
        },
      ] as unknown as Array<JSONObject>),
    ).toEqual([
      {
        metric: "claude_code.cost.usage",
        service: SERVICE_A.toString(),
        group: "",
        groupAttribute: "",
        isTotal: true,
        tokenType: "",
        value: 3,
      },
      {
        metric: "claude_code.cost.usage",
        service: SERVICE_A.toString(),
        group: "ana@example.com",
        groupAttribute: "user.email",
        isTotal: false,
        tokenType: "",
        value: 1.5,
      },
      {
        metric: "claude_code.cost.usage",
        service: SERVICE_A.toString(),
        group: "",
        groupAttribute: "",
        isTotal: false,
        tokenType: "",
        value: 1.5,
      },
      {
        metric: "",
        service: "",
        group: "",
        groupAttribute: "",
        isTotal: true,
        tokenType: "",
        value: 0,
      },
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

  function row(
    overrides: Partial<{
      metric: string;
      serviceKey: string;
      groupKey: string;
      groupAttribute: string;
      tokenType: string;
      value: number;
    }>,
  ): JSONObject {
    return {
      metric: "claude_code.cost.usage",
      serviceKey: SERVICE_A.toString(),
      groupKey: "",
      groupAttribute: "",
      tokenType: "",
      value: 0,
      ...overrides,
    };
  }

  test("totals from the total rows, groups from the group rows - never both", async () => {
    answer([
      row({ value: 15 }),
      row({
        metric: "claude_code.token.usage",
        tokenType: "cacheRead",
        value: 40000,
      }),
      row({
        groupKey: "g:ana@example.com",
        groupAttribute: "user.email",
        value: 12.5,
      }),
      row({
        metric: "claude_code.token.usage",
        groupKey: "g:ana@example.com",
        groupAttribute: "user.email",
        tokenType: "cacheRead",
        value: 40000,
      }),
      row({
        metric: "codex.turn.cost_microusd",
        groupKey: "g:bo@example.com",
        groupAttribute: "user.email",
        value: 2500000,
      }),
    ]);

    const usage: LlmMetricUsageResponse = await LlmMetricUsageReader.read(
      query({ dimension: LlmMetricUsageDimension.Employee }),
    );

    expect(usage.totals.costUsd).toBeCloseTo(15, 10);
    expect(usage.totals.inputTokens).toBe(40000);
    expect(
      usage.groups.map((group: { key: string }) => {
        return group.key;
      }),
    ).toEqual(["ana@example.com", "bo@example.com"]);
    expect(usage.groups[1]!.costUsd).toBeCloseTo(2.5, 10);
    expect(usage.truncated).toBe(false);
  });

  test("an ungrouped read returns no groups", async () => {
    answer([row({ value: 1 })]);

    const usage: LlmMetricUsageResponse =
      await LlmMetricUsageReader.read(query());

    expect(usage.groups).toEqual([]);
    expect(usage.totals.costUsd).toBe(1);
  });

  test("by service, each service's totals are its group", async () => {
    answer([
      row({ value: 4 }),
      row({ serviceKey: SERVICE_B.toString(), value: 6 }),
    ]);

    const usage: LlmMetricUsageResponse = await LlmMetricUsageReader.read(
      query({ dimension: LlmMetricUsageDimension.Service }),
    );

    expect(usage.totals.costUsd).toBe(10);
    expect(
      usage.groups.map((group: { key: string; costUsd: number }) => {
        return [group.key, group.costUsd];
      }),
    ).toEqual([
      [SERVICE_B.toString(), 6],
      [SERVICE_A.toString(), 4],
    ]);
  });

  test("more rows than one read returns: groups are left out, and said - never the totals", async () => {
    const rows: Array<JSONObject> = [row({ value: 7 })];

    for (let index: number = 0; index < LLM_METRIC_USAGE_MAX_ROWS; index++) {
      rows.push(
        row({
          groupKey: `g:person-${index}`,
          groupAttribute: "user.email",
          value: 1,
        }),
      );
    }

    answer(rows);

    const read: { rows: Array<LlmMetricUsageRow>; truncated: boolean } =
      await LlmMetricUsageReader.readRows(
        query({ dimension: LlmMetricUsageDimension.Employee }),
      );

    expect(read.truncated).toBe(true);
    expect(read.rows).toHaveLength(LLM_METRIC_USAGE_MAX_ROWS);

    const usage: LlmMetricUsageResponse = await LlmMetricUsageReader.read(
      query({ dimension: LlmMetricUsageDimension.Employee }),
    );

    expect(usage.truncated).toBe(true);
    expect(usage.totals.costUsd).toBe(7);
    expect(usage.groups).toHaveLength(LLM_METRIC_USAGE_MAX_ROWS - 1);
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
