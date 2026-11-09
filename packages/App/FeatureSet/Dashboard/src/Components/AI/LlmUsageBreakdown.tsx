import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import ResizableHeaderCell from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import Service from "Common/Models/DatabaseModels/Service";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import ProjectUtil from "Common/UI/Utils/Project";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import StartAndEndDate, {
  StartAndEndDateType,
} from "Common/UI/Components/Date/StartAndEndDate";
import { getLlmProviderTitle } from "Common/Types/Telemetry/LlmProviders";
import {
  LlmUsageDimension,
  LlmUsageGroup,
  LlmUsageResponse,
  LlmUsageService,
  LlmUsageSource,
} from "Common/Types/Telemetry/LlmUsageApi";
import TelemetryServiceUtil from "Common/UI/Utils/TelemetryService";
import { fetchLlmUsage } from "./LlmObservabilityReads";
import ServiceElement from "../Service/ServiceElement";
import LlmUsageTotalsTiles from "./LlmUsageTotals";
import {
  LLM_USAGE_SOURCE_WORDS,
  getLlmUsageRowSource,
  isFromUsageMetrics,
} from "./LlmUsageSourceCopy";
import {
  formatLlmCost,
  formatLlmCount,
} from "../LlmConversations/LlmConversationFormat";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  composedValue,
  formatList,
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

const DEFAULT_WINDOW_DAYS: number = 7;

/*
 * How many groups the leaderboard shows. A manager reads a ranking, not a
 * directory: past a couple of dozen rows the page stops answering "who are the
 * biggest users" and starts being a data dump.
 */
const TOP_K_GROUPS: number = 25;

/*
 * How many services the "counted from usage metrics" line names before it
 * says how many more there are.
 */
const NAMED_METRIC_SERVICES: number = 3;

const UNATTRIBUTED_LABEL: string = translationKey("Unattributed");

const ATTRIBUTION_DOCS_URL: string = "/docs/telemetry/ai-coding-assistants";

export type LlmUsageDimensionKey =
  | LlmUsageDimension.Employee
  | LlmUsageDimension.Team
  | LlmUsageDimension.Model
  | LlmUsageDimension.Provider
  | LlmUsageDimension.Service;

interface LlmUsageDimensionOption {
  key: LlmUsageDimensionKey;
  label: string;
  columnTitle: string;
}

/*
 * Every dimension reads one /telemetry/llm/usage read: the AI calls grouped
 * on their columns (the person's email, else their id; the team; the
 * requested model; the provider; the service) and the usage metrics on the
 * attribute keys that say the same (LlmMetricUsageUtil.getGroupKeys), each
 * service counted from the signal it sends. So every dimension adds up to
 * the same totals as the tiles above it.
 */
const DIMENSIONS: Array<LlmUsageDimensionOption> = [
  {
    key: LlmUsageDimension.Employee,
    label: "Employee",
    columnTitle: translationKey("Employee"),
  },
  {
    key: LlmUsageDimension.Team,
    label: "Team",
    columnTitle: translationKey("Team / cost centre"),
  },
  {
    key: LlmUsageDimension.Model,
    label: "Model",
    columnTitle: translationKey("Model"),
  },
  {
    key: LlmUsageDimension.Provider,
    label: "Provider",
    columnTitle: translationKey("Provider"),
  },
  {
    key: LlmUsageDimension.Service,
    label: "Application / Service",
    columnTitle: translationKey("Application / Service"),
  },
];

interface LlmUsageState {
  rows: Array<LlmUsageGroup>;
  // Denominator for the share column: the totals, over ALL groups.
  totalCost: number;
  totalGroups: number;
  // The services whose tokens or cost were counted from their usage metrics.
  metricServiceIds: Array<string>;
  // The caller may not read metrics: the figures are the AI calls' alone.
  metricsLeftOut: boolean;
  isLoading: boolean;
  hasError: boolean;
}

const EMPTY_STATE: LlmUsageState = {
  rows: [],
  totalCost: 0,
  totalGroups: 0,
  metricServiceIds: [],
  metricsLeftOut: false,
  isLoading: true,
  hasError: false,
};

function getDimension(key: LlmUsageDimensionKey): LlmUsageDimensionOption {
  return (
    DIMENSIONS.find((dimension: LlmUsageDimensionOption): boolean => {
      return dimension.key === key;
    }) || DIMENSIONS[0]!
  );
}

// The read's answer, as the table draws it.
export function toLlmUsageState(usage: LlmUsageResponse): LlmUsageState {
  return {
    rows: usage.groups.slice(0, TOP_K_GROUPS),
    totalCost: usage.totals.costUsd,
    totalGroups: usage.groups.length,
    metricServiceIds: usage.services
      .filter((service: LlmUsageService): boolean => {
        return (
          isFromUsageMetrics(service.tokenSource) ||
          isFromUsageMetrics(service.costSource)
        );
      })
      .map((service: LlmUsageService): string => {
        return service.serviceId;
      }),
    metricsLeftOut: usage.metricsLeftOut,
    isLoading: false,
    hasError: false,
  };
}

const LlmUsageBreakdown: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [dimensionKey, setDimensionKey] = useState<LlmUsageDimensionKey>(
    LlmUsageDimension.Employee,
  );

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

  const dimension: LlmUsageDimensionOption = useMemo(() => {
    return getDimension(dimensionKey);
  }, [dimensionKey]);

  /*
   * The table's columns as wide as a person makes them (Common's
   * Table/ColumnResize), after each row's number: what the rows are, then
   * their counts, which are never cut.
   */
  const resizableColumns: ResizableColumns = useResizableColumns({
    tableKey: "llm-usage-breakdown-table",
    columns: [
      { id: "group", cellNumber: 2 },
      { id: "calls", cellNumber: 3 },
      { id: "inputTokens", cellNumber: 4 },
      { id: "outputTokens", cellNumber: 5 },
      { id: "totalTokens", cellNumber: 6 },
      { id: "cost", cellNumber: 7 },
      { id: "share", cellNumber: 8 },
    ],
  });

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

      /*
       * One read for the whole table: each group's calls, tokens and cost,
       * every group (the share column's denominator is the totals, so the
       * percentages never lie), ranked by cost on the server.
       */
      let read: LlmUsageResponse | null = null;

      try {
        read = await fetchLlmUsage({
          range: range,
          dimension: dimension.key,
        });
      } catch {
        read = null;
      }

      if (cancelled) {
        return;
      }

      /*
       * A failed read is the error state INSTEAD of the table: a table of
       * zeros would claim, in the one column the page exists to report,
       * that nobody spent anything.
       */
      setUsage(
        read
          ? toLlmUsageState(read)
          : { ...EMPTY_STATE, isLoading: false, hasError: true },
      );
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [range, dimension]);

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  // A service id as the reader knows it: its name, else the id itself.
  const getServiceName: (serviceId: string, sentence: Translator) => string = (
    serviceId: string,
    sentence: Translator,
  ): string => {
    if (TelemetryServiceUtil.isUnknownServiceId(serviceId, projectId)) {
      return (
        TelemetryServiceUtil.getUnknownService(projectId!, sentence).name || ""
      );
    }

    const telemetryService: Service | undefined = telemetryServices.find(
      (service: Service): boolean => {
        return service.id?.toString() === serviceId;
      },
    );

    return (
      TelemetryServiceUtil.getServiceDisplayName(
        telemetryService?.name,
        sentence,
      ) || serviceId
    );
  };

  type RenderDimensionValueFunction = (row: LlmUsageGroup) => ReactElement;

  const renderDimensionValue: RenderDimensionValueFunction = (
    row: LlmUsageGroup,
  ): ReactElement => {
    if (!row.key) {
      /*
       * Never silently dropped. An unattributed row is a real bucket of
       * spend; hiding it would make this page's totals disagree with the
       * conversation tiles and the budgets, and quietly understate the bill.
       */
      return (
        <span
          className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
          data-testid="llm-usage-unattributed"
        >
          {translator.translateText(UNATTRIBUTED_LABEL)}
        </span>
      );
    }

    if (dimension.key === LlmUsageDimension.Service) {
      // Telemetry that named no service: the project's "Unknown Service".
      if (
        projectId &&
        TelemetryServiceUtil.isUnknownServiceId(row.key, projectId)
      ) {
        return (
          <ServiceElement
            service={TelemetryServiceUtil.getUnknownService(
              projectId,
              translator,
            )}
          />
        );
      }

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

    if (dimension.key === LlmUsageDimension.Provider) {
      // "Azure OpenAI", not "azure.ai.openai".
      return (
        <span className="text-sm text-gray-900">
          {getLlmProviderTitle(row.key) || row.key}
        </span>
      );
    }

    return <span className="text-sm text-gray-900">{row.key}</span>;
  };

  /*
   * Where a row's figures came from, under its name, when not from AI calls
   * alone: a coding tool's usage metrics have no rows in the Calls list,
   * and an unlabelled figure would read as a contradiction of it.
   */
  const renderRowSource: (row: LlmUsageGroup) => ReactElement | null = (
    row: LlmUsageGroup,
  ): ReactElement | null => {
    const source: LlmUsageSource = getLlmUsageRowSource(row);

    if (!isFromUsageMetrics(source)) {
      return null;
    }

    return (
      <div
        className="mt-0.5 text-xs text-gray-500"
        data-testid="llm-usage-row-source"
      >
        {translator.translateText(LLM_USAGE_SOURCE_WORDS[source])}
      </div>
    );
  };

  // A metrics-only row counted no call: "—", never a 0 that claims none were made.
  const isMetricsOnly: (row: LlmUsageGroup) => boolean = (
    row: LlmUsageGroup,
  ): boolean => {
    return (
      row.calls === 0 && getLlmUsageRowSource(row) === LlmUsageSource.Metrics
    );
  };

  const renderCount: (value: number, unknown: boolean) => string = (
    value: number,
    unknown: boolean,
  ): string => {
    return unknown ? "—" : formatLlmCount(value);
  };

  type RenderShareFunction = (row: LlmUsageGroup) => ReactElement;

  const renderShare: RenderShareFunction = (
    row: LlmUsageGroup,
  ): ReactElement => {
    if (usage.totalCost <= 0) {
      return <span className="text-gray-400">—</span>;
    }

    const share: number = (row.costUsd / usage.totalCost) * 100;

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

  /*
   * The services counted from their usage metrics, named: the first few,
   * then how many more ("+2"), in the sentence's language.
   */
  const metricServices: ReactElement | null =
    !usage.isLoading && !usage.hasError && usage.metricServiceIds.length > 0 ? (
      <div
        className="text-sm text-gray-500"
        data-testid="llm-usage-metric-services"
      >
        {translator.translateTemplate(
          "Services counted from usage metrics: {{services}}",
          {
            services: composedValue((sentence: Translator): string => {
              const names: Array<string> = usage.metricServiceIds
                .slice(0, NAMED_METRIC_SERVICES)
                .map((serviceId: string): string => {
                  return getServiceName(serviceId, sentence);
                });
              const more: number =
                usage.metricServiceIds.length - NAMED_METRIC_SERVICES;

              if (more > 0) {
                names.push(`+${sentence.formatNumber(more)}`);
              }

              return formatList(names, sentence);
            }),
          },
        )}
      </div>
    ) : null;

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
              {translator.translateText("Who is spending what")}
            </div>
            <div className="mt-0.5 text-sm text-gray-600">
              {translator.translateText(
                "LLM spend and token usage for the selected time range, ranked by cost. Switch the dimension to see it broken down by employee, team, model, provider, or the application that made the call.",
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={translator.translateText("Usage dimension")}
        >
          {DIMENSIONS.map((option: LlmUsageDimensionOption): ReactElement => {
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
                {translator.translateText(option.label)}
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

      {/*
       * The range's totals: what a coding-assistant fleet, which has no
       * conversations, reads its token and cost totals from.
       */}
      <LlmUsageTotalsTiles range={range} />

      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-col gap-1 border-b border-gray-200 p-4">
          <div className="text-base font-medium text-gray-900">
            {translator.translateTemplate("Usage by {{dimension}}", {
              dimension: translatableTerm(dimension.label, {
                inSentence: true,
              }),
            })}
          </div>
          {/*
           * Only over rows it counts: while the table loads, when it could
           * not be read, or when it is empty, "Top 25 of 0" says nothing
           * true.
           */}
          {!usage.isLoading && !usage.hasError && usage.totalGroups > 0 ? (
            <div
              className="text-sm text-gray-500"
              data-testid="llm-usage-breakdown-top"
            >
              {translator.translateTemplate(
                "Top {{top}} of {{total}} by cost over the selected range.",
                {
                  top: translator.formatNumber(TOP_K_GROUPS),
                  total: translator.formatNumber(usage.totalGroups),
                },
              )}
            </div>
          ) : (
            <></>
          )}
          {metricServices}
          {!usage.isLoading && !usage.hasError && usage.metricsLeftOut ? (
            <div
              className="text-sm text-amber-700"
              data-testid="llm-usage-metrics-left-out"
            >
              {translator.translateText(
                "Usage metrics are left out: your role cannot read metrics.",
              )}
            </div>
          ) : null}
        </div>

        {/*
         * Attribution is only as good as what the emitter sent. Saying so
         * plainly here is the difference between a manager trusting the
         * Unattributed row and filing a bug about it.
         */}
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-600">
          <TranslatedSentence
            template="Calls appear under {{unattributed}} when the emitter did not send an identity attribute (for example {{userEmail}} or {{teamId}}). They are still counted here, so these totals include every call."
            values={{
              unattributed: translator.translateText(
                UNATTRIBUTED_LABEL,
              ) as string,
            }}
            slots={{
              userEmail: <code>user.email</code>,
              teamId: <code>team.id</code>,
            }}
          />{" "}
          <a
            className="font-medium text-violet-700 hover:underline"
            href={ATTRIBUTION_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {translator.translateText(
              "How to attribute AI coding assistant usage",
            )}
          </a>
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
                    translator.translateText(dimension.columnTitle) ||
                      dimension.columnTitle,
                    ColumnWidthKind.Name,
                  )}
                >
                  <span>
                    {translator.translateText(dimension.columnTitle) ||
                      dimension.columnTitle}
                  </span>
                </ResizableHeaderCell>
                <ResizableHeaderCell
                  className="px-4 py-2 text-right font-medium text-gray-500"
                  resize={resizableColumns.getResize(
                    "calls",
                    translator.translateText("Calls") || "Calls",
                    ColumnWidthKind.Whole,
                  )}
                >
                  <span>{translator.translateText("Calls")}</span>
                </ResizableHeaderCell>
                <ResizableHeaderCell
                  className="px-4 py-2 text-right font-medium text-gray-500"
                  resize={resizableColumns.getResize(
                    "inputTokens",
                    translator.translateText("Input tokens") || "Input tokens",
                    ColumnWidthKind.Whole,
                  )}
                >
                  <span>{translator.translateText("Input tokens")}</span>
                </ResizableHeaderCell>
                <ResizableHeaderCell
                  className="px-4 py-2 text-right font-medium text-gray-500"
                  resize={resizableColumns.getResize(
                    "outputTokens",
                    translator.translateText("Output tokens") ||
                      "Output tokens",
                    ColumnWidthKind.Whole,
                  )}
                >
                  <span>{translator.translateText("Output tokens")}</span>
                </ResizableHeaderCell>
                <ResizableHeaderCell
                  className="px-4 py-2 text-right font-medium text-gray-500"
                  resize={resizableColumns.getResize(
                    "totalTokens",
                    translator.translateText("Total tokens") || "Total tokens",
                    ColumnWidthKind.Whole,
                  )}
                >
                  <span>{translator.translateText("Total tokens")}</span>
                </ResizableHeaderCell>
                <ResizableHeaderCell
                  className="px-4 py-2 text-right font-medium text-gray-500"
                  resize={resizableColumns.getResize(
                    "cost",
                    translator.translateText("Cost (USD)") || "Cost (USD)",
                    ColumnWidthKind.Whole,
                  )}
                >
                  <span>{translator.translateText("Cost (USD)")}</span>
                </ResizableHeaderCell>
                <ResizableHeaderCell
                  className="px-4 py-2 text-left font-medium text-gray-500"
                  resize={resizableColumns.getResize(
                    "share",
                    translator.translateText("Share") || "Share",
                    ColumnWidthKind.Whole,
                  )}
                >
                  <span>{translator.translateText("Share")}</span>
                </ResizableHeaderCell>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {usage.isLoading ? (
                <tr>
                  <td className="px-4 py-6 text-gray-500" colSpan={8}>
                    {translator.translateText("Loading usage…")}
                  </td>
                </tr>
              ) : null}

              {!usage.isLoading && usage.hasError ? (
                <tr>
                  <td className="px-4 py-6 text-gray-500" colSpan={8}>
                    {translator.translateText(
                      "Usage could not be loaded for this time range. Try a narrower range or refresh the page.",
                    )}
                  </td>
                </tr>
              ) : null}

              {!usage.isLoading &&
              !usage.hasError &&
              usage.rows.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-gray-500" colSpan={8}>
                    {translator.translateText(
                      "No LLM usage found in this time range.",
                    )}
                  </td>
                </tr>
              ) : null}

              {!usage.isLoading
                ? usage.rows.map(
                    (row: LlmUsageGroup, index: number): ReactElement => {
                      const metricsOnly: boolean = isMetricsOnly(row);
                      const noTokens: boolean =
                        row.tokenSource === LlmUsageSource.None &&
                        row.calls === 0;

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
                            {renderRowSource(row)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs text-gray-700">
                            {renderCount(row.calls, metricsOnly)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs text-gray-700">
                            {renderCount(row.inputTokens, noTokens)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs text-gray-700">
                            {renderCount(row.outputTokens, noTokens)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs text-gray-700">
                            {renderCount(row.totalTokens, noTokens)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs text-gray-900">
                            {formatLlmCost(row.costUsd)}
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
