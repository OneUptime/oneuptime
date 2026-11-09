import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  LlmMetricUsageDimension,
  LlmMetricUsageResponse,
} from "Common/Types/Telemetry/LlmMetricUsageApi";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { LlmTile } from "../LlmConversations/LlmSummaryTiles";
import {
  formatLlmCost,
  formatLlmCount,
  formatLlmShare,
  formatLlmTokens,
} from "../LlmConversations/LlmConversationFormat";
import { fetchLlmMetricUsage } from "./LlmObservabilityReads";

/*
 * THE TOTALS ABOVE WHO-SPENDS-WHAT.
 *
 * The calls, input and output tokens and cost for the Usage tab's range.
 * They read the GenAI spans, which are authoritative; where the span stream
 * reported nothing - a fleet of coding assistants (Claude Code, Cursor,
 * Codex, Gemini CLI) publishes token and cost METRICS and no spans - the
 * token and cost tiles fall back to the metric stream and say so. The two
 * are never added together: an emitter producing both would otherwise have
 * every token and dollar counted twice.
 *
 * The metric figures come from /telemetry/llm/metric-usage, which counts a
 * counter the way it counts: a cumulative counter (Gemini CLI's and
 * Copilot's, Claude Code's when told to) by what it grew in the range. The
 * old read added its points up - each one the running total since its
 * process started - and a fleet's week read as hundreds of thousands of
 * dollars.
 *
 * These were the Overview page's tiles. The Overview folded into
 * Conversations, which a coding-assistant fleet never fills; the Usage tab
 * is where that fleet's usage lives, so its totals live here.
 */

export interface ComponentProps {
  range: InBetween<Date>;
}

/*
 * Which signal a figure came from. "metrics" means the project emits GenAI
 * metrics but no GenAI spans for it, so the tile stands in for a number the
 * span stream cannot supply - and says so, because a metric-sourced total
 * has no matching rows in the Calls list. "failed" means the spans read
 * nothing and the metrics could not be read: the tile shows "—", never a 0
 * nobody measured.
 */
export type LlmUsageTotalsSource = "spans" | "metrics" | "none" | "failed";

export interface LlmUsageTotals {
  // null while loading, or when the read failed.
  calls: number | null;
  erroredCalls: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
  tokenSource: LlmUsageTotalsSource;
  costSource: LlmUsageTotalsSource;
}

export const EMPTY_LLM_USAGE_TOTALS: LlmUsageTotals = {
  calls: null,
  erroredCalls: null,
  inputTokens: null,
  outputTokens: null,
  cost: null,
  tokenSource: "spans",
  costSource: "spans",
};

export const LLM_METRIC_SOURCE_HINT: string =
  translationKey("from GenAI metrics");

export const LLM_METRIC_READ_FAILED_HINT: string = translationKey(
  "GenAI metrics could not be read",
);

function sumBuckets(result: AggregatedResult): number {
  return (result.data || []).reduce(
    (total: number, row: AggregatedModel): number => {
      return total + Number(row.value || 0);
    },
    0,
  );
}

export async function fetchLlmUsageTotals(
  range: InBetween<Date>,
): Promise<LlmUsageTotals> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return EMPTY_LLM_USAGE_TOTALS;
  }

  const startDate: Date = range.startValue;
  const endDate: Date = range.endValue;

  const spanQuery: Query<Span> = {
    projectId: projectId,
    isLlmSpan: true,
    startTime: new InBetween(startDate, endDate),
  };

  const safeCount: (query: Query<Span>) => Promise<number | null> = async (
    query: Query<Span>,
  ): Promise<number | null> => {
    try {
      return await AnalyticsModelAPI.count(Span, query);
    } catch {
      return null;
    }
  };

  const safeSpanSum: (column: keyof Span) => Promise<number | null> = async (
    column: keyof Span,
  ): Promise<number | null> => {
    try {
      const result: AggregatedResult = await AnalyticsModelAPI.aggregate<Span>({
        modelType: Span,
        aggregateBy: {
          // The window bounds the rows; the timestamps only pick buckets.
          query: spanQuery,
          aggregationType: AggregationType.Sum,
          aggregateColumnName: column,
          aggregationTimestampColumnName: "startTime",
          startTimestamp: startDate,
          endTimestamp: endDate,
          limit: 10000,
          skip: 0,
        } as AggregateBy<Span>,
      });

      return sumBuckets(result);
    } catch {
      return null;
    }
  };

  const [calls, erroredCalls, spanInput, spanOutput, spanCost] =
    await Promise.all([
      safeCount(spanQuery),
      safeCount({ ...spanQuery, statusCode: SpanStatus.Error }),
      safeSpanSum("llmInputTokens"),
      safeSpanSum("llmOutputTokens"),
      safeSpanSum("llmCost"),
    ]);

  let inputTokens: number | null = spanInput;
  let outputTokens: number | null = spanOutput;
  let tokenSource: LlmUsageTotalsSource = "spans";
  let cost: number | null = spanCost;
  let costSource: LlmUsageTotalsSource = "spans";

  /*
   * Only a successful-but-empty span read falls back. A null is a FAILED
   * read, and quietly substituting metrics there would dress an error up as
   * data.
   */
  if ((spanInput === 0 && spanOutput === 0) || spanCost === 0) {
    /*
     * One read for both: the metric totals, counted the way a counter
     * counts (a cumulative counter by what it grew in the range, never the
     * sum of its running totals), with Codex's millionths of a dollar
     * scaled apart from the USD counters on the server.
     */
    let usage: LlmMetricUsageResponse | null = null;

    try {
      usage = await fetchLlmMetricUsage({
        range: range,
        dimension: LlmMetricUsageDimension.None,
      });
    } catch {
      usage = null;
    }

    if (spanInput === 0 && spanOutput === 0) {
      if (!usage) {
        // Not known: "—", never a 0 nobody measured.
        inputTokens = null;
        outputTokens = null;
        tokenSource = "failed";
      } else if (
        usage.totals.hasTokens &&
        (usage.totals.inputTokens > 0 || usage.totals.outputTokens > 0)
      ) {
        inputTokens = usage.totals.inputTokens;
        outputTokens = usage.totals.outputTokens;
        tokenSource = "metrics";
      } else {
        tokenSource = "none";
      }
    }

    if (spanCost === 0) {
      if (!usage) {
        cost = null;
        costSource = "failed";
      } else if (usage.totals.hasCost && usage.totals.costUsd > 0) {
        cost = usage.totals.costUsd;
        costSource = "metrics";
      } else {
        costSource = "none";
      }
    }
  }

  return {
    calls: calls,
    erroredCalls: erroredCalls,
    inputTokens: inputTokens,
    outputTokens: outputTokens,
    cost: cost,
    tokenSource: tokenSource,
    costSource: costSource,
  };
}

const LlmUsageTotalsTiles: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [totals, setTotals] = useState<LlmUsageTotals>(EMPTY_LLM_USAGE_TOTALS);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled: boolean = false;

    setIsLoading(true);

    fetchLlmUsageTotals(props.range)
      .then((next: LlmUsageTotals) => {
        if (!cancelled) {
          setTotals(next);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTotals(EMPTY_LLM_USAGE_TOTALS);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [props.range.startValue.getTime(), props.range.endValue.getTime()]);

  const number: (
    value: number | null,
    write: (n: number) => string,
  ) => string = (
    value: number | null,
    write: (n: number) => string,
  ): string => {
    return value === null ? "—" : write(value);
  };

  const metricHint: string =
    translator.translateText(LLM_METRIC_SOURCE_HINT) || LLM_METRIC_SOURCE_HINT;
  const failedHint: string =
    translator.translateText(LLM_METRIC_READ_FAILED_HINT) ||
    LLM_METRIC_READ_FAILED_HINT;

  // What a token tile says under its figure: where it came from, or why none.
  const sourceHint: (source: LlmUsageTotalsSource) => string | undefined = (
    source: LlmUsageTotalsSource,
  ): string | undefined => {
    if (source === "metrics") {
      return metricHint;
    }

    if (source === "failed") {
      return failedHint;
    }

    return undefined;
  };

  /*
   * No call, beside tokens and cost the GenAI metrics brought: the 0 is the
   * apps' (a coding assistant's metrics count no call), and says so rather
   * than reading as a contradiction of the figures beside it.
   */
  const callsFromAppsOnly: boolean =
    totals.calls === 0 &&
    (totals.tokenSource === "metrics" || totals.costSource === "metrics");

  return (
    <div
      className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      data-testid="llm-usage-totals"
    >
      <LlmTile
        label="LLM calls"
        value={number(totals.calls, formatLlmCount)}
        hint={
          totals.calls && totals.erroredCalls !== null
            ? translator.translateTemplate("{{rate}} error rate", {
                rate: formatLlmShare(totals.erroredCalls, totals.calls),
              })
            : callsFromAppsOnly
              ? translator.translateText("AI calls come from your apps") ||
                undefined
              : undefined
        }
        icon={IconProp.Sparkles}
        iconClassName="text-violet-600"
        iconTileClassName="bg-violet-50"
        dataTestId="llm-usage-totals-calls"
        isLoading={isLoading}
      />
      <LlmTile
        label="Input tokens"
        value={number(totals.inputTokens, formatLlmTokens)}
        hint={sourceHint(totals.tokenSource)}
        icon={IconProp.ArrowDown}
        iconClassName="text-indigo-600"
        iconTileClassName="bg-indigo-50"
        dataTestId="llm-usage-totals-input"
        isLoading={isLoading}
      />
      <LlmTile
        label="Output tokens"
        value={number(totals.outputTokens, formatLlmTokens)}
        hint={sourceHint(totals.tokenSource)}
        icon={IconProp.ArrowUp}
        iconClassName="text-sky-600"
        iconTileClassName="bg-sky-50"
        dataTestId="llm-usage-totals-output"
        isLoading={isLoading}
      />
      <LlmTile
        label="Cost (USD)"
        value={number(totals.cost, formatLlmCost)}
        hint={
          sourceHint(totals.costSource) ||
          translator.translateText("when reported by SDK") ||
          undefined
        }
        icon={IconProp.CurrencyDollar}
        iconClassName="text-emerald-600"
        iconTileClassName="bg-emerald-50"
        dataTestId="llm-usage-totals-cost"
        isLoading={isLoading}
      />
    </div>
  );
};

export default LlmUsageTotalsTiles;
