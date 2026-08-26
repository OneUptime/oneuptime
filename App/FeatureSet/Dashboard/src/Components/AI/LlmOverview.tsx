import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import Metric from "Common/Models/AnalyticsModels/Metric";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import { LlmTokenTypeAttributeKeys } from "Common/Types/Telemetry/LlmMetricConventions";
import LlmMetricQuery, {
  LlmMetricScope,
  LlmMetricTokenTotals,
} from "Common/Utils/Telemetry/LlmMetricQuery";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import ProjectUtil from "Common/UI/Utils/Project";
import Icon from "Common/UI/Components/Icon/Icon";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import IconProp from "Common/Types/Icon/IconProp";
import StartAndEndDate, {
  StartAndEndDateType,
} from "Common/UI/Components/Date/StartAndEndDate";
import LlmCallsTable from "./LlmCallsTable";

const DEFAULT_WINDOW_DAYS: number = 7;

/*
 * Which signal a figure came from. Spans are authoritative and carry the
 * per-call detail; "metrics" means this project emits GenAI metrics but no
 * GenAI spans, so the tile is standing in for a number the span stream cannot
 * supply. Surfacing it matters — a metric-sourced token total has no matching
 * rows in the LLM Calls list below, and an unlabelled tile would read as a
 * contradiction.
 */
type KpiSource = "spans" | "metrics" | "none";

const METRIC_SOURCE_HINT: string = "from GenAI metrics";

interface Kpis {
  totalCalls: number | null;
  erroredCalls: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
  tokenSource: KpiSource;
  costSource: KpiSource;
}

const EMPTY_KPIS: Kpis = {
  totalCalls: null,
  erroredCalls: null,
  inputTokens: null,
  outputTokens: null,
  cost: null,
  tokenSource: "spans",
  costSource: "spans",
};

function sumBuckets(result: AggregatedResult): number {
  return (result.data || []).reduce(
    (acc: number, row: AggregatedModel): number => {
      return acc + Number(row.value || 0);
    },
    0,
  );
}

/*
 * Thin wrapper over the shared InfoCard so every stat tile in the product
 * (Home overview, monitor summaries, AI task outcomes) reads the same.
 */
const KpiCard: FunctionComponent<{
  label: string;
  value: string;
  hint?: string | undefined;
}> = (props: {
  label: string;
  value: string;
  hint?: string | undefined;
}): ReactElement => {
  return (
    <InfoCard
      title={props.label}
      value={
        <div className="mt-1">
          <div className="text-2xl font-semibold text-gray-900">
            {props.value}
          </div>
          {props.hint ? (
            <div className="mt-1 text-sm text-gray-500">{props.hint}</div>
          ) : null}
        </div>
      }
    />
  );
};

const LlmOverview: FunctionComponent = (): ReactElement => {
  const [kpis, setKpis] = useState<Kpis>(EMPTY_KPIS);

  const [range, setRange] = useState<InBetween<Date>>(() => {
    return new InBetween<Date>(
      OneUptimeDate.getSomeDaysAgo(DEFAULT_WINDOW_DAYS),
      OneUptimeDate.getCurrentDate(),
    );
  });

  useEffect(() => {
    let cancelled: boolean = false;

    // Reset to the loading state ("—") whenever the selected range changes.
    setKpis(EMPTY_KPIS);

    const load: () => Promise<void> = async (): Promise<void> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      if (!projectId) {
        return;
      }

      const startDate: Date = range.startValue;
      const endDate: Date = range.endValue;

      const baseQuery: Query<Span> = {
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

      const safeSum: (column: keyof Span) => Promise<number | null> = async (
        column: keyof Span,
      ): Promise<number | null> => {
        try {
          const result: AggregatedResult =
            await AnalyticsModelAPI.aggregate<Span>({
              modelType: Span,
              aggregateBy: {
                query: {
                  projectId: projectId,
                  isLlmSpan: true,
                  /*
                   * Bound rows to the window (startTimestamp/endTimestamp only
                   * pick the bucket interval, they do not filter rows).
                   */
                  startTime: new InBetween(startDate, endDate),
                },
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

      const metricScope: LlmMetricScope = {
        projectId: projectId,
        startTime: startDate,
        endTime: endDate,
      };

      /*
       * Metric-sourced fallbacks, mirroring LlmCostBudgetEvaluator.resolveSpend
       * on the server: spans are authoritative, and metrics are consulted only
       * when the span stream reported nothing. Never summed — an SDK that emits
       * both signals would otherwise be counted twice.
       */
      const safeMetricCost: () => Promise<number | null> = async (): Promise<
        number | null
      > => {
        try {
          const result: AggregatedResult =
            await AnalyticsModelAPI.aggregate<Metric>({
              modelType: Metric,
              aggregateBy: {
                query: LlmMetricQuery.buildCostQuery(metricScope),
                aggregationType: AggregationType.Sum,
                aggregateColumnName: "value",
                aggregationTimestampColumnName: "time",
                startTimestamp: startDate,
                endTimestamp: endDate,
                aggregationInterval: AggregationInterval.Total,
                limit: 10000,
                skip: 0,
              } as AggregateBy<Metric>,
            });
          return LlmMetricQuery.sumAggregatedRows(result.data);
        } catch {
          return null;
        }
      };

      const safeMetricTokens: () => Promise<LlmMetricTokenTotals | null> =
        async (): Promise<LlmMetricTokenTotals | null> => {
          try {
            const result: AggregatedResult =
              await AnalyticsModelAPI.aggregate<Metric>({
                modelType: Metric,
                aggregateBy: {
                  query: LlmMetricQuery.buildTokenQuery(metricScope),
                  aggregationType: AggregationType.Sum,
                  aggregateColumnName: "value",
                  aggregationTimestampColumnName: "time",
                  startTimestamp: startDate,
                  endTimestamp: endDate,
                  aggregationInterval: AggregationInterval.Total,
                  groupByAttributeKeys: [...LlmTokenTypeAttributeKeys],
                  limit: 10000,
                  skip: 0,
                } as AggregateBy<Metric>,
              });
            return LlmMetricQuery.reduceTokenRows(result.data);
          } catch {
            return null;
          }
        };

      const [totalCalls, erroredCalls, spanInput, spanOutput, spanCost] =
        await Promise.all([
          safeCount(baseQuery),
          safeCount({
            ...baseQuery,
            statusCode: SpanStatus.Error,
          }),
          safeSum("llmInputTokens"),
          safeSum("llmOutputTokens"),
          safeSum("llmCost"),
        ]);

      let inputTokens: number | null = spanInput;
      let outputTokens: number | null = spanOutput;
      let tokenSource: KpiSource = "spans";

      /*
       * Only fall back on a successful-but-empty span read. A null means the
       * span aggregate itself failed, and quietly substituting metrics there
       * would dress an error up as data.
       */
      if (spanInput === 0 && spanOutput === 0) {
        const totals: LlmMetricTokenTotals | null = await safeMetricTokens();

        if (totals && (totals.inputTokens > 0 || totals.outputTokens > 0)) {
          inputTokens = totals.inputTokens;
          outputTokens = totals.outputTokens;
          tokenSource = "metrics";
        } else {
          tokenSource = "none";
        }
      }

      let cost: number | null = spanCost;
      let costSource: KpiSource = "spans";

      if (spanCost === 0) {
        const metricCost: number | null = await safeMetricCost();

        if (metricCost !== null && metricCost > 0) {
          cost = metricCost;
          costSource = "metrics";
        } else {
          costSource = "none";
        }
      }

      if (!cancelled) {
        setKpis({
          totalCalls,
          erroredCalls,
          inputTokens,
          outputTokens,
          cost,
          tokenSource,
          costSource,
        });
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [range]);

  const fmt: (value: number | null) => string = (
    value: number | null,
  ): string => {
    if (value === null) {
      return "—";
    }
    return value.toLocaleString();
  };

  const errorRate: string =
    kpis.totalCalls && kpis.totalCalls > 0 && kpis.erroredCalls !== null
      ? `${((kpis.erroredCalls / kpis.totalCalls) * 100).toFixed(1)}%`
      : "—";

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-4">
        <div className="flex items-start gap-3">
          <Icon
            icon={IconProp.Sparkles}
            className="mt-0.5 h-5 w-5 text-violet-500"
          />
          <div>
            <div className="text-sm font-semibold text-gray-900">
              AI / LLM Observability
            </div>
            <div className="mt-0.5 text-sm text-gray-600">
              Token usage, cost, latency and errors for every LLM, embedding,
              agent and tool call your apps emit via the OpenTelemetry GenAI
              conventions. Figures below cover the selected time range. Token
              and cost tiles read your GenAI spans; if you emit GenAI metrics
              without spans, they fall back to the metric stream and say so.
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Time Range
        </span>
        <StartAndEndDate
          type={StartAndEndDateType.DateTime}
          value={range}
          onValueChanged={(value: InBetween<Date> | null) => {
            if (value) {
              setRange(value);
            }
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="LLM calls" value={fmt(kpis.totalCalls)} />
        <KpiCard
          label="Errored calls"
          value={fmt(kpis.erroredCalls)}
          hint={`${errorRate} error rate`}
        />
        <KpiCard
          label="Input tokens"
          value={fmt(kpis.inputTokens)}
          hint={kpis.tokenSource === "metrics" ? METRIC_SOURCE_HINT : undefined}
        />
        <KpiCard
          label="Output tokens"
          value={fmt(kpis.outputTokens)}
          hint={kpis.tokenSource === "metrics" ? METRIC_SOURCE_HINT : undefined}
        />
        <KpiCard
          label="Cost (USD)"
          value={kpis.cost === null ? "—" : `$${kpis.cost.toFixed(4)}`}
          hint={
            kpis.costSource === "metrics"
              ? METRIC_SOURCE_HINT
              : "when reported by SDK"
          }
        />
      </div>

      <LlmCallsTable
        title="Recent LLM Calls"
        description="The most recent LLM, agent and tool calls. Open the full list or click a call to inspect its prompt, completion and tokens."
      />
    </div>
  );
};

export default LlmOverview;
