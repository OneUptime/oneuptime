import Metric from "Common/Models/AnalyticsModels/Metric";
import LlmObservabilityConnection from "Common/Models/DatabaseModels/LlmObservabilityConnection";
import Route from "Common/Types/API/Route";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { isCompanyToolProvider } from "Common/Types/LlmObservability/LlmConnectionCatalog";
import {
  LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE,
  LLM_PROVIDER_COST_METRIC_NAME,
  LLM_PROVIDER_REQUESTS_METRIC_NAME,
  LLM_PROVIDER_TOKENS_METRIC_NAME,
  LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE,
} from "Common/Types/LlmObservability/LlmProviderUsageMetrics";
import ObjectID from "Common/Types/ObjectID";
import StartAndEndDate, {
  StartAndEndDateType,
} from "Common/UI/Components/Date/StartAndEndDate";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  Translator,
  translatableTerm,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import ResizableHeaderCell from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { LlmTile } from "../LlmConversations/LlmSummaryTiles";
import {
  formatLlmCost,
  formatLlmCount,
  formatLlmTokens,
} from "../LlmConversations/LlmConversationFormat";
import { LLM_CONNECT_WAY_QUERY_PARAM } from "./Connect/LlmConnectWays";
import {
  LLM_PROVIDER_USAGE_DIMENSIONS,
  LlmProviderUsageDimension,
  LlmProviderUsageDimensionKey,
  LlmProviderUsageRow,
  LlmProviderUsageSummary,
  buildProviderMetricQuery,
  foldProviderUsage,
  getProviderLabel,
  getProviderUsageDimension,
} from "./LlmProviderUsageQuery";

/*
 * Usage > Provider accounts: what the connected OpenAI, Anthropic, Azure,
 * Bedrock and Vertex AI accounts report they used and cost, by model,
 * person, provider, project, key or connection. These are the providers'
 * own figures - the bill - not the calls your apps sent, so they are shown
 * on their own and never added to them.
 */

const TOP_K_GROUPS: number = 25;
const AGGREGATE_ROW_LIMIT: number = 10000;
const UNNAMED_LABEL: string = translationKey("Not named by the provider");

type LoadState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "loaded"; summary: LlmProviderUsageSummary };

function formatWhole(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

// A bill's amount: "$1,204.50".
function formatCost(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const LlmProviderUsage: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * The last month: providers report whole days, and a first read brings in
   * 30 of them. A month back is also the range picker's own "1 month", so it
   * shows picked.
   */
  const [range, setRange] = useState<InBetween<Date>>(
    new InBetween<Date>(
      OneUptimeDate.addRemoveMonths(OneUptimeDate.getCurrentDate(), -1),
      OneUptimeDate.getCurrentDate(),
    ),
  );
  const [dimensionKey, setDimensionKey] =
    useState<LlmProviderUsageDimensionKey>("model");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [providerAccounts, setProviderAccounts] = useState<number | undefined>(
    undefined,
  );

  const dimension: LlmProviderUsageDimension =
    getProviderUsageDimension(dimensionKey);

  /*
   * The table's columns as wide as a person makes them (Common's
   * Table/ColumnResize), after each row's number: what the rows are, then
   * their counts, which are never cut.
   */
  const resizableColumns: ResizableColumns = useResizableColumns({
    tableKey: "llm-provider-usage-table",
    columns: [
      { id: "group", cellNumber: 2 },
      { id: "requests", cellNumber: 3 },
      { id: "inputTokens", cellNumber: 4 },
      { id: "outputTokens", cellNumber: 5 },
      { id: "cost", cellNumber: 6 },
    ],
  });

  useEffect(() => {
    let isCurrent: boolean = true;
    const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

    const loadConnections: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<LlmObservabilityConnection> =
          await ModelAPI.getList<LlmObservabilityConnection>({
            modelType: LlmObservabilityConnection,
            query: { projectId },
            select: { _id: true, provider: true },
            limit: 100,
            skip: 0,
            sort: {},
          });

        if (isCurrent) {
          setProviderAccounts(
            result.data.filter((item: LlmObservabilityConnection): boolean => {
              return !isCompanyToolProvider(item.provider);
            }).length,
          );
        }
      } catch {
        if (isCurrent) {
          setProviderAccounts(undefined);
        }
      }
    };

    void loadConnections();

    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    let isCurrent: boolean = true;
    const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

    const aggregate: (data: {
      metricName: string;
      groupByAttributeKeys: Array<string>;
    }) => Promise<Array<AggregatedModel>> = async (data: {
      metricName: string;
      groupByAttributeKeys: Array<string>;
    }): Promise<Array<AggregatedModel>> => {
      const result: AggregatedResult =
        await AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: {
            query: buildProviderMetricQuery({
              projectId,
              metricName: data.metricName,
              startTime: range.startValue,
              endTime: range.endValue,
            }),
            aggregationType: AggregationType.Sum,
            aggregateColumnName: "value",
            aggregationTimestampColumnName: "time",
            startTimestamp: range.startValue,
            endTimestamp: range.endValue,
            aggregationInterval: AggregationInterval.Total,
            groupByAttributeKeys: data.groupByAttributeKeys,
            limit: AGGREGATE_ROW_LIMIT,
            skip: 0,
          } as AggregateBy<Metric>,
        });

      return result.data || [];
    };

    const load: () => Promise<void> = async (): Promise<void> => {
      setState({ kind: "loading" });

      try {
        const [costRows, tokenRows, requestRows] = await Promise.all([
          aggregate({
            metricName: LLM_PROVIDER_COST_METRIC_NAME,
            groupByAttributeKeys: [
              dimension.attributeKey,
              LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE,
            ],
          }),
          aggregate({
            metricName: LLM_PROVIDER_TOKENS_METRIC_NAME,
            groupByAttributeKeys: [
              dimension.attributeKey,
              LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE,
            ],
          }),
          aggregate({
            metricName: LLM_PROVIDER_REQUESTS_METRIC_NAME,
            groupByAttributeKeys: [dimension.attributeKey],
          }),
        ]);

        if (isCurrent) {
          setState({
            kind: "loaded",
            summary: foldProviderUsage({
              dimension,
              costRows,
              tokenRows,
              requestRows,
            }),
          });
        }
      } catch {
        if (isCurrent) {
          setState({ kind: "error" });
        }
      }
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, [range, dimensionKey]);

  // Connect, opened on the provider tiles.
  const connectRoute: Route = new Route(
    `${RouteUtil.populateRouteParams(
      RouteMap[PageMap.LLM_CONNECT] as Route,
    ).toString()}?${LLM_CONNECT_WAY_QUERY_PARAM}=providers`,
  );

  const renderGroup: (row: LlmProviderUsageRow) => ReactElement = (
    row: LlmProviderUsageRow,
  ): ReactElement => {
    if (!row.key) {
      return (
        <span className="text-gray-500">
          {translator.translateText(UNNAMED_LABEL)}
        </span>
      );
    }

    return (
      <span className="font-medium text-gray-900">
        {dimension.key === "provider" ? getProviderLabel(row.key) : row.key}
      </span>
    );
  };

  if (providerAccounts === 0) {
    return (
      <div
        className="rounded-lg border border-gray-200 bg-white"
        data-testid="llm-provider-usage-not-connected"
      >
        <TableEmptyState
          kind={TableEmptyStateKind.Empty}
          icon={IconProp.Link}
          title="No provider account connected"
          description="Connect an OpenAI, Anthropic, Azure, Bedrock or Vertex AI account to see what it used and what it cost, by model, project, key and person."
          actions={[
            {
              title: "Connect a provider account",
              icon: IconProp.Link,
              dataTestId: "llm-provider-usage-connect",
              onClick: () => {
                Navigation.navigate(connectRoute);
              },
            },
          ]}
        />
      </div>
    );
  }

  const summary: LlmProviderUsageSummary | undefined =
    state.kind === "loaded" ? state.summary : undefined;
  const shown: Array<LlmProviderUsageRow> = summary
    ? summary.rows.slice(0, TOP_K_GROUPS)
    : [];

  return (
    <div className="space-y-4" data-testid="llm-provider-usage">
      {/*
       * The range picker keeps its own width - squeezed, its presets broke
       * onto two lines ("1 / month") - and the six groupings wrap instead.
       */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          className="flex min-w-0 flex-wrap gap-2 lg:flex-1"
          role="group"
          aria-label={translator.translateText("Usage dimension")}
        >
          {LLM_PROVIDER_USAGE_DIMENSIONS.map(
            (option: LlmProviderUsageDimension): ReactElement => {
              const isActive: boolean = option.key === dimension.key;

              return (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={isActive}
                  data-testid={`llm-provider-usage-dimension-${option.key}`}
                  onClick={() => {
                    setDimensionKey(option.key);
                  }}
                  className={
                    isActive
                      ? "rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-sm font-medium text-violet-700"
                      : "rounded-full border border-gray-200 bg-white px-3 py-1 text-sm text-gray-600 hover:bg-gray-50"
                  }
                >
                  {translator.translateText(option.label)}
                </button>
              );
            },
          )}
        </div>

        <div className="lg:flex-shrink-0">
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
      </div>

      {/*
       * The same tiles, in the same order, as Your AI calls' totals: a
       * reader switching between the two sources compares like with like.
       */}
      <div
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        data-testid="llm-provider-usage-totals"
      >
        <LlmTile
          label="Requests"
          value={summary ? formatLlmCount(summary.totals.requests) : "—"}
          icon={IconProp.Sparkles}
          iconClassName="text-violet-600"
          iconTileClassName="bg-violet-50"
          dataTestId="llm-provider-usage-total-requests"
          isLoading={state.kind === "loading"}
        />
        <LlmTile
          label="Input tokens"
          value={summary ? formatLlmTokens(summary.totals.inputTokens) : "—"}
          icon={IconProp.ArrowDown}
          iconClassName="text-indigo-600"
          iconTileClassName="bg-indigo-50"
          dataTestId="llm-provider-usage-total-input"
          isLoading={state.kind === "loading"}
        />
        <LlmTile
          label="Output tokens"
          value={summary ? formatLlmTokens(summary.totals.outputTokens) : "—"}
          icon={IconProp.ArrowUp}
          iconClassName="text-sky-600"
          iconTileClassName="bg-sky-50"
          dataTestId="llm-provider-usage-total-output"
          isLoading={state.kind === "loading"}
        />
        <LlmTile
          label="Cost (USD)"
          value={summary ? formatLlmCost(summary.totals.costUsd) : "—"}
          icon={IconProp.CurrencyDollar}
          iconClassName="text-emerald-600"
          iconTileClassName="bg-emerald-50"
          dataTestId="llm-provider-usage-total-cost"
          isLoading={state.kind === "loading"}
        />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-col gap-1 border-b border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-base font-medium text-gray-900">
              {translator.translateTemplate("Usage by {{dimension}}", {
                dimension: translatableTerm(dimension.label, {
                  inSentence: true,
                }),
              })}
            </div>
            <div className="text-sm text-gray-500">
              {translator.translateText(
                "The providers' own figures, by UTC day. Requests show for the providers that count them.",
              )}
            </div>
          </div>
          {summary?.totals.costIncludesEstimate ? (
            <span
              className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700"
              data-testid="llm-provider-usage-estimate-hint"
            >
              {translator.translateText("Some costs are estimated from tokens")}
            </span>
          ) : null}
        </div>

        <div className="overflow-x-auto">
          {resizableColumns.styles}
          <table
            className={`${resizableColumns.getTableWidthClassName("min-w-full")} divide-y divide-gray-200 text-sm`}
            {...resizableColumns.tableAttributes}
          >
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">
                  #
                </th>
                <ResizableHeaderCell
                  className="px-4 py-2 text-left font-medium text-gray-500"
                  resize={resizableColumns.getResize(
                    "group",
                    translator.translateText(dimension.label) || dimension.label,
                    ColumnWidthKind.Name,
                  )}
                >
                  <span>{translator.translateText(dimension.label) || dimension.label}</span>
                </ResizableHeaderCell>
                <ResizableHeaderCell
                  className="px-4 py-2 text-right font-medium text-gray-500"
                  resize={resizableColumns.getResize(
                    "requests",
                    translator.translateText("Requests") || "Requests",
                    ColumnWidthKind.Whole,
                  )}
                >
                  <span>{translator.translateText("Requests") || "Requests"}</span>
                </ResizableHeaderCell>
                <ResizableHeaderCell
                  className="px-4 py-2 text-right font-medium text-gray-500"
                  resize={resizableColumns.getResize(
                    "inputTokens",
                    translator.translateText("Input tokens") || "Input tokens",
                    ColumnWidthKind.Whole,
                  )}
                >
                  <span>{translator.translateText("Input tokens") || "Input tokens"}</span>
                </ResizableHeaderCell>
                <ResizableHeaderCell
                  className="px-4 py-2 text-right font-medium text-gray-500"
                  resize={resizableColumns.getResize(
                    "outputTokens",
                    translator.translateText("Output tokens") || "Output tokens",
                    ColumnWidthKind.Whole,
                  )}
                >
                  <span>{translator.translateText("Output tokens") || "Output tokens"}</span>
                </ResizableHeaderCell>
                <ResizableHeaderCell
                  className="px-4 py-2 text-right font-medium text-gray-500"
                  resize={resizableColumns.getResize(
                    "cost",
                    translator.translateText("Cost (USD)") || "Cost (USD)",
                    ColumnWidthKind.Whole,
                  )}
                >
                  <span>{translator.translateText("Cost (USD)") || "Cost (USD)"}</span>
                </ResizableHeaderCell>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {state.kind === "loading" ? (
                <tr>
                  <td className="px-4 py-6 text-gray-500" colSpan={6}>
                    {translator.translateText("Loading usage…")}
                  </td>
                </tr>
              ) : null}

              {state.kind === "error" ? (
                <tr>
                  <td className="px-4 py-6 text-gray-500" colSpan={6}>
                    {translator.translateText(
                      "Usage could not be loaded for this time range. Try a narrower range or refresh the page.",
                    )}
                  </td>
                </tr>
              ) : null}

              {summary && shown.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-6 text-gray-500"
                    colSpan={6}
                    data-testid="llm-provider-usage-empty"
                  >
                    {translator.translateText(
                      "No usage from your provider accounts in this time range. A new connection brings in its last 30 days within a few minutes.",
                    )}
                  </td>
                </tr>
              ) : null}

              {shown.map(
                (row: LlmProviderUsageRow, index: number): ReactElement => {
                  return (
                    <tr
                      key={`${row.key || "unnamed"}-${index}`}
                      data-testid="llm-provider-usage-row"
                    >
                      <td className="px-4 py-2 text-gray-400">{index + 1}</td>
                      <td className="max-w-xs truncate px-4 py-2">
                        {renderGroup(row)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-gray-700">
                        {row.requests > 0 ? formatWhole(row.requests) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-gray-700">
                        {formatWhole(row.inputTokens)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-gray-700">
                        {formatWhole(row.outputTokens)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-gray-900">
                        {formatCost(row.costUsd)}
                        {row.costIncludesEstimate ? (
                          <span
                            className="ml-1 text-gray-400"
                            title={
                              translator.translateText(
                                "Estimated from the tokens at list price",
                              ) || ""
                            }
                          >
                            *
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default LlmProviderUsage;
