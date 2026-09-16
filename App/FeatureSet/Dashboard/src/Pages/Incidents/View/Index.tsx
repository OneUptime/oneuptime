import AffectedResourcesDisplay from "../../../Components/AffectedResources/AffectedResourcesDisplay";
import ChangeIncidentState from "../../../Components/Incident/ChangeState";
import LabelsElement from "Common/UI/Components/Label/Labels";
import OnCallDutyPoliciesView from "../../../Components/OnCallPolicy/OnCallPolicies";
import SubscriberNotificationStatus from "../../../Components/StatusPageSubscribers/SubscriberNotificationStatus";
import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Black } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import { DetailStyle } from "Common/UI/Components/Detail/Detail";
import ProbeElement from "Common/UI/Components/Probe/Probe";
import FieldType from "Common/UI/Components/Types/FieldType";
import BaseAPI from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import Label from "Common/Models/DatabaseModels/Label";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import UserElement from "../../../Components/User/User";
import Card from "Common/UI/Components/Card/Card";
import DashboardLogsViewer from "../../../Components/Logs/LogsViewer";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import JSONFunctions from "Common/Types/JSONFunctions";
import TracesViewer from "../../../Components/Traces/TracesViewer";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import MetricView from "../../../Components/Metrics/MetricView";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricSeriesScope from "Common/Utils/Metrics/MetricSeriesScope";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";
import TelemetrySnapshotWindowAlert from "../../../Components/Telemetry/TelemetrySnapshotWindowAlert";
import TelemetryCompanionSignalTabs from "../../../Components/Telemetry/TelemetryCompanionSignalTabs";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import IconProp from "Common/Types/Icon/IconProp";
import IncidentFeedElement from "../../../Components/Incident/IncidentFeed";
import InvestigationPanel from "../../../Components/AI/InvestigationPanel";
import EntityRunbooks from "../../../Components/Runbook/EntityRunbooks";
import RemediationSuggestionCard from "../../../Components/AutoRemediation/RemediationSuggestionCard";
import IncidentAffectedResources from "./AffectedResources";
import MonitorSummarySnapshotCard from "../../../Components/Monitor/MonitorSummarySnapshotCard";
import IncidentMemberRoleAssignment from "../../../Components/Incident/IncidentMemberRoleAssignment";
import EventStatTile from "../../../Components/EventView/EventStatTile";
import EventStatBar from "../../../Components/EventView/EventStatBar";
import EventOverviewSkeleton from "../../../Components/EventView/EventOverviewSkeleton";
import { EventStatusFact } from "../../../Components/EventView/EventStatusPanel";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import Host from "Common/Models/DatabaseModels/Host";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Service from "Common/Models/DatabaseModels/Service";
import AffectedResourcesPicker, {
  isAffectedResourcesPayload,
} from "../../../Components/AffectedResources/AffectedResourcesPicker";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import ExceptionsViewer from "../../../Components/Exceptions/ExceptionsViewer";
import Query from "Common/Types/BaseDatabase/Query";
import Span from "Common/Models/AnalyticsModels/Span";
import Log from "Common/Models/AnalyticsModels/Log";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import LiveDuration from "../../../Components/EventView/LiveDuration";
import {
  EventStateTimelineDate,
  getEventEndDateForCurrentState,
} from "../../../Utils/EventDuration";
import {
  EventResponseTimes,
  VisibleItems,
  getEventCreatorName,
  getEventResponseTimes,
  getTimeToStateText,
  splitVisibleItems,
} from "../../../Utils/EventOverview";
import OverviewCustomFields from "../../../Components/CustomFields/OverviewCustomFields";
import IncidentCustomField from "Common/Models/DatabaseModels/IncidentCustomField";
import AIRunHumanVerdict from "Common/Types/AI/AIRunHumanVerdict";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import AppLink from "../../../Components/AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";

interface AIInvestigationStatusState {
  subjectId: string;
  status: AIRunStatus | null;
}

interface AIInvestigationSummaryState {
  subjectId: string;
  summary: string | null;
}

interface AIInvestigationVerdictState {
  subjectId: string;
  verdict: AIRunHumanVerdict | null;
}

/*
 * A value that belongs to one incident. The page stays mounted when the reader
 * moves to another incident on the same route, so anything a card reported is
 * stamped with the incident it was reported for and read only while that is
 * still the incident on screen.
 */
interface SubjectValue<T> {
  subjectId: string;
  value: T;
}

interface FetchDataOptions {
  /*
   * A refresh after an action, an edit or a role change. The page is already
   * on screen, so it stays mounted and a failure is reported inline instead
   * of replacing everything with an error.
   */
  isBackgroundRefresh: boolean;
}

// How many monitor names the header lists before "+N more".
const MAX_HEADER_MONITORS: number = 2;

const IncidentView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const modelIdString: string = modelId.toString();

  const [incidentStateTimeline, setIncidentStateTimeline] = useState<
    IncidentStateTimeline[]
  >([]);
  const [incidentStates, setIncidentStates] = useState<IncidentState[]>([]);

  // A failed FIRST load, which replaces the page.
  const [error, setError] = useState<string>("");
  // A failed background refresh, shown above the still-mounted page.
  const [refreshError, setRefreshError] = useState<string>("");
  /*
   * Which incident the page-level state below was loaded for (or failed to
   * load for). Until it is the incident in the URL, the page renders only the
   * skeleton. This is decided at render time, not reset in an effect: the
   * page stays mounted when the reader follows a link to another incident, and
   * an effect runs only after a render that would already have handed every
   * card the new id over the previous incident's header, and fired all of
   * their requests before unmounting them again. Refreshes never clear it.
   */
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);
  /*
   * Bumped by every fetch and on unmount. A response only lands while no
   * newer fetch has started, so two overlapping refreshes can never leave the
   * older data on screen.
   */
  const fetchGenerationRef: React.MutableRefObject<number> = useRef<number>(0);
  /*
   * The incident the page is on now. A callback from a card rendered for the
   * previous incident can still fire after the switch (a save or a state
   * change that lands late); its refresh must not cancel this incident's load.
   */
  const currentModelIdRef: React.MutableRefObject<string> =
    useRef<string>(modelIdString);

  const [telemetryQuery, setTelemetryQuery] = useState<TelemetryQuery | null>(
    null,
  );
  /*
   * The window the monitor evaluated over when it opened this incident. Every
   * telemetry preview below is scoped to it, and each card shows it, so a
   * snapshot from days ago can't be mistaken for a live view.
   */
  const [telemetrySnapshotWindow, setTelemetrySnapshotWindow] =
    useState<InBetween<Date> | null>(null);
  /*
   * "host.name = prod-01" when a grouped metric monitor opened this
   * incident for one series. Empty for whole-monitor incidents.
   */
  const [seriesSummary, setSeriesSummary] = useState<string>("");
  // The raw series labels, handed to the affected resource card below.
  const [seriesLabels, setSeriesLabels] = useState<JSONObject | null>(null);
  const [isPrivate, setIsPrivate] = useState<boolean>(false);
  const [eventNumber, setEventNumber] = useState<string | undefined>(undefined);
  const [incidentTitle, setIncidentTitle] = useState<string | undefined>(
    undefined,
  );
  const [incidentStartedAt, setIncidentStartedAt] = useState<Date | undefined>(
    undefined,
  );
  const [severity, setSeverity] = useState<
    { name: string; color: Color } | undefined
  >(undefined);
  /*
   * Header facts that come from cards which already load them (the details
   * card and the affected resources card), so the header costs no extra
   * request. Undefined until those cards report in for this incident.
   */
  const [declaredBy, setDeclaredBy] = useState<SubjectValue<
    string | undefined
  > | null>(null);
  const declaredByName: string | undefined =
    declaredBy?.subjectId === modelIdString ? declaredBy.value : undefined;
  const [affectedMonitorsState, setAffectedMonitorsState] =
    useState<SubjectValue<Array<Monitor>> | null>(null);
  const affectedMonitors: Array<Monitor> | undefined =
    affectedMonitorsState?.subjectId === modelIdString
      ? affectedMonitorsState.value
      : undefined;
  // Toggled to make the details card read its row again (after a resend).
  const [detailsRefresher, setDetailsRefresher] = useState<boolean>(false);
  /*
   * A failed resend of subscriber notifications, shown under the status it
   * failed to change. It is not a refresh failure: refreshing the page does
   * not retry the resend, so a successful refresh must not clear it.
   */
  const [resendNotificationErrorState, setResendNotificationErrorState] =
    useState<SubjectValue<string> | null>(null);
  const resendNotificationError: string =
    resendNotificationErrorState?.subjectId === modelIdString
      ? resendNotificationErrorState.value
      : "";

  const [aiInvestigationStatus, setAIInvestigationStatus] =
    useState<AIInvestigationStatusState>({
      subjectId: modelIdString,
      status: null,
    });
  const currentAIInvestigationStatus: AIRunStatus | null =
    aiInvestigationStatus.subjectId === modelIdString
      ? aiInvestigationStatus.status
      : null;
  const onAIInvestigationStatusChange: (status: AIRunStatus | null) => void =
    useCallback(
      (status: AIRunStatus | null): void => {
        setAIInvestigationStatus(
          (
            currentStatus: AIInvestigationStatusState,
          ): AIInvestigationStatusState => {
            if (
              currentStatus.subjectId === modelIdString &&
              currentStatus.status === status
            ) {
              return currentStatus;
            }

            return { subjectId: modelIdString, status: status };
          },
        );
      },
      [modelIdString],
    );

  /*
   * The completed report's TL;DR, lifted from InvestigationPanel the same way
   * as the status, so the header can lead with it. Keyed by subject so a
   * summary never outlives the incident it belongs to.
   */
  const [aiInvestigationSummary, setAIInvestigationSummary] =
    useState<AIInvestigationSummaryState>({
      subjectId: modelIdString,
      summary: null,
    });
  const currentAIInvestigationSummary: string | null =
    aiInvestigationSummary.subjectId === modelIdString
      ? aiInvestigationSummary.summary
      : null;
  const onAIInvestigationReportSummaryChange: (summary: string | null) => void =
    useCallback(
      (summary: string | null): void => {
        setAIInvestigationSummary(
          (
            currentSummary: AIInvestigationSummaryState,
          ): AIInvestigationSummaryState => {
            if (
              currentSummary.subjectId === modelIdString &&
              currentSummary.summary === summary
            ) {
              return currentSummary;
            }

            return { subjectId: modelIdString, summary: summary };
          },
        );
      },
      [modelIdString],
    );

  /*
   * A responder's verdict on that report, lifted the same way, so the header
   * can say the report was confirmed or rejected. Keyed by subject so a
   * verdict never outlives its incident.
   */
  const [aiInvestigationVerdict, setAIInvestigationVerdict] =
    useState<AIInvestigationVerdictState>({
      subjectId: modelIdString,
      verdict: null,
    });
  const currentAIInvestigationVerdict: AIRunHumanVerdict | null =
    aiInvestigationVerdict.subjectId === modelIdString
      ? aiInvestigationVerdict.verdict
      : null;
  const onAIInvestigationVerdictChange: (
    verdict: AIRunHumanVerdict | null,
  ) => void = useCallback(
    (verdict: AIRunHumanVerdict | null): void => {
      setAIInvestigationVerdict(
        (
          currentVerdict: AIInvestigationVerdictState,
        ): AIInvestigationVerdictState => {
          if (
            currentVerdict.subjectId === modelIdString &&
            currentVerdict.verdict === verdict
          ) {
            return currentVerdict;
          }

          return { subjectId: modelIdString, verdict: verdict };
        },
      );
    },
    [modelIdString],
  );

  const [feedRefreshToken, setFeedRefreshToken] = useState<number>(0);

  const refreshFeed: () => void = useCallback((): void => {
    setFeedRefreshToken((currentToken: number): number => {
      return currentToken + 1;
    });
  }, []);

  const refreshFeedAfterAnalysisAvailable: () => void = refreshFeed;

  const fetchData: (options: FetchDataOptions) => Promise<void> = async (
    options: FetchDataOptions,
  ): Promise<void> => {
    // The incident this fetch was started for, captured with this render.
    const requestedModelId: string = modelIdString;

    if (requestedModelId !== currentModelIdRef.current) {
      // A card rendered for the incident the reader already left.
      return;
    }

    fetchGenerationRef.current++;
    const generation: number = fetchGenerationRef.current;

    try {
      // Independent reads: fetch them together instead of one after another.
      const [incidentTimelines, incidentStates, incident]: [
        ListResult<IncidentStateTimeline>,
        ListResult<IncidentState>,
        Incident | null,
      ] = await Promise.all([
        ModelAPI.getList<IncidentStateTimeline>({
          modelType: IncidentStateTimeline,
          query: {
            incidentId: modelId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            startsAt: true,
            createdByUser: {
              name: true,
              email: true,
              profilePictureId: true,
            },
            incidentStateId: true,
          },
          sort: {
            startsAt: SortOrder.Ascending,
          },
        }),
        ModelAPI.getList<IncidentState>({
          modelType: IncidentState,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            isAcknowledgedState: true,
            isResolvedState: true,
          },
          sort: {},
        }),
        ModelAPI.getItem<Incident>({
          id: modelId,
          modelType: Incident,
          select: {
            telemetryQuery: true,
            seriesLabels: true,
            isPrivate: true,
            title: true,
            declaredAt: true,
            incidentNumber: true,
            incidentNumberWithPrefix: true,
            incidentSeverity: {
              name: true,
              color: true,
            },
          },
        }),
      ]);

      if (generation !== fetchGenerationRef.current) {
        return;
      }

      let telemetryQuery: TelemetryQuery | null = null;

      if (incident?.telemetryQuery) {
        telemetryQuery = JSONFunctions.deserialize(
          incident?.telemetryQuery as any,
        ) as any;

        /*
         * Rebuild the window's Date bounds. The stored blob round-trips
         * through JSON, which leaves InBetween holding ISO strings even though
         * its type says Date — and the metric chart gates bucket alignment and
         * exemplar fetching on `instanceof Date`, so both stay switched off
         * here until the bounds are real Dates again.
         */
        telemetryQuery = TelemetryQueryTimeRange.hydrate(telemetryQuery);
      }

      setTelemetrySnapshotWindow(
        TelemetryQueryTimeRange.getSnapshotWindow(telemetryQuery),
      );

      /*
       * The stored telemetryQuery is the monitor's whole-evaluation view:
       * a grouped metric monitor that breached on five hosts stamps the
       * SAME query configs onto all five incidents. Narrow it to this
       * incident's own series so the chart shows the host it is about
       * instead of every host the monitor watches.
       */
      if (telemetryQuery?.metricViewData) {
        /*
         * Describe the narrowing that was actually applied, not the raw
         * labels: a label the queries never grouped by narrows nothing, and
         * announcing it would have the card vouch for a chart that still
         * shows every series.
         */
        setSeriesSummary(
          MetricSeriesScope.getAppliedSeriesLabelSummary({
            queryConfigs: telemetryQuery.metricViewData.queryConfigs,
            seriesLabels: incident?.seriesLabels as JSONObject | undefined,
          }),
        );

        telemetryQuery = {
          ...telemetryQuery,
          metricViewData:
            MetricSeriesScope.scopeMetricViewDataToSeries({
              metricViewData: telemetryQuery.metricViewData,
              seriesLabels: incident?.seriesLabels as JSONObject | undefined,
            }) || null,
        };
      } else {
        setSeriesSummary("");
      }

      setSeriesLabels(
        (incident?.seriesLabels as JSONObject | undefined) || null,
      );

      setIsPrivate(incident?.isPrivate === true);

      setIncidentTitle(incident?.title || undefined);
      setIncidentStartedAt(incident?.declaredAt || undefined);

      setEventNumber(
        incident?.incidentNumberWithPrefix ||
          (incident?.incidentNumber
            ? "#" + incident.incidentNumber
            : undefined),
      );

      if (incident?.incidentSeverity) {
        setSeverity({
          name: incident.incidentSeverity.name || "Unknown",
          color: incident.incidentSeverity.color || Black,
        });
      } else {
        setSeverity(undefined);
      }

      setTelemetryQuery(telemetryQuery);
      setIncidentStates(incidentStates.data as IncidentState[]);
      setIncidentStateTimeline(
        incidentTimelines.data as IncidentStateTimeline[],
      );
      setError("");
      setRefreshError("");
    } catch (err) {
      if (generation !== fetchGenerationRef.current) {
        return;
      }

      if (options.isBackgroundRefresh) {
        setRefreshError(BaseAPI.getFriendlyMessage(err));
      } else {
        setError(BaseAPI.getFriendlyMessage(err));
      }
    }

    setLoadedModelId(requestedModelId);
  };

  /*
   * Everything that changes what this page shows refreshes it in the
   * background: the cards stay mounted, so an open disclosure, the selected
   * telemetry tab, the AI panel's polling and the scroll position all survive
   * an acknowledge or an edit.
   */
  const refreshData: () => void = (): void => {
    fetchData({ isBackgroundRefresh: true }).catch((err: Error) => {
      setRefreshError(BaseAPI.getFriendlyMessage(err));
    });
  };

  const retryFirstLoad: () => void = (): void => {
    setError("");
    // Back to the skeleton while the retry is in flight.
    setLoadedModelId(null);
    fetchData({ isBackgroundRefresh: false }).catch((err: Error) => {
      setError(BaseAPI.getFriendlyMessage(err));
      setLoadedModelId(modelIdString);
    });
  };

  const handleResendNotification: () => Promise<void> =
    async (): Promise<void> => {
      setResendNotificationErrorState(null);

      try {
        // Reset the notification status to Pending so the worker can pick it up again
        await ModelAPI.updateById({
          id: modelId,
          modelType: Incident,
          data: {
            subscriberNotificationStatusOnIncidentCreated:
              StatusPageSubscriberNotificationStatus.Pending,
            subscriberNotificationStatusMessage:
              "Notification queued for resending",
          },
        });

        // Only the details card shows the status, so only it reads again.
        setDetailsRefresher((current: boolean): boolean => {
          return !current;
        });
      } catch (err) {
        setResendNotificationErrorState({
          subjectId: modelIdString,
          value: BaseAPI.getFriendlyMessage(err),
        });
      }
    };

  useEffect(() => {
    return () => {
      fetchGenerationRef.current++;
    };
  }, []);

  useEffect(() => {
    /*
     * A different incident is a first load again. The skeleton is already on
     * screen (loadedModelId still names the previous incident); forget the
     * previous incident's errors while it is. On mount these are no-ops.
     */
    currentModelIdRef.current = modelIdString;
    setError("");
    setRefreshError("");

    fetchData({ isBackgroundRefresh: false }).catch((err: Error) => {
      setError(BaseAPI.getFriendlyMessage(err));
      setLoadedModelId(modelIdString);
    });
  }, [modelIdString]);

  if (loadedModelId !== modelIdString) {
    return (
      <EventOverviewSkeleton statCount={3} loadingText="Loading incident" />
    );
  }

  if (error) {
    return <ErrorMessage message={error} onRefreshClick={retryFirstLoad} />;
  }

  type GetIncidentStateFunction = () => IncidentState | undefined;

  const getAcknowledgeState: GetIncidentStateFunction = ():
    | IncidentState
    | undefined => {
    return incidentStates.find((state: IncidentState) => {
      return state.isAcknowledgedState;
    });
  };

  const getResolvedState: GetIncidentStateFunction = ():
    | IncidentState
    | undefined => {
    return incidentStates.find((state: IncidentState) => {
      return state.isResolvedState;
    });
  };

  const acknowledgeState: IncidentState | undefined = getAcknowledgeState();
  const resolvedState: IncidentState | undefined = getResolvedState();

  const timelineDates: Array<EventStateTimelineDate> =
    incidentStateTimeline.map(
      (timeline: IncidentStateTimeline): EventStateTimelineDate => {
        return {
          stateId: timeline.incidentStateId?.toString(),
          startsAt: timeline.startsAt,
        };
      },
    );

  /*
   * One consistent reading of the timeline for all three numbers: time to
   * acknowledge and time to resolve both count to the FIRST such entry (a
   * later reopen does not rewrite them), and the duration runs to the current
   * resolution, or keeps ticking while the incident is open.
   */
  const responseTimes: EventResponseTimes = getEventResponseTimes({
    timelines: timelineDates,
    startedAt: incidentStartedAt,
    acknowledgedStateId: acknowledgeState?._id?.toString(),
    resolvedStateId: resolvedState?._id?.toString(),
  });

  const durationStartDate: Date | undefined = responseTimes.startedAt;
  const durationEndDate: Date | undefined = getEventEndDateForCurrentState(
    timelineDates,
    resolvedState?._id?.toString(),
  );

  type FormatDateFunction = (date: Date | undefined) => string | undefined;

  const formatDate: FormatDateFunction = (
    date: Date | undefined,
  ): string | undefined => {
    return date
      ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date)
      : undefined;
  };

  const getMonitorLinks: (monitors: Array<Monitor>) => ReactElement = (
    monitors: Array<Monitor>,
  ): ReactElement => {
    const monitorsToShow: VisibleItems<Monitor> = splitVisibleItems(
      monitors,
      MAX_HEADER_MONITORS,
    );

    return (
      <span>
        {monitorsToShow.visible.map((monitor: Monitor, index: number) => {
          const monitorName: string = monitor.name || "Unnamed monitor";

          return (
            <Fragment key={monitor._id?.toString() || `monitor-${index}`}>
              {index > 0 ? ", " : ""}
              {monitor._id ? (
                <AppLink
                  className="text-indigo-600 hover:text-indigo-700 hover:underline"
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.MONITOR_VIEW] as Route,
                    {
                      modelId: new ObjectID(monitor._id.toString()),
                    },
                  )}
                >
                  {monitorName}
                </AppLink>
              ) : (
                <span>{monitorName}</span>
              )}
            </Fragment>
          );
        })}
        {monitorsToShow.hiddenCount > 0 ? (
          <span className="font-normal text-gray-500">
            {` +${monitorsToShow.hiddenCount} more`}
          </span>
        ) : (
          <></>
        )}
      </span>
    );
  };

  const headerFacts: Array<EventStatusFact> = [];

  if (incidentStartedAt) {
    headerFacts.push({
      label: "Declared",
      icon: IconProp.Calendar,
      value: formatDate(incidentStartedAt) || "",
    });
  }

  if (declaredByName) {
    headerFacts.push({
      label: "Declared by",
      icon: IconProp.User,
      value: declaredByName,
    });
  }

  if (affectedMonitors && affectedMonitors.length > 0) {
    headerFacts.push({
      label: affectedMonitors.length === 1 ? "Monitor" : "Monitors",
      icon: IconProp.AltGlobe,
      value: getMonitorLinks(affectedMonitors),
    });
  }

  /*
   * Built once and shared by all four preview cards. Resolved to `undefined`
   * rather than an element that renders nothing, because Card decides whether
   * to lay out its right-hand column from the PRESENCE of rightElement — an
   * element returning an empty fragment is still truthy, and would leave an
   * empty block and a shifted title on incidents that stored no window.
   */
  const snapshotWindowAlert: ReactElement | undefined =
    telemetrySnapshotWindow ? (
      <TelemetrySnapshotWindowAlert window={telemetrySnapshotWindow} />
    ) : undefined;

  return (
    <div>
      {refreshError ? (
        <div
          role="alert"
          className="mb-5 flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between"
        >
          <span className="min-w-0 break-words">
            {`Could not refresh this incident. ${refreshError}`}
          </span>
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={refreshData}
              className="rounded-md text-sm font-semibold text-red-800 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => {
                setRefreshError("");
              }}
              className="rounded-md text-sm font-medium text-red-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : (
        <></>
      )}

      <div className="mb-5">
        <ChangeIncidentState
          incidentId={modelId}
          eventNumber={eventNumber}
          title={incidentTitle}
          eventStartsAt={durationStartDate}
          severity={severity}
          isPrivate={isPrivate}
          facts={headerFacts}
          aiInvestigationStatus={currentAIInvestigationStatus}
          aiInvestigationSummary={currentAIInvestigationSummary}
          aiInvestigationVerdict={currentAIInvestigationVerdict}
          onActionComplete={() => {
            refreshData();
            // The state change is a new feed entry.
            refreshFeed();
          }}
        />
      </div>

      <EventStatBar
        columns={3}
        ariaLabel="Incident response times"
        className="mb-5"
      >
        <EventStatTile
          variant="segment"
          label={`${acknowledgeState?.name || "Acknowledged"} in`}
          icon={IconProp.Check}
          value={getTimeToStateText({
            startedAt: responseTimes.startedAt,
            reachedAt: responseTimes.acknowledgedAt,
            stateName: acknowledgeState?.name,
            fallbackStateName: "acknowledged",
          })}
          description={formatDate(responseTimes.acknowledgedAt)}
        />
        <EventStatTile
          variant="segment"
          label={`${resolvedState?.name || "Resolved"} in`}
          icon={IconProp.CheckCircle}
          value={getTimeToStateText({
            startedAt: responseTimes.startedAt,
            reachedAt: responseTimes.resolvedAt,
            stateName: resolvedState?.name,
            fallbackStateName: "resolved",
          })}
          description={formatDate(responseTimes.resolvedAt)}
        />
        <EventStatTile
          variant="segment"
          label="Duration"
          icon={IconProp.Clock}
          value={
            durationStartDate ? (
              <LiveDuration
                startDate={durationStartDate}
                endDate={durationEndDate}
              />
            ) : (
              "-"
            )
          }
          description={
            durationEndDate ? `Ended ${formatDate(durationEndDate)}` : undefined
          }
        />
      </EventStatBar>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          {/*
           * The AI's root-cause report leads the page: it is the fastest read
           * on what happened. It renders nothing until a run exists.
           */}
          <InvestigationPanel
            subjectType="incident"
            subjectId={modelId}
            onStatusChange={onAIInvestigationStatusChange}
            onReportSummaryChange={onAIInvestigationReportSummaryChange}
            onVerdictChange={onAIInvestigationVerdictChange}
            onAnalysisAvailable={refreshFeedAfterAnalysisAvailable}
          />

          {telemetryQuery && (
            <TelemetryCompanionSignalTabs
              telemetryQuery={telemetryQuery}
              snapshotWindow={telemetrySnapshotWindow}
              snapshotWindowAlert={snapshotWindowAlert}
              eventNoun="incident"
              primarySignalElement={
                <Fragment>
                  {telemetryQuery.telemetryType === TelemetryType.Log &&
                    telemetryQuery.telemetryQuery && (
                      <div>
                        <Card
                          title={"Logs"}
                          description={"Logs for this incident."}
                          rightElement={snapshotWindowAlert}
                        >
                          <DashboardLogsViewer
                            id="logs-preview"
                            logQuery={
                              telemetryQuery.telemetryQuery as Query<Log>
                            }
                            limit={10}
                            noLogsMessage="No logs found"
                          />
                        </Card>
                      </div>
                    )}

                  {telemetryQuery.telemetryType === TelemetryType.Trace &&
                    telemetryQuery.telemetryQuery && (
                      <div>
                        <Card
                          title={"Spans"}
                          description={"Spans for this incident."}
                          rightElement={snapshotWindowAlert}
                        >
                          <TracesViewer
                            spanQuery={
                              telemetryQuery.telemetryQuery as Query<Span>
                            }
                            limit={10}
                            /*
                             * Pinned to the snapshot: this page owns the URL,
                             * so the viewer neither reads a filter out of it
                             * nor writes its own state back into it.
                             */
                            disableUrlSync={true}
                            emptyMessage="No spans found"
                          />
                        </Card>
                      </div>
                    )}

                  {telemetryQuery.telemetryType === TelemetryType.Metric &&
                    telemetryQuery.metricViewData && (
                      <Card
                        title={"Metrics"}
                        description={
                          seriesSummary
                            ? `Metrics related to this incident, scoped to the affected series (${seriesSummary}).`
                            : "Metrics related to this incident."
                        }
                        rightElement={snapshotWindowAlert}
                      >
                        <MetricView
                          data={telemetryQuery.metricViewData}
                          hideQueryElements={true}
                          chartCssClass="rounded-lg border border-gray-200 shadow-sm"
                          hideStartAndEndDate={true}
                          // Read-only host: onChange is a no-op, so zoom can't apply.
                          disableChartZoom={true}
                          onChange={(_data: MetricViewData) => {
                            // do nothing!
                          }}
                        />
                      </Card>
                    )}

                  {telemetryQuery.telemetryType === TelemetryType.Exception &&
                    telemetryQuery.telemetryQuery && (
                      <Card
                        title={"Exceptions"}
                        description={"Exceptions related to this incident."}
                        rightElement={snapshotWindowAlert}
                      >
                        <ExceptionsViewer
                          exceptionInstanceQuery={
                            telemetryQuery.telemetryQuery as Query<ExceptionInstance>
                          }
                          /*
                           * An event shows the exceptions it fired on,
                           * whoever has since resolved them and whatever the
                           * classifier made of them — the explorer's
                           * "unresolved issues" defaults would hide exactly
                           * those.
                           */
                          defaultStatus="all"
                          defaultClassScope="all"
                          limit={10}
                          // Pinned to the snapshot; this page owns the URL.
                          disableUrlSync={true}
                          emptyMessage="No exceptions found"
                        />
                      </Card>
                    )}
                </Fragment>
              }
            />
          )}

          <MonitorSummarySnapshotCard incidentId={modelId} />

          <IncidentAffectedResources
            incidentId={modelId}
            seriesLabels={seriesLabels}
          />

          <RemediationSuggestionCard incidentId={modelId} hideIfEmpty={true} />

          <EntityRunbooks incidentId={modelId} hideIfEmpty={true} />

          <IncidentFeedElement
            incidentId={modelId}
            refreshToken={feedRefreshToken}
          />
        </div>

        <div className="min-w-0 xl:col-span-1">
          {/* Incident View  */}
          <CardModelDetail<Incident>
            name="Incident Details"
            cardProps={{
              title: "Incident Details",
              description: "Key facts about this incident.",
              headerLayout: "stacked",
            }}
            isEditable={true}
            editButtonText="Edit"
            refresher={detailsRefresher}
            onSaveSuccess={() => {
              // refresh page-level state (title/severity pills) shown in the header above.
              refreshData();
              refreshFeed();
            }}
            formSteps={[
              {
                title: "Incident Details",
                id: "incident-details",
              },
              {
                title: "Labels",
                id: "labels",
              },
            ]}
            formFields={[
              {
                field: {
                  title: true,
                },
                title: "Incident Title",
                stepId: "incident-details",
                fieldType: FormFieldSchemaType.Text,
                required: true,
                placeholder: "Incident Title",
                validation: {
                  minLength: 2,
                },
              },

              {
                field: {
                  incidentSeverity: true,
                },
                title: "Incident Severity",
                description: "What type of incident is this?",
                fieldType: FormFieldSchemaType.Dropdown,
                stepId: "incident-details",
                dropdownModal: {
                  type: IncidentSeverity,
                  labelField: "name",
                  valueField: "_id",
                },
                required: true,
                placeholder: "Incident Severity",
              },
              {
                field: {
                  labels: true,
                },
                title: "Labels",
                stepId: "labels",
                description:
                  "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                dropdownModal: {
                  type: Label,
                  labelField: "name",
                  valueField: "_id",
                },
                required: false,
                placeholder: "Labels",
              },
            ]}
            modelDetailProps={{
              selectMoreFields: {
                incidentNumberWithPrefix: true,
                createdByUser: {
                  _id: true,
                  name: true,
                  email: true,
                  profilePictureId: true,
                },
                subscriberNotificationStatusMessage: true,
              },
              onItemLoaded: (item: Incident): void => {
                setDeclaredBy({
                  subjectId: modelIdString,
                  value: getEventCreatorName({
                    probe: item.createdByProbe,
                    user: item.createdByUser,
                  }),
                });
              },
              showDetailsInNumberOfColumns: 1,
              style: DetailStyle.Compact,
              modelType: Incident,
              id: "model-detail-incidents",
              fields: [
                {
                  field: {
                    declaredAt: true,
                  },
                  title: "Declared At",
                  fieldType: FieldType.DateTime,
                },
                {
                  field: {
                    createdByProbe: {
                      name: true,
                      iconFileId: true,
                    },
                  },
                  title: "Declared By",
                  fieldType: FieldType.Element,
                  getElement: (item: Incident): ReactElement => {
                    if (item.createdByProbe) {
                      return <ProbeElement probe={item.createdByProbe} />;
                    }

                    if (item.createdByUser) {
                      return <UserElement user={item.createdByUser} />;
                    }

                    return <span className="text-gray-500">Unknown</span>;
                  },
                },
                {
                  field: {
                    onCallDutyPolicies: {
                      name: true,
                      _id: true,
                    },
                  },
                  title: "On-Call Duty Policies",
                  fieldType: FieldType.Element,
                  getElement: (item: Incident): ReactElement => {
                    return (
                      <OnCallDutyPoliciesView
                        onCallPolicies={item.onCallDutyPolicies || []}
                      />
                    );
                  },
                },
                {
                  field: {
                    subscriberNotificationStatusOnIncidentCreated: true,
                  },
                  title: "Subscriber Notification Status",
                  fieldType: FieldType.Element,
                  getElement: (item: Incident): ReactElement => {
                    return (
                      <div>
                        <SubscriberNotificationStatus
                          status={
                            item.subscriberNotificationStatusOnIncidentCreated
                          }
                          subscriberNotificationStatusMessage={
                            item.subscriberNotificationStatusMessage
                          }
                          onResendNotification={() => {
                            handleResendNotification().catch((err: Error) => {
                              setResendNotificationErrorState({
                                subjectId: modelIdString,
                                value: BaseAPI.getFriendlyMessage(err),
                              });
                            });
                          }}
                        />
                        {resendNotificationError ? (
                          <p
                            role="alert"
                            className="mt-1.5 text-xs text-red-600"
                          >
                            {"Could not resend notifications: " +
                              resendNotificationError}
                          </p>
                        ) : (
                          <></>
                        )}
                      </div>
                    );
                  },
                },
                {
                  field: {
                    labels: {
                      name: true,
                      color: true,
                    },
                  },
                  title: "Labels",
                  fieldType: FieldType.Element,
                  getElement: (item: Incident): ReactElement => {
                    return <LabelsElement labels={item["labels"] || []} />;
                  },
                },
                {
                  field: {
                    incidentNumber: true,
                    incidentNumberWithPrefix: true,
                  },
                  title: "Incident Number",
                  fieldType: FieldType.Element,
                  getElement: (item: Incident): ReactElement => {
                    if (!item.incidentNumber) {
                      return <>-</>;
                    }

                    return (
                      <span className="text-sm font-semibold text-gray-900">
                        {item.incidentNumberWithPrefix ||
                          "#" + item.incidentNumber}
                      </span>
                    );
                  },
                },
                {
                  field: {
                    _id: true,
                  },
                  title: "Incident ID",
                  fieldType: FieldType.ObjectID,
                },
              ],
              modelId: modelId,
            }}
          />

          <IncidentMemberRoleAssignment
            incidentId={modelId}
            headerLayout="stacked"
            onMemberChange={async () => {
              /*
               * Nothing else on the page shows roles; the only other place a
               * member change appears is the feed.
               */
              refreshFeed();
            }}
          />

          <CardModelDetail<Incident>
            name="Affected Resources"
            cardProps={{
              title: "Affected Resources",
              description:
                "Monitors, services, infrastructure and SLOs this incident affects.",
              headerLayout: "stacked",
            }}
            isEditable={true}
            editButtonText="Edit"
            onSaveSuccess={() => {
              refreshFeed();
            }}
            formFields={[
              {
                field: {
                  monitors: true,
                },
                title: "",
                description:
                  "Search and attach monitors, hosts, clusters, container hosts, or services affected by this incident.",
                fieldType: FormFieldSchemaType.CustomComponent,
                required: false,
                getCustomElement: (
                  values: FormValues<Incident>,
                  elementProps: CustomElementProps,
                ) => {
                  return (
                    <AffectedResourcesPicker
                      monitors={values.monitors as Array<Monitor>}
                      hosts={values.hosts as Array<Host>}
                      kubernetesClusters={
                        values.kubernetesClusters as Array<KubernetesCluster>
                      }
                      dockerHosts={values.dockerHosts as Array<DockerHost>}
                      podmanHosts={values.podmanHosts as Array<PodmanHost>}
                      proxmoxClusters={
                        values.proxmoxClusters as Array<ProxmoxCluster>
                      }
                      vmwareVCenters={
                        values.vmwareVCenters as Array<VMwareVCenter>
                      }
                      cephClusters={values.cephClusters as Array<CephCluster>}
                      dockerSwarmClusters={
                        values.dockerSwarmClusters as Array<DockerSwarmCluster>
                      }
                      iotFleets={values.iotFleets as Array<IoTFleet>}
                      services={values.services as Array<Service>}
                      resourceTypes={[
                        "Monitor",
                        "Host",
                        "KubernetesCluster",
                        "DockerHost",
                        "PodmanHost",
                        "ProxmoxCluster",
                        "VMwareVCenter",
                        "CephCluster",
                        "DockerSwarmCluster",
                        "IoTFleet",
                        "Service",
                      ]}
                      onChange={(payload: unknown) => {
                        elementProps.onChange?.(payload);
                      }}
                    />
                  );
                },
                onChange: (
                  value: unknown,
                  currentValues: FormValues<Incident>,
                  setNewFormValues: (values: FormValues<Incident>) => void,
                ) => {
                  if (isAffectedResourcesPayload(value)) {
                    const payload: typeof value = value;
                    queueMicrotask(() => {
                      setNewFormValues({
                        ...currentValues,
                        monitors: payload.monitors,
                        hosts: payload.hosts,
                        kubernetesClusters: payload.kubernetesClusters,
                        dockerHosts: payload.dockerHosts,
                        podmanHosts: payload.podmanHosts,
                        proxmoxClusters: payload.proxmoxClusters,
                        vmwareVCenters: payload.vmwareVCenters,
                        cephClusters: payload.cephClusters,
                        dockerSwarmClusters: payload.dockerSwarmClusters,
                        iotFleets: payload.iotFleets,
                        services: payload.services,
                      } as FormValues<Incident>);
                    });
                  }
                },
              },
              /*
               * Hidden registrations so ModelForm.getSelectFields includes
               * hosts/kubernetesClusters/dockerHosts/services on load and submit.
               */
              {
                field: { hosts: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
              {
                field: { kubernetesClusters: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
              {
                field: { dockerHosts: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
              {
                field: { podmanHosts: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
              {
                field: { proxmoxClusters: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
              {
                field: { vmwareVCenters: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
              {
                field: { cephClusters: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
              {
                field: { dockerSwarmClusters: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
              {
                field: { iotFleets: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
              {
                field: { services: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
              {
                field: {
                  changeMonitorStatusTo: true,
                },
                title: "Change Monitor Status to",
                description:
                  "This will change the status of all the monitors attached to this incident.",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownModal: {
                  type: MonitorStatus,
                  labelField: "name",
                  valueField: "_id",
                },
                required: false,
                placeholder: "Monitor Status",
              },
            ]}
            modelDetailProps={{
              showDetailsInNumberOfColumns: 1,
              style: DetailStyle.Compact,
              modelType: Incident,
              id: "model-detail-incident-affected-resources",
              onItemLoaded: (item: Incident): void => {
                // The header's "Monitor(s)" fact, from the row this card already reads.
                setAffectedMonitorsState({
                  subjectId: modelIdString,
                  value: item.monitors || [],
                });
              },
              fields: [
                {
                  field: {
                    monitors: {
                      name: true,
                      _id: true,
                    },
                    hosts: {
                      name: true,
                      _id: true,
                    },
                    kubernetesClusters: {
                      name: true,
                      _id: true,
                    },
                    dockerHosts: {
                      name: true,
                      _id: true,
                    },
                    podmanHosts: {
                      name: true,
                      _id: true,
                    },
                    proxmoxClusters: {
                      name: true,
                      _id: true,
                    },
                    vmwareVCenters: {
                      name: true,
                      _id: true,
                    },
                    cephClusters: {
                      name: true,
                      _id: true,
                    },
                    dockerSwarmClusters: {
                      name: true,
                      _id: true,
                    },
                    iotFleets: {
                      name: true,
                      _id: true,
                    },
                    services: {
                      name: true,
                      _id: true,
                      serviceColor: true,
                    },
                    /*
                     * Shown, never edited: the picker above does not offer
                     * SLOs and no hidden registration loads them into the
                     * form, so saving other resources leaves the link a burn
                     * rate rule wrote untouched.
                     */
                    serviceLevelObjectives: {
                      name: true,
                      _id: true,
                    },
                  },
                  title: "",
                  fieldType: FieldType.Element,
                  getElement: (item: Incident): ReactElement => {
                    return (
                      <AffectedResourcesDisplay
                        monitors={item.monitors || []}
                        hosts={item.hosts || []}
                        kubernetesClusters={item.kubernetesClusters || []}
                        dockerHosts={item.dockerHosts || []}
                        podmanHosts={item.podmanHosts || []}
                        proxmoxClusters={item.proxmoxClusters || []}
                        vmwareVCenters={item.vmwareVCenters || []}
                        cephClusters={item.cephClusters || []}
                        dockerSwarmClusters={item.dockerSwarmClusters || []}
                        iotFleets={item.iotFleets || []}
                        services={item.services || []}
                        serviceLevelObjectives={
                          item.serviceLevelObjectives || []
                        }
                        columns={1}
                      />
                    );
                  },
                },
              ],
              modelId: modelId,
            }}
          />

          <OverviewCustomFields
            modelId={modelId}
            modelType={Incident}
            customFieldType={IncidentCustomField}
            resourceName="Incident"
            headerLayout="stacked"
          />
        </div>
      </div>
    </div>
  );
};

export default IncidentView;
