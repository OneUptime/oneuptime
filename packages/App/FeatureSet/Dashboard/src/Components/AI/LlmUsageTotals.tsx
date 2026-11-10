import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  LlmUsageDimension,
  LlmUsageFigures,
  LlmUsageResponse,
  LlmUsageSource,
} from "Common/Types/Telemetry/LlmUsageApi";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { LlmTile } from "../LlmConversations/LlmSummaryTiles";
import {
  formatLlmCost,
  formatLlmCount,
  formatLlmShare,
  formatLlmTokens,
} from "../LlmConversations/LlmConversationFormat";
import { fetchLlmUsage } from "./LlmObservabilityReads";
import {
  LLM_USAGE_SOURCE_WORDS,
  isFromUsageMetrics,
} from "./LlmUsageSourceCopy";

/*
 * THE TOTALS ABOVE WHO-SPENDS-WHAT.
 *
 * The calls, input and output tokens and cost for the Usage tab's range, in
 * one read of /telemetry/llm/usage: the AI calls the apps send (GenAI
 * spans), each model call once, and the usage metrics the coding tools send
 * (GenAI metrics), each service counted from the signal it sends - never
 * both for one service, and never one signal for the whole project, so a
 * coding tool's metrics count beside the apps' calls (LlmUsageReader).
 *
 * Each figure says where it came from: from AI calls, from usage metrics,
 * or from both (some services' calls and other services' metrics). A read
 * that fails shows "—" and says it could not be loaded, never a 0 nobody
 * measured.
 *
 * These were the Overview page's tiles. The Overview folded into
 * Conversations, which a coding-assistant fleet never fills; the Usage tab
 * is where that fleet's usage lives, so its totals live here.
 */

export interface ComponentProps {
  range: InBetween<Date>;
}

export interface LlmUsageTotals {
  // null while loading, or when the read failed.
  figures: LlmUsageFigures | null;
  failed: boolean;
}

export const EMPTY_LLM_USAGE_TOTALS: LlmUsageTotals = {
  figures: null,
  failed: false,
};

export async function fetchLlmUsageTotals(
  range: InBetween<Date>,
): Promise<LlmUsageTotals> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return EMPTY_LLM_USAGE_TOTALS;
  }

  try {
    const usage: LlmUsageResponse = await fetchLlmUsage({
      range: range,
      dimension: LlmUsageDimension.None,
    });

    return { figures: usage.totals, failed: false };
  } catch {
    // Not known: "—", never a 0 nobody measured.
    return { figures: null, failed: true };
  }
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
          setTotals({ figures: null, failed: true });
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [props.range.startValue.getTime(), props.range.endValue.getTime()]);

  const figures: LlmUsageFigures | null = totals.figures;

  const number: (
    value: number | undefined,
    write: (n: number) => string,
  ) => string = (
    value: number | undefined,
    write: (n: number) => string,
  ): string => {
    return value === undefined ? "—" : write(value);
  };

  // Where a figure came from, in the reader's words; nothing when none.
  const sourceHint: (
    source: LlmUsageSource | undefined,
  ) => string | undefined = (
    source: LlmUsageSource | undefined,
  ): string | undefined => {
    const words: string = source ? LLM_USAGE_SOURCE_WORDS[source] : "";

    return words ? translator.translateText(words) || words : undefined;
  };

  // A failed read: each "—" says why.
  const failedHint: string | undefined = totals.failed
    ? translator.translateText("Could not be loaded") || undefined
    : undefined;

  /*
   * No call, beside tokens and cost the usage metrics brought: the 0 is the
   * apps' (a coding assistant's metrics count no call), and says so rather
   * than reading as a contradiction of the figures beside it.
   */
  const callsFromAppsOnly: boolean = Boolean(
    figures &&
      figures.calls === 0 &&
      (isFromUsageMetrics(figures.tokenSource) ||
        isFromUsageMetrics(figures.costSource)),
  );

  /*
   * A figure nothing reported, beside usage that is there: calls whose
   * model has no price report no cost, a tool's metrics may count cost and
   * no tokens. It is "—" and says so, never a 0 that claims the usage was
   * free. With no usage at all, the 0s are simply true, and say nothing.
   */
  const tokensNotReported: boolean = Boolean(
    figures &&
      figures.tokenSource === LlmUsageSource.None &&
      (figures.calls > 0 || figures.costSource !== LlmUsageSource.None),
  );
  const costNotReported: boolean = Boolean(
    figures &&
      figures.costSource === LlmUsageSource.None &&
      (figures.calls > 0 || figures.tokenSource !== LlmUsageSource.None),
  );

  const tokenHint: string | undefined = tokensNotReported
    ? translator.translateText("No tokens reported") || undefined
    : sourceHint(figures?.tokenSource) || failedHint;

  return (
    <div
      className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      data-testid="llm-usage-totals"
    >
      <LlmTile
        label="AI calls"
        value={number(figures?.calls, formatLlmCount)}
        hint={
          figures && figures.calls > 0
            ? translator.translateTemplate("{{rate}} error rate", {
                rate: formatLlmShare(figures.erroredCalls, figures.calls),
              })
            : callsFromAppsOnly
              ? translator.translateText("AI calls come from your apps") ||
                undefined
              : failedHint
        }
        // "...from your apps" is what the hint says: never cut short.
        wrapHint={true}
        icon={IconProp.Sparkles}
        iconClassName="text-violet-600"
        iconTileClassName="bg-violet-50"
        dataTestId="llm-usage-totals-calls"
        isLoading={isLoading}
      />
      <LlmTile
        label="Input tokens"
        value={
          tokensNotReported
            ? "—"
            : number(figures?.inputTokens, formatLlmTokens)
        }
        hint={tokenHint}
        wrapHint={true}
        icon={IconProp.ArrowDown}
        iconClassName="text-indigo-600"
        iconTileClassName="bg-indigo-50"
        dataTestId="llm-usage-totals-input"
        isLoading={isLoading}
      />
      <LlmTile
        label="Output tokens"
        value={
          tokensNotReported
            ? "—"
            : number(figures?.outputTokens, formatLlmTokens)
        }
        hint={tokenHint}
        wrapHint={true}
        icon={IconProp.ArrowUp}
        iconClassName="text-sky-600"
        iconTileClassName="bg-sky-50"
        dataTestId="llm-usage-totals-output"
        isLoading={isLoading}
      />
      <LlmTile
        label="Cost (USD)"
        value={costNotReported ? "—" : number(figures?.costUsd, formatLlmCost)}
        hint={
          costNotReported
            ? translator.translateText("No cost reported") || undefined
            : sourceHint(figures?.costSource) || failedHint
        }
        wrapHint={true}
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
