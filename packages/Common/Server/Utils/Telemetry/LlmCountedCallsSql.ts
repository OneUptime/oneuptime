import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import ObjectID from "../../../Types/ObjectID";
import { LlmCallKind } from "../../../Types/Telemetry/LlmCallKind";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import TelemetryReadScopeUtil, {
  TelemetryServiceFilter,
} from "./TelemetryReadScope";

/*
 * EACH MODEL CALL COUNTED ONCE, IN CLICKHOUSE.
 *
 * The rule of Common/Utils/Telemetry/LlmCallCounting.ts, for the reads that
 * add AI calls up in the database: the Usage tab, the cost budgets and the
 * conversation list. A span's tokens, or its cost, each on its own, are not
 * counted when
 *
 *   (a) one of its direct child AI calls reports that figure, or
 *   (b) it is an agent run (llmCallKind 'agent') and a call that is not one
 *       reports the figure and starts within the run's time, in the same
 *       trace.
 *
 * As SQL, a call's figure is covered when
 *
 *   cityHash64(traceId, spanId, figure) IN (children)
 *     OR (llmCallKind = 'agent' AND cityHash64(traceId, spanId, figure) IN (runs))
 *
 * where `children` hashes (traceId, parentSpanId, figure) of every call that
 * reports a figure, and `runs` hashes the agent runs a reporting call
 * starts inside (a join of the runs to the calls of their traces: only
 * traces that hold a run reporting a figure). Hashes, not the ids
 * themselves: a set of 8-byte numbers, about a tenth of the ids' size, for
 * the reads that span a busy week. A collision would take one span's
 * figure out of a sum: with 64 bits, about one in a hundred billion pairs.
 *
 * The calls inside a wrapper are looked for in a window a little wider
 * than the read's: a run that started in the range can make calls after
 * its end, and a child can start a moment before its parent on another
 * machine's clock. Only the project and the reader's own scope narrow
 * them, never the read's filters: a budget on one service still sees that
 * its agent run's calls were made, and counted, by another.
 *
 * Every subquery reads AI calls of one project between two times - the
 * Span table's sort key - so each is bounded like the read it is part of.
 *
 * A read that counts several figures repeats the two sets, word for word:
 * ClickHouse builds a set once per query for every IN whose subquery is the
 * same, under both analyzers - so the sets cost the same for four figures
 * as for one. A figure is expanded with the arrayJoin() FUNCTION, never an
 * ARRAY JOIN clause: the current analyzer builds a set whose subquery has an
 * ARRAY JOIN clause once per IN that uses it (on 26.7, four figures read 3.4
 * times the rows of one). LlmUsageCountingClickhouse checks it on a real
 * server: the same rows read for one figure as for four.
 */

export enum LlmCallFigure {
  Tokens = "tokens",
  Cost = "cost",
}

export interface LlmCountedCallsScope extends TelemetryServiceFilter {
  projectId: ObjectID;
  // The read's range: the calls it adds up started in it.
  startTime: Date;
  endTime: Date;
}

// How far before the range a call inside a wrapper may start (clock skew).
export const LLM_CARRIER_WINDOW_BEFORE_MS: number = 10 * 60 * 1000;

// How far after the range a call inside a wrapper may start (a long run).
export const LLM_CARRIER_WINDOW_AFTER_MS: number = 6 * 60 * 60 * 1000;

const TABLE_NAME: string = AnalyticsTableName.Span;

// The tags a figure is hashed with, so one set holds both figures.
const FIGURE_TAGS: Record<LlmCallFigure, string> = {
  [LlmCallFigure.Tokens]: "t",
  [LlmCallFigure.Cost]: "c",
};

export const LLM_CARRIES_TOKENS_SQL: string =
  "(llmInputTokens > 0 OR llmOutputTokens > 0 OR llmTotalTokens > 0)";

export const LLM_CARRIES_COST_SQL: string = "llmCost > 0";

const CARRIES_ANY_SQL: string = `(${LLM_CARRIES_TOKENS_SQL} OR ${LLM_CARRIES_COST_SQL})`;

// The figures a call reports, as tags: one row per figure under arrayJoin().
const FIGURES_CARRIED_SQL: string = `arrayFilter(carriedTag -> carriedTag != '', [if(${LLM_CARRIES_TOKENS_SQL}, '${FIGURE_TAGS[LlmCallFigure.Tokens]}', ''), if(${LLM_CARRIES_COST_SQL}, '${FIGURE_TAGS[LlmCallFigure.Cost]}', '')])`;

const AGENT_SQL: string = `'${LlmCallKind.Agent}'`;

// A span's figure columns, and the figure each one is.
export type LlmFigureColumn =
  | "llmInputTokens"
  | "llmOutputTokens"
  | "llmTotalTokens"
  | "llmCost";

const FIGURE_COLUMNS: Record<LlmFigureColumn, LlmCallFigure> = {
  llmInputTokens: LlmCallFigure.Tokens,
  llmOutputTokens: LlmCallFigure.Tokens,
  llmTotalTokens: LlmCallFigure.Tokens,
  llmCost: LlmCallFigure.Cost,
};

export default class LlmCountedCallsSql {
  // Where the calls inside a wrapper are looked for.
  public static getCarrierWindow(scope: LlmCountedCallsScope): {
    startTime: Date;
    endTime: Date;
  } {
    return {
      startTime: new Date(
        scope.startTime.getTime() - LLM_CARRIER_WINDOW_BEFORE_MS,
      ),
      endTime: new Date(scope.endTime.getTime() + LLM_CARRIER_WINDOW_AFTER_MS),
    };
  }

  // ` WHERE` over the AI calls of the carrier window that report a figure.
  private static appendCarrierWhere(
    statement: Statement,
    scope: LlmCountedCallsScope,
  ): void {
    const window: { startTime: Date; endTime: Date } =
      LlmCountedCallsSql.getCarrierWindow(scope);

    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: scope.projectId,
      }} AND isLlmSpan = 1 AND startTime >= ${{
        type: TableColumnType.DateTime64,
        value: window.startTime,
      }} AND startTime <= ${{
        type: TableColumnType.DateTime64,
        value: window.endTime,
      }} AND retentionDate >= now()`,
    );

    TelemetryReadScopeUtil.appendServiceFilter(statement, {
      serviceIds: scope.serviceIds,
      excludedServiceIds: scope.excludedServiceIds,
    });

    statement.append(` AND ${CARRIES_ANY_SQL}`);
  }

  /*
   * (a): (traceId, parentSpanId, figure) of every call that reports a
   * figure and has a parent.
   */
  public static buildChildrenSet(scope: LlmCountedCallsScope): Statement {
    const statement: Statement = new Statement();

    statement.append(
      `SELECT cityHash64(traceId, ifNull(parentSpanId, ''), arrayJoin(${FIGURES_CARRIED_SQL})) FROM ${TABLE_NAME}`,
    );
    LlmCountedCallsSql.appendCarrierWhere(statement, scope);
    statement.append(
      " AND ifNull(parentSpanId, '') != '' AND ifNull(parentSpanId, '') != spanId",
    );

    return statement;
  }

  /*
   * (b): (traceId, spanId, figure) of every agent run that a call - not an
   * agent run - reporting the figure starts inside. The runs are the right
   * side of the join, which ClickHouse holds in memory: there are fewer
   * runs than calls. The calls are read only from traces that hold a run.
   */
  public static buildRunsSet(scope: LlmCountedCallsScope): Statement {
    const statement: Statement = new Statement();

    statement.append(
      `SELECT cityHash64(runTraceId, runSpanId, runFigure) FROM (SELECT cityHash64(traceId) AS innerTraceHash, startTimeUnixNano AS innerStart, arrayJoin(${FIGURES_CARRIED_SQL}) AS innerFigure FROM ${TABLE_NAME}`,
    );
    LlmCountedCallsSql.appendCarrierWhere(statement, scope);
    statement.append(
      ` AND llmCallKind != ${AGENT_SQL} AND cityHash64(traceId) IN (SELECT cityHash64(traceId) FROM ${TABLE_NAME}`,
    );
    LlmCountedCallsSql.appendCarrierWhere(statement, scope);
    statement.append(
      ` AND llmCallKind = ${AGENT_SQL})) AS innerCall INNER JOIN (SELECT cityHash64(traceId) AS runTraceHash, traceId AS runTraceId, spanId AS runSpanId, startTimeUnixNano AS runStart, endTimeUnixNano AS runEnd, arrayJoin(${FIGURES_CARRIED_SQL}) AS runFigure FROM ${TABLE_NAME}`,
    );
    LlmCountedCallsSql.appendCarrierWhere(statement, scope);
    statement.append(
      ` AND llmCallKind = ${AGENT_SQL}) AS agentRun ON innerCall.innerTraceHash = agentRun.runTraceHash AND innerCall.innerFigure = agentRun.runFigure WHERE innerCall.innerStart >= agentRun.runStart AND innerCall.innerStart <= agentRun.runEnd`,
    );

    return statement;
  }

  /*
   * Whether the row's figure is reported by the calls inside it: a boolean
   * over the row's own traceId, spanId and llmCallKind.
   */
  public static buildCoveredCondition(
    scope: LlmCountedCallsScope,
    figure: LlmCallFigure,
  ): Statement {
    const tag: string = FIGURE_TAGS[figure];
    const statement: Statement = new Statement();

    statement.append(`(cityHash64(traceId, spanId, '${tag}') IN (`);
    statement.append(LlmCountedCallsSql.buildChildrenSet(scope));
    statement.append(
      `) OR (llmCallKind = ${AGENT_SQL} AND cityHash64(traceId, spanId, '${tag}') IN (`,
    );
    statement.append(LlmCountedCallsSql.buildRunsSet(scope));
    statement.append(")))");

    return statement;
  }

  /*
   * `if(<covered>, 0, column)`: the column's value when the row counts it,
   * else 0. The column is one of the span's figure columns.
   */
  public static buildCountedColumn(
    scope: LlmCountedCallsScope,
    column: LlmFigureColumn,
  ): Statement {
    const statement: Statement = new Statement();

    statement.append("if(");
    statement.append(
      LlmCountedCallsSql.buildCoveredCondition(scope, FIGURE_COLUMNS[column]),
    );
    statement.append(`, 0, ${column})`);

    return statement;
  }
}
