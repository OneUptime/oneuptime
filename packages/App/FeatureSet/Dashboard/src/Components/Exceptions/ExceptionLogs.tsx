import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import {
  ExceptionLogsViewerScope,
  ExceptionLogsViewerScopeKey,
  getDefaultExceptionLogsViewerScope,
  getExceptionLogsViewerScopes,
} from "../../Utils/ExceptionLogsScope";
import DashboardLogsViewer from "../Logs/LogsViewer";
import ExceptionSegmentedControl from "./ExceptionSegmentedControl";

export interface ComponentProps {
  instance: ExceptionInstance | undefined;
  isLoading: boolean;
  primaryEntityType?: ServiceType | undefined;
}

/*
 * The exception's Logs page: the full log viewer (search, facets, histogram,
 * log details), anchored on the latest occurrence. It replaces the collapsed
 * "Show Logs" card that used to sit at the bottom of Context, where a log
 * viewer had no room to be useful.
 */
const ExceptionLogs: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [selectedScopeKey, setSelectedScopeKey] = useState<
    ExceptionLogsViewerScopeKey | undefined
  >(undefined);

  const scopes: Array<ExceptionLogsViewerScope> = useMemo(() => {
    return getExceptionLogsViewerScopes({
      traceId: props.instance?.traceId?.toString(),
      primaryEntityId: props.instance?.primaryEntityId?.toString(),
      time: props.instance?.time,
    });
  }, [props.instance]);

  const scope: ExceptionLogsViewerScope | null =
    getDefaultExceptionLogsViewerScope(scopes, selectedScopeKey);

  /*
   * The log viewer re-applies its scope, resets to page 1 and refetches
   * whenever these props change identity, so they are built once per scope
   * rather than on every render (a header triage click re-renders the page).
   */
  const scopeTraceId: string | undefined = scope?.traceId || undefined;
  const scopeServiceId: string | undefined = scope?.serviceId || undefined;
  const scopeStartTime: number | undefined = scope?.window?.startTime.getTime();
  const scopeEndTime: number | undefined = scope?.window?.endTime.getTime();

  const traceIds: Array<string> | undefined = useMemo(() => {
    return scopeTraceId ? [scopeTraceId] : undefined;
  }, [scopeTraceId]);

  const serviceIds: Array<ObjectID> | undefined = useMemo(() => {
    return scopeServiceId ? [new ObjectID(scopeServiceId)] : undefined;
  }, [scopeServiceId]);

  const logQuery: Query<Log> | undefined = useMemo(() => {
    if (scopeStartTime === undefined || scopeEndTime === undefined) {
      return undefined;
    }

    return {
      time: new InBetween<Date>(
        new Date(scopeStartTime),
        new Date(scopeEndTime),
      ),
    } as Query<Log>;
  }, [scopeStartTime, scopeEndTime]);

  if (props.isLoading && !props.instance) {
    return (
      <Card title="Logs" description="Finding the latest occurrence…">
        <div className="flex h-40 items-center justify-center">
          <ComponentLoader />
        </div>
      </Card>
    );
  }

  if (!scope) {
    return (
      <Card
        title="Logs"
        description="Logs are shown around the latest occurrence of this exception."
      >
        <div
          className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 px-6 py-10 text-center"
          data-testid="exception-logs-empty"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
            <Icon icon={IconProp.Logs} className="h-5 w-5 text-gray-400" />
          </div>
          <p className="mt-3 max-w-md text-sm text-gray-600">
            No occurrence with a trace or a service is stored for this
            exception, so there are no logs to correlate yet.
          </p>
        </div>
      </Card>
    );
  }

  const occurredAt: Date | undefined = props.instance?.time
    ? new Date(props.instance.time)
    : undefined;

  return (
    <div data-testid="exception-logs">
      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm md:flex-row md:items-center md:px-6">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50">
            <Icon icon={IconProp.Logs} className="h-5 w-5 text-indigo-600" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">
              Logs around the latest occurrence
              {occurredAt && !Number.isNaN(occurredAt.getTime()) && (
                <span className="ml-2 text-sm font-normal text-gray-500">
                  {OneUptimeDate.getDateAsLocalShortDateTimeString(occurredAt)}
                </span>
              )}
            </h2>
            <p
              className="mt-0.5 text-sm text-gray-600"
              data-testid="exception-logs-scope-description"
            >
              {scope.description}
            </p>
          </div>
        </div>
        {scopes.length > 1 && (
          <ExceptionSegmentedControl<ExceptionLogsViewerScopeKey>
            label="Log scope"
            testId="exception-logs-scope"
            value={scope.key}
            onChange={setSelectedScopeKey}
            options={scopes.map((option: ExceptionLogsViewerScope) => {
              return { value: option.key, label: option.label };
            })}
          />
        )}
      </div>

      <DashboardLogsViewer
        // A different scope is a different view: remount rather than merge.
        key={scope.key}
        id={`exception-logs-${scope.key}`}
        {...(traceIds ? { traceIds } : {})}
        {...(serviceIds
          ? {
              serviceIds,
              ...(props.primaryEntityType
                ? { scopeEntityType: props.primaryEntityType }
                : {}),
            }
          : {})}
        {...(logQuery ? { logQuery } : {})}
        showFilters={true}
        limit={50}
        noLogsMessage={
          scope.key === ExceptionLogsViewerScopeKey.Trace
            ? "No logs were written for this trace in the pinned window."
            : "This service wrote no logs in the minutes around the occurrence."
        }
      />
    </div>
  );
};

export default ExceptionLogs;
