import React, { FunctionComponent, ReactElement, useEffect } from "react";
import DashboardMonitorStatusComponent from "Common/Types/Dashboard/DashboardComponents/DashboardMonitorStatusComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import API from "Common/UI/Utils/API/API";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import DashboardVariableInterpolation from "Common/Utils/Dashboard/VariableInterpolation";
import Color from "Common/Types/Color";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardMonitorStatusComponent;
}

interface MonitorEntry {
  id: string;
  name: string;
  statusName: string;
  statusColor: Color | undefined;
  isOperational: boolean;
}

const colorToCss: (c: Color | undefined, fallback: string) => string = (
  c: Color | undefined,
  fallback: string,
): string => {
  if (!c) {
    return fallback;
  }
  const r: unknown = (c as unknown as { red?: number }).red;
  const g: unknown = (c as unknown as { green?: number }).green;
  const b: unknown = (c as unknown as { blue?: number }).blue;
  if (typeof r === "number" && typeof g === "number" && typeof b === "number") {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return fallback;
};

const DashboardMonitorStatusComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const [monitors, setMonitors] = React.useState<Array<MonitorEntry>>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  const layout: "grid" | "list" =
    props.component.arguments.layout === "list" ? "list" : "grid";
  const maxRows: number = props.component.arguments.maxRows || 24;

  const fetchMonitors: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const result: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
        modelType: Monitor,
        query: {} as Query<Monitor>,
        limit: maxRows,
        skip: 0,
        select: {
          _id: true,
          name: true,
          currentMonitorStatus: {
            name: true,
            color: true,
            isOperationalState: true,
          } as never,
          labels: { name: true } as never,
        } as never,
        sort: { name: SortOrder.Ascending } as never,
        requestOptions: {},
      });

      /*
       * Apply client-side filters (name contains, label match) using
       * interpolated values so dashboard variables work here too.
       */
      const nameContains: string =
        DashboardVariableInterpolation.interpolateString(
          props.component.arguments.nameContains || "",
          props.dashboardVariables || [],
        )
          .trim()
          .toLowerCase();
      const labelFilter: Array<string> =
        DashboardVariableInterpolation.interpolateString(
          props.component.arguments.labelFilter || "",
          props.dashboardVariables || [],
        )
          .split(",")
          .map((s: string) => {
            return s.trim().toLowerCase();
          })
          .filter((s: string) => {
            return s.length > 0;
          });

      const filtered: Array<Monitor> = result.data.filter((m: Monitor) => {
        if (
          nameContains &&
          (m.name || "").toLowerCase().indexOf(nameContains) === -1
        ) {
          return false;
        }
        if (labelFilter.length > 0) {
          const labelNames: Array<string> = (m.labels || []).map(
            (l: { name?: string }) => {
              return (l.name || "").toLowerCase();
            },
          );
          const matched: boolean = labelFilter.some((needle: string) => {
            return labelNames.includes(needle);
          });
          if (!matched) {
            return false;
          }
        }
        return true;
      });

      setMonitors(
        filtered.map((m: Monitor): MonitorEntry => {
          return {
            id: m._id?.toString() || "",
            name: m.name || "(unnamed)",
            statusName: m.currentMonitorStatus?.name || "Unknown",
            statusColor: m.currentMonitorStatus?.color,
            isOperational: Boolean(m.currentMonitorStatus?.isOperationalState),
          };
        }),
      );
      setError("");
    } catch (err: unknown) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchMonitors();
  }, [
    props.refreshTick,
    props.dashboardVariables,
    props.component.arguments.nameContains,
    props.component.arguments.labelFilter,
    props.component.arguments.maxRows,
  ]);

  if (isLoading && monitors.length === 0) {
    return (
      <div className="h-full flex flex-col animate-pulse">
        <div className="h-3 w-24 bg-gray-100 rounded mb-3"></div>
        <div className="flex-1 grid grid-cols-6 gap-1">
          {Array.from({ length: 12 }).map((_: unknown, i: number) => {
            return (
              <div
                key={i}
                className="bg-gray-100 rounded"
                style={{ aspectRatio: "1.4", opacity: 1 - i * 0.06 }}
              ></div>
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
          <Icon icon={IconProp.Activity} className="h-5 w-5 text-gray-300" />
        </div>
        <p className="text-xs text-gray-400 text-center max-w-48">{error}</p>
      </div>
    );
  }

  if (monitors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-1.5">
        <Icon icon={IconProp.Activity} className="h-6 w-6 text-gray-300" />
        <p className="text-xs text-gray-400">No monitors match the filters</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto flex flex-col">
      {props.component.arguments.title && (
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            {props.component.arguments.title}
          </span>
          <span className="text-xs text-gray-300 tabular-nums">
            {monitors.length} monitors
          </span>
        </div>
      )}

      {layout === "grid" ? (
        <div className="flex-1 overflow-auto">
          <div
            className="grid gap-1"
            style={{
              gridTemplateColumns:
                "repeat(auto-fill, minmax(min(120px, 100%), 1fr))",
            }}
          >
            {monitors.map((m: MonitorEntry) => {
              return (
                <div
                  key={m.id}
                  className="rounded-md border border-gray-100 px-2 py-1.5 bg-white hover:shadow-sm transition-shadow"
                  title={`${m.name} — ${m.statusName}`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{
                        background: colorToCss(
                          m.statusColor,
                          m.isOperational ? "#10b981" : "#ef4444",
                        ),
                        boxShadow: m.isOperational
                          ? "0 0 6px rgba(16, 185, 129, 0.4)"
                          : "0 0 6px rgba(239, 68, 68, 0.4)",
                      }}
                    ></span>
                    <span className="text-[11px] text-gray-700 truncate font-medium">
                      {m.name}
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-400 truncate">
                    {m.statusName}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto rounded-md border border-gray-100">
          <div className="divide-y divide-gray-50">
            {monitors.map((m: MonitorEntry) => {
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50/50 transition-colors duration-100"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      background: colorToCss(
                        m.statusColor,
                        m.isOperational ? "#10b981" : "#ef4444",
                      ),
                    }}
                  ></span>
                  <span className="text-xs text-gray-700 truncate flex-1 font-medium">
                    {m.name}
                  </span>
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0"
                    style={{
                      background: "rgba(241, 245, 249, 0.7)",
                      color: colorToCss(m.statusColor, "#475569"),
                    }}
                  >
                    {m.statusName}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardMonitorStatusComponentElement;
