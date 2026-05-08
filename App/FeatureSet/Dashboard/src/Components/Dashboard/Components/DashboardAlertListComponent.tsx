import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import DashboardAlertListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardAlertListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import DashboardResourceListBase, {
  ResourceListColumn,
} from "./DashboardResourceListBase";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Alert from "Common/Models/DatabaseModels/Alert";
import API from "Common/UI/Utils/API/API";
import IconProp from "Common/Types/Icon/IconProp";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import Query from "Common/Types/BaseDatabase/Query";
import Includes from "Common/Types/BaseDatabase/Includes";
import JSONFunctions from "Common/Types/JSONFunctions";
import ProjectUtil from "Common/UI/Utils/Project";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import AppLink from "../../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Color from "Common/Types/Color";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardAlertListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Title", widthPct: "45%" },
  { label: "State", widthPct: "20%" },
  { label: "Severity", widthPct: "15%" },
  { label: "Created", widthPct: "20%" },
];

const DashboardAlertListComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [alerts, setAlerts] = useState<Array<Alert>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const maxRows: number = props.component.arguments.maxRows || 25;
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

  const fetchAlerts: () => Promise<void> = useCallback(async () => {
    setIsLoading(true);

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!projectId) {
      setIsLoading(false);
      setError("No project selected.");
      return;
    }

    try {
      const query: Query<Alert> = {
        projectId: projectId,
      } as Query<Alert>;

      if (stateFilter === "unresolved") {
        (query as Record<string, unknown>)["currentAlertState"] = {
          isResolvedState: false,
        };
      } else if (stateFilter === "resolved") {
        (query as Record<string, unknown>)["currentAlertState"] = {
          isResolvedState: true,
        };
      } else if (stateFilter === "acknowledged") {
        (query as Record<string, unknown>)["currentAlertState"] = {
          isAcknowledgedState: true,
        };
      }

      if (severityIds && severityIds.length > 0) {
        (query as Record<string, unknown>)["alertSeverityId"] = new Includes(
          severityIds,
        );
      }

      if (stateIds && stateIds.length > 0) {
        (query as Record<string, unknown>)["currentAlertStateId"] =
          new Includes(stateIds);
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
        query: query,
        limit: maxRows,
        skip: 0,
        select: {
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
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
      });

      setAlerts(listResult.data);
      setError(null);
    } catch (err: unknown) {
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
  ]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts, props.refreshTick]);

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
    const created: Date | undefined = alert.createdAt
      ? OneUptimeDate.fromString(alert.createdAt as unknown as string)
      : undefined;

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
            {(alert.title as string) || "Untitled"}
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
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border"
            style={{
              fontSize: "10px",
              color: severityColor ? severityColor.toString() : "#6b7280",
              borderColor: severityColor ? severityColor.toString() : "#e5e7eb",
              backgroundColor: severityColor
                ? `${severityColor.toString()}10`
                : "#f9fafb",
            }}
          >
            {severityName}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-gray-500 tabular-nums">
          {created
            ? OneUptimeDate.getDateAsLocalFormattedString(created, true)
            : "—"}
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
