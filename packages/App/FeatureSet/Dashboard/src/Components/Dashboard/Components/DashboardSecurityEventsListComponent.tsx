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
import DashboardResourceListBase, {
  ResourceListColumn,
} from "./DashboardResourceListBase";
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
import Sort from "Common/Types/BaseDatabase/Sort";
import Query from "Common/Types/BaseDatabase/Query";
import IconProp from "Common/Types/Icon/IconProp";
import JSONFunctions from "Common/Types/JSONFunctions";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import {
  DashboardDateTime,
  getDashboardDateTime,
} from "../Utils/DashboardDateTime";
import {
  getSecurityEventSeverityColor,
  resolveSecurityEventsListLimit,
} from "./SecurityEventsWidgetData";
import useDashboardListWidgetSort, {
  DashboardListWidgetSort,
} from "../Utils/UseDashboardListWidgetSort";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardSecurityEventsListComponent;
}

/*
 * The events in the dashboard's time range, newest first unless a viewer
 * clicks a column (issue #5082): Severity sorts the most severe first, by
 * the OCSF severity id. The message is free text, so it does not sort.
 */
const COLUMNS: Array<ResourceListColumn> = [
  /*
   * Wide enough for a date, a time and its seconds on one line from the
   * widget's default width; at its narrowest the time goes under the date,
   * so every column still fits.
   */
  { label: "Time", widthPct: "28%", sortKey: "time" },
  { label: "Severity", widthPct: "13%", sortKey: "severity" },
  { label: "Class", widthPct: "15%", sortKey: "class" },
  { label: "Message", widthPct: "30%" },
  { label: "Host", widthPct: "14%", sortKey: "host" },
];

/*
 * An event's date and its time of day, each kept whole: at the widget's
 * narrowest the time goes under the date, never a word at a time.
 */
function renderTimeLabel(label: string): ReactElement {
  const space: number = label.lastIndexOf(" ");

  if (space <= 0) {
    return <span className="whitespace-nowrap">{label}</span>;
  }

  return (
    <>
      <span className="whitespace-nowrap">{label.slice(0, space)}</span>{" "}
      <span className="whitespace-nowrap">{label.slice(space + 1)}</span>
    </>
  );
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
  const widgetSort: DashboardListWidgetSort = useDashboardListWidgetSort(
    props,
    DashboardComponentType.SecurityEventsList,
  );

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
            // The viewer's pick, else the widget's own sort, else newest first.
            sort: widgetSort.modelSort as Sort<SecurityEvent>,
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
      widgetSort.sortKey,
    ]);

  useEffect(() => {
    void fetchData();
  }, [fetchData, props.refreshTick]);

  const rows: Array<ReactElement> = securityEvents.map(
    (securityEvent: SecurityEvent, index: number): ReactElement => {
      const severity: string =
        (securityEvent.severityName as string) || "Unknown";
      const severityColor: string = getSecurityEventSeverityColor(severity);
      const time: DashboardDateTime | null = securityEvent.time
        ? getDashboardDateTime(
            securityEvent.time as unknown as string,
            // Events arrive seconds apart; minutes cannot order them.
            { showSeconds: true },
          )
        : null;
      const className: string = (securityEvent.className as string) || "";
      const message: string = (securityEvent.message as string) || "";
      const host: string = (securityEvent.principalHost as string) || "";

      return (
        <tr
          key={index}
          className="hover:bg-gray-50/50 transition-colors duration-100"
        >
          <td
            className="px-3 py-1.5 text-xs text-gray-500 tabular-nums"
            title={time?.title}
          >
            {time ? renderTimeLabel(time.label) : "-"}
          </td>
          <td className="px-3 py-1.5" title={severity}>
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: severityColor }}
              />
              <span
                className="truncate text-xs font-medium"
                style={{ fontSize: "10px", color: severityColor }}
              >
                {severity}
              </span>
            </span>
          </td>
          <td
            className="max-w-0 truncate px-3 py-1.5 text-xs text-gray-500"
            title={className}
          >
            {className || "-"}
          </td>
          <td
            className="max-w-0 truncate px-3 py-1.5 text-xs text-gray-600"
            title={message}
          >
            {message || "-"}
          </td>
          <td
            className="max-w-0 truncate px-3 py-1.5 text-xs text-gray-400"
            title={host}
          >
            {host}
          </td>
        </tr>
      );
    },
  );

  return (
    <DashboardResourceListBase
      title={props.component.arguments.title}
      pluralLabel="events"
      columns={COLUMNS}
      count={securityEvents.length}
      isLoading={isLoading}
      error={error}
      isEmpty={securityEvents.length === 0}
      emptyMessage="No security events for the selected time range and filters"
      emptyIcon={IconProp.ShieldCheck}
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
