import SpanStatusElement from "../Span/SpanStatusElement";
import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import RumSession from "Common/Models/AnalyticsModels/RumSession";
import AnalyticsModelTable from "Common/UI/Components/ModelTable/AnalyticsModelTable";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import FieldType from "Common/UI/Components/Types/FieldType";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
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
import TraceElement from "../Traces/TraceElement";
import ReplayLink from "../SessionReplay/ReplayLink";
import AppLink from "../AppLink/AppLink";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import { formatDroppedScopeHint } from "../../Utils/LogsCrossSignalPivot";
import {
  OccurrenceLogsLink,
  RumSessionAnchor,
  buildOccurrenceLogsExplorerLink,
  buildRumSessionAnchorMap,
  collectDistinctSessionIds,
  getReplayAnchorOffsetMs,
} from "../../Utils/ExceptionCorrelation";

export interface ComponentProps {
  exceptionFingerprint: string;
}

const OccouranceTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * A replay link needs the session's application id and start time, which
   * an occurrence row does not carry. Resolved per fetched page through ONE
   * batched RumSession lookup (nothing fires when the page has no session
   * ids), and cached across pages.
   */
  const [sessionAnchors, setSessionAnchors] = useState<
    Map<string, RumSessionAnchor>
  >(new Map());
  const sessionAnchorsRef: MutableRefObject<Map<string, RumSessionAnchor>> =
    useRef<Map<string, RumSessionAnchor>>(new Map());
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
        const result: ListResult<RumSession> =
          await AnalyticsModelAPI.getList<RumSession>({
            modelType: RumSession,
            query: {
              sessionId: new Includes(sessionIds),
            } as Query<RumSession>,
            select: {
              sessionId: true,
              rumApplicationId: true,
              startTime: true,
            },
            sort: {},
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          });

        const resolved: Map<string, RumSessionAnchor> =
          buildRumSessionAnchorMap(
            result.data.map(
              (
                session: RumSession,
              ): {
                sessionId?: string | undefined;
                rumApplicationId?: string | undefined;
                startTime?: unknown;
              } => {
                return {
                  sessionId: session.sessionId?.toString(),
                  rumApplicationId: session.rumApplicationId?.toString(),
                  startTime: session.startTime,
                };
              },
            ),
          );

        if (resolved.size === 0) {
          return;
        }

        const merged: Map<string, RumSessionAnchor> = new Map(
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
          userPreferencesKey="exception-instance-table"
          modelType={ExceptionInstance}
          id="traces-table"
          isDeleteable={false}
          isEditable={false}
          isCreateable={false}
          singularName="Exception"
          pluralName="Exceptions"
          name="Exception"
          isViewable={false}
          cardProps={{
            title: "Exception Occurrences",
            description:
              "View all the traces that are related to this exception.",
          }}
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
            fingerprint: props.exceptionFingerprint,
          }}
          onFetchSuccess={(data: Array<ExceptionInstance>) => {
            void resolveSessionAnchors(data);
          }}
          showViewIdButton={true}
          noItemsMessage={"No exception found."}
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
            sessionId: true,
          }}
          columns={[
            {
              field: {
                spanId: true,
              },
              title: "Span ID",
              type: FieldType.Element,
              getElement: (
                exceptionInstance: ExceptionInstance,
              ): ReactElement => {
                return (
                  <Fragment>
                    <SpanStatusElement
                      traceId={exceptionInstance.traceId?.toString()}
                      spanStatusCode={exceptionInstance.spanStatusCode!}
                      title={exceptionInstance.spanId?.toString()}
                    />
                  </Fragment>
                );
              },
            },
            {
              field: {
                traceId: true,
              },
              title: "Trace ID",
              type: FieldType.Element,
              getElement: (
                exceptionInstance: ExceptionInstance,
              ): ReactElement => {
                return (
                  <Fragment>
                    <TraceElement
                      traceId={exceptionInstance.traceId?.toString()}
                    />
                  </Fragment>
                );
              },
            },
            {
              field: {
                spanName: true,
              },
              title: "Span Name",
              type: FieldType.Text,
            },
            {
              field: {
                release: true,
              },
              title: "Release",
              type: FieldType.Text,
            },
            {
              field: {
                environment: true,
              },
              title: "Environment",
              type: FieldType.Text,
            },
            {
              field: {
                time: true,
              },
              title: "Time of Occurrence",
              type: FieldType.DateTime,
            },
            {
              field: {
                traceId: true,
              },
              title: "Logs",
              type: FieldType.Element,
              getElement: (
                exceptionInstance: ExceptionInstance,
              ): ReactElement => {
                const link: OccurrenceLogsLink | null =
                  buildOccurrenceLogsExplorerLink({
                    logsRoute,
                    traceId: exceptionInstance.traceId?.toString(),
                    time: exceptionInstance.time,
                  });

                if (!link) {
                  return <></>;
                }

                const droppedHint: string = formatDroppedScopeHint(
                  link.dropped,
                );

                return (
                  <span {...(droppedHint ? { title: droppedHint } : {})}>
                    <AppLink to={link.route} className="hover:underline">
                      <p>View Logs</p>
                    </AppLink>
                  </span>
                );
              },
            },
            {
              field: {
                sessionId: true,
              },
              title: "Session Replay",
              type: FieldType.Element,
              getElement: (
                exceptionInstance: ExceptionInstance,
              ): ReactElement => {
                const sessionId: string =
                  exceptionInstance.sessionId?.toString() || "";
                const anchor: RumSessionAnchor | undefined =
                  sessionAnchors.get(sessionId);

                if (!sessionId || !anchor) {
                  // ReplayLink renders nothing without both ids anyway.
                  return <></>;
                }

                const offsetMs: number | null = getReplayAnchorOffsetMs(
                  exceptionInstance.time,
                  anchor.startTime,
                );

                return (
                  <ReplayLink
                    rumApplicationId={new ObjectID(anchor.rumApplicationId)}
                    sessionId={sessionId}
                    {...(offsetMs !== null ? { atOffsetMs: offsetMs } : {})}
                    label="Watch replay"
                  />
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
