import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import DashboardSloListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardSloListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import DashboardResourceListBase, {
  ResourceListColumn,
  ResourceListViewMode,
} from "./DashboardResourceListBase";
import { HoneycombTile } from "./DashboardResourceHoneycomb";
import DashboardResourceList from "../Utils/DashboardResourceList";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import Route from "Common/Types/API/Route";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import DashboardVariable, {
  DashboardVariableType,
} from "Common/Types/Dashboard/DashboardVariable";
import IconProp from "Common/Types/Icon/IconProp";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import DashboardLabelVariable from "Common/Utils/Dashboard/LabelVariable";
import DashboardModelQueryInterpolation from "Common/Utils/Dashboard/ModelQueryVariableInterpolation";
import DashboardVariableInterpolation from "Common/Utils/Dashboard/VariableInterpolation";
import {
  getSloListRowDisplay,
  getSloListStatusFilterQuery,
  SLO_LIST_ATTRIBUTE_TO_COLUMN,
  SLO_LIST_DEFAULT_MAX_ROWS,
  SLO_LIST_SORT,
  SloBurnRateTone,
  SloListRowDisplay,
  SloStatusSummaryEntry,
  summarizeSloStatuses,
} from "Common/Utils/Slo/SloListWidgetFormat";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import AppLink from "../../AppLink/AppLink";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardSloListComponent;
}

/*
 * Exactly the fields a row renders. The public endpoint pins its own copy
 * server-side (PublicDashboardResourceListPolicy) and ignores this one, so it
 * is the widget's contract, never its access control.
 *
 * `isEnabled` is read so a disabled SLO, which is not evaluated and keeps the
 * status it had when it was switched off, reads "Disabled" instead of that
 * frozen status (getSloListRowDisplay, summarizeSloStatuses).
 */
export const SLO_LIST_WIDGET_SELECT: Select<ServiceLevelObjective> = {
  _id: true,
  name: true,
  targetPercentage: true,
  currentSliPercentage: true,
  errorBudgetRemainingPercentage: true,
  errorBudgetRemainingSeconds: true,
  currentBurnRate: true,
  sloStatus: true,
  isEnabled: true,
};

const COLUMNS: Array<ResourceListColumn> = [
  { label: "SLO", widthPct: "31%" },
  { label: "Status", widthPct: "17%" },
  { label: "SLI", widthPct: "15%", alignRight: true },
  { label: "Error Budget", widthPct: "25%" },
  { label: "Burn Rate", widthPct: "12%", alignRight: true },
];

/*
 * Core classes only, all of which Theme.css remaps for dark mode. The status
 * colour itself is applied inline from the brand palette, which reads on
 * both themes.
 */
const BURN_RATE_TONE_CLASS_NAME: Record<SloBurnRateTone, string> = {
  [SloBurnRateTone.Unknown]: "text-gray-400",
  [SloBurnRateTone.Sustainable]: "text-gray-700",
  [SloBurnRateTone.Elevated]: "text-amber-700 font-semibold",
  [SloBurnRateTone.Critical]: "text-red-600 font-semibold",
};

const MISSING_VALUE: string = "—";

type GetSloRouteFunction = (sloId: string) => Route | undefined;

const getSloRoute: GetSloRouteFunction = (sloId: string): Route | undefined => {
  /*
   * A public dashboard has no session, so a link into the SLO pages would
   * bounce an anonymous viewer to the login screen. Rows render the name as
   * plain text there instead.
   */
  if (!sloId || DashboardResourceList.isPublic()) {
    return undefined;
  }

  return RouteUtil.populateRouteParams(RouteMap[PageMap.SLO_VIEW] as Route, {
    modelId: new ObjectID(sloId),
  });
};

type IsNarrowedByVariableFunction = (
  variables: Array<DashboardVariable> | undefined,
) => boolean;

/*
 * True when a toolbar variable the list follows currently narrows it, so an
 * empty result reads as "nothing matches this selection" rather than as a
 * project with no SLOs.
 */
const isNarrowedByVariable: IsNarrowedByVariableFunction = (
  variables: Array<DashboardVariable> | undefined,
): boolean => {
  return (variables || []).some((variable: DashboardVariable): boolean => {
    return (
      variable.type === DashboardVariableType.TelemetryAttribute &&
      Boolean(variable.attributeKey) &&
      Object.prototype.hasOwnProperty.call(
        SLO_LIST_ATTRIBUTE_TO_COLUMN,
        variable.attributeKey as string,
      ) &&
      Boolean(DashboardVariableInterpolation.resolveValue(variable))
    );
  });
};

const DashboardSloListComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [slos, setSlos] = useState<Array<ServiceLevelObjective>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const requestVersion: React.MutableRefObject<number> = useRef<number>(0);

  const maxRows: number =
    props.component.arguments.maxRows || SLO_LIST_DEFAULT_MAX_ROWS;
  const viewMode: ResourceListViewMode =
    props.component.arguments.viewMode === "honeycomb" ? "honeycomb" : "list";
  const sloStatuses: Array<string> | undefined =
    props.component.arguments.sloStatuses;
  const labelIds: Array<string> | undefined =
    props.component.arguments.labelIds;
  const labelVariableId: string | undefined =
    props.component.arguments.labelVariableId;

  // Array arguments are compared by value, not by reference, in the deps.
  const sloStatusesKey: string = (sloStatuses || []).join(",");
  const labelIdsKey: string = (labelIds || []).join(",");

  const fetchSlos: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const version: number = ++requestVersion.current;
      setIsLoading(true);

      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!DashboardResourceList.isPublic() && !projectId) {
        setIsLoading(false);
        setError("No project selected.");
        return;
      }

      try {
        let query: Record<string, unknown> = {
          projectId: projectId,
          /*
           * Archived SLOs are hidden from every SLO list and are no longer
           * evaluated, so their numbers are frozen at archive time. The public
           * policy pins the same predicate server-side.
           *
           * Disabled SLOs are not evaluated either, but they are still live
           * objectives, so they stay listed — marked Disabled and ordered
           * after the enabled ones (SLO_LIST_SORT) — unless a status filter
           * is set, which matches enabled SLOs only.
           */
          isArchived: false,
          ...getSloListStatusFilterQuery(sloStatuses),
        };

        const labelFilter: ReturnType<typeof DashboardLabelVariable.getFilter> =
          DashboardLabelVariable.getFilter({
            labelIds,
            labelVariableId,
            variables: props.variables,
          });

        if (labelFilter) {
          query["labels"] = labelFilter;
        }

        /*
         * An SLO picked in a `sloName` toolbar variable narrows the list to that
         * objective, exactly as it narrows the SLO metric charts beside it.
         */
        query = DashboardModelQueryInterpolation.applyToQuery(
          query,
          props.variables,
          SLO_LIST_ATTRIBUTE_TO_COLUMN,
        );

        const listResult: ListResult<ServiceLevelObjective> =
          await ModelAPI.getList<ServiceLevelObjective>({
            modelType: ServiceLevelObjective,
            requestOptions: DashboardResourceList.getRequestOptions(
              "slo-list",
              {
                componentId: props.componentId,
                variables: props.variables,
              },
            ),
            query: query as Query<ServiceLevelObjective>,
            limit: maxRows,
            skip: 0,
            select: SLO_LIST_WIDGET_SELECT,
            sort: { ...SLO_LIST_SORT } as Sort<ServiceLevelObjective>,
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

      setIsLoading(false);
    }, [
      maxRows,
      sloStatusesKey,
      labelIdsKey,
      labelVariableId,
      props.componentId,
      props.variables,
    ]);

  useEffect(() => {
    fetchSlos();

    return () => {
      // A slower request for a previous selection must not replace this one.
      requestVersion.current++;
    };
  }, [fetchSlos, props.refreshTick]);

  const summary: Array<SloStatusSummaryEntry> = summarizeSloStatuses(slos);

  /*
   * The list is ordered enabled-first, then least-budget-first, so when it is
   * capped the rows left out are disabled ones first and then the healthiest —
   * worth saying, because the counts in the strip then describe the rows
   * shown, not the whole project. "Most urgent", not "least budget": a
   * disabled SLO cut off below the cap can hold less (frozen) budget than a
   * live one shown above it.
   */
  const isCapped: boolean = slos.length > 0 && slos.length >= maxRows;

  const summaryElement: ReactElement | undefined =
    slos.length > 0 ? (
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500"
        data-testid="slo-list-summary"
      >
        {summary.map((entry: SloStatusSummaryEntry): ReactElement => {
          return (
            <span
              key={entry.label}
              className="inline-flex items-center gap-1.5 tabular-nums"
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: entry.color.toString() }}
              ></span>
              <span className="font-semibold text-gray-700">{entry.count}</span>
              <span>{entry.label}</span>
            </span>
          );
        })}
        {isCapped ? (
          <span className="text-gray-400">
            Showing the {maxRows} most urgent
          </span>
        ) : (
          <></>
        )}
      </div>
    ) : undefined;

  const honeycombTiles: Array<HoneycombTile> = slos.map(
    (slo: ServiceLevelObjective): HoneycombTile => {
      const sloId: string = slo._id?.toString() || "";
      const name: string = slo.name || "Unnamed SLO";
      const display: SloListRowDisplay = getSloListRowDisplay(slo);

      return {
        id: sloId || name,
        status: display.statusText,
        color: display.statusColor.toString(),
        route: getSloRoute(sloId),
        tooltip: {
          title: name,
          details: [
            { label: "SLI", value: display.sli || MISSING_VALUE },
            { label: "Error budget", value: display.budget || MISSING_VALUE },
            { label: "Burn rate", value: display.burnRate || MISSING_VALUE },
          ],
        },
      };
    },
  );

  const rows: Array<ReactElement> = slos.map(
    (slo: ServiceLevelObjective): ReactElement => {
      const sloId: string = slo._id?.toString() || "";
      const name: string = slo.name || "Unnamed SLO";
      const display: SloListRowDisplay = getSloListRowDisplay(slo);
      const route: Route | undefined = getSloRoute(sloId);
      const statusColor: string = display.statusColor.toString();

      return (
        <tr
          key={sloId || name}
          className="hover:bg-gray-50/50 transition-colors duration-100 group"
          data-testid="slo-list-row"
        >
          <td className="px-3 py-2 text-xs text-gray-700 truncate max-w-0">
            {route ? (
              <AppLink
                to={route}
                className="hover:underline text-gray-700 group-hover:text-blue-600"
              >
                {name}
              </AppLink>
            ) : (
              <span title={name}>{name}</span>
            )}
          </td>
          <td className="px-3 py-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap">
              <span
                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: statusColor }}
              ></span>
              <span style={{ color: statusColor }}>{display.statusText}</span>
            </span>
          </td>
          <td className="px-3 py-2 text-right">
            <div className="text-xs font-medium text-gray-900 tabular-nums">
              {display.sli || MISSING_VALUE}
            </div>
            {display.target ? (
              <div className="text-[10px] text-gray-400 tabular-nums whitespace-nowrap">
                {display.target}
              </div>
            ) : (
              <></>
            )}
          </td>
          <td className="px-3 py-2">
            <div className="flex items-center gap-2">
              <div
                className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"
                role="progressbar"
                aria-label={`Error budget remaining for ${name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={
                  display.budgetFillPercent === null
                    ? undefined
                    : display.budgetFillPercent
                }
              >
                {display.budgetFillPercent !== null ? (
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${display.budgetFillPercent}%`,
                      backgroundColor: statusColor,
                    }}
                  ></div>
                ) : (
                  <></>
                )}
              </div>
              <span className="text-xs font-medium text-gray-900 tabular-nums w-14 text-right">
                {display.budget || MISSING_VALUE}
              </span>
            </div>
            {display.budgetTime ? (
              <div className="text-[10px] text-gray-400 tabular-nums mt-0.5 whitespace-nowrap">
                {display.budgetTime}
              </div>
            ) : (
              <></>
            )}
          </td>
          <td
            className={`px-3 py-2 text-right text-xs tabular-nums ${
              BURN_RATE_TONE_CLASS_NAME[display.burnRateTone]
            }`}
          >
            {display.burnRate || MISSING_VALUE}
          </td>
        </tr>
      );
    },
  );

  const isFiltered: boolean =
    Boolean(sloStatuses && sloStatuses.length > 0) ||
    Boolean(labelIds && labelIds.length > 0) ||
    Boolean(labelVariableId) ||
    isNarrowedByVariable(props.variables);

  return (
    <DashboardResourceListBase
      title={DashboardLabelVariable.interpolateTitle(
        props.component.arguments.title,
        props.variables,
      )}
      pluralLabel={slos.length === 1 ? "SLO" : "SLOs"}
      columns={COLUMNS}
      count={slos.length}
      isLoading={isLoading}
      error={error}
      isEmpty={slos.length === 0}
      emptyMessage={
        isFiltered
          ? "No active SLOs match this selection"
          : "No SLOs yet — create one to see it here"
      }
      emptyIcon={IconProp.Percent}
      viewMode={viewMode}
      honeycombTiles={honeycombTiles}
      summary={summaryElement}
    >
      {rows}
    </DashboardResourceListBase>
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
