import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import DashboardMonitorListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardMonitorListComponent";
import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import DashboardResourceListBase, {
  ResourceListColumn,
  ResourceListNameCell,
  ResourceListViewMode,
} from "./DashboardResourceListBase";
import { HoneycombTile } from "./DashboardResourceHoneycomb";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import DashboardResourceList from "../Utils/DashboardResourceList";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import API from "Common/UI/Utils/API/API";
import IconProp from "Common/Types/Icon/IconProp";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import { JSONObject } from "Common/Types/JSON";
import Includes from "Common/Types/BaseDatabase/Includes";
import JSONFunctions from "Common/Types/JSONFunctions";
import ProjectUtil from "Common/UI/Utils/Project";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import AppLink from "../../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Color from "Common/Types/Color";
import { getStatusTextProps } from "Common/UI/Utils/StatusColorStyle";
import DashboardLabelVariable from "Common/Utils/Dashboard/LabelVariable";
import {
  getMonitorListQuery,
  getMonitorListRowStatus,
  MONITOR_LIST_WIDGET_SELECT,
  MonitorListRowStatus,
} from "Common/Utils/Dashboard/MonitorListWidgetFormat";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { translateRecordName } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";
import useDashboardListWidgetSort, {
  DashboardListWidgetSort,
} from "../Utils/UseDashboardListWidgetSort";
import { getUnnamedText } from "./DashboardWidgetFallbackWords";
import { getMonitorTypeTitleInLanguage } from "../../Monitor/MonitorTypeTitle";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardMonitorListComponent;
}

/*
 * A row's status in the reader's words, in the table and in its tile. A
 * monitor whose monitoring is off is not checked, so the status it holds is
 * only what its last check saw: the row says Disabled, in gray and in the
 * reader's language, as the Monitors table does - and so for every other
 * row that says why it has no status a check stands behind (Probes Not
 * Enabled, Waiting for data, No results yet, Paused: MonitorRowStatus).
 * Any other row says its status's name by its list
 * (Common/Utils/DefaultRecordNames): the default "Operational" in the
 * reader's words, a status the project named itself as written - never
 * looked up, so "Open" is never "Abrir".
 */
export const getMonitorListStatusName: (
  status: MonitorListRowStatus,
  translator: Translator,
) => string = (
  status: MonitorListRowStatus,
  translator: Translator,
): string => {
  if (status.isProductWords || status.isMonitoringOff) {
    return translator.translateText(status.text) || status.text;
  }

  return translateRecordName(
    translator,
    StateListType.MonitorStatus,
    status.text,
  );
};

/*
 * A row's type, in its Type column and its tile's tooltip: the name the
 * type picker gives it, in the reader's words ("SSL-Zertifikat"), as the
 * Monitors list's Monitor Type column says it - never the stored English
 * value (#8294). A monitor with no type keeps the dash it always had.
 */
export const getMonitorListTypeText: (
  monitor: Monitor,
  translator: Translator,
) => string = (monitor: Monitor, translator: Translator): string => {
  if (!monitor.monitorType) {
    return EMPTY_VALUE_MARK;
  }

  return getMonitorTypeTitleInLanguage(monitor.monitorType, translator);
};

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Name", widthPct: "55%", sortKey: "name" },
  { label: "Status", widthPct: "30%", sortKey: "status" },
  { label: "Type", widthPct: "15%", sortKey: "type" },
];

const DashboardMonitorListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const translator: Translator = useTranslator();
  const [monitors, setMonitors] = useState<Array<Monitor>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const requestVersion: React.MutableRefObject<number> = useRef<number>(0);
  const widgetSort: DashboardListWidgetSort = useDashboardListWidgetSort(
    props,
    DashboardComponentType.MonitorList,
  );

  const maxRows: number = props.component.arguments.maxRows || 25;
  const viewMode: ResourceListViewMode =
    props.component.arguments.viewMode === "honeycomb" ? "honeycomb" : "list";
  const statusFilter: string | undefined =
    props.component.arguments.statusFilter;
  const monitorStatusIds: Array<string> | undefined =
    props.component.arguments.monitorStatusIds;
  const monitorTypes: Array<string> | undefined =
    props.component.arguments.monitorTypes;
  const labelIds: Array<string> | undefined =
    props.component.arguments.labelIds;
  const labelVariableId: string | undefined =
    props.component.arguments.labelVariableId;

  const monitorStatusIdsKey: string = (monitorStatusIds || []).join(",");
  const monitorTypesKey: string = (monitorTypes || []).join(",");
  const labelIdsKey: string = (labelIds || []).join(",");

  const fetchMonitors: () => Promise<void> = useCallback(async () => {
    const version: number = ++requestVersion.current;
    setIsLoading(true);

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!DashboardResourceList.isPublic() && !projectId) {
      setIsLoading(false);
      setError("No project selected.");
      return;
    }

    try {
      /*
       * Archived monitors are never listed, and a status filter matches only
       * the monitors that are checked: one whose monitoring is off keeps the
       * status its last check saw, and its row says Disabled instead
       * (MonitorListWidgetFormat - the public policy builds the same query).
       * Given the project, "non-operational" is asked of the project's own
       * statuses, so the read and its count start from those (issue #8096).
       */
      const query: Query<Monitor> = {
        projectId: projectId,
        ...getMonitorListQuery({ statusFilter, monitorStatusIds }, projectId),
      } as Query<Monitor>;

      if (monitorTypes && monitorTypes.length > 0) {
        (query as Record<string, unknown>)["monitorType"] = new Includes(
          monitorTypes,
        );
      }

      const labelFilter: ReturnType<typeof DashboardLabelVariable.getFilter> =
        DashboardLabelVariable.getFilter({
          labelIds,
          labelVariableId,
          variables: props.variables,
        });
      if (labelFilter) {
        (query as Record<string, unknown>)["labels"] = labelFilter;
      }

      const listResult: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
        modelType: Monitor,
        requestOptions: DashboardResourceList.getRequestOptions("monitor", {
          componentId: props.componentId,
          variables: props.variables,
          viewerSort: widgetSort.viewerPick,
        }),
        query: query,
        limit: maxRows,
        skip: 0,
        /*
         * With what the row rule reads (MonitorRowStatus), so a monitor
         * whose monitoring is off, that no probe checks or that nothing has
         * checked yet says so, as the Monitors table does.
         */
        select: widgetSort.withSortSelect({
          ...MONITOR_LIST_WIDGET_SELECT,
        } as JSONObject) as Select<Monitor>,
        // The viewer's pick, else the widget's own sort, else by name.
        sort: widgetSort.modelSort as Sort<Monitor>,
      });

      if (version !== requestVersion.current) {
        return;
      }
      setMonitors(listResult.data);
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
    statusFilter,
    monitorStatusIdsKey,
    monitorTypesKey,
    labelIdsKey,
    labelVariableId,
    props.componentId,
    props.variables,
    widgetSort.sortKey,
    widgetSort.viewerPick?.column,
    widgetSort.viewerPick?.direction,
  ]);

  useEffect(() => {
    fetchMonitors();
    return () => {
      // A slower request for the previous unit must not replace this selection.
      requestVersion.current++;
    };
  }, [fetchMonitors, props.refreshTick]);

  const honeycombTiles: Array<HoneycombTile> = monitors.map(
    (monitor: Monitor): HoneycombTile => {
      const monitorId: string = (monitor._id as string) || "";
      const name: string =
        (monitor.name as string) || getUnnamedText(translator);
      // What the Monitors table says of it: Disabled, Waiting for data, its status.
      const status: MonitorListRowStatus = getMonitorListRowStatus(monitor);
      const statusName: string = getMonitorListStatusName(status, translator);
      const monitorType: string = getMonitorListTypeText(monitor, translator);

      const detailRoute: Route | undefined = monitorId
        ? RouteUtil.populateRouteParams(
            RouteMap[PageMap.MONITOR_VIEW] as Route,
            { modelId: new ObjectID(monitorId) },
          )
        : undefined;

      return {
        id: monitorId || name,
        // In the reader's words already, as the table's row reads it.
        status: statusName,
        isStatusUserContent: true,
        color: status.color ? status.color.toString() : "#9ca3af",
        route: detailRoute,
        tooltip: {
          title: name,
          details: [{ label: "Type", value: monitorType }],
        },
      };
    },
  );

  const rows: Array<ReactElement> = monitors.map(
    (monitor: Monitor): ReactElement => {
      const monitorId: string = (monitor._id as string) || "";
      const status: MonitorListRowStatus = getMonitorListRowStatus(monitor);
      const statusName: string = getMonitorListStatusName(status, translator);
      const statusColor: Color | null = status.color;
      const monitorType: string = getMonitorListTypeText(monitor, translator);
      const name: string =
        (monitor.name as string) || getUnnamedText(translator);

      const detailRoute: Route = RouteUtil.populateRouteParams(
        RouteMap[PageMap.MONITOR_VIEW] as Route,
        { modelId: new ObjectID(monitorId) },
      );

      return (
        <tr
          key={monitorId}
          className="hover:bg-gray-50/50 transition-colors duration-100 group"
        >
          <ResourceListNameCell
            name={name}
            className="px-3 py-2 text-xs text-gray-700 truncate"
          >
            <AppLink
              to={detailRoute}
              className="hover:underline text-gray-700 group-hover:text-blue-600"
            >
              {name}
            </AppLink>
          </ResourceListNameCell>
          <td className="px-3 py-2">
            <span
              className="inline-flex items-center gap-1.5 text-xs font-medium"
              style={{ fontSize: "10px" }}
              data-testid="monitor-list-status"
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{
                  backgroundColor: statusColor
                    ? statusColor.toString()
                    : "#9ca3af",
                }}
              ></span>
              {/*
               * The status's own colour, and on the dark theme the nearest
               * lighter shade of it that reads on the dark card.
               */}
              {statusColor ? (
                <span {...getStatusTextProps(statusColor)}>{statusName}</span>
              ) : (
                <span className="text-gray-500">{statusName}</span>
              )}
            </span>
          </td>
          <td className="px-3 py-2 text-xs text-gray-500">{monitorType}</td>
        </tr>
      );
    },
  );

  return (
    <DashboardResourceListBase
      title={DashboardLabelVariable.interpolateTitle(
        props.component.arguments.title,
        props.variables,
      )}
      countLabel={{
        one: "{{count}} monitor",
        other: "{{count}} monitors",
      }}
      columns={COLUMNS}
      count={monitors.length}
      isLoading={isLoading}
      error={error}
      isEmpty={monitors.length === 0}
      emptyMessage="No monitors found"
      emptyIcon={IconProp.AltGlobe}
      viewMode={viewMode}
      honeycombTiles={honeycombTiles}
      sort={widgetSort.listSort}
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

export default React.memo(DashboardMonitorListComponentElement, arePropsEqual);
