import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Host from "Common/Models/DatabaseModels/Host";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import {
  ErrorFunction,
  PromiseVoidFunction,
  VoidFunction,
} from "Common/Types/FunctionTypes";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Table from "Common/UI/Components/Table/Table";
import { TableEmptyStateProps } from "Common/UI/Components/Table/TableEmptyState";
import { getFilteredEmptyStateProps } from "Common/UI/Components/Table/TableEmptyStateBuilders";
import Column from "Common/UI/Components/Table/Types/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Route from "Common/Types/API/Route";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { HOST_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/HostMetricDescriptions";
import {
  DEFAULT_PROCESS_SORT,
  PROCESS_CPU_UTILIZATION_METRIC_NAME,
  PROCESS_MEMORY_USAGE_METRIC_NAME,
  ProcessMetricDatapoint,
  ProcessRollup,
  ProcessRow,
  ProcessSort,
  buildProcessRows,
  filterProcessRows,
  isProcessFetchCutOff,
  processCpuWaitExclusion,
  resolveProcessSort,
  sortProcessRows,
} from "../Utils/Processes";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

const formatPercent: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
};

const formatBytes: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  const units: Array<string> = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v: number = value;
  let i: number = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
};

/*
 * Processes are ephemeral — pids come and go on every collector scrape
 * (typically every 30s). 15 minutes balances "show recent processes"
 * with "don't show ghosts that exited 30 minutes ago". A user who needs
 * a fresher snapshot can hit Refresh.
 */
const PROCESS_LOOKBACK_MINUTES: number = 15;

/*
 * Newest-first readings per metric. Memory sends one reading per process
 * per scrape and CPU two once its wait readings are filtered out, so the
 * newest scrape fits whole for up to 2000 and 1000 processes. Past that the
 * description says the list is incomplete instead of letting a search come
 * back empty for a process that is running.
 */
const PROCESS_FETCH_LIMIT: number = 2000;

const PAGE_SIZE: number = 25;

const cpuBarColor: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null) {
    return "bg-gray-300";
  }
  if (value >= 80) {
    return "bg-red-500";
  }
  if (value >= 50) {
    return "bg-amber-500";
  }
  return "bg-blue-500";
};

const memBarColor: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null) {
    return "bg-gray-300";
  }
  if (value >= 20) {
    return "bg-red-500";
  }
  if (value >= 10) {
    return "bg-amber-500";
  }
  return "bg-violet-500";
};

const toDatapoints: (
  result: ListResult<Metric>,
) => Array<ProcessMetricDatapoint> = (
  result: ListResult<Metric>,
): Array<ProcessMetricDatapoint> => {
  return result.data.map((metric: Metric): ProcessMetricDatapoint => {
    return {
      time: metric.time as Date | undefined,
      value: metric.value as number | undefined,
      attributes: (metric.attributes as Record<string, unknown>) || {},
    };
  });
};

const HostProcesses: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [host, setHost] = useState<Host | null>(null);
  const [rows, setRows] = useState<Array<ProcessRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [latestSampleAt, setLatestSampleAt] = useState<Date | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  /*
   * True only when a fetch cap could actually have hidden processes: a
   * fetch took the full limit without reaching back past the newest scrape.
   */
  const [isSnapshotTruncated, setIsSnapshotTruncated] =
    useState<boolean>(false);

  const [searchText, setSearchText] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE);
  const [sort, setSort] = useState<ProcessSort>(DEFAULT_PROCESS_SORT);

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: Host | null = await ModelAPI.getItem({
        modelType: Host,
        id: modelId,
        select: {
          hostIdentifier: true,
          name: true,
          totalMemoryBytes: true,
        },
      });

      if (!item?.hostIdentifier) {
        setError("Host not found.");
        setIsLoading(false);
        return;
      }

      setHost(item);

      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveMinutes(
        endDate,
        -PROCESS_LOOKBACK_MINUTES,
      );
      const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();

      const buildQuery: (
        metricName: string,
        extraAttributes: Record<string, NotEqual<string>>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) => any = (
        metricName: string,
        extraAttributes: Record<string, NotEqual<string>>,
      ) => {
        return {
          modelType: Metric,
          query: {
            projectId: projectId,
            name: metricName,
            time: new InBetween<Date>(startDate, endDate),
            attributes: {
              "resource.host.name": item.hostIdentifier,
              ...extraAttributes,
            },
          },
          limit: PROCESS_FETCH_LIMIT,
          skip: 0,
          select: {
            time: true,
            value: true,
            attributes: true,
          },
          sort: {
            time: SortOrder.Descending,
          },
          requestOptions: {},
        };
      };

      /*
       * We derive memory % client-side from `process.memory.usage`
       * (RSS bytes) and `host.totalMemoryBytes` instead of trusting
       * `process.memory.utilization`. Windows OTel emits that metric
       * in percent (0–100) while the spec — and Linux —  emits it as
       * a fraction (0–1), so a single `* 100` scaling can't be right
       * for both. The usage / total ratio is OS-agnostic and stays
       * consistent with the bytes column the user sees alongside.
       */
      const [cpuResult, memBytesResult]: [
        ListResult<Metric>,
        ListResult<Metric>,
      ] = await Promise.all([
        AnalyticsModelAPI.getList<Metric>(
          buildQuery(
            PROCESS_CPU_UTILIZATION_METRIC_NAME,
            processCpuWaitExclusion(),
          ),
        ),
        AnalyticsModelAPI.getList<Metric>(
          buildQuery(PROCESS_MEMORY_USAGE_METRIC_NAME, {}),
        ),
      ]);

      const cpuDatapoints: Array<ProcessMetricDatapoint> =
        toDatapoints(cpuResult);
      const memoryDatapoints: Array<ProcessMetricDatapoint> =
        toDatapoints(memBytesResult);

      const rollup: ProcessRollup = buildProcessRows({
        cpuDatapoints: cpuDatapoints,
        memoryDatapoints: memoryDatapoints,
        totalMemoryBytes:
          item.totalMemoryBytes !== undefined && item.totalMemoryBytes !== null
            ? Number(item.totalMemoryBytes)
            : null,
      });

      setRows(rollup.rows);
      setLatestSampleAt(rollup.latestSampleAt);
      setIsSnapshotTruncated(
        isProcessFetchCutOff(cpuDatapoints, PROCESS_FETCH_LIMIT) ||
          isProcessFetchCutOff(memoryDatapoints, PROCESS_FETCH_LIMIT),
      );
      setRefreshedAt(OneUptimeDate.getCurrentDate());
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  const processViewRouteFor: (row: ProcessRow) => Route | null = (
    row: ProcessRow,
  ): Route | null => {
    if (!row.pid) {
      return null;
    }
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.HOST_VIEW_PROCESS_VIEW] as Route,
      {
        modelId: modelId,
        subModelId: row.pid,
      },
    );
  };

  // Search + sort, all client-side over the snapshot.
  const processedData: Array<ProcessRow> = useMemo(() => {
    return sortProcessRows(
      filterProcessRows(rows, searchText),
      sort.sortBy,
      sort.sortOrder,
    );
  }, [rows, searchText, sort]);

  /*
   * A refresh can shrink the data set (processes age out of the 15-minute
   * window), so clamp instead of trusting currentPage — otherwise the
   * user is stranded on a page past the end, staring at an empty table.
   */
  const totalPages: number = Math.max(
    1,
    Math.ceil(processedData.length / pageSize),
  );
  const effectivePage: number = Math.min(currentPage, totalPages);

  const paginatedData: Array<ProcessRow> = useMemo(() => {
    const start: number = (effectivePage - 1) * pageSize;
    return processedData.slice(start, start + pageSize);
  }, [processedData, effectivePage, pageSize]);

  const hasActiveSearch: boolean = searchText.trim() !== "";

  const tableColumns: Array<Column<ProcessRow>> = useMemo(() => {
    return [
      {
        title: "Process",
        type: FieldType.Element,
        key: "executable",
        getElement: (row: ProcessRow): ReactElement => {
          const route: Route | null = processViewRouteFor(row);
          const name: string | undefined =
            row.executable || translator.translateText("(unknown)");
          const nameNode: ReactElement = route ? (
            <Link
              to={route}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-900 truncate"
            >
              {name}
            </Link>
          ) : (
            <span className="text-sm font-medium text-gray-900 truncate">
              {name}
            </span>
          );
          return (
            <div className="min-w-0">
              <div className="flex items-center">{nameNode}</div>
              {row.command && (
                <div className="text-xs text-gray-500 font-mono truncate max-w-xl">
                  {row.command}
                </div>
              )}
            </div>
          );
        },
      },
      {
        title: "PID",
        type: FieldType.Element,
        key: "pid",
        getElement: (row: ProcessRow): ReactElement => {
          return (
            <span className="text-sm font-mono tabular-nums text-gray-600">
              {row.pid || "—"}
            </span>
          );
        },
      },
      {
        title: "User",
        type: FieldType.Text,
        key: "user",
        hideOnMobile: true,
      },
      {
        title: "CPU",
        type: FieldType.Element,
        key: "cpuPercent",
        headerTooltip: HOST_METRIC_DESCRIPTIONS.processListCpu,
        getElement: (row: ProcessRow): ReactElement => {
          const pct: number = Math.min(100, Math.max(0, row.cpuPercent ?? 0));
          return (
            <div className="flex items-center gap-3 min-w-[140px]">
              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-1.5 rounded-full ${cpuBarColor(row.cpuPercent)}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-sm font-mono tabular-nums text-gray-900 w-14 text-right">
                {formatPercent(row.cpuPercent)}
              </span>
            </div>
          );
        },
      },
      {
        title: "Memory",
        type: FieldType.Element,
        key: "memoryBytes",
        headerTooltip: HOST_METRIC_DESCRIPTIONS.processListMemory,
        getElement: (row: ProcessRow): ReactElement => {
          const pct: number = Math.min(
            100,
            Math.max(0, row.memoryPercent ?? 0),
          );
          return (
            <div className="flex items-center gap-3 min-w-[160px]">
              <div className="flex-1">
                <div className="text-sm font-mono tabular-nums text-gray-900">
                  {formatBytes(row.memoryBytes)}
                </div>
                {row.memoryPercent !== null && (
                  <div className="mt-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-1 rounded-full ${memBarColor(row.memoryPercent)}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
              <span className="text-xs font-mono tabular-nums text-gray-500 w-12 text-right">
                {row.memoryPercent !== null
                  ? formatPercent(row.memoryPercent)
                  : "—"}
              </span>
            </div>
          );
        },
      },
      {
        title: "",
        type: FieldType.Actions,
        key: null,
        disableSort: true,
      },
    ];
  }, [modelId, translator.language]);

  const actionButtons: Array<ActionButtonSchema<ProcessRow>> = [
    {
      title: "View",
      icon: IconProp.Eye,
      buttonStyleType: ButtonStyleType.NORMAL,
      isVisible: (row: ProcessRow): boolean => {
        return processViewRouteFor(row) !== null;
      },
      onClick: (
        row: ProcessRow,
        onCompleteAction: VoidFunction,
        onError: ErrorFunction,
      ): void => {
        try {
          const route: Route | null = processViewRouteFor(row);
          if (route) {
            Navigation.navigate(route);
          }
          onCompleteAction();
        } catch (err) {
          onError(err as Error);
        }
      },
    },
  ];

  const cardButtons: Array<CardButtonSchema> = [
    {
      title: "",
      buttonStyle: ButtonStyleType.ICON,
      className: "py-0 pr-0 pl-1 mt-1",
      onClick: () => {
        fetchData().catch(() => {});
      },
      icon: IconProp.Refresh,
    },
  ];

  const description: ReactElement = (() => {
    const parts: Array<string> = [
      `Latest snapshot of processes on this host (last ${PROCESS_LOOKBACK_MINUTES} minutes).`,
    ];
    if (latestSampleAt) {
      parts.push(`Latest sample ${OneUptimeDate.fromNow(latestSampleAt)}.`);
    }
    if (refreshedAt) {
      parts.push(`Refreshed ${OneUptimeDate.fromNow(refreshedAt)}.`);
    }
    if (isSnapshotTruncated) {
      parts.push(
        `This host reports more processes than this page can load at once, so some may be missing or show no CPU or memory reading — narrow the collector's "process" scraper with include or exclude filters to see a complete list.`,
      );
    }
    return <span>{parts.join(" ")}</span>;
  })();

  const clearSearch: VoidFunction = (): void => {
    setSearchText("");
    setCurrentPage(1);
  };

  const filterBar: ReactElement = (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
      <div className="relative w-full sm:w-96">
        <Icon
          icon={IconProp.Search}
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
        />
        <input
          type="text"
          value={searchText}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setSearchText(e.target.value);
            setCurrentPage(1);
          }}
          placeholder={translator.translateText(
            "Search by name, PID, user or path...",
          )}
          aria-label={translator.translateText("Search processes")}
          className="w-full rounded-md border border-gray-200 bg-gray-50 py-1.5 pl-7 pr-2 text-sm placeholder-gray-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
      </div>
      {hasActiveSearch && (
        <button
          type="button"
          onClick={clearSearch}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
        >
          {translator.translateText("Clear search")}
        </button>
      )}
      <span className="ml-auto text-xs text-gray-500">
        {hasActiveSearch
          ? translator.translatePlural(
              {
                one: "{{shown}} of {{count}} process",
                other: "{{shown}} of {{count}} processes",
              },
              rows.length,
              { shown: translator.formatNumber(processedData.length) },
            )
          : translator.translatePlural(
              { one: "{{count}} process", other: "{{count}} processes" },
              rows.length,
            )}
      </span>
    </div>
  );

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!host) {
    return <ErrorMessage message="Host not found." />;
  }

  /*
   * Blame the search only when there is data it filtered out — when the
   * fetch itself came back empty, the collector guidance is the actionable
   * message no matter what was typed.
   */
  const noItemsMessage: string =
    rows.length === 0
      ? `No process metrics in the last ${PROCESS_LOOKBACK_MINUTES} minutes. Enable the "process" scraper in your OTel collector "hostmetrics" receiver to see per-process CPU, memory, and ownership here. The Documentation tab has a ready-to-paste config snippet.`
      : translationKey("No processes match your search.");

  /*
   * Rows came back and the search hides every one of them: a filtered empty
   * state, with the bar's own Clear search as its way back.
   */
  const filteredEmptyState: TableEmptyStateProps | undefined =
    rows.length > 0
      ? getFilteredEmptyStateProps({
          title: noItemsMessage,
          clearTitle: "Clear search",
          onClear: clearSearch,
        })
      : undefined;

  return (
    <Card title="Processes" description={description} buttons={cardButtons}>
      <div>
        {(rows.length > 0 || hasActiveSearch) && filterBar}
        <Table<ProcessRow>
          id="host-processes-table"
          columns={tableColumns}
          actionButtons={actionButtons}
          data={paginatedData}
          singularLabel="Process"
          pluralLabel="Processes"
          isLoading={false}
          error=""
          currentPageNumber={effectivePage}
          totalItemsCount={processedData.length}
          itemsOnPage={pageSize}
          onNavigateToPage={(page: number, itemsOnPage: number) => {
            setCurrentPage(page);
            if (itemsOnPage > 0) {
              setPageSize(itemsOnPage);
            }
          }}
          sortOrder={sort.sortOrder}
          sortBy={sort.sortBy}
          onSortChanged={(
            newSortBy: keyof ProcessRow | null,
            newSortOrder: SortOrder,
          ) => {
            setSort((current: ProcessSort): ProcessSort => {
              return resolveProcessSort({
                current: current,
                requestedSortBy: newSortBy,
                requestedSortOrder: newSortOrder,
              });
            });
            setCurrentPage(1);
          }}
          noItemsMessage={noItemsMessage}
          emptyStateProps={filteredEmptyState}
        />
      </div>
    </Card>
  );
};

export default HostProcesses;
