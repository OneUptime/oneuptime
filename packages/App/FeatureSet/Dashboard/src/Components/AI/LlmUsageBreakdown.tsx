import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import Span from "Common/Models/AnalyticsModels/Span";
import Metric from "Common/Models/AnalyticsModels/Metric";
import Service from "Common/Models/DatabaseModels/Service";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import GroupBy from "Common/Server/Types/Database/GroupBy";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import ProjectUtil from "Common/UI/Utils/Project";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import StartAndEndDate, {
  StartAndEndDateType,
} from "Common/UI/Components/Date/StartAndEndDate";
import {
  LlmMetricModelAttributeKeys,
  LlmMetricTeamAttributeKeys,
  LlmMetricUserAttributeKeys,
} from "Common/Types/Telemetry/LlmMetricConventions";
import LlmMetricQuery, {
  LlmMetricScope,
} from "Common/Utils/Telemetry/LlmMetricQuery";
import ServiceElement from "../Service/ServiceElement";

const DEFAULT_WINDOW_DAYS: number = 7;

/*
 * How many groups the leaderboard shows. A manager reads a ranking, not a
 * directory: past a couple of dozen rows the page stops answering "who are the
 * biggest users" and starts being a data dump.
 */
const TOP_K_GROUPS: number = 25;

/*
 * Row cap for the aggregate reads themselves, matching LlmOverview. This is
 * deliberately far larger than TOP_K_GROUPS: the ranking and the
 * share-of-total denominator are computed over EVERY group, so trimming at
 * the query would make the percentages lie.
 */
const AGGREGATE_ROW_LIMIT: number = 10000;

// Same wording LlmOverview uses, so one label means one thing product-wide.
const METRIC_SOURCE_HINT: string = "from GenAI metrics";

const UNATTRIBUTED_LABEL: string = "Unattributed";

const ATTRIBUTION_DOCS_URL: string = "/docs/telemetry/ai-coding-assistants";

/*
 * Which signal the figures on screen came from. Spans are authoritative;
 * "metrics" means this project emits GenAI metrics but no GenAI spans, so the
 * table is standing in for rows the span stream cannot supply. It is surfaced
 * because a metric-sourced cost has no matching entries in the LLM Calls list,
 * and an unlabelled number would read as a contradiction.
 */
type LlmUsageSource = "spans" | "metrics";

export type LlmUsageDimensionKey =
  | "employee"
  | "team"
  | "model"
  | "provider"
  | "service";

interface LlmUsageDimension {
  key: LlmUsageDimensionKey;
  label: string;
  columnTitle: string;
  /*
   * Span has no attributes map, so grouping MUST go through `groupBy` on real
   * columns. Passing `groupByAttributeKeys` here would be rejected with a 400
   * by AnalyticsDatabaseService.toAggregateStatement — that path is only
   * implemented for Metric.
   */
  groupBy: GroupBy<Span>;
  getGroupKey: (row: AggregatedModel) => string;
  /*
   * The metric-stream counterpart of `groupBy`, for the fallback that makes
   * metrics-only coding agents visible. Metric DOES carry an attributes map,
   * so grouping there goes through groupByAttributeKeys — the mirror image of
   * the span path, which must use real columns.
   *
   * Ordered preferred-first: the group row carries every key that was grouped
   * on, and the LABEL is the first non-empty one, exactly as getGroupKey
   * prefers the email column over the id column on the span side.
   *
   * Undefined means "this dimension has no metric fallback because the signal
   * does not exist" — see noMetricSignalNote, which is what the UI shows
   * instead of a bare empty state.
   */
  metricAttributeKeys?: Array<string> | undefined;
  /*
   * Why this dimension has no metric fallback, in the user's words. Present
   * exactly when metricAttributeKeys is absent. An empty table with no
   * explanation reads as "OneUptime lost my data"; the truth is that the
   * vendor counters never carried this field.
   */
  noMetricSignalNote?: string | undefined;
}

interface LlmUsageRow {
  // The dimension value. Empty string means unattributed — never dropped.
  key: string;
  /*
   * Nullable because the metric fallback can supply cost without any
   * per-call detail: the emitters it exists for publish a spend counter and
   * nothing else. Rendering those cells as an em dash is honest; rendering
   * them as 0 would claim the person made no calls.
   */
  calls: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cost: number;
}

interface LlmUsageState {
  rows: Array<LlmUsageRow>;
  // Denominator for the share column, summed over ALL groups, not just shown.
  totalCost: number;
  totalGroups: number;
  source: LlmUsageSource;
  isLoading: boolean;
  hasError: boolean;
}

const EMPTY_STATE: LlmUsageState = {
  rows: [],
  totalCost: 0,
  totalGroups: 0,
  source: "spans",
  isLoading: true,
  hasError: false,
};

type ReadRowColumnFunction = (row: AggregatedModel, column: string) => string;

/*
 * Grouped aggregate rows carry each group-by column verbatim (aggregateBy
 * copies them onto the returned row), but they arrive as raw JSON — a
 * ClickHouse Text column can surface as an empty string, and an ObjectID
 * column as a string. Normalize to a trimmed string so "missing" has exactly
 * one representation for the Unattributed check below.
 */
const readRowColumn: ReadRowColumnFunction = (
  row: AggregatedModel,
  column: string,
): string => {
  const value: unknown = row[column];

  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
};

const DIMENSIONS: Array<LlmUsageDimension> = [
  {
    key: "employee",
    label: "Employee",
    columnTitle: "Employee",
    /*
     * Both identity columns are group keys, and the LABEL prefers the email.
     * Emitters populate one or the other (Claude Code, Gemini CLI and Codex
     * send user.email natively; Cursor sends only an opaque id), so grouping
     * by the email alone would collapse every id-only emitter into one
     * Unattributed row. Rows that resolve to the same label are merged below,
     * which is what makes the fallback behave like one dimension.
     */
    groupBy: {
      llmUserEmail: true,
      llmUserId: true,
    },
    getGroupKey: (row: AggregatedModel): string => {
      return (
        readRowColumn(row, "llmUserEmail") || readRowColumn(row, "llmUserId")
      );
    },
    /*
     * Every recognized metric identity spelling, not just the email.
     * Grouping on user.email alone collapses the ENTIRE spend of a
     * Cursor-only project (identity is an opaque cursor.user.id, no email
     * anywhere) or a Claude Code fleet on API-key auth (user.account_uuid,
     * no email) into a single Unattributed row — precisely the failure the
     * span groupBy above is written to avoid.
     *
     * This list is 10 keys, which is exactly MetricService's
     * MAX_GROUP_BY_ATTRIBUTE_KEYS. If a future spelling is added to
     * LlmMetricUserAttributeKeys the query starts throwing BadDataException,
     * so a length guard is asserted in the tests rather than discovered in
     * production.
     */
    metricAttributeKeys: LlmMetricUserAttributeKeys,
  },
  {
    key: "team",
    label: "Team",
    columnTitle: "Team / cost centre",
    groupBy: {
      llmTeam: true,
    },
    getGroupKey: (row: AggregatedModel): string => {
      return readRowColumn(row, "llmTeam");
    },
    /*
     * Team is conventionally stamped by the operator via
     * OTEL_RESOURCE_ATTRIBUTES rather than emitted by any instrumentation,
     * which is exactly why the resource-prefixed spellings in this list
     * matter on the metric stream too.
     */
    metricAttributeKeys: LlmMetricTeamAttributeKeys,
  },
  {
    key: "model",
    label: "Model",
    columnTitle: "Model",
    groupBy: {
      llmRequestModel: true,
    },
    getGroupKey: (row: AggregatedModel): string => {
      return readRowColumn(row, "llmRequestModel");
    },
    /*
     * The vendor cost counters DO carry the model on the datapoint —
     * claude_code.cost.usage stamps a bare `model`, cursor.cost.usage stamps
     * `cursor.model.name` — so this dimension is answerable from metrics even
     * though provider and service are not.
     */
    metricAttributeKeys: LlmMetricModelAttributeKeys,
  },
  {
    key: "provider",
    label: "Provider",
    columnTitle: "Provider",
    groupBy: {
      llmSystem: true,
    },
    getGroupKey: (row: AggregatedModel): string => {
      return readRowColumn(row, "llmSystem");
    },
    /*
     * No metric fallback, and this is a property of the signal rather than a
     * gap in this code: the coding-agent counters carry no gen_ai.system.
     * Cursor and Claude Code route to several providers behind one
     * subscription and never say which, so there is nothing to group on.
     */
    noMetricSignalNote:
      "Coding-agent metric streams (Claude Code, Cursor, Codex) do not report a provider, so this breakdown only covers services that emit GenAI spans.",
  },
  {
    key: "service",
    label: "Application / Service",
    columnTitle: "Application / Service",
    groupBy: {
      primaryEntityId: true,
    },
    getGroupKey: (row: AggregatedModel): string => {
      return readRowColumn(row, "primaryEntityId");
    },
    /*
     * Same: primaryEntityId is OneUptime's own telemetry-service id, resolved
     * at span ingest. A vendor cost counter has no notion of which of your
     * applications it belongs to.
     */
    noMetricSignalNote:
      "Coding-agent metric streams (Claude Code, Cursor, Codex) are not attached to a OneUptime service, so this breakdown only covers services that emit GenAI spans.",
  },
];

type GetDimensionFunction = (key: LlmUsageDimensionKey) => LlmUsageDimension;

const getDimension: GetDimensionFunction = (
  key: LlmUsageDimensionKey,
): LlmUsageDimension => {
  return (
    DIMENSIONS.find((dimension: LlmUsageDimension): boolean => {
      return dimension.key === key;
    }) || DIMENSIONS[0]!
  );
};

type EmptyUsageRowFunction = (key: string) => LlmUsageRow;

const emptyUsageRow: EmptyUsageRowFunction = (key: string): LlmUsageRow => {
  return {
    key: key,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cost: 0,
  };
};

type MergeGroupedRowsFunction = (data: {
  into: Map<string, LlmUsageRow>;
  rows: Array<AggregatedModel> | null;
  dimension: LlmUsageDimension;
  apply: (row: LlmUsageRow, value: number) => void;
}) => void;

/*
 * Fold one grouped aggregate into the accumulating leaderboard. Non-finite
 * values contribute nothing rather than poisoning a row into NaN, matching
 * LlmMetricQuery.sumAggregatedRows — a single bad row must not blank a whole
 * cost column.
 */
const mergeGroupedRows: MergeGroupedRowsFunction = (data: {
  into: Map<string, LlmUsageRow>;
  rows: Array<AggregatedModel> | null;
  dimension: LlmUsageDimension;
  apply: (row: LlmUsageRow, value: number) => void;
}): void => {
  if (!data.rows) {
    return;
  }

  for (const aggregatedRow of data.rows) {
    if (!aggregatedRow) {
      continue;
    }

    const key: string = data.dimension.getGroupKey(aggregatedRow);
    const usageRow: LlmUsageRow = data.into.get(key) || emptyUsageRow(key);
    const value: number = Number(aggregatedRow.value ?? 0);

    if (isFinite(value)) {
      data.apply(usageRow, value);
    }

    data.into.set(key, usageRow);
  }
};

type SortUsageRowsFunction = (rows: Array<LlmUsageRow>) => Array<LlmUsageRow>;

/*
 * Rank by spend, because that is the question the page exists to answer.
 * Calls break ties so a set of zero-cost providers still orders sensibly, and
 * the key breaks the remainder so the order is stable across reloads rather
 * than dependent on ClickHouse's row order.
 */
const sortUsageRows: SortUsageRowsFunction = (
  rows: Array<LlmUsageRow>,
): Array<LlmUsageRow> => {
  return [...rows].sort((a: LlmUsageRow, b: LlmUsageRow): number => {
    if (b.cost !== a.cost) {
      return b.cost - a.cost;
    }

    if ((b.calls || 0) !== (a.calls || 0)) {
      return (b.calls || 0) - (a.calls || 0);
    }

    return a.key.localeCompare(b.key);
  });
};

type ReadMetricGroupKeyFunction = (
  row: AggregatedModel,
  keys: Array<string>,
) => string;

/*
 * The label for a grouped metric row: the FIRST non-empty value among the
 * keys that were grouped on, in the list's documented preference order.
 *
 * First-match-wins rather than "the one key we asked for", because the
 * grouped row carries every requested key and an emitter populates whichever
 * subset it knows about — Claude Code sends user.email, Cursor sends only
 * cursor.user.id, an operator sends resource.user.email. Reading one key and
 * ignoring the rest is what makes an id-only fleet read as Unattributed.
 *
 * MetricService returns the grouped keys as a map of exactly the requested
 * keys, with an absent attribute surfacing as an empty string, so "missing"
 * has one representation here just as readRowColumn gives it one on the span
 * side.
 */
const readMetricGroupKey: ReadMetricGroupKeyFunction = (
  row: AggregatedModel,
  keys: Array<string>,
): string => {
  const attributes: JSONObject =
    (row["attributes"] as JSONObject | undefined) || {};

  for (const key of keys) {
    const value: unknown = attributes[key];

    if (value === null || value === undefined) {
      continue;
    }

    const text: string = String(value).trim();

    if (text) {
      return text;
    }
  }

  return "";
};

type FormatNumberFunction = (value: number | null) => string;

const formatNumber: FormatNumberFunction = (value: number | null): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }

  return value.toLocaleString();
};

type FormatCostFunction = (value: number | null) => string;

const formatCost: FormatCostFunction = (value: number | null): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }

  return `$${value.toFixed(4)}`;
};

const LlmUsageBreakdown: FunctionComponent = (): ReactElement => {
  const [dimensionKey, setDimensionKey] =
    useState<LlmUsageDimensionKey>("employee");

  const [usage, setUsage] = useState<LlmUsageState>(EMPTY_STATE);

  const [telemetryServices, setTelemetryServices] = useState<Array<Service>>(
    [],
  );

  const [range, setRange] = useState<InBetween<Date>>(() => {
    return new InBetween<Date>(
      OneUptimeDate.getSomeDaysAgo(DEFAULT_WINDOW_DAYS),
      OneUptimeDate.getCurrentDate(),
    );
  });

  const dimension: LlmUsageDimension = useMemo(() => {
    return getDimension(dimensionKey);
  }, [dimensionKey]);

  /*
   * Service names, loaded once. A raw primaryEntityId ObjectID in a
   * manager-facing leaderboard tells nobody anything, so the same
   * ModelAPI.getList + ServiceElement pattern the LLM Calls table uses
   * resolves it to the service's name and colour.
   */
  useEffect(() => {
    let cancelled: boolean = false;

    const loadServices: () => Promise<void> = async (): Promise<void> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!projectId) {
        return;
      }

      try {
        const result: ListResult<Service> = await ModelAPI.getList({
          modelType: Service,
          query: {
            projectId: projectId,
          },
          select: {
            serviceColor: true,
            name: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: {
            name: SortOrder.Ascending,
          },
        });

        if (!cancelled) {
          setTelemetryServices(result.data || []);
        }
      } catch {
        /*
         * Non-critical. The leaderboard still renders; the service dimension
         * falls back to showing the raw id rather than failing the page.
         */
      }
    };

    void loadServices();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled: boolean = false;

    setUsage({ ...EMPTY_STATE, isLoading: true });

    const load: () => Promise<void> = async (): Promise<void> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!projectId) {
        if (!cancelled) {
          setUsage({ ...EMPTY_STATE, isLoading: false });
        }
        return;
      }

      const startDate: Date = range.startValue;
      const endDate: Date = range.endValue;

      /*
       * The `startTime` predicate has to live in the QUERY.
       * startTimestamp/endTimestamp only choose the bucket grid — without this
       * the aggregate scans the span table's whole retention. Same trap
       * LlmOverview documents.
       */
      const spanQuery: Query<Span> = {
        projectId: projectId,
        isLlmSpan: true,
        startTime: new InBetween(startDate, endDate),
      };

      type SafeGroupedAggregateFunction = (data: {
        column: keyof Span;
        aggregationType: AggregationType;
        applyTopK: boolean;
      }) => Promise<Array<AggregatedModel> | null>;

      const safeGroupedAggregate: SafeGroupedAggregateFunction = async (data: {
        column: keyof Span;
        aggregationType: AggregationType;
        applyTopK: boolean;
      }): Promise<Array<AggregatedModel> | null> => {
        try {
          const result: AggregatedResult =
            await AnalyticsModelAPI.aggregate<Span>({
              modelType: Span,
              aggregateBy: {
                query: spanQuery,
                aggregationType: data.aggregationType,
                aggregateColumnName: data.column,
                aggregationTimestampColumnName: "startTime",
                startTimestamp: startDate,
                endTimestamp: endDate,
                /*
                 * Total collapses the window to one value per group, which is
                 * exactly what a leaderboard wants — bucketed rows would have
                 * to be re-summed in the browser for no benefit.
                 */
                aggregationInterval: AggregationInterval.Total,
                groupBy: dimension.groupBy,
                /*
                 * Top-K is only carried by the cost query: it is the ranking
                 * dimension, and a model that trims server-side would
                 * otherwise return a DIFFERENT top set per query and the
                 * token/call columns would belong to other groups. Rows are
                 * ranked and trimmed in the browser regardless, since the
                 * server-side trim is implemented for Metric only and the
                 * generic analytics aggregate path accepts and ignores it.
                 */
                ...(data.applyTopK
                  ? {
                      topK: {
                        count: TOP_K_GROUPS,
                        rankBy: "max" as const,
                      },
                    }
                  : {}),
                limit: AGGREGATE_ROW_LIMIT,
                skip: 0,
              } as AggregateBy<Span>,
            });

          return result.data || [];
        } catch {
          // Degrade to null; the caller renders an em dash rather than throwing.
          return null;
        }
      };

      const [
        costRows,
        totalTokenRows,
        inputTokenRows,
        outputTokenRows,
        callRows,
      ] = await Promise.all([
        safeGroupedAggregate({
          column: "llmCost",
          aggregationType: AggregationType.Sum,
          applyTopK: true,
        }),
        safeGroupedAggregate({
          column: "llmTotalTokens",
          aggregationType: AggregationType.Sum,
          applyTopK: false,
        }),
        safeGroupedAggregate({
          column: "llmInputTokens",
          aggregationType: AggregationType.Sum,
          applyTopK: false,
        }),
        safeGroupedAggregate({
          column: "llmOutputTokens",
          aggregationType: AggregationType.Sum,
          applyTopK: false,
        }),
        /*
         * count(spanId) is the per-group call count. spanId is a
         * non-nullable Text column, so it counts rows rather than
         * populated values.
         */
        safeGroupedAggregate({
          column: "spanId",
          aggregationType: AggregationType.Count,
          applyTopK: false,
        }),
      ]);

      /*
       * A FAILED cost aggregate ends the render here, before a single row is
       * built.
       *
       * The token and call aggregates may well have succeeded, and it is
       * tempting to show what we have. But cost is this view's ranking
       * dimension and its share denominator: with costRows null every row's
       * cost stays at its initial 0, sortUsageRows ranks the whole table at
       * zero, and the page renders an error banner above a cost-ranked
       * leaderboard in which every person reads $0.0000. Those zeros are
       * fabricated — nobody measured them — and they are presented in the one
       * column the page exists to report. A manager reading "$0.0000" for an
       * engineer does not read it as "unknown".
       *
       * So the honest treatment is the error state INSTEAD of the table.
       * Note this is strictly the aggregate REJECTING; a cost aggregate that
       * succeeds and returns no rows is a different thing entirely (the
       * project genuinely has no LLM spend in this window) and still falls
       * through to the metric fallback and the normal empty state below.
       */
      if (costRows === null) {
        if (!cancelled) {
          setUsage({
            ...EMPTY_STATE,
            isLoading: false,
            hasError: true,
          });
        }

        return;
      }

      const merged: Map<string, LlmUsageRow> = new Map<string, LlmUsageRow>();

      mergeGroupedRows({
        into: merged,
        rows: costRows,
        dimension: dimension,
        apply: (row: LlmUsageRow, value: number): void => {
          row.cost += value;
        },
      });

      mergeGroupedRows({
        into: merged,
        rows: totalTokenRows,
        dimension: dimension,
        apply: (row: LlmUsageRow, value: number): void => {
          row.totalTokens = (row.totalTokens || 0) + value;
        },
      });

      mergeGroupedRows({
        into: merged,
        rows: inputTokenRows,
        dimension: dimension,
        apply: (row: LlmUsageRow, value: number): void => {
          row.inputTokens = (row.inputTokens || 0) + value;
        },
      });

      mergeGroupedRows({
        into: merged,
        rows: outputTokenRows,
        dimension: dimension,
        apply: (row: LlmUsageRow, value: number): void => {
          row.outputTokens = (row.outputTokens || 0) + value;
        },
      });

      mergeGroupedRows({
        into: merged,
        rows: callRows,
        dimension: dimension,
        apply: (row: LlmUsageRow, value: number): void => {
          row.calls = (row.calls || 0) + value;
        },
      });

      let allRows: Array<LlmUsageRow> = sortUsageRows(
        Array.from(merged.values()),
      );
      let source: LlmUsageSource = "spans";

      /*
       * The metric fallback, for every dimension the metric stream can
       * actually answer (employee, team, model — see metricAttributeKeys).
       *
       * This is the path that makes Claude Code, Cursor, OpenAI Codex and the
       * Gemini CLI visible at all: they export OpenTelemetry natively, but
       * they publish per-user token and cost METRICS and emit no GenAI spans,
       * so a span-only leaderboard shows an empty table for an entire fleet
       * of coding agents that is very much spending money.
       *
       * The rule is LlmOverview's, exactly: spans are authoritative, metrics
       * are consulted ONLY when the span stream reported nothing, and the two
       * are NEVER summed — an emitter producing both signals would otherwise
       * have every dollar counted twice. A failed span aggregate never
       * reaches here at all (it returned above), so metrics can never be
       * substituted for an error.
       */
      const metricAttributeKeys: Array<string> | undefined =
        dimension.metricAttributeKeys;

      if (metricAttributeKeys && allRows.length === 0) {
        const metricScope: LlmMetricScope = {
          projectId: projectId,
          startTime: startDate,
          endTime: endDate,
        };

        type SafeMetricCostFunction = (
          query: Query<Metric>,
        ) => Promise<Array<AggregatedModel> | null>;

        const safeMetricCost: SafeMetricCostFunction = async (
          query: Query<Metric>,
        ): Promise<Array<AggregatedModel> | null> => {
          try {
            const result: AggregatedResult =
              await AnalyticsModelAPI.aggregate<Metric>({
                modelType: Metric,
                aggregateBy: {
                  query: query,
                  aggregationType: AggregationType.Sum,
                  aggregateColumnName: "value",
                  aggregationTimestampColumnName: "time",
                  startTimestamp: startDate,
                  endTimestamp: endDate,
                  aggregationInterval: AggregationInterval.Total,
                  /*
                   * Metric DOES carry an attributes map, so grouping goes
                   * through groupByAttributeKeys here — the mirror image of
                   * the span path above, which must use real columns.
                   *
                   * ALL the recognized spellings, not just the preferred one.
                   * MetricService produces exactly one group row per
                   * datapoint regardless of how many keys are listed, so this
                   * cannot double-count; grouping on one key and ignoring the
                   * rest is what makes an id-only emitter vanish.
                   */
                  groupByAttributeKeys: [...metricAttributeKeys],
                  limit: AGGREGATE_ROW_LIMIT,
                  skip: 0,
                } as AggregateBy<Metric>,
              });

            return result.data || [];
          } catch {
            return null;
          }
        };

        /*
         * Two queries, two units. Codex reports spend in MILLIONTHS of a
         * dollar, so its counter cannot share a Sum with genuinely-USD
         * counters — combineCostTotals applies the scale per list, before the
         * addition, in the one place a test pins it.
         */
        const [usdRows, microUsdRows] = await Promise.all([
          safeMetricCost(LlmMetricQuery.buildCostQuery(metricScope)),
          safeMetricCost(LlmMetricQuery.buildMicroUsdCostQuery(metricScope)),
        ]);

        const usdByGroup: Map<string, number> = new Map<string, number>();
        const microUsdByGroup: Map<string, number> = new Map<string, number>();

        for (const metricRow of usdRows || []) {
          const key: string = readMetricGroupKey(
            metricRow,
            metricAttributeKeys,
          );
          const value: number = Number(metricRow.value ?? 0);
          usdByGroup.set(
            key,
            (usdByGroup.get(key) || 0) + (isFinite(value) ? value : 0),
          );
        }

        for (const metricRow of microUsdRows || []) {
          const key: string = readMetricGroupKey(
            metricRow,
            metricAttributeKeys,
          );
          const value: number = Number(metricRow.value ?? 0);
          microUsdByGroup.set(
            key,
            (microUsdByGroup.get(key) || 0) + (isFinite(value) ? value : 0),
          );
        }

        const metricKeys: Set<string> = new Set<string>([
          ...usdByGroup.keys(),
          ...microUsdByGroup.keys(),
        ]);

        const metricRows: Array<LlmUsageRow> = [];

        for (const key of metricKeys) {
          metricRows.push({
            key: key,
            /*
             * The metric stream carries spend, not per-call detail. Null (an
             * em dash on screen) rather than 0, which would claim this person
             * made no calls and used no tokens.
             */
            calls: null,
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            cost: LlmMetricQuery.combineCostTotals({
              usd: usdByGroup.get(key) || 0,
              microUsd: microUsdByGroup.get(key) || 0,
            }),
          });
        }

        if (metricRows.length > 0) {
          allRows = sortUsageRows(metricRows);
          source = "metrics";
        }
      }

      /*
       * The share denominator is the sum over EVERY group, including the
       * Unattributed one and the groups that fall outside the visible top-K.
       * Dropping unattributed spend from the total is the specific mistake
       * that would make this page disagree with the Overview KPIs, which
       * count every LLM span whether or not it carries an identity.
       */
      const totalCost: number = allRows.reduce(
        (accumulator: number, row: LlmUsageRow): number => {
          return accumulator + (isFinite(row.cost) ? row.cost : 0);
        },
        0,
      );

      if (!cancelled) {
        setUsage({
          rows: allRows.slice(0, TOP_K_GROUPS),
          totalCost: totalCost,
          totalGroups: allRows.length,
          source: source,
          isLoading: false,
          /*
           * Always false here: the only failure this view refuses to render
           * through is a failed cost aggregate, and that returned above
           * rather than falling into this branch.
           */
          hasError: false,
        });
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [range, dimension]);

  type RenderDimensionValueFunction = (row: LlmUsageRow) => ReactElement;

  const renderDimensionValue: RenderDimensionValueFunction = (
    row: LlmUsageRow,
  ): ReactElement => {
    if (!row.key) {
      /*
       * Never silently dropped. An unattributed row is a real bucket of
       * spend; hiding it would make this page's totals disagree with the
       * Overview KPIs and quietly understate the bill.
       */
      return (
        <span
          className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
          data-testid="llm-usage-unattributed"
        >
          {UNATTRIBUTED_LABEL}
        </span>
      );
    }

    if (dimension.key === "service") {
      const telemetryService: Service | undefined = telemetryServices.find(
        (service: Service): boolean => {
          return service.id?.toString() === row.key;
        },
      );

      if (telemetryService) {
        return <ServiceElement service={telemetryService} />;
      }

      // The service was deleted, or the list request failed. Show the id.
      return <span className="font-mono text-xs text-gray-500">{row.key}</span>;
    }

    return <span className="text-sm text-gray-900">{row.key}</span>;
  };

  type RenderShareFunction = (row: LlmUsageRow) => ReactElement;

  const renderShare: RenderShareFunction = (row: LlmUsageRow): ReactElement => {
    if (usage.totalCost <= 0) {
      return <span className="text-gray-400">—</span>;
    }

    const share: number = (row.cost / usage.totalCost) * 100;

    return (
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-24 rounded-full bg-gray-100">
          <div
            className="h-1.5 rounded-full bg-violet-500"
            style={{
              width: `${Math.min(100, Math.max(0, share)).toFixed(1)}%`,
            }}
          />
        </div>
        <span className="w-12 text-right text-xs text-gray-600">
          {share.toFixed(1)}%
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-4">
        <div className="flex items-start gap-3">
          <Icon
            icon={IconProp.UserGroup}
            className="mt-0.5 h-5 w-5 text-violet-500"
          />
          <div>
            <div className="text-sm font-semibold text-gray-900">
              Who is spending what
            </div>
            <div className="mt-0.5 text-sm text-gray-600">
              LLM spend and token usage for the selected time range, ranked by
              cost. Switch the dimension to see it broken down by employee,
              team, model, provider, or the application that made the call.
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Usage dimension"
        >
          {DIMENSIONS.map((option: LlmUsageDimension): ReactElement => {
            const isActive: boolean = option.key === dimension.key;

            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  setDimensionKey(option.key);
                }}
                className={
                  isActive
                    ? "rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-sm font-medium text-violet-700"
                    : "rounded-full border border-gray-200 bg-white px-3 py-1 text-sm text-gray-600 hover:bg-gray-50"
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>

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

      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-col gap-1 border-b border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-base font-medium text-gray-900">
              Usage by {dimension.label.toLowerCase()}
            </div>
            <div className="text-sm text-gray-500">
              Top {TOP_K_GROUPS} of {usage.totalGroups.toLocaleString()} by cost
              over the selected range.
            </div>
          </div>
          {usage.source === "metrics" ? (
            <span
              className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700"
              data-testid="llm-usage-source-hint"
            >
              {METRIC_SOURCE_HINT}
            </span>
          ) : null}
        </div>

        {/*
         * Attribution is only as good as what the emitter sent. Saying so
         * plainly here is the difference between a manager trusting the
         * Unattributed row and filing a bug about it.
         */}
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-600">
          Calls appear under {UNATTRIBUTED_LABEL} when the emitter did not send
          an identity attribute (for example <code>user.email</code> or{" "}
          <code>team.id</code>). They are still counted here, so these totals
          match the Overview page.{" "}
          <a
            className="font-medium text-violet-700 hover:underline"
            href={ATTRIBUTION_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            How to attribute AI coding assistant usage
          </a>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">
                  #
                </th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">
                  {dimension.columnTitle}
                </th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">
                  Calls
                </th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">
                  Input tokens
                </th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">
                  Output tokens
                </th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">
                  Total tokens
                </th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">
                  Cost (USD)
                </th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">
                  Share
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {usage.isLoading ? (
                <tr>
                  <td className="px-4 py-6 text-gray-500" colSpan={8}>
                    Loading usage…
                  </td>
                </tr>
              ) : null}

              {!usage.isLoading && usage.hasError ? (
                <tr>
                  <td className="px-4 py-6 text-gray-500" colSpan={8}>
                    Usage could not be loaded for this time range. Try a
                    narrower range or refresh the page.
                  </td>
                </tr>
              ) : null}

              {!usage.isLoading &&
              !usage.hasError &&
              usage.rows.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-gray-500" colSpan={8}>
                    <div>No LLM usage found in this time range.</div>
                    {/*
                     * For the two dimensions with no metric fallback, say why
                     * rather than leaving a manager to conclude OneUptime
                     * lost their data. The signal genuinely does not exist:
                     * the vendor counters carry no provider and no OneUptime
                     * service id.
                     */}
                    {dimension.noMetricSignalNote ? (
                      <div
                        className="mt-1 text-xs text-gray-500"
                        data-testid="llm-usage-no-metric-signal"
                      >
                        {dimension.noMetricSignalNote}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ) : null}

              {!usage.isLoading
                ? usage.rows.map(
                    (row: LlmUsageRow, index: number): ReactElement => {
                      return (
                        <tr
                          key={`${row.key || "unattributed"}-${index}`}
                          data-testid="llm-usage-row"
                        >
                          <td className="px-4 py-2 text-gray-400">
                            {index + 1}
                          </td>
                          <td className="px-4 py-2">
                            {renderDimensionValue(row)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs text-gray-700">
                            {formatNumber(row.calls)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs text-gray-700">
                            {formatNumber(row.inputTokens)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs text-gray-700">
                            {formatNumber(row.outputTokens)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs text-gray-700">
                            {formatNumber(row.totalTokens)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs text-gray-900">
                            {formatCost(row.cost)}
                          </td>
                          <td className="px-4 py-2">{renderShare(row)}</td>
                        </tr>
                      );
                    },
                  )
                : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default LlmUsageBreakdown;
