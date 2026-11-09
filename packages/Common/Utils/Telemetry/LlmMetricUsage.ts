import {
  LlmCostMetricNames,
  LlmMetricModelAttributeKeys,
  LlmMetricProviderAttributeKeys,
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
import { normalizeLlmProvider } from "../../Types/Telemetry/LlmProviders";

/*
 * WHAT THE GENAI METRICS OF A RANGE ADD UP TO.
 *
 * LlmMetricUsageReader (the server) reads one row per metric, service,
 * group and token type: the usage its series added inside the range, with
 * each service's total rows apart from its group rows, so a total is exact
 * even when the group rows are cut short. This module folds those rows into
 * the figures the Usage tab and the cost budgets read - the input and
 * output tokens and the cost, in total, per service and per group - and is
 * isomorphic, so the readers (LlmMetricUsageReader, LlmUsageReader) and the
 * tests share one definition of "what the metrics say":
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
  /*
   * The service (primaryEntityId) the points belong to - the OneUptime
   * service their resource's service.name named, or the project's id for
   * points that named none ("Unknown Service"). "" when not read.
   */
  service?: string | undefined;
  /*
   * true on a service's total row, false on a group's row. A row that says
   * neither (a fold of rows built by hand) is both.
   */
  isTotal?: boolean | undefined;
  /*
   * The attribute key the group's value was read from (user.email,
   * cursor.user.id, ...); "" when none or nothing is grouped. A reader that
   * names people at read time (a Cursor team's member ids) finds the rows
   * to rename by it.
   */
  groupAttribute?: string | undefined;
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
      case LlmMetricUsageDimension.Provider:
        return [...LlmMetricProviderAttributeKeys];
      /*
       * A service is not an attribute: it is the points' primaryEntityId,
       * which every row carries (LlmMetricUsageRow.service).
       */
      case LlmMetricUsageDimension.Service:
      case LlmMetricUsageDimension.None:
      default:
        return [];
    }
  }

  /*
   * A group's value as the Usage tab names it: trimmed, and a provider
   * named the way ingest names a span's (azure.ai.openai, never
   * az.ai.openai or OpenAI), so a provider's metrics and its calls are one
   * row.
   */
  public static normalizeGroup(
    dimension: LlmMetricUsageDimension,
    value: string,
  ): string {
    const trimmed: string = (value || "").trim();

    if (dimension === LlmMetricUsageDimension.Provider && trimmed) {
      return normalizeLlmProvider({ reported: trimmed });
    }

    return trimmed;
  }

  // Whether a row counts toward a service's or the read's totals.
  public static isTotalRow(row: LlmMetricUsageRow): boolean {
    return row.isTotal !== false;
  }

  // Whether a row counts toward a group.
  public static isGroupRow(row: LlmMetricUsageRow): boolean {
    return row.isTotal !== true;
  }

  /*
   * Each service's figures, from its total rows. Rows of no service fold
   * under "".
   */
  public static foldByService(
    rows: Array<LlmMetricUsageRow>,
  ): Map<string, LlmMetricUsageFigures> {
    const services: Map<string, LlmMetricUsageFigures> = new Map<
      string,
      LlmMetricUsageFigures
    >();

    for (const row of rows || []) {
      if (!row || !LlmMetricUsageUtil.isTotalRow(row)) {
        continue;
      }

      const service: string = (row.service || "").trim();
      const figures: LlmMetricUsageFigures =
        services.get(service) || emptyLlmMetricUsageFigures();

      LlmMetricUsageUtil.addRow(figures, row);
      services.set(service, figures);
    }

    return services;
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
      // Group by `dimension`; with no dimension, by the rows' group values.
      grouped?: boolean | undefined;
      dimension?: LlmMetricUsageDimension | undefined;
      truncated?: boolean | undefined;
    },
  ): LlmMetricUsageResponse {
    const totals: LlmMetricUsageFigures = emptyLlmMetricUsageFigures();
    const groups: Map<string, LlmMetricUsageGroup> = new Map<
      string,
      LlmMetricUsageGroup
    >();
    const dimension: LlmMetricUsageDimension | undefined = options?.dimension;
    const grouped: boolean = dimension
      ? dimension !== LlmMetricUsageDimension.None
      : Boolean(options?.grouped);
    const byService: boolean = dimension === LlmMetricUsageDimension.Service;

    for (const row of rows || []) {
      if (!row) {
        continue;
      }

      if (LlmMetricUsageUtil.isTotalRow(row)) {
        LlmMetricUsageUtil.addRow(totals, row);
      }

      /*
       * By service, a group is a service's total; by anything else, a
       * group's row.
       */
      if (
        !grouped ||
        (byService
          ? !LlmMetricUsageUtil.isTotalRow(row)
          : !LlmMetricUsageUtil.isGroupRow(row))
      ) {
        continue;
      }

      const key: string = byService
        ? (row.service || "").trim()
        : dimension
          ? LlmMetricUsageUtil.normalizeGroup(dimension, row.group)
          : (row.group || "").trim();
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
