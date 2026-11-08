import {
  LlmCostMetricNames,
  LlmMetricModelAttributeKeys,
  LlmMetricTeamAttributeKeys,
  LlmMetricUserAttributeKeys,
  LlmMicroUsdCostMetricNames,
  LlmTokenDirection,
  LlmTokenUsageMetricNames,
  MICRO_USD_TO_USD,
  getLlmMetricTokenDirection,
} from "../../Types/Telemetry/LlmMetricConventions";
import {
  LlmMetricUsageDimension,
  LlmMetricUsageFigures,
  LlmMetricUsageGroup,
  LlmMetricUsageResponse,
  emptyLlmMetricUsageFigures,
} from "../../Types/Telemetry/LlmMetricUsageApi";

/*
 * WHAT THE GENAI METRICS OF A RANGE ADD UP TO.
 *
 * LlmMetricUsageReader (the server) reads one row per metric, group and
 * token type: the usage its series added inside the range. This module folds
 * those rows into the figures the Usage tab and the cost budgets read - the
 * input and output tokens and the cost, in total and per group - and is
 * isomorphic, so the reader, the budget evaluator and the tests share one
 * definition of "what the metrics say":
 *
 *   - cost comes in two units: USD (LlmCostMetricNames) and millionths of
 *     a USD (LlmMicroUsdCostMetricNames, Codex), scaled here, per row,
 *     before anything is added - never summed raw;
 *   - a token row counts toward input or output by its metric AND its type
 *     (getLlmMetricTokenDirection): Claude Code's cacheRead and
 *     cacheCreation are input by the GenAI conventions' count; a type that
 *     is a superset or a subset of another (Codex's total, reasoning_output,
 *     cached_input) counts nothing, or it would be counted twice.
 *
 * Gemini CLI's gemini_cli.token.usage is not a token metric here: it counts
 * the same tokens as the gen_ai.client.token.usage it sends beside it
 * (LlmMetricConventions).
 */

export interface LlmMetricUsageRow {
  // The metric's name, as ingest stores it (lower case).
  metric: string;
  // The group's value; "" when the points name none, or nothing is grouped.
  group: string;
  // The first non-empty token type of the points; "" on cost metrics.
  tokenType: string;
  // What the series added inside the range (a delta sum, a counter's growth).
  value: number;
}

export type LlmMetricUsageKind = "usd" | "microusd" | "tokens";

const USD_NAMES: ReadonlySet<string> = new Set<string>(
  LlmCostMetricNames.map((name: string): string => {
    return name.toLowerCase();
  }),
);

const MICRO_USD_NAMES: ReadonlySet<string> = new Set<string>(
  LlmMicroUsdCostMetricNames.map((name: string): string => {
    return name.toLowerCase();
  }),
);

const TOKEN_NAMES: ReadonlySet<string> = new Set<string>(
  LlmTokenUsageMetricNames.map((name: string): string => {
    return name.toLowerCase();
  }),
);

export default class LlmMetricUsageUtil {
  // Every metric the read asks for: the cost lists and the token list.
  public static getMetricNames(): Array<string> {
    return Array.from(
      new Set<string>([...USD_NAMES, ...MICRO_USD_NAMES, ...TOKEN_NAMES]),
    );
  }

  // What a metric's points are; null for a metric this module does not read.
  public static getKind(metric: string): LlmMetricUsageKind | null {
    const name: string = (metric || "").trim().toLowerCase();

    if (USD_NAMES.has(name)) {
      return "usd";
    }

    if (MICRO_USD_NAMES.has(name)) {
      return "microusd";
    }

    if (TOKEN_NAMES.has(name)) {
      return "tokens";
    }

    return null;
  }

  /*
   * The attribute keys that name a group, preferred first: the read takes
   * the first one a point carries. [] when nothing is grouped.
   */
  public static getGroupKeys(
    dimension: LlmMetricUsageDimension,
  ): Array<string> {
    switch (dimension) {
      case LlmMetricUsageDimension.Employee:
        return [...LlmMetricUserAttributeKeys];
      case LlmMetricUsageDimension.Team:
        return [...LlmMetricTeamAttributeKeys];
      case LlmMetricUsageDimension.Model:
        return [...LlmMetricModelAttributeKeys];
      case LlmMetricUsageDimension.None:
      default:
        return [];
    }
  }

  /*
   * Add one row to a group's figures. A value that is not a finite number
   * adds nothing: these figures gate budget alerts, and one NaN would make
   * every comparison false.
   */
  public static addRow(
    figures: LlmMetricUsageFigures,
    row: LlmMetricUsageRow,
  ): void {
    const kind: LlmMetricUsageKind | null = LlmMetricUsageUtil.getKind(
      row.metric,
    );
    const value: number = Number(row.value);

    if (!kind || !Number.isFinite(value)) {
      return;
    }

    if (kind === "usd") {
      figures.costUsd += value;
      figures.hasCost = true;
      return;
    }

    if (kind === "microusd") {
      figures.costUsd += value * MICRO_USD_TO_USD;
      figures.hasCost = true;
      return;
    }

    const direction: LlmTokenDirection | null = getLlmMetricTokenDirection(
      row.metric,
      row.tokenType,
    );

    if (direction === "input") {
      figures.inputTokens += value;
      figures.hasTokens = true;
    } else if (direction === "output") {
      figures.outputTokens += value;
      figures.hasTokens = true;
    }
  }

  /*
   * The totals and, when the rows are grouped, one entry per group: largest
   * cost first, then most tokens, then by name, so the order never depends
   * on the database's row order. The unattributed group ("") is kept: it is
   * part of the total, and dropping it would make every share wrong.
   */
  public static fold(
    rows: Array<LlmMetricUsageRow>,
    options?: {
      grouped?: boolean | undefined;
      truncated?: boolean | undefined;
    },
  ): LlmMetricUsageResponse {
    const totals: LlmMetricUsageFigures = emptyLlmMetricUsageFigures();
    const groups: Map<string, LlmMetricUsageGroup> = new Map<
      string,
      LlmMetricUsageGroup
    >();

    for (const row of rows || []) {
      if (!row) {
        continue;
      }

      LlmMetricUsageUtil.addRow(totals, row);

      if (!options?.grouped) {
        continue;
      }

      const key: string = (row.group || "").trim();
      const group: LlmMetricUsageGroup = groups.get(key) || {
        ...emptyLlmMetricUsageFigures(),
        key: key,
      };

      LlmMetricUsageUtil.addRow(group, row);

      if (group.hasCost || group.hasTokens) {
        groups.set(key, group);
      }
    }

    return {
      totals: totals,
      groups: LlmMetricUsageUtil.sortGroups(Array.from(groups.values())),
      truncated: Boolean(options?.truncated),
    };
  }

  public static sortGroups(
    groups: Array<LlmMetricUsageGroup>,
  ): Array<LlmMetricUsageGroup> {
    return [...groups].sort(
      (a: LlmMetricUsageGroup, b: LlmMetricUsageGroup): number => {
        if (b.costUsd !== a.costUsd) {
          return b.costUsd - a.costUsd;
        }

        const aTokens: number = a.inputTokens + a.outputTokens;
        const bTokens: number = b.inputTokens + b.outputTokens;

        if (bTokens !== aTokens) {
          return bTokens - aTokens;
        }

        return a.key.localeCompare(b.key);
      },
    );
  }
}
