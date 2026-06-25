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
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import ProjectUtil from "Common/UI/Utils/Project";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import LlmCallsTable from "./LlmCallsTable";

const WINDOW_DAYS: number = 7;

interface Kpis {
  totalCalls: number | null;
  erroredCalls: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
}

function sumBuckets(result: AggregatedResult): number {
  return (result.data || []).reduce(
    (acc: number, row: AggregatedModel): number => {
      return acc + Number(row.value || 0);
    },
    0,
  );
}

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
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-[11px] uppercase tracking-wide text-gray-400">
        {props.label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">
        {props.value}
      </div>
      {props.hint ? (
        <div className="mt-0.5 text-xs text-gray-400">{props.hint}</div>
      ) : null}
    </div>
  );
};

const LlmOverview: FunctionComponent = (): ReactElement => {
  const [kpis, setKpis] = useState<Kpis>({
    totalCalls: null,
    erroredCalls: null,
    inputTokens: null,
    outputTokens: null,
    cost: null,
  });

  useEffect(() => {
    let cancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      if (!projectId) {
        return;
      }

      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.getSomeDaysAgo(WINDOW_DAYS);

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

      const [totalCalls, erroredCalls, inputTokens, outputTokens, cost] =
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

      if (!cancelled) {
        setKpis({
          totalCalls,
          erroredCalls,
          inputTokens,
          outputTokens,
          cost,
        });
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

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
              conventions. Figures below cover the last {WINDOW_DAYS} days. Cost
              is shown only when your instrumentation reports it.
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="LLM calls" value={fmt(kpis.totalCalls)} />
        <KpiCard
          label="Errored calls"
          value={fmt(kpis.erroredCalls)}
          hint={`${errorRate} error rate`}
        />
        <KpiCard label="Input tokens" value={fmt(kpis.inputTokens)} />
        <KpiCard label="Output tokens" value={fmt(kpis.outputTokens)} />
        <KpiCard
          label="Cost (USD)"
          value={kpis.cost === null ? "—" : `$${kpis.cost.toFixed(4)}`}
          hint="when reported by SDK"
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
