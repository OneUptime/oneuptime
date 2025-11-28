import React, { FunctionComponent, ReactElement, useMemo } from "react";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import DashboardLogsComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardLogsComponent";
import DashboardLogsViewer from "../../Logs/LogsViewer";
import ObjectID from "Common/Types/ObjectID";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import JSONFunctions from "Common/Types/JSONFunctions";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardLogsComponentType;
}

const DashboardLogsComponent: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const args: DashboardLogsComponentType["arguments"] =
    props.component.arguments || {};

  const sanitizeCsv: (value?: string) => Array<string> = (
    value?: string,
  ): Array<string> => {
    if (!value) {
      return [];
    }

    return value
      .split(",")
      .map((entry: string) => entry.trim())
      .filter((entry: string) => entry.length > 0);
  };

  const telemetryServiceIds: Array<ObjectID> = useMemo(() => {
    return sanitizeCsv(args.telemetryServiceIdsCsv).reduce(
      (ids: Array<ObjectID>, id: string) => {
        try {
          ids.push(ObjectID.fromString(id));
        } catch (err) {
          // ignore invalid ids to avoid breaking the widget.
        }

        return ids;
      },
      [],
    );
  }, [args.telemetryServiceIdsCsv]);

  const limit: number = 100;

  const logQueryResult: {
    query: Query<Log>;
    error: string | null;
  } = useMemo(() => {
    const mergedQuery: Query<Log> = {};
    let error: string | null = null;

    const rawQuery: string = (args.logQueryJson || "").trim();

    if (rawQuery) {
      try {
        const parsedQuery: Query<Log> = JSONFunctions.parseJSONObject(
          rawQuery,
        ) as Query<Log>;
        Object.assign(mergedQuery, parsedQuery);
      } catch (err) {
        error = `Invalid log query JSON. ${(err as Error).message}`;
      }
    }

    if (!(mergedQuery as Record<string, unknown>)["time"]) {
      const range: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(
          props.dashboardStartAndEndDate,
        );

      Object.assign(mergedQuery as Record<string, unknown>, {
        time: new InBetween<Date>(range.startValue, range.endValue),
      });
    }

    return {
      query: mergedQuery,
      error,
    };
  }, [
    args.logQueryJson,
    props.dashboardStartAndEndDate,
  ]);

  if (logQueryResult.error) {
    return <ErrorMessage message={logQueryResult.error} />;
  }

  const showFilters: boolean = true;
  const enableRealtime: boolean = true;
  const noLogsMessage: string = "No logs found.";
  const title: string = args.title || "Logs";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {title ? (
        <div className="mb-2 text-sm font-medium text-gray-500">{title}</div>
      ) : (
        <></>
      )}

      <div className="flex-1 overflow-auto" style={{ minHeight: 0 }}>
        <DashboardLogsViewer
          id={props.component.componentId.toString()}
          showFilters={showFilters}
          telemetryServiceIds={telemetryServiceIds}
          logQuery={logQueryResult.query}
          limit={limit}
          enableRealtime={enableRealtime}
          noLogsMessage={noLogsMessage}
        />
      </div>
    </div>
  );
};

export default DashboardLogsComponent;
