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
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
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
  useState,
} from "react";
import UserElement from "../../../Components/User/User";
import Card from "Common/UI/Components/Card/Card";
import DashboardLogsViewer from "../../../Components/Logs/LogsViewer";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import JSONFunctions from "Common/Types/JSONFunctions";
import TraceTable from "../../../Components/Traces/TraceTable";
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
import Monitor from "Common/Models/DatabaseModels/Monitor";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import Host from "Common/Models/DatabaseModels/Host";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Service from "Common/Models/DatabaseModels/Service";
import AffectedResourcesPicker, {
  isAffectedResourcesPayload,
} from "../../../Components/AffectedResources/AffectedResourcesPicker";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import ExceptionInstanceTable from "../../../Components/Exceptions/ExceptionInstanceTable";
import Query from "Common/Types/BaseDatabase/Query";
import Span from "Common/Models/AnalyticsModels/Span";
import Log from "Common/Models/AnalyticsModels/Log";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import LiveDuration from "../../../Components/EventView/LiveDuration";
import { getEventEndDateForCurrentState } from "../../../Utils/EventDuration";
import OverviewCustomFields from "../../../Components/CustomFields/OverviewCustomFields";
import IncidentCustomField from "Common/Models/DatabaseModels/IncidentCustomField";
import AIRunStatus from "Common/Types/AI/AIRunStatus";

interface AIInvestigationStatusState {
  subjectId: string;
  status: AIRunStatus | null;
}

const IncidentView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const modelIdString: string = modelId.toString();

  const [incidentStateTimeline, setIncidentStateTimeline] = useState<
    IncidentStateTimeline[]
  >([]);
  const [incidentStates, setIncidentStates] = useState<IncidentState[]>([]);

  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);

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
  const [feedRefreshToken, setFeedRefreshToken] = useState<number>(0);

  const refreshFeedAfterAnalysisAvailable: () => void =
    useCallback((): void => {
      setFeedRefreshToken((currentToken: number): number => {
        return currentToken + 1;
      });
    }, []);

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);

      const incidentTimelines: ListResult<IncidentStateTimeline> =
        await ModelAPI.getList({
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
        });

      const incidentStates: ListResult<IncidentState> = await ModelAPI.getList({
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
      });

      const incident: Incident | null = await ModelAPI.getItem({
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
      });

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
    } catch (err) {
      setError(BaseAPI.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  const handleResendNotification: () => Promise<void> =
    async (): Promise<void> => {
      try {
        setIsLoading(true);

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

        // Refresh the data to show updated status
        await fetchData();
      } catch (err) {
        setError(BaseAPI.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
      }
    };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(BaseAPI.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
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

  type getTimeFunction = () => string;

  const getTimeToAcknowledge: getTimeFunction = (): string => {
    const incidentStartTime: Date =
      incidentStartedAt || incidentStateTimeline[0]?.startsAt || new Date();

    // last matching acknowledge entry (search a copy in reverse; do not mutate state).
    const acknowledgeTime: Date | undefined = [...incidentStateTimeline]
      .reverse()
      .find((timeline: IncidentStateTimeline) => {
        return (
          timeline.incidentStateId?.toString() ===
          getAcknowledgeState()?._id?.toString()
        );
      })?.startsAt;

    // first matching resolved entry.
    const resolveTime: Date | undefined = incidentStateTimeline.find(
      (timeline: IncidentStateTimeline) => {
        return (
          timeline.incidentStateId?.toString() ===
          getResolvedState()?._id?.toString()
        );
      },
    )?.startsAt;

    if (!acknowledgeTime && !resolveTime) {
      return (
        "Not yet " +
        (getAcknowledgeState()?.name?.toLowerCase() || "acknowledged")
      );
    }

    if (!acknowledgeTime && resolveTime) {
      return OneUptimeDate.convertMinutesToDaysHoursAndMinutes(
        OneUptimeDate.getDifferenceInMinutes(resolveTime, incidentStartTime),
      );
    }

    return OneUptimeDate.convertMinutesToDaysHoursAndMinutes(
      OneUptimeDate.getDifferenceInMinutes(acknowledgeTime!, incidentStartTime),
    );
  };

  const getTimeToResolve: getTimeFunction = (): string => {
    const incidentStartTime: Date =
      incidentStartedAt || incidentStateTimeline[0]?.startsAt || new Date();

    const resolveTime: Date | undefined = incidentStateTimeline.find(
      (timeline: IncidentStateTimeline) => {
        return (
          timeline.incidentStateId?.toString() ===
          getResolvedState()?._id?.toString()
        );
      },
    )?.startsAt;

    if (!resolveTime) {
      return (
        "Not yet " + (getResolvedState()?.name?.toLowerCase() || "resolved")
      );
    }

    return OneUptimeDate.convertMinutesToDaysHoursAndMinutes(
      OneUptimeDate.getDifferenceInMinutes(resolveTime, incidentStartTime),
    );
  };

  const durationStartDate: Date | undefined =
    incidentStartedAt || incidentStateTimeline[0]?.startsAt;
  const durationEndDate: Date | undefined = getEventEndDateForCurrentState(
    incidentStateTimeline.map((timeline: IncidentStateTimeline) => {
      return {
        stateId: timeline.incidentStateId?.toString(),
        startsAt: timeline.startsAt,
      };
    }),
    getResolvedState()?._id?.toString(),
  );

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
    <Fragment>
      <div className="mb-5">
        <ChangeIncidentState
          incidentId={modelId}
          eventNumber={eventNumber}
          title={incidentTitle}
          eventStartsAt={durationStartDate}
          severity={severity}
          isPrivate={isPrivate}
          aiInvestigationStatus={currentAIInvestigationStatus}
          onActionComplete={async () => {
            await fetchData();
          }}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <EventStatTile
              label={`${getAcknowledgeState()?.name || "Acknowledged"} in`}
              icon={IconProp.Check}
              value={getTimeToAcknowledge()}
            />
            <EventStatTile
              label={`${getResolvedState()?.name || "Resolved"} in`}
              icon={IconProp.CheckCircle}
              value={getTimeToResolve()}
            />
            <EventStatTile
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
            />
          </div>

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
                        <TraceTable
                          spanQuery={
                            telemetryQuery.telemetryQuery as Query<Span>
                          }
                          rightElement={snapshotWindowAlert}
                          // Pinned to the snapshot; a URL-restored filter must not replace it.
                          disableUrlState={true}
                        />
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
                      <ExceptionInstanceTable
                        title="Exceptions"
                        description="Exceptions related to this incident."
                        query={
                          telemetryQuery.telemetryQuery as Query<ExceptionInstance>
                        }
                        rightElement={snapshotWindowAlert}
                        // Pinned to the snapshot; a URL-restored filter must not replace it.
                        disableUrlState={true}
                      />
                    )}
                </Fragment>
              }
            />
          )}

          <MonitorSummarySnapshotCard incidentId={modelId} />

          <IncidentAffectedResources incidentId={modelId} />

          <EntityRunbooks incidentId={modelId} hideIfEmpty={true} />

          <RemediationSuggestionCard incidentId={modelId} hideIfEmpty={true} />

          <InvestigationPanel
            subjectType="incident"
            subjectId={modelId}
            onStatusChange={onAIInvestigationStatusChange}
            onAnalysisAvailable={refreshFeedAfterAnalysisAvailable}
          />

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
              description: "Here are more details for this incident.",
            }}
            isEditable={true}
            onSaveSuccess={() => {
              // refresh page-level state (severity/visibility pills) shown in the status panel above.
              fetchData().catch((err: Error) => {
                setError(BaseAPI.getFriendlyMessage(err));
              });
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
                title: "Labels ",
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
              onBeforeFetch: async (): Promise<JSONObject> => {
                // get ack incident.

                const incidentTimelines: ListResult<IncidentStateTimeline> =
                  await ModelAPI.getList({
                    modelType: IncidentStateTimeline,
                    query: {
                      incidentId: modelId,
                    },
                    limit: LIMIT_PER_PROJECT,
                    skip: 0,
                    select: {
                      _id: true,

                      createdAt: true,
                      createdByUser: {
                        name: true,
                        email: true,
                        profilePictureId: true,
                      },
                      incidentState: {
                        name: true,
                        isResolvedState: true,
                        isAcknowledgedState: true,
                      },
                    },
                    sort: {},
                  });

                return incidentTimelines;
              },
              showDetailsInNumberOfColumns: 1,
              modelType: Incident,
              id: "model-detail-incidents",
              fields: [
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

                    return <p>Unknown</p>;
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
                      <SubscriberNotificationStatus
                        status={
                          item.subscriberNotificationStatusOnIncidentCreated
                        }
                        subscriberNotificationStatusMessage={
                          item.subscriberNotificationStatusMessage
                        }
                        onResendNotification={handleResendNotification}
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
              ],
              modelId: modelId,
            }}
          />

          <OverviewCustomFields
            modelId={modelId}
            modelType={Incident}
            customFieldType={IncidentCustomField}
            resourceName="Incident"
          />

          <CardModelDetail<Incident>
            name="Affected Resources"
            cardProps={{
              title: "Affected Resources",
              description:
                "Monitors, hosts, clusters, container hosts, and services affected by this incident.",
            }}
            isEditable={true}
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
                title: "Change Monitor Status to ",
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
              modelType: Incident,
              id: "model-detail-incident-affected-resources",
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
                        cephClusters={item.cephClusters || []}
                        dockerSwarmClusters={item.dockerSwarmClusters || []}
                        iotFleets={item.iotFleets || []}
                        services={item.services || []}
                      />
                    );
                  },
                },
              ],
              modelId: modelId,
            }}
          />

          <IncidentMemberRoleAssignment
            incidentId={modelId}
            onMemberChange={async () => {
              await fetchData();
            }}
          />
        </div>
      </div>
    </Fragment>
  );
};

export default IncidentView;
