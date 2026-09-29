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
import OneUptimeDate from "Common/Types/Date";
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
  /*
   * Server time minus browser time, in milliseconds, from the newest
   * summary that could measure it (see getServerClockOffsetMs). 0 until
   * one has.
   */
  serverClockOffsetMs: number;
  retry: () => void;
}

interface UptimeRequest {
  monitorId: string;
  refreshKey: string;
  retryCount: number;
}

/*
 * A response measures the clocks only if it came back within this long.
 * The offset is known only to within the round trip, and a slow answer is
 * the likeliest not to be a fresh one: the dashboard's service worker
 * answers a GET from its cache when the network fails, sometimes only
 * after the network has taken a while to fail.
 */
export const MONITOR_SERVER_CLOCK_MAX_ROUND_TRIP_MS: number = 5 * 1000;

/*
 * An offset larger than this is ignored. Operating systems keep browser
 * clocks within seconds, so a real skew of a quarter of an hour is rare,
 * while a cached summary replayed after the network dropped (a laptop
 * waking up, say) reads as a clock hours behind, and every check on the
 * page would then look fresh. Ignoring it leaves the page on the browser's
 * clock, like the rest of the dashboard.
 */
export const MONITOR_SERVER_CLOCK_MAX_OFFSET_MS: number = 15 * 60 * 1000;

/*
 * How far the server's clock is ahead of the browser's (negative when the
 * browser runs fast), from one response. The server stamped `serverTime`
 * while the request was out, so it lies between the moment the request was
 * sent and the moment the response arrived, on the true clock. A browser
 * clock that puts it inside that window agrees with the server as far as
 * one round trip can tell, and is left alone (0), so a correct clock never
 * jitters by the network delay. Otherwise the offset is the smallest shift
 * that puts it inside, which is within one round trip of the truth.
 *
 * Null when the response cannot be trusted to measure anything: a time
 * that does not parse, a round trip over the limit above (or a browser
 * clock set back while the request was out), an offset over the limit
 * above, or a server time no later than `newestServerTime`, the newest one
 * seen before. The server's clock does not go backwards, so a summary that
 * old is a replay of one already read.
 */
export const getServerClockOffsetMs: (data: {
  serverTime: Date;
  sentAt: Date;
  receivedAt: Date;
  newestServerTime?: Date | null | undefined;
}) => number | null = (data: {
  serverTime: Date;
  sentAt: Date;
  receivedAt: Date;
  newestServerTime?: Date | null | undefined;
}): number | null => {
  const serverTime: number = data.serverTime.getTime();
  const sentAt: number = data.sentAt.getTime();
  const receivedAt: number = data.receivedAt.getTime();

  if (
    !Number.isFinite(serverTime) ||
    !Number.isFinite(sentAt) ||
    !Number.isFinite(receivedAt)
  ) {
    return null;
  }

  const roundTripMs: number = receivedAt - sentAt;

  if (roundTripMs < 0 || roundTripMs > MONITOR_SERVER_CLOCK_MAX_ROUND_TRIP_MS) {
    return null;
  }

  if (data.newestServerTime && serverTime <= data.newestServerTime.getTime()) {
    return null;
  }

  let offsetMs: number = 0;

  if (serverTime < sentAt) {
    offsetMs = serverTime - sentAt;
  } else if (serverTime > receivedAt) {
    offsetMs = serverTime - receivedAt;
  }

  return Math.abs(offsetMs) > MONITOR_SERVER_CLOCK_MAX_OFFSET_MS
    ? null
    : offsetMs;
};

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
 *
 * `isShown` false (the page hides the uptime sections, for example while a
 * heartbeat waits for its first request) holds reloads back: the history
 * is still read once per monitor, off the critical path, but a changed
 * refreshKey waits until the sections are shown, and then reloads once.
 *
 * Each summary also carries the server's clock (generatedAt), so the hook
 * measures the browser's clock against it and reports the offset to
 * `onServerClockOffset` as well as returning it. A summary that cannot be
 * trusted to measure it (slow, replayed, or implausibly far out) reports
 * nothing, and the last measurement stands.
 */
export const useMonitorUptimeSummary: (options: {
  monitorId: ObjectID;
  refreshKey: string;
  isShown?: boolean | undefined;
  onServerClockOffset?: ((offsetMs: number) => void) | undefined;
}) => UseMonitorUptimeSummaryResult = (options: {
  monitorId: ObjectID;
  refreshKey: string;
  isShown?: boolean | undefined;
  onServerClockOffset?: ((offsetMs: number) => void) | undefined;
}): UseMonitorUptimeSummaryResult => {
  const monitorIdString: string = options.monitorId.toString();
  const isShown: boolean = options.isShown !== false;

  const [summary, setSummary] =
    useState<OverviewSection<MonitorUptimeSummary>>(
      getLoadingSection<MonitorUptimeSummary>(),
    );
  const [incidents, setIncidents] =
    useState<OverviewSection<Array<UptimeBarTooltipIncident>>>(
      getLoadingSection<Array<UptimeBarTooltipIncident>>(),
    );
  const [retryCount, setRetryCount] = useState<number>(0);
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState<number>(0);

  const summaryRef: MutableRefObject<OverviewSection<MonitorUptimeSummary>> =
    useRef<OverviewSection<MonitorUptimeSummary>>(summary);
  const incidentsRef: MutableRefObject<
    OverviewSection<Array<UptimeBarTooltipIncident>>
  > = useRef<OverviewSection<Array<UptimeBarTooltipIncident>>>(incidents);
  /*
   * Only the newest load may write. A generation rather than an effect's
   * own flag, because the effect also re-runs when `isShown` flips, and
   * that must not orphan a load already in flight.
   */
  const loadGenerationRef: MutableRefObject<number> = useRef<number>(0);
  // What the newest load was started for: a load is due when this differs.
  const requestedRef: MutableRefObject<UptimeRequest | null> =
    useRef<UptimeRequest | null>(null);
  const onServerClockOffsetRef: MutableRefObject<
    ((offsetMs: number) => void) | undefined
  > = useRef<((offsetMs: number) => void) | undefined>(
    options.onServerClockOffset,
  );
  /*
   * The newest generatedAt of any summary read, for any monitor: a summary
   * no newer than it is a replay and measures nothing.
   */
  const newestServerTimeRef: MutableRefObject<Date | null> =
    useRef<Date | null>(null);

  useEffect(() => {
    onServerClockOffsetRef.current = options.onServerClockOffset;
  }, [options.onServerClockOffset]);

  // Orphans whatever is still in flight when the page goes away.
  useEffect(() => {
    return () => {
      loadGenerationRef.current += 1;
      requestedRef.current = null;
    };
  }, []);

  useEffect(() => {
    const requested: UptimeRequest | null = requestedRef.current;
    const isNewSubject: boolean =
      !requested || requested.monitorId !== monitorIdString;
    const isRetry: boolean = Boolean(
      requested && requested.retryCount !== retryCount,
    );
    const isNewKey: boolean = Boolean(
      requested && requested.refreshKey !== options.refreshKey,
    );

    // A hidden history is read once per monitor; its reloads wait.
    if (!isNewSubject && !isRetry && !(isNewKey && isShown)) {
      return;
    }

    requestedRef.current = {
      monitorId: monitorIdString,
      refreshKey: options.refreshKey,
      retryCount: retryCount,
    };
    loadGenerationRef.current += 1;

    const generation: number = loadGenerationRef.current;
    const subjectId: string = monitorIdString;
    const isCancelled: () => boolean = (): boolean => {
      return generation !== loadGenerationRef.current;
    };

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

        if (isCancelled()) {
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
        if (isCancelled()) {
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
      // The window the server stamped generatedAt in, on the browser's clock.
      const sentAt: Date = OneUptimeDate.getCurrentDate();
      let receivedAt: Date = sentAt;

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

        receivedAt = OneUptimeDate.getCurrentDate();

        // API.get can resolve with an error response as well as throw one.
        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        loadedSummary = MonitorUptimeSummaryUtil.fromJSON(response.data);

        if (!loadedSummary) {
          throw new Error(MONITOR_UPTIME_SUMMARY_UNREADABLE_MESSAGE);
        }
      } catch (err) {
        if (isCancelled()) {
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

      if (isCancelled()) {
        return;
      }

      const offsetMs: number | null = getServerClockOffsetMs({
        serverTime: loadedSummary.generatedAt,
        sentAt: sentAt,
        receivedAt: receivedAt,
        newestServerTime: newestServerTimeRef.current,
      });
      const newestServerTime: Date | null = newestServerTimeRef.current;

      if (
        !newestServerTime ||
        loadedSummary.generatedAt.getTime() > newestServerTime.getTime()
      ) {
        newestServerTimeRef.current = loadedSummary.generatedAt;
      }

      // A measurement that cannot be trusted leaves the last one in place.
      if (offsetMs !== null) {
        setServerClockOffsetMs(offsetMs);
        onServerClockOffsetRef.current?.(offsetMs);
      }

      commitSummary(
        resolveSection({ value: loadedSummary, subjectId: subjectId }),
      );

      await loadIncidents(loadedSummary);
    };

    load().catch(() => {
      // load records its own errors.
    });
  }, [monitorIdString, options.refreshKey, retryCount, isShown]);

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
    serverClockOffsetMs: serverClockOffsetMs,
    retry: retry,
  };
};

export default useMonitorUptimeSummary;
