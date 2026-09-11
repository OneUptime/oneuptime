import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DashboardSloListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardSloListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import DashboardResourceListBase, {
  ResourceListColumn,
} from "./DashboardResourceListBase";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Label from "Common/Models/DatabaseModels/Label";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import DashboardResourceList from "../Utils/DashboardResourceList";
import DashboardLabelVariable from "Common/Utils/Dashboard/LabelVariable";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import ObjectID from "Common/Types/ObjectID";
import Query from "Common/Types/BaseDatabase/Query";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import JSONFunctions from "Common/Types/JSONFunctions";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import AppLink from "../../AppLink/AppLink";
import SloStatusPill from "../../Slo/SloStatusPill";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import { Gray500 } from "Common/Types/BrandColors";
import {
  filterSloOverviewItems,
  getSloOverviewCounts,
  hasCurrentSloOverviewEvaluation,
  SloOverviewCounts,
  SloOverviewStatusFilter,
  sortSloOverviewItems,
} from "Common/Utils/Slo/SloOverview";
import {
  formatErrorBudgetRemainingSeconds,
  formatSloBurnRate,
} from "Common/Utils/Slo/SloWidgetFormat";
import {
  getSloBudgetTier,
  SloBudgetTier,
} from "Common/Utils/Slo/SloHealth";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardSloListComponent;
}

const PRIVATE_COLUMNS: Array<ResourceListColumn> = [
  { label: "SLO", widthPct: "21%" },
  { label: "Service / Monitor", widthPct: "17%" },
  { label: "Target & Window", widthPct: "14%" },
  { label: "Current SLI", widthPct: "11%" },
  { label: "Error Budget", widthPct: "19%" },
  { label: "Burn Rate", widthPct: "9%" },
  { label: "Status", widthPct: "9%" },
];

const PUBLIC_COLUMNS: Array<ResourceListColumn> = [
  { label: "SLO", widthPct: "26%" },
  { label: "Target", widthPct: "13%" },
  { label: "Current SLI", widthPct: "13%" },
  { label: "Error Budget", widthPct: "25%" },
  { label: "Burn Rate", widthPct: "11%" },
  { label: "Status", widthPct: "12%" },
];

const BUDGET_BAR_CLASS: Record<SloBudgetTier, string> = {
  [SloBudgetTier.Healthy]: "bg-emerald-500",
  [SloBudgetTier.AtRisk]: "bg-amber-500",
  [SloBudgetTier.Exhausted]: "bg-red-500",
  [SloBudgetTier.Unknown]: "bg-gray-300",
};

interface FilterOption {
  value: string;
  label: string;
}

interface SummaryCard {
  status: SloOverviewStatusFilter;
  label: string;
  count: number;
  activeClassName: string;
  countClassName: string;
}

function formatPercent(value: number | undefined | null): string {
  if (typeof value !== "number" || !isFinite(value)) {
    return "—";
  }

  return `${Math.round(value * 1000) / 1000}%`;
}

function getWindowLabel(slo: ServiceLevelObjective): string {
  if (slo.windowType === SloWindowType.CalendarMonth) {
    return slo.timezone ? `Calendar month · ${slo.timezone}` : "Calendar month";
  }

  if (slo.windowType === undefined && slo.windowDays === undefined) {
    return "—";
  }

  return `${slo.windowDays || 30} days rolling`;
}

function getModelId(item: Monitor | Label): string {
  if (item.id) {
    return item.id.toString();
  }

  return typeof item._id === "string" ? item._id : "";
}

function getRelatedOptions(
  slos: Array<ServiceLevelObjective>,
  relation: "monitors" | "labels",
): Array<FilterOption> {
  const byId: Map<string, string> = new Map<string, string>();

  for (const slo of slos) {
    for (const item of (slo[relation] || []) as Array<Monitor | Label>) {
      const id: string = getModelId(item);
      const name: string = item.name || "Unnamed";

      if (id) {
        byId.set(id, name);
      }
    }
  }

  return Array.from(byId.entries())
    .map(([value, label]: [string, string]): FilterOption => {
      return { value, label };
    })
    .sort((first: FilterOption, second: FilterOption): number => {
      return first.label.localeCompare(second.label);
    });
}

const DashboardSloListComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [slos, setSlos] = useState<Array<ServiceLevelObjective>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>("");
  const [monitorId, setMonitorId] = useState<string>("");
  const [labelId, setLabelId] = useState<string>("");
  const [status, setStatus] = useState<SloOverviewStatusFilter>(
    SloOverviewStatusFilter.All,
  );
  const requestVersion: React.MutableRefObject<number> = useRef<number>(0);
  const isPublic: boolean = DashboardResourceList.isPublic();

  const maxRows: number = Math.min(
    Math.max(Math.trunc(props.component.arguments.maxRows || 50), 1),
    10000,
  );
  const sloStatuses: Array<string> | undefined =
    props.component.arguments.sloStatuses;
  const monitorIds: Array<string> | undefined =
    props.component.arguments.monitorIds;
  const labelIds: Array<string> | undefined = props.component.arguments.labelIds;
  const labelVariableId: string | undefined =
    props.component.arguments.labelVariableId;

  const sloStatusesKey: string = (sloStatuses || []).join(",");
  const monitorIdsKey: string = (monitorIds || []).join(",");
  const labelIdsKey: string = (labelIds || []).join(",");

  const fetchSlos: () => Promise<void> = useCallback(async (): Promise<void> => {
    const version: number = ++requestVersion.current;
    setIsLoading(true);

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!DashboardResourceList.isPublic() && !projectId) {
      setError("No project selected.");
      setIsLoading(false);
      return;
    }

    try {
      const query: Query<ServiceLevelObjective> = {
        projectId,
      } as Query<ServiceLevelObjective>;

      if (sloStatuses && sloStatuses.length > 0) {
        query.sloStatus = new Includes(sloStatuses) as never;
      }

      if (monitorIds && monitorIds.length > 0) {
        query.monitors = new Includes(monitorIds) as never;
      }

      const labelFilter: ReturnType<typeof DashboardLabelVariable.getFilter> =
        DashboardLabelVariable.getFilter({
          labelIds,
          labelVariableId,
          variables: props.variables,
        });
      if (labelFilter) {
        query.labels = labelFilter as never;
      }

      const listResult: ListResult<ServiceLevelObjective> =
        await ModelAPI.getList<ServiceLevelObjective>({
          modelType: ServiceLevelObjective,
          requestOptions: DashboardResourceList.getRequestOptions("slo", {
            componentId: props.componentId,
            variables: props.variables,
          }),
          query,
          // Interactive name, service and label filters run locally so they
          // can react instantly. Fetch the bounded project fleet, then apply
          // maxRows only after filtering; otherwise rows after the first
          // alphabetical page can never be found.
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            targetPercentage: true,
            windowType: true,
            windowDays: true,
            timezone: true,
            currentSliPercentage: true,
            errorBudgetRemainingPercentage: true,
            errorBudgetRemainingSeconds: true,
            currentBurnRate: true,
            sloStatus: true,
            isEnabled: true,
            atRiskThresholdPercentage: true,
            monitors: {
              _id: true,
              name: true,
            },
            labels: {
              _id: true,
              name: true,
              color: true,
            },
          },
          sort: {
            name: SortOrder.Ascending,
          },
        });

      if (version !== requestVersion.current) {
        return;
      }

      setSlos(listResult.data);
      setError(null);
    } catch (err: unknown) {
      if (version !== requestVersion.current) {
        return;
      }

      setError(API.getFriendlyErrorMessage(err as Error));
    }

    if (version === requestVersion.current) {
      setIsLoading(false);
    }
  }, [
    maxRows,
    sloStatusesKey,
    monitorIdsKey,
    labelIdsKey,
    labelVariableId,
    props.componentId,
    props.variables,
  ]);

  useEffect(() => {
    fetchSlos().catch(() => {
      // Error state is handled inside fetchSlos.
    });

    return () => {
      requestVersion.current++;
    };
  }, [fetchSlos, props.refreshTick]);

  const monitorOptions: Array<FilterOption> = useMemo(() => {
    return getRelatedOptions(slos, "monitors");
  }, [slos]);
  const labelOptions: Array<FilterOption> = useMemo(() => {
    return getRelatedOptions(slos, "labels");
  }, [slos]);

  useEffect(() => {
    if (
      monitorId &&
      !monitorOptions.some((option: FilterOption): boolean => {
        return option.value === monitorId;
      })
    ) {
      setMonitorId("");
    }
  }, [monitorId, monitorOptions]);

  useEffect(() => {
    if (
      labelId &&
      !labelOptions.some((option: FilterOption): boolean => {
        return option.value === labelId;
      })
    ) {
      setLabelId("");
    }
  }, [labelId, labelOptions]);

  const scopedSlos: Array<ServiceLevelObjective> = useMemo(() => {
    return filterSloOverviewItems(slos, {
      search,
      monitorId,
      labelId,
      status: SloOverviewStatusFilter.All,
    });
  }, [slos, search, monitorId, labelId]);

  const counts: SloOverviewCounts = useMemo(() => {
    return getSloOverviewCounts(scopedSlos);
  }, [scopedSlos]);

  const visibleSlos: Array<ServiceLevelObjective> = useMemo(() => {
    return sortSloOverviewItems(
      filterSloOverviewItems(scopedSlos, {
        status,
      }),
    ).slice(0, maxRows);
  }, [scopedSlos, status, maxRows]);

  const summaryCards: Array<SummaryCard> = [
    {
      status: SloOverviewStatusFilter.All,
      label: "All SLOs",
      count: counts.total,
      activeClassName: "border-indigo-400 bg-indigo-50",
      countClassName: "text-indigo-700",
    },
    {
      status: SloOverviewStatusFilter.Healthy,
      label: "Healthy",
      count: counts.healthy,
      activeClassName: "border-emerald-400 bg-emerald-50",
      countClassName: "text-emerald-700",
    },
    {
      status: SloOverviewStatusFilter.AtRisk,
      label: "At Risk",
      count: counts.atRisk,
      activeClassName: "border-amber-400 bg-amber-50",
      countClassName: "text-amber-700",
    },
    {
      status: SloOverviewStatusFilter.BudgetExhausted,
      label: "Breached",
      count: counts.budgetExhausted,
      activeClassName: "border-red-400 bg-red-50",
      countClassName: "text-red-700",
    },
    {
      status: SloOverviewStatusFilter.NotEvaluating,
      label: "Not Evaluating",
      count: counts.notEvaluating,
      activeClassName: "border-gray-400 bg-gray-50",
      countClassName: "text-gray-700",
    },
  ];

  const rows: Array<ReactElement> = visibleSlos.map(
    (slo: ServiceLevelObjective): ReactElement => {
      const sloId: string = slo.id?.toString() || (slo._id as string) || "";
      const detailRoute: Route = RouteUtil.populateRouteParams(
        RouteMap[PageMap.SLO_VIEW] as Route,
        { modelId: new ObjectID(sloId) },
      );
      const monitors: Array<Monitor> = slo.monitors || [];
      const monitorNames: string = monitors
        .map((monitor: Monitor): string => {
          return monitor.name || "Unnamed";
        })
        .join(", ");
      const hasCurrentEvaluation: boolean =
        hasCurrentSloOverviewEvaluation(slo);
      const currentSli: number | undefined | null = hasCurrentEvaluation
        ? slo.currentSliPercentage
        : undefined;
      const currentSliClassName: string =
        typeof currentSli !== "number"
          ? "text-gray-400"
          : typeof slo.targetPercentage !== "number" ||
              currentSli >= slo.targetPercentage
            ? "text-emerald-700"
            : "text-red-700";
      const budgetRemaining: number | undefined | null =
        hasCurrentEvaluation
          ? slo.errorBudgetRemainingPercentage
          : undefined;
      const budgetTier: SloBudgetTier = !hasCurrentEvaluation
        ? SloBudgetTier.Unknown
        : slo.sloStatus === SloStatus.BudgetExhausted
          ? SloBudgetTier.Exhausted
          : slo.sloStatus === SloStatus.AtRisk
            ? SloBudgetTier.AtRisk
            : slo.sloStatus === SloStatus.Healthy
              ? SloBudgetTier.Healthy
              : getSloBudgetTier({
                  errorBudgetRemainingPercentage: budgetRemaining,
                  atRiskThresholdPercentage: slo.atRiskThresholdPercentage,
                });
      const budgetBarWidth: number =
        typeof budgetRemaining === "number" && isFinite(budgetRemaining)
          ? Math.max(0, Math.min(100, budgetRemaining))
          : 0;
      const currentBurnRate: number | undefined | null = hasCurrentEvaluation
        ? slo.currentBurnRate
        : undefined;
      const burnRate: string | null = formatSloBurnRate(currentBurnRate);
      const burnRateClassName: string =
        typeof currentBurnRate === "number" && currentBurnRate >= 6
          ? "text-red-700 font-medium"
          : typeof currentBurnRate === "number" && currentBurnRate > 1
            ? "text-amber-700 font-medium"
            : "text-gray-700";

      return (
        <tr
          key={sloId}
          className="hover:bg-gray-50/50 transition-colors duration-100 group"
          data-testid={`slo-overview-row-${sloId}`}
        >
          <td className="px-3 py-2 text-xs truncate">
            {isPublic ? (
              <span className="font-medium text-gray-800">
                {slo.name || "Unnamed SLO"}
              </span>
            ) : (
              <AppLink
                to={detailRoute}
                className="font-medium text-gray-800 hover:underline group-hover:text-blue-600"
              >
                {slo.name || "Unnamed SLO"}
              </AppLink>
            )}
          </td>
          {!isPublic ? (
            <td
              className="px-3 py-2 text-xs text-gray-600 truncate"
              title={monitorNames || undefined}
            >
              {monitorNames || "—"}
            </td>
          ) : (
            <></>
          )}
          <td className="px-3 py-2 text-xs text-gray-700">
            <div className="font-medium">{formatPercent(slo.targetPercentage)}</div>
            {!isPublic ? (
              <div className="text-[10px] text-gray-400 whitespace-nowrap">
                {getWindowLabel(slo)}
              </div>
            ) : (
              <></>
            )}
          </td>
          <td
            className={`px-3 py-2 text-xs font-medium ${currentSliClassName}`}
          >
            {formatPercent(currentSli)}
          </td>
          <td className="px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-medium text-gray-700">
                {formatPercent(budgetRemaining)}
              </span>
              <span className="truncate text-[10px] text-gray-400">
                {formatErrorBudgetRemainingSeconds(
                  hasCurrentEvaluation
                    ? slo.errorBudgetRemainingSeconds
                    : undefined,
                ) || "Not evaluated"}
              </span>
            </div>
            <div
              className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100"
              role="progressbar"
              aria-label={`${slo.name || "SLO"} error budget remaining`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={
                hasCurrentEvaluation ? Math.round(budgetBarWidth) : undefined
              }
              aria-valuetext={
                hasCurrentEvaluation ? undefined : "Not evaluated"
              }
            >
              <div
                className={`h-full ${BUDGET_BAR_CLASS[budgetTier]}`}
                style={{ width: `${budgetBarWidth}%` }}
              ></div>
            </div>
          </td>
          <td className={`px-3 py-2 text-xs ${burnRateClassName}`}>
            {burnRate || "—"}
          </td>
          <td className="px-3 py-2">
            {slo.isEnabled === false ? (
              <Pill text="Disabled" color={Gray500} size={PillSize.Small} />
            ) : (
              <SloStatusPill status={slo.sloStatus} />
            )}
          </td>
        </tr>
      );
    },
  );

  const title: string =
    DashboardLabelVariable.interpolateTitle(
      props.component.arguments.title,
      props.variables,
    ) || "SLO Fleet Overview";

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
          {title}
        </span>
        <span className="text-xs tabular-nums text-gray-300">
          {visibleSlos.length} of {counts.total} SLOs
        </span>
      </div>

      {!error && !isLoading ? (
        <>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
            {summaryCards.map((card: SummaryCard): ReactElement => {
              const isActive: boolean = status === card.status;

              return (
                <button
                  key={card.status}
                  type="button"
                  onClick={() => {
                    setStatus(card.status);
                  }}
                  aria-pressed={isActive}
                  data-testid={`slo-overview-summary-${card.status}`}
                  className={`rounded-md border px-2 py-1.5 text-left transition-colors ${
                    isActive
                      ? card.activeClassName
                      : "border-gray-100 bg-white hover:border-gray-200"
                  }`}
                >
                  <div className={`text-lg font-semibold ${card.countClassName}`}>
                    {card.count}
                  </div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                    {card.label}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setSearch(event.target.value);
              }}
              placeholder={
                isPublic ? "Search SLOs" : "Search SLOs or services"
              }
              aria-label={
                isPublic ? "Search SLOs" : "Search SLOs or services"
              }
              className="min-w-48 flex-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100"
            />
            {!isPublic && (monitorOptions.length > 0 || monitorId) ? (
              <select
                value={monitorId}
                onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                  setMonitorId(event.target.value);
                }}
                aria-label="Filter by service or monitor"
                className="max-w-52 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 outline-none focus:border-indigo-400"
              >
                <option value="">All services / monitors</option>
                {monitorOptions.map((option: FilterOption): ReactElement => {
                  return (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  );
                })}
              </select>
            ) : (
              <></>
            )}
            {!isPublic && (labelOptions.length > 0 || labelId) ? (
              <select
                value={labelId}
                onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                  setLabelId(event.target.value);
                }}
                aria-label="Filter by label"
                className="max-w-44 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 outline-none focus:border-indigo-400"
              >
                <option value="">All labels</option>
                {labelOptions.map((option: FilterOption): ReactElement => {
                  return (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  );
                })}
              </select>
            ) : (
              <></>
            )}
          </div>
        </>
      ) : (
        <></>
      )}

      <div className="min-h-0 flex-1">
        <DashboardResourceListBase
          pluralLabel="SLOs"
          columns={isPublic ? PUBLIC_COLUMNS : PRIVATE_COLUMNS}
          count={visibleSlos.length}
          isLoading={isLoading}
          error={error}
          isEmpty={visibleSlos.length === 0}
          emptyMessage={
            slos.length === 0
              ? "No SLOs found. Create an SLO to start tracking reliability."
              : "No SLOs match these filters."
          }
          emptyIcon={IconProp.Percent}
        >
          {rows}
        </DashboardResourceListBase>
      </div>
    </div>
  );
};

function arePropsEqual(prev: ComponentProps, next: ComponentProps): boolean {
  if (
    prev.componentId.toString() !== next.componentId.toString() ||
    prev.refreshTick !== next.refreshTick ||
    prev.isEditMode !== next.isEditMode ||
    prev.isSelected !== next.isSelected ||
    !JSONFunctions.deepEqual(prev.variables, next.variables) ||
    prev.dashboardComponentWidthInPx !== next.dashboardComponentWidthInPx ||
    prev.dashboardComponentHeightInPx !== next.dashboardComponentHeightInPx
  ) {
    return false;
  }

  return JSONFunctions.deepEqual(
    prev.component.arguments,
    next.component.arguments,
  );
}

export default React.memo(DashboardSloListComponentElement, arePropsEqual);
