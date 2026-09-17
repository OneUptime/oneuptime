import AlertStateUtil from "../../Utils/AlertState";
import IncidentStateUtil from "../../Utils/IncidentState";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SloOverviewEmptyState from "./SloOverviewEmptyState";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  sloId: ObjectID;
  // Bumped by the page's poll: someone can acknowledge or resolve at any time.
  refreshToken: number;
}

/** Latest open records listed under the counts. */
export const SLO_OVERVIEW_MAX_OPEN_EVENT_ROWS: number = 5;

type OpenEventKind = "Incident" | "Alert";

interface OpenEventRow {
  key: string;
  kind: OpenEventKind;
  title: string;
  to: Route;
  startedAt: Date | undefined;
  severityName: string | undefined;
  severityColor: Color | undefined;
  stateName: string | undefined;
}

interface OpenEvents {
  incidentCount: number;
  alertCount: number;
  rows: Array<OpenEventRow>;
}

type BuildSloEventQueryFunction<TModel extends Incident | Alert> = (data: {
  projectId: ObjectID;
  sloId: ObjectID;
  unresolvedStateIds: Array<ObjectID>;
}) => Query<TModel>;

/*
 * "Raised by this SLO" is the SLO affected-resource relation the worker
 * stamps on every burn-rate alert and incident (backfilled for older ones),
 * the same `Includes` over a resource relation the service and host overview
 * cards use — so these counts always match the SLO's Alerts and Incidents
 * pages. "Open" is every state before the first resolved state, from the
 * same cached state lists the side menu badges read.
 */
export const buildOpenSloIncidentQuery: BuildSloEventQueryFunction<
  Incident
> = (data: {
  projectId: ObjectID;
  sloId: ObjectID;
  unresolvedStateIds: Array<ObjectID>;
}): Query<Incident> => {
  return {
    projectId: data.projectId,
    serviceLevelObjectives: new Includes([data.sloId]),
    currentIncidentStateId: new Includes(data.unresolvedStateIds),
  };
};

export const buildOpenSloAlertQuery: BuildSloEventQueryFunction<
  Alert
> = (data: {
  projectId: ObjectID;
  sloId: ObjectID;
  unresolvedStateIds: Array<ObjectID>;
}): Query<Alert> => {
  return {
    projectId: data.projectId,
    serviceLevelObjectives: new Includes([data.sloId]),
    currentAlertStateId: new Includes(data.unresolvedStateIds),
  };
};

type StateIdsFunction = (
  states: Array<IncidentState | AlertState>,
) => Array<ObjectID>;

const getStateIds: StateIdsFunction = (
  states: Array<IncidentState | AlertState>,
): Array<ObjectID> => {
  const ids: Array<ObjectID> = [];

  for (const state of states) {
    if (state.id) {
      ids.push(state.id);
    }
  }

  return ids;
};

type DateOrUndefinedFunction = (
  value: Date | string | undefined,
) => Date | undefined;

const toDate: DateOrUndefinedFunction = (
  value: Date | string | undefined,
): Date | undefined => {
  return value ? OneUptimeDate.fromString(value) : undefined;
};

/*
 * The burn-rate alerts and incidents this SLO has open right now — the
 * sidebar's "is anyone already on this?" answer, with counts that link to
 * the full Alerts and Incidents pages and the most recent records by name.
 */
const SloActiveBurnEventsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [openEvents, setOpenEvents] = useState<OpenEvents | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!projectId) {
        // Nothing can be counted outside a project; say so rather than load forever.
        setError("Select a project to see open alerts and incidents.");
        return;
      }

      try {
        const [incidentStates, alertStates]: [
          Array<IncidentState>,
          Array<AlertState>,
        ] = await Promise.all([
          IncidentStateUtil.getUnresolvedIncidentStates(projectId),
          AlertStateUtil.getUnresolvedAlertStates(projectId),
        ]);

        const incidentStateIds: Array<ObjectID> = getStateIds(incidentStates);
        const alertStateIds: Array<ObjectID> = getStateIds(alertStates);

        const emptyIncidents: ListResult<Incident> = {
          data: [],
          count: 0,
          skip: 0,
          limit: 0,
        };
        const emptyAlerts: ListResult<Alert> = {
          data: [],
          count: 0,
          skip: 0,
          limit: 0,
        };

        /*
         * One list request per model: its `count` is the total match count,
         * so the badge numbers come free with the latest rows. A project with
         * no unresolved states defined cannot have anything open, and an
         * empty Includes is not a query worth sending.
         */
        const [incidents, alerts]: [ListResult<Incident>, ListResult<Alert>] =
          await Promise.all([
            incidentStateIds.length === 0
              ? Promise.resolve(emptyIncidents)
              : ModelAPI.getList<Incident>({
                  modelType: Incident,
                  query: buildOpenSloIncidentQuery({
                    projectId: projectId,
                    sloId: props.sloId,
                    unresolvedStateIds: incidentStateIds,
                  }),
                  select: {
                    _id: true,
                    title: true,
                    declaredAt: true,
                    createdAt: true,
                    incidentSeverity: {
                      name: true,
                      color: true,
                    },
                    currentIncidentState: {
                      name: true,
                    },
                  },
                  limit: SLO_OVERVIEW_MAX_OPEN_EVENT_ROWS,
                  skip: 0,
                  sort: {
                    createdAt: SortOrder.Descending,
                  },
                }),
            alertStateIds.length === 0
              ? Promise.resolve(emptyAlerts)
              : ModelAPI.getList<Alert>({
                  modelType: Alert,
                  query: buildOpenSloAlertQuery({
                    projectId: projectId,
                    sloId: props.sloId,
                    unresolvedStateIds: alertStateIds,
                  }),
                  select: {
                    _id: true,
                    title: true,
                    createdAt: true,
                    alertSeverity: {
                      name: true,
                      color: true,
                    },
                    currentAlertState: {
                      name: true,
                    },
                  },
                  limit: SLO_OVERVIEW_MAX_OPEN_EVENT_ROWS,
                  skip: 0,
                  sort: {
                    createdAt: SortOrder.Descending,
                  },
                }),
          ]);

        if (cancelled) {
          return;
        }

        const rows: Array<OpenEventRow> = [];

        for (const incident of incidents.data) {
          if (!incident._id) {
            continue;
          }

          rows.push({
            key: `incident-${incident._id.toString()}`,
            kind: "Incident",
            title: incident.title || "Untitled incident",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENT_VIEW] as Route,
              { modelId: new ObjectID(incident._id.toString()) },
            ),
            startedAt: toDate(incident.declaredAt || incident.createdAt),
            severityName: incident.incidentSeverity?.name,
            severityColor: incident.incidentSeverity?.color,
            stateName: incident.currentIncidentState?.name,
          });
        }

        for (const alert of alerts.data) {
          if (!alert._id) {
            continue;
          }

          rows.push({
            key: `alert-${alert._id.toString()}`,
            kind: "Alert",
            title: alert.title || "Untitled alert",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_VIEW] as Route,
              { modelId: new ObjectID(alert._id.toString()) },
            ),
            startedAt: toDate(alert.createdAt),
            severityName: alert.alertSeverity?.name,
            severityColor: alert.alertSeverity?.color,
            stateName: alert.currentAlertState?.name,
          });
        }

        rows.sort((a: OpenEventRow, b: OpenEventRow) => {
          return (b.startedAt?.getTime() || 0) - (a.startedAt?.getTime() || 0);
        });

        setOpenEvents({
          incidentCount: incidents.count,
          alertCount: alerts.count,
          rows: rows.slice(0, SLO_OVERVIEW_MAX_OPEN_EVENT_ROWS),
        });
        setError("");
      } catch (err) {
        if (!cancelled) {
          setError(API.getFriendlyMessage(err));
        }
      }
    };

    load().catch(() => {
      // load() records its own error.
    });

    return () => {
      cancelled = true;
    };
  }, [props.sloId.toString(), props.refreshToken]);

  const incidentsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SLO_VIEW_INCIDENTS] as Route,
    { modelId: props.sloId },
  );

  const alertsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SLO_VIEW_ALERTS] as Route,
    { modelId: props.sloId },
  );

  type GetCountTileFunction = (data: {
    label: string;
    count: number | null;
    to: Route;
    activeClassName: string;
    testId: string;
  }) => ReactElement;

  const getCountTile: GetCountTileFunction = (data: {
    label: string;
    count: number | null;
    to: Route;
    activeClassName: string;
    testId: string;
  }): ReactElement => {
    return (
      <Link
        to={data.to}
        className="block rounded-lg border border-gray-200 px-3 py-2.5 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">
          {data.label}
        </span>
        <span
          data-testid={data.testId}
          className={`mt-0.5 block text-2xl font-semibold tabular-nums ${
            data.count !== null && data.count > 0
              ? data.activeClassName
              : "text-gray-900"
          }`}
        >
          {data.count === null ? "—" : data.count}
        </span>
      </Link>
    );
  };

  type GetBodyFunction = () => ReactElement;

  const getBody: GetBodyFunction = (): ReactElement => {
    if (!openEvents && error) {
      return <p className="text-sm text-red-700">{error}</p>;
    }

    const incidentCount: number | null = openEvents
      ? openEvents.incidentCount
      : null;
    const alertCount: number | null = openEvents ? openEvents.alertCount : null;

    return (
      <div>
        <div className="grid grid-cols-2 gap-3">
          {getCountTile({
            label: "Incidents",
            count: incidentCount,
            to: incidentsRoute,
            activeClassName: "text-red-700",
            testId: "slo-open-incident-count",
          })}
          {getCountTile({
            label: "Alerts",
            count: alertCount,
            to: alertsRoute,
            activeClassName: "text-amber-700",
            testId: "slo-open-alert-count",
          })}
        </div>

        {!openEvents ? (
          <div
            role="status"
            aria-label="Loading open alerts and incidents"
            className="mt-4 space-y-2 motion-safe:animate-pulse"
          >
            <div className="h-4 w-5/6 rounded bg-gray-100"></div>
            <div className="h-4 w-2/3 rounded bg-gray-100"></div>
          </div>
        ) : openEvents.rows.length === 0 ? (
          <SloOverviewEmptyState
            dataTestId="slo-open-events-empty"
            icon={IconProp.CheckCircle}
            tone="good"
            title="Nothing open"
            description="No burn rate rule has an unresolved alert or incident for this SLO."
          />
        ) : (
          <ul
            aria-label="Latest open alerts and incidents"
            className="mt-4 divide-y divide-gray-100"
          >
            {openEvents.rows.map((row: OpenEventRow) => {
              return (
                <li
                  key={row.key}
                  data-testid="slo-open-event-row"
                  className="py-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      to={row.to}
                      className="min-w-0 break-words text-sm font-medium text-gray-900 hover:text-indigo-600 hover:underline"
                    >
                      {row.title}
                    </Link>
                    {row.startedAt ? (
                      <time
                        dateTime={row.startedAt.toISOString()}
                        title={OneUptimeDate.getDateAsLocalFormattedString(
                          row.startedAt,
                        )}
                        className="flex-shrink-0 text-xs text-gray-500"
                      >
                        {OneUptimeDate.fromNow(row.startedAt)}
                      </time>
                    ) : (
                      <></>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                    <span className="font-medium text-gray-700">
                      {row.kind}
                    </span>
                    {row.severityName ? (
                      <span className="inline-flex items-center gap-1">
                        <span
                          aria-hidden="true"
                          className="h-2 w-2 rounded-full"
                          style={{
                            backgroundColor: row.severityColor
                              ? row.severityColor.toString()
                              : undefined,
                          }}
                        ></span>
                        {row.severityName}
                      </span>
                    ) : (
                      <></>
                    )}
                    {row.stateName ? <span>{row.stateName}</span> : <></>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {openEvents && error ? (
          <p role="alert" className="mt-3 text-xs text-red-700">
            {`Could not refresh: ${error}`}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <Card
      title="Open alerts & incidents"
      description="Unresolved alerts and incidents raised by this SLO's burn rate rules."
      headerLayout="stacked"
    >
      {getBody()}
    </Card>
  );
};

export default SloActiveBurnEventsCard;
