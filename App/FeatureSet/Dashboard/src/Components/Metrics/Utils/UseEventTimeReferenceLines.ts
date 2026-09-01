import { useEffect, useMemo, useState } from "react";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import Query from "Common/Types/BaseDatabase/Query";
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
  deployment: "Deploy",
  "config-change": "Config change",
  scaling: "Scaling",
  rollback: "Rollback",
  "feature-flag": "Feature flag",
};

export function getChangeEventMarkerLabel(
  eventType: string | undefined,
  title: string,
): string {
  const prefix: string =
    CHANGE_EVENT_TYPE_LABELS[(eventType || "").toLowerCase()] || "Change";
  return `${prefix}: ${truncateEventMarkerTitle(title)}`;
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

/**
 * Fetch the events inside `window` and shape them into chart markers.
 * Best-effort throughout: each of the three fetches degrades to no
 * markers on failure, and nothing runs without a project session (public
 * dashboards) or an unresolved window.
 */
export default function useEventTimeReferenceLines(input: {
  enabled: boolean;
  window: InBetween<Date> | null | undefined;
  /** Bump to re-fetch (dashboards pass their auto-refresh tick). */
  refreshTick?: number | undefined;
}): EventTimeReferenceLines {
  const [eventMarkers, setEventMarkers] = useState<Array<EventMarker>>([]);

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
    windowStartMs !== undefined &&
    windowEndMs !== undefined &&
    !isPublicDashboard();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let isCancelled: boolean = false;

    const fetchEventMarkers: () => Promise<void> = async (): Promise<void> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      if (!projectId) {
        return;
      }

      const eventsWindow: InBetween<Date> = new InBetween<Date>(
        new Date(windowStartMs!),
        new Date(windowEndMs!),
      );

      /*
       * The three sources fail independently: a ClickHouse hiccup must
       * not take the incident markers down with it, and vice versa.
       */
      const [incidents, alerts, changeEvents]: [
        ListResult<Incident>,
        ListResult<Alert>,
        AnalyticsListResult<ChangeEvent>,
      ] = await Promise.all([
        ModelAPI.getList<Incident>({
          modelType: Incident,
          query: {
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
        }),
        ModelAPI.getList<Alert>({
          modelType: Alert,
          query: {
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
        }),
        AnalyticsModelAPI.getList<ChangeEvent>({
          modelType: ChangeEvent,
          query: {
            projectId: projectId,
            time: eventsWindow,
          } as Query<ChangeEvent>,
          select: {
            _id: true,
            time: true,
            title: true,
            eventType: true,
          },
          sort: {
            time: SortOrder.Descending,
          },
          limit: EVENT_OVERLAY_FETCH_LIMIT,
          skip: 0,
        }).catch((): AnalyticsListResult<ChangeEvent> => {
          return { data: [], count: 0, skip: 0, limit: 0 };
        }),
      ]);

      if (isCancelled) {
        return;
      }

      const markers: Array<EventMarker> = [];

      for (const incident of incidents.data) {
        if (!incident.createdAt || !incident.id) {
          continue;
        }
        markers.push({
          date: OneUptimeDate.fromString(
            incident.createdAt as unknown as string,
          ),
          label: `Incident: ${truncateEventMarkerTitle(incident.title || "")}`,
          kind: ChartEventKind.Incident,
          subtitle: incident.incidentSeverity?.name
            ? `Incident · ${incident.incidentSeverity.name}`
            : "Incident",
          color:
            incident.incidentSeverity?.color?.toString() ||
            INCIDENT_MARKER_COLOR,
          route: RouteUtil.populateRouteParams(
            RouteMap[PageMap.INCIDENT_VIEW]!,
            { modelId: incident.id },
          ),
        });
      }

      for (const alert of alerts.data) {
        if (!alert.createdAt || !alert.id) {
          continue;
        }
        markers.push({
          date: OneUptimeDate.fromString(alert.createdAt as unknown as string),
          label: `Alert: ${truncateEventMarkerTitle(alert.title || "")}`,
          kind: ChartEventKind.Alert,
          subtitle: alert.alertSeverity?.name
            ? `Alert · ${alert.alertSeverity.name}`
            : "Alert",
          color: alert.alertSeverity?.color?.toString() || ALERT_MARKER_COLOR,
          route: RouteUtil.populateRouteParams(RouteMap[PageMap.ALERT_VIEW]!, {
            modelId: alert.id,
          }),
        });
      }

      for (const changeEvent of changeEvents.data) {
        if (!changeEvent.time) {
          continue;
        }
        markers.push({
          date: OneUptimeDate.fromString(changeEvent.time as unknown as string),
          label: getChangeEventMarkerLabel(
            changeEvent.eventType,
            changeEvent.title || "",
          ),
          kind: ChartEventKind.Change,
          subtitle: "Change event",
          color: CHANGE_EVENT_MARKER_COLOR,
          strokeDasharray: "4 4",
        });
      }

      setEventMarkers(markers);
    };

    void fetchEventMarkers();

    return () => {
      isCancelled = true;
    };
  }, [enabled, windowStartMs, windowEndMs, input.refreshTick]);

  const lines: Array<ChartTimeReferenceLineProps> =
    useMemo((): Array<ChartTimeReferenceLineProps> => {
      if (!enabled) {
        return [];
      }
      return eventMarkers.map(
        (marker: EventMarker): ChartTimeReferenceLineProps => {
          return {
            date: marker.date,
            label: marker.label,
            color: marker.color,
            kind: marker.kind,
            subtitle: marker.subtitle,
            strokeDasharray: marker.strokeDasharray,
            onClick: marker.route
              ? () => {
                  Navigation.navigate(marker.route!);
                }
              : undefined,
          };
        },
      );
    }, [enabled, eventMarkers]);

  return { lines, markerCount: lines.length };
}
