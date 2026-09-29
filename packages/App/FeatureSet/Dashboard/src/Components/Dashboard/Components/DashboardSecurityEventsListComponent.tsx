import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import DashboardSecurityEventsListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardSecurityEventsListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import DashboardResourceList from "../Utils/DashboardResourceList";
import API from "Common/UI/Utils/API/API";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import JSONFunctions from "Common/Types/JSONFunctions";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import {
  DashboardDateTime,
  getDashboardDateTime,
} from "../Utils/DashboardDateTime";
import {
  getSecurityEventSeverityColor,
  resolveSecurityEventsListLimit,
} from "./SecurityEventsWidgetData";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardSecurityEventsListComponent;
}

const DashboardSecurityEventsListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const [securityEvents, setSecurityEvents] = useState<Array<SecurityEvent>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const requestSequenceRef: React.MutableRefObject<number> = useRef<number>(0);

  const fetchData: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const requestSequence: number = ++requestSequenceRef.current;
      const isStale: () => boolean = (): boolean => {
        return requestSequence !== requestSequenceRef.current;
      };

      setIsLoading(true);

      if (DashboardResourceList.isPublic()) {
        setSecurityEvents([]);
        setIsLoading(false);
        setError(
          "Security event widgets are not available on public dashboards.",
        );
        return;
      }

      const startAndEndDate: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(
          props.dashboardStartAndEndDate,
        );

      if (!startAndEndDate.startValue || !startAndEndDate.endValue) {
        setIsLoading(false);
        setError("Please select a valid start and end date.");
        return;
      }

      try {
        const query: Query<SecurityEvent> = {
          time: new InBetween<Date>(
            startAndEndDate.startValue,
            startAndEndDate.endValue,
          ),
        };

        const severityFilters: Array<string> = (
          props.component.arguments.severityFilters || []
        ).filter(Boolean);
        if (severityFilters.length > 0) {
          query.severityName = new Includes(severityFilters);
        }

        const classNameFilters: Array<string> = (
          props.component.arguments.classNameFilters || []
        ).filter(Boolean);
        if (classNameFilters.length > 0) {
          query.className = new Includes(classNameFilters);
        }

        const messageContains: string | undefined =
          props.component.arguments.messageContains?.trim() || undefined;
        if (messageContains) {
          query.message = new Search(messageContains);
        }

        const listResult: ListResult<SecurityEvent> =
          await AnalyticsModelAPI.getList<SecurityEvent>({
            modelType: SecurityEvent,
            query: query,
            limit: resolveSecurityEventsListLimit(
              props.component.arguments.limit,
            ),
            skip: 0,
            select: {
              time: true,
              severityName: true,
              className: true,
              message: true,
              principalHost: true,
            },
            sort: {
              time: SortOrder.Descending,
            },
          });

        if (isStale()) {
          return;
        }

        setSecurityEvents(listResult.data);
        setError(null);
      } catch (err: unknown) {
        if (isStale()) {
          return;
        }
        setSecurityEvents([]);
        setError(API.getFriendlyErrorMessage(err as Error));
      }

      if (!isStale()) {
        setIsLoading(false);
      }
    }, [
      props.dashboardStartAndEndDate,
      props.component.arguments.severityFilters,
      props.component.arguments.classNameFilters,
      props.component.arguments.messageContains,
      props.component.arguments.limit,
    ]);

  useEffect(() => {
    void fetchData();
  }, [fetchData, props.refreshTick]);

  return (
    <div className="flex h-full w-full flex-col">
      {props.component.arguments.title && (
        <div className="mb-1 px-1 text-sm font-medium text-gray-700">
          {props.component.arguments.title}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading && securityEvents.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <ComponentLoader />
          </div>
        )}
        {!isLoading && error && <ErrorMessage message={error} />}
        {!isLoading && !error && securityEvents.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-gray-400">
            No security events for the selected time range and filters
          </div>
        )}
        {!error && securityEvents.length > 0 && (
          <div className="rounded-md border border-gray-100">
            <div className="divide-y divide-gray-50">
              {securityEvents.map(
                (securityEvent: SecurityEvent, index: number) => {
                  const severity: string =
                    (securityEvent.severityName as string) || "Unknown";
                  const severityColor: string =
                    getSecurityEventSeverityColor(severity);
                  const time: DashboardDateTime | null = securityEvent.time
                    ? getDashboardDateTime(
                        securityEvent.time as unknown as string,
                        // Events arrive seconds apart; minutes cannot order them.
                        { showSeconds: true },
                      )
                    : null;

                  return (
                    <div
                      key={index}
                      className="flex items-start gap-2 px-3 py-1.5 hover:bg-gray-50/50 transition-colors duration-100"
                    >
                      {time && (
                        <span
                          className="text-xs text-gray-400 shrink-0 tabular-nums whitespace-nowrap"
                          style={{ fontSize: "11px" }}
                          title={time.title}
                        >
                          {time.label}
                        </span>
                      )}
                      <span
                        className="flex items-center gap-1 shrink-0"
                        title={severity}
                      >
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: severityColor }}
                        />
                        <span
                          className="text-xs font-medium"
                          style={{ fontSize: "10px", color: severityColor }}
                        >
                          {severity}
                        </span>
                      </span>
                      <span
                        className="text-xs text-gray-500 shrink-0 truncate max-w-[10rem]"
                        style={{ fontSize: "11px" }}
                        title={(securityEvent.className as string) || ""}
                      >
                        {(securityEvent.className as string) || "-"}
                      </span>
                      <span
                        className="text-xs text-gray-600 truncate flex-1"
                        style={{ fontSize: "11px" }}
                        title={(securityEvent.message as string) || ""}
                      >
                        {(securityEvent.message as string) || "-"}
                      </span>
                      <span
                        className="text-xs text-gray-400 shrink-0 truncate max-w-[8rem]"
                        style={{ fontSize: "11px" }}
                        title={(securityEvent.principalHost as string) || ""}
                      >
                        {(securityEvent.principalHost as string) || ""}
                      </span>
                    </div>
                  );
                },
              )}
            </div>
          </div>
        )}
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
    prev.dashboardComponentWidthInPx !== next.dashboardComponentWidthInPx ||
    prev.dashboardComponentHeightInPx !== next.dashboardComponentHeightInPx
  ) {
    return false;
  }

  if (
    !JSONFunctions.deepEqual(
      prev.dashboardStartAndEndDate,
      next.dashboardStartAndEndDate,
    )
  ) {
    return false;
  }

  return (
    JSONFunctions.deepEqual(
      prev.component.arguments,
      next.component.arguments,
    ) && JSONFunctions.deepEqual(prev.variables, next.variables)
  );
}

export default React.memo(
  DashboardSecurityEventsListComponentElement,
  arePropsEqual,
);
