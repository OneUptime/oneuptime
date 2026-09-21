import Incident from "Common/Models/DatabaseModels/Incident";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import { MonitorUptimeSummary } from "Common/Types/Monitor/MonitorUptimeSummary";
import UptimeBarTooltipIncident from "Common/Types/Monitor/UptimeBarTooltipIncident";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import MonitorCheckScheduleUtil from "Common/Utils/Monitor/MonitorCheckScheduleUtil";
import MonitorUptimeSummaryUtil from "Common/Utils/Monitor/MonitorUptimeSummaryUtil";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  OverviewSection,
  failSection,
  forbidSection,
  getLoadingSection,
  getSectionForSubject,
  resolveSection,
  shouldAttemptRead,
} from "../../../Utils/OverviewSection";

export const MONITOR_UPTIME_SUMMARY_UNREADABLE_MESSAGE: string =
  "The uptime summary could not be read.";

export const MONITOR_UPTIME_ACCESS_REASONS: {
  summary: string;
  incidents: string;
} = {
  summary: "You need permission to read this monitor's status timeline.",
  incidents: "You need permission to read incidents.",
};

// The markers need the window the summary covers, so they cannot load without it.
export const MONITOR_UPTIME_INCIDENTS_WITHOUT_SUMMARY_MESSAGE: string =
  "Incident markers need the uptime history, which did not load.";

// Severity and state colours are required by the tooltip; a missing one is drawn black.
const FALLBACK_MARKER_COLOR: string = "#000000";

export interface UseMonitorUptimeSummaryResult {
  summary: OverviewSection<MonitorUptimeSummary>;
  incidents: OverviewSection<Array<UptimeBarTooltipIncident>>;
  retry: () => void;
}

type ToTooltipIncidentFunction = (
  incident: Incident,
) => UptimeBarTooltipIncident | null;

// The same shape the old overview built for the bar tooltips.
const toTooltipIncident: ToTooltipIncidentFunction = (
  incident: Incident,
): UptimeBarTooltipIncident | null => {
  const id: string = incident._id?.toString() || "";
  const declaredAt: Date | undefined = MonitorCheckScheduleUtil.parseDate(
    incident.declaredAt,
  );

  if (!id || !declaredAt) {
    return null;
  }

  const monitorIds: Array<ObjectID> = [];

  for (const monitor of incident.monitors || []) {
    const monitorId: string = monitor?._id?.toString() || "";

    if (monitorId) {
      monitorIds.push(new ObjectID(monitorId));
    }
  }

  return {
    id: id,
    title: incident.title || "",
    declaredAt: declaredAt,
    incidentSeverity: incident.incidentSeverity
      ? {
          name: incident.incidentSeverity.name || "",
          color:
            incident.incidentSeverity.color || new Color(FALLBACK_MARKER_COLOR),
        }
      : undefined,
    currentIncidentState: incident.currentIncidentState
      ? {
          name: incident.currentIncidentState.name || "",
          color:
            incident.currentIncidentState.color ||
            new Color(FALLBACK_MARKER_COLOR),
        }
      : undefined,
    monitorIds: monitorIds,
  };
};

/*
 * The monitor's 90-day uptime history (U1) and the incidents to mark on it
 * (U2).
 *
 * U1 is the server aggregate, GET /monitor/uptime-summary/:monitorId, cut
 * into days in the browser's time zone. It replaced a 10,000-row timeline
 * fetch whose truncation painted the oldest days as 100%. The incident
 * overlay follows each successful summary, over exactly the window the
 * summary covers.
 *
 * No timer: it reloads when `refreshKey` changes, which Index derives from
 * the data hook's poll (every fifth poll, a status change, a manual
 * refresh). A reload keeps the last summary on screen; a failed reload
 * keeps it too and records the failure next to it.
 */
export const useMonitorUptimeSummary: (options: {
  monitorId: ObjectID;
  refreshKey: string;
}) => UseMonitorUptimeSummaryResult = (options: {
  monitorId: ObjectID;
  refreshKey: string;
}): UseMonitorUptimeSummaryResult => {
  const monitorIdString: string = options.monitorId.toString();

  const [summary, setSummary] =
    useState<OverviewSection<MonitorUptimeSummary>>(
      getLoadingSection<MonitorUptimeSummary>(),
    );
  const [incidents, setIncidents] =
    useState<OverviewSection<Array<UptimeBarTooltipIncident>>>(
      getLoadingSection<Array<UptimeBarTooltipIncident>>(),
    );
  const [retryCount, setRetryCount] = useState<number>(0);

  const summaryRef: MutableRefObject<OverviewSection<MonitorUptimeSummary>> =
    useRef<OverviewSection<MonitorUptimeSummary>>(summary);
  const incidentsRef: MutableRefObject<
    OverviewSection<Array<UptimeBarTooltipIncident>>
  > = useRef<OverviewSection<Array<UptimeBarTooltipIncident>>>(incidents);

  useEffect(() => {
    let cancelled: boolean = false;
    const subjectId: string = monitorIdString;

    const commitSummary: (
      section: OverviewSection<MonitorUptimeSummary>,
    ) => void = (section: OverviewSection<MonitorUptimeSummary>): void => {
      summaryRef.current = section;
      setSummary(section);
    };

    const commitIncidents: (
      section: OverviewSection<Array<UptimeBarTooltipIncident>>,
    ) => void = (
      section: OverviewSection<Array<UptimeBarTooltipIncident>>,
    ): void => {
      incidentsRef.current = section;
      setIncidents(section);
    };

    const loadIncidents: (
      loadedSummary: MonitorUptimeSummary,
    ) => Promise<void> = async (
      loadedSummary: MonitorUptimeSummary,
    ): Promise<void> => {
      if (
        !shouldAttemptRead(
          PermissionGate.check(new Incident(), ModelAction.Read),
        )
      ) {
        commitIncidents(
          forbidSection<Array<UptimeBarTooltipIncident>>({
            reason: MONITOR_UPTIME_ACCESS_REASONS.incidents,
            subjectId: subjectId,
          }),
        );
        return;
      }

      try {
        const result: ListResult<Incident> = await ModelAPI.getList<Incident>({
          modelType: Incident,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            monitors: new Includes([options.monitorId]),
            declaredAt: new InBetween(
              loadedSummary.startDate,
              loadedSummary.endDate,
            ),
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            title: true,
            declaredAt: true,
            incidentSeverity: {
              name: true,
              color: true,
            },
            currentIncidentState: {
              name: true,
              color: true,
            },
            monitors: {
              _id: true,
            },
          },
          sort: {
            declaredAt: SortOrder.Descending,
          },
        });

        if (cancelled) {
          return;
        }

        const markers: Array<UptimeBarTooltipIncident> = [];

        for (const incident of result.data) {
          const marker: UptimeBarTooltipIncident | null =
            toTooltipIncident(incident);

          if (marker) {
            markers.push(marker);
          }
        }

        commitIncidents(
          resolveSection({ value: markers, subjectId: subjectId }),
        );
      } catch (err) {
        if (cancelled) {
          return;
        }

        commitIncidents(
          failSection({
            previous: incidentsRef.current,
            message: API.getFriendlyMessage(err),
            subjectId: subjectId,
          }),
        );
      }
    };

    const load: () => Promise<void> = async (): Promise<void> => {
      /*
       * The route runs the caller's own timeline read, so someone who cannot
       * read the status timeline is refused there too. Asking anyway would
       * only turn a known answer into an error.
       */
      if (
        !shouldAttemptRead(
          PermissionGate.check(new MonitorStatusTimeline(), ModelAction.Read),
        )
      ) {
        commitSummary(
          forbidSection<MonitorUptimeSummary>({
            reason: MONITOR_UPTIME_ACCESS_REASONS.summary,
            subjectId: subjectId,
          }),
        );
        commitIncidents(
          forbidSection<Array<UptimeBarTooltipIncident>>({
            reason: MONITOR_UPTIME_ACCESS_REASONS.summary,
            subjectId: subjectId,
          }),
        );
        return;
      }

      let loadedSummary: MonitorUptimeSummary | null = null;

      try {
        /*
         * A custom route, so the tenantid header must be added by hand:
         * BaseAPI does not send it, and the route's project-member check
         * has no project without it.
         */
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.get<JSONObject>({
            url: URL.fromString(APP_API_URL.toString())
              .addRoute(
                "/monitor/uptime-summary/" + options.monitorId.toString(),
              )
              .addQueryParam(
                "timezone",
                MonitorUptimeSummaryUtil.getBrowserTimezone(),
                true,
              ),
            headers: ModelAPI.getCommonHeaders(),
          });

        // API.get can resolve with an error response as well as throw one.
        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        loadedSummary = MonitorUptimeSummaryUtil.fromJSON(response.data);

        if (!loadedSummary) {
          throw new Error(MONITOR_UPTIME_SUMMARY_UNREADABLE_MESSAGE);
        }
      } catch (err) {
        if (cancelled) {
          return;
        }

        commitSummary(
          failSection({
            previous: summaryRef.current,
            message: API.getFriendlyMessage(err),
            subjectId: subjectId,
          }),
        );
        commitIncidents(
          failSection({
            previous: incidentsRef.current,
            message: MONITOR_UPTIME_INCIDENTS_WITHOUT_SUMMARY_MESSAGE,
            subjectId: subjectId,
          }),
        );
        return;
      }

      if (cancelled) {
        return;
      }

      commitSummary(
        resolveSection({ value: loadedSummary, subjectId: subjectId }),
      );

      await loadIncidents(loadedSummary);
    };

    load().catch(() => {
      // load records its own errors.
    });

    return () => {
      cancelled = true;
    };
  }, [monitorIdString, options.refreshKey, retryCount]);

  const retry: () => void = useCallback((): void => {
    /*
     * Back to the skeleton unless there is a summary to keep showing, so
     * "Try again" visibly does something.
     */
    if (summaryRef.current.status !== "loaded") {
      summaryRef.current = getLoadingSection<MonitorUptimeSummary>();
      setSummary(summaryRef.current);
    }

    setRetryCount((count: number) => {
      return count + 1;
    });
  }, []);

  return {
    summary: getSectionForSubject(summary, monitorIdString),
    incidents: getSectionForSubject(incidents, monitorIdString),
    retry: retry,
  };
};

export default useMonitorUptimeSummary;
