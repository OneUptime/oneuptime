import AffectedResourcesDisplay from "../../../Components/AffectedResources/AffectedResourcesDisplay";
import ResolvedStateUtil from "Common/Utils/ResolvedState";
import AcknowledgedStateUtil from "Common/Utils/AcknowledgedState";
import { StateListType } from "Common/Utils/StateOrder";
import ChangeIncidentState from "../../../Components/Incident/ChangeState";
import LabelsElement from "Common/UI/Components/Label/Labels";
import OnCallDutyPoliciesView from "../../../Components/OnCallPolicy/OnCallPolicies";
import SubscriberNotificationStatus, {
  ResendNotificationOptions,
} from "../../../Components/StatusPageSubscribers/SubscriberNotificationStatus";
import SubscriberNotificationResendCopy from "../../../Components/StatusPageSubscribers/SubscriberNotificationResendCopy";
import SubscriberAudienceSummary from "../../../Components/Incident/SubscriberAudienceSummary";
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
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { DetailStyle } from "Common/UI/Components/Detail/Detail";
import FieldType from "Common/UI/Components/Types/FieldType";
import BaseAPI from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { canWriteNoteColumn } from "../../../Components/EventNotes/EventNotesUtil";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import User from "Common/UI/Utils/User";
import Card from "Common/UI/Components/Card/Card";
import { TimeRangeZoomProvider } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import DashboardLogsViewer from "../../../Components/Logs/LogsViewer";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import JSONFunctions from "Common/Types/JSONFunctions";
import TracesViewer from "../../../Components/Traces/TracesViewer";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import MetricView from "../../../Components/Metrics/MetricView";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricSeriesScope from "Common/Utils/Metrics/MetricSeriesScope";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";
import TelemetryCompanionSignalTabs from "../../../Components/Telemetry/TelemetryCompanionSignalTabs";
import useTelemetrySnapshotZoom, {
  TelemetrySnapshotBadge,
  TelemetrySnapshotZoom,
} from "../../../Components/Telemetry/TelemetrySnapshotZoom";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import IconProp from "Common/Types/Icon/IconProp";
import IncidentFeedElement from "../../../Components/Incident/IncidentFeed";
import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import InvestigationPanel, {
  InvestigationConversationSlot,
} from "../../../Components/AI/InvestigationPanel";
import InvestigationConversation from "../../../Components/AI/InvestigationConversation/InvestigationConversation";
import EntityRunbooks from "../../../Components/Runbook/EntityRunbooks";
import RemediationSuggestionCard from "../../../Components/AutoRemediation/RemediationSuggestionCard";
import useAiCardFold, {
  AiCardFoldWiring,
} from "../../../Components/AI/useAiCardFold";
import IncidentAffectedResources from "./AffectedResources";
import MonitorSummarySnapshotCard from "../../../Components/Monitor/MonitorSummarySnapshotCard";
import IncidentMemberRoleAssignment, {
  assignIncidentRole,
} from "../../../Components/Incident/IncidentMemberRoleAssignment";
import IncidentMember from "Common/Models/DatabaseModels/IncidentMember";
import { OwnersChange } from "../../../Components/Owners/AddOwners";
import { PeoplePickerOption } from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import EventStatTile from "../../../Components/EventView/EventStatTile";
import EventStatBar from "../../../Components/EventView/EventStatBar";
import EventOverviewSkeleton from "../../../Components/EventView/EventOverviewSkeleton";
import {
  EventPanelAction,
  EventStatusFact,
} from "../../../Components/EventView/EventStatusPanel";
import EventVideoCallsCard from "../../../Components/VideoCall/EventVideoCallsCard";
import CallSummarySection from "../../../Components/AI/CallSummary/CallSummarySection";
import IncidentVideoCall from "Common/Models/DatabaseModels/IncidentVideoCall";
import useEventVideoCalls, {
  EventVideoCallsState,
  VideoCallEventKind,
} from "../../../Components/VideoCall/useEventVideoCalls";
import { getJoinVideoCallAction } from "../../../Components/VideoCall/JoinVideoCallAction";
import useRecordChannelLinks, {
  getOpenInChatActions,
} from "../../../Components/Workspace/useRecordChannelLinks";
import usePassOnPage, {
  PassOnPageControls,
} from "../../../Components/OnCallPolicy/PassOn/usePassOnPage";
import { OnCallPageRecordType } from "Common/Types/OnCallDutyPolicy/OnCallPagePassOn";
import RecordChannelMembersCard from "../../../Components/Workspace/RecordChannelMembersCard";
import {
  WorkspaceChannelLink,
  WorkspaceChannelRecordType,
} from "Common/Types/Workspace/WorkspaceChannelLink";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import {
  getIncidentAffectedResourcesFormFields,
  onBeforeIncidentAffectedResourcesUpdate,
} from "../../../Components/Incident/IncidentAffectedResourcesFormFields";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import IncidentCreatedRenotify from "Common/Types/StatusPage/IncidentCreatedRenotify";
import IncidentCreatedResend from "Common/Types/StatusPage/IncidentCreatedResend";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import IncidentStatusPageScopeCopy from "../../../Components/Incident/IncidentStatusPageScopeCopy";
import IncidentStatusPageScopeView from "../../../Components/Incident/IncidentStatusPageScopeView";
import ExceptionsViewer from "../../../Components/Exceptions/ExceptionsViewer";
import Query from "Common/Types/BaseDatabase/Query";
import Span from "Common/Models/AnalyticsModels/Span";
import Log from "Common/Models/AnalyticsModels/Log";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import {
  EventStateTimelineDate,
  getEventEndDateForCurrentState,
} from "../../../Utils/EventDuration";
import {
  EventResponseTimes,
  EventStartedByInput,
  getAcknowledgedAfterPagingText,
  getEventResponseTimes,
  getEventStartedByText,
  getImpactBeforeStartText,
  getTimeToStateText,
} from "../../../Utils/EventOverview";
import EventStartTileValue from "../../../Components/EventView/EventStartTileValue";
import EventFactLinks, {
  EventFactLinkItem,
} from "../../../Components/EventView/EventFactLinks";
import EventWhatHappenedCard from "../../../Components/EventView/EventWhatHappenedCard";
import {
  getCommanderFact,
  getOwnersFact,
} from "../../../Components/EventView/EventPeopleFacts";
import useEventOwners, {
  EventOwnersState,
} from "../../../Components/EventView/useEventOwners";
import {
  EventRolesSnapshot,
  PrimaryRoleHolding,
  getPrimaryRoleHolding,
  withRoleGiven,
} from "../../../Utils/EventPeople";
import IncidentOwnerTeam from "Common/Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "Common/Models/DatabaseModels/IncidentOwnerUser";
import ChangeMonitorStatusToElement from "../../../Components/MonitorStatus/ChangeMonitorStatusToElement";
import OverviewCustomFields from "../../../Components/CustomFields/OverviewCustomFields";
import EventMeasurementsCard from "../../../Components/Measurement/EventMeasurementsCard";
import {
  INCIDENT_EVENT_MEASUREMENTS,
  getEventMeasurementRefreshKey,
} from "../../../Utils/Measurement/EventMeasurements";
import IncidentCustomField from "Common/Models/DatabaseModels/IncidentCustomField";
import AIRunHumanVerdict from "Common/Types/AI/AIRunHumanVerdict";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

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

// Join call for the newest call, when the incident has one.
function getJoinVideoCallActions(
  videoCalls: EventVideoCallsState,
): Array<EventPanelAction> {
  const action: EventPanelAction | null = getJoinVideoCallAction(
    videoCalls.calls,
  );

  return action ? [action] : [];
}

const IncidentView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const modelIdString: string = modelId.toString();
  /*
   * The AI card folds into one line - "AI investigation is off", and why -
   * when OneUptime AI neither investigated nor fixed this incident because
   * something was off for it. The Remediation card tells it whether fixing
   * did anything, and it tells the Remediation card when the line says
   * "nothing was fixed" for both (useAiCardFold).
   */
  const aiCardFold: AiCardFoldWiring = useAiCardFold(modelIdString);

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
   * A drag on the snapshot's primary chart (the metric chart, or a logs,
   * traces or exceptions explorer's histogram) zooms the whole snapshot,
   * every tab of it; see TelemetrySnapshotZoom. Held by the page, above the
   * tabs, so it outlives a switch to another tab and back, and the
   * background refresh (which re-reads an equal window) keeps it.
   */
  const snapshotZoom: TelemetrySnapshotZoom = useTelemetrySnapshotZoom({
    snapshotWindow: telemetrySnapshotWindow,
    metricViewData: telemetryQuery?.metricViewData,
    telemetryType: telemetryQuery?.telemetryType,
    explorerQuery: telemetryQuery?.telemetryQuery,
    subjectKey: modelIdString,
  });
  /*
   * "host.name = prod-01" when a grouped metric monitor opened this
   * incident for one series. Empty for whole-monitor incidents.
   */
  const [seriesSummary, setSeriesSummary] = useState<string>("");
  // The raw series labels, handed to the affected resource card below.
  const [seriesLabels, setSeriesLabels] = useState<JSONObject | null>(null);
  const [isPrivate, setIsPrivate] = useState<boolean>(false);
  /*
   * Off when the incident was declared without notifying status page
   * subscribers; the state change and public note forms then start with
   * "Notify Status Page Subscribers" unticked.
   */
  const [
    notifyStatusPageSubscribersByDefault,
    setNotifyStatusPageSubscribersByDefault,
  ] = useState<boolean>(true);
  const [eventNumber, setEventNumber] = useState<string | undefined>(undefined);
  const [incidentTitle, setIncidentTitle] = useState<string | undefined>(
    undefined,
  );
  const [incidentStartedAt, setIncidentStartedAt] = useState<Date | undefined>(
    undefined,
  );
  /*
   * What happened and why, for the What happened card that leads the page,
   * and when customer impact began, when somebody recorded it: read with
   * the incident's own row, so the card costs no request of its own.
   */
  const [incidentDescription, setIncidentDescription] = useState<
    string | undefined
  >(undefined);
  const [incidentRootCause, setIncidentRootCause] = useState<
    string | undefined
  >(undefined);
  const [incidentImpactStartedAt, setIncidentImpactStartedAt] = useState<
    Date | undefined
  >(undefined);
  // Who or what declared it, for "By eu-west-1 probe" under the Declared tile.
  const [incidentDeclaredBy, setIncidentDeclaredBy] = useState<
    EventStartedByInput | undefined
  >(undefined);
  // When somebody was first paged about the incident, if anybody was.
  const [incidentFirstPagedAt, setIncidentFirstPagedAt] = useState<
    Date | undefined
  >(undefined);
  const [severity, setSeverity] = useState<
    { name: string; color: Color } | undefined
  >(undefined);
  /*
   * Header facts that come from cards which already load them (the roles
   * card and the affected resources card), so the header costs no extra
   * request. Undefined until those cards report in for this incident.
   */
  const [rolesSnapshot, setRolesSnapshot] =
    useState<SubjectValue<EventRolesSnapshot> | null>(null);
  const currentRolesSnapshot: EventRolesSnapshot | undefined =
    rolesSnapshot?.subjectId === modelIdString
      ? rolesSnapshot.value
      : undefined;
  const onRolesLoaded: (
    recordId: string,
    snapshot: EventRolesSnapshot,
  ) => void = useCallback(
    (recordId: string, snapshot: EventRolesSnapshot): void => {
      setRolesSnapshot({ subjectId: recordId, value: snapshot });
    },
    [],
  );
  // The incident's owners, teams first: nothing else on the page reads them.
  const owners: EventOwnersState = useEventOwners({
    ownerUserModelType: IncidentOwnerUser,
    ownerTeamModelType: IncidentOwnerTeam,
    resourceIdField: "incidentId",
    resourceId: modelId,
  });
  /*
   * Bumped when the header's Assign gave the commander, so the roles card
   * reads the incident's roles again and shows the same.
   */
  const [rolesRefreshToken, setRolesRefreshToken] = useState<number>(0);
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

  /*
   * The incident's video calls: the card in the right column, and the Join
   * call button in the header for the newest one.
   */
  const videoCalls: EventVideoCallsState = useEventVideoCalls({
    kind: VideoCallEventKind.Incident,
    eventId: modelId,
    // A rule's call arrives a moment after a new incident is created.
    eventStartedAt: incidentStartedAt,
  });

  // The incident's own Slack and Teams channels: Open in Slack / Teams.
  const channelLinks: Array<WorkspaceChannelLink> = useRecordChannelLinks({
    recordType: WorkspaceChannelRecordType.Incident,
    recordId: modelId,
    // A rule's channel arrives a moment after a new incident is created.
    recordStartedAt: incidentStartedAt,
  });

  // "Escalate", for somebody an on-call policy is paging about it.
  const passOn: PassOnPageControls = usePassOnPage({
    recordType: OnCallPageRecordType.Incident,
    recordId: modelId,
    // Escalating is a new feed entry.
    onPassedOn: refreshFeed,
  });

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
            order: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
        }),
        ModelAPI.getItem<Incident>({
          id: modelId,
          modelType: Incident,
          select: {
            telemetryQuery: true,
            seriesLabels: true,
            isPrivate: true,
            shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
            title: true,
            declaredAt: true,
            // "Acknowledged in" also says how long after paging.
            firstPagedAt: true,
            // The Declared tile: how long impact had gone on, and by whom.
            impactStartedAt: true,
            isCreatedAutomatically: true,
            createdByProbe: {
              name: true,
            },
            createdByUser: {
              name: true,
              email: true,
            },
            // The What happened card.
            description: true,
            rootCause: true,
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
      setNotifyStatusPageSubscribersByDefault(
        PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident(
          incident,
        ),
      );

      setIncidentTitle(incident?.title || undefined);
      setIncidentStartedAt(incident?.declaredAt || undefined);
      setIncidentFirstPagedAt(incident?.firstPagedAt || undefined);
      setIncidentDescription(incident?.description || undefined);
      setIncidentRootCause(incident?.rootCause || undefined);
      setIncidentImpactStartedAt(incident?.impactStartedAt || undefined);
      setIncidentDeclaredBy({
        probe: incident?.createdByProbe,
        user: incident?.createdByUser,
        isCreatedAutomatically: incident?.isCreatedAutomatically,
      });

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

  /*
   * Retry and Resend of the 'created' notification write its status: offered
   * only to whoever may update the incident and that column, as the notes
   * feed offers a note's. The server refuses everyone else anyway.
   */
  const incidentModelForPermissions: Incident = new Incident();
  const canSendCreatedNotificationAgain: boolean =
    PermissionGate.check(incidentModelForPermissions, ModelAction.Update)
      .isAllowed &&
    canWriteNoteColumn({
      model: incidentModelForPermissions,
      column: "subscriberNotificationStatusOnIncidentCreated",
      action: "update",
      held: PermissionGate.getHeldPermissions(),
      isMasterAdmin: User.isMasterAdmin(),
    });

  /*
   * Sends the incident-created notification again. Retry after a failure
   * puts it back to Pending, and the server keeps its record of the status
   * pages already reached, so the send resumes after them. Resend after a
   * success - and Retry with "every status page" ticked - asks the server to
   * send it to every page again (IncidentCreatedResend), which empties that
   * record in the same write.
   */
  const handleResendNotification: (
    options: ResendNotificationOptions,
  ) => Promise<void> = async (
    options: ResendNotificationOptions,
  ): Promise<void> => {
    setResendNotificationErrorState(null);

    try {
      if (options.isToAllStatusPages) {
        /*
         * The same Pending as Retry - an update must write some column -
         * with the request that makes it reach every page.
         */
        const incident: Incident = new Incident();
        incident._id = modelIdString;
        incident.subscriberNotificationStatusOnIncidentCreated =
          StatusPageSubscriberNotificationStatus.Pending;

        await ModelAPI.createOrUpdate<Incident>({
          model: incident,
          modelType: Incident,
          formType: FormType.Update,
          miscDataProps: IncidentCreatedResend.getMiscDataProps(),
        });
      } else {
        // Reset the notification status to Pending so the worker can pick it up again
        await ModelAPI.updateById({
          id: modelId,
          modelType: Incident,
          data: {
            subscriberNotificationStatusOnIncidentCreated:
              StatusPageSubscriberNotificationStatus.Pending,
            subscriberNotificationStatusMessage:
              IncidentCreatedResend.retryQueuedMessage,
          },
        });
      }

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

  /*
   * The project's acknowledged state, by name, and every state that counts
   * as acknowledged short of resolved: it and any state placed after it, up
   * to the resolved one (Common/Utils/AcknowledgedState).
   */
  const getAcknowledgeState: GetIncidentStateFunction = ():
    | IncidentState
    | undefined => {
    return (
      AcknowledgedStateUtil.getAcknowledgedState({
        list: StateListType.IncidentState,
        states: incidentStates,
      }) || undefined
    );
  };

  const acknowledgedStateIds: Array<string> =
    AcknowledgedStateUtil.getAcknowledgedUnresolvedStateIds({
      list: StateListType.IncidentState,
      states: incidentStates,
    }).map((stateId: ObjectID) => {
      return stateId.toString();
    });

  /*
   * The project's resolved state, by name, and every state that counts as
   * resolved: it and any state placed after it (Common/Utils/ResolvedState).
   */
  const getResolvedState: GetIncidentStateFunction = ():
    | IncidentState
    | undefined => {
    return (
      ResolvedStateUtil.getResolvedState({
        list: StateListType.IncidentState,
        states: incidentStates,
      }) || undefined
    );
  };

  const resolvedStateIds: Array<string> = ResolvedStateUtil.getResolvedStateIds(
    {
      list: StateListType.IncidentState,
      states: incidentStates,
    },
  ).map((stateId: ObjectID) => {
    return stateId.toString();
  });

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
    acknowledgedStateIds: acknowledgedStateIds,
    resolvedStateIds: resolvedStateIds,
  });

  const durationStartDate: Date | undefined = responseTimes.startedAt;
  const durationEndDate: Date | undefined = getEventEndDateForCurrentState(
    timelineDates,
    resolvedStateIds,
  );

  type FormatDateFunction = (date: Date | undefined) => string | undefined;

  const formatDate: FormatDateFunction = (
    date: Date | undefined,
  ): string | undefined => {
    return date
      ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date)
      : undefined;
  };

  // The monitors it is about, each a link to its page, one under another.
  const getMonitorLinks: (monitors: Array<Monitor>) => ReactElement = (
    monitors: Array<Monitor>,
  ): ReactElement => {
    return (
      <EventFactLinks
        dataTestId="event-monitor-links"
        maxVisible={MAX_HEADER_MONITORS}
        items={monitors.map(
          (monitor: Monitor, index: number): EventFactLinkItem => {
            return {
              key: monitor._id?.toString() || `monitor-${index}`,
              name: monitor.name || translator.translateTerm("Unnamed monitor"),
              route: monitor._id
                ? RouteUtil.populateRouteParams(
                    RouteMap[PageMap.MONITOR_VIEW] as Route,
                    {
                      modelId: new ObjectID(monitor._id.toString()),
                    },
                  )
                : undefined,
            };
          },
        )}
      />
    );
  };

  /*
   * Who runs the response, beside its state and severity: the commander
   * (the project's primary incident role) and the owners, teams first. Both
   * are filled right there in the header - Assign gives the role to a
   * person picked under it, Add opens the Add owners list - and offered only
   * while the incident is open, to a reader who may give a role or add an
   * owner; a resolved one says who held them, or that nobody did.
   */
  const isResolved: boolean = Boolean(durationEndDate);
  const headerFacts: Array<EventStatusFact> = [];

  const primaryRole: PrimaryRoleHolding | null =
    getPrimaryRoleHolding(currentRolesSnapshot);
  const mayAssignRoles: boolean = PermissionGate.check(
    new IncidentMember(),
    ModelAction.Create,
  ).isAllowed;
  const commanderFact: EventStatusFact | null = getCommanderFact({
    holding: primaryRole,
    onAssign:
      isResolved || !primaryRole || !mayAssignRoles
        ? undefined
        : async (person: PeoplePickerOption): Promise<void> => {
            const incidentId: string = modelIdString;

            await assignIncidentRole({
              incidentId: new ObjectID(incidentId),
              userId: new ObjectID(person.id),
              roleId: new ObjectID(primaryRole.role.id),
            });

            // Named at once; the roles card's read says the same a moment later.
            setRolesSnapshot(
              (
                current: SubjectValue<EventRolesSnapshot> | null,
              ): SubjectValue<EventRolesSnapshot> | null => {
                if (!current || current.subjectId !== incidentId) {
                  return current;
                }

                return {
                  subjectId: incidentId,
                  value:
                    withRoleGiven({
                      snapshot: current.value,
                      roleId: primaryRole.role.id,
                      person: person,
                    }) || current.value,
                };
              },
            );
            setRolesRefreshToken((token: number): number => {
              return token + 1;
            });
            // A role given is a new feed entry.
            refreshFeed();
          },
  });

  if (commanderFact) {
    headerFacts.push(commanderFact);
  }

  const ownersFact: EventStatusFact | null = getOwnersFact({
    owners: owners.owners,
    ownersRoute: RouteUtil.populateRouteParams(
      RouteMap[PageMap.INCIDENT_VIEW_OWNERS] as Route,
      { modelId: modelId },
    ),
    addOwners:
      !isResolved && owners.canAddOwners
        ? {
            target: owners.target,
            onOwnersChanged: async (change: OwnersChange): Promise<void> => {
              // An owner added is a new feed entry too.
              if (change.wasAdded) {
                refreshFeed();
              }
              await owners.refresh();
            },
          }
        : undefined,
  });

  if (ownersFact) {
    headerFacts.push(ownersFact);
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
      <TelemetrySnapshotBadge
        window={telemetrySnapshotWindow}
        zoom={snapshotZoom.zoom}
      />
    ) : undefined;

  return (
    <div>
      {refreshError ? (
        <div
          role="alert"
          className="mb-5 flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between"
        >
          <span className="min-w-0 break-words">
            {translator.translateTemplate(
              "Could not refresh this incident. {{error}}",
              { error: refreshError },
            )}
          </span>
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={refreshData}
              className="rounded-md text-sm font-semibold text-red-800 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            >
              {translator.translateText("Try again")}
            </button>
            <button
              type="button"
              onClick={() => {
                setRefreshError("");
              }}
              className="rounded-md text-sm font-medium text-red-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            >
              {translator.translateText("Dismiss")}
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
          notifyStatusPageSubscribersByDefault={
            notifyStatusPageSubscribersByDefault
          }
          facts={headerFacts}
          secondaryActions={[
            ...passOn.actions,
            ...getJoinVideoCallActions(videoCalls),
            ...getOpenInChatActions(channelLinks),
          ]}
          aiInvestigationStatus={currentAIInvestigationStatus}
          aiInvestigationSummary={currentAIInvestigationSummary}
          aiInvestigationVerdict={currentAIInvestigationVerdict}
          onActionComplete={() => {
            refreshData();
            // The state change is a new feed entry.
            refreshFeed();
            // Acknowledging it ends the reader's own page, if they had one.
            passOn.refresh();
          }}
        />
        {passOn.dialog}
      </div>

      <EventStatBar
        columns={3}
        ariaLabel="Incident response times"
        className="mb-5"
      >
        {/*
         * The response as a line from left to right: when it was declared
         * (and how long impact had gone on, when somebody recorded it), then
         * how long until it was acknowledged and resolved. How long it has
         * lasted is the header's, beside its state: said once.
         */}
        <EventStatTile
          variant="segment"
          label="Declared"
          icon={IconProp.Calendar}
          value={
            incidentStartedAt ? (
              <EventStartTileValue startedAt={incidentStartedAt} />
            ) : (
              "-"
            )
          }
          note={getImpactBeforeStartText(
            {
              impactStartedAt: incidentImpactStartedAt,
              startedAt: incidentStartedAt,
            },
            translator,
          )}
          description={getEventStartedByText(
            incidentDeclaredBy || {},
            translator,
          )}
        />
        <EventStatTile
          variant="segment"
          label={translator.translateTemplate("{{stateName}} in", {
            stateName:
              acknowledgeState?.name || translatableTerm("Acknowledged"),
          })}
          icon={IconProp.Check}
          value={getTimeToStateText({
            startedAt: responseTimes.startedAt,
            reachedAt: responseTimes.acknowledgedAt,
            stateName: acknowledgeState?.name,
            fallbackStateName: "acknowledged",
          })}
          note={getAcknowledgedAfterPagingText(
            {
              firstPagedAt: incidentFirstPagedAt,
              acknowledgedAt: responseTimes.acknowledgedAt,
            },
            translator,
          )}
          description={formatDate(responseTimes.acknowledgedAt)}
        />
        <EventStatTile
          variant="segment"
          label={translator.translateTemplate("{{stateName}} in", {
            stateName: resolvedState?.name || translatableTerm("Resolved"),
          })}
          icon={IconProp.CheckCircle}
          value={getTimeToStateText({
            startedAt: responseTimes.startedAt,
            reachedAt: responseTimes.resolvedAt,
            stateName: resolvedState?.name,
            fallbackStateName: "resolved",
          })}
          description={formatDate(responseTimes.resolvedAt)}
        />
      </EventStatBar>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          {/*
           * Lead with what happened - the incident's description and, once
           * somebody knows it, its root cause - then the AI investigation,
           * or why it did not start, before the supporting telemetry.
           */}
          <EventWhatHappenedCard<Incident>
            modelType={Incident}
            modelId={modelId}
            description={incidentDescription}
            rootCause={incidentRootCause}
            statusPageRecord="incident"
            onSaved={() => {
              refreshData();
              // An edited root cause is a new feed entry.
              refreshFeed();
            }}
          />

          <InvestigationPanel
            subjectType="incident"
            subjectId={modelId}
            onStatusChange={onAIInvestigationStatusChange}
            onReportSummaryChange={onAIInvestigationReportSummaryChange}
            onVerdictChange={onAIInvestigationVerdictChange}
            onAnalysisAvailable={refreshFeedAfterAnalysisAvailable}
            remediationState={aiCardFold.remediationState}
            onCardFoldChange={aiCardFold.onFoldChange}
            renderConversation={(slot: InvestigationConversationSlot) => {
              return (
                <InvestigationConversation
                  subjectType="incident"
                  subjectId={modelId}
                  investigationStage={slot.investigationStage}
                  fold={slot.fold}
                />
              );
            }}
            renderCallSummaries={() => {
              return (
                <CallSummarySection
                  incidentId={modelId}
                  calls={videoCalls.calls as Array<IncidentVideoCall>}
                  onChanged={() => {
                    videoCalls.refresh();
                    // A root cause used from the call is a new feed entry.
                    refreshFeed();
                  }}
                />
              );
            }}
          />

          {telemetryQuery && (
            <TelemetryCompanionSignalTabs
              telemetryQuery={telemetryQuery}
              // The companion tabs follow the zoom: they show the slice too.
              snapshotWindow={snapshotZoom.window}
              isSnapshotZoomed={snapshotZoom.isZoomed}
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
                          {/*
                           * On the window the snapshot shows and inside
                           * its zoom, which the explorer follows: a drag
                           * on the log volume chart zooms every tab, and a
                           * double-click or the badge's Reset zoom
                           * returns them all. See TelemetrySnapshotZoom.
                           */}
                          <TimeRangeZoomProvider zoom={snapshotZoom.zoom}>
                            <DashboardLogsViewer
                              id="logs-preview"
                              logQuery={
                                snapshotZoom.explorerQuery as Query<Log>
                              }
                              limit={10}
                              noLogsMessage="No logs found"
                            />
                          </TimeRangeZoomProvider>
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
                          {/*
                           * On the window the snapshot shows and inside
                           * its zoom, which the explorer follows; see the
                           * logs above.
                           */}
                          <TimeRangeZoomProvider zoom={snapshotZoom.zoom}>
                            <TracesViewer
                              spanQuery={
                                snapshotZoom.explorerQuery as Query<Span>
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
                          </TimeRangeZoomProvider>
                        </Card>
                      </div>
                    )}

                  {telemetryQuery.telemetryType === TelemetryType.Metric &&
                    snapshotZoom.metricViewData && (
                      <Card
                        title={"Metrics"}
                        description={
                          seriesSummary
                            ? translator.translateTemplate(
                                "Metrics related to this incident, scoped to the affected series ({{seriesSummary}}).",
                                { seriesSummary: seriesSummary },
                              )
                            : "Metrics related to this incident."
                        }
                        rightElement={snapshotWindowAlert}
                      >
                        <MetricView
                          data={snapshotZoom.metricViewData}
                          hideQueryElements={true}
                          chartCssClass="rounded-lg border border-gray-200 shadow-sm"
                          hideStartAndEndDate={true}
                          /*
                           * A drag zooms the whole snapshot, and a
                           * double-click (or Reset zoom beside the badge)
                           * returns it to the snapshot window. The window
                           * itself is a record, nobody's to change
                           * (onChange is a no-op). A snapshot that stored
                           * no window has nothing to hand the other tabs:
                           * its chart zooms itself alone.
                           */
                          onTimeRangeSelect={snapshotZoom.onTimeRangeSelect}
                          onTimeRangeReset={snapshotZoom.onTimeRangeReset}
                          localChartZoom={true}
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
                        {/*
                         * On the window the snapshot shows and inside its
                         * zoom, which the explorer follows; see the logs
                         * above.
                         */}
                        <TimeRangeZoomProvider zoom={snapshotZoom.zoom}>
                          <ExceptionsViewer
                            exceptionInstanceQuery={
                              snapshotZoom.explorerQuery as Query<ExceptionInstance>
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
                        </TimeRangeZoomProvider>
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

          <RemediationSuggestionCard
            incidentId={modelId}
            hideIfEmpty={true}
            onFoldStateChange={aiCardFold.onRemediationStateChange}
            aiCardFold={aiCardFold.fold}
          />

          <EntityRunbooks incidentId={modelId} hideIfEmpty={true} />

          <IncidentFeedElement
            incidentId={modelId}
            refreshToken={feedRefreshToken}
            notifyStatusPageSubscribersByDefault={
              notifyStatusPageSubscribersByDefault
            }
            isPrivate={isPrivate}
          />
        </div>

        <div className="min-w-0 xl:col-span-1">
          {/*
           * What the incident affects, first in the column beside what
           * happened: the monitors (and the status it holds them in),
           * services and infrastructure it hits.
           */}
          <CardModelDetail<Incident>
            name="Affected Resources"
            cardProps={{
              title: "Affected Resources",
              description:
                "Monitors, services, infrastructure and SLOs this incident affects.",
              headerLayout: "stacked",
            }}
            createEditModalWidth={ModalWidth.Medium}
            isEditable={true}
            editButtonText="Edit"
            onSaveSuccess={() => {
              refreshFeed();
            }}
            onBeforeUpdate={onBeforeIncidentAffectedResourcesUpdate}
            formFields={getIncidentAffectedResourcesFormFields()}
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
                    storageArrays: {
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
                        storageArrays={item.storageArrays || []}
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
                /*
                 * What its Edit asks under the monitors, shown with them:
                 * the status the incident puts its monitors in while it is
                 * open - what their status pages show. Left out while the
                 * incident has no monitor, as the Edit leaves it out.
                 */
                {
                  field: {
                    changeMonitorStatusTo: {
                      name: true,
                      color: true,
                    },
                  },
                  title: "Change Monitor Status to",
                  fieldType: FieldType.Entity,
                  showIf: (item: Incident): boolean => {
                    return (item.monitors || []).length > 0;
                  },
                  getElement: (item: Incident): ReactElement => {
                    return (
                      <ChangeMonitorStatusToElement
                        monitorStatus={item.changeMonitorStatusTo}
                      />
                    );
                  },
                },
              ],
              modelId: modelId,
            }}
          />

          <EventVideoCallsCard
            kind={VideoCallEventKind.Incident}
            eventId={modelId}
            calls={videoCalls.calls}
            hasLoaded={videoCalls.hasLoaded}
            error={videoCalls.error}
            onRetry={videoCalls.refresh}
            onChanged={() => {
              videoCalls.refresh();
              // A started call is a new feed entry.
              refreshFeed();
            }}
          />

          {/*
           * Who is in the incident's own channel, beside its call: where its
           * responders talk. Only for an incident with a channel of its own.
           */}
          <RecordChannelMembersCard
            recordType={WorkspaceChannelRecordType.Incident}
            recordId={modelId}
            links={channelLinks}
            // Somebody added is a new feed entry.
            onChanged={refreshFeed}
          />

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
            formFields={[
              {
                field: {
                  title: true,
                },
                title: "Incident Title",
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
                description: "How serious is it?",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownModal: {
                  type: IncidentSeverity,
                  labelField: "name",
                  valueField: "_id",
                  sort: {
                    order: SortOrder.Ascending,
                  },
                },
                required: true,
                placeholder: "Incident Severity",
              },
              getLabelsFormField<Incident>(),
            ]}
            modelDetailProps={{
              selectMoreFields: {
                incidentNumberWithPrefix: true,
                subscriberNotificationStatusMessage: true,
              },
              showDetailsInNumberOfColumns: 1,
              style: DetailStyle.Compact,
              modelType: Incident,
              id: "model-detail-incidents",
              /*
               * When it was declared, and by whom, is the stat bar's
               * Declared tile: said once, beside how long the response took.
               */
              fields: [
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
                          statusText={
                            IncidentCreatedRenotify.isHiddenFromStatusPagesSkip(
                              {
                                status:
                                  item.subscriberNotificationStatusOnIncidentCreated,
                                message:
                                  item.subscriberNotificationStatusMessage,
                              },
                            )
                              ? IncidentCreatedRenotify.hiddenFromStatusPagesLabel
                              : undefined
                          }
                          /*
                           * Only for whoever may send it again - it writes
                           * the notification's status. A viewer is offered
                           * neither Resend nor Retry, as in the notes feed.
                           */
                          onResendNotification={
                            canSendCreatedNotificationAgain
                              ? (options: ResendNotificationOptions) => {
                                  handleResendNotification(options).catch(
                                    (err: Error) => {
                                      setResendNotificationErrorState({
                                        subjectId: modelIdString,
                                        value: BaseAPI.getFriendlyMessage(err),
                                      });
                                    },
                                  );
                                }
                              : undefined
                          }
                          /*
                           * Resend after a success, Retry after a failure,
                           * each confirmed with who it reaches now: the
                           * pages of the incident's current scope - for a
                           * Retry, without the pages already sent it in
                           * full, which it skips - or that it reaches no
                           * one.
                           */
                          resendConfirmation={
                            canSendCreatedNotificationAgain
                              ? {
                                  resendDescription:
                                    SubscriberNotificationResendCopy.incidentCreatedResendDescription,
                                  retryDescription:
                                    SubscriberNotificationResendCopy.incidentCreatedRetryDescription,
                                  retryToAllStatusPagesLabel:
                                    SubscriberNotificationResendCopy.incidentCreatedRetryToAllStatusPagesLabel,
                                  retryToAllStatusPagesDescription:
                                    SubscriberNotificationResendCopy.incidentCreatedResendToAllStatusPagesDescription,
                                  audience: (
                                    <SubscriberAudienceSummary
                                      request={{ incidentId: modelId }}
                                      dataTestId="incident-created-resend-audience"
                                      saysWhenNobodyIsNotified={true}
                                    />
                                  ),
                                  retryAudience: (
                                    <SubscriberAudienceSummary
                                      request={{
                                        incidentId: modelId,
                                        excludeStatusPagesNotifiedOnCreation:
                                          true,
                                      }}
                                      dataTestId="incident-created-retry-audience"
                                      saysWhenNobodyIsNotified={true}
                                    />
                                  ),
                                }
                              : undefined
                          }
                        />
                        {resendNotificationError ? (
                          <p
                            role="alert"
                            className="mt-1.5 text-xs text-red-600"
                          >
                            {translator.translateTemplate(
                              "Could not resend notifications: {{error}}",
                              { error: resendNotificationError },
                            )}
                          </p>
                        ) : (
                          <></>
                        )}
                      </div>
                    );
                  },
                },
                /*
                 * The status pages this incident is limited to, read only;
                 * it is changed on the Settings tab. The pages are read by
                 * the element itself: this card already reads two lists.
                 */
                {
                  field: {
                    isScopedToStatusPages: true,
                  },
                  title: IncidentStatusPageScopeCopy.overviewFieldTitle,
                  fieldType: FieldType.Element,
                  getElement: (item: Incident): ReactElement => {
                    return (
                      <IncidentStatusPageScopeView
                        isScopedToStatusPages={item.isScopedToStatusPages}
                        incidentId={modelId}
                        editRoute={RouteUtil.populateRouteParams(
                          RouteMap[PageMap.INCIDENT_VIEW_SETTINGS] as Route,
                          { modelId: modelId },
                        )}
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

          {/*
           * The project's own measurements - time to mitigate, say - worked
           * out for this incident, under its other facts. Drawn only when
           * the project shows some on incident pages.
           */}
          <EventMeasurementsCard
            source={INCIDENT_EVENT_MEASUREMENTS}
            eventId={modelId}
            isEventOver={Boolean(durationEndDate)}
            refreshKey={getEventMeasurementRefreshKey({
              timeline: incidentStateTimeline,
              times: [incidentStartedAt],
            })}
            headerLayout="stacked"
          />

          <IncidentMemberRoleAssignment
            incidentId={modelId}
            headerLayout="stacked"
            /*
             * The header names the commander from what this card reads, and
             * follows a change made here at once: no read of its own. A
             * commander given in the header makes it read again.
             */
            onRolesLoaded={onRolesLoaded}
            refreshToken={rolesRefreshToken}
            onMemberChange={async () => {
              // A member change is also a new feed entry.
              refreshFeed();
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
