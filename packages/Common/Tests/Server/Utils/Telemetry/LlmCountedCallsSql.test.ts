import { describe, expect, test } from "@jest/globals";
import LlmCountedCallsSql, {
  LLM_CARRIER_WINDOW_AFTER_MS,
  LLM_CARRIER_WINDOW_BEFORE_MS,
  LlmCallFigure,
  LlmCountedCallsScope,
} from "../../../../Server/Utils/Telemetry/LlmCountedCallsSql";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";

/*
 * EACH MODEL CALL COUNTED ONCE, IN CLICKHOUSE - WITHOUT A SERVER.
 *
 * App/Tests/Telemetry/LlmUsageCountingClickhouse.test.ts runs these
 * conditions against a real ClickHouse, under both analyzers, with agent
 * runs, wrappers and double instrumentation. These pin what a reader of
 * the SQL would otherwise re-derive: the two sets (a span's direct
 * children, an agent run's calls inside its time) per figure, the window
 * the carriers are looked for in, that only the project and the reader's
 * scope narrow them, and that every subquery is bounded by the Span
 * table's sort key.
 */

const PROJECT: ObjectID = new ObjectID("9900000000000000000000a1");
const SERVICE_A: ObjectID = new ObjectID("9900000000000000000000b1");
const SERVICE_B: ObjectID = new ObjectID("9900000000000000000000b2");
const START: Date = new Date("2026-11-02T00:00:00.000Z");
const END: Date = new Date("2026-11-09T00:00:00.000Z");

function scope(
  overrides: Partial<LlmCountedCallsScope> = {},
): LlmCountedCallsScope {
  return {
    projectId: PROJECT,
    startTime: START,
    endTime: END,
    ...overrides,
  };
}

// The figures a call reports, as the sets expand them: one row per figure.
const FIGURES_CARRIED: string =
  "arrayFilter(carriedTag -> carriedTag != '', [if((llmInputTokens > 0 OR llmOutputTokens > 0 OR llmTotalTokens > 0), 't', ''), if(llmCost > 0, 'c', '')])";

function values(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

function count(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe("the window the calls inside a wrapper are looked for in", () => {
  test("a little before the range (clock skew) and well after it (a long run)", () => {
    expect(LLM_CARRIER_WINDOW_BEFORE_MS).toBe(10 * 60 * 1000);
    expect(LLM_CARRIER_WINDOW_AFTER_MS).toBe(6 * 60 * 60 * 1000);
    expect(LlmCountedCallsSql.getCarrierWindow(scope())).toEqual({
      startTime: new Date("2026-11-01T23:50:00.000Z"),
      endTime: new Date("2026-11-09T06:00:00.000Z"),
    });
  });
});

describe("(a) the direct children that report a figure", () => {
  const statement: Statement = LlmCountedCallsSql.buildChildrenSet(scope());
  const sql: string = statement.query;

  test("hashes each carrier's trace, parent and figure", () => {
    expect(sql).toContain(
      `SELECT cityHash64(traceId, ifNull(parentSpanId, ''), arrayJoin(${FIGURES_CARRIED})) FROM SpanItemV3 WHERE `,
    );
  });

  test("expands the figures with arrayJoin(), so ClickHouse builds the set once per query", () => {
    expect(sql).not.toContain("ARRAY JOIN");
  });

  test("only the AI calls of the project, in the window, that report a figure and have a parent", () => {
    const window: { startTime: Date; endTime: Date } =
      LlmCountedCallsSql.getCarrierWindow(scope());

    expect(sql).toMatch(
      / WHERE projectId = \{p\d+:\w+\} AND isLlmSpan = 1 AND startTime >= /,
    );
    expect(sql).toContain("AND retentionDate >= now()");
    expect(values(statement)).toContain(PROJECT.toString());
    expect(values(statement)).toContain(
      OneUptimeDate.toClickhouseDateTime64(window.startTime),
    );
    expect(values(statement)).toContain(
      OneUptimeDate.toClickhouseDateTime64(window.endTime),
    );
    expect(sql).toContain(
      " AND ((llmInputTokens > 0 OR llmOutputTokens > 0 OR llmTotalTokens > 0) OR llmCost > 0)",
    );
    expect(sql).toContain(
      " AND ifNull(parentSpanId, '') != '' AND ifNull(parentSpanId, '') != spanId",
    );
  });
});

describe("(b) the agent runs a call starts inside", () => {
  const statement: Statement = LlmCountedCallsSql.buildRunsSet(scope());
  const sql: string = statement.query;

  test("a call that is not a run, joined to the runs of its trace, per figure", () => {
    expect(sql).toContain(
      `SELECT cityHash64(runTraceId, runSpanId, runFigure) FROM (SELECT cityHash64(traceId) AS innerTraceHash, startTimeUnixNano AS innerStart, arrayJoin(${FIGURES_CARRIED}) AS innerFigure FROM SpanItemV3 WHERE `,
    );
    expect(sql).toContain(
      " AND llmCallKind != 'agent' AND cityHash64(traceId) IN (SELECT cityHash64(traceId) FROM SpanItemV3",
    );
    expect(sql).toContain(
      `) AS innerCall INNER JOIN (SELECT cityHash64(traceId) AS runTraceHash, traceId AS runTraceId, spanId AS runSpanId, startTimeUnixNano AS runStart, endTimeUnixNano AS runEnd, arrayJoin(${FIGURES_CARRIED}) AS runFigure FROM SpanItemV3 WHERE `,
    );
    // An ARRAY JOIN clause would make the current analyzer build the set once per IN.
    expect(sql).not.toContain("ARRAY JOIN");
    expect(sql).toContain(
      " ON innerCall.innerTraceHash = agentRun.runTraceHash AND innerCall.innerFigure = agentRun.runFigure",
    );
  });

  test("the call starts within the run's time, its ends included", () => {
    expect(sql).toContain(
      " WHERE innerCall.innerStart >= agentRun.runStart AND innerCall.innerStart <= agentRun.runEnd",
    );
  });

  test("each of its three reads is bounded by the project and the window", () => {
    expect(count(sql, "WHERE projectId = ")).toBe(3);
    expect(count(sql, "AND startTime >= ")).toBe(3);
    expect(count(sql, "AND startTime <= ")).toBe(3);
    expect(count(sql, "AND retentionDate >= now()")).toBe(3);
  });
});

describe("whether a row's figure is covered", () => {
  test("tokens and cost each have their own tag", () => {
    const tokens: string = LlmCountedCallsSql.buildCoveredCondition(
      scope(),
      LlmCallFigure.Tokens,
    ).query;
    const cost: string = LlmCountedCallsSql.buildCoveredCondition(
      scope(),
      LlmCallFigure.Cost,
    ).query;

    expect(tokens).toMatch(
      /^\(cityHash64\(traceId, spanId, 't'\) IN \(SELECT /,
    );
    expect(tokens).toContain(
      ") OR (llmCallKind = 'agent' AND cityHash64(traceId, spanId, 't') IN (SELECT ",
    );
    expect(cost).toMatch(/^\(cityHash64\(traceId, spanId, 'c'\) IN \(SELECT /);
    expect(cost).toContain(
      ") OR (llmCallKind = 'agent' AND cityHash64(traceId, spanId, 'c') IN (SELECT ",
    );
  });

  test("a column counted: its value, or 0 when the calls inside report it", () => {
    const input: string = LlmCountedCallsSql.buildCountedColumn(
      scope(),
      "llmInputTokens",
    ).query;
    const cost: string = LlmCountedCallsSql.buildCountedColumn(
      scope(),
      "llmCost",
    ).query;

    expect(input).toMatch(/^if\(\(cityHash64\(traceId, spanId, 't'\) IN /);
    expect(input).toMatch(/, 0, llmInputTokens\)$/);
    expect(cost).toMatch(/^if\(\(cityHash64\(traceId, spanId, 'c'\) IN /);
    expect(cost).toMatch(/, 0, llmCost\)$/);
  });

  test("the totals count tokens, never cost", () => {
    expect(
      LlmCountedCallsSql.buildCountedColumn(scope(), "llmTotalTokens").query,
    ).toContain("cityHash64(traceId, spanId, 't')");
    expect(
      LlmCountedCallsSql.buildCountedColumn(scope(), "llmOutputTokens").query,
    ).not.toContain("cityHash64(traceId, spanId, 'c')");
  });
});

describe("what narrows the carriers", () => {
  /*
   * The reader may read some services only: the calls it may not read are
   * not looked at, in the sets as in the sums.
   */
  test("the reader's own scope, in every read", () => {
    const statement: Statement = LlmCountedCallsSql.buildCoveredCondition(
      scope({ serviceIds: [SERVICE_A], excludedServiceIds: [SERVICE_B] }),
      LlmCallFigure.Cost,
    );

    // One children set and one runs set (three reads): four WHEREs.
    expect(count(statement.query, "AND primaryEntityId IN (")).toBe(4);
    expect(count(statement.query, "AND primaryEntityId NOT IN (")).toBe(4);
    expect(values(statement)).toContainEqual([SERVICE_A.toString()]);
    expect(values(statement)).toContainEqual([SERVICE_B.toString()]);
  });

  test("no scope: every service of the project", () => {
    const sql: string = LlmCountedCallsSql.buildCoveredCondition(
      scope(),
      LlmCallFigure.Tokens,
    ).query;

    expect(sql).not.toContain("primaryEntityId");
  });
});
