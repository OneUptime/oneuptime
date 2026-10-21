import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import DashboardAlertListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardAlertListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import DashboardResourceListBase, {
  ResourceListColumn,
  ResourceListViewMode,
} from "./DashboardResourceListBase";
import { HoneycombTile } from "./DashboardResourceHoneycomb";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import DashboardResourceList from "../Utils/DashboardResourceList";
import Alert from "Common/Models/DatabaseModels/Alert";
import API from "Common/UI/Utils/API/API";
import IconProp from "Common/Types/Icon/IconProp";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import { JSONObject } from "Common/Types/JSON";
import {
  DashboardDateTime,
  getDashboardDateTime,
  getDashboardDateTimeLabel,
} from "../Utils/DashboardDateTime";
import Query from "Common/Types/BaseDatabase/Query";
import Includes from "Common/Types/BaseDatabase/Includes";
import ResolvedStateUtil from "Common/Utils/ResolvedState";
import AcknowledgedStateUtil from "Common/Utils/AcknowledgedState";
import { StateListType } from "Common/Utils/StateOrder";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertStateUtil from "../../../Utils/AlertState";
import JSONFunctions from "Common/Types/JSONFunctions";
import ProjectUtil from "Common/UI/Utils/Project";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import AppLink from "../../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Color from "Common/Types/Color";
import { getSeverityPillProps } from "../Utils/SeverityPillStyle";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useDashboardListWidgetSort, {
  DashboardListWidgetSort,
} from "../Utils/UseDashboardListWidgetSort";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardAlertListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Title", widthPct: "40%", sortKey: "title" },
  { label: "State", widthPct: "17%", sortKey: "state" },
  { label: "Severity", widthPct: "15%", sortKey: "severity" },
  // Wider than the other columns because it carries a date *and* a time.
  { label: "Created", widthPct: "28%", sortKey: "created" },
];

const DashboardAlertListComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [alerts, setAlerts] = useState<Array<Alert>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const widgetSort: DashboardListWidgetSort = useDashboardListWidgetSort(
    props,
    DashboardComponentType.AlertList,
  );

  const maxRows: number = props.component.arguments.maxRows || 25;
  const viewMode: ResourceListViewMode =
    props.component.arguments.viewMode === "honeycomb" ? "honeycomb" : "list";
  const stateFilter: string | undefined = props.component.arguments.stateFilter;
  const severityIds: Array<string> | undefined =
    props.component.arguments.severityIds;
  const stateIds: Array<string> | undefined =
    props.component.arguments.stateIds;
  const monitorIds: Array<string> | undefined =
    props.component.arguments.monitorIds;
  const labelIds: Array<string> | undefined =
    props.component.arguments.labelIds;

  const severityIdsKey: string = (severityIds || []).join(",");
  const stateIdsKey: string = (stateIds || []).join(",");
  const monitorIdsKey: string = (monitorIds || []).join(",");
  const labelIdsKey: string = (labelIds || []).join(",");

  /*
   * Only the newest read may draw: a viewer clicking through a column's
   * sorts starts a read per click, and an older, slower one must not
   * replace the order they ended on.
   */
  const readSequenceRef: React.MutableRefObject<number> = useRef<number>(0);

  const fetchAlerts: () => Promise<void> = useCallback(async () => {
    const readSequence: number = ++readSequenceRef.current;
    setIsLoading(true);

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!DashboardResourceList.isPublic() && !projectId) {
      setIsLoading(false);
      setError("No project selected.");
      return;
    }

    try {
      const query: Query<Alert> = {
        projectId: projectId,
      } as Query<Alert>;

      /*
       * Unresolved, Resolved and Acknowledged are the project's to say: its
       * resolved state and any state placed after it are resolved
       * (Common/Utils/ResolvedState); its acknowledged state and any state
       * placed after it, short of resolved, are acknowledged
       * (Common/Utils/AcknowledgedState). On a public dashboard the server
       * applies the stored filter itself.
       */
      let resolvedFilterStateIds: Array<string> | null = null;

      if (
        (stateFilter === "unresolved" ||
          stateFilter === "resolved" ||
          stateFilter === "acknowledged") &&
        !DashboardResourceList.isPublic() &&
        projectId
      ) {
        const states: Array<AlertState> =
          await AlertStateUtil.getAlertStates(projectId);

        let filterStateIds: Array<ObjectID> = [];

        if (stateFilter === "acknowledged") {
          filterStateIds =
            AcknowledgedStateUtil.getAcknowledgedUnresolvedStateIds({
              list: StateListType.AlertState,
              states: states,
            });
        } else if (stateFilter === "unresolved") {
          filterStateIds = ResolvedStateUtil.getUnresolvedStateIds({
            list: StateListType.AlertState,
            states: states,
          });
        } else {
          filterStateIds = ResolvedStateUtil.getResolvedStateIds({
            list: StateListType.AlertState,
            states: states,
          });
        }

        resolvedFilterStateIds = filterStateIds.map((stateId: ObjectID) => {
          return stateId.toString();
        });
      }

      if (severityIds && severityIds.length > 0) {
        (query as Record<string, unknown>)["alertSeverityId"] = new Includes(
          severityIds,
        );
      }

      if (stateIds && stateIds.length > 0) {
        (query as Record<string, unknown>)["currentAlertStateId"] =
          new Includes(
            resolvedFilterStateIds
              ? stateIds.filter((stateId: string) => {
                  return resolvedFilterStateIds!.includes(stateId);
                })
              : stateIds,
          );
      } else if (resolvedFilterStateIds) {
        (query as Record<string, unknown>)["currentAlertStateId"] =
          new Includes(resolvedFilterStateIds);
      }

      if (monitorIds && monitorIds.length > 0) {
        (query as Record<string, unknown>)["monitorId"] = new Includes(
          monitorIds,
        );
      }

      if (labelIds && labelIds.length > 0) {
        (query as Record<string, unknown>)["labels"] = new Includes(labelIds);
      }

      const listResult: ListResult<Alert> = await ModelAPI.getList<Alert>({
        modelType: Alert,
        requestOptions: DashboardResourceList.getRequestOptions("alert", {
          componentId: props.componentId,
          variables: props.variables,
          viewerSort: widgetSort.viewerPick,
        }),
        query: query,
        limit: maxRows,
        skip: 0,
        select: widgetSort.withSortSelect({
          _id: true,
          title: true,
          createdAt: true,
          currentAlertState: {
            name: true,
            color: true,
          },
          alertSeverity: {
            name: true,
            color: true,
          },
        } as JSONObject) as Select<Alert>,
        // The viewer's pick, else the widget's own sort, else newest first.
        sort: widgetSort.modelSort as Sort<Alert>,
      });

      if (readSequence !== readSequenceRef.current) {
        return;
      }

      setAlerts(listResult.data);
      setError(null);
    } catch (err: unknown) {
      if (readSequence !== readSequenceRef.current) {
        return;
      }

      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  }, [
    maxRows,
    stateFilter,
    severityIdsKey,
    stateIdsKey,
    monitorIdsKey,
    labelIdsKey,
    props.componentId,
    props.variables,
    widgetSort.sortKey,
  ]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts, props.refreshTick]);

  const honeycombTiles: Array<HoneycombTile> = alerts.map(
    (alert: Alert): HoneycombTile => {
      const alertId: string = (alert._id as string) || "";
      const title: string = (alert.title as string) || "Untitled";
      const stateName: string =
        (alert.currentAlertState?.name as string) || "—";
      const stateColor: Color | undefined = alert.currentAlertState?.color as
        | Color
        | undefined;
      const severityName: string = (alert.alertSeverity?.name as string) || "—";
      const severityColor: Color | undefined = alert.alertSeverity?.color as
        | Color
        | undefined;

      const route: Route | undefined = alertId
        ? RouteUtil.populateRouteParams(RouteMap[PageMap.ALERT_VIEW] as Route, {
            modelId: new ObjectID(alertId),
          })
        : undefined;

      return {
        id: alertId || title,
        status: stateName,
        color: severityColor
          ? severityColor.toString()
          : stateColor
            ? stateColor.toString()
            : "#9ca3af",
        route: route,
        tooltip: {
          title: title,
          details: [
            { label: "State", value: stateName },
            { label: "Severity", value: severityName },
            /*
             * Honeycomb mode has no "Created" column, so without this the tile
             * view is the one place a user cannot tell when an alert fired.
             */
            {
              label: "Created",
              value: getDashboardDateTimeLabel(
                alert.createdAt as unknown as string | undefined,
              ),
            },
          ],
        },
      };
    },
  );

  const rows: Array<ReactElement> = alerts.map((alert: Alert): ReactElement => {
    const alertId: string = (alert._id as string) || "";
    const stateName: string = (alert.currentAlertState?.name as string) || "—";
    const stateColor: Color | undefined = alert.currentAlertState?.color as
      | Color
      | undefined;
    const severityName: string = (alert.alertSeverity?.name as string) || "—";
    const severityColor: Color | undefined = alert.alertSeverity?.color as
      | Color
      | undefined;
    const created: DashboardDateTime = getDashboardDateTime(
      alert.createdAt as unknown as string | undefined,
    );

    const detailRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.ALERT_VIEW] as Route,
      { modelId: new ObjectID(alertId) },
    );

    return (
      <tr
        key={alertId}
        className="hover:bg-gray-50/50 transition-colors duration-100 group"
      >
        <td className="px-3 py-2 text-xs text-gray-700 truncate">
          <AppLink
            to={detailRoute}
            className="hover:underline text-gray-700 group-hover:text-blue-600"
          >
            {(alert.title as string) ||
              (translator.translateText("Untitled") as string)}
          </AppLink>
        </td>
        <td className="px-3 py-2">
          <span
            className="inline-flex items-center gap-1.5 text-xs font-medium"
            style={{ fontSize: "10px" }}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{
                backgroundColor: stateColor ? stateColor.toString() : "#9ca3af",
              }}
            ></span>
            <span className="text-gray-600">{stateName}</span>
          </span>
        </td>
        <td className="px-3 py-2">
          <span {...getSeverityPillProps(severityColor)}>{severityName}</span>
        </td>
        <td
          className="px-3 py-2 text-xs text-gray-500 tabular-nums whitespace-nowrap"
          title={created.title}
        >
          {created.label}
        </td>
      </tr>
    );
  });

  return (
    <DashboardResourceListBase
      title={props.component.arguments.title}
      pluralLabel="alerts"
      columns={COLUMNS}
      count={alerts.length}
      isLoading={isLoading}
      error={error}
      isEmpty={alerts.length === 0}
      emptyMessage="No alerts found"
      emptyIcon={IconProp.Alert}
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

export default React.memo(DashboardAlertListComponentElement, arePropsEqual);
