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
import IconProp from "Common/Types/Icon/IconProp";
import HeaderAlert, {
  HeaderAlertType,
} from "Common/UI/Components/HeaderAlert/HeaderAlert";
import ColorSwatch from "Common/Types/ColorSwatch";
import IncidentFeedElement from "../../../Components/Incident/IncidentFeed";
import EntityRunbooks from "../../../Components/Runbook/EntityRunbooks";
import IncidentAffectedResources from "./AffectedResources";
import IncidentMemberRoleAssignment from "../../../Components/Incident/IncidentMemberRoleAssignment";
import EventStatTile from "../../../Components/EventView/EventStatTile";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import Host from "Common/Models/DatabaseModels/Host";
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

const IncidentView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [incidentStateTimeline, setIncidentStateTimeline] = useState<
    IncidentStateTimeline[]
  >([]);
  const [incidentStates, setIncidentStates] = useState<IncidentState[]>([]);

  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [telemetryQuery, setTelemetryQuery] = useState<TelemetryQuery | null>(
    null,
  );
  const [isPrivate, setIsPrivate] = useState<boolean>(false);
  const [severity, setSeverity] = useState<
    { name: string; color: Color } | undefined
  >(undefined);

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
          isPrivate: true,
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
      }

      setIsPrivate(incident?.isPrivate === true);

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
      incidentStateTimeline[0]?.startsAt || new Date();

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
      incidentStateTimeline[0]?.startsAt || new Date();

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

  return (
    <Fragment>
      <div className="mb-5">
        <ChangeIncidentState
          incidentId={modelId}
          severity={severity}
          isPrivate={isPrivate}
          onActionComplete={async () => {
            await fetchData();
          }}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          </div>

          {telemetryQuery &&
            telemetryQuery.telemetryType === TelemetryType.Log &&
            telemetryQuery.telemetryQuery && (
              <div>
                <Card title={"Logs"} description={"Logs for this incident."}>
                  <DashboardLogsViewer
                    id="logs-preview"
                    logQuery={telemetryQuery.telemetryQuery as Query<Log>}
                    limit={10}
                    noLogsMessage="No logs found"
                  />
                </Card>
              </div>
            )}

          {telemetryQuery &&
            telemetryQuery.telemetryType === TelemetryType.Trace &&
            telemetryQuery.telemetryQuery && (
              <div>
                <TraceTable
                  spanQuery={telemetryQuery.telemetryQuery as Query<Span>}
                />
              </div>
            )}

          {telemetryQuery &&
            telemetryQuery.telemetryType === TelemetryType.Metric &&
            telemetryQuery.metricViewData && (
              <Card
                title={"Metrics"}
                description={"Metrics related to this incident."}
                rightElement={
                  telemetryQuery.metricViewData.startAndEndDate ? (
                    <HeaderAlert
                      icon={IconProp.Clock}
                      onClick={() => {
                        // do nothing!
                      }}
                      title={OneUptimeDate.getInBetweenDatesAsFormattedString(
                        telemetryQuery.metricViewData.startAndEndDate,
                      )}
                      alertType={HeaderAlertType.INFO}
                      colorSwatch={ColorSwatch.Blue}
                    />
                  ) : (
                    <></>
                  )
                }
              >
                <MetricView
                  data={telemetryQuery.metricViewData}
                  hideQueryElements={true}
                  chartCssClass="rounded-lg border border-gray-200 shadow-sm"
                  hideStartAndEndDate={true}
                  onChange={(_data: MetricViewData) => {
                    // do nothing!
                  }}
                />
              </Card>
            )}

          {telemetryQuery &&
            telemetryQuery.telemetryType === TelemetryType.Exception &&
            telemetryQuery.telemetryQuery && (
              <ExceptionInstanceTable
                title="Exceptions"
                description="Exceptions related to this incident."
                query={
                  telemetryQuery.telemetryQuery as Query<ExceptionInstance>
                }
              />
            )}

          <IncidentAffectedResources incidentId={modelId} />

          <EntityRunbooks incidentId={modelId} hideIfEmpty={true} />

          <IncidentFeedElement incidentId={modelId} />
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

          <CardModelDetail<Incident>
            name="Affected Resources"
            cardProps={{
              title: "Affected Resources",
              description:
                "Monitors, hosts, Kubernetes clusters, Docker hosts, and services affected by this incident.",
            }}
            isEditable={true}
            formFields={[
              {
                field: {
                  monitors: true,
                },
                title: "",
                description:
                  "Search and attach monitors, hosts, Kubernetes clusters, Docker hosts, or services affected by this incident.",
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
                      services={values.services as Array<Service>}
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
