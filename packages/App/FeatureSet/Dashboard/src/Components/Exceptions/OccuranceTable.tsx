import SpanStatusElement from "../Span/SpanStatusElement";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import AnalyticsModelTable from "Common/UI/Components/ModelTable/AnalyticsModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Route from "Common/Types/API/Route";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import ReplayLink from "../SessionReplay/ReplayLink";
import AppLink from "../AppLink/AppLink";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import { formatDroppedScopeHint } from "../../Utils/LogsCrossSignalPivot";
import {
  OccurrenceLogsLink,
  buildOccurrenceLogsExplorerLink,
  collectDistinctSessionIds,
} from "../../Utils/ExceptionCorrelation";
import {
  RumSessionLookupResult,
  lookupRumSessionsBySessionIds,
} from "../../Utils/RumSessionLookup";
import { makeExceptionSignalId } from "../SessionReplay/Rail/ReplaySignalTypes";
import { buildExceptionOccurrenceQuery } from "../../Utils/ExceptionDetailData";
import { formatRelativeTime } from "../../Utils/ExceptionDetailPresentation";

function toOccurrenceDate(value: unknown): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date: Date =
    value instanceof Date ? value : new Date(value as unknown as string);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

export interface ComponentProps {
  exceptionFingerprint: string;
  primaryEntityId?: ObjectID | undefined;
}

const OccouranceTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * A replay link needs the session's application id, which an occurrence
   * row does not carry. Resolved per fetched page through ONE batched read
   * in the shared RumSessionLookup cache (nothing fires when the page has
   * no session ids, ids already known are not re-fetched), so a session
   * seen here is also known to the log and span surfaces.
   */
  const [sessionAnchors, setSessionAnchors] = useState<
    Map<string, RumSessionLookupResult>
  >(new Map());
  const sessionAnchorsRef: MutableRefObject<
    Map<string, RumSessionLookupResult>
  > = useRef<Map<string, RumSessionLookupResult>>(new Map());
  const attemptedSessionIdsRef: MutableRefObject<Set<string>> = useRef<
    Set<string>
  >(new Set());

  const resolveSessionAnchors: (
    instances: Array<ExceptionInstance>,
  ) => Promise<void> = useCallback(
    async (instances: Array<ExceptionInstance>): Promise<void> => {
      const sessionIds: Array<string> = collectDistinctSessionIds(
        instances,
      ).filter((sessionId: string): boolean => {
        return !attemptedSessionIdsRef.current.has(sessionId);
      });

      if (sessionIds.length === 0) {
        return;
      }

      for (const sessionId of sessionIds) {
        attemptedSessionIdsRef.current.add(sessionId);
      }

      try {
        const resolved: Map<string, RumSessionLookupResult> =
          await lookupRumSessionsBySessionIds(sessionIds);

        if (resolved.size === 0) {
          return;
        }

        const merged: Map<string, RumSessionLookupResult> = new Map(
          sessionAnchorsRef.current,
        );

        for (const [sessionId, anchor] of resolved.entries()) {
          merged.set(sessionId, anchor);
        }

        sessionAnchorsRef.current = merged;
        setSessionAnchors(merged);
      } catch {
        /*
         * Quiet: the replay column is an aside on the occurrence table. Un-mark
         * the ids so a refresh can retry after a transient failure.
         */
        for (const sessionId of sessionIds) {
          attemptedSessionIdsRef.current.delete(sessionId);
        }
      }
    },
    [],
  );

  const logsRoute: Route = useMemo(() => {
    return RouteUtil.populateRouteParams(RouteMap[PageMap.LOGS] as Route);
  }, []);

  return (
    <Fragment>
      <div className="rounded">
        <AnalyticsModelTable<ExceptionInstance>
          /*
           * The columns were reworked (time first, one Related column), so
           * layouts saved under the old key would hide the new columns.
           */
          userPreferencesKey="exception-occurrences-table"
          modelType={ExceptionInstance}
          id="exception-occurrences-table"
          isDeleteable={false}
          isEditable={false}
          isCreateable={false}
          singularName="Occurrence"
          pluralName="Occurrences"
          name="Occurrence"
          isViewable={false}
          cardProps={{
            title: "Occurrences",
            description:
              "Every recorded occurrence of this exception, newest first. Open the trace, the logs around it, or a session replay of the moment it happened.",
          }}
          query={buildExceptionOccurrenceQuery({
            projectId: ProjectUtil.getCurrentProjectId()!,
            fingerprint: props.exceptionFingerprint,
            primaryEntityId: props.primaryEntityId,
          })}
          onFetchSuccess={(data: Array<ExceptionInstance>) => {
            void resolveSessionAnchors(data);
          }}
          showViewIdButton={true}
          noItemsMessage={
            "No occurrences match these filters. Occurrences older than the telemetry retention period are removed."
          }
          showRefreshButton={true}
          sortBy="time"
          sortOrder={SortOrder.Descending}
          filters={[
            {
              field: {
                traceId: true,
              },
              type: FieldType.Text,
              title: "Trace ID",
            },
            {
              field: {
                spanId: true,
              },
              type: FieldType.Text,
              title: "Span ID",
            },
            {
              field: {
                time: true,
              },
              type: FieldType.DateTime,
              title: "Time of Occurrence",
            },
            {
              field: {
                spanName: true,
              },
              type: FieldType.Text,
              title: "Span Name",
            },
            {
              field: {
                release: true,
              },
              type: FieldType.Text,
              title: "Release",
            },
            {
              field: {
                environment: true,
              },
              type: FieldType.Text,
              title: "Environment",
            },
          ]}
          selectMoreFields={{
            spanStatusCode: true,
            spanId: true,
            sessionId: true,
            time: true,
            environment: true,
          }}
          columns={[
            {
              field: {
                time: true,
              },
              title: "Time",
              type: FieldType.Element,
              getElement: (
                exceptionInstance: ExceptionInstance,
              ): ReactElement => {
                const occurredAt: Date | undefined = toOccurrenceDate(
                  exceptionInstance.time,
                );

                if (!occurredAt) {
                  return <span className="text-gray-400">Unknown</span>;
                }

                return (
                  <div
                    className="whitespace-nowrap"
                    title={OneUptimeDate.getDateAsLocalFormattedString(
                      occurredAt,
                    )}
                    data-testid="occurrence-time"
                  >
                    <div className="text-sm font-medium text-gray-900">
                      {formatRelativeTime(occurredAt)}
                    </div>
                    <div className="text-xs text-gray-500">
                      {OneUptimeDate.getDateAsLocalShortDateTimeString(
                        occurredAt,
                      )}
                    </div>
                  </div>
                );
              },
            },
            {
              field: {
                spanName: true,
              },
              title: "Span",
              type: FieldType.Element,
              getElement: (
                exceptionInstance: ExceptionInstance,
              ): ReactElement => {
                return (
                  <div className="min-w-0" data-testid="occurrence-span">
                    <SpanStatusElement
                      traceId={exceptionInstance.traceId?.toString()}
                      spanStatusCode={exceptionInstance.spanStatusCode!}
                      title={
                        exceptionInstance.spanName ||
                        exceptionInstance.spanId?.toString()
                      }
                      titleClassName="font-mono text-[13px] text-gray-900"
                    />
                    {exceptionInstance.spanName && exceptionInstance.spanId && (
                      <div className="ml-5 mt-0.5 font-mono text-xs text-gray-400">
                        {exceptionInstance.spanId.toString()}
                      </div>
                    )}
                  </div>
                );
              },
            },
            {
              field: {
                escaped: true,
              },
              title: "Handling",
              type: FieldType.Element,
              getElement: (
                exceptionInstance: ExceptionInstance,
              ): ReactElement => {
                return exceptionInstance.escaped ? (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
                    Unhandled
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
                    Handled
                  </span>
                );
              },
            },
            {
              field: {
                release: true,
              },
              title: "Release",
              type: FieldType.Element,
              getElement: (
                exceptionInstance: ExceptionInstance,
              ): ReactElement => {
                return (
                  <div className="min-w-0" data-testid="occurrence-release">
                    {exceptionInstance.release ? (
                      <div className="font-mono text-[13px] text-gray-700">
                        {exceptionInstance.release}
                      </div>
                    ) : (
                      <div className="text-gray-400">No release</div>
                    )}
                    {exceptionInstance.environment && (
                      <div className="mt-0.5 text-xs text-gray-500">
                        {exceptionInstance.environment}
                      </div>
                    )}
                  </div>
                );
              },
            },
            {
              field: {
                traceId: true,
              },
              title: "Trace",
              type: FieldType.Element,
              getElement: (
                exceptionInstance: ExceptionInstance,
              ): ReactElement => {
                const traceId: string =
                  exceptionInstance.traceId?.toString().trim() || "";

                if (!traceId) {
                  return <span className="text-gray-400">-</span>;
                }

                return (
                  <AppLink
                    to={RouteUtil.populateRouteParams(
                      RouteMap[PageMap.TRACE_VIEW] as Route,
                      { modelId: traceId },
                    )}
                    className="font-mono text-[13px] text-indigo-600 hover:text-indigo-500 hover:underline"
                  >
                    <span title={traceId}>
                      {traceId.length > 16
                        ? `${traceId.slice(0, 16)}…`
                        : traceId}
                    </span>
                  </AppLink>
                );
              },
            },
            {
              field: {
                sessionId: true,
              },
              title: "Related",
              type: FieldType.Element,
              getElement: (
                exceptionInstance: ExceptionInstance,
              ): ReactElement => {
                const logsLink: OccurrenceLogsLink | null =
                  buildOccurrenceLogsExplorerLink({
                    logsRoute,
                    traceId: exceptionInstance.traceId?.toString(),
                    time: exceptionInstance.time,
                  });

                const droppedHint: string = logsLink
                  ? formatDroppedScopeHint(logsLink.dropped)
                  : "";

                const sessionId: string =
                  exceptionInstance.sessionId?.toString() || "";
                const anchor: RumSessionLookupResult | undefined =
                  sessionAnchors.get(sessionId);

                /*
                 * The occurrence's own timestamp travels as ?at=; the
                 * player converts it against the manifest's start, so no
                 * offset arithmetic (and no clock-skew guess) happens here.
                 * The instance id selects the row in the errors rail.
                 */
                const occurredAt: Date | undefined = toOccurrenceDate(
                  exceptionInstance.time,
                );
                const instanceId: string =
                  exceptionInstance.id?.toString() || "";

                if (!logsLink && !(sessionId && anchor)) {
                  return <span className="text-gray-400">-</span>;
                }

                return (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 whitespace-nowrap text-sm">
                    {logsLink && (
                      <span {...(droppedHint ? { title: droppedHint } : {})}>
                        <AppLink
                          to={logsLink.route}
                          className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-500"
                        >
                          <Icon icon={IconProp.Logs} className="h-4 w-4" />
                          <span>Logs</span>
                        </AppLink>
                      </span>
                    )}
                    {sessionId && anchor && (
                      <ReplayLink
                        rumApplicationId={anchor.rumApplicationId}
                        sessionId={sessionId}
                        {...(occurredAt ? { atTime: occurredAt } : {})}
                        {...(instanceId
                          ? { signal: makeExceptionSignalId(instanceId) }
                          : {})}
                        rail="errors"
                        label="Watch replay"
                      />
                    )}
                  </div>
                );
              },
            },
          ]}
        />
      </div>
    </Fragment>
  );
};

export default OccouranceTable;
