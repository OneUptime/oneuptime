import React, { FunctionComponent, ReactElement, useEffect } from "react";
import DashboardAlertListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardAlertListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import API from "Common/UI/Utils/API/API";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import Query from "Common/Types/BaseDatabase/Query";
import DashboardVariableInterpolation from "Common/Utils/Dashboard/VariableInterpolation";
import Color from "Common/Types/Color";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardAlertListComponent;
}

interface ListItem {
  id: string;
  title: string;
  createdAt?: Date | undefined;
  severityName?: string | undefined;
  severityColor?: Color | undefined;
  stateName?: string | undefined;
  stateColor?: Color | undefined;
  isResolved: boolean;
}

const colorToCss: (c: Color | undefined, fallback: string) => string = (
  c: Color | undefined,
  fallback: string,
): string => {
  if (!c) {
    return fallback;
  }
  // Color is stored as { red, green, blue } numeric — convert to CSS rgb().
  const r: unknown = (c as unknown as { red?: number }).red;
  const g: unknown = (c as unknown as { green?: number }).green;
  const b: unknown = (c as unknown as { blue?: number }).blue;
  if (typeof r === "number" && typeof g === "number" && typeof b === "number") {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return fallback;
};

const DashboardAlertListComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [items, setItems] = React.useState<Array<ListItem>>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  const maxRows: number = props.component.arguments.maxRows || 20;
  const source: "alerts" | "incidents" =
    props.component.arguments.source === "incidents" ? "incidents" : "alerts";
  const stateFilter: "open" | "resolved" | "all" =
    props.component.arguments.stateFilter || "open";

  const fetchItems: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);

    const startAndEndDate: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(
        props.dashboardStartAndEndDate,
      );

    if (!startAndEndDate.startValue || !startAndEndDate.endValue) {
      setIsLoading(false);
      setError("Please select a valid start and end date.");
      return;
    }

    const severityFilter: string =
      DashboardVariableInterpolation.interpolateString(
        props.component.arguments.severityFilter || "",
        props.dashboardVariables || [],
      );

    try {
      if (source === "alerts") {
        const query: Query<Alert> = {
          createdAt: new InBetween<Date>(
            startAndEndDate.startValue,
            startAndEndDate.endValue,
          ),
        } as Query<Alert>;
        const result: ListResult<Alert> = await ModelAPI.getList<Alert>({
          modelType: Alert,
          query,
          limit: maxRows,
          skip: 0,
          select: {
            _id: true,
            title: true,
            createdAt: true,
            alertSeverity: { name: true, color: true } as never,
            currentAlertState: {
              name: true,
              color: true,
              isResolvedState: true,
            } as never,
          } as never,
          sort: { createdAt: SortOrder.Descending } as never,
          requestOptions: {},
        });
        const filtered: Array<Alert> = result.data.filter((a: Alert) => {
          const isResolved: boolean = Boolean(
            a.currentAlertState?.isResolvedState,
          );
          if (stateFilter === "open" && isResolved) {
            return false;
          }
          if (stateFilter === "resolved" && !isResolved) {
            return false;
          }
          if (
            severityFilter &&
            severityFilter.length > 0 &&
            (a.alertSeverity?.name || "")
              .toLowerCase()
              .indexOf(severityFilter.toLowerCase()) === -1
          ) {
            return false;
          }
          return true;
        });
        setItems(
          filtered.map((a: Alert): ListItem => {
            return {
              id: a._id?.toString() || "",
              title: a.title || "(no title)",
              createdAt: a.createdAt
                ? OneUptimeDate.fromString(a.createdAt as unknown as string)
                : undefined,
              severityName: a.alertSeverity?.name,
              severityColor: a.alertSeverity?.color,
              stateName: a.currentAlertState?.name,
              stateColor: a.currentAlertState?.color,
              isResolved: Boolean(a.currentAlertState?.isResolvedState),
            };
          }),
        );
      } else {
        const query: Query<Incident> = {
          createdAt: new InBetween<Date>(
            startAndEndDate.startValue,
            startAndEndDate.endValue,
          ),
        } as Query<Incident>;
        const result: ListResult<Incident> = await ModelAPI.getList<Incident>({
          modelType: Incident,
          query,
          limit: maxRows,
          skip: 0,
          select: {
            _id: true,
            title: true,
            createdAt: true,
            incidentSeverity: { name: true, color: true } as never,
            currentIncidentState: {
              name: true,
              color: true,
              isResolvedState: true,
            } as never,
          } as never,
          sort: { createdAt: SortOrder.Descending } as never,
          requestOptions: {},
        });
        const filtered: Array<Incident> = result.data.filter((i: Incident) => {
          const isResolved: boolean = Boolean(
            i.currentIncidentState?.isResolvedState,
          );
          if (stateFilter === "open" && isResolved) {
            return false;
          }
          if (stateFilter === "resolved" && !isResolved) {
            return false;
          }
          if (
            severityFilter &&
            severityFilter.length > 0 &&
            (i.incidentSeverity?.name || "")
              .toLowerCase()
              .indexOf(severityFilter.toLowerCase()) === -1
          ) {
            return false;
          }
          return true;
        });
        setItems(
          filtered.map((i: Incident): ListItem => {
            return {
              id: i._id?.toString() || "",
              title: i.title || "(no title)",
              createdAt: i.createdAt
                ? OneUptimeDate.fromString(i.createdAt as unknown as string)
                : undefined,
              severityName: i.incidentSeverity?.name,
              severityColor: i.incidentSeverity?.color,
              stateName: i.currentIncidentState?.name,
              stateColor: i.currentIncidentState?.color,
              isResolved: Boolean(i.currentIncidentState?.isResolvedState),
            };
          }),
        );
      }
      setError("");
    } catch (err: unknown) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchItems();
  }, [
    props.dashboardStartAndEndDate,
    props.refreshTick,
    props.dashboardVariables,
    props.component.arguments.source,
    props.component.arguments.stateFilter,
    props.component.arguments.severityFilter,
    props.component.arguments.maxRows,
  ]);

  if (isLoading && items.length === 0) {
    return (
      <div className="h-full flex flex-col animate-pulse">
        <div className="h-3 w-24 bg-gray-100 rounded mb-3"></div>
        <div className="flex-1 space-y-2">
          {Array.from({ length: 5 }).map((_: unknown, i: number) => {
            return (
              <div
                key={i}
                className="flex gap-2 items-center"
                style={{ opacity: 1 - i * 0.15 }}
              >
                <div className="w-1.5 h-1.5 bg-gray-200 rounded-full"></div>
                <div className="h-3 w-16 bg-gray-100 rounded"></div>
                <div className="h-3 bg-gray-50 rounded flex-1"></div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-2">
        <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center">
          <Icon icon={IconProp.Alert} className="h-5 w-5 text-gray-300" />
        </div>
        <p className="text-xs text-gray-400 text-center max-w-48">{error}</p>
      </div>
    );
  }

  return (
    <div
      className="h-full overflow-auto flex flex-col"
      style={{
        opacity: isLoading ? 0.5 : 1,
        transition: "opacity 0.2s ease-in-out",
      }}
    >
      {props.component.arguments.title && (
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            {props.component.arguments.title}
          </span>
          <span className="text-xs text-gray-300 tabular-nums">
            {items.length} {source}
          </span>
        </div>
      )}
      <div className="flex-1 overflow-auto rounded-md border border-gray-100">
        <div className="divide-y divide-gray-50">
          {items.map((item: ListItem) => {
            return (
              <div
                key={item.id}
                className="flex items-start gap-2 px-3 py-1.5 hover:bg-gray-50/50 transition-colors duration-100 group"
              >
                <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      background: colorToCss(item.severityColor, "#9ca3af"),
                    }}
                  ></span>
                  {item.severityName && (
                    <span
                      className="text-[10px] font-medium px-1 py-0.5 rounded w-14 text-center uppercase tracking-wider"
                      style={{
                        background: "rgba(241, 245, 249, 0.7)",
                        color: colorToCss(item.severityColor, "#475569"),
                      }}
                    >
                      {item.severityName.substring(0, 4)}
                    </span>
                  )}
                </div>
                {item.createdAt && (
                  <span
                    className="text-xs text-gray-400 shrink-0 tabular-nums"
                    style={{ fontSize: "11px" }}
                  >
                    {OneUptimeDate.getDateAsLocalFormattedString(
                      item.createdAt,
                      true,
                    )}
                  </span>
                )}
                <span
                  className="text-xs text-gray-700 truncate flex-1 font-medium"
                  style={{ fontSize: "11.5px" }}
                >
                  {item.title}
                </span>
                {item.stateName && (
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0"
                    style={{
                      background: item.isResolved
                        ? "rgba(220, 252, 231, 0.7)"
                        : "rgba(254, 226, 226, 0.7)",
                      color: item.isResolved ? "#15803d" : "#b91c1c",
                    }}
                  >
                    {item.stateName}
                  </span>
                )}
              </div>
            );
          })}
          {items.length === 0 && (
            <div className="px-4 py-8 text-center text-gray-400 text-sm">
              No {source} in this time range
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardAlertListComponentElement;
