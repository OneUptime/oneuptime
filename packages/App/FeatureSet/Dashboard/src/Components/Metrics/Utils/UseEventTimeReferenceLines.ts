import { useEffect, useMemo, useState } from "react";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import Query from "Common/Types/BaseDatabase/Query";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import { getEventOverlayScope, EventOverlayScope } from "./EventOverlayScope";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Alert from "Common/Models/DatabaseModels/Alert";
/*
 * Sibling-relative on purpose — the `Common` specifier can resolve a
 * checkout that predates this branch-new model.
 */
import ChangeEvent from "../../../../../../../Common/Models/AnalyticsModels/ChangeEvent";
import Incident from "Common/Models/DatabaseModels/Incident";
/*
 * Sibling-relative on purpose, same as ChangeEvent above — the `Common`
 * specifier can resolve a checkout that predates this branch-new enum.
 */
import ChartEventKind from "../../../../../../../Common/UI/Components/Charts/Types/ChartEventKind";
import ChartTimeReferenceLineProps from "Common/UI/Components/Charts/Types/TimeReferenceLineProps";
import AnalyticsModelAPI, {
  ListResult as AnalyticsListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  getGlobalTranslator,
  translatableTerm,
  translateTemplate,
  translateText,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  ChangeEventAttribute,
  ChangeEventSource,
} from "Common/Utils/Telemetry/ChangeEventFields";
import {
  CloudChangeTitleFacts,
  CloudHealthTitleFacts,
  getCloudChangeTitle,
  getCloudHealthTitle,
  readCloudChangeTitleFacts,
  readCloudHealthTitleFacts,
} from "Common/Utils/Telemetry/CloudChangeTitle";
import { JSONObject } from "Common/Types/JSON";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import { isPublicDashboard } from "../../Dashboard/Utils/PublicDashboardContext";

/*
 * Event overlay for metric charts: incidents, alerts, and change events
 * (deploys/config changes) inside the charted window, mapped to the
 * chart layer's time-anchored vertical markers. Extracted from
 * MetricExplorer so every chart surface — the explorer, dashboard chart
 * widgets, embedded metric cards — draws the same "what happened here"
 * context; the explorer keeps its own show/hide toggle on top.
 */

// Max incidents, alerts, and change events (each) fetched for markers.
export const EVENT_OVERLAY_FETCH_LIMIT: number = 50;

// Muted severity-ish marker colors (fallbacks when severity has no color).
export const INCIDENT_MARKER_COLOR: string = "#f87171"; // red-400
export const ALERT_MARKER_COLOR: string = "#fbbf24"; // amber-400
export const CHANGE_EVENT_MARKER_COLOR: string = "#6366f1"; // indigo-500

/*
 * Markers no longer paint their label onto the plot — it reads in the
 * rail chip's hover card, which is HTML and wraps — but a card listing a
 * dozen clustered events still has to stay scannable, so titles keep a
 * generous cap. A marker's click-through target still opens the full
 * record.
 */
export const EVENT_MARKER_TITLE_MAX_LENGTH: number = 80;

export function truncateEventMarkerTitle(title: string): string {
  if (title.length <= EVENT_MARKER_TITLE_MAX_LENGTH) {
    return title;
  }

  return `${title.slice(0, EVENT_MARKER_TITLE_MAX_LENGTH).trimEnd()}…`;
}

/*
 * Human prefix for a change event's marker label, keyed by the ingest
 * API's normalized (lowercased) eventType. Unknown types fall back to
 * "Change".
 */
const CHANGE_EVENT_TYPE_LABELS: Record<string, string> = {
  deployment: translationKey("Deploy"),
  "config-change": translationKey("Config change"),
  scaling: translationKey("Scaling"),
  rollback: translationKey("Rollback"),
  "feature-flag": translationKey("Feature flag"),
  // What OneUptime itself changed (OwnChangeRecorder).
  remediation: translationKey("AI fix"),
  runbook: translationKey("Runbook"),
  // What a cloud provider published about an account's health.
  "provider-event": translationKey("Cloud health"),
  // What an OpenStack cloud's notifications said happened to one of its parts.
  "openstack-event": translationKey("OpenStack"),
};

/*
 * What kind of change an event is, in English (translationKey): "Deploy",
 * "Config change", "Cloud health" - "Change" for a type it does not know.
 * The marker labels and the cloud Changes lists name a change the same way.
 */
export function getChangeEventTypeLabel(eventType: string | undefined): string {
  return (
    CHANGE_EVENT_TYPE_LABELS[(eventType || "").toLowerCase()] ||
    translationKey("Change")
  );
}

/*
 * What a change's marker calls it: an operation a cloud account's activity
 * log recorded in the reader's language, worded from its operation,
 * resource and outcome (CloudChangeTitle), as the cloud Changes lists say
 * it; a cloud's health event with its frame and state in the reader's
 * language; any other change by its own title.
 */
export function getChangeEventMarkerTitle(
  change: {
    title?: string | undefined;
    attributes?: JSONObject | undefined;
  },
  translator: Translator = getGlobalTranslator(),
): string {
  const facts: CloudChangeTitleFacts | null = readCloudChangeTitleFacts({
    title: change.title,
    attributes: change.attributes,
  });

  if (facts) {
    return getCloudChangeTitle(facts, translator, { setsValuesApart: true });
  }

  const health: CloudHealthTitleFacts | null = readCloudHealthTitleFacts({
    title: change.title,
    attributes: change.attributes,
  });

  return health
    ? getCloudHealthTitle(health, translator, { setsValuesApart: true })
    : change.title || "";
}

// The line under a change marker's title in its hover card.
export const CHANGE_EVENT_MARKER_SUBTITLE: string =
  translationKey("Change event");

export function getChangeEventMarkerLabel(
  eventType: string | undefined,
  title: string,
): string {
  const prefix: string = getChangeEventTypeLabel(eventType);
  // The kind of change in the reader's language, then the event's own title.
  return translateTemplate("{{kind}}: {{title}}", {
    kind: translatableTerm(prefix),
    title: truncateEventMarkerTitle(title),
  });
}

/*
 * The change events a marker fetch reads. A chart scoped to no resource
 * draws the project's changes - but not every operation a cloud account's
 * activity log recorded: a busy account records hundreds an hour, and the
 * newest fifty of them would be all the chart could draw, its deploys
 * pushed out. Those are on the charts of the resources they changed, and so are
 * an OpenStack cloud's lifecycle events; the provider's own health events stay on
 * every chart.
 */
export function getChangeEventFetchQuery(
  query: Query<ChangeEvent>,
): Query<ChangeEvent> {
  if (Object.keys(query).length > 0) {
    return query;
  }

  return {
    attributes: {
      [ChangeEventAttribute.Source]: new IncludesNone([
        ChangeEventSource.Cloud,
        ChangeEventSource.OpenStack,
      ]),
    },
  } as unknown as Query<ChangeEvent>;
}

// One incident/alert/change event mapped onto a chart time marker.
export interface EventMarker {
  date: Date;
  label: string;
  color: string;
  /** What the marker is; drives the chip colour when markers cluster. */
  kind: ChartEventKind;
  /** Second line in the marker's hover card (severity, event type). */
  subtitle?: string | undefined;
  /** Absent for change events — they have no detail page (yet). */
  route?: Route | undefined;
  /** Dashed for change events, solid for incidents/alerts. */
  strokeDasharray?: string | undefined;
}

export interface EventTimeReferenceLines {
  lines: Array<ChartTimeReferenceLineProps>;
  markerCount: number;
}

/*
 * A monitor's own incidents and alerts, and the changes the charts' resource
 * filters find (the monitor's page): the incidents that list the monitor,
 * the alerts it opened.
 */
export function getMonitorEventOverlayScope(
  queryScope: EventOverlayScope,
  monitorId: string,
): EventOverlayScope {
  let id: ObjectID;

  try {
    id = new ObjectID(monitorId);
  } catch {
    return queryScope;
  }

  return {
    incidentQueries: [{ monitors: new Includes([id]) } as Query<Incident>],
    alertQueries: [{ monitorId: id } as Query<Alert>],
    changeEventQueries: queryScope.changeEventQueries,
  };
}

/** Merge overlapping resource queries without duplicating an event on the chart. */
function mergeEventResults<T extends { id?: ObjectID | null | undefined }>(
  results: Array<{ data: Array<T> }>,
  dateField: keyof T,
): Array<T> {
  const seen: Set<string> = new Set<string>();
  return results
    .flatMap((result: { data: Array<T> }): Array<T> => {
      return result.data;
    })
    .filter((event: T): boolean => {
      const id: string | undefined = event.id?.toString();
      if (!id) {
        return true;
      }
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    })
    .sort((left: T, right: T): number => {
      return (
        new Date(right[dateField] as string).getTime() -
        new Date(left[dateField] as string).getTime()
      );
    })
    .slice(0, EVENT_OVERLAY_FETCH_LIMIT);
}

/**
 * Fetch the events inside `window` and shape them into chart markers.
 * Best-effort throughout: each of the three fetches degrades to no
 * markers on failure, and nothing runs without a project session (public
 * dashboards) or an unresolved window.
 */
export default function useEventTimeReferenceLines(input: {
  enabled: boolean;
  window: InBetween<Date> | null | undefined;
  /** Resource filters from the chart, applied before the event fetch limit. */
  queryConfigs?: Array<MetricQueryConfigData> | undefined;
  /** Bump to re-fetch (dashboards pass their auto-refresh tick). */
  refreshTick?: number | undefined;
  /*
   * Incidents and alerts left off the charts: the one a page is about,
   * whose own moments the page marks itself (declared, acknowledged,
   * resolved), would otherwise be marked twice where it started.
   */
  excludedIncidentIds?: Array<string> | undefined;
  excludedAlertIds?: Array<string> | undefined;
  /*
   * The incidents and alerts of this monitor, rather than those the
   * charts' resource filters find: a monitor's page marks what the monitor
   * opened. Changes are still found by the charts' filters.
   */
  monitorId?: string | undefined;
  /*
   * Whether a click on an incident's or an alert's marker opens it, as it
   * does unless this is false. A dashboard widget's live preview says no
   * (issue #6859): it sits over a board being edited, and the incident's
   * page would take what is not saved yet with it.
   */
  opensEvents?: boolean | undefined;
}): EventTimeReferenceLines {
  const [result, setResult] = useState<{
    requestKey: string;
    markers: Array<EventMarker>;
  } | null>(null);

  const queryScope: EventOverlayScope = getEventOverlayScope(
    input.queryConfigs || [],
  );
  const monitorId: string = (input.monitorId || "").trim();
  const scope: EventOverlayScope = monitorId
    ? getMonitorEventOverlayScope(queryScope, monitorId)
    : queryScope;
  const scopeKey: string = JSON.stringify(scope);
  const projectIdString: string | undefined =
    ProjectUtil.getCurrentProjectId()?.toString();

  /*
   * Depend on primitive ms values, not the InBetween object — hosts hand
   * over referentially-new-but-equal windows on most renders, and each
   * refire is three list calls.
   */
  const windowStartMs: number | undefined =
    input.window?.startValue instanceof Date
      ? input.window.startValue.getTime()
      : undefined;
  const windowEndMs: number | undefined =
    input.window?.endValue instanceof Date
      ? input.window.endValue.getTime()
      : undefined;

  const enabled: boolean =
    input.enabled &&
    Boolean(projectIdString) &&
    windowStartMs !== undefined &&
    windowEndMs !== undefined &&
    !isPublicDashboard();

  const excludedIncidentIds: Array<string> = input.excludedIncidentIds || [];
  const excludedAlertIds: Array<string> = input.excludedAlertIds || [];

  const requestKey: string = JSON.stringify([
    enabled,
    projectIdString,
    scopeKey,
    windowStartMs,
    windowEndMs,
    input.refreshTick,
    ...(excludedIncidentIds.length > 0 || excludedAlertIds.length > 0
      ? [excludedIncidentIds, excludedAlertIds]
      : []),
  ]);

  useEffect(() => {
    // Clear even when disabled so re-enabling cannot revive an old result.
    setResult(null);
    if (!enabled || !projectIdString) {
      return;
    }

    let isCancelled: boolean = false;

    const fetchEventMarkers: () => Promise<void> = async (): Promise<void> => {
      const projectId: ObjectID = new ObjectID(projectIdString);

      const eventsWindow: InBetween<Date> = new InBetween<Date>(
        new Date(windowStartMs!),
        new Date(windowEndMs!),
      );

      /*
       * The three sources fail independently: a ClickHouse hiccup must
       * not take the incident markers down with it, and vice versa.
       */
      const [incidents, alerts, changeEvents]: [
        Array<ListResult<Incident>>,
        Array<ListResult<Alert>>,
        Array<AnalyticsListResult<ChangeEvent>>,
      ] = await Promise.all([
        Promise.all(
          scope.incidentQueries.map((query: Query<Incident>) => {
            return ModelAPI.getList<Incident>({
              modelType: Incident,
              query: {
                ...query,
                projectId: projectId,
                createdAt: eventsWindow,
              },
              select: {
                _id: true,
                title: true,
                createdAt: true,
                incidentSeverity: {
                  name: true,
                  color: true,
                },
              },
              sort: {
                createdAt: SortOrder.Descending,
              },
              limit: EVENT_OVERLAY_FETCH_LIMIT,
              skip: 0,
            }).catch((): ListResult<Incident> => {
              return { data: [], count: 0, skip: 0, limit: 0 };
            });
          }),
        ),
        Promise.all(
          scope.alertQueries.map((query: Query<Alert>) => {
            return ModelAPI.getList<Alert>({
              modelType: Alert,
              query: {
                ...query,
                projectId: projectId,
                createdAt: eventsWindow,
              },
              select: {
                _id: true,
                title: true,
                createdAt: true,
                alertSeverity: {
                  name: true,
                  color: true,
                },
              },
              sort: {
                createdAt: SortOrder.Descending,
              },
              limit: EVENT_OVERLAY_FETCH_LIMIT,
              skip: 0,
            }).catch((): ListResult<Alert> => {
              return { data: [], count: 0, skip: 0, limit: 0 };
            });
          }),
        ),
        Promise.all(
          scope.changeEventQueries.map((query: Query<ChangeEvent>) => {
            return AnalyticsModelAPI.getList<ChangeEvent>({
              modelType: ChangeEvent,
              query: {
                ...getChangeEventFetchQuery(query),
                projectId: projectId,
                time: eventsWindow,
              } as Query<ChangeEvent>,
              select: {
                _id: true,
                time: true,
                title: true,
                eventType: true,
                // A cloud change's title is worded from what it keeps.
                attributes: true,
              },
              sort: {
                time: SortOrder.Descending,
              },
              limit: EVENT_OVERLAY_FETCH_LIMIT,
              skip: 0,
            }).catch((): AnalyticsListResult<ChangeEvent> => {
              return { data: [], count: 0, skip: 0, limit: 0 };
            });
          }),
        ),
      ]);

      if (isCancelled) {
        return;
      }

      const markers: Array<EventMarker> = [];

      for (const incident of mergeEventResults(incidents, "createdAt")) {
        if (!incident.createdAt || !incident.id) {
          continue;
        }
        if (excludedIncidentIds.includes(incident.id.toString())) {
          continue;
        }
        markers.push({
          date: OneUptimeDate.fromString(
            incident.createdAt as unknown as string,
          ),
          label: translateTemplate("Incident: {{title}}", {
            title: truncateEventMarkerTitle(incident.title || ""),
          }),
          kind: ChartEventKind.Incident,
          subtitle: incident.incidentSeverity?.name
            ? translateTemplate("Incident · {{severity}}", {
                severity: incident.incidentSeverity.name,
              })
            : translateTemplate("Incident"),
          color:
            incident.incidentSeverity?.color?.toString() ||
            INCIDENT_MARKER_COLOR,
          route: RouteUtil.populateRouteParams(
            RouteMap[PageMap.INCIDENT_VIEW]!,
            { modelId: incident.id },
          ),
        });
      }

      for (const alert of mergeEventResults(alerts, "createdAt")) {
        if (!alert.createdAt || !alert.id) {
          continue;
        }
        if (excludedAlertIds.includes(alert.id.toString())) {
          continue;
        }
        markers.push({
          date: OneUptimeDate.fromString(alert.createdAt as unknown as string),
          label: translateTemplate("Alert: {{title}}", {
            title: truncateEventMarkerTitle(alert.title || ""),
          }),
          kind: ChartEventKind.Alert,
          subtitle: alert.alertSeverity?.name
            ? translateTemplate("Alert · {{severity}}", {
                severity: alert.alertSeverity.name,
              })
            : translateTemplate("Alert"),
          color: alert.alertSeverity?.color?.toString() || ALERT_MARKER_COLOR,
          route: RouteUtil.populateRouteParams(RouteMap[PageMap.ALERT_VIEW]!, {
            modelId: alert.id,
          }),
        });
      }

      for (const changeEvent of mergeEventResults(changeEvents, "time")) {
        if (!changeEvent.time) {
          continue;
        }
        markers.push({
          date: OneUptimeDate.fromString(changeEvent.time as unknown as string),
          label: getChangeEventMarkerLabel(
            changeEvent.eventType,
            getChangeEventMarkerTitle({
              title: changeEvent.title,
              attributes: changeEvent.attributes as JSONObject | undefined,
            }),
          ),
          kind: ChartEventKind.Change,
          subtitle:
            translateText(CHANGE_EVENT_MARKER_SUBTITLE) ||
            CHANGE_EVENT_MARKER_SUBTITLE,
          color: CHANGE_EVENT_MARKER_COLOR,
          strokeDasharray: "4 4",
        });
      }

      setResult({ requestKey, markers });
    };

    void fetchEventMarkers();

    return () => {
      isCancelled = true;
    };
  }, [requestKey]);

  const opensEvents: boolean = input.opensEvents !== false;

  const lines: Array<ChartTimeReferenceLineProps> =
    useMemo((): Array<ChartTimeReferenceLineProps> => {
      if (!enabled || result?.requestKey !== requestKey) {
        return [];
      }
      return result.markers.map(
        (marker: EventMarker): ChartTimeReferenceLineProps => {
          return {
            date: marker.date,
            label: marker.label,
            color: marker.color,
            kind: marker.kind,
            subtitle: marker.subtitle,
            strokeDasharray: marker.strokeDasharray,
            onClick:
              marker.route && opensEvents
                ? () => {
                    Navigation.navigate(marker.route!);
                  }
                : undefined,
          };
        },
      );
    }, [enabled, requestKey, result, opensEvents]);

  return { lines, markerCount: lines.length };
}
