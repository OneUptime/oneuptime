import ChangeAlertState from "../../../Components/Alert/ChangeState";
import LabelsElement from "Common/UI/Components/Label/Labels";
import OnCallDutyPoliciesView from "../../../Components/OnCallPolicy/OnCallPolicies";
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
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
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
import MonitorElement from "../../../Components/Monitor/Monitor";
import AffectedResourcesDisplay from "../../../Components/AffectedResources/AffectedResourcesDisplay";
import AffectedResourcesPicker, {
  isAffectedResourcesPayload,
} from "../../../Components/AffectedResources/AffectedResourcesPicker";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import Host from "Common/Models/DatabaseModels/Host";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import Service from "Common/Models/DatabaseModels/Service";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import AlertEpisodeElement from "../../../Components/AlertEpisode/AlertEpisode";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import MetricView from "../../../Components/Metrics/MetricView";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricSeriesScope from "Common/Utils/Metrics/MetricSeriesScope";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";
import TelemetrySnapshotWindowAlert from "../../../Components/Telemetry/TelemetrySnapshotWindowAlert";
import TelemetryCompanionSignalTabs from "../../../Components/Telemetry/TelemetryCompanionSignalTabs";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import IconProp from "Common/Types/Icon/IconProp";
import AlertFeedElement from "../../../Components/Alert/AlertFeed";
import InvestigationPanel from "../../../Components/AI/InvestigationPanel";
import EventStatTile from "../../../Components/EventView/EventStatTile";
import EventStatBar from "../../../Components/EventView/EventStatBar";
import EventOverviewSkeleton from "../../../Components/EventView/EventOverviewSkeleton";
import { EventStatusFact } from "../../../Components/EventView/EventStatusPanel";
import EntityRunbooks from "../../../Components/Runbook/EntityRunbooks";
import RemediationSuggestionCard from "../../../Components/AutoRemediation/RemediationSuggestionCard";
import AlertAffectedResources from "./AffectedResources";
import MonitorSummarySnapshotCard from "../../../Components/Monitor/MonitorSummarySnapshotCard";
import ExceptionsViewer from "../../../Components/Exceptions/ExceptionsViewer";
import Query from "Common/Types/BaseDatabase/Query";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Span from "Common/Models/AnalyticsModels/Span";
import Log from "Common/Models/AnalyticsModels/Log";
import LiveDuration from "../../../Components/EventView/LiveDuration";
import {
  EventStateTimelineDate,
  getEventEndDateForCurrentState,
} from "../../../Utils/EventDuration";
import {
  EventResponseTimes,
  getEventResponseTimes,
  getTimeToStateText,
} from "../../../Utils/EventOverview";
import OverviewCustomFields from "../../../Components/CustomFields/OverviewCustomFields";
import AlertCustomField from "Common/Models/DatabaseModels/AlertCustomField";
import AIRunHumanVerdict from "Common/Types/AI/AIRunHumanVerdict";
import AIRunStatus from "Common/Types/AI/AIRunStatus";

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
 * A value that belongs to one alert. The page stays mounted when the reader
 * moves to another alert on the same route, so anything a card reported is
 * stamped with the alert it was reported for and read only while that is
 * still the alert on screen.
 */
interface SubjectValue<T> {
  subjectId: string;
  value: T;
}

interface FetchDataOptions {
  /*
   * A refresh after an action or an edit. The page is already on screen, so
   * it stays mounted and a failure is reported inline instead of replacing
   * everything with an error.
   */
  isBackgroundRefresh: boolean;
}

const AlertView: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const modelIdString: string = modelId.toString();

  const [alertStateTimeline, setAlertStateTimeline] = useState<
    AlertStateTimeline[]
  >([]);
  const [alertStates, setAlertStates] = useState<AlertState[]>([]);

  // A failed FIRST load, which replaces the page.
  const [error, setError] = useState<string>("");
  // A failed background refresh, shown above the still-mounted page.
  const [refreshError, setRefreshError] = useState<string>("");
  /*
   * Which alert the page-level state below was loaded for (or failed to load
   * for). Until it is the alert in the URL, the page renders only the
   * skeleton. This is decided at render time, not reset in an effect: the
   * page stays mounted when the reader follows a link to another alert, and
   * an effect runs only after a render that would already have handed every
   * card the new id over the previous alert's header, and fired all of their
   * requests before unmounting them again. Refreshes never clear it.
   */
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);
  /*
   * Bumped by every fetch and on unmount. A response only lands while no
   * newer fetch has started, so two overlapping refreshes can never leave the
   * older data on screen.
   */
  const fetchGenerationRef: React.MutableRefObject<number> = useRef<number>(0);
  /*
   * The alert the page is on now. A callback from a card rendered for the
   * previous alert can still fire after the switch (a save or a state change
   * that lands late); its refresh must not cancel this alert's load.
   */
  const currentModelIdRef: React.MutableRefObject<string> =
    useRef<string>(modelIdString);

  /*
   * "host.name = prod-01" when a grouped metric monitor opened this alert
   * for one series. Empty for whole-monitor alerts.
   */
  const [seriesSummary, setSeriesSummary] = useState<string>("");
  // The raw series labels, handed to the affected resource card below.
  const [seriesLabels, setSeriesLabels] = useState<JSONObject | null>(null);

  const [telemetryQuery, setTelemetryQuery] = useState<TelemetryQuery | null>(
    null,
  );
  /*
   * The window the monitor evaluated over when it raised this alert. Every
   * telemetry preview below is scoped to it, and each card shows it, so a
   * snapshot from days ago can't be mistaken for a live view.
   */
  const [telemetrySnapshotWindow, setTelemetrySnapshotWindow] =
    useState<InBetween<Date> | null>(null);

  const [severity, setSeverity] = useState<
    { name: string; color: Color } | undefined
  >(undefined);
  const [isPrivate, setIsPrivate] = useState<boolean>(false);
  const [eventNumber, setEventNumber] = useState<string | undefined>(undefined);
  const [alertTitle, setAlertTitle] = useState<string | undefined>(undefined);
  const [alertStartedAt, setAlertStartedAt] = useState<Date | undefined>(
    undefined,
  );
  /*
   * Header facts that come from the details card, which already reads the
   * monitor and the episode, so the header costs no extra request. Undefined
   * until that card reports in for this alert.
   */
  const [alertMonitorState, setAlertMonitorState] = useState<SubjectValue<
    Monitor | undefined
  > | null>(null);
  const alertMonitor: Monitor | undefined =
    alertMonitorState?.subjectId === modelIdString
      ? alertMonitorState.value
      : undefined;
  const [alertEpisodeState, setAlertEpisodeState] = useState<SubjectValue<
    AlertEpisode | undefined
  > | null>(null);
  const alertEpisode: AlertEpisode | undefined =
    alertEpisodeState?.subjectId === modelIdString
      ? alertEpisodeState.value
      : undefined;

  const [aiInvestigationStatus, setAIInvestigationStatus] =
    useState<AIInvestigationStatusState>({
      subjectId: modelIdString,
      status: null,
    });
  const currentAIInvestigationStatus: AIRunStatus | null =
    aiInvestigationStatus.subjectId === modelIdString
      ? aiInvestigationStatus.status
      : null;
  /*
   * Lifted from InvestigationPanel's own poller, exactly as on the incident
   * page, so the alert header can say an investigation is running without a
   * second request.
   */
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
   * The completed report's TL;DR, lifted the same way, so the header can lead
   * with it. Keyed by subject so a summary never outlives its alert.
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
   * verdict never outlives its alert.
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
    // The alert this fetch was started for, captured with this render.
    const requestedModelId: string = modelIdString;

    if (requestedModelId !== currentModelIdRef.current) {
      // A card rendered for the alert the reader already left.
      return;
    }

    fetchGenerationRef.current++;
    const generation: number = fetchGenerationRef.current;

    try {
      // Independent reads: fetch them together instead of one after another.
      const [alertTimelines, alertStates, alert]: [
        ListResult<AlertStateTimeline>,
        ListResult<AlertState>,
        Alert | null,
      ] = await Promise.all([
        ModelAPI.getList<AlertStateTimeline>({
          modelType: AlertStateTimeline,
          query: {
            alertId: modelId,
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
            alertStateId: true,
          },
          sort: {
            startsAt: SortOrder.Ascending,
          },
        }),
        ModelAPI.getList<AlertState>({
          modelType: AlertState,
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
        ModelAPI.getItem<Alert>({
          id: modelId,
          modelType: Alert,
          select: {
            telemetryQuery: true,
            seriesLabels: true,
            isPrivate: true,
            title: true,
            createdAt: true,
            alertNumber: true,
            alertNumberWithPrefix: true,
            alertSeverity: {
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

      if (alert?.telemetryQuery) {
        telemetryQuery = JSONFunctions.deserialize(
          alert?.telemetryQuery as any,
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
       * SAME query configs onto all five alerts. Narrow it to this alert's
       * own series so the chart shows the host it is about instead of
       * every host the monitor watches.
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
            seriesLabels: alert?.seriesLabels as JSONObject | undefined,
          }),
        );

        telemetryQuery = {
          ...telemetryQuery,
          metricViewData:
            MetricSeriesScope.scopeMetricViewDataToSeries({
              metricViewData: telemetryQuery.metricViewData,
              seriesLabels: alert?.seriesLabels as JSONObject | undefined,
            }) || null,
        };
      } else {
        setSeriesSummary("");
      }

      setSeriesLabels((alert?.seriesLabels as JSONObject | undefined) || null);

      if (alert?.alertSeverity) {
        setSeverity({
          name: alert.alertSeverity.name || "Unknown",
          color: alert.alertSeverity.color || Black,
        });
      } else {
        setSeverity(undefined);
      }

      setIsPrivate(alert?.isPrivate || false);

      setAlertTitle(alert?.title || undefined);
      setAlertStartedAt(alert?.createdAt || undefined);

      setEventNumber(
        alert?.alertNumberWithPrefix ||
          (alert?.alertNumber ? "#" + alert.alertNumber : undefined),
      );

      setTelemetryQuery(telemetryQuery);
      setAlertStates(alertStates.data as AlertState[]);
      setAlertStateTimeline(alertTimelines.data as AlertStateTimeline[]);
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

  useEffect(() => {
    return () => {
      fetchGenerationRef.current++;
    };
  }, []);

  useEffect(() => {
    /*
     * A different alert is a first load again. The skeleton is already on
     * screen (loadedModelId still names the previous alert); forget the
     * previous alert's errors while it is. On mount these are no-ops.
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
    return <EventOverviewSkeleton statCount={3} loadingText="Loading alert" />;
  }

  if (error) {
    return <ErrorMessage message={error} onRefreshClick={retryFirstLoad} />;
  }

  type GetAlertStateFunction = () => AlertState | undefined;

  const getAcknowledgeState: GetAlertStateFunction = ():
    | AlertState
    | undefined => {
    return alertStates.find((state: AlertState) => {
      return state.isAcknowledgedState;
    });
  };

  const getResolvedState: GetAlertStateFunction = ():
    | AlertState
    | undefined => {
    return alertStates.find((state: AlertState) => {
      return state.isResolvedState;
    });
  };

  const acknowledgeState: AlertState | undefined = getAcknowledgeState();
  const resolvedState: AlertState | undefined = getResolvedState();

  const timelineDates: Array<EventStateTimelineDate> = alertStateTimeline.map(
    (timeline: AlertStateTimeline): EventStateTimelineDate => {
      return {
        stateId: timeline.alertStateId?.toString(),
        startsAt: timeline.startsAt,
      };
    },
  );

  /*
   * One consistent reading of the timeline for all three numbers: time to
   * acknowledge and time to resolve both count to the FIRST such entry (a
   * later reopen does not rewrite them), and the duration runs to the current
   * resolution, or keeps ticking while the alert is open.
   */
  const responseTimes: EventResponseTimes = getEventResponseTimes({
    timelines: timelineDates,
    startedAt: alertStartedAt,
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

  const headerFacts: Array<EventStatusFact> = [];

  if (alertStartedAt) {
    headerFacts.push({
      label: "Created",
      icon: IconProp.Calendar,
      value: formatDate(alertStartedAt) || "",
    });
  }

  if (alertMonitor?.name) {
    headerFacts.push({
      label: "Monitor",
      icon: IconProp.AltGlobe,
      value: <MonitorElement monitor={alertMonitor} />,
    });
  }

  if (alertEpisode?.title) {
    headerFacts.push({
      label: "Episode",
      icon: IconProp.SquareStack,
      value: <AlertEpisodeElement alertEpisode={alertEpisode} />,
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
            {`Could not refresh this alert. ${refreshError}`}
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
        <ChangeAlertState
          alertId={modelId}
          eventNumber={eventNumber}
          title={alertTitle}
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
        ariaLabel="Alert response times"
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
           * Lead with the AI investigation, or explain why it did not start,
           * before showing the alert's supporting telemetry.
           */}
          <InvestigationPanel
            subjectType="alert"
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
              eventNoun="alert"
              primarySignalElement={
                <Fragment>
                  {telemetryQuery.telemetryType === TelemetryType.Log &&
                    telemetryQuery.telemetryQuery && (
                      <div>
                        <Card
                          title={"Logs"}
                          description={"Logs for this alert."}
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
                          description={"Spans for this alert."}
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
                            ? `Metrics for this alert, scoped to the affected series (${seriesSummary}).`
                            : "Metrics for this alert."
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
                        description={"Exceptions for this alert."}
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

          <MonitorSummarySnapshotCard alertId={modelId} />

          <AlertAffectedResources
            alertId={modelId}
            seriesLabels={seriesLabels}
          />

          <RemediationSuggestionCard alertId={modelId} hideIfEmpty={true} />

          <EntityRunbooks alertId={modelId} hideIfEmpty={true} />

          <AlertFeedElement alertId={modelId} refreshToken={feedRefreshToken} />
        </div>

        <div className="min-w-0 xl:col-span-1">
          {/* Alert View  */}
          <CardModelDetail<Alert>
            name="Alert Details"
            cardProps={{
              title: "Alert Details",
              description: "Key facts about this alert.",
              headerLayout: "stacked",
            }}
            isEditable={true}
            editButtonText="Edit"
            onSaveSuccess={() => {
              // refresh page-level state (title/severity/visibility pills) shown in the header above.
              refreshData();
              refreshFeed();
            }}
            formSteps={[
              {
                title: "Alert Details",
                id: "alert-details",
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
                title: "Alert Title",
                stepId: "alert-details",
                fieldType: FormFieldSchemaType.Text,
                required: true,
                placeholder: "Alert Title",
                validation: {
                  minLength: 2,
                },
              },

              {
                field: {
                  alertSeverity: true,
                },
                title: "Alert Severity",
                description: "What type of alert is this?",
                fieldType: FormFieldSchemaType.Dropdown,
                stepId: "alert-details",
                dropdownModal: {
                  type: AlertSeverity,
                  labelField: "name",
                  valueField: "_id",
                },
                required: true,
                placeholder: "Alert Severity",
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
              {
                field: {
                  isPrivate: true,
                },
                title: "Private Alert",
                stepId: "alert-details",
                description:
                  "If enabled, only the alert's owner users and members of its owner teams (plus project admins and owners) can view this alert.",
                fieldType: FormFieldSchemaType.Toggle,
                required: false,
              },
            ]}
            modelDetailProps={{
              selectMoreFields: {
                alertNumberWithPrefix: true,
                isPrivate: true,
                createdByUser: {
                  _id: true,
                  name: true,
                  email: true,
                  profilePictureId: true,
                },
              },
              onItemLoaded: (item: Alert): void => {
                // The header's "Monitor" and "Episode" facts, from the row this card already reads.
                setAlertMonitorState({
                  subjectId: modelIdString,
                  value: item.monitor || undefined,
                });
                setAlertEpisodeState({
                  subjectId: modelIdString,
                  value: item.alertEpisode || undefined,
                });
              },
              showDetailsInNumberOfColumns: 1,
              style: DetailStyle.Compact,
              modelType: Alert,
              id: "model-detail-alerts",
              fields: [
                {
                  field: {
                    createdAt: true,
                  },
                  title: "Created At",
                  fieldType: FieldType.DateTime,
                },
                {
                  field: {
                    createdByProbe: {
                      name: true,
                      iconFileId: true,
                    },
                  },
                  title: "Created By",
                  fieldType: FieldType.Element,
                  getElement: (item: Alert): ReactElement => {
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
                  /*
                   * Alert.monitor is a singular relation set at creation, so it
                   * gets its own row separate from the multi-resource picker.
                   */
                  field: {
                    monitor: {
                      name: true,
                      _id: true,
                    },
                  },
                  title: "Monitor",
                  fieldType: FieldType.Element,
                  getElement: (item: Alert): ReactElement => {
                    if (!item.monitor) {
                      return <span className="text-gray-500">No monitor</span>;
                    }

                    return <MonitorElement monitor={item.monitor} />;
                  },
                },
                {
                  field: {
                    alertEpisode: {
                      title: true,
                      _id: true,
                    },
                  },
                  title: "Episode",
                  fieldType: FieldType.Element,
                  getElement: (item: Alert): ReactElement => {
                    if (item.alertEpisode) {
                      return (
                        <AlertEpisodeElement alertEpisode={item.alertEpisode} />
                      );
                    }
                    return (
                      <span className="text-gray-500">
                        Not part of an episode
                      </span>
                    );
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
                  getElement: (item: Alert): ReactElement => {
                    return (
                      <OnCallDutyPoliciesView
                        onCallPolicies={item.onCallDutyPolicies || []}
                      />
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
                  getElement: (item: Alert): ReactElement => {
                    return <LabelsElement labels={item["labels"] || []} />;
                  },
                },
                {
                  field: {
                    alertNumber: true,
                    alertNumberWithPrefix: true,
                  },
                  title: "Alert Number",
                  fieldType: FieldType.Element,
                  getElement: (item: Alert): ReactElement => {
                    if (!item.alertNumber) {
                      return <>-</>;
                    }

                    return (
                      <span className="font-semibold text-gray-900">
                        {item.alertNumberWithPrefix || `#${item.alertNumber}`}
                      </span>
                    );
                  },
                },
                {
                  field: {
                    _id: true,
                  },
                  title: "Alert ID",
                  fieldType: FieldType.ObjectID,
                },
              ],
              modelId: modelId,
            }}
          />

          <CardModelDetail<Alert>
            name="Affected Resources"
            cardProps={{
              title: "Affected Resources",
              description:
                "Monitors, services, infrastructure and SLOs this alert affects.",
              headerLayout: "stacked",
            }}
            isEditable={true}
            editButtonText="Edit"
            onSaveSuccess={() => {
              refreshFeed();
            }}
            formFields={[
              {
                /*
                 * Alert.monitor is singular and set at creation; this picker
                 * edits only the ManyToMany affected resources. The monitor is
                 * shown below but never loaded into this form, so saving here
                 * cannot change it.
                 */
                field: { hosts: true },
                title: "",
                description:
                  "Search and attach hosts, clusters, container hosts, or services affected by this alert.",
                fieldType: FormFieldSchemaType.CustomComponent,
                required: false,
                getCustomElement: (
                  values: FormValues<Alert>,
                  elementProps: CustomElementProps,
                ) => {
                  return (
                    <AffectedResourcesPicker
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
                      databaseServers={
                        values.databaseServers as Array<DatabaseServer>
                      }
                      services={values.services as Array<Service>}
                      resourceTypes={[
                        "Host",
                        "KubernetesCluster",
                        "DockerHost",
                        "PodmanHost",
                        "ProxmoxCluster",
                        "VMwareVCenter",
                        "CephCluster",
                        "DockerSwarmCluster",
                        "IoTFleet",
                        "DatabaseServer",
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
                  currentValues: FormValues<Alert>,
                  setNewFormValues: (values: FormValues<Alert>) => void,
                ) => {
                  if (isAffectedResourcesPayload(value)) {
                    const payload: typeof value = value;
                    queueMicrotask(() => {
                      setNewFormValues({
                        ...currentValues,
                        hosts: payload.hosts,
                        kubernetesClusters: payload.kubernetesClusters,
                        dockerHosts: payload.dockerHosts,
                        podmanHosts: payload.podmanHosts,
                        proxmoxClusters: payload.proxmoxClusters,
                        vmwareVCenters: payload.vmwareVCenters,
                        cephClusters: payload.cephClusters,
                        dockerSwarmClusters: payload.dockerSwarmClusters,
                        iotFleets: payload.iotFleets,
                        databaseServers: payload.databaseServers,
                        services: payload.services,
                      } as FormValues<Alert>);
                    });
                  }
                },
              },
              /*
               * Hidden registrations so ModelForm.getSelectFields includes
               * kubernetesClusters/dockerHosts/services.
               */
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
                field: { databaseServers: true },
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
            ]}
            modelDetailProps={{
              showDetailsInNumberOfColumns: 1,
              style: DetailStyle.Compact,
              modelType: Alert,
              id: "model-detail-alert-affected-resources",
              fields: [
                {
                  field: {
                    /*
                     * Shown, never edited, like the SLOs below. The alert's
                     * "created" feed item names its monitor under Resources
                     * Affected; left out here, a monitor's alert read "No
                     * resources affected" right beside that feed item.
                     */
                    monitor: {
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
                    databaseServers: {
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
                  getElement: (item: Alert): ReactElement => {
                    return (
                      <AffectedResourcesDisplay
                        monitors={item.monitor ? [item.monitor] : []}
                        hosts={item.hosts || []}
                        kubernetesClusters={item.kubernetesClusters || []}
                        dockerHosts={item.dockerHosts || []}
                        podmanHosts={item.podmanHosts || []}
                        proxmoxClusters={item.proxmoxClusters || []}
                        vmwareVCenters={item.vmwareVCenters || []}
                        cephClusters={item.cephClusters || []}
                        dockerSwarmClusters={item.dockerSwarmClusters || []}
                        iotFleets={item.iotFleets || []}
                        databaseServers={item.databaseServers || []}
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
            modelType={Alert}
            customFieldType={AlertCustomField}
            resourceName="Alert"
            headerLayout="stacked"
          />
        </div>
      </div>
    </div>
  );
};

export default AlertView;
